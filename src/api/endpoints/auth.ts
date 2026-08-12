/** Auth and server-capability calls. Mirrors scripts/metadata/api/routes.ts. */
import { apiFetch } from '../client';

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
}

export interface LoginResponse {
  success: true;
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface MeResponse {
  success: true;
  authEnabled: boolean;
  user: AuthUser | null;
  actor: string;
}

export interface MetadataHealth {
  success: boolean;
  authEnabled: boolean;
  /** APP_DB_* is set. */
  configured: boolean;
  /** The database actually answered. */
  reachable: boolean;
  database?: string;
  /** Migrations have been applied. */
  migrated?: boolean;
  error?: string;
}

export function login(username: string, password: string): Promise<LoginResponse> {
  // skipAuthRedirect: a rejected login is a wrong password, not an expired
  // session, and must not trigger the global sign-out handler.
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuthRedirect: true,
  });
}

export function logout(): Promise<{ success: boolean }> {
  return apiFetch('/auth/logout', { method: 'POST', skipAuthRedirect: true });
}

export function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me', { skipAuthRedirect: true });
}

export function metadataHealth(): Promise<MetadataHealth> {
  return apiFetch<MetadataHealth>('/metadata/health', { skipAuthRedirect: true });
}
