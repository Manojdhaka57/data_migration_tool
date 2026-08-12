/** Schema snapshots — the schema a configuration version was built against. */
import { apiFetch } from '../client';

export interface SchemaSnapshotRecord {
  id: number;
  role: 'source' | 'target';
  database_name: string;
  origin: string;
  table_count: number;
  column_count: number;
  checksum: string;
  note: string | null;
  captured_at: string;
}

/**
 * Store a schema the browser already holds.
 *
 * Deduplicates on content server-side, so saving a configuration repeatedly
 * without touching the schema reuses the same row rather than storing another
 * copy of ~78 KB. `deduped` says which happened.
 */
export function saveSchemaSnapshot(input: {
  role: 'source' | 'target';
  schema: unknown;
  connectionId?: number | null;
  origin?: 'DATABASE' | 'UPLOAD' | 'SQL_PARSE' | 'MANUAL' | 'IMPORT';
  note?: string;
}): Promise<{ success: true; snapshot: SchemaSnapshotRecord; deduped: boolean }> {
  return apiFetch('/schema-snapshots', { method: 'POST', body: input });
}

/** Read the live database and store the result, without it passing through the browser. */
export function captureSchemaSnapshot(input: {
  role: 'source' | 'target';
  connectionId?: number | null;
  note?: string;
}): Promise<{ success: true; snapshot: SchemaSnapshotRecord; deduped: boolean }> {
  return apiFetch('/schema-snapshots/capture', { method: 'POST', body: input });
}
