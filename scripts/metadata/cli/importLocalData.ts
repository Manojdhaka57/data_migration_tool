/**
 * Move the tool's local JSON data into the metadata database.
 *
 * This is the safety step before the app stops reading local files: the
 * mappings and schemas that currently live only in src/data/*.json (and in a
 * browser's localStorage, which syncs into mappingConfig.json) become a real,
 * versioned configuration with pinned schema snapshots.
 *
 * Nothing is deleted. The JSON files are read, never written, so if anything
 * goes wrong the originals are untouched.
 *
 *   npm run appdb:import-local -- --name "ERP Production Migration"
 *   npm run appdb:import-local -- --dry-run
 *   npm run appdb:import-local -- --file ~/Downloads/erp-browser-backup.json
 *
 * --file takes a backup exported from a browser's localStorage, which is the
 * newest copy of a user's mappings and exists nowhere else. It wins over the
 * files in src/data when supplied.
 *
 * Re-running is safe: schema snapshots deduplicate on content, and an
 * unchanged configuration produces no new version.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAppPool, isAppDbConfigured } from '../db';
import { captureSnapshot } from '../repositories/schemaSnapshots';
import {
  createConfiguration,
  createNewVersion,
  getConfigurationByName,
} from '../repositories/configurations';
import { SNAPSHOT_VERSION, DEFAULT_RUN_OPTIONS } from '../configShape';
import { validateDatabaseSchema } from '../schemaSnapshot';
import type { DatabaseSchema } from '../../migration/types';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/data');

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

function readJsonAt(full: string): unknown {
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`  could not parse ${full}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function readJson(file: string): unknown {
  return readJsonAt(path.join(DATA_DIR, file));
}

/**
 * A backup exported from a browser's localStorage.
 *
 * This is the rescue path: a browser's working set is the newest copy of a
 * user's mappings, and it lives nowhere else. Reading it here is what lets it
 * become a real, versioned configuration.
 */
interface BrowserBackup {
  mappings?: { tableMappings?: unknown[] } | null;
  sourceSchema?: unknown;
  targetSchema?: unknown;
  customDeps?: Array<{ from: string; to: string }> | null;
}

/** Narrow a parsed file to a DatabaseSchema, or null if it is not one. */
function asSchema(value: unknown): DatabaseSchema | null {
  if (validateDatabaseSchema(value).length > 0) return null;
  return value as DatabaseSchema;
}

