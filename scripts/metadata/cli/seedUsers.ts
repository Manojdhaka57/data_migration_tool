/**
 * Seed demo users with a shared, known password.
 *
 * For local development and for exercising the login screen and role-aware UI
 * before AUTH_ENABLED is switched on. Creates any user that is missing and
 * resets the password of any that already exists, so it is safe to re-run.
 *
 *   npm run appdb:seedusers                        (password: password123)
 *   npm run appdb:seedusers -- --password s3cret
 *
 * Refuses to run when AUTH_ENABLED is true unless --force is passed: resetting
 * every demo account's password on a system that is actually enforcing auth is
 * almost never what someone means to do.
 */
import { createUser, findUserByUsername, setUserPassword } from '../repositories/users';
import { closeAppPool, isAppDbConfigured } from '../db';
import type { UserRole } from '../auth';

const DEMO_USERS: Array<{ username: string; role: UserRole; email: string }> = [
  { username: 'admin', role: 'admin', email: 'admin@example.com' },
  { username: 'manoj', role: 'admin', email: 'manoj@example.com' },
  { username: 'operator', role: 'operator', email: 'operator@example.com' },
  { username: 'sam', role: 'operator', email: 'sam@example.com' },
  { username: 'viewer', role: 'viewer', email: 'viewer@example.com' },
  { username: 'ro', role: 'viewer', email: 'ro@example.com' },
];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

async function main() {
  if (!isAppDbConfigured()) {
    console.error(
      '\x1b[31mAPP_DB_* is not configured.\x1b[0m Set APP_DB_HOST and APP_DB_NAME in .env, ' +
        'then run `npm run appdb:up` first.',
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const password = args.password || 'password123';

  if (process.env.AUTH_ENABLED?.trim().toLowerCase() === 'true' && !args.force) {
    console.error(
      '\x1b[31mAUTH_ENABLED is true.\x1b[0m This would reset the password of every demo ' +
        'account on a system that is enforcing authentication. Re-run with --force if that ' +
        'is genuinely what you want.',
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const created: string[] = [];
  const reset: string[] = [];

  for (const demo of DEMO_USERS) {
    const existing = await findUserByUsername(demo.username);
    if (existing) {
      // Keep the role the database already has — someone may have changed it
      // deliberately, and silently overwriting that would be surprising.
      await setUserPassword(existing.id, password);
      reset.push(`${existing.username} (${existing.role})`);
    } else {
      const user = await createUser({
        username: demo.username,
        password,
        email: demo.email,
        role: demo.role,
      });
      created.push(`${user.username} (${user.role})`);
    }
  }

  if (created.length) console.log(`\x1b[32mCreated\x1b[0m  ${created.join(', ')}`);
  if (reset.length) console.log(`\x1b[33mReset\x1b[0m    ${reset.join(', ')}`);
  console.log(`\nAll of the above now sign in with the password: ${password}`);
  console.log(
    process.env.AUTH_ENABLED?.trim().toLowerCase() === 'true'
      ? '   AUTH_ENABLED is on — these accounts are live.'
      : '   AUTH_ENABLED is not "true", so the API still accepts unauthenticated calls.\n' +
        '   Login works and identifies the actor; it is not yet enforced.',
  );

  await closeAppPool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closeAppPool().catch(() => undefined);
  process.exit(1);
});
