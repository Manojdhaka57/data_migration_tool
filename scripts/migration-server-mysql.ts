/**
 * Migration API Server - MySQL as source only
 * Uses Node.js http.createServer (no Express).
 *
 * Usage: npx tsx scripts/migration-server-mysql.ts
 *    or: npm run migrate:server:mysql
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import mysql, { Pool as MySQLPool, PoolConnection } from "mysql2/promise";
import { Pool as PgPool, PoolClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

/* =======================
   DB CONFIG
======================= */

const mysqlPool: MySQLPool = mysql.createPool({
  host: process.env.SOURCE_DB_HOST || "localhost",
  port: Number(process.env.SOURCE_DB_PORT) || 3306,
  user: process.env.SOURCE_DB_USER || "root",
  password: process.env.SOURCE_DB_PASSWORD || "",
  database: process.env.SOURCE_DB_NAME || "source_db",
  connectionLimit: 5,
});

const pgPool: PgPool = new PgPool({
  host: process.env.TARGET_DB_HOST || "localhost",
  port: Number(process.env.TARGET_DB_PORT) || 5432,
  user: process.env.TARGET_DB_USER || "postgres",
  password: process.env.TARGET_DB_PASSWORD || "postgres",
  database: process.env.TARGET_DB_NAME || "target_db",
});

/* =======================
   TYPES
======================= */

type MysqlColumn = {
  column_name: string;
  data_type: string;
};

/** Schema format compatible with app (DatabaseSchema) */
type SchemaColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
};

type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
};

type DatabaseSchema = {
  database: string;
  tables: SchemaTable[];
};

/* =======================
   HELPERS
======================= */

const quotePg = (name: string): string => `"${name}"`;
const quoteMy = (name: string): string => `\`${name}\``;

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function getMysqlTables(): Promise<string[]> {
  const [rows]: any = await mysqlPool.query(`
     SELECT TABLE_NAME
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);
  return rows.map((r: any) => r.table_name);
}

async function getMysqlColumns(table: string): Promise<MysqlColumn[]> {
  const [rows]: any = await mysqlPool.query(
    `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
  `,
    [table]
  );
  return rows;
}

/** Get full MySQL schema (Workbench-style) from information_schema */
async function getMysqlSchema(): Promise<DatabaseSchema> {
  const [[dbRow]]: any = await mysqlPool.query("SELECT DATABASE() as db");
  const dbName = (dbRow?.db || process.env.SOURCE_DB_NAME || "source_db") as string;

  const [tableRows]: any = await mysqlPool.query(`
    SELECT TABLE_NAME
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);

  const [columnRows]: any = await mysqlPool.query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const [fkRows]: any = await mysqlPool.query(`
    SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      AND kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
    ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME
  `);

  const fkMap = new Map<string, { table: string; column: string }>();
  for (const row of fkRows || []) {
    const tbl = row.TABLE_NAME ?? row.table_name;
    const col = row.COLUMN_NAME ?? row.column_name;
    const refTbl = row.REFERENCED_TABLE_NAME ?? row.referenced_table_name;
    const refCol = row.REFERENCED_COLUMN_NAME ?? row.referenced_column_name;
    if (tbl && col && refTbl && refCol) {
      fkMap.set(`${tbl}.${col}`, { table: refTbl, column: refCol });
    }
  }

  const columnsByTable = new Map<string, any[]>();
  for (const row of columnRows || []) {
    const t = row.TABLE_NAME ?? row.table_name;
    if (!t) continue;
    if (!columnsByTable.has(t)) columnsByTable.set(t, []);
    columnsByTable.get(t)!.push(row);
  }

  const tables: SchemaTable[] = (tableRows || []).map((tr: any) => {
    const tableName = tr.TABLE_NAME ?? tr.table_name;
    const colRows = columnsByTable.get(tableName) || [];
    const columns: SchemaColumn[] = colRows.map((c: any) => {
      const colName = c.COLUMN_NAME ?? c.column_name;
      const fk = fkMap.get(`${tableName}.${colName}`);
      return {
        name: colName,
        type: c.DATA_TYPE ?? c.data_type ?? "varchar",
        nullable: (c.IS_NULLABLE ?? c.is_nullable) === "YES",
        isPrimaryKey: (c.COLUMN_KEY ?? c.column_key) === "PRI",
        isForeignKey: !!fk,
        ...(fk && { foreignKeyRef: fk }),
      };
    });
    return { name: tableName, columns };
  });

  return { database: dbName, tables };
}

function mapType(mysqlType: string): string {
  const lower = (mysqlType || "").toLowerCase().replace(/\(.*\)/, "").trim();
  const map: Record<string, string> = {
    int: "INTEGER",
    bigint: "BIGINT",
    varchar: "TEXT",
    text: "TEXT",
    datetime: "BIGINT",   // store as epoch seconds
    date: "BIGINT",       // store as epoch seconds
    timestamp: "BIGINT",  // store as epoch seconds
    tinyint: "BOOLEAN",
    json: "JSONB",
  };
  return map[lower] || "TEXT";
}

