import { IDatabaseAdapter } from './db.interface';
import { MySQLAdapter } from './mysql.adapter';
import { PostgreSQLAdapter } from './postgresql.adapter';

export type DbDialect = 'mysql' | 'postgresql';
export type AdapterRole = 'source' | 'target';

/**
 * Read and normalize a dialect from the environment for the given role.
 * Mirrors the inline normalization that used to live in server.ts / cli.ts
 * (trim, lowercase, strip surrounding quotes). Defaults to 'postgresql' so an
 * env file without TARGET_DB_TYPE keeps behaving exactly as before.
 */
export function resolveDbType(role: AdapterRole): DbDialect {
  const envKey = role === 'source' ? 'SOURCE_DB_TYPE' : 'TARGET_DB_TYPE';
  const raw = (process.env[envKey] || 'postgresql')
    .trim()
    .toLowerCase()
    .replace(/^['"]|['"]$/g, '');
  return raw === 'mysql' ? 'mysql' : 'postgresql';
}

/**
 * Build a (not-yet-connected) adapter for the given dialect and role, reading
 * the matching SOURCE_DB_* / TARGET_DB_* environment variables. This is the
 * single construction point so source and target adapters are always built the
 * same way.
 */
export function createAdapter(dbType: DbDialect, role: AdapterRole): IDatabaseAdapter {
  const prefix = role === 'source' ? 'SOURCE' : 'TARGET';
  const defaultPort = dbType === 'mysql' ? '3306' : '5432';

  const config = {
    host: process.env[`${prefix}_DB_HOST`],
    port: parseInt(process.env[`${prefix}_DB_PORT`] || defaultPort, 10),
    database: process.env[`${prefix}_DB_NAME`],
    user: process.env[`${prefix}_DB_USER`],
    password: process.env[`${prefix}_DB_PASSWORD`],
    ssl: process.env[`${prefix}_DB_SSL`],
  };

  return dbType === 'mysql'
    ? new MySQLAdapter(config)
    : new PostgreSQLAdapter(config);
}
