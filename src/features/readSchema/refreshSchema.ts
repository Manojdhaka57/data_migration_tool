/**
 * Pull the live schema from the databases and store it.
 *
 * This existed only as a script until now, which is why the app could sit for
 * days showing a schema captured from a file while the real database had
 * drifted — the 155-tables-on-screen / 83-tables-in-the-snapshot confusion came
 * from exactly that. Anyone should be able to re-read the databases without a
 * terminal.
 *
 * Three things happen, in order, and each is reported separately so a partial
 * result is visible rather than silent:
 *
 *  1. Read the live schema through the migration server.
 *  2. Put it into the store, so every page is looking at the real thing.
 *  3. Store it as a schema snapshot in the metadata database, so a saved
 *     configuration can pin the exact schema it was built against.
 *
 * Step 3 is best-effort: a metadata database that is down must not stop you
 * seeing your live schema. It is reported as a warning, never as a failure.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import { API_BASE_URL } from '../../api/config';
import { saveSchemaSnapshot } from '../../api/endpoints/schemaSnapshots';
import { errorMessage } from '../../api/errors';
import { setSchema as setSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { setSchema as setTargetSchema } from '../targetSchema/targetSchemaSlice';
import type { RootState } from '../../store';
import type { DatabaseSchema } from '../../types/schema.types';

export type SchemaRole = 'source' | 'target';

export interface RoleRefreshResult {
  role: SchemaRole;
  database: string;
  /** Tables loaded in the app before this refresh. */
  tablesBefore: number;
  tablesAfter: number;
  columnsAfter: number;
  /** id of the stored snapshot, or null when it could not be stored. */
  snapshotId: number | null;
  /** True when an identical schema was already stored and was reused. */
  deduped: boolean;
  /**
   * The schema that was read. Carried on the result so callers can display it
   * without fetching ~78 KB a second time. It is returned, not stored in this
   * slice — sourceSchema/targetSchema already hold the authoritative copy.
   */
  schema: DatabaseSchema;
}

export interface RefreshResult {
  refreshed: RoleRefreshResult[];
  /** Roles that could not be read at all, with the reason. */
  failed: Array<{ role: SchemaRole; error: string }>;
  /** Non-fatal problems — chiefly a snapshot that could not be stored. */
  warnings: string[];
}

async function readLiveSchema(role: SchemaRole): Promise<DatabaseSchema> {
  const res = await fetch(`${API_BASE_URL}/schema/${role}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Could not read the ${role} schema (${res.status})`);
  }
  if (!data || !Array.isArray(data.tables)) {
    throw new Error(`The ${role} schema response did not contain any tables`);
  }
  return data as DatabaseSchema;
}

export const refreshSchemaFromDatabase = createAsyncThunk<
  RefreshResult,
  { roles?: SchemaRole[] } | undefined,
  { state: RootState; rejectValue: string }
>('readSchema/refresh', async (args, { getState, dispatch, rejectWithValue }) => {
  const roles = args?.roles ?? (['source', 'target'] as SchemaRole[]);
  const state = getState();
  const connections = state.configuration.loaded?.connections;

  const before: Record<SchemaRole, number> = {
    source: state.sourceSchema.schema?.tables.length ?? 0,
    target: state.targetSchema.schema?.tables.length ?? 0,
  };

  const refreshed: RoleRefreshResult[] = [];
  const failed: RefreshResult['failed'] = [];
  const warnings: string[] = [];

  // Sequential on purpose: two adapters against the same process-global
  // connection config is how the concurrent-run collision happens elsewhere in
  // this codebase, and reading one at a time costs a second.
  for (const role of roles) {
    let schema: DatabaseSchema;
    try {
      schema = await readLiveSchema(role);
    } catch (err) {
      failed.push({ role, error: errorMessage(err) });
      continue;
    }

    // Into the store first. Even if storing the snapshot fails, the live schema
    // is what the user asked to see.
    dispatch(role === 'source' ? setSourceSchema(schema) : setTargetSchema(schema));

    let snapshotId: number | null = null;
    let deduped = false;
    try {
      const result = await saveSchemaSnapshot({
        role,
        schema,
        connectionId: connections?.[role].connectionId ?? null,
        origin: 'DATABASE',
        note: 'Refreshed from the live database',
      });
      snapshotId = result.snapshot.id;
      deduped = result.deduped;
    } catch (err) {
      warnings.push(
        `The ${role} schema is loaded, but could not be stored as a snapshot: ${errorMessage(err)}`,
      );
    }

    refreshed.push({
      role,
      database: schema.database,
      tablesBefore: before[role],
      tablesAfter: schema.tables.length,
      columnsAfter: schema.tables.reduce((total, table) => total + table.columns.length, 0),
      snapshotId,
      deduped,
      schema,
    });
  }

  // Only a total failure is a rejection — one side working is a real result.
  if (refreshed.length === 0) {
    return rejectWithValue(failed.map((f) => `${f.role}: ${f.error}`).join(' · '));
  }

  return { refreshed, failed, warnings };
});
