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
} from '../repositories/configurations';
import { listRuns, getRun, listRunTables, listCheckpoints } from '../repositories/runs';
import { validateConfigJson, applyConfigDefaults } from '../configShape';

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
      const message = err instanceof Error ? err.message : String(err);
      // Unique-violation: a duplicate name is a client error, not a server one.
      if ((err as { code?: string })?.code === '23505') {
        return res.status(409).json({ success: false, error: message });
      }
      next(err);
    }
  };
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

/** Express 5 types route params as string | string[]; normalize and validate. */
const intParam = (value: string | string[] | undefined): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

export function createMetadataRouter(): Router {
  const router = Router();

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
      res.json({ success: true, configurations: await listConfigurations(includeArchived) });
    }),
  );

  router.get(
    '/migration-configurations/:id',
    requireAppDb,
    requireAuth,
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });

      const configuration = await getConfiguration(id);
      if (!configuration) return res.status(404).json({ success: false, error: 'configuration not found' });

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
      if (!(await getConfiguration(id))) {
        return res.status(404).json({ success: false, error: 'configuration not found' });
      }

      const result = await createNewVersion(
        id,
        {
          configuration: req.body.configuration,
          note: req.body.note ?? null,
          description: req.body.description ?? null,
          sourceConnectionId: req.body.sourceConnectionId ?? null,
          targetConnectionId: req.body.targetConnectionId ?? null,
        },
        req.actor ?? 'system',
      );
      res.json({ success: true, ...result });
    }),
  );

  router.delete(
    '/migration-configurations/:id',
    requireAppDb,
    requireRole('operator'),
    handle(async (req, res) => {
      const id = intParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: 'invalid id' });
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
      const record = await getVersion(id, version);
      if (!record) return res.status(404).json({ success: false, error: 'version not found' });
      res.json({ success: true, version: record });
    }),
  );

  /** Structural validation without saving — the pre-flight for a dry run. */
  router.post(
    '/migration-configurations/validate',
    handle(async (req, res) => {
      const configuration = applyConfigDefaults(req.body?.configuration ?? req.body ?? {});
      const errors = validateConfigJson(configuration);
      res.json({
        success: errors.length === 0,
        valid: errors.length === 0,
        errors,
        tableMappingCount: Array.isArray(configuration.tableMappings)
          ? configuration.tableMappings.length
          : 0,
      });
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
