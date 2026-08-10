/**
 * Schema migrations for the metadata database.
 *
 * Thin wrapper around node-pg-migrate that sources the connection from the
 * APP_DB_* variables the rest of the tool uses, so there is one place to
 * configure the database rather than a separate DATABASE_URL.
 *
 *   npm run appdb:create -- add_something   create a new migration file
 *   npm run appdb:up                        apply pending migrations
 *   npm run appdb:down                      roll back the last migration
 *   npm run appdb:status                    show applied vs pending
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

function requireUrl(): string {
  const host = process.env.APP_DB_HOST?.trim().replace(/^['"]|['"]$/g, '');
  const database = process.env.APP_DB_NAME?.trim().replace(/^['"]|['"]$/g, '');
  if (!host || !database) {
    console.error(
      '\x1b[31mAPP_DB_HOST and APP_DB_NAME must be set in .env.\x1b[0m\n\n' +
      'The metadata database stores saved configurations, their version history,\n' +
      'connection credentials and run history. Example:\n\n' +
      "  APP_DB_HOST='localhost'\n  APP_DB_PORT='5432'\n  APP_DB_NAME='erp_migration_meta'\n" +
      "  APP_DB_USER='postgres'\n  APP_DB_PASSWORD='postgres'\n  APP_DB_SSL=false\n",
    );
    process.exit(1);
  }
  const strip = (v: string | undefined) => v?.trim().replace(/^['"]|['"]$/g, '');
  const user = strip(process.env.APP_DB_USER) || 'postgres';
  const password = strip(process.env.APP_DB_PASSWORD) || '';
  const port = strip(process.env.APP_DB_PORT) || '5432';
  const ssl = strip(process.env.APP_DB_SSL) === 'true' ? '?sslmode=require' : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl}`;
}

function runNodePgMigrate(args: string[]): number {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'node-pg-migrate');
  const result = spawnSync(bin, ['--migrations-dir', MIGRATIONS_DIR, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: requireUrl() },
  });
  return result.status ?? 1;
}

/**
 * node-pg-migrate has no `status` command, so read the pgmigrations table it
 * maintains and diff it against the files on disk.
 */
async function showStatus(): Promise<number> {
  const { appQuery, appQueryOne } = await import('../db');

  const onDisk = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => /\.(c?js|ts|sql)$/.test(f)).sort()
    : [];

  const tableExists = await appQueryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'pgmigrations'
     ) AS exists`,
  );

  const applied = tableExists?.exists
    ? await appQuery<{ name: string; run_on: Date }>('SELECT name, run_on FROM pgmigrations ORDER BY id')
    : [];
  const appliedNames = new Set(applied.map(a => a.name));

  console.log(`\nMigrations directory: ${MIGRATIONS_DIR}`);
  console.log(`Applied: ${applied.length} | On disk: ${onDisk.length}\n`);

  for (const file of onDisk) {
    const name = file.replace(/\.(c?js|ts|sql)$/, '');
    const isApplied = appliedNames.has(name);
    const when = applied.find(a => a.name === name)?.run_on;
    console.log(
      `  ${isApplied ? '\x1b[32m[applied]\x1b[0m' : '\x1b[33m[pending]\x1b[0m'} ${name}` +
      (when ? `   ${new Date(when).toISOString()}` : ''),
    );
  }

  // A migration recorded in the database with no matching file usually means a
  // branch switch — worth surfacing rather than silently ignoring.
  const orphaned = applied.filter(a => !onDisk.some(f => f.startsWith(a.name)));
  if (orphaned.length) {
    console.log('\n\x1b[31mApplied but missing from disk:\x1b[0m');
    orphaned.forEach(o => console.log(`  ${o.name}`));
  }
  console.log();
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'up':
      process.exit(runNodePgMigrate(['up', ...rest]));
      break;
    case 'down':
      process.exit(runNodePgMigrate(['down', ...rest]));
      break;
    case 'create': {
      if (!rest.length) {
        console.error('Usage: npm run appdb:create -- <migration_name>');
        process.exit(1);
      }
      // .cjs so the migration loads as CommonJS; package.json sets
      // "type": "module", which would otherwise make .js files ESM and
      // node-pg-migrate's require() of them fail.
      process.exit(runNodePgMigrate(['create', ...rest, '--migration-file-language', 'js']));
      break;
    }
    case 'status':
      process.exit(await showStatus());
      break;
    default:
      console.error('Usage: migrate.ts <up|down|create|status>');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
