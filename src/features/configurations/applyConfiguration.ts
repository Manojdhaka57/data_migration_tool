/**
 * Restore a complete ETL setup from the database into the store.
 *
 * This replaces the old boot path, which rebuilt state from localStorage with
 * bundled JSON files as a fallback. Data now comes from the metadata database:
 * one request returns the snapshot with both schemas inlined, and everything is
 * dispatched together so connections, schemas, mappings, order and run options
 * are restored as a set — not one page at a time.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import { getApplyPayload, type ApplyPayload } from '../../api/endpoints/configurations';
import { setSchema as setSourceSchema } from '../sourceSchema/sourceSchemaSlice';
import { setSchema as setTargetSchema } from '../targetSchema/targetSchemaSlice';
import { loadMappings } from '../mapping/mappingSlice';
import { setCustomDependencies } from '../migrationOrder/migrationOrderSlice';
import { setRunOptions, setSelectedTables, setMappingOrder } from '../migration/runOptionsSlice';
import { setActiveConfiguration } from './activeConfiguration';
import { configurationLoaded } from './configurationSlice';
import type { DatabaseSchema } from '../../types/schema.types';
import type { TableMapping } from '../../types/mapping.types';

export interface AppliedSummary {
  configurationId: number;
  name: string;
  version: number;
  tableMappings: number;
  columnMappings: number;
  sourceSchemaTables: number | null;
  targetSchemaTables: number | null;
  selectedTables: number;
  hasMappingOrder: boolean;
  warnings: string[];
  dropped: Array<{ index: number; reason: string }>;
}

/**
 * Load a configuration version and put every part of it into the store.
 *
 * Order matters: schemas go in before mappings so any selector that resolves a
 * mapping against its schema sees a consistent pair rather than mappings
 * against a stale schema.
 */
export const applyConfiguration = createAsyncThunk<
  AppliedSummary,
  { configurationId: number; version?: number },
  { rejectValue: string }
>('configurations/apply', async ({ configurationId, version }, { dispatch }) => {
  const payload: ApplyPayload = await getApplyPayload(configurationId, version);
  const { snapshot, schemas, configuration, summary } = payload;

  if (schemas.source?.schema) {
    dispatch(setSourceSchema(schemas.source.schema as DatabaseSchema));
  }
  if (schemas.target?.schema) {
    dispatch(setTargetSchema(schemas.target.schema as DatabaseSchema));
  }

  dispatch(loadMappings(snapshot.tableMappings as TableMapping[]));
  dispatch(setCustomDependencies(snapshot.customDependencies));
  dispatch(setSelectedTables(snapshot.selectedTables));
  dispatch(setMappingOrder(snapshot.mappingOrder));
  dispatch(setRunOptions(snapshot.runOptions));

  // Record what is loaded, including the connection ids — nothing in the
  // editor holds those, and a save must not drop them.
  dispatch(
    configurationLoaded({
      id: configuration.id,
      name: configuration.name,
      version: payload.version.version,
      connections: snapshot.connections,
    }),
  );

  // Remember which configuration this browser is working on. Only the pointer
  // is stored locally — the configuration itself stays in the database.
  setActiveConfiguration({
    configurationId: configuration.id,
    version: payload.version.version,
    name: configuration.name,
  });

  return {
    configurationId: configuration.id,
    name: configuration.name,
    version: payload.version.version,
    tableMappings: summary.tableMappings,
    columnMappings: summary.columnMappings,
    sourceSchemaTables: (schemas.source?.schema as DatabaseSchema | undefined)?.tables?.length ?? null,
    targetSchemaTables: (schemas.target?.schema as DatabaseSchema | undefined)?.tables?.length ?? null,
    selectedTables: snapshot.selectedTables.length,
    hasMappingOrder: snapshot.mappingOrder.length > 0,
    warnings: summary.warnings,
    dropped: summary.dropped,
  };
});
