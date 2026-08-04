/**
 * In-memory connection settings supplied by the UI.
 *
 * Precedence for every field is:
 *   UI value (if non-blank)  ->  matching *_DB_* env var  ->  built-in default
 *
 * So the app can run with no .env at all (configure everything in the
 * Connection Settings page), while an existing .env keeps working as the
 * pre-filled default. A blank field in the UI is treated as "not supplied" and
 * falls through to .env — that is how you clear an override.
 *
 * Nothing here is written to disk. The UI mirrors whatever it sent into
 * localStorage and re-POSTs it on load, so a server restart recovers silently.
 */
import type { AdapterRole, DbDialect } from './factory';

export interface DbConnectionOverride {
  type?: DbDialect;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  /** Kept as the string 'true' | 'false' so adapters see the same shape as env. */
  ssl?: string;
}

export interface RuntimeConnectionConfig {
  source: DbConnectionOverride;
  target: DbConnectionOverride;
  encryptionKey?: string;
}

const runtime: RuntimeConnectionConfig = { source: {}, target: {} };

/** Blank / whitespace-only values count as "not supplied" so they fall back to env. */
function clean(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Match the env normalization in resolveDbType (trim, lowercase, strip quotes). */
function normalizeDialect(value: unknown): DbDialect | undefined {
  const raw = clean(value)?.toLowerCase().replace(/^['"]|['"]$/g, '');
  if (!raw) return undefined;
  return raw === 'mysql' ? 'mysql' : 'postgresql';
}

function normalizeRole(input: DbConnectionOverride | undefined): DbConnectionOverride {
  const out: DbConnectionOverride = {};
  if (!input) return out;

  const type = normalizeDialect(input.type);
  if (type) out.type = type;

  const host = clean(input.host);
  if (host) out.host = host;

  const port = clean(input.port);
  if (port) out.port = port;

  const database = clean(input.database);
  if (database) out.database = database;

  const user = clean(input.user);
  if (user) out.user = user;

  const password = clean(input.password);
  if (password) out.password = password;

  const ssl = clean(input.ssl);
  if (ssl) out.ssl = ssl.toLowerCase() === 'true' ? 'true' : 'false';

  return out;
}

/** Replace the stored overrides. Omitted roles are left untouched. */
export function setRuntimeConnectionConfig(
  next: Partial<RuntimeConnectionConfig>,
): RuntimeConnectionConfig {
  if (next.source !== undefined) runtime.source = normalizeRole(next.source);
  if (next.target !== undefined) runtime.target = normalizeRole(next.target);
  if (next.encryptionKey !== undefined) {
    const key = clean(next.encryptionKey);
    if (key) runtime.encryptionKey = key;
    else delete runtime.encryptionKey;
  }
  return getRuntimeConnectionConfig();
}

/** Drop every override so resolution falls back to .env alone. */
export function clearRuntimeConnectionConfig(): void {
  runtime.source = {};
  runtime.target = {};
  delete runtime.encryptionKey;
}

export function getRuntimeConnectionConfig(): RuntimeConnectionConfig {
  return {
    source: { ...runtime.source },
    target: { ...runtime.target },
    encryptionKey: runtime.encryptionKey,
  };
}

export function getRoleOverride(role: AdapterRole): DbConnectionOverride {
  return role === 'source' ? runtime.source : runtime.target;
}

/** UI-supplied key wins over ENCRYPTION_KEY, matching the field precedence above. */
export function resolveEncryptionKey(): string | undefined {
  return runtime.encryptionKey || process.env.ENCRYPTION_KEY;
}

/**
 * The connection each role will actually use, with `password` replaced by a
 * boolean. Safe to return over HTTP — used by the UI to show effective values.
 */
export function describeResolvedConnection(role: AdapterRole) {
  const prefix = role === 'source' ? 'SOURCE' : 'TARGET';
  const override = getRoleOverride(role);
  const env = (suffix: string) => clean(process.env[`${prefix}_DB_${suffix}`]);

  const pick = (uiValue: string | undefined, envValue: string | undefined) => ({
    value: uiValue ?? envValue,
    from: uiValue !== undefined ? ('ui' as const) : envValue !== undefined ? ('env' as const) : ('default' as const),
  });

  return {
    type: pick(override.type, normalizeDialect(process.env[`${prefix}_DB_TYPE`])),
    host: pick(override.host, env('HOST')),
    port: pick(override.port, env('PORT')),
    database: pick(override.database, env('NAME')),
    user: pick(override.user, env('USER')),
    password: {
      value: (override.password ?? env('PASSWORD')) !== undefined ? '********' : undefined,
      from: override.password !== undefined ? ('ui' as const) : env('PASSWORD') !== undefined ? ('env' as const) : ('default' as const),
    },
    ssl: pick(override.ssl, env('SSL')),
  };
}
