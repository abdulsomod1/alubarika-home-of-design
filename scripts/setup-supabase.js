require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

async function setupSupabase() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('Set SUPABASE_DB_URL in your local .env before running this setup.');
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000, max: 1 });
  const migrationsDirectory = path.join(__dirname, '..', 'supabase', 'migrations');

  try {
    await pool.query('SELECT 1');
    await pool.query('BEGIN');
    const migrationFiles = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
    const seed = await fs.readFile(path.join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8');
    for (const file of migrationFiles) {
      await pool.query(await fs.readFile(path.join(migrationsDirectory, file), 'utf8'));
    }
    await pool.query(seed);

    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [['categories', 'order_items', 'orders', 'products', 'site_settings', 'users']]);

    if (result.rowCount !== 6) {
      throw new Error(`Expected 6 application tables, found ${result.rowCount}.`);
    }

    await pool.query('COMMIT');
    console.log(`Supabase schema ready: ${result.rows.map((row) => row.table_name).join(', ')}`);
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}

setupSupabase().catch((error) => {
  console.error(`Supabase setup failed: ${error.message}`);
  process.exitCode = 1;
});