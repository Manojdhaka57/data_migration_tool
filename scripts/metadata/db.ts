/* eslint-disable @typescript-eslint/no-explicit-any --
 * Generic query wrappers over node-postgres. Row shapes and bind parameters are
 * only known by each caller, which supplies them via the <T> type argument.
 */

/**
 * Connection to the application's own metadata database.
 *
 * This is a THIRD database, separate from the source and target being migrated:
 * it stores saved migration configurations, their immutable version history,
 * connection credentials, users, and run history. Keeping it independent means
 * the tool's own state does not live inside whatever database you happen to be
 * migrating into.
 *
 * It is OPTIONAL. Every pre-existing endpoint works without APP_DB_* configured
 * — the tool behaves exactly as it did before, driven by a mapping config posted
 * in the request body. Only the configuration/auth features require it, and they
 * report a clear error when it is absent rather than failing obscurely.
 */
import { Pool, PoolClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

let pool: Pool | null = null;

export interface AppDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

/** Read APP_DB_* from the environment. Returns null when not configured. */
export function readAppDbConfig(): AppDbConfig | null {
  const host = process.env.APP_DB_HOST?.trim().replace(/^['"]|['"]$/g, '');
  const database = process.env.APP_DB_NAME?.trim().replace(/^['"]|['"]$/g, '');
  if (!host || !database) return null;

  const strip = (v: string | undefined) => v?.trim().replace(/^['"]|['"]$/g, '');
  return {
    host,
    port: parseInt(strip(process.env.APP_DB_PORT) || '5432', 10),
    database,
    user: strip(process.env.APP_DB_USER) || 'postgres',
    password: strip(process.env.APP_DB_PASSWORD) || '',
    ssl: strip(process.env.APP_DB_SSL) === 'true',
  };
}

export function isAppDbConfigured(): boolean {
  return readAppDbConfig() !== null;
}

/** Connection string for node-pg-migrate, which takes a DATABASE_URL. */
export function appDbUrl(): string {
  const cfg = readAppDbConfig();
  if (!cfg) throw new Error('APP_DB_* is not configured');
  const auth = `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password)}`;
  const sslSuffix = cfg.ssl ? '?sslmode=require' : '';
  return `postgres://${auth}@${cfg.host}:${cfg.port}/${cfg.database}${sslSuffix}`;
}

/**
 * Thrown when a configuration/auth feature is used without APP_DB_* set. The
 * API turns this into a 503 with setup instructions rather than a stack trace.
 */
export class AppDbNotConfiguredError extends Error {
  constructor() {
    super(
      'The metadata database is not configured. Set APP_DB_HOST and APP_DB_NAME ' +
      '(plus APP_DB_USER / APP_DB_PASSWORD) in .env and run `npm run appdb:up`.',
    );
    this.name = 'AppDbNotConfiguredError';
  }
}

export function getAppPool(): Pool {
  if (pool) return pool;

  const cfg = readAppDbConfig();
  if (!cfg) throw new AppDbNotConfiguredError();

  pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return pool;
}

/** Run a query against the metadata database. */
export async function appQuery<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await getAppPool().query(text, params);
  return result.rows as T[];
}

/** Run a single row query, returning null when nothing matched. */
export async function appQueryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await appQuery<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run several statements atomically. Used wherever a write spans more than one
 * table — creating a configuration version writes the version row plus its
 * table and column mappings, and a half-written version would be a corrupt
 * history entry.
 */
export async function withAppTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface AppDbHealth {
  configured: boolean;
  reachable: boolean;
  database?: string;
  migrated?: boolean;
  error?: string;
}

/** Health probe for the metadata database, safe to call when unconfigured. */
export async function appDbHealth(): Promise<AppDbHealth> {
  const cfg = readAppDbConfig();
  if (!cfg) return { configured: false, reachable: false };

  try {
    const rows = await appQuery<{ db: string }>('SELECT current_database() AS db');
    // pgmigrations is created by node-pg-migrate; its absence means the schema
    // has not been applied yet.
    const migrated = await appQueryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'migration_configuration'
       ) AS exists`,
    );
    return {
      configured: true,
      reachable: true,
      database: rows[0]?.db,
      migrated: !!migrated?.exists,
    };
  } catch (err: unknown) {
    return {
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closeAppPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
