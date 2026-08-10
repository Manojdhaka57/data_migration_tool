/* eslint-disable */
/**
 * Initial metadata schema.
 *
 * Holds the tool's own state: users and sessions, database connections with
 * credentials encrypted at rest, saved migration configurations with an
 * immutable version history, and run history with per-table results and
 * checkpoints.
 *
 * CommonJS (.cjs) on purpose — package.json sets "type": "module", so a .js
 * migration would be ESM and node-pg-migrate could not require() it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---------------------------------------------------------------- users ---
  pgm.sql(`
    CREATE TABLE app_user (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(150) NOT NULL UNIQUE,
      email         VARCHAR(255),
      password_hash TEXT NOT NULL,
      role          VARCHAR(32) NOT NULL DEFAULT 'operator'
                    CHECK (role IN ('admin', 'operator', 'viewer')),
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Only the SHA-256 of a session token is stored, so a database leak does
    -- not hand out usable sessions.
    CREATE TABLE app_session (
      token_hash   TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at   TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ
    );
    CREATE INDEX idx_app_session_user ON app_session(user_id);
    CREATE INDEX idx_app_session_expires ON app_session(expires_at);
  `);

  // ---------------------------------------------------------- connections ---
  pgm.sql(`
    CREATE TABLE db_connection (
      id                 SERIAL PRIMARY KEY,
      name               VARCHAR(150) NOT NULL UNIQUE,
      db_type            VARCHAR(32) NOT NULL
                         CHECK (db_type IN ('mysql', 'postgresql', 'hive')),
      host               VARCHAR(255) NOT NULL,
      port               INTEGER NOT NULL,
      database           VARCHAR(255) NOT NULL,
      username           VARCHAR(255),
      -- AES-256-GCM under APP_SECRET_KEY. Never plaintext, and never returned
      -- by the API.
      password_encrypted TEXT,
      ssl                BOOLEAN NOT NULL DEFAULT FALSE,
      is_active          BOOLEAN NOT NULL DEFAULT TRUE,
      created_by         VARCHAR(150),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by         VARCHAR(150),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // ------------------------------------------------------- configurations ---
  pgm.sql(`
    CREATE TABLE migration_configuration (
      id                   SERIAL PRIMARY KEY,
      name                 VARCHAR(200) NOT NULL UNIQUE,
      description          TEXT,
      source_connection_id INTEGER REFERENCES db_connection(id) ON DELETE SET NULL,
      target_connection_id INTEGER REFERENCES db_connection(id) ON DELETE SET NULL,
      status               VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      current_version      INTEGER NOT NULL DEFAULT 0,
      created_by           VARCHAR(150),
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by           VARCHAR(150),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One immutable row per saved edit. Editing a configuration appends
    -- version N+1; history is never rewritten, so any past run stays
    -- reproducible.
    CREATE TABLE migration_configuration_version (
      id                 SERIAL PRIMARY KEY,
      configuration_id   INTEGER NOT NULL REFERENCES migration_configuration(id) ON DELETE CASCADE,
      version            INTEGER NOT NULL,
      configuration_json JSONB NOT NULL,
      note               TEXT,
      created_by         VARCHAR(150),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (configuration_id, version)
    );
    CREATE INDEX idx_config_version_config ON migration_configuration_version(configuration_id);
  `);

  // Immutability enforced in the database, not just in application code — the
  // reproducibility guarantee is worth more than the convenience of an UPDATE.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION forbid_configuration_version_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Allow rows to go when their parent configuration is itself being
      -- removed (ON DELETE CASCADE): by then the parent is no longer visible.
      -- Without this exception the cascade is blocked too and a configuration
      -- could never be deleted at all.
      IF TG_OP = 'DELETE'
         AND NOT EXISTS (SELECT 1 FROM migration_configuration WHERE id = OLD.configuration_id)
      THEN
        RETURN OLD;
      END IF;

      RAISE EXCEPTION
        'migration_configuration_version is append-only: create a new version instead of modifying version % of configuration %',
        OLD.version, OLD.configuration_id;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_configuration_version_immutable
      BEFORE UPDATE OR DELETE ON migration_configuration_version
      FOR EACH ROW EXECUTE FUNCTION forbid_configuration_version_mutation();
  `);

  // --------------------------------------------------- mappings per version ---
  pgm.sql(`
    CREATE TABLE migration_table_mapping (
      id                       SERIAL PRIMARY KEY,
      configuration_version_id INTEGER NOT NULL
                               REFERENCES migration_configuration_version(id) ON DELETE CASCADE,
      source_schema            VARCHAR(150),
      source_table             VARCHAR(200) NOT NULL,
      target_schema            VARCHAR(150),
      target_table             VARCHAR(200) NOT NULL,
      mapping_type             VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
                               CHECK (mapping_type IN ('EXACT','MANUAL','PATTERN','AI_SUGGESTED','CUSTOM')),
      status                   VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      position                 INTEGER
    );
    CREATE INDEX idx_table_mapping_version ON migration_table_mapping(configuration_version_id);

    CREATE TABLE migration_column_mapping (
      id                        SERIAL PRIMARY KEY,
      table_mapping_id          INTEGER NOT NULL
                                REFERENCES migration_table_mapping(id) ON DELETE CASCADE,
      source_column             VARCHAR(200),
      target_column             VARCHAR(200) NOT NULL,
      source_data_type          VARCHAR(100),
      target_data_type          VARCHAR(100),
      mapping_type              VARCHAR(32),
      transformation_type       VARCHAR(50),
      transformation_expression TEXT,
      status                    VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      position                  INTEGER
    );
    CREATE INDEX idx_column_mapping_table ON migration_column_mapping(table_mapping_id);
  `);

  // Declared now so scripts version alongside the configuration they belong to.
  // Execution is a later phase and needs a sandbox before anything runs.
  pgm.sql(`
    CREATE TABLE migration_script (
      id                       SERIAL PRIMARY KEY,
      configuration_version_id INTEGER
                               REFERENCES migration_configuration_version(id) ON DELETE CASCADE,
      name                     VARCHAR(200) NOT NULL,
      language                 VARCHAR(32) NOT NULL DEFAULT 'javascript',
      hook                     VARCHAR(32) NOT NULL
                               CHECK (hook IN ('beforeMigration','transform','validate','afterMigration')),
      source_code              TEXT NOT NULL,
      is_active                BOOLEAN NOT NULL DEFAULT TRUE,
      created_by               VARCHAR(150),
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_script_version ON migration_script(configuration_version_id);
  `);

  // ------------------------------------------------------------ run history ---
  pgm.sql(`
    CREATE TABLE migration_run (
      id                       SERIAL PRIMARY KEY,
      configuration_id         INTEGER REFERENCES migration_configuration(id) ON DELETE SET NULL,
      -- The exact version executed. This is what makes a past run reproducible.
      configuration_version_id INTEGER REFERENCES migration_configuration_version(id) ON DELETE SET NULL,
      job_id                   VARCHAR(200),
      status                   VARCHAR(32) NOT NULL DEFAULT 'CREATED'
                               CHECK (status IN ('CREATED','VALIDATING','RUNNING','PAUSED',
                                                 'FAILED','COMPLETED','CANCELLED','PARTIALLY_COMPLETED')),
      dry_run                  BOOLEAN NOT NULL DEFAULT FALSE,
      started_at               TIMESTAMPTZ,
      completed_at             TIMESTAMPTZ,
      source_row_count         BIGINT NOT NULL DEFAULT 0,
      target_row_count         BIGINT NOT NULL DEFAULT 0,
      success_count            BIGINT NOT NULL DEFAULT 0,
      failed_count             BIGINT NOT NULL DEFAULT 0,
      skipped_count            BIGINT NOT NULL DEFAULT 0,
      error_message            TEXT,
      created_by               VARCHAR(150),
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_run_configuration ON migration_run(configuration_id);
    CREATE INDEX idx_run_job ON migration_run(job_id);

    CREATE TABLE migration_run_table (
      id                SERIAL PRIMARY KEY,
      run_id            INTEGER NOT NULL REFERENCES migration_run(id) ON DELETE CASCADE,
      source_table      VARCHAR(200),
      target_table      VARCHAR(200) NOT NULL,
      status            VARCHAR(32) NOT NULL,
      total_rows        BIGINT NOT NULL DEFAULT 0,
      success_rows      BIGINT NOT NULL DEFAULT 0,
      failed_rows       BIGINT NOT NULL DEFAULT 0,
      skipped_rows      BIGINT NOT NULL DEFAULT 0,
      duration_ms       BIGINT,
      validation_status VARCHAR(32),
      errors            JSONB,
      level             INTEGER,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (run_id, target_table)
    );

    -- Mirrors the durable Redis cursor so resume state survives a Redis flush
    -- and stays queryable alongside the rest of the run history.
    CREATE TABLE migration_checkpoint (
      id               SERIAL PRIMARY KEY,
      run_id           INTEGER NOT NULL REFERENCES migration_run(id) ON DELETE CASCADE,
      target_table     VARCHAR(200) NOT NULL,
      last_migrated_id TEXT,
      rows_done        BIGINT NOT NULL DEFAULT 0,
      status           VARCHAR(32) NOT NULL,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (run_id, target_table)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS migration_checkpoint;
    DROP TABLE IF EXISTS migration_run_table;
    DROP TABLE IF EXISTS migration_run;
    DROP TABLE IF EXISTS migration_script;
    DROP TABLE IF EXISTS migration_column_mapping;
    DROP TABLE IF EXISTS migration_table_mapping;
    DROP TRIGGER IF EXISTS trg_configuration_version_immutable ON migration_configuration_version;
    DROP FUNCTION IF EXISTS forbid_configuration_version_mutation();
    DROP TABLE IF EXISTS migration_configuration_version;
    DROP TABLE IF EXISTS migration_configuration;
    DROP TABLE IF EXISTS db_connection;
    DROP TABLE IF EXISTS app_session;
    DROP TABLE IF EXISTS app_user;
  `);
};
