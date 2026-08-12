/**
 * Save the current editor state back to the loaded configuration.
 *
 * This is the update loop: change a mapping, the schema, the order or a run
 * option, press Save, and the configuration gains version N+1. The previous
 * version is never modified — the database enforces that with an append-only
 * trigger — so every earlier version stays runnable exactly as it was.
 *
 * Whether a version is actually created is decided by the SERVER, by hashing
 * the canonical form of the snapshot. That check lives in one place on purpose:
 * duplicating it in the browser would eventually disagree with the database and
 * either bury real edits or produce a pile of identical versions.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import { saveNewVersion, createConfiguration } from '../../api/endpoints/configurations';
import { saveSchemaSnapshot } from '../../api/endpoints/schemaSnapshots';
import { errorMessage } from '../../api/errors';
import { setActiveConfiguration } from './activeConfiguration';
import { configurationLoaded, saveStarted, saveFinished, saveFailed } from './configurationSlice';
import { applyConfiguration } from './applyConfiguration';
import type { RootState } from '../../store';

export interface SaveResult {
  /** False when the snapshot was identical and no version was written. */
  created: boolean;
  version: number;
  configurationId: number;
  name: string;
  tableMappings: number;
}

/**
 * Assemble the complete snapshot from the store.
 *
 * Everything the migration needs, and nothing secret: connections are
 * referenced by id, and the encryption key is deliberately absent — the server
 * rejects any configuration containing one.
 */
async function buildSnapshot(state: RootState) {
  const connections = state.configuration.loaded?.connections ?? {
    source: { connectionId: null, dbType: null },
    target: { connectionId: null, dbType: null },
  };

  // Store the schemas as they currently are. Identical content deduplicates
  // server-side, so an unchanged schema costs one lookup, not another copy.
  const captureRole = async (role: 'source' | 'target', schema: unknown) => {
    if (!schema) return null;
    try {
      const { snapshot } = await saveSchemaSnapshot({
        role,
        schema,
        connectionId: connections[role].connectionId,
        origin: 'MANUAL',
        note: 'Captured when saving a configuration',
      });
      return snapshot.id;
    } catch {
      // A schema that will not store must not block saving the mappings —
      // losing the edit would be far worse than losing the schema pin.
      return null;
    }
  };

  const [sourceId, targetId] = await Promise.all([
    captureRole('source', state.sourceSchema.schema),
    captureRole('target', state.targetSchema.schema),
  ]);

  return {
    snapshotVersion: 2,
    version: 1,
    connections,
    schemaSnapshots: { sourceId, targetId },
    selectedTables: state.runOptions.selectedTables,
    tableMappings: state.mapping.tableMappings,
    mappingOrder: state.runOptions.mappingOrder,
    customDependencies: state.migrationOrder.customDependencies,
    runOptions: state.runOptions.options,
  };
}

/** Update the configuration that is currently loaded, appending a version. */
export const saveCurrentConfiguration = createAsyncThunk<
  SaveResult,
  { note?: string } | undefined,
  { state: RootState; rejectValue: string }
>('configurations/save', async (args, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const loaded = state.configuration.loaded;
  if (!loaded) {
    return rejectWithValue('No configuration is loaded. Open one from Saved Configs first.');
  }

  dispatch(saveStarted());
  try {
    const configuration = await buildSnapshot(state);
    const result = await saveNewVersion(loaded.id, {
      configuration,
      note: args?.note,
    });

    const created = (result as unknown as { created?: boolean }).created !== false;
    const version = result.version.version;

    dispatch(saveFinished({ created, version }));
    setActiveConfiguration({ configurationId: loaded.id, version, name: loaded.name });

    // Reload from the database after a version is written.
    //
    // Two reasons. It keeps every page showing the version that now exists
    // rather than the local state that produced it; and it round-trips the
    // save, so if anything were lost or reshaped on the way into storage it
    // becomes visible immediately instead of at the next migration run.
    if (created) {
      await dispatch(applyConfiguration({ configurationId: loaded.id, version }));
    }

    return {
      created,
      version,
      configurationId: loaded.id,
      name: loaded.name,
      tableMappings: state.mapping.tableMappings.length,
    };
  } catch (err) {
    const message = errorMessage(err);
    dispatch(saveFailed(message));
    return rejectWithValue(message);
  }
});

/** Save the current editor state as a brand-new configuration. */
export const saveAsNewConfiguration = createAsyncThunk<
  SaveResult,
  { name: string; description?: string; note?: string },
  { state: RootState; rejectValue: string }
>('configurations/saveAs', async ({ name, description, note }, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  dispatch(saveStarted());
  try {
    const configuration = await buildSnapshot(state);
    const result = await createConfiguration({ name, description, note, configuration });

    dispatch(saveFinished({ created: true, version: 1 }));
    dispatch(
      configurationLoaded({
        id: result.configuration.id,
        name: result.configuration.name,
        version: 1,
        connections: configuration.connections,
      }),
    );
    setActiveConfiguration({ configurationId: result.configuration.id, version: 1, name });

    return {
      created: true,
      version: 1,
      configurationId: result.configuration.id,
      name,
      tableMappings: state.mapping.tableMappings.length,
    };
  } catch (err) {
    const message = errorMessage(err);
    dispatch(saveFailed(message));
    return rejectWithValue(message);
  }
});
