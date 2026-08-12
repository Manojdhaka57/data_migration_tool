/* eslint-disable @typescript-eslint/no-explicit-any --
 * Data access over node-postgres: row shapes come back untyped from the driver,
 * and configuration_json is arbitrary caller-supplied JSON by design.
 */
/**
 * Saved migration configurations and their immutable version history.
 *
 * Editing never overwrites: every save appends version N+1 and bumps
 * current_version. A run pins the exact configuration_version_id it executed, so
 * any past run can be reproduced from the configuration it actually used rather
 * than from whatever the configuration looks like today.
 */
import { appQuery, appQueryOne, withAppTransaction } from '../db';
import {
  applyConfigDefaults,
  normalizeTableMappings,
  validateConfigJson,
  configurationChecksum,
} from '../configShape';

export interface ConfigurationRecord {
  id: number;
  name: string;
  description: string | null;
  source_connection_id: number | null;
  target_connection_id: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
  current_version: number;
  created_by: string | null;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
}

export interface ConfigurationVersionRecord {
  id: number;
  configuration_id: number;
  version: number;
  configuration_json: any;
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid configuration: ${errors.join('; ')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * List configurations.
 *
 * `owner` restricts the result to what one user saved. Passing it is how the
 * API enforces that a user sees only their own work; omitting it (admins, or
 * an install with authentication turned off) returns everything.
 */
export async function listConfigurations(
  includeArchived = false,
  owner?: string | null,
): Promise<ConfigurationRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!includeArchived) conditions.push("status = 'ACTIVE'");
  if (owner) {
    params.push(owner);
    // Ownership follows created_by: the person who saved a configuration owns
    // it. updated_by deliberately does not confer ownership, or editing
    // someone else's configuration once would hand it to you.
    conditions.push(`created_by = $${params.length}`);
  }

  return appQuery<ConfigurationRecord>(
    `SELECT * FROM migration_configuration
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY updated_at DESC`,
    params,
  );
}

export async function getConfiguration(id: number): Promise<ConfigurationRecord | null> {
  return appQueryOne<ConfigurationRecord>('SELECT * FROM migration_configuration WHERE id = $1', [id]);
}

export async function getConfigurationByName(name: string): Promise<ConfigurationRecord | null> {
  return appQueryOne<ConfigurationRecord>(
    'SELECT * FROM migration_configuration WHERE lower(name) = lower($1)',
    [name],
  );
}

export async function listVersions(configurationId: number): Promise<
  Omit<ConfigurationVersionRecord, 'configuration_json'>[]
> {
  return appQuery(
    `SELECT id, configuration_id, version, note, created_by, created_at
       FROM migration_configuration_version
      WHERE configuration_id = $1
      ORDER BY version DESC`,
    [configurationId],
  );
}

export async function getVersion(
  configurationId: number,
  version: number,
): Promise<ConfigurationVersionRecord | null> {
  return appQueryOne<ConfigurationVersionRecord>(
    `SELECT * FROM migration_configuration_version
      WHERE configuration_id = $1 AND version = $2`,
    [configurationId, version],
  );
}

export async function getVersionById(versionId: number): Promise<ConfigurationVersionRecord | null> {
  return appQueryOne<ConfigurationVersionRecord>(
    'SELECT * FROM migration_configuration_version WHERE id = $1',
    [versionId],
  );
}

/** The version current_version points at. */
export async function getCurrentVersion(
  configurationId: number,
): Promise<ConfigurationVersionRecord | null> {
  return appQueryOne<ConfigurationVersionRecord>(
    `SELECT v.* FROM migration_configuration_version v
       JOIN migration_configuration c
         ON c.id = v.configuration_id AND c.current_version = v.version
      WHERE v.configuration_id = $1`,
    [configurationId],
  );
}

/**
 * Write the denormalized mapping rows for a version. The authoritative copy is
 * configuration_json; these tables exist so mappings are queryable (e.g. "which
 * configurations touch the students table?") without unpacking JSON.
 */
