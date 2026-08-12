/* eslint-disable */
/**
 * Schema snapshots, so a configuration records the databases it was built
 * against — not just the mappings.
 *
 * Without this, every run re-reads the live schema and a saved configuration
 * has no way to notice that a mapped column disappeared. Pinning a snapshot to
 * a configuration version is what makes drift detection possible at all.
 *
 * Also adds `checksum` to configuration versions so "did anything actually
 * change?" is a column read rather than a rehash of ~288 KB of JSON.
 *
 * CommonJS (.cjs) on purpose — package.json sets "type": "module", so a .js
 * migration would be ESM and node-pg-migrate could not require() it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ------------------------------------------------------ schema snapshot ---
  // schema_json holds the whole DatabaseSchema. Normalizing it would mean ~918
  // rows per capture plus a bidirectional translation layer, and nothing ever
  // queries a single column — every consumer reads and writes whole schemas.
  pgm.sql(`
    CREATE TABLE schema_snapshot (
      id            SERIAL PRIMARY KEY,
      role          VARCHAR(16)  NOT NULL CHECK (role IN ('source','target')),
      connection_id INTEGER      REFERENCES db_connection(id) ON DELETE SET NULL,
      database_name VARCHAR(255) NOT NULL,
      origin        VARCHAR(32)  NOT NULL DEFAULT 'DATABASE'
                    CHECK (origin IN ('DATABASE','UPLOAD','SQL_PARSE','MANUAL','IMPORT')),
      schema_json   JSONB        NOT NULL,
      table_count   INTEGER      NOT NULL DEFAULT 0,
      column_count  INTEGER      NOT NULL DEFAULT 0,
      -- sha256 over key-sorted JSON, so re-capturing an unchanged schema
      -- reuses the existing row instead of storing another copy.
      checksum      CHAR(64)     NOT NULL,
      note          TEXT,
      created_by    VARCHAR(150),
      captured_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_schema_snapshot_lookup  ON schema_snapshot(role, checksum);
    CREATE INDEX idx_schema_snapshot_recent  ON schema_snapshot(role, captured_at DESC);
  `);

  // ------------------------------- pin snapshots to configuration versions ---
  // ON DELETE RESTRICT, deliberately NOT SET NULL: SET NULL would issue an
  // UPDATE against migration_configuration_version, which the append-only
  // trigger rejects unconditionally. Deleting a pinned snapshot would then fail
  // with a confusing "append-only" error instead of a clean FK violation.
  //
  // ADD COLUMN is safe against that trigger — it is a row-level
  // BEFORE UPDATE OR DELETE trigger, and DDL does not fire row triggers.
  pgm.sql(`
    ALTER TABLE migration_configuration_version
      ADD COLUMN source_schema_snapshot_id INTEGER REFERENCES schema_snapshot(id) ON DELETE RESTRICT,
      ADD COLUMN target_schema_snapshot_id INTEGER REFERENCES schema_snapshot(id) ON DELETE RESTRICT,
      ADD COLUMN checksum CHAR(64);

    CREATE INDEX idx_configuration_version_checksum
      ON migration_configuration_version(configuration_id, checksum);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_configuration_version_checksum;
    ALTER TABLE migration_configuration_version
      DROP COLUMN IF EXISTS source_schema_snapshot_id,
      DROP COLUMN IF EXISTS target_schema_snapshot_id,
      DROP COLUMN IF EXISTS checksum;
    DROP TABLE IF EXISTS schema_snapshot;
  `);
};
