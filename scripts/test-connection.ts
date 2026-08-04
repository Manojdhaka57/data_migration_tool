/**
 * Test Database Connection Script
 * 
 * Usage: npx tsx scripts/test-connection.ts [source|target|both]
 */

import { Pool } from 'pg';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const log = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
};

async function testConnection(type: 'source' | 'target') {
  const prefix = type === 'source' ? 'SOURCE' : 'TARGET';
  
  const config = {
    host: process.env[`${prefix}_DB_HOST`] || 'localhost',
    port: parseInt(process.env[`${prefix}_DB_PORT`] || '5432'),
    database: process.env[`${prefix}_DB_NAME`] || 'postgres',
    user: process.env[`${prefix}_DB_USER`] || 'postgres',
    password: process.env[`${prefix}_DB_PASSWORD`] || 'password',
    ssl: process.env[`${prefix}_DB_SSL`] === 'false' ? false : {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 10000,
  };

  log.info(`Testing ${type} database connection...`);
  log.info(`  Host: ${config.host}:${config.port}`);
  log.info(`  Database: ${config.database}`);
  log.info(`  User: ${config.user}`);
  log.info(`  SSL: ${config.ssl ? 'enabled' : 'disabled'}`);

  const pool = new Pool(config);

  try {
    const client = await pool.connect();
    
    // Get version
    const versionResult = await client.query('SELECT version()');
    log.success(`Connected to ${type} database!`);
    log.info(`  PostgreSQL: ${versionResult.rows[0].version.split(',')[0]}`);
    
    // List tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    log.info(`  Tables found: ${tablesResult.rows.length}`);
    
    if (tablesResult.rows.length > 0 && tablesResult.rows.length <= 20) {
      tablesResult.rows.forEach(row => {
        console.log(`    - ${row.table_name}`);
      });
    } else if (tablesResult.rows.length > 20) {
      tablesResult.rows.slice(0, 10).forEach(row => {
        console.log(`    - ${row.table_name}`);
      });
      console.log(`    ... and ${tablesResult.rows.length - 10} more tables`);
    }
    
    client.release();
    await pool.end();
    return true;
    
  } catch (err) {
    log.error(`Failed to connect to ${type} database`);
    log.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    return false;
  }
}

async function main() {
  const arg = process.argv[2] || 'source';
  
  console.log('\n='.repeat(60));
  console.log('Database Connection Test');
  console.log('='.repeat(60) + '\n');
  
  if (arg === 'source' || arg === 'both') {
    await testConnection('source');
    console.log('');
  }
  
  if (arg === 'target' || arg === 'both') {
    await testConnection('target');
    console.log('');
  }
  
  console.log('='.repeat(60));
}

main();
