import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { IDatabaseAdapter, InsertOptions, FailedRowDetail, InsertBatchResult } from './db.interface';
import { mapColumnType, Dialect } from './typeMap';
import { DatabaseSchema, TableStructure, TableStructureColumn } from '../types';

export class MySQLAdapter implements IDatabaseAdapter {
  private pool: Pool;

  constructor(private config: any) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionLimit: config.connectionLimit || 5,
      connectTimeout: 60000,
      dateStrings: true, // Return date columns as strings to prevent timezone shifts
    });
  }

  async connect(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.execute('SELECT 1');
    } finally {
      connection.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async getTableNames(): Promise<string[]> {
    const connection = await this.pool.getConnection();
    try {
      const [rows]: any = await connection.execute(`
        SELECT TABLE_NAME
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);
      return rows.map((r: any) => r.TABLE_NAME || r.table_name);
    } finally {
      connection.release();
    }
  }

  async getTables(): Promise<{ name: string; rowCount: number }[]> {
    const connection = await this.pool.getConnection();
    try {
      const [tableRows]: any = await connection.execute(`
        SELECT TABLE_NAME, TABLE_ROWS
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);

      const tables: { name: string; rowCount: number }[] = [];
      for (const row of tableRows) {
        const tableName = row.TABLE_NAME || row.table_name;
        let rowCount = 0;
        try {
          // MAX_EXECUTION_TIME caps the COUNT at 4s; on timeout fall back to the
          // approximate TABLE_ROWS estimate so a huge table can't hang the request.
          const [countRow]: any = await connection.execute(
            `SELECT /*+ MAX_EXECUTION_TIME(4000) */ COUNT(*) AS count FROM \`${tableName}\``
          );
          rowCount = Number(countRow[0]?.count) || 0;
        } catch {
          rowCount = Number(row.TABLE_ROWS ?? row.table_rows ?? 0);
        }
        tables.push({ name: tableName, rowCount });
      }
      return tables;
    } finally {
      connection.release();
    }
  }

  async getSchema(): Promise<DatabaseSchema> {
    const connection = await this.pool.getConnection();
    try {
      const [dbRow]: any = await connection.execute('SELECT DATABASE() as db');
      const dbName = dbRow[0]?.db || this.config.database;

      const [tableRows]: any = await connection.execute(`
        SELECT TABLE_NAME
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);

      const [columnRows]: any = await connection.execute(`
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `);

      const [fkRows]: any = await connection.execute(`
        SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE kcu
        WHERE kcu.TABLE_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
          AND kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
        ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME
      `);

      const fkMap = new Map<string, { table: string; column: string }>();
      for (const row of fkRows) {
        const tbl = row.TABLE_NAME || row.table_name;
        const col = row.COLUMN_NAME || row.column_name;
        const refTbl = row.REFERENCED_TABLE_NAME || row.referenced_table_name;
        const refCol = row.REFERENCED_COLUMN_NAME || row.referenced_column_name;
        if (tbl && col && refTbl && refCol) {
          fkMap.set(`${tbl}.${col}`, { table: refTbl, column: refCol });
        }
      }

      const columnsByTable = new Map<string, any[]>();
      for (const row of columnRows) {
        const t = row.TABLE_NAME || row.table_name;
        if (!columnsByTable.has(t)) columnsByTable.set(t, []);
        columnsByTable.get(t)!.push(row);
      }

      const tables = tableRows.map((tr: any) => {
        const tableName = tr.TABLE_NAME || tr.table_name;
        const colRows = columnsByTable.get(tableName) || [];
        const columns = colRows.map((c: any) => {
          const colName = c.COLUMN_NAME || c.column_name;
          const fk = fkMap.get(`${tableName}.${colName}`);
          return {
            name: colName,
            type: c.COLUMN_TYPE || c.DATA_TYPE || 'varchar',
            nullable: c.IS_NULLABLE === 'YES',
            isPrimaryKey: c.COLUMN_KEY === 'PRI',
            isForeignKey: !!fk,
            ...(fk && { foreignKeyRef: fk }),
          };
        });
        const primaryKeyColumns = colRows
          .filter((c: any) => c.COLUMN_KEY === 'PRI')
          .map((c: any) => c.COLUMN_NAME || c.column_name);

        return {
          name: tableName,
          columns,
          ...(primaryKeyColumns.length > 0 && { primaryKeyColumns }),
        };
      });

      return { database: dbName, tables };
    } finally {
      connection.release();
    }
  }

  async getDDL(): Promise<{ database: string; tables: { name: string; ddl: string }[] }> {
    const connection = await this.pool.getConnection();
    try {
      const [dbRow]: any = await connection.execute('SELECT DATABASE() as db');
      const dbName = dbRow[0]?.db || this.config.database;

      const [tableRows]: any = await connection.execute(`
        SELECT TABLE_NAME FROM information_schema.tables
        WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);

      const tables: { name: string; ddl: string }[] = [];
      for (const tr of tableRows) {
        const tableName = tr.TABLE_NAME || tr.table_name;
        const [createResult]: any = await connection.execute(`SHOW CREATE TABLE \`${tableName}\``);
        const ddl = createResult[0]?.[ 'Create Table' ] || createResult[0]?.Create_Table || '';
        tables.push({ name: tableName, ddl });
      }

      return { database: dbName, tables };
    } finally {
      connection.release();
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
    const connection = await this.pool.getConnection();
    const batchSize = options?.batchSize || 1000;
    const filter = options?.where ? ` AND (${options.where})` : '';
    // CUSTOM SQL transforms are computed in the source query as extra aliased columns.
    const extraSelect = (options?.selectExpressions ?? [])
      .map(e => `, (${e.expr}) AS \`${e.alias.replace(/`/g, '``')}\``)
      .join('');

    try {
      if (options?.pkColumn && (options.startId !== undefined || options.endId !== undefined)) {
        let currentId = options.startId;
        const pk = options.pkColumn;
        let hasMore = true;
        let queryLogged = false;

        while (hasMore) {
          let query = `SELECT *${extraSelect} FROM \`${tableName}\` WHERE 1=1${filter}`;
          const params: any[] = [];

          if (currentId !== undefined && currentId !== null) {
            params.push(currentId);
            query += ` AND \`${pk}\` > ?`;
          }
          if (options.endId !== undefined && options.endId !== null) {
            params.push(options.endId);
            query += ` AND \`${pk}\` <= ?`;
          }

          query += ` ORDER BY \`${pk}\` ASC LIMIT ${batchSize}`;

          if (!queryLogged) {
            console.log(`📄 [source query] ${tableName} (keyset):\n${query}`);
            queryLogged = true;
          }

          const [rows]: any = await connection.execute(query, params);
          if (rows.length === 0) {
            hasMore = false;
            break;
          }

          await onBatch(rows);

          currentId = rows[rows.length - 1][pk];
          if (rows.length < batchSize) {
            hasMore = false;
          }
        }
      } else {
        // No single-column key (or a joined query): page through with LIMIT/OFFSET using
        // the promise query API. (Raw event-streaming via connection.connection isn't
        // promise-safe here and throws "await on a query that is not a promise".)
        // Supports a custom FROM (joins) and explicit SELECT list (qualified columns).
        const selectClause = options?.selectList ?? '*';
        const fromClause = options?.fromClause ?? `\`${tableName}\``;
        const whereClause = options?.where ? ` WHERE ${options.where}` : '';
        const groupByClause = options?.groupBy ? ` GROUP BY ${options.groupBy}` : '';
        const orderByClause = options?.orderBy ? ` ORDER BY ${options.orderBy}` : '';
        console.log(`📄 [source query] ${tableName} (paged):\nSELECT ${selectClause}${extraSelect} FROM ${fromClause}${whereClause}${groupByClause}${orderByClause} LIMIT ${batchSize} OFFSET 0`);
        let offset = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const sql =
            `SELECT ${selectClause}${extraSelect} FROM ${fromClause}${whereClause}${groupByClause}${orderByClause}` +
            ` LIMIT ${batchSize} OFFSET ${offset}`;
          const [rows]: any = await connection.query(sql);
          if (!rows || rows.length === 0) break;
          await onBatch(rows);
          if (rows.length < batchSize) break;
          offset += batchSize;
        }
      }
    } finally {
      connection.release();
    }
  }

  /**
   * Build the INSERT verb + trailing clause for the chosen strategy.
   *  - skip:   INSERT IGNORE (dedup — keep existing rows)
   *  - upsert: INSERT ... ON DUPLICATE KEY UPDATE <non-pk cols> = VALUES(col)
   * When every column is part of the PK, the upsert suffix becomes a harmless
   * self-assignment so the statement still parses (behaves like IGNORE).
   */
  private buildInsertClauses(
    strategy: 'skip' | 'upsert',
    columns: string[],
    pkColumns: string[]
  ): { verb: string; suffix: string } {
    if (strategy === 'upsert') {
      const updateCols = columns.filter(c => !pkColumns.includes(c));
      const cols = updateCols.length > 0 ? updateCols : pkColumns.slice(0, 1);
      const suffix = cols.length > 0
        ? `ON DUPLICATE KEY UPDATE ${cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}`
        : '';
      return { verb: 'INSERT INTO', suffix };
    }
    return { verb: 'INSERT IGNORE INTO', suffix: '' };
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
    const { verb, suffix } = this.buildInsertClauses(strategy, columns, pkColumns);
    const colList = columns.map(c => `\`${c}\``).join(', ');

    const connection = await this.pool.getConnection();
    let inserted = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const failedRowDetails: FailedRowDetail[] = [];

    try {
      const placeholders: string[] = [];
      const values: any[] = [];

      rows.forEach((row) => {
        const rowPlaceholders = columns.map(() => '?');
        columns.forEach((col) => {
          let val = row[col];
          if (val !== null && typeof val === 'object') {
            val = JSON.stringify(val);
          }
          values.push(val);
        });
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
      });

      const insertQuery = `
        ${verb} \`${tableName}\` (${colList})
        VALUES ${placeholders.join(', ')}
        ${suffix}
      `;

      // The batch is atomic: it either lands whole or not at all. Without this a
      // crash mid-statement could leave the target holding an arbitrary prefix
      // that the resume cursor would then skip past.
      await connection.beginTransaction();
      const [result]: any = await connection.execute(insertQuery, values);
      await connection.commit();
      // ON DUPLICATE KEY UPDATE counts 2 per updated row, so clamp for reporting.
      inserted = Math.min(rows.length, result.affectedRows || 0);
      skipped = rows.length - inserted;
    } catch (err: any) {
      // Roll the failed batch back, then salvage row-by-row. Each single-row
      // insert below runs in its own implicit transaction, so good rows still
      // land and bad rows stay individually attributable.
      await connection.rollback().catch(() => undefined);
      errors.push(err.message || String(err));

      // Fallback
      for (const row of rows) {
        try {
          const rowValues = columns.map(c => {
            const val = row[c];
            return val !== null && typeof val === 'object' ? JSON.stringify(val) : val;
          });
          const rowPlaceholders = columns.map(() => '?');
          const singleQuery = `
            ${verb} \`${tableName}\` (${colList})
            VALUES (${rowPlaceholders.join(', ')})
            ${suffix}
          `;
          const [res]: any = await connection.execute(singleQuery, rowValues);
          if (res.affectedRows && res.affectedRows > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (rowErr: any) {
          failed++;
          const msg = rowErr.message || String(rowErr);
          errors.push(msg);
          // Pinpoint the offending column by matching the value quoted in the error.
          const m = msg.match(/:\s*'([\s\S]*)'\s*$/) || msg.match(/'([^']*)'/);
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
          const breakdown = columns.map(c => {
            const v = row[c];
            const sv = v === null || v === undefined ? 'NULL' : (typeof v === 'string' ? `'${v}'` : String(v));
            return `     ${c} = ${sv}${culprits.includes(c) ? '   <-- likely culprit' : ''}`;
          }).join('\n');
          console.error(
            `❌ Row insert failed on \`${tableName}\`: ${msg}` +
            (culprits.length ? `\n   Likely column(s): ${culprits.join(', ')}` : '') +
            `\n${breakdown}`
          );
        }
      }
    } finally {
      connection.release();
    }

    return {
      inserted,
      failed,
      skipped,
      errors: Array.from(new Set(errors)).slice(0, 10),
      failedRowDetails,
    };
  }

  async dropTable(tableName: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      // Disable FK checks on this connection so a referenced table can be dropped.
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      connection.release();
    }
  }

  async previewTable(tableName: string, limit: number = 50): Promise<any[]> {
    const connection = await this.pool.getConnection();
    try {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 50), 500);
      const [rows]: any = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT ${safeLimit}`);
      return rows as any[];
    } finally {
      connection.release();
    }
  }

  async getTableStructure(tableName: string): Promise<TableStructure> {
    const connection = await this.pool.getConnection();
    try {
      const [colRows]: any = await connection.execute(`
        SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA, COLUMN_DEFAULT
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [tableName]);

      if (colRows.length === 0) {
        return { tableName, exists: false, columns: [], primaryKeyColumns: [], foreignKeys: [] };
      }

      const [fkRows]: any = await connection.execute(`
        SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [tableName]);

      const fkMap = new Map<string, { table: string; column: string }>();
      const foreignKeys: any[] = [];
      for (const r of fkRows) {
        const col = r.COLUMN_NAME || r.column_name;
        const refT = r.REFERENCED_TABLE_NAME || r.referenced_table_name;
        const refC = r.REFERENCED_COLUMN_NAME || r.referenced_column_name;
        fkMap.set(col, { table: refT, column: refC });
        foreignKeys.push({ column: col, refTable: refT, refColumn: refC });
      }

      const primaryKeyColumns: string[] = [];
      const columns: TableStructureColumn[] = colRows.map((r: any) => {
        const name = r.COLUMN_NAME || r.column_name;
        const type = r.COLUMN_TYPE || r.DATA_TYPE || 'varchar';
        const nullable = r.IS_NULLABLE === 'YES';
        const isPK = r.COLUMN_KEY === 'PRI';
        const autoIncrement = /auto_increment/i.test(r.EXTRA || r.extra || '');
        const rawDefault = r.COLUMN_DEFAULT ?? r.column_default;
        const defaultValue =
          !autoIncrement && rawDefault != null ? String(rawDefault) : undefined;
        const fk = fkMap.get(name);

        if (isPK) primaryKeyColumns.push(name);

        return {
          name,
          type,
          nullable,
          isPrimaryKey: isPK,
          isForeignKey: !!fk,
          autoIncrement,
          ...(defaultValue !== undefined && { defaultValue }),
          ...(fk && { foreignKeyRef: fk }),
        };
      });

      return { tableName, exists: true, columns, primaryKeyColumns, foreignKeys };
    } finally {
      connection.release();
    }
  }

  async createTable(tableName: string, structure: TableStructure, sourceDialect: Dialect = 'mysql'): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      const hasCompositePk = structure.primaryKeyColumns.length > 1;
      const columnDefs = structure.columns.map((col) => {
        let def = `\`${col.name}\` ${mapColumnType(col.type, sourceDialect, 'mysql')}`;
        // AUTO_INCREMENT must be a key column; emit it only for a single-column PK
        // (MySQL requires the auto-increment column to be the first column of a key).
        if (col.autoIncrement && col.isPrimaryKey && !hasCompositePk) {
          def += ' AUTO_INCREMENT';
        }
        if (col.isPrimaryKey && !hasCompositePk) {
          def += ' PRIMARY KEY';
        }
        if (!col.nullable && !col.isPrimaryKey) {
          def += ' NOT NULL';
        }
        return def;
      });

      if (hasCompositePk) {
        columnDefs.push(`PRIMARY KEY (${structure.primaryKeyColumns.map(c => `\`${c}\``).join(', ')})`);
      }

      const createQuery = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n  ${columnDefs.join(',\n  ')}\n)`;
      await connection.execute(createQuery);
    } finally {
      connection.release();
    }
  }

  async addColumn(tableName: string, column: { name: string; type: string }, sourceDialect: Dialect = 'mysql'): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      const myType = mapColumnType(column.type, sourceDialect, 'mysql');
      // Always nullable — adding a NOT NULL column to a populated table would fail.
      await connection.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${column.name}\` ${myType} NULL`);
    } catch (err: any) {
      // Ignore duplicate-column so re-applying the schema is idempotent.
      if (!String(err?.message || '').toLowerCase().includes('duplicate column')) {
        throw err;
      }
    } finally {
      connection.release();
    }
  }

  async addForeignKey(
    tableName: string,
    constraintName: string,
    columnName: string,
    refTable: string,
    refColumn: string
  ): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      const alterQuery = `
        ALTER TABLE \`${tableName}\`
        ADD CONSTRAINT \`${constraintName}\`
        FOREIGN KEY (\`${columnName}\`)
        REFERENCES \`${refTable}\`(\`${refColumn}\`)
        ON DELETE NO ACTION
        ON UPDATE NO ACTION
      `;
      await connection.execute(alterQuery);
    } catch (err: any) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
    } finally {
      connection.release();
    }
  }

  async getChecksum(tableName: string, columns: string[]): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      // Dynamic column aggregation for MySQL MD5 checksum
      const sortCol = columns[0] ? `\`${columns[0]}\`` : '1';
      const colString = columns.map(c => `COALESCE(\`${c}\`, '')`).join(", ");
      
      const query = `
        SELECT MD5(GROUP_CONCAT(row_hash SEPARATOR '')) as checksum 
        FROM (
          SELECT MD5(CONCAT_WS(',', ${colString})) as row_hash 
          FROM \`${tableName}\` 
          ORDER BY ${sortCol} 
          LIMIT 50000
        ) t
      `;
      const [result]: any = await connection.execute(query);
      return result[0]?.checksum || '';
    } catch {
      return '';
    } finally {
      connection.release();
    }
  }

  async getRowCount(tableName: string, where?: string, fromClause?: string): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      const from = fromClause ?? `\`${tableName}\``;
      const countSql = `SELECT COUNT(*) as count FROM ${from}${where ? ` WHERE ${where}` : ''}`;
      console.log(`📄 [count query] ${tableName}:\n${countSql}`);
      const [rows]: any = await connection.execute(countSql);
      return rows[0]?.count || 0;
    } finally {
      connection.release();
    }
  }

  async disableConstraints(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    } finally {
      connection.release();
    }
  }

  async enableConstraints(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      connection.release();
    }
  }
}
