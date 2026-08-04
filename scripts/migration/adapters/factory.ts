import { IDatabaseAdapter } from './db.interface';
import { MySQLAdapter } from './mysql.adapter';
import { PostgreSQLAdapter } from './postgresql.adapter';
import { getRoleOverride } from './runtimeConfig';

export type DbDialect = 'mysql' | 'postgresql';
export type AdapterRole = 'source' | 'target';

/**
 * Resolve the dialect for the given role: a value set from the UI wins, then
 * the environment. Env normalization (trim, lowercase, strip surrounding
 * quotes) is unchanged, and it still defaults to 'postgresql' so an env file
 * without TARGET_DB_TYPE keeps behaving exactly as before.
 */
export function resolveDbType(role: AdapterRole): DbDialect {
  const override = getRoleOverride(role).type;
  if (override) return override;

  const envKey = role === 'source' ? 'SOURCE_DB_TYPE' : 'TARGET_DB_TYPE';
  const raw = (process.env[envKey] || 'postgresql')
    .trim()
    .toLowerCase()
    .replace(/^['"]|['"]$/g, '');
  return raw === 'mysql' ? 'mysql' : 'postgresql';
}

/**
 * Build a (not-yet-connected) adapter for the given dialect and role. Each
 * field comes from the UI-supplied connection settings when present, otherwise
 * from the matching SOURCE_DB_* / TARGET_DB_* environment variable. This is the
 * single construction point so source and target adapters are always built the
 * same way — with no UI settings stored, behaviour is identical to reading env
 * directly.
 */
export function createAdapter(dbType: DbDialect, role: AdapterRole): IDatabaseAdapter {
  const prefix = role === 'source' ? 'SOURCE' : 'TARGET';
  const defaultPort = dbType === 'mysql' ? '3306' : '5432';
  const override = getRoleOverride(role);

  const config = {
    host: override.host ?? process.env[`${prefix}_DB_HOST`],
    port: parseInt(override.port || process.env[`${prefix}_DB_PORT`] || defaultPort, 10),
    database: override.database ?? process.env[`${prefix}_DB_NAME`],
    user: override.user ?? process.env[`${prefix}_DB_USER`],
    password: override.password ?? process.env[`${prefix}_DB_PASSWORD`],
    ssl: override.ssl ?? process.env[`${prefix}_DB_SSL`],
  };

  return dbType === 'mysql'
    ? new MySQLAdapter(config)
    : new PostgreSQLAdapter(config);
}