function tableMappingsOf(value: unknown): unknown[] {
  const mappings = (value as { tableMappings?: unknown } | null)?.tableMappings;
  return Array.isArray(mappings) ? mappings : [];
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
  const dryRun = args['dry-run'] === 'true';
  const name = args.name || 'Imported from local data';
  const actor = args.actor || 'import';

  // A browser backup wins when given: it is the newest copy of the user's work
  // and exists nowhere else.
  const backupPath = args.file ? path.resolve(args.file) : null;
  const backup = backupPath ? (readJsonAt(backupPath) as BrowserBackup | null) : null;

  if (backupPath && !backup) {
    console.error(`\x1b[31mCould not read a backup from ${backupPath}\x1b[0m`);
    process.exit(1);
  }

  console.log(backup ? `Reading browser backup ${backupPath}\n` : `Reading local data from ${DATA_DIR}\n`);

  const tableMappings = backup
    ? tableMappingsOf(backup.mappings)
    : tableMappingsOf(readJson('mappingConfig.json'));
  // Anything that fails validation is reported rather than silently imported
  // as an unusable snapshot.
  const sourceSchema = asSchema(backup ? backup.sourceSchema : readJson('sourceSchema.json'));
  const targetSchema = asSchema(backup ? backup.targetSchema : readJson('targetSchema.json'));
  const customDependencies = Array.isArray(backup?.customDeps) ? backup.customDeps : [];

  if (tableMappings.length === 0) {
    console.error(
      `\x1b[31mNo table mappings found in ${backup ? 'the backup' : 'mappingConfig.json'} — nothing to import.\x1b[0m`,
    );
    process.exit(1);
  }

  const label = backup ? 'browser backup' : 'mappingConfig.json';
  console.log(`  ${label.padEnd(19)} ${tableMappings.length} table mappings`);
  for (const [what, schema] of [
    ['source schema', sourceSchema],
    ['target schema', targetSchema],
  ] as const) {
    console.log(
      schema
        ? `  ${what.padEnd(19)} ${schema.tables.length} tables (${schema.database})`
        : `  ${what.padEnd(19)} \x1b[33mmissing or not valid — skipping\x1b[0m`,
    );
  }
  if (customDependencies.length) {
    console.log(`  custom deps         ${customDependencies.length}`);
  }

  if (dryRun) {
    console.log(`\n\x1b[33mDry run\x1b[0m — nothing written. Would import as "${name}".`);
    await closeAppPool();
    return;
  }

  // Schemas first: the configuration pins their ids.
  let sourceSnapshotId: number | null = null;
  let targetSnapshotId: number | null = null;

  for (const [role, schema] of [
    ['source', sourceSchema],
    ['target', targetSchema],
  ] as const) {
    if (!schema) {
      console.log(`\n  no ${role} schema to capture`);
      continue;
    }
    const { snapshot, deduped } = await captureSnapshot(
      { role, schema, origin: 'IMPORT', note: `Imported from src/data/${role}Schema.json` },
      actor,
    );
    if (role === 'source') sourceSnapshotId = snapshot.id;
    else targetSnapshotId = snapshot.id;
    console.log(
      `\n  ${deduped ? 'reused' : 'captured'} ${role} schema snapshot #${snapshot.id} ` +
        `(${snapshot.table_count} tables, ${snapshot.column_count} columns)`,
    );
  }

  const configuration = {
    snapshotVersion: SNAPSHOT_VERSION,
    version: 1,
    connections: {
      // Left unset: the import cannot know which registered connection these
      // mappings were built against. Set them from the UI before running.
      source: { connectionId: null, dbType: null },
      target: { connectionId: null, dbType: null },
    },
    schemaSnapshots: { sourceId: sourceSnapshotId, targetId: targetSnapshotId },
    selectedTables: [],
    tableMappings,
    mappingOrder: [],
    customDependencies,
    runOptions: { ...DEFAULT_RUN_OPTIONS },
  };

  const existing = await getConfigurationByName(name);
  if (existing) {
    const result = await createNewVersion(
      existing.id,
      {
        configuration,
        note: 'Re-imported from local data',
        sourceSchemaSnapshotId: sourceSnapshotId,
        targetSchemaSnapshotId: targetSnapshotId,
      },
      actor,
    );
    console.log(
      result.created
        ? `\n\x1b[32mUpdated\x1b[0m "${name}" → version ${result.version.version}`
        : `\n\x1b[33mNo changes\x1b[0m — "${name}" is already at version ${result.version.version}`,
    );
  } else {
    const result = await createConfiguration(
      {
        name,
        description: 'Imported from the tool’s local JSON data',
        configuration,
        note: 'Imported from local data',
        sourceSchemaSnapshotId: sourceSnapshotId,
        targetSchemaSnapshotId: targetSnapshotId,
      },
      actor,
    );
    console.log(
      `\n\x1b[32mCreated\x1b[0m configuration #${result.configuration.id} "${name}" version 1`,
    );
  }

  console.log('\nThe local JSON files were read, not modified. Nothing was deleted.');
  await closeAppPool();
}

main().catch(async (err) => {
  console.error('\x1b[31m' + (err instanceof Error ? err.message : String(err)) + '\x1b[0m');
  if (Array.isArray((err as { errors?: string[] }).errors)) {
    for (const e of (err as { errors: string[] }).errors.slice(0, 10)) console.error('  - ' + e);
  }
  await closeAppPool().catch(() => undefined);
  process.exit(1);
});
