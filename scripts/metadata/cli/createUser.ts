/**
 * Create a user in the metadata database.
 *
 * Bootstrapping problem: with AUTH_ENABLED on, creating users requires an admin,
 * and there is no admin until one exists. This CLI is the way in — it needs
 * database access, which is a reasonable proxy for administrative authority.
 *
 *   npm run appdb:createuser -- --username admin --role admin
 *   npm run appdb:createuser -- --username sam --password s3cret --role operator
 *
 * With no --password the password is read from stdin so it never lands in shell
 * history or the process list.
 */
import * as readline from 'readline';
import { createUser, findUserByUsername, countUsers } from '../repositories/users';
import { closeAppPool, isAppDbConfigured } from '../db';
import type { UserRole } from '../auth';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdout = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void };
    let first = true;
    // Suppress echo so the password is not shown as it is typed.
    stdout._writeToOutput = function (str: string) {
      if (first) {
        stdout.write(str);
        first = false;
      }
    };
    rl.question(question, answer => {
      stdout._writeToOutput = undefined;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  if (!isAppDbConfigured()) {
    console.error(
      '\x1b[31mAPP_DB_* is not configured.\x1b[0m Set APP_DB_HOST and APP_DB_NAME in .env, ' +
      'then run `npm run appdb:up` before creating users.',
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const username = args.username || args.u;
  const role = (args.role || 'operator') as UserRole;

  if (!username) {
    console.error('Usage: npm run appdb:createuser -- --username <name> [--role admin|operator|viewer] [--email <email>]');
    process.exit(1);
  }
  if (!['admin', 'operator', 'viewer'].includes(role)) {
    console.error(`Invalid role "${role}". Expected admin, operator or viewer.`);
    process.exit(1);
  }

  if (await findUserByUsername(username)) {
    console.error(`\x1b[31mUser "${username}" already exists.\x1b[0m`);
    process.exit(1);
  }

  const password = args.password || (await promptHidden(`Password for ${username}: `));
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const isFirst = (await countUsers()) === 0;
  const user = await createUser({
    username,
    password,
    email: args.email ?? null,
    // The very first user is an admin regardless — otherwise no one could
    // administer the install.
    role: isFirst ? 'admin' : role,
  });

  console.log(`\n\x1b[32mCreated user\x1b[0m ${user.username} (id ${user.id}, role ${user.role})`);
  if (isFirst && role !== 'admin') {
    console.log('   Promoted to admin: this is the first user in the database.');
  }
  console.log(
    process.env.AUTH_ENABLED?.toLowerCase() === 'true'
      ? '   AUTH_ENABLED is on — this user can now sign in at POST /api/auth/login.'
      : '   Note: AUTH_ENABLED is not "true", so the API is not yet enforcing authentication.',
  );

  await closeAppPool();
}

main().catch(async err => {
  console.error(err instanceof Error ? err.message : String(err));
  await closeAppPool().catch(() => undefined);
  process.exit(1);
});
