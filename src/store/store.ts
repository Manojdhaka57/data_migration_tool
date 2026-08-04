import { configureStore } from '@reduxjs/toolkit';
import sourceSchemaReducer from '../features/sourceSchema/sourceSchemaSlice';
import targetSchemaReducer from '../features/targetSchema/targetSchemaSlice';
import mappingReducer from '../features/mapping/mappingSlice';
import uiReducer from '../features/ui/uiSlice';
import migrationOrderReducer from '../features/migrationOrder/migrationOrderSlice';
import sqlAnalyzerReducer from '../features/sqlAnalyzer/sqlAnalyzerSlice';
import autoMappingReducer from '../features/autoMapping/autoMappingSlice';
import dataTransformerReducer from '../features/dataTransformer/dataTransformerSlice';
import migrationResultsReducer from '../features/migration/migrationResultsSlice';

export const store = configureStore({
  reducer: {
    sourceSchema: sourceSchemaReducer,
    targetSchema: targetSchemaReducer,
    mapping: mappingReducer,
    ui: uiReducer,
    migrationOrder: migrationOrderReducer,
    sqlAnalyzer: sqlAnalyzerReducer,
    autoMapping: autoMappingReducer,
    dataTransformer: dataTransformerReducer,
    migrationResults: migrationResultsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['sourceSchema/setSchema', 'targetSchema/setSchema'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
