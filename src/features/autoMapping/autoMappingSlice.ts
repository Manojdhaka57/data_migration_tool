import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../../store';
import type { Table } from '../../types/schema.types';
import { 
  generateAutoMapping, 
  type AutoMappingResult, 
  type TableMatch 
} from '../../utils/autoMapper';

interface AutoMappingState {
  // Source (Old DB) schema
  sourceTables: Table[];
  sourceFileName: string;
  sourceLoaded: boolean;
  
  // Target (New DB) schema
  targetTables: Table[];
  targetFileName: string;
  targetLoaded: boolean;
  
  // Mapping result
  mappingResult: AutoMappingResult | null;
  selectedMapping: string | null; // targetTable name
  
  // Search and filter
  searchQuery: string;
  confidenceFilter: 'all' | 'high' | 'medium' | 'low';
  
  // UI state
  isProcessing: boolean;
  error: string | null;
}

const initialState: AutoMappingState = {
  sourceTables: [],
  sourceFileName: '',
  sourceLoaded: false,
  
  targetTables: [],
  targetFileName: '',
  targetLoaded: false,
  
  mappingResult: null,
  selectedMapping: null,
  
  searchQuery: '',
  confidenceFilter: 'all',
  
  isProcessing: false,
  error: null,
};

const autoMappingSlice = createSlice({
  name: 'autoMapping',
  initialState,
  reducers: {
    setSourceSchema: (state, action: PayloadAction<{ tables: Table[]; fileName: string }>) => {
      state.sourceTables = action.payload.tables;
      state.sourceFileName = action.payload.fileName;
      state.sourceLoaded = true;
      state.error = null;
      // Auto-generate mapping if both schemas loaded
      if (state.targetLoaded) {
        state.mappingResult = generateAutoMapping(state.sourceTables, state.targetTables);
      }
    },
    
    setTargetSchema: (state, action: PayloadAction<{ tables: Table[]; fileName: string }>) => {
      state.targetTables = action.payload.tables;
      state.targetFileName = action.payload.fileName;
      state.targetLoaded = true;
      state.error = null;
      // Auto-generate mapping if both schemas loaded
      if (state.sourceLoaded) {
        state.mappingResult = generateAutoMapping(state.sourceTables, state.targetTables);
      }
    },
    
    generateMapping: (state) => {
      if (state.sourceLoaded && state.targetLoaded) {
        state.isProcessing = true;
        state.mappingResult = generateAutoMapping(state.sourceTables, state.targetTables);
        state.isProcessing = false;
      }
    },
    
    setSelectedMapping: (state, action: PayloadAction<string | null>) => {
      state.selectedMapping = action.payload;
    },
    
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    
    setConfidenceFilter: (state, action: PayloadAction<'all' | 'high' | 'medium' | 'low'>) => {
      state.confidenceFilter = action.payload;
    },
    
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    clearSource: (state) => {
      state.sourceTables = [];
      state.sourceFileName = '';
      state.sourceLoaded = false;
      state.mappingResult = null;
      state.selectedMapping = null;
    },
    
    clearTarget: (state) => {
      state.targetTables = [];
      state.targetFileName = '';
      state.targetLoaded = false;
      state.mappingResult = null;
      state.selectedMapping = null;
    },
    
    clearAll: (state) => {
      return initialState;
    },
    
    // Re-generate mapping with updated source tables
    regenerateMapping: (state) => {
      if (state.sourceLoaded && state.targetLoaded) {
        state.mappingResult = generateAutoMapping(state.sourceTables, state.targetTables);
      }
    },
  },
});

export const {
  setSourceSchema,
  setTargetSchema,
  generateMapping,
  setSelectedMapping,
  setSearchQuery,
  setConfidenceFilter,
  setError,
  clearSource,
  clearTarget,
  clearAll,
  regenerateMapping,
} = autoMappingSlice.actions;

// Selectors
export const selectSourceTables = (state: RootState) => state.autoMapping.sourceTables;
export const selectTargetTables = (state: RootState) => state.autoMapping.targetTables;
export const selectSourceFileName = (state: RootState) => state.autoMapping.sourceFileName;
export const selectTargetFileName = (state: RootState) => state.autoMapping.targetFileName;
export const selectSourceLoaded = (state: RootState) => state.autoMapping.sourceLoaded;
export const selectTargetLoaded = (state: RootState) => state.autoMapping.targetLoaded;
export const selectMappingResult = (state: RootState) => state.autoMapping.mappingResult;
export const selectSelectedMapping = (state: RootState) => state.autoMapping.selectedMapping;
export const selectSearchQuery = (state: RootState) => state.autoMapping.searchQuery;
export const selectConfidenceFilter = (state: RootState) => state.autoMapping.confidenceFilter;
export const selectError = (state: RootState) => state.autoMapping.error;
export const selectIsProcessing = (state: RootState) => state.autoMapping.isProcessing;

export const selectFilteredMappings = (state: RootState): TableMatch[] => {
  const result = state.autoMapping.mappingResult;
  if (!result) return [];
  
  let mappings = [...result.tableMappings];
  
  // Apply search filter
  const query = state.autoMapping.searchQuery.toLowerCase();
  if (query) {
    mappings = mappings.filter(
      m => m.sourceTable.toLowerCase().includes(query) ||
           m.targetTable.toLowerCase().includes(query)
    );
  }
  
  // Apply confidence filter
  const filter = state.autoMapping.confidenceFilter;
  if (filter !== 'all') {
    mappings = mappings.filter(m => m.confidence === filter);
  }
  
  return mappings;
};

export const selectSelectedMappingData = (state: RootState): TableMatch | null => {
  const result = state.autoMapping.mappingResult;
  const selected = state.autoMapping.selectedMapping;
  if (!result || !selected) return null;

  return result.tableMappings.find(m => m.targetTable === selected) || null;
};

export const selectMappingSummary = (state: RootState) => {
  const result = state.autoMapping.mappingResult;
  if (!result) return null;
  return result.summary;
};

export default autoMappingSlice.reducer;
