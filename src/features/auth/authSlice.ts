/**
 * Who is signed in, and whether the server is enforcing that at all.
 *
 * Important subtlety: the server's requireAuth/requireRole are no-ops while
 * AUTH_ENABLED is false (see scripts/metadata/auth.ts). So `authEnabled` is
 * not decoration — it is the difference between "this UI reflects real
 * permissions" and "this UI is showing a preview of permissions that nothing
 * is enforcing". `can()` below encodes that honestly.
 */
import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import {
  login as loginRequest,
  logout as logoutRequest,
  me as meRequest,
  metadataHealth,
  type AuthUser,
  type UserRole,
} from '../../api/endpoints/auth';
import { saveSession, clearSession, getSession } from '../../api/token';
import { clearAllUserData, isDataOwnedByAnotherUser, setDataOwner } from '../../utils/localStorage';
import { errorMessage, isApiError } from '../../api/errors';

export const ROLE_RANK: Record<UserRole, number> = { viewer: 1, operator: 2, admin: 3 };

export interface AuthState {
  user: AuthUser | null;
  /** The server is enforcing auth (AUTH_ENABLED=true). */
  authEnabled: boolean;
  /** APP_DB_* is configured, so users/configurations exist at all. */
  appDbConfigured: boolean;
  appDbReachable: boolean;
  /** False until the initial /auth/me + /metadata/health probe finishes. */
  ready: boolean;
  loggingIn: boolean;
  error: string | null;
  /** Set when a request 401s mid-session, so the login page can explain why. */
  sessionExpired: boolean;
}

const stored = getSession();

const initialState: AuthState = {
  // Optimistically show the stored identity so the header does not flicker;
  // bootstrap() replaces it with whatever the server actually says.
  user: stored
    ? { id: -1, username: stored.username, email: null, role: stored.role as UserRole }
    : null,
  authEnabled: false,
  appDbConfigured: false,
  appDbReachable: false,
  ready: false,
  loggingIn: false,
  error: null,
  sessionExpired: false,
};

/** One probe at startup: is auth on, is the metadata DB there, and who am I? */
export const bootstrapAuth = createAsyncThunk('auth/bootstrap', async () => {
  const [health, identity] = await Promise.all([
    metadataHealth().catch(() => null),
    meRequest().catch(() => null),
  ]);
  return {
    authEnabled: health?.authEnabled ?? identity?.authEnabled ?? false,
    appDbConfigured: health?.configured ?? false,
    appDbReachable: health?.reachable ?? false,
    user: identity?.user ?? null,
  };
});

/**
 * A restored session must pass the same ownership check as a fresh sign-in.
 *
 * Reloading the page does not go through signIn, so without this a browser
 * holding someone else's cache would hand it to whoever the stored token
 * belongs to.
 */
export const claimCacheForUser = createAsyncThunk<void, string>(
  'auth/claimCache',
  async (username, { dispatch }) => {
    if (isDataOwnedByAnotherUser(username)) {
      clearAllUserData();
      dispatch({ type: 'app/userDataCleared' });
    }
    setDataOwner(username);
  },
);

export const signIn = createAsyncThunk<
  AuthUser,
  { username: string; password: string; remember: boolean },
  { rejectValue: string }
