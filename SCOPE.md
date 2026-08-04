# ERP Data Migration Tool — Project Scope

## 1. Project Overview

**Name:** DataMigrate (ERP Data Migration Tool)  
**Purpose:** A web-based tool to design, configure, and run database migrations from a source database (MySQL or PostgreSQL) to a target PostgreSQL database, with schema comparison, mapping, and optional data transformation.

---

## 2. In Scope

### 2.1 Schema Management
- **View and edit** source and target database schemas (tables, columns, types, PK/FK, nullable).
- **Load schemas** from JSON files or from persisted storage (e.g. localStorage).
- **Read Schema from Database:** Connect to live source and target DBs via migration server; fetch full schema; **update app schema** to source only, target only, or both.
- Schema format: database name, tables, columns with name/type/nullable/isPrimaryKey/isForeignKey/foreignKeyRef.

### 2.2 Connection & Server
- **Migration server** (Node.js HTTP API) for:
  - **Test connection:** source only, target only, or both (with optional cache/refresh).
  - **Read schema:** GET source schema, GET target schema (from live DBs).
  - **Run migration:** dry run and full migration using mapping config and (optional) target schema from frontend.
- **Supported source DBs:** MySQL/MariaDB, PostgreSQL.  
- **Target DB:** PostgreSQL only.
- Configuration via `.env` (SOURCE_DB_*, TARGET_DB_*, SOURCE_DB_TYPE, PORT).

### 2.3 Table & Column Mappings
- **Table mappings:** Link one or more source tables to one or more target tables.
- **Column mappings** with types:
  - **Direct:** One source column → one target column.
  - **Constant:** Fixed value → target column.
  - **Transform:** UPPER, LOWER, CONCAT, DATE_FORMAT, CUSTOM (with params/source columns).
- **Value conversions (MySQL → PG)** per column mapping:
  - **Date/datetime string → epoch** (Unix seconds).
  - **Tinyint (0/1) → boolean.**
- **Suggestions:** Show **unmapped source columns** and **unmapped target columns** for the active table mapping so users can complete mappings.

### 2.4 Migration Order
- Compute **dependency levels** from foreign keys (and schema).
- Display tables by level; support for generating/ordering migration steps.

### 2.5 SQL & Schema Parsing
- **SQL Analyzer:** Upload/parse SQL files (e.g. MySQL/PostgreSQL dumps); extract tables, columns, keys; option to **update** source or target schema from parsed result.

### 2.6 Auto Mapping
- **Auto-generate** table and column mappings from source and target schemas (name similarity, type compatibility, confidence scores).
- **Apply mappings** to the mapping config for further manual editing.

### 2.7 Data Transform (CSV)
- Upload **CSV**; detect multi-table structure (e.g. by “id” header rows).
- **Transform and validate** rows using current mappings; download success/failure results.

### 2.8 Run Migration (UI)
- **Test connections** (source, target, or both) from the UI.
- **Dry run** and **full migration** via migration server.
- Display **progress**, **results**, and **errors** (e.g. failed rows, duplicate key skips).
- Send **mapping config** and (optional) **target schema** from frontend to server.

### 2.9 Persistence & UX
- **Persist** source schema, target schema, and mappings (e.g. localStorage).
- **Preview** migration config (e.g. JSON) in a side panel.
- **Help guide** with step-by-step workflow (schemas, Read Schema, mappings, value conversions, suggestions, run migration).

---

## 3. Out of Scope / Limitations

- **No schema push to database:** The app does not create or alter tables in the source DB; it can create tables on the **target** (PostgreSQL) when defined in target schema and supported by the migration server.
- **No built-in user auth:** The app and migration server do not implement authentication/authorization; assume controlled access (e.g. local/trusted network or reverse proxy with auth).
- **Single target type:** Target is **PostgreSQL only** (no MySQL/SQL Server as target).
- **Transform engine:** Custom SQL or complex ETL (stored procedures, multi-step pipelines) are not part of the tool; transformations are per-column (Direct, Constant, Transform, plus date→epoch and tinyint→boolean).
- **No incremental/sync:** Focus is one-time or batch migration, not continuous replication or CDC.
- **No cloud-specific features:** No native AWS RDS, Azure, GCP wiring beyond standard MySQL/PostgreSQL connectivity.

---

## 4. Supported Database Flows

| Source        | Target      | Supported |
|---------------|------------|-----------|
| MySQL/MariaDB | PostgreSQL | Yes      |
| PostgreSQL    | PostgreSQL | Yes      |

Configuration is via environment variables; the migration server supports both source types (e.g. `SOURCE_DB_TYPE=mysql` or `postgresql`).

---

## 5. High-Level Architecture

- **Frontend:** React + Redux + MUI; Vite build. Pages: Schema, Read Schema, Table Mappings, Migration Order, SQL Analyzer, Auto Mapping, Data Transform, Run Migration.
- **Migration server:** Node.js `http` server (e.g. `migration-server.ts` or `migration-server-mysql.ts`); REST API for health, test-connection, schema read, tables, migrate/dry-run, migrate, schema/target POST, mapping config POST.
- **Data flow:** User loads or fetches schemas → defines table/column mappings (with optional value conversions) → runs dry run or migration → server reads from source, transforms (including date→epoch, tinyint→boolean where configured), writes to target.

---

## 6. Deliverables (Summary)

- Web UI for schema, mappings, order, SQL parse, auto mapping, CSV transform, and run migration.
- Read Schema from Database (fetch + update to source/target).
- Unmapped column suggestions and date/tinyint conversions in column mapping.
- Migration server with test connection, schema read, and migrate (dry run + full).
- Help guide and documentation (e.g. README, scripts/README) aligned with the above scope.

---

*This document defines the current scope of the ERP Data Migration project. Changes to scope should be reflected here.*
