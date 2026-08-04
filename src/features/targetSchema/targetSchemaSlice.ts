import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DatabaseSchema, Table, Column } from '../../types';
import { saveToLocalStorage, loadFromLocalStorage, removeFromLocalStorage } from '../../utils/localStorage';

const TARGET_SCHEMA_KEY = 'erp_migration_target_schema';

interface TargetSchemaState {
  schema: DatabaseSchema | null;
  selectedTable: string | null;
  selectedColumn: string | null;
  isLoaded: boolean;
  error: string | null;
  dataSource: 'localStorage' | 'file' | 'default';
}

const initialState: TargetSchemaState = {
  schema: null,
  selectedTable: null,
  selectedColumn: null,
  isLoaded: false,
  error: null,
  dataSource: 'default',
};

const targetSchemaSlice = createSlice({
  name: 'targetSchema',
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
      saveToLocalStorage(TARGET_SCHEMA_KEY, action.payload);
    },
    loadSchemaFromStorage: (state) => {
      const stored = loadFromLocalStorage<DatabaseSchema>(TARGET_SCHEMA_KEY);
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
      removeFromLocalStorage(TARGET_SCHEMA_KEY);
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
          saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
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
            saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
          }
        }
      }
    },
    addTable: (state, action: PayloadAction<Table>) => {
      if (state.schema) {
        state.schema.tables.push(action.payload);
        saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
      }
    },
    removeTable: (state, action: PayloadAction<string>) => {
      if (state.schema) {
        state.schema.tables = state.schema.tables.filter(t => t.name !== action.payload);
        saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
      }
    },
    addColumn: (state, action: PayloadAction<{ tableName: string; column: Column }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.tableName);
        if (table) {
          table.columns.push(action.payload.column);
          saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
        }
      }
    },
    removeColumn: (state, action: PayloadAction<{ tableName: string; columnName: string }>) => {
      if (state.schema) {
        const table = state.schema.tables.find(t => t.name === action.payload.tableName);
        if (table) {
          table.columns = table.columns.filter(c => c.name !== action.payload.columnName);
          saveToLocalStorage(TARGET_SCHEMA_KEY, state.schema);
        }
      }
    },
  },
});

// Selectors
export const selectTargetSchema = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.schema;

export const selectTargetDatabaseName = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.schema?.database ?? '';

export const selectTargetTables = (state: { targetSchema: TargetSchemaState }): Table[] => 
  state.targetSchema.schema?.tables ?? [];

export const selectTargetTableByName = (tableName: string) => 
  (state: { targetSchema: TargetSchemaState }): Table | undefined => 
    state.targetSchema.schema?.tables.find(t => t.name === tableName);

export const selectTargetColumnsByTable = (tableName: string) => 
  (state: { targetSchema: TargetSchemaState }): Column[] => 
    state.targetSchema.schema?.tables.find(t => t.name === tableName)?.columns ?? [];

export const selectSelectedTargetTable = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.selectedTable;

export const selectSelectedTargetColumn = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.selectedColumn;

export const selectTargetIsLoaded = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.isLoaded;

export const selectTargetError = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.error;

export const selectTargetDataSource = (state: { targetSchema: TargetSchemaState }) => 
  state.targetSchema.dataSource;

export const selectTargetStats = (state: { targetSchema: TargetSchemaState }) => {
  const tables = state.targetSchema.schema?.tables ?? [];
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
export const hasPersistedTargetSchema = (): boolean => {
  return loadFromLocalStorage<DatabaseSchema>(TARGET_SCHEMA_KEY) !== null;
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
} = targetSchemaSlice.actions;

export default targetSchemaSlice.reducer;
