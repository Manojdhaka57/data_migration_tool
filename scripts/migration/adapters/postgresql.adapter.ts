import { Pool, PoolClient } from 'pg';
import QueryStream from 'pg-query-stream';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { IDatabaseAdapter, InsertOptions, FailedRowDetail, InsertBatchResult } from './db.interface';
import { mapColumnType, portableDefault, Dialect } from './typeMap';
import { DatabaseSchema, TableStructure, TableStructureColumn } from '../types';

export class PostgreSQLAdapter implements IDatabaseAdapter {
  private pool: Pool;

  constructor(private config: any) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl === 'false' || !config.ssl ? false : { rejectUnauthorized: false },
      max: config.connectionLimit || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async getTableNames(): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);
      return result.rows.map((r) => r.table_name);
    } finally {
      client.release();
    }
  }

  async getTables(): Promise<{ name: string; rowCount: number }[]> {
    const client = await this.pool.connect();
    try {
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      // Cap each COUNT(*) so a huge table can't hang the request; on timeout fall
      // back to the approximate pg_class.reltuples estimate.
      await client.query(`SET statement_timeout = 4000`);

      const tables: { name: string; rowCount: number }[] = [];
      for (const row of tablesResult.rows) {
        let rowCount = 0;
        try {
          const countResult = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${row.table_name}"`);
          rowCount = Number(countResult.rows[0].count) || 0;
        } catch {
          try {
            const approx = await client.query(
              `SELECT GREATEST(c.reltuples, 0)::bigint AS cnt
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = $1`,
              [row.table_name]
            );
            rowCount = Number(approx.rows[0]?.cnt) || 0;
          } catch {
            rowCount = 0;
          }
        }
        tables.push({ name: row.table_name, rowCount });
      }
      return tables;
    } finally {
      try { await client.query(`SET statement_timeout = 0`); } catch { /* ignore */ }
      client.release();
    }
  }

  async getSchema(): Promise<DatabaseSchema> {
    const client = await this.pool.connect();
    try {
      const dbResult = await client.query('SELECT current_database() as db');
      const dbName = dbResult.rows[0]?.db || this.config.database;

      const tableResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);
      
      const columnResult = await client.query(`
        SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      const pkResult = await client.query(`
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.table_name, kcu.ordinal_position
      `);

      const fkResult = await client.query(`
        SELECT kcu.table_name, kcu.column_name,
               ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON rc.constraint_name = kcu.constraint_name AND rc.constraint_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON rc.unique_constraint_name = ccu.constraint_name AND rc.constraint_schema = ccu.table_schema
        WHERE rc.constraint_schema = 'public'
        ORDER BY kcu.table_name, kcu.column_name
      `);

      const pkSet = new Set<string>();
      const pkOrderByTable = new Map<string, string[]>();
      for (const row of pkResult.rows) {
        pkSet.add(`${row.table_name}.${row.column_name}`);
        if (!pkOrderByTable.has(row.table_name)) pkOrderByTable.set(row.table_name, []);
        pkOrderByTable.get(row.table_name)!.push(row.column_name);
      }

      const fkMap = new Map<string, { table: string; column: string }>();
      for (const row of fkResult.rows) {
        fkMap.set(`${row.table_name}.${row.column_name}`, {
          table: row.referenced_table_name,
          column: row.referenced_column_name,
        });
      }

      const columnsByTable = new Map<string, any[]>();
      for (const row of columnResult.rows) {
        if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, []);
        columnsByTable.get(row.table_name)!.push(row);
      }

      const tables = tableResult.rows.map((tr: any) => {
        const tableName = tr.table_name;
        const colRows = columnsByTable.get(tableName) || [];
        const columns = colRows.map((c: any) => {
          const colName = c.column_name;
          const fk = fkMap.get(`${tableName}.${colName}`);
          return {
            name: colName,
            type: this.normalizePgType(c.data_type, c.character_maximum_length),
            nullable: c.is_nullable === 'YES',
            isPrimaryKey: pkSet.has(`${tableName}.${colName}`),
            isForeignKey: !!fk,
            ...(fk && { foreignKeyRef: fk }),
          };
        });
        const primaryKeyColumns = pkOrderByTable.get(tableName);
        return {
          name: tableName,
          columns,
          ...(primaryKeyColumns && primaryKeyColumns.length > 0 && { primaryKeyColumns }),
        };
      });

      return { database: dbName, tables };
    } finally {
      client.release();
    }
  }

  async getDDL(): Promise<{ database: string; tables: { name: string; ddl: string }[] }> {
    const client = await this.pool.connect();
    try {
      const dbResult = await client.query('SELECT current_database() as db');
      const dbName = dbResult.rows[0]?.db || this.config.database;

      const tableResult = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tables: { name: string; ddl: string }[] = [];
      for (const row of tableResult.rows) {
        const structure = await this.getTableStructure(row.table_name);
        const ddl = this.generateDDLFromStructure(structure);
        tables.push({ name: row.table_name, ddl });
      }

      return { database: dbName, tables };
    } finally {
      client.release();
    }
  }

  async streamTable(
    tableName: string,
    onBatch: (rows: any[]) => Promise<void>,
    options?: {
      batchSize?: number; startId?: any; endId?: any; pkColumn?: string; where?: string;
      selectExpressions?: Array<{ expr: string; alias: string }>;
      fromClause?: string; selectList?: string;
      groupBy?: string; orderBy?: string;
    }
  ): Promise<void> {
    const client = await this.pool.connect();
    const batchSize = options?.batchSize || 1000;
    const filter = options?.where ? ` AND (${options.where})` : '';
    // CUSTOM SQL transforms are computed in the source query as extra aliased columns.
    const extraSelect = (options?.selectExpressions ?? [])
      .map(e => `, (${e.expr}) AS "${e.alias.replace(/"/g, '""')}"`)
      .join('');
    
    try {
      // Keyset pagination or dynamic streaming
      // Keyset pagination is much more resilient and has a lower memory footprint for huge tables
      if (options?.pkColumn && (options.startId !== undefined || options.endId !== undefined)) {
        let currentId = options.startId;
        const pk = options.pkColumn;
        let hasMore = true;
        let queryLogged = false;

        while (hasMore) {
          let query = `SELECT *${extraSelect} FROM "${tableName}" WHERE 1=1${filter}`;
          const params: any[] = [];

          if (currentId !== undefined && currentId !== null) {
            params.push(currentId);
            query += ` AND "${pk}" > $${params.length}`;
          }
          if (options.endId !== undefined && options.endId !== null) {
            params.push(options.endId);
            query += ` AND "${pk}" <= $${params.length}`;
          }

          query += ` ORDER BY "${pk}" ASC LIMIT ${batchSize}`;

          if (!queryLogged) {
            console.log(`📄 [source query] ${tableName} (keyset):\n${query}`);
            queryLogged = true;
          }

          const result = await client.query(query, params);
          if (result.rows.length === 0) {
            hasMore = false;
            break;
          }

          await onBatch(result.rows);
          
          currentId = result.rows[result.rows.length - 1][pk];
          if (result.rows.length < batchSize) {
            hasMore = false;
          }
        }
      } else {
        // Fallback: pg-query-stream for streaming. Supports a custom FROM (joins) and an
        // explicit SELECT list (qualified columns) for multi-table mappings.
        const selectClause = options?.selectList ?? '*';
        const fromClause = options?.fromClause ?? `"${tableName}"`;
        const groupByClause = options?.groupBy ? ` GROUP BY ${options.groupBy}` : '';
        const orderByClause = options?.orderBy ? ` ORDER BY ${options.orderBy}` : '';
        const sql =
          `SELECT ${selectClause}${extraSelect} FROM ${fromClause}` +
          `${options?.where ? ` WHERE ${options.where}` : ''}${groupByClause}${orderByClause}`;
        console.log(`📄 [source query] ${tableName} (stream):\n${sql}`);
        const query = new QueryStream(sql);
        const stream = client.query(query);
        
        let batch: any[] = [];
        
        for await (const row of stream) {
          batch.push(row);
          if (batch.length >= batchSize) {
            await onBatch(batch);
            batch = [];
          }
        }
        
        if (batch.length > 0) {
          await onBatch(batch);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Build the ON CONFLICT clause for the chosen strategy.
   *  - skip: ON CONFLICT [(pk)] DO NOTHING (dedup — leave existing rows alone)
   *  - upsert: ON CONFLICT (pk) DO UPDATE SET <non-pk cols> = EXCLUDED.<col>
   * Upsert requires a conflict target (primary/unique key). When none is known
   * we return a plain INSERT (no clause) and let the row-by-row fallback report
   * any duplicate-key errors.
   */
  private buildConflictClause(strategy: 'skip' | 'upsert', columns: string[], pkColumns: string[]): string {
    if (strategy === 'upsert') {
      if (pkColumns.length === 0) return '';
      const updateCols = columns.filter(c => !pkColumns.includes(c));
      if (updateCols.length === 0) {
        return `ON CONFLICT (${pkColumns.map(c => `"${c}"`).join(', ')}) DO NOTHING`;
      }
      const setClause = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
      return `ON CONFLICT (${pkColumns.map(c => `"${c}"`).join(', ')}) DO UPDATE SET ${setClause}`;
    }
    return pkColumns.length > 0
      ? `ON CONFLICT (${pkColumns.map(c => `"${c}"`).join(', ')}) DO NOTHING`
      : 'ON CONFLICT DO NOTHING';
  }

  async insertBatch(
    tableName: string,
    columns: string[],
    rows: any[],
    pkColumns: string[],
    options?: InsertOptions
  ): Promise<InsertBatchResult> {
    if (rows.length === 0) {
      return { inserted: 0, failed: 0, skipped: 0, errors: [] };
    }

    const strategy = options?.conflictStrategy || 'skip';
    const conflictClause = this.buildConflictClause(strategy, columns, pkColumns);

    const client = await this.pool.connect();
    let inserted = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const failedRowDetails: FailedRowDetail[] = [];

    try {
      const placeholders: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      rows.forEach((row) => {
        const rowPlaceholders: string[] = [];
        columns.forEach((col) => {
          rowPlaceholders.push(`$${paramIndex++}`);
          values.push(row[col]);
        });
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
      });

      const insertQuery = `
        INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
        VALUES ${placeholders.join(', ')}
        ${conflictClause}
      `;

      // The batch is atomic: it either lands whole or not at all. Without this a
      // crash mid-statement could leave the target holding an arbitrary prefix
      // that the resume cursor would then skip past.
      await client.query('BEGIN');
      const result = await client.query(insertQuery, values);
      await client.query('COMMIT');
      inserted = result.rowCount || 0;
      skipped = rows.length - inserted;
    } catch (err: any) {
      // Roll the failed batch back, then salvage row-by-row. Each single-row
      // insert below runs in its own implicit transaction, so good rows still
      // land and bad rows stay individually attributable.
      await client.query('ROLLBACK').catch(() => undefined);
      // Fallback: insert row-by-row to pinpoint issues and support retries
      errors.push(err.message || String(err));

      for (const row of rows) {
        try {
          const rowValues = columns.map(c => row[c]);
          const rowPlaceholders = columns.map((_, idx) => `$${idx + 1}`);

          const singleQuery = `
            INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
            VALUES (${rowPlaceholders.join(', ')})
            ${conflictClause}
          `;
          const res = await client.query(singleQuery, rowValues);
          if (res.rowCount && res.rowCount > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (rowErr: any) {
          failed++;
          const msg = rowErr.message || String(rowErr);
          errors.push(msg);
          // Pinpoint the offending column by matching the value quoted in the error
          // (e.g. invalid input syntax for type integer: "2025, 62%, ba eng").
          const m = msg.match(/:\s*"([\s\S]*)"\s*$/) || msg.match(/"([^"]*)"/);
          const badVal = m ? m[1] : null;
          const culprits = badVal !== null
            ? columns.filter(c => { const v = row[c]; return v != null && String(v) === badVal; })
            : [];
          failedRowDetails.push({
            row,
            pk: pkColumns.length
              ? Object.fromEntries(pkColumns.map(c => [c, row[c]]))
              : undefined,
            columns: culprits.length ? culprits : undefined,
            error: msg,
            timestamp: new Date().toISOString(),
          });
          // Full column = value breakdown, marking the likely culprit column(s).
          const breakdown = columns.map(c => {
            const v = row[c];
            const sv = v === null || v === undefined ? 'NULL' : (typeof v === 'string' ? `'${v}'` : String(v));
            return `     ${c} = ${sv}${culprits.includes(c) ? '   <-- likely culprit' : ''}`;
          }).join('\n');
          console.error(
            `❌ Row insert failed on "${tableName}": ${msg}` +
            (culprits.length ? `\n   Likely column(s): ${culprits.join(', ')}` : '') +
            `\n${breakdown}`
          );
        }
      }
    } finally {
      client.release();
    }

    return {
      inserted,
      failed,
      skipped,
      errors: Array.from(new Set(errors)).slice(0, 10),
      failedRowDetails,
    };
  }

  async copyBatch(
    tableName: string,
    columns: string[],
    rows: any[]
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      // Format as tab-separated values (Postgres copy format)
      // Escaping backslashes, tabs, and newlines
      const csvLines = rows.map(row => {
        return columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) {
            return '\\N'; // Postgres NULL representation
          }
          if (typeof val === 'object') {
            return JSON.stringify(val).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
          }
          return String(val).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
        }).join('\t');
      }).join('\n') + '\n';

      // Atomic like insertBatch — a partially applied COPY would leave rows the
      // resume cursor could skip past.
      await client.query('BEGIN');

      const copyStream = client.query(
        copyFrom(`COPY "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) FROM STDIN WITH NULL AS '\\N'`)
      );

      const sourceStream = Readable.from(csvLines);

      await new Promise<void>((resolve, reject) => {
        sourceStream.pipe(copyStream);
        copyStream.on('finish', resolve);
        copyStream.on('error', reject);
      });

      await client.query('COMMIT');

      // Report what the server actually accepted rather than assuming the whole
      // batch landed. pg-copy-streams exposes rowCount once the stream finishes;
      // older drivers may not, so fall back to the batch size.
      const copied = (copyStream as unknown as { rowCount?: number }).rowCount;
      return typeof copied === 'number' ? copied : rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Rethrow so the worker's existing COPY→INSERT fallback still triggers.
      throw err;
    } finally {
      client.release();
    }
  }

  async dropTable(tableName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      // CASCADE drops FK constraints in other tables that reference this one.
      await client.query(`DROP TABLE IF EXISTS "public"."${tableName}" CASCADE`);
    } finally {
      client.release();
    }
  }

  async previewTable(tableName: string, limit: number = 50): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 50), 500);
      const result = await client.query(`SELECT * FROM "${tableName}" LIMIT ${safeLimit}`);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getTableStructure(tableName: string): Promise<TableStructure> {
    const client = await this.pool.connect();
    try {
      const colResult = await client.query(`
        SELECT column_name, data_type, character_maximum_length, is_nullable,
               is_identity, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      if (colResult.rows.length === 0) {
        return { tableName, exists: false, columns: [], primaryKeyColumns: [], foreignKeys: [] };
      }

      const pkResult = await client.query(`
        SELECT kcu.column_name FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY' AND kcu.table_name = $1
        ORDER BY kcu.ordinal_position
      `, [tableName]);
      const primaryKeyColumns = pkResult.rows.map((r: any) => r.column_name);

      const fkResult = await client.query(`
        SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name AND rc.constraint_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name AND rc.constraint_schema = ccu.table_schema
        WHERE kcu.table_schema = 'public' AND kcu.table_name = $1
      `, [tableName]);

      const fkMap = new Map<string, { table: string; column: string }>();
      const foreignKeys: any[] = [];
      for (const r of fkResult.rows) {
        fkMap.set(r.column_name, { table: r.ref_table, column: r.ref_column });
        foreignKeys.push({ column: r.column_name, refTable: r.ref_table, refColumn: r.ref_column });
      }

      const columns: TableStructureColumn[] = colResult.rows.map((r: any) => {
        const name = r.column_name;
        const type = this.normalizePgType(r.data_type, r.character_maximum_length);
        const nullable = r.is_nullable === 'YES';
        // SERIAL columns carry a nextval(...) default; GENERATED AS IDENTITY columns
        // report is_identity = 'YES'. Either means the DB auto-generates the value.
        const autoIncrement =
          r.is_identity === 'YES' || /nextval\(/i.test(r.column_default || '');
        // Preserve a real default (but not the auto-increment sequence default).
        const defaultValue =
          !autoIncrement && r.column_default != null ? String(r.column_default) : undefined;
        const fk = fkMap.get(name);
        return {
          name,
          type,
          nullable,
          isPrimaryKey: primaryKeyColumns.includes(name),
          isForeignKey: !!fk,
          autoIncrement,
          ...(defaultValue !== undefined && { defaultValue }),
          ...(fk && { foreignKeyRef: fk }),
        };
      });

      return { tableName, exists: true, columns, primaryKeyColumns, foreignKeys };
    } finally {
      client.release();
    }
  }

  async createTable(tableName: string, structure: TableStructure, sourceDialect: Dialect = 'postgresql'): Promise<void> {
    const client = await this.pool.connect();
    try {
      const hasCompositePk = structure.primaryKeyColumns.length > 1;
      const columnDefs = structure.columns.map((col) => {
        let def = `"${col.name}" ${mapColumnType(col.type, sourceDialect, 'postgresql')}`;
        // BY DEFAULT (not ALWAYS) so the bulk copy can still insert explicit ids.
        // GENERATED ... AS IDENTITY implies NOT NULL, so skip the separate clause.
        if (col.autoIncrement) {
          def += ' GENERATED BY DEFAULT AS IDENTITY';
        } else {
          // Preserve the source DEFAULT so inserts that omit a NOT NULL column get
          // the default instead of failing with a not-null violation.
          const def0 = portableDefault(col.defaultValue, sourceDialect, 'postgresql');
          if (def0 != null) def += ` DEFAULT ${def0}`;
        }
        if (col.isPrimaryKey && !hasCompositePk) {
          def += ' PRIMARY KEY';
        }
        if (!col.nullable && !col.isPrimaryKey && !col.autoIncrement) {
          def += ' NOT NULL';
        }
        return def;
      });

      if (hasCompositePk) {
        columnDefs.push(`PRIMARY KEY (${structure.primaryKeyColumns.map(c => `"${c}"`).join(', ')})`);
      }

      const createQuery = `CREATE TABLE IF NOT EXISTS "public"."${tableName}" (\n  ${columnDefs.join(',\n  ')}\n)`;
      await client.query('SET search_path TO public');
      await client.query(createQuery);
    } finally {
      client.release();
    }
  }

  async addColumn(tableName: string, column: { name: string; type: string }, sourceDialect: Dialect = 'postgresql'): Promise<void> {
    const client = await this.pool.connect();
    try {
      const pgType = mapColumnType(column.type, sourceDialect, 'postgresql');
      // Always nullable — adding a NOT NULL column to a populated table would fail.
      await client.query(`ALTER TABLE "public"."${tableName}" ADD COLUMN IF NOT EXISTS "${column.name}" ${pgType}`);
    } finally {
      client.release();
    }
  }

  /**
   * Advance every identity/serial sequence in a table past its current MAX value.
   * Called after a bulk copy that inserted explicit ids — otherwise the sequence is
   * still at its start value and the application's next INSERT collides on the PK.
   */
  async resetAutoIncrement(tableName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const q = (id: string) => '"' + String(id).replace(/"/g, '""') + '"';
      const cols = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
      `, [tableName]);
      for (const r of cols.rows) {
        const col = r.column_name as string;
        try {
          await client.query(
            `SELECT setval(
                pg_get_serial_sequence($1, $2),
                (SELECT COALESCE(MAX(${q(col)}), 0) + 1 FROM "public".${q(tableName)}),
                false)`,
            [`public.${q(tableName)}`, col]
          );
        } catch {
          // Column has a default that isn't an owned sequence — nothing to advance.
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Make a column auto-generating (GENERATED BY DEFAULT AS IDENTITY) if it isn't
   * already, then advance its sequence past existing data. Used to repair tables
   * that were migrated before identity was preserved. Idempotent.
   */
  async ensureAutoIncrement(tableName: string, columnName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const q = (id: string) => '"' + String(id).replace(/"/g, '""') + '"';
      const info = await client.query(`
        SELECT is_identity, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      `, [tableName, columnName]);
      if (info.rows.length === 0) return; // column not present in target
      const row = info.rows[0];
      const alreadyAuto =
        row.is_identity === 'YES' || /nextval\(/i.test(row.column_default || '');
      if (!alreadyAuto) {
        // ADD ... AS IDENTITY requires the column to be NOT NULL with no default.
        await client
          .query(`ALTER TABLE "public".${q(tableName)} ALTER COLUMN ${q(columnName)} DROP DEFAULT`)
          .catch(() => {});
        await client.query(
          `ALTER TABLE "public".${q(tableName)} ALTER COLUMN ${q(columnName)} SET NOT NULL`
        );
        await client.query(
          `ALTER TABLE "public".${q(tableName)} ALTER COLUMN ${q(columnName)} ADD GENERATED BY DEFAULT AS IDENTITY`
        );
      }
      await client.query(
        `SELECT setval(
            pg_get_serial_sequence($1, $2),
            (SELECT COALESCE(MAX(${q(columnName)}), 0) + 1 FROM "public".${q(tableName)}),
            false)`,
        [`public.${q(tableName)}`, columnName]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Set a column's DEFAULT on an existing table. `defaultExpr` must already be a
   * valid Postgres default expression (the caller validates via portableDefault).
   */
  async ensureColumnDefault(tableName: string, columnName: string, defaultExpr: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const q = (id: string) => '"' + String(id).replace(/"/g, '""') + '"';
      await client.query(
        `ALTER TABLE "public".${q(tableName)} ALTER COLUMN ${q(columnName)} SET DEFAULT ${defaultExpr}`
      );
    } finally {
      client.release();
    }
  }

  async addForeignKey(
    tableName: string,
    constraintName: string,
    columnName: string,
    refTable: string,
    refColumn: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const alterQuery = `
        ALTER TABLE "public"."${tableName}"
        ADD CONSTRAINT "${constraintName}"
        FOREIGN KEY ("${columnName}")
        REFERENCES "public"."${refTable}"("${refColumn}")
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
      `;
      await client.query(alterQuery);
    } catch (err: any) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async getChecksum(tableName: string, columns: string[]): Promise<string> {
    const client = await this.pool.connect();
    try {
      // Dynamic column aggregation checksum
      // We sort by primary key (or first column) to ensure stable checksum
      const sortCol = columns[0] ? `"${columns[0]}"` : '1';
      const colString = columns.map(c => `coalesce("${c}"::text, '')`).join(" || ',' || ");
      
      const query = `
        SELECT md5(string_agg(row_hash, '')) as checksum 
        FROM (
          SELECT md5(${colString}) as row_hash 
          FROM "${tableName}" 
          ORDER BY ${sortCol} 
          LIMIT 50000
        ) t
      `;
      const result = await client.query(query);
      return result.rows[0]?.checksum || '';
    } catch {
      // Fallback
      return '';
    } finally {
      client.release();
    }
  }

  async getRowCount(tableName: string, where?: string, fromClause?: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      const from = fromClause ?? `"${tableName}"`;
      const countSql = `SELECT COUNT(*)::int as count FROM ${from}${where ? ` WHERE ${where}` : ''}`;
      console.log(`📄 [count query] ${tableName}:\n${countSql}`);
      const result = await client.query(countSql);
      return result.rows[0].count || 0;
    } finally {
      client.release();
    }
  }

  async disableConstraints(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SET session_replication_role = replica;');
    } finally {
      client.release();
    }
  }

  async enableConstraints(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SET session_replication_role = DEFAULT;');
    } finally {
      client.release();
    }
  }

  private normalizePgType(dataType: string | null | undefined, characterMaximumLength: number | string | null | undefined): string {
    const dt = (dataType ?? '').toLowerCase();
    const len = characterMaximumLength != null ? Number(characterMaximumLength) : null;
    if (dt === 'character varying') {
      return len != null && !Number.isNaN(len) ? `varchar(${len})` : 'varchar';
    }
    if (dt === 'character') {
      return len != null && !Number.isNaN(len) ? `char(${len})` : 'char';
    }
    if (dt === 'timestamp with time zone' || dt === 'timestamptz') return 'timestamptz';
    if (dt === 'timestamp without time zone') return 'timestamp';
    return dataType ?? 'character varying';
  }

  private mapType(type: string): string {
    let cleanType = type.trim()
      .replace(/\s+NOT\s+NULL/gi, '')
      .replace(/\s+NULL/gi, '')
      .replace(/\s+DEFAULT\s+[^,\s)]+/gi, '')
      .replace(/\s+CHECK\s+\([^)]+\)/gi, '')
      .replace(/\s+UNIQUE/gi, '')
      .replace(/\s+PRIMARY\s+KEY/gi, '')
      .trim();
    
    const typeUpper = cleanType.toUpperCase();
    if (['INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'TEXT', 'JSON', 'JSONB', 'UUID', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'INTERVAL', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION', 'BYTEA'].includes(typeUpper)) {
      return typeUpper;
    }
    if (typeUpper.startsWith('VARCHAR') || typeUpper.startsWith('CHAR') || typeUpper.startsWith('NUMERIC') || typeUpper.startsWith('DECIMAL')) {
      return typeUpper;
    }
    if (typeUpper === 'STRING') return 'TEXT';
    if (typeUpper === 'INT') return 'INTEGER';
    if (typeUpper === 'BOOL') return 'BOOLEAN';
    if (typeUpper === 'FLOAT') return 'REAL';
    if (typeUpper === 'DOUBLE') return 'DOUBLE PRECISION';
    if (typeUpper === 'DATETIME') return 'TIMESTAMP';
    if (typeUpper === 'LONG') return 'BIGINT';
    return 'TEXT';
  }

  private generateDDLFromStructure(st: TableStructure): string {
    if (!st.exists || !st.columns.length) return '';
    const quoteId = (n: string) => `"${n}"`;
    const parts: string[] = [];
    
    for (const c of st.columns) {
      const pgType = this.mapType(c.type);
      if (c.autoIncrement) {
        // Identity implies NOT NULL; don't emit a conflicting null clause.
        parts.push(`\t${quoteId(c.name)} ${pgType} GENERATED BY DEFAULT AS IDENTITY`);
        continue;
      }
      const nullClause = c.nullable ? ' NULL' : ' NOT NULL';
      parts.push(`\t${quoteId(c.name)} ${pgType}${nullClause}`);
    }
    if (st.primaryKeyColumns.length > 0) {
      parts.push(`\tCONSTRAINT "${st.tableName}_pkey" PRIMARY KEY (${st.primaryKeyColumns.map(quoteId).join(', ')})`);
    }
    for (const fk of st.foreignKeys) {
      const fkName = `fk_${st.tableName}_${fk.column}`;
      parts.push(`\tCONSTRAINT "${fkName}" FOREIGN KEY (${quoteId(fk.column)}) REFERENCES "public".${quoteId(fk.refTable)}(${quoteId(fk.refColumn)})`);
    }
    return `CREATE TABLE "public"."${st.tableName}" (\n${parts.join(',\n')}\n);`;
  }
}
