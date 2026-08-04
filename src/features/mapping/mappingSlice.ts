import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type {
  TableMapping,
  ColumnMapping,
  ValidationError,
  MappingType,
  TransformationRule,
  RowFilter,
  JoinSpec,
  OrderBySpec
} from '../../types';
import { 
  saveToLocalStorage, 
  loadFromLocalStorage, 
  STORAGE_KEYS 
} from '../../utils/localStorage';

// Raw format that might come from localStorage or JSON
interface RawColumnMapping {
  id?: string;
  source?: string | { table: string; column: string };
  target: string | { table: string; column: string };
  mappingType?: MappingType;
  constantValue?: string | number | boolean | null;
  transformation?: TransformationRule;
  sourceColumns?: Array<{ table: string; column: string }>;
  convertDateToEpoch?: boolean;
  convertTinyintToBoolean?: boolean;
  zeroToNull?: boolean;
  encrypt?: boolean;
  useGroupMin?: boolean;
}

interface RawTableMapping {
  id?: string;
  sourceTable?: string;
  targetTable?: string;
  sourceTables?: string[];
  targetTables?: string[];
  columnMappings: RawColumnMapping[];
  description?: string;
  conflictStrategy?: 'skip' | 'upsert';
  conflictKeyColumns?: string[];
  rowFilters?: RowFilter[];
  joins?: JoinSpec[];
  groupByColumns?: string[];
  groupByMode?: 'dedup' | 'all';
  groupMinColumns?: string[];
  orderBy?: OrderBySpec[];
  autoIdColumn?: string;
}

/**
 * Transform raw mapping data to ensure correct format
 * Handles both old format (sourceTable as string) and new format (sourceTables as array)
 */
function normalizeTableMappings(rawMappings: RawTableMapping[]): TableMapping[] {
  if (!rawMappings) return [];
  return rawMappings?.map((raw) => {
    // Get source and target table names (handle both formats)
    const sourceTables = raw.sourceTables || (raw.sourceTable ? [raw.sourceTable] : []);
    const targetTables = raw.targetTables || (raw.targetTable ? [raw.targetTable] : []);
    
    const primarySourceTable = sourceTables[0] || '';
    const primaryTargetTable = targetTables[0] || '';
    
    // Transform column mappings
    const columnMappings: ColumnMapping[] = (raw.columnMappings || []).map((colRaw) => {
      // Determine mapping type
      let mappingType: MappingType = colRaw.mappingType || 'DIRECT';
      if (!colRaw.mappingType && !colRaw.source && colRaw.constantValue !== undefined) {
        mappingType = 'CONSTANT';
      }
      
      // Handle target - could be string or object
      let target: { table: string; column: string };
      if (typeof colRaw.target === 'string') {
        target = { table: primaryTargetTable, column: colRaw.target };
      } else if (colRaw.target && typeof colRaw.target === 'object') {
        target = colRaw.target;
      } else {
        target = { table: primaryTargetTable, column: '' };
      }
      
      // Handle source - could be string or object
      let source: { table: string; column: string } | undefined;
      if (typeof colRaw.source === 'string') {
        source = { table: primarySourceTable, column: colRaw.source };
      } else if (colRaw.source && typeof colRaw.source === 'object') {
        source = colRaw.source;
      }
      
      return {
        id: colRaw.id || uuidv4(),
        target,
        mappingType,
        source,
        constantValue: colRaw.constantValue,
        transformation: colRaw.transformation,
        sourceColumns: colRaw.sourceColumns,
        convertDateToEpoch: colRaw.convertDateToEpoch,
        convertTinyintToBoolean: colRaw.convertTinyintToBoolean,
        zeroToNull: colRaw.zeroToNull,
        encrypt: colRaw.encrypt,
        useGroupMin: colRaw.useGroupMin,
      };
    });
    
    return {
      id: raw.id || uuidv4(),
      sourceTables,
      targetTables,
      columnMappings,
      description: raw.description,
      conflictStrategy: raw.conflictStrategy,
      conflictKeyColumns: raw.conflictKeyColumns,
      rowFilters: raw.rowFilters,
      joins: raw.joins,
      groupByColumns: raw.groupByColumns,
      groupByMode: raw.groupByMode,
      groupMinColumns: raw.groupMinColumns,
      orderBy: raw.orderBy,
      autoIdColumn: raw.autoIdColumn,
    };
  });
}

