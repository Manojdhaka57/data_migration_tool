/**
 * Where the API lives.
 *
 * Until now the base URL was a hardcoded 'http://localhost:9005/api' copied
 * into four files, which meant a production build could only ever talk to the
 * developer's own machine. These are the single source of truth.
 *
 * NOTE: VITE_* values are baked into the JavaScript bundle at build time and
 * are readable by anyone who loads the page. Never put a secret in one.
 */

/** Base URL for REST calls. Override with VITE_API_BASE_URL at build time. */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:9005/api';

/** Origin for the socket.io connection. */
export const SOCKET_URL: string =
  import.meta.env.VITE_SOCKET_URL ?? API_BASE_URL.replace(/\/api\/?$/, '');
