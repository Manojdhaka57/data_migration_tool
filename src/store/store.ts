import { configureStore, combineReducers, type Action } from '@reduxjs/toolkit';
import sourceSchemaReducer from '../features/sourceSchema/sourceSchemaSlice';
import targetSchemaReducer from '../features/targetSchema/targetSchemaSlice';
import mappingReducer from '../features/mapping/mappingSlice';
import uiReducer from '../features/ui/uiSlice';
import migrationOrderReducer from '../features/migrationOrder/migrationOrderSlice';
import sqlAnalyzerReducer from '../features/sqlAnalyzer/sqlAnalyzerSlice';
import autoMappingReducer from '../features/autoMapping/autoMappingSlice';
import dataTransformerReducer from '../features/dataTransformer/dataTransformerSlice';
import migrationResultsReducer from '../features/migration/migrationResultsSlice';
import runOptionsReducer from '../features/migration/runOptionsSlice';
import authReducer from '../features/auth/authSlice';
import configurationReducer from '../features/configurations/configurationSlice';
import { setUnauthorizedHandler } from '../api/client';
import { sessionExpired } from '../features/auth/authSlice';

/**
 * Slices that hold the signed-in user's working data.
 *
 * On sign-out these are reset to their initial state, so the next person at
 * this browser does not inherit the previous user's schemas, mappings or
 * results. Clearing localStorage alone would leave all of it on screen.
 */
const appReducer = combineReducers({
    auth: authReducer,
    sourceSchema: sourceSchemaReducer,
    targetSchema: targetSchemaReducer,
    mapping: mappingReducer,
    ui: uiReducer,
    migrationOrder: migrationOrderReducer,
    sqlAnalyzer: sqlAnalyzerReducer,
    autoMapping: autoMappingReducer,
    dataTransformer: dataTransformerReducer,
    migrationResults: migrationResultsReducer,
    runOptions: runOptionsReducer,
    configuration: configurationReducer,
});

type AppState = ReturnType<typeof appReducer>;

const rootReducer = (state: AppState | undefined, action: Action): AppState => {
  if (action.type === 'app/userDataCleared') {
    // Keep `auth` — the sign-out result lives there and is what drives the
    // redirect to the login screen.
    return appReducer(
      state ? ({ auth: state.auth } as unknown as AppState) : undefined,
      action,
    );
  }
  return appReducer(state, action);
};

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['sourceSchema/setSchema', 'targetSchema/setSchema'],
      },
    }),
});

/**
 * Any 401 from the API means the token is no longer good. Clearing it here —
 * once, centrally — is what stops every call site having to think about it.
 * Note this never touches the localStorage drafts: unsaved mapping work must
 * survive a re-login.
 */
setUnauthorizedHandler(() => {
  store.dispatch(sessionExpired());
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
