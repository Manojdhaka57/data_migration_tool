/**
 * Run options, selected tables and mapping order.
 *
 * These used to be `useState` inside the 3,000-line MigrationPage, which meant
 * they were lost on every reload and — more importantly — could not be captured
 * into a saved configuration at all. A configuration that cannot record
 * "which tables, in what order, with which options" is not a reproducible
 * migration plan.
 *
 * The encryption key is deliberately NOT here: it is a secret, it never enters
 * a configuration snapshot, and the server refuses any configuration
 * containing one.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface RunOptions {
  /** PostgreSQL COPY fast path. Inert against a MySQL target. */
  useCopy: boolean;
  /** Re-migrate tables already marked transferred. */
  force: boolean;
  batchSize: number;
}

export interface RunOptionsState {
  options: RunOptions;
  /** Target tables to migrate. Empty means every mapped table. */
  selectedTables: string[];
  /** Explicit target-table order. Empty means derive from foreign keys. */
  mappingOrder: string[];
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  useCopy: true,
  force: false,
  // Matches what the API has always injected for a run.
  batchSize: 2000,
};

const initialState: RunOptionsState = {
  options: { ...DEFAULT_RUN_OPTIONS },
  selectedTables: [],
  mappingOrder: [],
};

const runOptionsSlice = createSlice({
  name: 'runOptions',
  initialState,
  reducers: {
    setRunOptions(state, action: PayloadAction<Partial<RunOptions>>) {
      state.options = { ...state.options, ...action.payload };
    },
    setSelectedTables(state, action: PayloadAction<string[]>) {
      state.selectedTables = action.payload;
    },
    toggleSelectedTable(state, action: PayloadAction<string>) {
      const table = action.payload;
      state.selectedTables = state.selectedTables.includes(table)
        ? state.selectedTables.filter((t) => t !== table)
        : [...state.selectedTables, table];
    },
    setMappingOrder(state, action: PayloadAction<string[]>) {
      state.mappingOrder = action.payload;
    },
    /** Drop back to deriving the order from foreign keys. */
    clearMappingOrder(state) {
      state.mappingOrder = [];
    },
    resetRunOptions() {
      return { options: { ...DEFAULT_RUN_OPTIONS }, selectedTables: [], mappingOrder: [] };
    },
  },
});

export const {
  setRunOptions,
  setSelectedTables,
  toggleSelectedTable,
  setMappingOrder,
  clearMappingOrder,
  resetRunOptions,
} = runOptionsSlice.actions;

export default runOptionsSlice.reducer;

interface WithRunOptions {
  runOptions: RunOptionsState;
}

export const selectRunOptions = (state: WithRunOptions) => state.runOptions.options;
export const selectSelectedTables = (state: WithRunOptions) => state.runOptions.selectedTables;
export const selectMappingOrder = (state: WithRunOptions) => state.runOptions.mappingOrder;
