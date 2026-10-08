require('dotenv').config();

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const databasePath = process.env.DB_PATH || path.join(__dirname, '..', 'alubarika.db');

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function recordsForImport(database) {
  return [
    {
      table: 'users',
      columns: ['id', 'username', 'email', 'password_hash', 'security_question', 'security_answer_hash', 'role', 'phone', 'address', 'profile_image', 'created_at', 'updated_at'],
      rows: database.prepare('SELECT * FROM users ORDER BY id').all().map((row) => ({
        id: row.id, username: row.username, email: row.email, password_hash: row.passwordHash,
        security_question: row.securityQuestion, security_answer_hash: row.securityAnswerHash,
        role: row.role, phone: row.phone, address: row.address, profile_image: row.profileImage,
        created_at: row.createdAt, updated_at: row.updatedAt,
      })),
    },
    {
      table: 'categories',
      columns: ['id', 'name', 'description', 'created_at', 'updated_at'],
      rows: database.prepare('SELECT * FROM categories ORDER BY id').all().map((row) => ({
        id: row.id, name: row.name, description: row.description, created_at: row.createdAt, updated_at: row.updatedAt,
      })),
    },
    {
      table: 'products',
      columns: ['id', 'name', 'description', 'price', 'discount_price', 'category_id', 'images', 'video', 'sizes', 'colors', 'stock', 'status', 'featured', 'created_at', 'updated_at'],
      rows: database.prepare('SELECT * FROM products ORDER BY id').all().map((row) => ({
        id: row.id, name: row.name, description: row.description, price: row.price, discount_price: row.discountPrice,
        category_id: row.categoryId, images: JSON.stringify(parseJson(row.images)), video: row.video,
        sizes: JSON.stringify(parseJson(row.sizes)), colors: JSON.stringify(parseJson(row.colors)), stock: row.stock,
        status: row.status, featured: Boolean(row.featured), created_at: row.createdAt, updated_at: row.updatedAt,
      })),
    },
    {
      table: 'site_settings',
      columns: ['key', 'value', 'updated_at'],
      rows: database.prepare('SELECT * FROM siteSettings ORDER BY key').all().map((row) => ({
        key: row.key, value: row.value, updated_at: row.updatedAt,
      })),
    },
    {
      table: 'orders',
      columns: ['id', 'user_id', 'total_amount', 'delivery_fee', 'status', 'address', 'phone', 'whatsapp_number', 'notes', 'created_at', 'updated_at', 'completed_at'],
      rows: database.prepare('SELECT * FROM orders ORDER BY id').all().map((row) => ({
        id: row.id, user_id: row.userId, total_amount: row.totalAmount, delivery_fee: row.deliveryFee,
        status: row.status, address: row.address, phone: row.phone, whatsapp_number: row.whatsappNumber,
        notes: row.notes, created_at: row.createdAt, updated_at: row.updatedAt, completed_at: row.completedAt,
      })),
    },
    {
      table: 'order_items',
      columns: ['id', 'order_id', 'product_id', 'quantity', 'price'],
      rows: database.prepare('SELECT * FROM orderItems ORDER BY id').all().map((row) => ({
        id: row.id, order_id: row.orderId, product_id: row.productId, quantity: row.quantity, price: row.price,
      })),
    },
  ];
}

async function importRecords() {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error('Set SUPABASE_DB_URL in your local .env before migrating data.');
  }

  const source = new DatabaseSync(databasePath);
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const reports = [];

    for (const dataset of recordsForImport(source)) {
      for (const row of dataset.rows) {
        const placeholders = dataset.columns.map((_, index) => `$${index + 1}`).join(', ');
        const updates = dataset.columns.filter((column) => column !== 'id').map((column) => `${column} = EXCLUDED.${column}`).join(', ');
        const conflict = dataset.columns.includes('id')
          ? `ON CONFLICT (id) DO UPDATE SET ${updates}`
          : `ON CONFLICT (key) DO UPDATE SET ${updates}`;
        const values = dataset.columns.map((column) => row[column]);
        await client.query(`INSERT INTO public.${dataset.table} (${dataset.columns.join(', ')}) VALUES (${placeholders}) ${conflict}`, values);
      }

      if (dataset.columns.includes('id') && dataset.rows.length) {
        await client.query(`SELECT setval(pg_get_serial_sequence('public.${dataset.table}', 'id'), (SELECT MAX(id) FROM public.${dataset.table}))`);
      }
      reports.push(`${dataset.table}: ${dataset.rows.length}`);
    }

    await client.query('COMMIT');
    console.log(`SQLite data migrated to Supabase (${reports.join(', ')}).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
    source.close();
  }
}

importRecords().catch((error) => {
  console.error(`SQLite to Supabase migration failed: ${error.message}`);
  process.exitCode = 1;
});