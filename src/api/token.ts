/**
 * Where the session token lives.
 *
 * sessionStorage by default: the server issues 12-hour sessions, and a live
 * 12-hour credential should not sit on disk unless the user asks for it.
 * "Keep me signed in" promotes the token to localStorage, which survives a
 * browser restart.
 *
 * Deliberately storage-agnostic at the call site so this choice can change
 * without touching anything else.
 */

const KEY = 'erp_migration_session';

export interface StoredSession {
  token: string;
  /** ISO timestamp from the login response. */
  expiresAt: string;
  username: string;
  role: string;
}

function read(store: Storage): StoredSession | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

/** The current session, or null. An expired session counts as no session. */
export function getSession(): StoredSession | null {
  const session = read(sessionStorage) ?? read(localStorage);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    clearSession();
    return null;
  }
  return session;
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function saveSession(session: StoredSession, remember: boolean): void {
  clearSession();
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
  } catch {
    // A full or unavailable storage must not stop someone signing in — the
    // token still lives in Redux for this tab.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}

/** Milliseconds until the session expires; Infinity when there is no session. */
export function millisUntilExpiry(): number {
  const session = getSession();
  if (!session?.expiresAt) return Infinity;
  return new Date(session.expiresAt).getTime() - Date.now();
}
