import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../../store/store';

export interface DataRow {
  [key: string]: string | number | boolean | null;
}

export interface TableTransformResult {
  sourceTable: string;
  targetTable: string;
  sourceData: DataRow[];
  successData: DataRow[];
  failedData: DataRow[];
  errors: TransformError[];
  stats: TransformStats;
}

export interface TransformationResult {
  sourceTable: string;
  targetTable: string;
  originalData: DataRow[];
  successData: DataRow[];
  failedData: DataRow[];
  errors: TransformError[];
  stats: TransformStats;
}

export interface TransformError {
  rowIndex: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
  tableName?: string;
}

export interface TransformStats {
  totalRows: number;
  successRows: number;
  errorRows: number;
  warningRows: number;
  columnsTransformed: number;
}

export interface MultiTableStats {
  totalRows: number;
  totalTables: number;
  totalSuccessRows: number;
  totalFailedRows: number;
  perTable: Record<string, TransformStats>;
}

interface DataTransformerState {
  sourceData: DataRow[];
  // Single table mode
  successData: DataRow[];
  failedData: DataRow[];
  sourceTableName: string | null;
  targetTableName: string | null;
  stats: TransformStats | null;
  // Multi-table mode
  isMultiTableMode: boolean;
  detectedTables: string[];
  selectedTables: string[];
  tableResults: Record<string, TableTransformResult>;
  multiTableStats: MultiTableStats | null;
  // Common
  sourceFileName: string | null;
  isLoading: boolean;
  errors: TransformError[];
  transformationHistory: TransformationResult[];
}

const initialState: DataTransformerState = {
  sourceData: [],
  successData: [],
  failedData: [],
  sourceFileName: null,
  sourceTableName: null,
  targetTableName: null,
  isLoading: false,
  errors: [],
  stats: null,
  // Multi-table
  isMultiTableMode: false,
  detectedTables: [],
  selectedTables: [],
  tableResults: {},
  multiTableStats: null,
  transformationHistory: [],
};

const dataTransformerSlice = createSlice({
  name: 'dataTransformer',
  initialState,
  reducers: {
    setSourceData: (state, action: PayloadAction<{ data: DataRow[]; fileName: string; detectedTables?: string[] }>) => {
      state.sourceData = action.payload.data;
      state.sourceFileName = action.payload.fileName;
      state.successData = [];
      state.failedData = [];
      state.errors = [];
      state.stats = null;
      state.tableResults = {};
      state.multiTableStats = null;
      
      // Check for multi-table mode
      if (action.payload.detectedTables && action.payload.detectedTables.length > 0) {
        state.isMultiTableMode = true;
        state.detectedTables = action.payload.detectedTables;
        state.selectedTables = action.payload.detectedTables;
      } else {
        state.isMultiTableMode = false;
        state.detectedTables = [];
        state.selectedTables = [];
      }
    },
    setSourceTableName: (state, action: PayloadAction<string>) => {
      state.sourceTableName = action.payload;
      state.isMultiTableMode = false;
    },
    setTargetTableName: (state, action: PayloadAction<string>) => {
      state.targetTableName = action.payload;
    },
    setMultiTableMode: (state, action: PayloadAction<boolean>) => {
      state.isMultiTableMode = action.payload;
    },
    setDetectedTables: (state, action: PayloadAction<string[]>) => {
      state.detectedTables = action.payload;
    },
    setSelectedTables: (state, action: PayloadAction<string[]>) => {
      state.selectedTables = action.payload;
    },
    setTransformedData: (state, action: PayloadAction<{
      successData: DataRow[];
      failedData: DataRow[];
      errors: TransformError[];
      stats: TransformStats;
    }>) => {
      state.successData = action.payload.successData;
      state.failedData = action.payload.failedData;
      state.errors = action.payload.errors;
      state.stats = action.payload.stats;
      state.isMultiTableMode = false;
    },
    setMultiTableResults: (state, action: PayloadAction<{
      tableResults: Record<string, TableTransformResult>;
      multiTableStats: MultiTableStats;
      errors: TransformError[];
    }>) => {
      state.tableResults = action.payload.tableResults;
      state.multiTableStats = action.payload.multiTableStats;
      state.errors = action.payload.errors;
      state.isMultiTableMode = true;
    },
    addToHistory: (state, action: PayloadAction<TransformationResult>) => {
      state.transformationHistory.unshift(action.payload);
      // Keep only last 10 transformations
      if (state.transformationHistory.length > 10) {
        state.transformationHistory = state.transformationHistory.slice(0, 10);
      }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    clearData: (state) => {
      state.sourceData = [];
      state.successData = [];
      state.failedData = [];
      state.sourceFileName = null;
      state.sourceTableName = null;
      state.targetTableName = null;
      state.errors = [];
      state.stats = null;
      state.isMultiTableMode = false;
      state.detectedTables = [];
      state.selectedTables = [];
      state.tableResults = {};
      state.multiTableStats = null;
    },
    clearHistory: (state) => {
      state.transformationHistory = [];
    },
  },
});

export const {
  setSourceData,
  setSourceTableName,
  setTargetTableName,
  setMultiTableMode,
  setDetectedTables,
  setSelectedTables,
  setTransformedData,
  setMultiTableResults,
  addToHistory,
  setLoading,
  clearData,
  clearHistory,
} = dataTransformerSlice.actions;

// Selectors
export const selectSourceData = (state: RootState) => state.dataTransformer.sourceData;
export const selectSuccessData = (state: RootState) => state.dataTransformer.successData;
export const selectFailedData = (state: RootState) => state.dataTransformer.failedData;
export const selectSourceFileName = (state: RootState) => state.dataTransformer.sourceFileName;
export const selectSourceTableName = (state: RootState) => state.dataTransformer.sourceTableName;
export const selectTargetTableName = (state: RootState) => state.dataTransformer.targetTableName;
export const selectIsLoading = (state: RootState) => state.dataTransformer.isLoading;
export const selectErrors = (state: RootState) => state.dataTransformer.errors;
export const selectStats = (state: RootState) => state.dataTransformer.stats;
export const selectTransformationHistory = (state: RootState) => state.dataTransformer.transformationHistory;

// Multi-table selectors
export const selectIsMultiTableMode = (state: RootState) => state.dataTransformer.isMultiTableMode;
export const selectDetectedTables = (state: RootState) => state.dataTransformer.detectedTables;
export const selectSelectedTables = (state: RootState) => state.dataTransformer.selectedTables;
export const selectTableResults = (state: RootState) => state.dataTransformer.tableResults;
export const selectMultiTableStats = (state: RootState) => state.dataTransformer.multiTableStats;

export default dataTransformerSlice.reducer;