async function writeMappingRows(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  versionId: number,
  configJson: any,
): Promise<void> {
  const tableMappings = normalizeTableMappings(configJson);

  for (let t = 0; t < tableMappings.length; t++) {
    const tm = tableMappings[t];
    const inserted = await client.query(
      `INSERT INTO migration_table_mapping
         (configuration_version_id, source_table, target_table, mapping_type, position)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [versionId, tm.sourceTable, tm.targetTable, tm.mappingType, t],
    );
    const tableMappingId = inserted.rows[0].id;

    for (let c = 0; c < tm.columnMappings.length; c++) {
      const cm = tm.columnMappings[c];
      await client.query(
        `INSERT INTO migration_column_mapping
           (table_mapping_id, source_column, target_column, mapping_type,
            transformation_type, transformation_expression, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          tableMappingId,
          cm.source,
          cm.target,
          cm.mappingType,
          cm.transformationType,
          cm.transformationExpression,
          c,
        ],
      );
    }
  }
}

export interface SaveConfigurationInput {
  name: string;
  description?: string | null;
  sourceConnectionId?: number | null;
  targetConnectionId?: number | null;
  configuration: any;
  note?: string | null;
  /** Schemas this version was built against, so drift can be detected later. */
  sourceSchemaSnapshotId?: number | null;
  targetSchemaSnapshotId?: number | null;
}

