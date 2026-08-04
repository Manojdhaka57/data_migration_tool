import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DatabaseSchema, Table, Column } from '../../types';
import { saveToLocalStorage, loadFromLocalStorage, removeFromLocalStorage } from '../../utils/localStorage';

const SOURCE_SCHEMA_KEY = 'erp_migration_source_schema';

interface SourceSchemaState {
  schema: DatabaseSchema | null;
  selectedTable: string | null;
  selectedColumn: string | null;
  isLoaded: boolean;
  error: string | null;
  dataSource: 'localStorage' | 'file' | 'default';
}

const initialState: SourceSchemaState = {
  schema: null,
  selectedTable: null,
  selectedColumn: null,
  isLoaded: false,
  error: null,
  dataSource: 'default',
};

const sourceSchemaSlice = createSlice({
  name: 'sourceSchema',
  initialState,
  reducers: {
    setSchema: (state, action: PayloadAction<DatabaseSchema>) => {
      state.schema = action.payload;
      state.isLoaded = true;
      state.error = null;
      state.selectedTable = null;
      state.selectedColumn = null;
      state.dataSource = 'file';
      // Persist to localStorage
      saveToLocalStorage(SOURCE_SCHEMA_KEY, action.payload);
    },
    loadSchemaFromStorage: (state) => {
      const stored = loadFromLocalStorage<DatabaseSchema>(SOURCE_SCHEMA_KEY);
      if (stored) {
        state.schema = stored;
        state.isLoaded = true;
        state.error = null;
        state.dataSource = 'localStorage';
      }
    },
    clearSchema: (state) => {
      state.schema = null;
      state.isLoaded = false;
      state.selectedTable = null;
      state.selectedColumn = null;
      state.error = null;
      state.dataSource = 'default';
      // Remove from localStorage
      removeFromLocalStorage(SOURCE_SCHEMA_KEY);
    },
    setSelectedTable: (state, action: PayloadAction<string | null>) => {
      state.selectedTable = action.payload;
      state.selectedColumn = null;
    },
    setSelectedColumn: (state, action: PayloadAction<string | null>) => {
      state.selectedColumn = action.payload;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.isLoaded = false;
    },
    updateTable: (state, action: PayloadAction<{ oldName: string; newName: string }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.oldName);
        if (table) {
          table.name = action.payload.newName;
          // Persist to localStorage
          saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
        }
      }
    },
    updateColumn: (state, action: PayloadAction<{
      tableName: string;
      columnName: string;
      updates: Partial<Column>;
    }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.tableName);
        if (table) {
          const column = table.columns.find(c => c.name === action.payload.columnName);
          if (column) {
            Object.assign(column, action.payload.updates);
            // Persist to localStorage
            saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
          }
        }
      }
    },
    addTable: (state, action: PayloadAction<Table>) => {
      if (state.schema) {
        state.schema.tables.push(action.payload);
        saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
      }
    },
    removeTable: (state, action: PayloadAction<string>) => {
      if (state.schema) {
        state.schema.tables = state.schema.tables.filter(t => t.name !== action.payload);
        saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
      }
    },
    addColumn: (state, action: PayloadAction<{ tableName: string; column: Column }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.tableName);
        if (table) {
          table.columns.push(action.payload.column);
          saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
        }
      }
    },
    removeColumn: (state, action: PayloadAction<{ tableName: string; columnName: string }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.tableName);
        if (table) {
          table.columns = table.columns.filter(c => c.name !== action.payload.columnName);
          saveToLocalStorage(SOURCE_SCHEMA_KEY, state.schema);
        }
      }
    },
  },
});

// Selectors
export const selectSourceSchema = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.schema;

export const selectSourceDatabaseName = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.schema?.database ?? '';

export const selectSourceTables = (state: { sourceSchema: SourceSchemaState }): Table[] => 
  state.sourceSchema.schema?.tables ?? [];

export const selectSourceTableByName = (tableName: string) => 
  (state: { sourceSchema: SourceSchemaState }): Table | undefined => 
    state.sourceSchema.schema?.tables.find(t => t.name === tableName);

export const selectSourceColumnsByTable = (tableName: string) => 
  (state: { sourceSchema: SourceSchemaState }): Column[] => 
    state.sourceSchema.schema?.tables.find(t => t.name === tableName)?.columns ?? [];

export const selectSelectedSourceTable = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.selectedTable;

export const selectSelectedSourceColumn = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.selectedColumn;

export const selectSourceIsLoaded = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.isLoaded;

export const selectSourceError = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.error;

export const selectSourceDataSource = (state: { sourceSchema: SourceSchemaState }) => 
  state.sourceSchema.dataSource;

export const selectSourceStats = (state: { sourceSchema: SourceSchemaState }) => {
  const tables = state.sourceSchema.schema?.tables ?? [];
  let totalColumns = 0;
  let totalPrimaryKeys = 0;
  let totalForeignKeys = 0;
  
  tables.forEach(table => {
    totalColumns += table.columns.length;
    table.columns.forEach(col => {
      if (col.isPrimaryKey) totalPrimaryKeys++;
      if (col.isForeignKey) totalForeignKeys++;
    });
  });
  
  return {
    totalTables: tables.length,
    totalColumns,
    totalPrimaryKeys,
    totalForeignKeys,
  };
};

// Check if schema exists in localStorage
export const hasPersistedSourceSchema = (): boolean => {
  return loadFromLocalStorage<DatabaseSchema>(SOURCE_SCHEMA_KEY) !== null;
};

export const { 
  setSchema, 
  loadSchemaFromStorage,
  clearSchema, 
  setSelectedTable, 
  setSelectedColumn, 
  setError,
  updateTable,
  updateColumn,
  addTable,
  removeTable,
  addColumn,
  removeColumn,
} = sourceSchemaSlice.actions;

export default sourceSchemaSlice.reducer;