/** Convert MySQL value for migration: date/datetime/timestamp (string or Date) → epoch seconds, tinyint → boolean */
function convertValueForPg(value: unknown, dataType: string): unknown {
  if (value == null) return null;
  const type = (dataType || "").toLowerCase().replace(/\(.*\)/, "").trim();
  if (type === "tinyint") {
    const n = Number(value);
    return Number.isNaN(n) ? false : n !== 0;
  }
  if (type === "date" || type === "datetime" || type === "timestamp") {
    let date: Date;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === "string") {
      date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
    } else if (typeof value === "number") {
      date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
    } else {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }
  return value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Test result shape for source/target */
type TestConnectionResult = { success: boolean; message: string; tables?: number };

/** Test MySQL (source) connection; returns success, message, and table count */
async function testSourceConnection(): Promise<TestConnectionResult> {
  try {
    await mysqlPool.query("SELECT 1");
    const [[row]]: any = await mysqlPool.query(`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    `);
    const tables = row?.count != null ? Number(row.count) : 0;
    return {
      success: true,
      message: "Connected to source database (MySQL)",
      tables,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    return { success: false, message: msg };
  }
}

/** Test PostgreSQL (target) connection; returns success, message, and table count */
async function testTargetConnection(): Promise<TestConnectionResult> {
  try {
    await pgPool.query("SELECT 1");
    const result = await pgPool.query(`
      SELECT COUNT(*)::int as count FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tables = result.rows[0]?.count != null ? Number(result.rows[0].count) : 0;
    return {
      success: true,
      message: "Connected to target database (PostgreSQL)",
      tables,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    return { success: false, message: msg };
  }
}

/** Test both source (MySQL) and target (PostgreSQL) in parallel */
async function testBothConnections(): Promise<{ source: TestConnectionResult; target: TestConnectionResult }> {
  const [source, target] = await Promise.all([
    testSourceConnection(),
    testTargetConnection(),
  ]);
  return { source, target };
}

/* =======================
   ROUTE HANDLERS
======================= */

async function handleMigrateTable(table: string, res: ServerResponse): Promise<void> {
  const batchSize = 1000;
  const mysqlConn: PoolConnection = await mysqlPool.getConnection();
  const pgClient: PoolClient = await pgPool.connect();

  try {
    const columns = await getMysqlColumns(table);

    const createSQL = `
      CREATE TABLE IF NOT EXISTS ${quotePg(table)} (
        ${columns.map((c) => `${quotePg(c.column_name)} ${mapType(c.data_type)}`).join(",")}
      );
    `;
    await pgClient.query(createSQL);

    const [[{ count }]]: any = await mysqlConn.query(
      `SELECT COUNT(*) as count FROM ${quoteMy(table)}`
    );

    let offset = 0;
    let totalInserted = 0;

    const colTypeMap = new Map<string, string>(columns.map((c) => [c.column_name, c.data_type]));

    while (offset < count) {
      const [rows]: any[] = await mysqlConn.query(
        `SELECT * FROM ${quoteMy(table)} LIMIT ? OFFSET ?`,
        [batchSize, offset]
      );

      if (!rows.length) break;

      const cols = Object.keys(rows[0]);
      const colNames = cols.map(quotePg).join(",");
      const placeholders = rows
        .map((_: Record<string, unknown>, i: number) => `(${cols.map((_: string, j: number) => `$${i * cols.length + j + 1}`).join(",")})`)
        .join(",");

      const values = rows.flatMap((r: Record<string, unknown>) =>
        cols.map((c) => convertValueForPg(r[c], colTypeMap.get(c) ?? ""))
      );

      const insertSQL = `
        INSERT INTO ${quotePg(table)} (${colNames})
        VALUES ${placeholders}
      `;

      await pgClient.query(insertSQL, values);

      totalInserted += rows.length;
      offset += batchSize;
      console.log(`Migrated ${totalInserted}/${count} rows of ${table}`);
    }

    sendJson(res, { success: true, table, rows: totalInserted });
  } catch (err: any) {
    console.error(err);
    sendJson(res, { error: err.message }, 500);
  } finally {
    mysqlConn.release();
    pgClient.release();
  }
}

/* =======================
   HTTP SERVER
======================= */

const PORT: number = Number(process.env.PORT) || 9005;

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  try {
    if (pathname === "/api/test" && method === "GET") {
      await mysqlPool.query("SELECT 1");
      await pgPool.query("SELECT 1");
      sendJson(res, { success: true, message: "Both DB connected" });
      return;
    }

    if (pathname === "/api/test-connection/source" && method === "GET") {
      const result = await testSourceConnection();
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/test-connection/target" && method === "GET") {
      const result = await testTargetConnection();
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/test-connection/both" && method === "GET") {
      const result = await testBothConnections();
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/tables" && method === "GET") {
      const tables = await getMysqlTables();
      sendJson(res, { tables });
      return;
    }

    if ((pathname === "/api/schema" || pathname === "/api/schema/mysql") && method === "GET") {
      const schema = await getMysqlSchema();
      sendJson(res, schema);
      return;
    }

    const migrateMatch = pathname.match(/^\/api\/migrate\/([^/]+)$/);
    if (migrateMatch && method === "POST") {
      const table = migrateMatch[1];
      await handleMigrateTable(table, res);
      return;
    }

    if (pathname === "/api/health" && method === "GET") {
      sendJson(res, { status: "ok", timestamp: new Date().toISOString() });
      return;
    }

    sendJson(res, { error: "Not found" }, 404);
  } catch (err: any) {
    console.error(err);
    sendJson(res, { error: err?.message || "Server error" }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Migration server (MySQL source) on http://localhost:${PORT}`);
  console.log("   GET  /api/test                    - Test both DB connections");
  console.log("   GET  /api/test-connection/source - Test source (MySQL) only");
  console.log("   GET  /api/test-connection/target - Test target (PostgreSQL) only");
  console.log("   GET  /api/test-connection/both   - Test source + target (MySQL + PG)");
  console.log("   GET  /api/tables                 - List MySQL tables");
  console.log("   GET  /api/schema                 - Get full MySQL schema (Workbench-style)");
  console.log("   POST /api/migrate/:table         - Migrate table from MySQL to PostgreSQL");
  console.log("   GET  /api/health                 - Health check");
});
