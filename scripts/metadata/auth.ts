/**
 * User authentication for the migration API.
 *
 * Two deliberate choices, both to avoid new dependencies for security-critical
 * code:
 *
 *  - Passwords use scrypt from node:crypto rather than bcrypt. scrypt is
 *    memory-hard, is in the standard library, and needs no native build step.
 *  - Sessions are opaque random tokens stored server-side, not JWTs. They are
 *    revocable immediately (a JWT is valid until it expires no matter what),
 *    and only the SHA-256 of a token is persisted, so a database leak does not
 *    hand out live sessions.
 *
 * Enforcement is gated on AUTH_ENABLED, which defaults to OFF. The tool has
 * always been unauthenticated and the browser UI has no login screen yet;
 * turning enforcement on before that exists would lock the app out of its own
 * API. Everything needed to switch it on is in place.
 */
import * as crypto from 'crypto';
import { promisify } from 'util';
import type { Request, Response, NextFunction } from 'express';
import { appQuery, appQueryOne, isAppDbConfigured } from './db';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;
const SALT_LEN = 16;
const SESSION_TTL_HOURS = 12;

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
}

/** Roles ordered by privilege; each implies the ones below it. */
const ROLE_RANK: Record<UserRole, number> = { viewer: 1, operator: 2, admin: 3 };

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED?.trim().toLowerCase() === 'true';
}

// ---------------------------------------------------------------- passwords ---

/** Stored as scrypt$<N>$<saltBase64>$<hashBase64>. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = await scrypt(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = await scrypt(plain, salt, expected.length);

  // Constant-time compare so a wrong password cannot be narrowed by timing.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ----------------------------------------------------------------- sessions ---

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: number): Promise<SessionResult> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await appQuery(
    `INSERT INTO app_session (token_hash, user_id, expires_at, last_seen_at)
     VALUES ($1, $2, $3, now())`,
    [hashToken(token), userId, expiresAt],
  );
  return { token, expiresAt };
}

/** Resolve a raw token to its user, or null when invalid/expired/inactive. */
export async function resolveSession(token: string): Promise<AuthUser | null> {
  const user = await appQueryOne<AuthUser>(
    `SELECT u.id, u.username, u.email, u.role, u.is_active
       FROM app_session s
       JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.is_active = TRUE`,
    [hashToken(token)],
  );
  if (!user) return null;

  await appQuery('UPDATE app_session SET last_seen_at = now() WHERE token_hash = $1', [
    hashToken(token),
  ]).catch(() => undefined);

  return user;
}

export async function revokeSession(token: string): Promise<void> {
  await appQuery('DELETE FROM app_session WHERE token_hash = $1', [hashToken(token)]);
}

/** Housekeeping for expired rows; safe to call on a schedule or at startup. */
export async function purgeExpiredSessions(): Promise<number> {
  const rows = await appQuery<{ id: string }>(
    'DELETE FROM app_session WHERE expires_at < now() RETURNING token_hash AS id',
  );
  return rows.length;
}

// --------------------------------------------------------------- middleware ---

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    /** Who to attribute a write to; falls back to a header, then 'system'. */
    actor?: string;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const alt = req.headers['x-auth-token'];
  return typeof alt === 'string' && alt ? alt : null;
}

/**
 * Populates req.user when a valid token is present, without rejecting anything.
 * Always applied, so attribution works even while enforcement is off.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.actor = 'system';
  try {
    if (isAppDbConfigured()) {
      const token = bearerToken(req);
      if (token) {
        const user = await resolveSession(token);
        if (user) {
          req.user = user;
          req.actor = user.username;
        }
      }
    }
    // With auth off there is no verified identity, so X-Actor is advisory
    // labelling only — never a security decision.
    if (!req.user) {
      const declared = req.headers['x-actor'];
      if (typeof declared === 'string' && declared.trim()) {
        req.actor = declared.trim().slice(0, 150);
      }
    }
  } catch {
    // Never let an auth lookup failure take down an unauthenticated endpoint.
  }
  next();
}

/** Reject unauthenticated requests. No-op while AUTH_ENABLED is not 'true'. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) return next();

  if (!isAppDbConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'AUTH_ENABLED is true but APP_DB_* is not configured, so users cannot be verified.',
    });
  }
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

/** Require at least the given role. No-op while AUTH_ENABLED is not 'true'. */
export function requireRole(minimum: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthEnabled()) return next();
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minimum]) {
      return res.status(403).json({
        success: false,
        error: `Requires the ${minimum} role or higher (you are ${req.user.role})`,
      });
    }
    next();
  };
}
