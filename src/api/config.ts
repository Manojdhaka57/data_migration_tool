/**
 * Where the API lives.
 *
 * One source of truth for every REST call and the socket connection. Six files
 * used to hardcode 'http://localhost:9005/api', which meant a production build
 * could only ever talk to a developer's own machine.
 *
 * Configuration, in order of precedence:
 *
 *   VITE_API_URL        the backend origin, e.g. https://etl-api.onrender.com
 *                       (with or without a trailing /api — both work)
 *   VITE_API_BASE_URL   legacy name, still honoured so existing .env files and
 *                       any already-configured deploy keep working
 *   fallback            http://localhost:9005/api for local development
 *
 * NOTE: VITE_* values are baked into the JavaScript bundle at build time and
 * are readable by anyone who loads the page. Never put a secret in one.
 */

/**
 * Accept either an origin or a full API base and always return the API base.
 *
 * The brief specifies `VITE_API_URL=https://backend.onrender.com` (an origin),
 * while the existing code expects a base ending in /api. Normalising here means
 * neither form is wrong, which is one less way to break a deploy at 2am.
 */
function toApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}

const configured = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL;

/** Base URL for REST calls — always ends in /api. */
export const API_BASE_URL: string = configured
  ? toApiBase(configured)
  : 'http://localhost:9005/api';

/**
 * Origin for the socket.io connection — the API base without its /api suffix,
 * because socket.io attaches at the server root.
 */
export const SOCKET_URL: string = API_BASE_URL.replace(/\/api$/, '');
