/**
 * Storage for schema snapshots.
 *
 * Captures deduplicate on content: re-capturing an unchanged schema returns the
 * existing row rather than storing another ~78 KB copy. That is what keeps a
 * configuration that is saved repeatedly from growing the table without bound.
 */
import { appQuery, appQueryOne } from '../db';
import { schemaChecksum, countSchema, validateDatabaseSchema } from '../schemaSnapshot';
import type { DatabaseSchema } from '../../migration/types';

export type SchemaRole = 'source' | 'target';
export type SchemaOrigin = 'DATABASE' | 'UPLOAD' | 'SQL_PARSE' | 'MANUAL' | 'IMPORT';

export interface SchemaSnapshotRecord {
  id: number;
  role: SchemaRole;
  connection_id: number | null;
  database_name: string;
  origin: SchemaOrigin;
  table_count: number;
  column_count: number;
  checksum: string;
  note: string | null;
  created_by: string | null;
  captured_at: Date;
}

export interface SchemaSnapshotWithSchema extends SchemaSnapshotRecord {
  schema_json: DatabaseSchema;
}

export class SchemaValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? 'invalid schema');
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

/** Metadata only — schema_json is deliberately excluded, it is large. */
const META = `id, role, connection_id, database_name, origin, table_count,
              column_count, checksum, note, created_by, captured_at`;

export async function getSnapshot(id: number): Promise<SchemaSnapshotWithSchema | null> {
  return appQueryOne<SchemaSnapshotWithSchema>(
    `SELECT ${META}, schema_json FROM schema_snapshot WHERE id = $1`,
    [id],
  );
}

export async function listSnapshots(role?: SchemaRole, limit = 50): Promise<SchemaSnapshotRecord[]> {
  if (role) {
    return appQuery<SchemaSnapshotRecord>(
      `SELECT ${META} FROM schema_snapshot WHERE role = $1 ORDER BY captured_at DESC LIMIT $2`,
      [role, limit],
    );
  }
  return appQuery<SchemaSnapshotRecord>(
    `SELECT ${META} FROM schema_snapshot ORDER BY captured_at DESC LIMIT $1`,
    [limit],
  );
}

export interface CaptureInput {
  role: SchemaRole;
  schema: DatabaseSchema;
  connectionId?: number | null;
  origin?: SchemaOrigin;
  note?: string | null;
}

/**
 * Store a schema, reusing an identical existing snapshot for the same role.
 *
 * `deduped: true` means nothing new was written — the caller already had this
 * exact schema stored. Callers pin the returned id either way.
 */
export async function captureSnapshot(
  input: CaptureInput,
  actor: string,
): Promise<{ snapshot: SchemaSnapshotRecord; deduped: boolean }> {
  const errors = validateDatabaseSchema(input.schema);
  if (errors.length) throw new SchemaValidationError(errors);

  const checksum = schemaChecksum(input.schema);
  const existing = await appQueryOne<SchemaSnapshotRecord>(
    `SELECT ${META} FROM schema_snapshot
      WHERE role = $1 AND checksum = $2
      ORDER BY captured_at DESC LIMIT 1`,
    [input.role, checksum],
  );
  if (existing) return { snapshot: existing, deduped: true };

  const { tableCount, columnCount } = countSchema(input.schema);
  const rows = await appQuery<SchemaSnapshotRecord>(
    `INSERT INTO schema_snapshot
       (role, connection_id, database_name, origin, schema_json,
        table_count, column_count, checksum, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${META}`,
    [
      input.role,
      input.connectionId ?? null,
      input.schema.database ?? 'unknown',
      input.origin ?? 'DATABASE',
      JSON.stringify(input.schema),
      tableCount,
      columnCount,
      checksum,
      input.note ?? null,
      actor,
    ],
  );
  return { snapshot: rows[0], deduped: false };
}

/**
 * Delete a snapshot. Fails with a foreign-key violation when a configuration
 * version pins it — which is the point: a pinned snapshot is what makes that
 * version reproducible, so it must not vanish underneath it.
 */
export async function deleteSnapshot(id: number): Promise<boolean> {
  const rows = await appQuery('DELETE FROM schema_snapshot WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

/** Configuration versions that pin this snapshot, for a clear refusal message. */
export async function versionsPinning(id: number): Promise<Array<{ configuration_id: number; version: number }>> {
  return appQuery(
    `SELECT configuration_id, version
       FROM migration_configuration_version
      WHERE source_schema_snapshot_id = $1 OR target_schema_snapshot_id = $1
      ORDER BY configuration_id, version`,
    [id],
  );
}
