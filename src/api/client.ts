/**
 * The single place that calls fetch.
 *
 * Everything else goes through apiFetch, which means bearer tokens, the
 * server's error envelope, and 401 handling are implemented exactly once
 * instead of being re-invented at each of the app's call sites.
 */
import { API_BASE_URL } from './config';
import { ApiError, type ApiErrorCode, SERVER_UNREACHABLE } from './errors';
import { getToken } from './token';

/** Called whenever the server rejects our token; the auth slice registers this. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

function codeForStatus(status: number, serverCode?: string): ApiErrorCode {
  // A code from the server always wins — it knows more than the status alone.
  if (serverCode === 'APP_DB_NOT_CONFIGURED' || serverCode === 'MISSING_SECRET_KEY') {
    return serverCode;
  }
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    default:
      return 'UNKNOWN';
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the 401 handler — the login request itself must not trigger a logout. */
  skipAuthRedirect?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal, skipAuthRedirect = false } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // An aborted request is the caller's own doing, not a network failure.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(SERVER_UNREACHABLE, 0, 'NETWORK');
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const serverCode = typeof payload?.code === 'string' ? payload.code : undefined;
    const code = codeForStatus(response.status, serverCode);

    if (code === 'UNAUTHORIZED' && !skipAuthRedirect) onUnauthorized?.();

    throw new ApiError(
      payload?.error ?? payload?.message ?? `Request failed (${response.status})`,
      response.status,
      code,
      Array.isArray(payload?.errors) ? payload.errors.map(String) : [],
    );
  }

  return payload as T;
}

/**
 * Download a file through the API.
 *
 * Needed because window.open() cannot carry an Authorization header, so every
 * link-based download breaks the moment AUTH_ENABLED is switched on.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => {
    throw new ApiError(SERVER_UNREACHABLE, 0, 'NETWORK');
  });

  if (!response.ok) {
    throw new ApiError(`Download failed (${response.status})`, response.status, codeForStatus(response.status));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
