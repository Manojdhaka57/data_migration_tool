import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { saveToLocalStorage, loadFromLocalStorage, STORAGE_KEYS } from '../../utils/localStorage';

export interface SkippedRowDetail {
  primaryKey: string;
  primaryKeyValue: unknown;
  reason: string;
}

export interface TableResult {
  table: string;
  sourceTable: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows?: number; // Rows skipped due to duplicate key conflicts
  skippedRowsDetails?: SkippedRowDetail[]; // Details about skipped rows
  errors: string[];
  duration: number;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  level?: number;
}

export interface MigrationResult {
  timestamp: string;
  duration: number;
  totalTables: number;
  successTables: number;
  failedTables: number;
  totalRows: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped?: number; // Total rows skipped due to duplicate key conflicts
  results: TableResult[];
  dryRun: boolean;
}

interface MigrationResultsState {
  results: MigrationResult[];
  selectedResult: MigrationResult | null;
}

// Load initial state from localStorage
const loadPersistedResults = (): MigrationResult[] => {
  const persisted = loadFromLocalStorage<MigrationResult[]>(STORAGE_KEYS.MIGRATION_RESULTS);
  return persisted || [];
};

const initialState: MigrationResultsState = {
  results: loadPersistedResults(),
  selectedResult: null,
};

// Helper to persist results to localStorage
const persistResults = (results: MigrationResult[]) => {
  saveToLocalStorage(STORAGE_KEYS.MIGRATION_RESULTS, results);
};

const migrationResultsSlice = createSlice({
  name: 'migrationResults',
  initialState,
  reducers: {
    setResults: (state, action: PayloadAction<MigrationResult[]>) => {
      state.results = action.payload;
      persistResults(state.results);
    },
    addResult: (state, action: PayloadAction<MigrationResult>) => {
      // Add to beginning (most recent first)
      state.results.unshift(action.payload);
      // Keep only last 50 results
      if (state.results.length > 50) {
        state.results = state.results.slice(0, 50);
      }
      persistResults(state.results);
    },
    setSelectedResult: (state, action: PayloadAction<MigrationResult | null>) => {
      state.selectedResult = action.payload;
    },
    clearResults: (state) => {
      state.results = [];
      state.selectedResult = null;
      persistResults([]);
    },
  },
});

export const { setResults, addResult, setSelectedResult, clearResults } = migrationResultsSlice.actions;

// Selectors
export const selectMigrationResults = (state: { migrationResults: MigrationResultsState }) => 
  state.migrationResults.results;

export const selectSelectedResult = (state: { migrationResults: MigrationResultsState }) => 
  state.migrationResults.selectedResult;

export default migrationResultsSlice.reducer;
