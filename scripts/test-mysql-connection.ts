/**
 * Test MySQL Connection
 * 
 * Run: npx tsx scripts/test-mysql-connection.ts
 */

import { createPool } from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.SOURCE_DB_HOST || 'localhost',
  port: parseInt(process.env.SOURCE_DB_PORT || '3306'),
  database: process.env.SOURCE_DB_NAME || 'source_db',
  user: process.env.SOURCE_DB_USER || 'root',
  password: process.env.SOURCE_DB_PASSWORD || '',
  ssl: process.env.SOURCE_DB_SSL === 'true' ? {
    rejectUnauthorized: false,
  } : undefined,
  connectionLimit: 1,
  connectTimeout: 60000,
  timeout: 60000,
};

console.log('🔌 Testing MySQL Connection...');
console.log(`   Host: ${config.host}`);
console.log(`   Port: ${config.port}`);
console.log(`   Database: ${config.database}`);
console.log(`   User: ${config.user}`);
console.log(`   SSL: ${config.ssl ? 'enabled' : 'disabled'}`);
console.log('');

const pool = createPool(config);

async function test() {
  try {
    console.log('⏳ Attempting to connect...');
    const startTime = Date.now();
    
    const connection = await pool.getConnection();
    const connectTime = Date.now() - startTime;
    
    console.log(`✅ Connected successfully! (${connectTime}ms)`);
    
    // Test a simple query
    console.log('⏳ Testing query...');
    const [rows] = await connection.execute('SELECT 1 as test, DATABASE() as db, USER() as user');
    console.log('✅ Query successful!');
    console.log('   Result:', rows);
    
    // Get table count
    const [tables] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
    `);
    console.log('✅ Table count query successful!');
    console.log('   Tables:', tables);
    
    connection.release();
    await pool.end();
    
    console.log('');
    console.log('✅ All tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('❌ Connection failed!');
    console.error('');
    
    if (err instanceof Error) {
      console.error('Error:', err.message);
      console.error('Code:', (err as any).code);
      console.error('');
      
      // Provide helpful suggestions
      if (err.message.includes('ECONNREFUSED')) {
        console.error('💡 Suggestion: Check if MySQL server is running and host/port are correct');
      } else if (err.message.includes('ETIMEDOUT')) {
        console.error('💡 Suggestion: Connection timeout - check network/firewall settings');
      } else if (err.message.includes('ER_ACCESS_DENIED')) {
        console.error('💡 Suggestion: Check username and password in .env file');
      } else if (err.message.includes('ENOTFOUND')) {
        console.error('💡 Suggestion: Hostname not found - check DNS or use IP address');
      } else if (err.message.includes('SSL')) {
        console.error('💡 Suggestion: Try setting SOURCE_DB_SSL=false in .env file');
      }
    } else {
      console.error('Error:', String(err));
    }
    
    console.error('');
    console.error('Check your .env file:');
    console.error('  SOURCE_DB_TYPE=mysql');
    console.error('  SOURCE_DB_HOST=your-host');
    console.error('  SOURCE_DB_PORT=3306');
    console.error('  SOURCE_DB_NAME=your-database');
    console.error('  SOURCE_DB_USER=your-username');
    console.error('  SOURCE_DB_PASSWORD=your-password');
    console.error('  SOURCE_DB_SSL=false (or true for remote servers)');
    
    await pool.end();
    process.exit(1);
  }
}

test();
