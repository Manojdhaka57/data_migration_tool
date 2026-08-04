# Database Migration Script

This script connects to source and target databases and migrates data according to your mapping configuration.

**Supported Databases:**
- **Source**: PostgreSQL or MySQL/MariaDB (phpMyAdmin)
- **Target**: PostgreSQL

## Prerequisites

1. Node.js 18+ installed
2. Source database (PostgreSQL or MySQL) accessible
3. Target PostgreSQL database accessible
4. Mapping configuration in `src/data/mappingConfig.json`

## Setup

### 1. Install Dependencies

```bash
npm install
```

This will install `pg` (PostgreSQL) and `mysql2` (MySQL) drivers.

### 2. Create Environment File

Create a `.env` file in the project root with your database credentials:

#### For PostgreSQL Source Database:

```env
# Source Database Type (postgresql or mysql)
SOURCE_DB_TYPE=postgresql

# Source Database (Old Database - PostgreSQL)
SOURCE_DB_HOST=localhost
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=old_erp_database
SOURCE_DB_USER=postgres
SOURCE_DB_PASSWORD=your_password
SOURCE_DB_SSL=false

# Target Database (New Database - PostgreSQL)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=5432
TARGET_DB_NAME=new_erp_database
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=your_password
TARGET_DB_SSL=false
```

#### For MySQL Source Database (phpMyAdmin):

```env
# Source Database Type (postgresql or mysql)
SOURCE_DB_TYPE=mysql

# Source Database (Old Database - MySQL/MariaDB)
SOURCE_DB_HOST=localhost
SOURCE_DB_PORT=3306
SOURCE_DB_NAME=your_database_name
SOURCE_DB_USER=root
SOURCE_DB_PASSWORD=your_mysql_password
SOURCE_DB_SSL=false

# Target Database (New Database - PostgreSQL)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=5432
TARGET_DB_NAME=new_erp_database
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=your_password
TARGET_DB_SSL=false
```

#### For Remote MySQL Database (phpMyAdmin):

If your MySQL database is on a remote server (like a phpMyAdmin URL), use:

```env
# Source Database Type
SOURCE_DB_TYPE=mysql

# Source Database (Remote MySQL Server)
SOURCE_DB_HOST=talentedge-nonprod-erp
SOURCE_DB_PORT=3306
SOURCE_DB_NAME=stage_erppune
SOURCE_DB_USER=rohitsarode
SOURCE_DB_PASSWORD=your_password
SOURCE_DB_SSL=false

# If the hostname doesn't resolve, try with full domain:
# SOURCE_DB_HOST=talentedge-nonprod-erp.talentedge.in

# Target Database (PostgreSQL)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=5432
TARGET_DB_NAME=target_database
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=your_password
TARGET_DB_SSL=false
```

**Note:** If connection fails with hostname, try:
- Using IP address instead: `SOURCE_DB_HOST=xxx.xxx.xxx.xxx`
- Using full domain: `SOURCE_DB_HOST=talentedge-nonprod-erp.talentedge.in`
- Enabling SSL: `SOURCE_DB_SSL=true` (for remote servers)

### 2. Install Dependencies

```bash
npm install
```

## Usage

### Dry Run (Preview Only)

Test the migration without making any changes:

```bash
npm run migrate:dry-run
```

### Run Migration

Execute the full migration:

```bash
npm run migrate
```

### Migrate Specific Tables

Migrate only specific tables:

```bash
npx tsx scripts/migrate-db.ts users roles permissions
```

### Keep Foreign Key Checks

By default, FK checks are disabled during migration for performance. To keep them enabled:

```bash
npx tsx scripts/migrate-db.ts --keep-fk
```

## How It Works

1. **Loads Configuration**: Reads mapping config from `src/data/mappingConfig.json`
2. **Connects to Databases**: Establishes connections to source and target DBs
3. **Determines Migration Order**: Analyzes foreign key dependencies to determine safe migration order
4. **Disables FK Checks**: Temporarily disables foreign key constraints (optional)
5. **Migrates Data**: For each table mapping:
   - Reads all rows from source table
   - Transforms data according to column mappings
   - Inserts into target table in batches
6. **Re-enables FK Checks**: Restores foreign key constraints
7. **Generates Report**: Outputs migration results and saves to JSON file

## Column Mapping Types

The script supports three mapping types:

### DIRECT
Maps a source column directly to a target column:
```json
{
  "mappingType": "DIRECT",
  "source": { "table": "users", "column": "email" },
  "target": { "table": "User", "column": "emailAddress" }
}
```

### CONSTANT
Sets a constant value for the target column:
```json
{
  "mappingType": "CONSTANT",
  "target": { "table": "User", "column": "status" },
  "constantValue": "active"
}
```

### TRANSFORM
Applies a transformation to the source value:
```json
{
  "mappingType": "TRANSFORM",
  "source": { "table": "users", "column": "name" },
  "target": { "table": "User", "column": "fullName" },
  "transformation": { "type": "UPPER" }
}
```

Supported transformations:
- `UPPER` - Convert to uppercase
- `LOWER` - Convert to lowercase
- `TRIM` - Remove whitespace
- `DATE_FORMAT` - Format as ISO date
- `COALESCE` - Use default if null
- `CONCAT` - Concatenate multiple columns

## Output

After migration, results are saved to `migration-results-{timestamp}.json`:

```json
{
  "timestamp": "2026-01-22T10:30:00.000Z",
  "duration": 15234,
  "totalRows": 5000,
  "totalSuccess": 4998,
  "totalFailed": 2,
  "results": [
    {
      "table": "User",
      "sourceTable": "users",
      "totalRows": 1000,
      "successRows": 1000,
      "failedRows": 0,
      "errors": [],
      "duration": 2341
    }
  ]
}
```

## Troubleshooting

### Connection Refused
- Verify database host and port
- Check if PostgreSQL is running
- Ensure firewall allows connections

### Permission Denied
- Verify database user has SELECT on source DB
- Verify database user has INSERT on target DB

### Foreign Key Violation
- Run with `--keep-fk` to see which records fail
- Check if referenced records exist in target DB
- Verify migration order is correct

### Data Type Mismatch
- Check column types in source and target schemas
- Add appropriate transformations in mapping config

## Example Migration Session

```bash
# 1. First, do a dry run
npm run migrate:dry-run

# 2. If everything looks good, run the actual migration
npm run migrate

# 3. Check the results file
cat migration-results-*.json
```
