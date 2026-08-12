/**
 * Which configuration is loaded, and the parts of its snapshot the editor does
 * not otherwise hold.
 *
 * Connection ids in particular have no home in any editor slice — nothing in
 * the UI edits them — but they must survive a save, or updating a
 * configuration would silently drop which databases it was bound to.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface LoadedConfiguration {
  id: number;
  name: string;
  /** The version that was loaded. Saving appends the next one. */
  version: number;
  connections: {
    source: { connectionId: number | null; dbType: string | null };
    target: { connectionId: number | null; dbType: string | null };
  };
}

export interface ConfigurationState {
  loaded: LoadedConfiguration | null;
  saving: boolean;
  /** Result of the last save, so the UI can say what actually happened. */
  lastSave: { created: boolean; version: number; at: string } | null;
  error: string | null;
}

const initialState: ConfigurationState = {
  loaded: null,
  saving: false,
  lastSave: null,
  error: null,
};

const configurationSlice = createSlice({
  name: 'configuration',
  initialState,
  reducers: {
    configurationLoaded(state, action: PayloadAction<LoadedConfiguration>) {
      state.loaded = action.payload;
      state.lastSave = null;
      state.error = null;
    },
    configurationCleared(state) {
      state.loaded = null;
      state.lastSave = null;
    },
    saveStarted(state) {
      state.saving = true;
      state.error = null;
    },
    saveFinished(state, action: PayloadAction<{ created: boolean; version: number }>) {
      state.saving = false;
      state.lastSave = { ...action.payload, at: new Date().toISOString() };
      if (state.loaded) state.loaded.version = action.payload.version;
    },
    saveFailed(state, action: PayloadAction<string>) {
      state.saving = false;
      state.error = action.payload;
    },
    clearSaveState(state) {
      state.lastSave = null;
      state.error = null;
    },
  },
});

export const {
  configurationLoaded,
  configurationCleared,
  saveStarted,
  saveFinished,
  saveFailed,
  clearSaveState,
} = configurationSlice.actions;

export default configurationSlice.reducer;

interface WithConfiguration {
  configuration: ConfigurationState;
}

export const selectLoadedConfiguration = (state: WithConfiguration) => state.configuration.loaded;
export const selectConfigurationSaveState = (state: WithConfiguration) => ({
  saving: state.configuration.saving,
  lastSave: state.configuration.lastSave,
  error: state.configuration.error,
});
