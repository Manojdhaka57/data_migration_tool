import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface SQLColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  autoIncrement: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: {
    table: string;
    column: string;
  };
}

export interface SQLForeignKey {
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete?: string;
  onUpdate?: string;
}

export interface SQLIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export interface SQLTable {
  name: string;
  columns: SQLColumn[];
  primaryKey: string[];
  foreignKeys: SQLForeignKey[];
  indexes: SQLIndex[];
  rawSQL: string;
}

interface SQLAnalyzerState {
  tables: SQLTable[];
  rawSQL: string;
  fileName: string | null;
  isLoaded: boolean;
  selectedTable: string | null;
  error: string | null;
  searchQuery: string;
}

const initialState: SQLAnalyzerState = {
  tables: [],
  rawSQL: '',
  fileName: null,
  isLoaded: false,
  selectedTable: null,
  error: null,
  searchQuery: '',
};

const sqlAnalyzerSlice = createSlice({
  name: 'sqlAnalyzer',
  initialState,
  reducers: {
    setSQL: (state, action: PayloadAction<{ sql: string; fileName: string }>) => {
      state.rawSQL = action.payload.sql;
      state.fileName = action.payload.fileName;
      state.error = null;
    },
    
    setTables: (state, action: PayloadAction<SQLTable[]>) => {
      state.tables = action.payload;
      state.isLoaded = true;
      state.error = null;
      if (action.payload.length > 0 && !state.selectedTable) {
        state.selectedTable = action.payload[0].name;
      }
    },
    
    setSelectedTable: (state, action: PayloadAction<string | null>) => {
      state.selectedTable = action.payload;
    },
    
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.isLoaded = false;
    },
    
    clearSQL: (state) => {
      state.tables = [];
      state.rawSQL = '';
      state.fileName = null;
      state.isLoaded = false;
      state.selectedTable = null;
      state.error = null;
      state.searchQuery = '';
    },
  },
});

// Selectors
export const selectTables = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.tables;

export const selectFilteredTables = (state: { sqlAnalyzer: SQLAnalyzerState }) => {
  const { tables, searchQuery } = state.sqlAnalyzer;
  if (!searchQuery.trim()) return tables;
  const query = searchQuery.toLowerCase();
  return tables.filter(t => t.name.toLowerCase().includes(query));
};

export const selectRawSQL = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.rawSQL;

export const selectFileName = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.fileName;

export const selectIsLoaded = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.isLoaded;

export const selectSelectedTable = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.selectedTable;

export const selectSelectedTableData = (state: { sqlAnalyzer: SQLAnalyzerState }) => {
  const { tables, selectedTable } = state.sqlAnalyzer;
  return tables.find(t => t.name === selectedTable) || null;
};

export const selectError = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.error;

export const selectSearchQuery = (state: { sqlAnalyzer: SQLAnalyzerState }) =>
  state.sqlAnalyzer.searchQuery;

export const selectTableStats = (state: { sqlAnalyzer: SQLAnalyzerState }) => {
  const { tables } = state.sqlAnalyzer;
  
  // Count FK columns (more accurate than foreignKeys array)
  const totalFKColumns = tables.reduce((sum, t) => 
    sum + t.columns.filter(c => c.isForeignKey).length, 0
  );
  
  // Count PK columns
  const totalPKColumns = tables.reduce((sum, t) => 
    sum + t.columns.filter(c => c.isPrimaryKey).length, 0
  );
  
  return {
    totalTables: tables.length,
    totalColumns: tables.reduce((sum, t) => sum + t.columns.length, 0),
    totalPrimaryKeys: totalPKColumns,
    totalForeignKeys: totalFKColumns,
  };
};

export const {
  setSQL,
  setTables,
  setSelectedTable,
  setSearchQuery,
  setError,
  clearSQL,
} = sqlAnalyzerSlice.actions;

export default sqlAnalyzerSlice.reducer;