interface MappingState {
  tableMappings: TableMapping[];
  activeTableMappingId: string | null;
  validationErrors: ValidationError[];
  isPersistedData: boolean; // Flag to track if data is from localStorage
}

// Helper to persist mappings to localStorage
const persistMappings = (tableMappings: TableMapping[]) => {
  saveToLocalStorage(STORAGE_KEYS.MAPPING_CONFIG, { tableMappings });
};

const initialState: MappingState = {
  tableMappings: [],
  activeTableMappingId: null,
  validationErrors: [],
  isPersistedData: false,
};

const mappingSlice = createSlice({
  name: 'mapping',
  initialState,
  reducers: {
    // Load initial mappings from JSON or localStorage (normalizes format)
    loadMappings: (state, action: PayloadAction<TableMapping[] | RawTableMapping[]>) => {
      const normalized = normalizeTableMappings(action.payload as RawTableMapping[]);
      state.tableMappings = normalized;
      state.activeTableMappingId = normalized[0]?.id ?? null;
      state.isPersistedData = false;
    },

    // Load mappings and persist to localStorage (normalizes format)
    loadMappingsAndPersist: (state, action: PayloadAction<TableMapping[] | RawTableMapping[]>) => {
      const normalized = normalizeTableMappings(action.payload as RawTableMapping[]);
      state.tableMappings = normalized;
      state.activeTableMappingId = normalized[0]?.id ?? null;
      state.isPersistedData = true;
      persistMappings(normalized);
    },

    // Load from localStorage (if available) - normalizes format
    loadFromStorage: (state) => {
      const stored = loadFromLocalStorage<{ tableMappings: RawTableMapping[] }>(
        STORAGE_KEYS.MAPPING_CONFIG
      );
      if (stored && stored.tableMappings && stored.tableMappings.length > 0) {
        const normalized = normalizeTableMappings(stored.tableMappings);
        state.tableMappings = normalized;
        state.activeTableMappingId = normalized[0]?.id ?? null;
        state.isPersistedData = true;
      }
    },

    // Table Mapping Actions
    addTableMapping: (state, action: PayloadAction<{ 
      sourceTables: string[]; 
      targetTables: string[];
      description?: string;
    }>) => {
      const newMapping: TableMapping = {
        id: uuidv4(),
        sourceTables: action.payload.sourceTables,
        targetTables: action.payload.targetTables,
        columnMappings: [],
        description: action.payload.description,
      };
      state.tableMappings.push(newMapping);
      state.activeTableMappingId = newMapping.id;
      persistMappings(state.tableMappings);
    },

    updateTableMapping: (state, action: PayloadAction<{
      id: string;
      sourceTables?: string[];
      targetTables?: string[];
      description?: string;
    }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        if (action.payload.sourceTables) mapping.sourceTables = action.payload.sourceTables;
        if (action.payload.targetTables) mapping.targetTables = action.payload.targetTables;
        if (action.payload.description !== undefined) mapping.description = action.payload.description;
        persistMappings(state.tableMappings);
      }
    },

    removeTableMapping: (state, action: PayloadAction<string>) => {
      state.tableMappings = state.tableMappings.filter(m => m.id !== action.payload);
      if (state.activeTableMappingId === action.payload) {
        state.activeTableMappingId = state.tableMappings[0]?.id ?? null;
      }
      persistMappings(state.tableMappings);
    },

    setActiveTableMapping: (state, action: PayloadAction<string | null>) => {
      state.activeTableMappingId = action.payload;
    },

    // Per-table duplicate handling: 'skip' (dedup) or 'upsert' (overwrite)
    setTableConflictStrategy: (state, action: PayloadAction<{ id: string; conflictStrategy: 'skip' | 'upsert' }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.conflictStrategy = action.payload.conflictStrategy;
        persistMappings(state.tableMappings);
      }
    },

    setTableConflictKeyColumns: (state, action: PayloadAction<{ id: string; conflictKeyColumns: string[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.conflictKeyColumns = action.payload.conflictKeyColumns;
        persistMappings(state.tableMappings);
      }
    },

    setTableRowFilters: (state, action: PayloadAction<{ id: string; rowFilters: RowFilter[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.rowFilters = action.payload.rowFilters;
        persistMappings(state.tableMappings);
      }
    },

    setTableJoins: (state, action: PayloadAction<{ id: string; joins: JoinSpec[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.joins = action.payload.joins;
        persistMappings(state.tableMappings);
      }
    },

    setTableGroupBy: (state, action: PayloadAction<{ id: string; groupByColumns: string[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.groupByColumns = action.payload.groupByColumns;
        persistMappings(state.tableMappings);
      }
    },

    setTableGroupByMode: (state, action: PayloadAction<{ id: string; groupByMode: 'dedup' | 'all' }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.groupByMode = action.payload.groupByMode;
        persistMappings(state.tableMappings);
      }
    },

    setTableGroupMin: (state, action: PayloadAction<{ id: string; groupMinColumns: string[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.groupMinColumns = action.payload.groupMinColumns;
        persistMappings(state.tableMappings);
      }
    },

    setTableOrderBy: (state, action: PayloadAction<{ id: string; orderBy: OrderBySpec[] }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.orderBy = action.payload.orderBy;
        persistMappings(state.tableMappings);
      }
    },

    setTableAutoIdColumn: (state, action: PayloadAction<{ id: string; autoIdColumn: string }>) => {
      const mapping = state.tableMappings.find(m => m.id === action.payload.id);
      if (mapping) {
        mapping.autoIdColumn = action.payload.autoIdColumn || undefined;
        persistMappings(state.tableMappings);
      }
    },

    // Column Mapping Actions
    addColumnMapping: (state, action: PayloadAction<{
      tableMappingId: string;
      target: { table: string; column: string };
      mappingType: MappingType;
      source?: { table: string; column: string };
      constantValue?: string | number | boolean | null;
      transformation?: TransformationRule;
      sourceColumns?: Array<{ table: string; column: string }>;
      convertDateToEpoch?: boolean;
      convertTinyintToBoolean?: boolean;
      zeroToNull?: boolean;
      encrypt?: boolean;
      useGroupMin?: boolean;
    }>) => {
      const tableMapping = state.tableMappings.find(m => m.id === action.payload.tableMappingId);
      if (tableMapping) {
        const newColumnMapping: ColumnMapping = {
          id: uuidv4(),
          target: action.payload.target,
          mappingType: action.payload.mappingType,
          source: action.payload.source,
          constantValue: action.payload.constantValue,
          transformation: action.payload.transformation,
          sourceColumns: action.payload.sourceColumns,
          convertDateToEpoch: action.payload.convertDateToEpoch,
          convertTinyintToBoolean: action.payload.convertTinyintToBoolean,
          zeroToNull: action.payload.zeroToNull,
          encrypt: action.payload.encrypt,
          useGroupMin: action.payload.useGroupMin,
        };
        tableMapping.columnMappings.push(newColumnMapping);
        persistMappings(state.tableMappings);
      }
    },

    updateColumnMapping: (state, action: PayloadAction<{
      tableMappingId: string;
      columnMappingId: string;
      updates: Partial<Omit<ColumnMapping, 'id'>>;
    }>) => {
      const tableMapping = state.tableMappings.find(m => m.id === action.payload.tableMappingId);
      if (tableMapping) {
        const columnMapping = tableMapping.columnMappings.find(c => c.id === action.payload.columnMappingId);
        if (columnMapping) {
          Object.assign(columnMapping, action.payload.updates);
          persistMappings(state.tableMappings);
        }
      }
    },

    removeColumnMapping: (state, action: PayloadAction<{
      tableMappingId: string;
      columnMappingId: string;
    }>) => {
      const tableMapping = state.tableMappings.find(m => m.id === action.payload.tableMappingId);
      if (tableMapping) {
        tableMapping.columnMappings = tableMapping.columnMappings.filter(
          c => c.id !== action.payload.columnMappingId
        );
        persistMappings(state.tableMappings);
      }
    },

    // Validation Actions
    setValidationErrors: (state, action: PayloadAction<ValidationError[]>) => {
      state.validationErrors = action.payload;
    },

    clearValidationErrors: (state) => {
      state.validationErrors = [];
    },

    // Reset
    clearAllMappings: (state) => {
      state.tableMappings = [];
      state.activeTableMappingId = null;
      state.validationErrors = [];
      state.isPersistedData = false;
      persistMappings([]);
    },

    // Clear localStorage data only
    clearPersistedData: (state) => {
      persistMappings([]);
      state.isPersistedData = false;
    },
  },
});

// Selectors
export const selectTableMappings = (state: { mapping: MappingState }) => 
  state.mapping.tableMappings;

export const selectActiveTableMappingId = (state: { mapping: MappingState }) => 
  state.mapping.activeTableMappingId;

export const selectActiveTableMapping = (state: { mapping: MappingState }) => 
  state.mapping.tableMappings.find(m => m.id === state.mapping.activeTableMappingId);

export const selectTableMappingById = (id: string) => 
  (state: { mapping: MappingState }) => 
    state.mapping.tableMappings.find(m => m.id === id);

export const selectColumnMappingsForTableMapping = (tableMappingId: string) => 
  (state: { mapping: MappingState }) => 
    state.mapping.tableMappings.find(m => m.id === tableMappingId)?.columnMappings ?? [];

// Get all column mappings from all table mappings
export const selectColumnMappings = (state: { mapping: MappingState }) => 
  state.mapping.tableMappings.flatMap(m => m.columnMappings);

export const selectValidationErrors = (state: { mapping: MappingState }) => 
  state.mapping.validationErrors;

export const selectValidationErrorsByTableMapping = (tableMappingId: string) => 
  (state: { mapping: MappingState }) => 
    state.mapping.validationErrors.filter(e => e.tableMappingId === tableMappingId);

export const selectIsPersistedData = (state: { mapping: MappingState }) => 
  state.mapping.isPersistedData;

// Helper function to check if localStorage has data
export const hasPersistedMappings = (): boolean => {
  const stored = loadFromLocalStorage<{ tableMappings: TableMapping[] }>(
    STORAGE_KEYS.MAPPING_CONFIG
  );
  return !!(stored && stored.tableMappings && stored.tableMappings.length > 0);
};

// Helper function to get persisted mappings (normalized)
export const getPersistedMappings = (): TableMapping[] | null => {
  const stored = loadFromLocalStorage<{ tableMappings: RawTableMapping[] }>(
    STORAGE_KEYS.MAPPING_CONFIG
  );
  if (stored?.tableMappings) {
    return normalizeTableMappings(stored.tableMappings);
  }
  return null;
};

export const { 
  loadMappings,
  loadMappingsAndPersist,
  loadFromStorage,
  addTableMapping,
  updateTableMapping,
  removeTableMapping,
  setActiveTableMapping,
  setTableConflictStrategy,
  setTableConflictKeyColumns,
  setTableRowFilters,
  setTableJoins,
  setTableGroupBy,
  setTableGroupByMode,
  setTableGroupMin,
  setTableOrderBy,
  setTableAutoIdColumn,
  addColumnMapping,
  updateColumnMapping,
  removeColumnMapping,
  setValidationErrors,
  clearValidationErrors,
  clearAllMappings,
  clearPersistedData,
} = mappingSlice.actions;

export default mappingSlice.reducer;
