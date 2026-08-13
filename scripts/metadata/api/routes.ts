/**
 * REST surface for the metadata database: authentication, users, the connection
 * registry, and saved configurations with their version history.
 *
 * Mounted by the migration API server. Every route degrades cleanly when
 * APP_DB_* is not configured — a 503 explaining the setup rather than a stack
 * trace — so the tool keeps working exactly as before for anyone who has not
 * opted into the metadata database.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { AppDbNotConfiguredError, appDbHealth, isAppDbConfigured } from '../db';
import { runBootstrap } from '../bootstrap';
import { MissingSecretKeyError } from '../secretBox';
import {
  createSession,
  revokeSession,
  requireAuth,
  requireRole,
  isAuthEnabled,
} from '../auth';
import {
  listUsers,
  createUser,
  findUserByUsername,
  countUsers,
  setUserActive,
  setUserPassword,
} from '../repositories/users';
import { verifyPassword } from '../auth';
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deactivateConnection,
} from '../repositories/connections';
import {
  listConfigurations,
  getConfiguration,
  getConfigurationByName,
  getCurrentVersion,
  listVersions,
  getVersion,
  createConfiguration,
  createNewVersion,
  cloneConfiguration,
  archiveConfiguration,
  restoreConfiguration,
  ConfigValidationError,
  type ConfigurationRecord,
} from '../repositories/configurations';
import { listRuns, getRun, listRunTables, listCheckpoints } from '../repositories/runs';
import {
  validateConfigJson,
  applyConfigDefaults,
  toEngineConfig,
  detectConfigShape,
  engineConfigChecksum,
} from '../configShape';
import {
  captureSnapshot,
  getSnapshot,
  listSnapshots,
  deleteSnapshot,
  versionsPinning,
  SchemaValidationError,
  type SchemaRole,
} from '../repositories/schemaSnapshots';

/** Wrap an async handler so thrown errors become clean HTTP responses. */
function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err: unknown) {
      if (err instanceof AppDbNotConfiguredError) {
        return res.status(503).json({ success: false, error: err.message, code: 'APP_DB_NOT_CONFIGURED' });
      }
      if (err instanceof MissingSecretKeyError) {
        return res.status(503).json({ success: false, error: err.message, code: 'MISSING_SECRET_KEY' });
      }
      if (err instanceof ConfigValidationError) {
        return res.status(400).json({ success: false, error: err.message, errors: err.errors });
      }
      if (err instanceof SchemaValidationError) {
        return res.status(400).json({ success: false, error: err.message, errors: err.errors });
      }
      const message = err instanceof Error ? err.message : String(err);
      // Unique-violation: a duplicate name is a client error, not a server one.
      if ((err as { code?: string })?.code === '23505') {
        return res.status(409).json({ success: false, error: message });
      }
      // Foreign-key violation: deleting a schema snapshot that a configuration
      // version pins. Refusing keeps that version reproducible.
      if ((err as { code?: string })?.code === '23503') {
        return res.status(409).json({ success: false, error: message });
      }
      next(err);
    }
  };
}

/* ==========================================================================
 * Configuration ownership.
 *
 * A user sees only the configurations they saved. Enforced here on the server
 * rather than by filtering in the browser — a UI-only filter is a curtain, not
 * a permission, and every one of these routes is reachable directly.
 *
 * Two deliberate exemptions:
 *  - admins see everything, because somebody has to be able to;
 *  - with AUTH_ENABLED off nobody is identified, so ownership is meaningless
 *    and filtering would simply hide every configuration from everyone.
 * ==========================================================================
 */

/** True when this request may see configurations it does not own. */
function seesAllConfigurations(req: Request): boolean {
  if (!isAuthEnabled()) return true;
  return req.user?.role === 'admin';
}

/** The owner to filter by, or null for "no restriction". */
function ownerFilter(req: Request): string | null {
  return seesAllConfigurations(req) ? null : (req.user?.username ?? req.actor ?? null);
}

/**
 * Fetch a configuration the caller is allowed to touch.
 *
 * Returns the reason instead of the record when it is not theirs, so callers
 * respond consistently rather than each inventing a message.
 */
async function getOwnedConfiguration(
  req: Request,
  id: number,
): Promise<
  | { ok: true; configuration: ConfigurationRecord }
  | { ok: false; status: 404 | 403; error: string }
