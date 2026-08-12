/**
 * One error type for every API failure, so callers branch on a code rather
 * than on string-matching a message.
 *
 * The codes mirror what the server actually sends: routes.ts returns
 * `{success:false, error, code?}` with APP_DB_NOT_CONFIGURED / MISSING_SECRET_KEY
 * on 503, `errors: string[]` on a 400 validation failure, 409 on a duplicate
 * name, and 401/403 from requireAuth / requireRole.
 */

export type ApiErrorCode =
  | 'APP_DB_NOT_CONFIGURED'
  | 'MISSING_SECRET_KEY'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Per-field messages from a 400 validation response. */
  readonly details: string[];

  constructor(message: string, status: number, code: ApiErrorCode, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The message this error should show a user, including any field detail. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.details.length ? `${error.message}: ${error.details.join('; ')}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The server is not reachable at all. Worth its own message because the most
 * common cause by far is simply that the API server was never started.
 */
export const SERVER_UNREACHABLE =
  'Cannot reach the migration server. Start it with `npm run migrate:server`.';
