/**
 * Attach the session token to API calls that do not go through apiFetch.
 *
 * WHY THIS EXISTS: the app still makes ~39 bare `fetch()` calls to the API,
 * spread across the migration, schema and connection pages. With AUTH_ENABLED
 * on, every one of them would 401. Rewriting all of them at once is a large,
 * risky change; this is the bridge that makes enabling authentication safe
 * today, and it keeps working as those call sites migrate to apiFetch (which
 * sets its own header — see the guard below).
 *
 * This is deliberately narrow:
 *   - only requests whose URL targets the API base are touched,
 *   - an Authorization header the caller already set is never overwritten,
 *   - everything else is passed straight through to the original fetch.
 *
 * Delete this once no bare fetch to the API remains.
 */
import { API_BASE_URL } from './config';
import { getToken } from './token';

let installed = false;

/** Absolute origin+path prefix the API lives under, for matching request URLs. */
function apiPrefix(): string {
  try {
    return new URL(API_BASE_URL, window.location.origin).toString();
  } catch {
    return API_BASE_URL;
  }
}

function targetsApi(input: RequestInfo | URL): boolean {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    return new URL(raw, window.location.origin).toString().startsWith(apiPrefix());
  } catch {
    return false;
  }
}

export function installFetchAuth(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getToken();
    if (!token || !targetsApi(input)) return originalFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // apiFetch already set this; do not clobber a caller's explicit choice.
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    return originalFetch(input, { ...init, headers });
  };
}