> {
  const configuration = await getConfiguration(id);
  if (!configuration) return { ok: false, status: 404, error: 'configuration not found' };

  const owner = ownerFilter(req);
  if (owner && configuration.created_by !== owner) {
    return {
      ok: false,
      status: 403,
      error: `This configuration belongs to ${configuration.created_by ?? 'another user'}. You can only open configurations you saved.`,
    };
  }
  return { ok: true, configuration };
}

/** Guard for routes that cannot work at all without the metadata database. */
function requireAppDb(_req: Request, res: Response, next: NextFunction) {
  if (!isAppDbConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'APP_DB_NOT_CONFIGURED',
      error: new AppDbNotConfiguredError().message,
    });
  }
  next();
}

/**
 * Express 5 types route params as string | string[], and query values wider
 * still, so this takes unknown and narrows. Returns null for anything that is
 * not a usable integer — callers treat null as "absent or invalid".
 */
const intParam = (value: unknown): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
};

export function createMetadataRouter(): Router {
  const router = Router();

  // ---------------------------------------------------------- bootstrap ---
  /**
   * One-time setup for a host without shell access: create the tables and the
   * first admin user.
   *
   * Deliberately NOT behind requireAppDb/requireAuth — there is no database and
   * no user yet, which is the whole point. Its guards live in runBootstrap:
   * a setup token, and a hard refusal once any user exists.
   */
  router.post(
    '/setup/bootstrap',
    handle(async (req, res) => {
      const token =
        (req.headers['x-setup-token'] as string | undefined) ?? req.body?.token ?? undefined;
      const { status, body } = await runBootstrap({
        token,
        username: req.body?.username,
        password: req.body?.password,
        email: req.body?.email,
        role: req.body?.role,
      });
      res.status(status).json(body);
    }),
  );

  // ------------------------------------------------------------- health ---
  router.get(
    '/metadata/health',
    handle(async (_req, res) => {
      res.json({
        success: true,
        authEnabled: isAuthEnabled(),
        ...(await appDbHealth()),
      });
    }),
  );

  // --------------------------------------------------------------- auth ---
  router.post(
    '/auth/login',
    requireAppDb,
    handle(async (req, res) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'username and password are required' });
      }

      const user = await findUserByUsername(String(username));
      // Same response whether the user is unknown or the password is wrong, so
      // valid usernames cannot be enumerated.
      const ok = user && user.is_active && (await verifyPassword(String(password), user.password_hash));
      if (!ok || !user) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }

      const session = await createSession(user.id);
      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: { id: user.id, username: user.username, email: user.email, role: user.role },
      });
    }),
  );

  router.post(
    '/auth/logout',
    handle(async (req, res) => {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
      if (token) await revokeSession(token);
      res.json({ success: true });
    }),
  );

  router.get(
    '/auth/me',
    handle(async (req, res) => {
      res.json({
        success: true,
        authEnabled: isAuthEnabled(),
        user: req.user ?? null,
        actor: req.actor ?? 'system',
      });
    }),
  );

  // -------------------------------------------------------------- users ---
  router.get(
    '/users',
    requireAppDb,
    requireRole('admin'),
    handle(async (_req, res) => {
      res.json({ success: true, users: await listUsers() });
    }),
  );

  router.post(
    '/users',
    requireAppDb,
    handle(async (req, res) => {
      const existing = await countUsers();

      // Bootstrapping: the very first user can be created without a session,
      // otherwise nobody could ever sign in. Every subsequent user requires an
      // authenticated admin (when enforcement is on).
      if (existing > 0 && isAuthEnabled()) {
        if (!req.user) {
          return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        if (req.user.role !== 'admin') {
          return res.status(403).json({
            success: false,
            error: `Requires the admin role (you are ${req.user.role})`,
          });
        }
      }

      const { username, password, email, role } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'username and password are required' });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
      }

      const user = await createUser({
        username: String(username),
        password: String(password),
        email: email ?? null,
        // First user is always an admin — otherwise the install has no one who
        // can administer it.
        role: existing === 0 ? 'admin' : role,
      });
      res.status(201).json({ success: true, user });
    }),
  );

  router.patch(
    '/users/:id',
    requireAppDb,
    requireRole('admin'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      if (req.body?.password) await setUserPassword(id, String(req.body.password));
      if (req.body?.isActive !== undefined) await setUserActive(id, !!req.body.isActive);
      res.json({ success: true });
    }),
  );

  // -------------------------------------------------------- connections ---
  router.get(
    '/connections',
    requireAppDb,
    requireAuth,
    handle(async (_req, res) => {
      res.json({ success: true, connections: await listConnections() });
    }),
  );

  router.get(
    '/connections/:id',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const connection = await getConnection(id);
      if (!connection) return res.status(404).json({ success: false, error: 'connection not found' });
      res.json({ success: true, connection });
    }),
  );

  router.post(
    '/connections',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const { name, db_type, host, port, database } = req.body ?? {};
      if (!name || !db_type || !host || !port || !database) {
        return res.status(400).json({
          success: false,
          error: 'name, db_type, host, port and database are required',
        });
      }
      const connection = await createConnection(req.body, req.actor ?? 'system');
      res.status(201).json({ success: true, connection });
    }),
  );

  router.put(
    '/connections/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const connection = await updateConnection(id, req.body ?? {}, req.actor ?? 'system');
      if (!connection) return res.status(404).json({ success: false, error: 'connection not found' });
      res.json({ success: true, connection });
    }),
  );

  router.delete(
    '/connections/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const removed = await deactivateConnection(id, req.actor ?? 'system');
      if (!removed) return res.status(404).json({ success: false, error: 'connection not found' });
      res.json({ success: true });
    }),
  );

  // ----------------------------------------------------- configurations ---
  router.get(
    '/migration-configurations',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const includeArchived = String(req.query.includeArchived) === 'true';
      res.json({
        success: true,
        configurations: await listConfigurations(includeArchived, ownerFilter(req)),
        // The UI needs to know whether it is seeing everything or just this
        // user's, so it can label the list honestly.
        scope: seesAllConfigurations(req) ? 'all' : 'own',
      });
    }),
  );

  router.get(
    '/migration-configurations/:id',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      const configuration = owned.configuration;

      const current = await getCurrentVersion(id);
      res.json({ success: true, configuration, currentVersion: current });
    }),
  );

  router.post(
    '/migration-configurations',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const { name, configuration } = req.body ?? {};
      if (!name) return res.status(400).json({ success: false, error: 'name is required' });
      if (!configuration) return res.status(400).json({ success: false, error: 'configuration is required' });

      if (await getConfigurationByName(String(name))) {
        return res.status(409).json({ success: false, error: `A configuration named "${name}" already exists` });
      }

      const result = await createConfiguration(
        {
          name: String(name),
          description: req.body.description ?? null,
          sourceConnectionId: req.body.sourceConnectionId ?? null,
          targetConnectionId: req.body.targetConnectionId ?? null,
          configuration,
          note: req.body.note ?? null,
        },
        req.actor ?? 'system',
      );
      res.status(201).json({ success: true, ...result });
    }),
  );

  // An edit APPENDS a version; it never overwrites the previous one.
  router.put(
    '/migration-configurations/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      if (!req.body?.configuration) {
        return res.status(400).json({ success: false, error: 'configuration is required' });
      }
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });

      const result = await createNewVersion(
        id,
        {
          configuration: req.body.configuration,
          note: req.body.note ?? null,
          description: req.body.description ?? null,
          sourceConnectionId: req.body.sourceConnectionId ?? null,
          targetConnectionId: req.body.targetConnectionId ?? null,
          force: req.body.force === true,
        },
        req.actor ?? 'system',
      );
      res.json({
        success: true,
        ...result,
        // `created: false` means the snapshot was identical to the current
        // version, so nothing was written. The UI says so rather than claiming
        // a save that produced no new version.
        message: result.created
          ? `Saved as version ${result.version.version}.`
          : `No changes — still version ${result.version.version}.`,
      });
    }),
  );

  router.delete(
    '/migration-configurations/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      // Archive, not delete: runs point at this configuration's versions and
      // deleting would cascade that history away.
      const archived = await archiveConfiguration(id, req.actor ?? 'system');
      if (!archived) return res.status(404).json({ success: false, error: 'configuration not found or already archived' });
      res.json({ success: true, status: 'ARCHIVED' });
    }),
  );

  router.post(
    '/migration-configurations/:id/restore',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      const restored = await restoreConfiguration(id, req.actor ?? 'system');
      if (!restored) return res.status(404).json({ success: false, error: 'configuration not found or already active' });
      res.json({ success: true, status: 'ACTIVE' });
    }),
  );

  router.post(
    '/migration-configurations/:id/clone',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      if (!req.body?.name) return res.status(400).json({ success: false, error: 'name is required' });
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });

      const result = await cloneConfiguration(
        id,
        String(req.body.name),
        req.actor ?? 'system',
        req.body.fromVersion ? Number(req.body.fromVersion) : undefined,
      );
      res.status(201).json({ success: true, ...result });
    }),
  );

  // ---------------------------------------------------------- versions ---
  router.get(
    '/migration-configurations/:id/versions',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      res.json({ success: true, versions: await listVersions(id) });
    }),
  );

  router.get(
    '/migration-configurations/:id/versions/:version',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      const version = intParam(req.params.version);
      if (id === null || version === null) {
        return res.status(400).json({ success: false, error: 'invalid id or version' });
      }
      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      const record = await getVersion(id, version);
      if (!record) return res.status(404).json({ success: false, error: 'version not found' });
      res.json({ success: true, version: record });
    }),
  );

  /**
   * The configuration as it will actually EXECUTE.
   *
   * Saved configurations keep the caller's JSON verbatim, so what is stored is
   * not necessarily what the engine runs. This resolves the stored JSON through
   * the same canonicalization the run path applies, so a mapping can be checked
   * before it touches a database rather than after.
   */
  router.get(
    '/migration-configurations/:id/resolved',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      const configuration = owned.configuration;

      const requested = intParam(req.query.version);
      const record = requested === null ? await getCurrentVersion(id) : await getVersion(id, requested);
      if (!record) return res.status(404).json({ success: false, error: 'version not found' });

      const stored = applyConfigDefaults(record.configuration_json ?? {});
      const { config, warnings, dropped } = toEngineConfig(stored);

      res.json({
        success: true,
        configuration,
        version: { id: record.id, version: record.version, created_at: record.created_at },
        storedShape: detectConfigShape(stored),
        engineConfig: config,
        checksum: engineConfigChecksum(config),
        warnings,
        dropped,
      });
    }),
  );

  /**
   * Everything needed to restore a complete ETL setup, in one call.
   *
   * The frontend used to rebuild its state from localStorage and bundled JSON
   * files. This is the replacement: the stored snapshot with both schemas
   * inlined and connection metadata resolved, so opening a saved configuration
   * restores connections, schemas, mappings, order and run options together
   * rather than leaving the user to reconfigure everything by hand.
   *
   * Connection details here are non-secret only — never a password.
   */
  router.get(
    '/migration-configurations/:id/apply-payload',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      const owned = await getOwnedConfiguration(req, id);
      if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
      const configuration = owned.configuration;

      const requested = intParam(req.query.version);
      const record = requested === null ? await getCurrentVersion(id) : await getVersion(id, requested);
      if (!record) return res.status(404).json({ success: false, error: 'version not found' });

      const snapshot = applyConfigDefaults(record.configuration_json ?? {});

      // Inline the schemas so the client needs one round trip, not three.
      const [sourceSnapshot, targetSnapshot] = await Promise.all([
        snapshot.schemaSnapshots.sourceId ? getSnapshot(snapshot.schemaSnapshots.sourceId) : null,
        snapshot.schemaSnapshots.targetId ? getSnapshot(snapshot.schemaSnapshots.targetId) : null,
      ]);

      const [sourceConnection, targetConnection] = await Promise.all([
        snapshot.connections.source.connectionId
          ? getConnection(snapshot.connections.source.connectionId)
          : null,
        snapshot.connections.target.connectionId
          ? getConnection(snapshot.connections.target.connectionId)
          : null,
      ]);

      const { config: engineConfig, warnings, dropped } = toEngineConfig(snapshot);

      res.json({
        success: true,
        configuration,
        version: { id: record.id, version: record.version, created_at: record.created_at },
        snapshot,
        schemas: {
          source: sourceSnapshot
            ? { id: sourceSnapshot.id, capturedAt: sourceSnapshot.captured_at, schema: sourceSnapshot.schema_json }
            : null,
          target: targetSnapshot
            ? { id: targetSnapshot.id, capturedAt: targetSnapshot.captured_at, schema: targetSnapshot.schema_json }
            : null,
        },
        connections: { source: sourceConnection, target: targetConnection },
        // What would actually execute, so the UI can show a real summary.
        summary: {
          tableMappings: engineConfig.tableMappings.length,
          columnMappings: engineConfig.tableMappings.reduce(
            (sum, m) => sum + m.columnMappings.length,
            0,
          ),
          warnings,
          dropped,
        },
      });
    }),
  );

  /** Structural validation without saving — the pre-flight for a dry run. */
  router.post(
    '/migration-configurations/validate',
    handle(async (req, res) => {
      const configuration = applyConfigDefaults(req.body?.configuration ?? req.body ?? {});
      const errors = validateConfigJson(configuration);
      const { config, warnings, dropped } = toEngineConfig(configuration);
      res.json({
        success: errors.length === 0,
        valid: errors.length === 0,
        errors,
        // Which shape was submitted, and what would actually run.
        shape: detectConfigShape(configuration),
        warnings,
        dropped,
        tableMappingCount: Array.isArray(configuration.tableMappings)
          ? configuration.tableMappings.length
          : 0,
        runnableTableMappingCount: config.tableMappings.length,
      });
    }),
  );

  // --------------------------------------------------- schema snapshots ---
  // The schema a configuration was built against. Pinning it is what lets the
  // tool notice later that a mapped column no longer exists.
  router.get(
    '/schema-snapshots',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const role = req.query.role === 'source' || req.query.role === 'target'
        ? (req.query.role as SchemaRole)
        : undefined;
      const limit = Math.min(Math.max(intParam(req.query.limit) ?? 50, 1), 200);
      res.json({ success: true, snapshots: await listSnapshots(role, limit) });
    }),
  );

  router.get(
    '/schema-snapshots/:id',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
      const snapshot = await getSnapshot(id);
      if (!snapshot) return res.status(404).json({ success: false, error: 'snapshot not found' });
      res.json({ success: true, snapshot });
    }),
  );

  /** Store a schema the caller already has (uploaded, parsed, or hand-edited). */
  router.post(
    '/schema-snapshots',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const { role, schema, connectionId, origin, note } = req.body ?? {};
      if (role !== 'source' && role !== 'target') {
        return res.status(400).json({ success: false, error: 'role must be "source" or "target"' });
      }
      const result = await captureSnapshot(
        { role, schema, connectionId: connectionId ?? null, origin: origin ?? 'MANUAL', note: note ?? null },
        req.actor ?? 'system',
      );
      // Deduped means an identical schema was already stored; the caller pins
      // the same id either way.
      res.status(result.deduped ? 200 : 201).json({ success: true, ...result });
    }),
  );

  router.delete(
    '/schema-snapshots/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      // Check first so the refusal names the versions, rather than surfacing a
      // raw foreign-key error.
      const pinning = await versionsPinning(id);
      if (pinning.length > 0) {
        return res.status(409).json({
          success: false,
          error:
            `Snapshot ${id} is pinned by ${pinning.length} configuration version(s) and cannot be ` +
            `deleted — removing it would make those versions unreproducible.`,
          pinnedBy: pinning,
        });
      }
      const removed = await deleteSnapshot(id);
      if (!removed) return res.status(404).json({ success: false, error: 'snapshot not found' });
      res.json({ success: true });
    }),
  );

  // -------------------------------------------------------------- runs ---
  router.get(
    '/migration-runs',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50), 200);
      const configurationId = req.query.configurationId
        ? Number(req.query.configurationId)
        : undefined;
      res.json({ success: true, runs: await listRuns(limit, configurationId) });
    }),
  );

  router.get(
    '/migration-runs/:id',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      const run = await getRun(id);
      if (!run) return res.status(404).json({ success: false, error: 'run not found' });

      res.json({
        success: true,
        run,
        tables: await listRunTables(id),
        checkpoints: await listCheckpoints(id),
      });
    }),
  );

  return router;
}
