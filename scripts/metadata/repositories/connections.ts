/* eslint-disable @typescript-eslint/no-explicit-any --
 * Data access over node-postgres: row shapes come back untyped from the driver,
 * and configuration_json is arbitrary caller-supplied JSON by design.
 */
/**
 * Registry of database connections.
 *
 * Configurations reference a connection by id and never embed credentials, so a
 * configuration can be exported, shared or version-controlled without leaking a
 * password. Passwords are encrypted at rest under APP_SECRET_KEY and are never
 * returned by the API — only whether one is set.
 */
import { appQuery, appQueryOne } from '../db';
import { encryptSecret, decryptSecret, hasSecretKey, MissingSecretKeyError } from '../secretBox';

export type ConnectionDialect = 'mysql' | 'postgresql' | 'hive';

export interface ConnectionRecord {
  id: number;
  name: string;
  db_type: ConnectionDialect;
  host: string;
  port: number;
  database: string;
  username: string | null;
  ssl: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
}

/** Shape returned by the API: adds hasPassword, never the password itself. */
export interface ConnectionView extends ConnectionRecord {
  hasPassword: boolean;
}

export interface ConnectionInput {
  name: string;
  db_type: ConnectionDialect;
  host: string;
  port: number;
  database: string;
  username?: string | null;
  /** Plaintext; encrypted before it touches the database. */
  password?: string | null;
  ssl?: boolean;
}

const SAFE_COLUMNS = `id, name, db_type, host, port, database, username, ssl, is_active,
                      created_by, created_at, updated_by, updated_at,
                      (password_encrypted IS NOT NULL) AS "hasPassword"`;

export async function listConnections(): Promise<ConnectionView[]> {
  return appQuery<ConnectionView>(
    `SELECT ${SAFE_COLUMNS} FROM db_connection WHERE is_active = TRUE ORDER BY name`,
  );
}

export async function getConnection(id: number): Promise<ConnectionView | null> {
  return appQueryOne<ConnectionView>(`SELECT ${SAFE_COLUMNS} FROM db_connection WHERE id = $1`, [id]);
}

function assertKeyAvailable(password: string | null | undefined) {
  if (password && !hasSecretKey()) throw new MissingSecretKeyError();
}

export async function createConnection(
  input: ConnectionInput,
  actor: string,
): Promise<ConnectionView> {
  assertKeyAvailable(input.password);

  const rows = await appQuery<ConnectionView>(
    `INSERT INTO db_connection
       (name, db_type, host, port, database, username, password_encrypted, ssl, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING ${SAFE_COLUMNS}`,
    [
      input.name,
      input.db_type,
      input.host,
      input.port,
      input.database,
      input.username ?? null,
      input.password ? encryptSecret(input.password) : null,
      input.ssl ?? false,
      actor,
    ],
  );
  return rows[0];
}

export async function updateConnection(
  id: number,
  input: Partial<ConnectionInput>,
  actor: string,
): Promise<ConnectionView | null> {
  assertKeyAvailable(input.password);

  const sets: string[] = [];
  const values: any[] = [];
  const set = (column: string, value: any) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) set('name', input.name);
  if (input.db_type !== undefined) set('db_type', input.db_type);
  if (input.host !== undefined) set('host', input.host);
  if (input.port !== undefined) set('port', input.port);
  if (input.database !== undefined) set('database', input.database);
  if (input.username !== undefined) set('username', input.username);
  if (input.ssl !== undefined) set('ssl', input.ssl);
  // An omitted password leaves the stored one alone; an explicit null clears it.
  if (input.password !== undefined) {
    set('password_encrypted', input.password ? encryptSecret(input.password) : null);
  }

  if (!sets.length) return getConnection(id);

  set('updated_by', actor);
  sets.push('updated_at = now()');
  values.push(id);

  const rows = await appQuery<ConnectionView>(
    `UPDATE db_connection SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${SAFE_COLUMNS}`,
    values,
  );
  return rows[0] ?? null;
}

/** Soft delete — a configuration may still reference this connection. */
export async function deactivateConnection(id: number, actor: string): Promise<boolean> {
  const rows = await appQuery(
    `UPDATE db_connection SET is_active = FALSE, updated_by = $2, updated_at = now()
      WHERE id = $1 AND is_active = TRUE RETURNING id`,
    [id, actor],
  );
  return rows.length > 0;
}

/**
 * Full connection details INCLUDING the decrypted password, for actually
 * opening a database connection. Never expose the result over HTTP.
 */
export async function resolveConnectionCredentials(id: number): Promise<{
  type: ConnectionDialect;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: string;
} | null> {
  const row = await appQueryOne<ConnectionRecord & { password_encrypted: string | null }>(
    `SELECT id, name, db_type, host, port, database, username, password_encrypted, ssl
       FROM db_connection WHERE id = $1 AND is_active = TRUE`,
    [id],
  );
  if (!row) return null;

  return {
    type: row.db_type,
    host: row.host,
    port: String(row.port),
    database: row.database,
    user: row.username ?? '',
    password: row.password_encrypted ? decryptSecret(row.password_encrypted) : '',
    ssl: row.ssl ? 'true' : 'false',
  };
}