>('auth/signIn', async ({ username, password, remember }, { dispatch, rejectWithValue }) => {
  try {
    const result = await loginRequest(username, password);
    saveSession(
      {
        token: result.token,
        expiresAt: result.expiresAt,
        username: result.user.username,
        role: result.user.role,
      },
      remember,
    );

    // Whoever signs in takes ownership of this browser's cache — and inherits
    // nothing from whoever had it before. This runs on EVERY sign-in, not just
    // after a clean sign-out, because a session can also end by token expiry, a
    // closed tab or a crash, none of which reach the sign-out handler.
    if (isDataOwnedByAnotherUser(result.user.username)) {
      clearAllUserData();
      dispatch({ type: 'app/userDataCleared' });
    }
    setDataOwner(result.user.username);

    return result.user;
  } catch (err) {
    // 401 here means bad credentials. Say that, rather than leaking whether
    // the username exists — which is also what the server does.
    if (isApiError(err) && err.code === 'UNAUTHORIZED') {
      return rejectWithValue('Incorrect username or password.');
    }
    if (isApiError(err) && err.code === 'APP_DB_NOT_CONFIGURED') {
      return rejectWithValue(
        'Sign-in needs the metadata database. Set APP_DB_* in .env and run `npm run appdb:up`.',
      );
    }
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Sign out and leave nothing behind in this browser.
 *
 * Clears the session, every cached working copy, and — importantly — the
 * stored connection settings, which contain database passwords in plaintext.
 * Leaving those would hand the next person at this machine a live connection
 * to the target database.
 *
 * The data itself is safe: configurations live in the metadata database. Only
 * UNSAVED local edits are lost, which is why the sign-out control warns when
 * there are any.
 */
export const signOut = createAsyncThunk('auth/signOut', async (_, { dispatch }) => {
  // Best effort: the local session is cleared either way, so a failed call
  // must not leave someone stuck apparently-signed-in.
  await logoutRequest().catch(() => undefined);
  clearSession();

  const cleared = clearAllUserData();

  // Wipe it from memory too — clearing storage alone would leave the previous
  // user's schemas and mappings on screen until a reload.
  dispatch({ type: 'app/userDataCleared' });

  return { cleared };
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** A request came back 401: the token is no longer good. */
    sessionExpired(state) {
      clearSession();
      state.user = null;
      state.sessionExpired = true;
    },
    clearAuthError(state) {
      state.error = null;
      state.sessionExpired = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapAuth.fulfilled, (state, action) => {
        state.authEnabled = action.payload.authEnabled;
        state.appDbConfigured = action.payload.appDbConfigured;
        state.appDbReachable = action.payload.appDbReachable;
        // Trust the server over the optimistic value from storage, but only
        // when auth is on — with auth off /auth/me returns null for everyone
        // and would wipe a perfectly good local identity.
        if (action.payload.user || action.payload.authEnabled) {
          state.user = action.payload.user;
        }
        state.ready = true;
      })
      .addCase(bootstrapAuth.rejected, (state) => {
        // The server is unreachable. Not a reason to block the app: every
        // pre-existing page works without the metadata database.
        state.ready = true;
      })
      .addCase(signIn.pending, (state) => {
        state.loggingIn = true;
        state.error = null;
        state.sessionExpired = false;
      })
      .addCase(signIn.fulfilled, (state, action: PayloadAction<AuthUser>) => {
        state.loggingIn = false;
        state.user = action.payload;
      })
      .addCase(signIn.rejected, (state, action) => {
        state.loggingIn = false;
        state.error = action.payload ?? 'Sign-in failed.';
      })
      .addCase(signOut.fulfilled, (state) => {
        state.user = null;
        state.error = null;
        state.sessionExpired = false;
      });
  },
});

export const { sessionExpired, clearAuthError } = authSlice.actions;
export default authSlice.reducer;

// ----------------------------------------------------------- selectors ---

interface WithAuth {
  auth: AuthState;
}

export const selectAuth = (state: WithAuth) => state.auth;
export const selectCurrentUser = (state: WithAuth) => state.auth.user;
export const selectAuthReady = (state: WithAuth) => state.auth.ready;

/**
 * Whether the current user may perform an action needing `minimum`.
 *
 * While AUTH_ENABLED is false the server enforces nothing, so hiding buttons
 * would take functionality away from every existing user for no security
 * benefit. Everyone is allowed; the UI only starts gating once auth is real.
 */
export const selectCan =
  (minimum: UserRole) =>
  (state: WithAuth): boolean => {
    if (!state.auth.authEnabled) return true;
    const role = state.auth.user?.role;
    return role ? ROLE_RANK[role] >= ROLE_RANK[minimum] : false;
  };