/** Create a configuration and its version 1. */
export async function createConfiguration(
  input: SaveConfigurationInput,
  actor: string,
): Promise<{ configuration: ConfigurationRecord; version: ConfigurationVersionRecord }> {
  const configJson = applyConfigDefaults(input.configuration ?? {});
  const errors = validateConfigJson(configJson);
  if (errors.length) throw new ConfigValidationError(errors);

  return withAppTransaction(async client => {
    const configResult = await client.query(
      `INSERT INTO migration_configuration
         (name, description, source_connection_id, target_connection_id,
          current_version, created_by, updated_by)
       VALUES ($1,$2,$3,$4,1,$5,$5)
       RETURNING *`,
      [
        input.name,
        input.description ?? null,
        input.sourceConnectionId ?? null,
        input.targetConnectionId ?? null,
        actor,
      ],
    );
    const configuration: ConfigurationRecord = configResult.rows[0];

    const versionResult = await client.query(
      `INSERT INTO migration_configuration_version
         (configuration_id, version, configuration_json, note, created_by,
          source_schema_snapshot_id, target_schema_snapshot_id, checksum)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        configuration.id,
        JSON.stringify(configJson),
        input.note ?? 'Initial version',
        actor,
        input.sourceSchemaSnapshotId ?? configJson.schemaSnapshots?.sourceId ?? null,
        input.targetSchemaSnapshotId ?? configJson.schemaSnapshots?.targetId ?? null,
        configurationChecksum(configJson),
      ],
    );
    const version: ConfigurationVersionRecord = versionResult.rows[0];

    await writeMappingRows(client, version.id, configJson);
    return { configuration, version };
  });
}

/**
 * Append a new version. The previous version is left untouched — the database
 * enforces that with an append-only trigger, so history cannot be rewritten
 * even by a direct UPDATE.
 *
 * A save that changes nothing writes nothing. The incoming snapshot is hashed
 * by what it would DO (configurationChecksum → the canonical engine form plus
 * connections, tables, order and run options), so re-saving without editing —
 * or after the UI regenerated mapping UUIDs — returns the current version with
 * `created: false` instead of manufacturing an identical one.
 */
export async function createNewVersion(
  configurationId: number,
  input: {
    configuration: any;
    note?: string | null;
    description?: string | null;
    sourceConnectionId?: number | null;
    targetConnectionId?: number | null;
    sourceSchemaSnapshotId?: number | null;
    targetSchemaSnapshotId?: number | null;
    /** Save even when the snapshot is unchanged (e.g. to record a new note). */
    force?: boolean;
  },
  actor: string,
): Promise<{
  configuration: ConfigurationRecord;
  version: ConfigurationVersionRecord;
  /** False when nothing changed and no version was written. */
  created: boolean;
}> {
  const configJson = applyConfigDefaults(input.configuration ?? {});
  const errors = validateConfigJson(configJson);
  if (errors.length) throw new ConfigValidationError(errors);

  const incomingChecksum = configurationChecksum(configJson);

  return withAppTransaction(async client => {
    // Lock the row so two concurrent saves cannot claim the same version number.
    const existing = await client.query(
      'SELECT * FROM migration_configuration WHERE id = $1 FOR UPDATE',
      [configurationId],
    );
    if (existing.rows.length === 0) {
      throw new Error(`Configuration ${configurationId} not found`);
    }

    const currentVersion = existing.rows[0].current_version || 0;

    if (!input.force && currentVersion > 0) {
      const current = await client.query(
        `SELECT * FROM migration_configuration_version
          WHERE configuration_id = $1 AND version = $2`,
        [configurationId, currentVersion],
      );
      // Computed rather than read from a column so this works for versions
      // written before the checksum column existed.
      if (
        current.rows.length > 0 &&
        configurationChecksum(current.rows[0].configuration_json ?? {}) === incomingChecksum
      ) {
        return { configuration: existing.rows[0], version: current.rows[0], created: false };
      }
    }

    const nextVersion = currentVersion + 1;

    const versionResult = await client.query(
      `INSERT INTO migration_configuration_version
         (configuration_id, version, configuration_json, note, created_by,
          source_schema_snapshot_id, target_schema_snapshot_id, checksum)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        configurationId,
        nextVersion,
        JSON.stringify(configJson),
        input.note ?? null,
        actor,
        input.sourceSchemaSnapshotId ?? configJson.schemaSnapshots?.sourceId ?? null,
        input.targetSchemaSnapshotId ?? configJson.schemaSnapshots?.targetId ?? null,
        incomingChecksum,
      ],
    );
    const version: ConfigurationVersionRecord = versionResult.rows[0];

    await writeMappingRows(client, version.id, configJson);

    const configResult = await client.query(
      `UPDATE migration_configuration
          SET current_version = $2,
              description = COALESCE($3, description),
              source_connection_id = COALESCE($4, source_connection_id),
              target_connection_id = COALESCE($5, target_connection_id),
              updated_by = $6,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        configurationId,
        nextVersion,
        input.description ?? null,
        input.sourceConnectionId ?? null,
        input.targetConnectionId ?? null,
        actor,
      ],
    );

    return { configuration: configResult.rows[0], version, created: true };
  });
}

/** Copy a configuration (optionally a specific version) under a new name. */
export async function cloneConfiguration(
  configurationId: number,
  newName: string,
  actor: string,
  fromVersion?: number,
): Promise<{ configuration: ConfigurationRecord; version: ConfigurationVersionRecord }> {
  const source = await getConfiguration(configurationId);
  if (!source) throw new Error(`Configuration ${configurationId} not found`);

  const version = fromVersion
    ? await getVersion(configurationId, fromVersion)
    : await getCurrentVersion(configurationId);
  if (!version) throw new Error('Nothing to clone: the configuration has no versions');

  return createConfiguration(
    {
      name: newName,
      description: source.description,
      sourceConnectionId: source.source_connection_id,
      targetConnectionId: source.target_connection_id,
      configuration: version.configuration_json,
      note: `Cloned from "${source.name}" version ${version.version}`,
    },
    actor,
  );
}

/**
 * Archive rather than delete. Runs reference their configuration version, and
 * deleting would cascade that history away.
 */
export async function archiveConfiguration(id: number, actor: string): Promise<boolean> {
  const rows = await appQuery(
    `UPDATE migration_configuration
        SET status = 'ARCHIVED', updated_by = $2, updated_at = now()
      WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
    [id, actor],
  );
  return rows.length > 0;
}

export async function restoreConfiguration(id: number, actor: string): Promise<boolean> {
  const rows = await appQuery(
    `UPDATE migration_configuration
        SET status = 'ACTIVE', updated_by = $2, updated_at = now()
      WHERE id = $1 AND status = 'ARCHIVED' RETURNING id`,
    [id, actor],
  );
  return rows.length > 0;
}
