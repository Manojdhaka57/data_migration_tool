/**
 * One-time bootstrap: create the metadata tables and the first admin user.
 *
 * This exists because the CLI path (`npm run appdb:up`) needs shell access, and
 * a hosted deploy does not always have one. It is deliberately the narrowest
 * possible endpoint, because "unauthenticated endpoint that creates an admin"
 * is otherwise a backdoor. Three guards, all of which must pass:
 *
 *  1. A setup token must match SETUP_TOKEN (or APP_SECRET_KEY when that is
 *     unset). Compared with a timing-safe equality, and refused outright when
 *     neither variable is configured — so an install that never set one cannot
 *     be bootstrapped by a stranger.
 *  2. It refuses once ANY user exists. That is what makes it one-time: after
 *     the first admin is created the endpoint can never mint another, so a
 *     leaked token later is not a route to a new admin account.
 *  3. It only ever runs migrations forward and inserts one row. There is no
 *     down-migration, no drop, no reset.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import { appDbHealth, isAppDbConfigured } from './db';
import { countUsers, createUser } from './repositories/users';
import type { UserRole } from './auth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

/** Same connection string the CLI builds, so both paths behave identically. */
function databaseUrl(): string {
  const strip = (v: string | undefined) => v?.trim().replace(/^['"]|['"]$/g, '');
  const host = strip(process.env.APP_DB_HOST);
  const database = strip(process.env.APP_DB_NAME);
  const user = strip(process.env.APP_DB_USER) || 'postgres';
  const password = strip(process.env.APP_DB_PASSWORD) || '';
  const port = strip(process.env.APP_DB_PORT) || '5432';
  const ssl = strip(process.env.APP_DB_SSL) === 'true' ? '?sslmode=require' : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl}`;
}

/** Constant-time compare so the token cannot be discovered a character at a time. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface BootstrapInput {
  token: string | undefined;
  username: string;
  password: string;
  email?: string;
  role?: UserRole;
}

export interface BootstrapResult {
  status: number;
  body: Record<string, unknown>;
}

export async function runBootstrap(input: BootstrapInput): Promise<BootstrapResult> {
  const expected = (process.env.SETUP_TOKEN || process.env.APP_SECRET_KEY || '').trim();

  // No configured secret means no bootstrap. Failing closed matters more here
  // than convenience: the alternative is an open admin-creation endpoint.
  if (!expected) {
    return {
      status: 503,
      body: {
        success: false,
        error:
          'Bootstrap is disabled: neither SETUP_TOKEN nor APP_SECRET_KEY is set. ' +
          'Set one in the environment and redeploy.',
      },
    };
  }

  if (!input.token || !tokenMatches(input.token, expected)) {
    return { status: 403, body: { success: false, error: 'Invalid setup token' } };
  }

  if (!isAppDbConfigured()) {
    return {
      status: 503,
      body: {
        success: false,
        error: 'APP_DB_HOST and APP_DB_NAME are not set, so there is no database to bootstrap.',
      },
    };
  }

  if (!input.username || !input.password) {
    return { status: 400, body: { success: false, error: 'username and password are required' } };
  }
  if (input.password.length < 8) {
    return { status: 400, body: { success: false, error: 'password must be at least 8 characters' } };
  }

  // --- 1. schema -----------------------------------------------------------
  const bin = path.join(ROOT, 'node_modules', '.bin', 'node-pg-migrate');
  const migration = spawnSync(bin, ['--migrations-dir', MIGRATIONS_DIR, 'up'], {
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    encoding: 'utf8',
  });

  if (migration.status !== 0) {
    return {
      status: 500,
      body: {
        success: false,
        error: 'Migrations failed',
        detail: (migration.stderr || migration.stdout || '').split('\n').slice(-12).join('\n'),
      },
    };
  }

  // --- 2. the first user, and only the first ------------------------------
  const existing = await countUsers();
  if (existing > 0) {
    return {
      status: 409,
      body: {
        success: false,
        error: `Refusing to create a user: ${existing} already exist. Bootstrap runs once.`,
        tablesReady: true,
        migrationOutput: (migration.stdout || '').trim().split('\n').slice(-5),
      },
    };
  }

  const user = await createUser({
    username: input.username,
    password: input.password,
    email: input.email ?? null,
    role: input.role ?? 'admin',
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Tables created and first admin user added. This endpoint will now refuse to run again.',
      user: { id: user.id, username: user.username, role: user.role },
      health: await appDbHealth(),
    },
  };
}
