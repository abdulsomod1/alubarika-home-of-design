require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { computeDashboardMetrics } = require('./business');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORT = process.env.PORT || 3000;
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const publicDir = path.join(__dirname, '..', 'public');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in your local .env.');
}

fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const baseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const extensionsByType = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, uploadsDir),
    filename: (req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extensionsByType[file.mimetype] || '.bin'}`),
  }),
  limits: { files: 20, fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!extensionsByType[file.mimetype]) return callback(new Error('Use JPG, PNG, WEBP, GIF, MP4, or WEBM files.'));
    callback(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (!process.env.NETLIFY) return next();

  const functionPrefix = '/.netlify/functions/api';
  if (req.path.startsWith(functionPrefix)) {
    req.url = `/api${req.url.slice(functionPrefix.length)}`;
  } else if (!req.path.startsWith('/api/')) {
    req.url = `/api${req.url}`;
  }
  next();
});
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

function clientForToken(token) {
  if (!token) return baseClient;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function failOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

function apiUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    username: row.username,
    email: row.email,
    role: row.role,
    phone: row.phone,
    address: row.address,
    profileImage: row.profile_image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function apiProduct(row) {
  if (!row) return null;
  return {
    ...row,
    categoryId: row.category_id,
    categoryName: row.category?.name || row.category_name || null,
    discountPrice: Number(row.discount_price || 0),
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    featured: Boolean(row.featured),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function apiOrderItem(row) {
  return {
    ...row,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product?.name || row.product_name || row.productName,
    productImage: row.product?.images || row.product_image || row.productImage,
  };
}

function apiOrder(row) {
  if (!row) return null;
  return {
    ...row,
    userId: row.user_id,
    totalAmount: Number(row.total_amount || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    whatsappNumber: row.whatsapp_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    user: row.user ? apiUser(row.user) : undefined,
    items: Array.isArray(row.items) ? row.items.map(apiOrderItem) : undefined,
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function getProfile(client, authUserId) {
  const { data, error } = await client.from('users').select('*').eq('auth_user_id', authUserId).single();
  if (error) throw error;
  return data;
}

async function optionalAuth(req, res, next) {
  const token = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.headers['x-auth-token'];
  req.supabase = clientForToken(token);
  req.accessToken = token || null;
  if (!token) return next();

  try {
    const { data, error } = await req.supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ message: 'Invalid or expired Supabase session.' });
    req.authUser = data.user;
    req.profile = await getProfile(req.supabase, data.user.id);
    req.user = apiUser(req.profile);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.authUser || !req.profile) return res.status(401).json({ message: 'Authentication required.' });
  next();
}

function requireStaff(req, res, next) {
  if (!req.profile || !['staff', 'admin'].includes(req.profile.role)) {
    return res.status(403).json({ message: 'Staff access required.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.profile || req.profile.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' });
  next();
}

app.use('/api', optionalAuth);

app.get('/api/health', asyncRoute(async (req, res) => {
  const { error } = await req.supabase.from('site_settings').select('key').limit(1);
  if (error) return res.status(503).json({ ok: false, message: 'Supabase is unreachable or the schema is not installed.' });
  res.json({ ok: true, message: 'Alubarika API is connected to Supabase.' });
}));

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const { username, email, password, confirmPassword } = req.body || {};
  if (!username || !email || !password || !confirmPassword) return res.status(400).json({ message: 'Username, email, and password are required.' });
  if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });
  if (String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters long.' });

  const { data, error } = await baseClient.auth.signUp({
    email: String(email).trim().toLowerCase(),
    password,
    options: { data: { username: String(username).trim() } },
  });
  if (error) return res.status(400).json({ message: error.message });
  if (!data.session) {
    return res.status(202).json({ message: 'Check your email to confirm your new account before signing in.', requiresEmailConfirmation: true });
  }

  const profile = await getProfile(clientForToken(data.session.access_token), data.user.id);
  res.status(201).json({ message: 'Account created successfully.', token: data.session.access_token, refreshToken: data.session.refresh_token, user: apiUser(profile) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { usernameOrEmail, password } = req.body || {};
  if (!usernameOrEmail || !password) return res.status(400).json({ message: 'Email and password are required.' });
  const email = String(usernameOrEmail).trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ message: 'Sign in with the email address on your account.' });

  const { data, error } = await baseClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) return res.status(401).json({ message: error?.message || 'Unable to sign in.' });
  try {
    const profile = await getProfile(clientForToken(data.session.access_token), data.user.id);
    res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, user: apiUser(profile) });
  } catch (profileError) {
    await baseClient.auth.signOut({ scope: 'local' });
    throw profileError;
  }
}));

app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token is required.' });
  const { data, error } = await baseClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ message: 'Session expired. Please sign in again.' });
  const profile = await getProfile(clientForToken(data.session.access_token), data.user.id);
  res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, user: apiUser(profile) });
}));

app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email is required.' });
  const redirectTo = process.env.PASSWORD_RESET_REDIRECT || `${req.protocol}://${req.get('host')}/#auth`;
  const { error } = await baseClient.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo });
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'If an account uses that email, a password reset link has been sent.' });
}));

app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { newPassword, confirmPassword, refreshToken } = req.body || {};
  if (!newPassword || newPassword !== confirmPassword) return res.status(400).json({ message: 'New passwords are required and must match.' });
  if (String(newPassword).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  if (!refreshToken) return res.status(400).json({ message: 'Password recovery session is missing. Open the reset link from your email again.' });

  const recoveryClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: sessionError } = await recoveryClient.auth.setSession({ access_token: req.accessToken, refresh_token: refreshToken });
  if (sessionError) return res.status(401).json({ message: 'Password recovery session expired. Request a new reset link.' });
  const { error } = await recoveryClient.auth.updateUser({ password: newPassword });
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Password updated successfully.' });
}));

app.get('/api/categories', asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('categories').select('*').order('name'));
  res.json(data.map((row) => ({ ...row, createdAt: row.created_at, updatedAt: row.updated_at })));
}));

app.post('/api/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Category name is required.' });
  const data = failOnError(await req.supabase.from('categories').insert({ name: String(name).trim(), description: description || '' }).select().single());
  res.status(201).json(data);
}));

app.put('/api/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const { name, description } = req.body || {};
  const data = failOnError(await req.supabase.from('categories').update({ name, description, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single());
  res.json(data);
}));

app.delete('/api/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  failOnError(await req.supabase.from('categories').delete().eq('id', req.params.id));
  res.json({ message: 'Category deleted.' });
}));

app.get('/api/settings', asyncRoute(async (req, res) => {
  const rows = failOnError(await req.supabase.from('site_settings').select('key,value'));
  res.json(Object.fromEntries(rows.map(({ key, value }) => [key, value])));
}));

app.put('/api/admin/settings', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const allowedKeys = ['heroImage', 'logoImage'];
  const rows = allowedKeys.filter((key) => typeof req.body?.[key] === 'string').map((key) => ({ key, value: req.body[key].trim(), updated_at: new Date().toISOString() }));
  if (rows.length) failOnError(await req.supabase.from('site_settings').upsert(rows, { onConflict: 'key' }));
  const settings = failOnError(await req.supabase.from('site_settings').select('key,value'));
  res.json(Object.fromEntries(settings.map(({ key, value }) => [key, value])));
}));

app.get('/api/products', asyncRoute(async (req, res) => {
  let query = req.supabase.from('products').select('*, category:categories(name)');
  if (!req.profile || !['admin', 'staff'].includes(req.profile.role)) query = query.eq('status', 'published');
  const { search, category, minPrice, maxPrice, available, sort } = req.query;
  if (search) query = query.or(`name.ilike.%${String(search).replace(/[(),]/g, '')}%,description.ilike.%${String(search).replace(/[(),]/g, '')}%`);
  if (category) {
    const categoryRow = failOnError(await req.supabase.from('categories').select('id').eq('name', category).single());
    query = query.eq('category_id', categoryRow.id);
  }
  if (minPrice) query = query.gte('price', Number(minPrice));
  if (maxPrice) query = query.lte('price', Number(maxPrice));
  if (available === 'true') query = query.gt('stock', 0);
  const order = sort === 'low-high' ? { column: 'price', ascending: true } : sort === 'high-low' ? { column: 'price', ascending: false } : { column: 'created_at', ascending: false };
  const data = failOnError(await query.order(order.column, { ascending: order.ascending }));
  res.json(data.map(apiProduct));
}));

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('products').select('*, category:categories(name)').eq('id', req.params.id).single());
  res.json(apiProduct(data));
}));

app.post('/api/uploads', requireAuth, requireStaff, (req, res, next) => {
  upload.array('files', 20)(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message });
    (async () => {
      try {
        const media = await Promise.all((req.files || []).map(async (file) => {
          const bytes = await fs.promises.readFile(file.path);
          const storagePath = `${req.profile.id}/${file.filename}`;
          const { error: uploadError } = await req.supabase.storage
            .from('product-media')
            .upload(storagePath, bytes, { contentType: file.mimetype, upsert: false });
          if (uploadError) throw uploadError;
          const { data } = req.supabase.storage.from('product-media').getPublicUrl(storagePath);
          return { url: data.publicUrl, mimeType: file.mimetype, originalName: file.originalname };
        }));
        await Promise.all((req.files || []).map((file) => fs.promises.unlink(file.path).catch(() => {})));
        res.status(201).json({ files: media.map((file) => file.url), media });
      } catch (uploadError) {
        await Promise.all((req.files || []).map((file) => fs.promises.unlink(file.path).catch(() => {})));
        next(uploadError);
      }
    })();
  });
});

function productPayload(body) {
  return {
    name: String(body.name || '').trim(),
    description: body.description || '',
    price: Number(body.price),
    discount_price: Number(body.discountPrice || 0),
    category_id: Number(body.categoryId),
    images: Array.isArray(body.images) ? body.images : [],
    video: body.video || '',
    sizes: Array.isArray(body.sizes) ? body.sizes : [],
    colors: Array.isArray(body.colors) ? body.colors : [],
    stock: Number(body.stock || 0),
    status: body.status === 'published' ? 'published' : 'draft',
    featured: Boolean(body.featured),
    updated_at: new Date().toISOString(),
  };
}

app.post('/api/products', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const payload = productPayload(req.body || {});
  if (!payload.name || !payload.price || !payload.category_id) return res.status(400).json({ message: 'Product name, price and category are required.' });
  const data = failOnError(await req.supabase.from('products').insert(payload).select('*, category:categories(name)').single());
  res.status(201).json(apiProduct(data));
}));

app.put('/api/products/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const payload = productPayload(req.body || {});
  const data = failOnError(await req.supabase.from('products').update(payload).eq('id', req.params.id).select('*, category:categories(name)').single());
  res.json(apiProduct(data));
}));

app.delete('/api/products/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  failOnError(await req.supabase.from('products').delete().eq('id', req.params.id));
  res.json({ message: 'Product deleted.' });
}));

app.get('/api/users/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.put('/api/users/me', requireAuth, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const update = {
    username: body.username ? String(body.username).trim() : req.profile.username,
    email: body.email ? String(body.email).trim().toLowerCase() : req.profile.email,
    phone: body.phone ?? req.profile.phone,
    address: body.address ?? req.profile.address,
    profile_image: body.profileImage ?? req.profile.profile_image,
    updated_at: new Date().toISOString(),
  };
  const data = failOnError(await req.supabase.from('users').update(update).eq('auth_user_id', req.authUser.id).select().single());
  res.json({ user: apiUser(data) });
}));

app.post('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const { items, address, phone, whatsappNumber, notes } = req.body || {};
  const data = failOnError(await req.supabase.rpc('create_store_order', {
    p_items: items,
    p_address: address || null,
    p_phone: phone || null,
    p_whatsapp_number: whatsappNumber || null,
    p_notes: notes || '',
  }));
  res.status(201).json({ order: apiOrder(data.order), items: (data.items || []).map(apiOrderItem) });
}));

const orderSelect = '*, user:users!orders_user_id_fkey(id,auth_user_id,username,email,role,phone,address,profile_image,created_at,updated_at), items:order_items(*, product:products(name,images))';

app.get('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  if (['admin', 'staff'].includes(req.profile.role)) {
    const data = failOnError(await req.supabase.rpc('list_store_orders', { p_order_id: null }));
    return res.json(data.map(apiOrder));
  }
  const data = failOnError(await req.supabase.from('orders').select(orderSelect).order('created_at', { ascending: false }));
  res.json(data.map(apiOrder));
}));

app.get('/api/orders/:id', requireAuth, asyncRoute(async (req, res) => {
  if (['admin', 'staff'].includes(req.profile.role)) {
    const data = failOnError(await req.supabase.rpc('list_store_orders', { p_order_id: req.params.id }));
    if (!data.length) return res.status(404).json({ message: 'Order not found.' });
    return res.json(apiOrder(data[0]));
  }
  const data = failOnError(await req.supabase.from('orders').select(orderSelect).eq('id', req.params.id).single());
  res.json(apiOrder(data));
}));

app.put('/api/orders/:id/status', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.rpc('update_store_order_status', { p_order_id: req.params.id, p_status: req.body?.status }));
  res.json(apiOrder(data));
}));

app.get('/api/admin/dashboard', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const ordersQuery = req.supabase.rpc('list_store_orders', { p_order_id: null });
  const [ordersResult, productsResult, customerCountResult] = await Promise.all([
    ordersQuery,
    req.supabase.from('products').select('*, category:categories(name)').order('created_at', { ascending: false }),
    req.supabase.rpc('count_store_customers'),
  ]);
  const orders = failOnError(ordersResult).map(apiOrder);
  const products = failOnError(productsResult).map(apiProduct);
  const users = req.profile.role === 'admin'
    ? (failOnError(await req.supabase.from('users').select('id,username,email,role,phone,address,created_at').order('created_at', { ascending: false })).map(apiUser))
    : [];
  const salesOrders = orders.filter((order) => order.status === 'Sold/Completed');
  const totalSales = salesOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const productsSold = salesOrders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity), 0), 0);

  res.json({
    totals: {
      totalSales,
      productsSold,
      totalOrders: orders.length,
      pendingOrders: orders.filter((order) => order.status === 'Pending').length,
      completedOrders: salesOrders.length,
      customers: Number(failOnError(customerCountResult) || 0),
      availableProducts: products.filter((product) => product.stock > 0).length,
      lowStockProducts: products.filter((product) => product.stock <= 5).length,
    },
    recentOrders: orders.slice(0, 6),
    users,
    products,
  });
}));

app.get('/api/admin/sales', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const orders = failOnError(await req.supabase.rpc('list_store_orders', { p_order_id: null }));
  const normalized = orders.map(apiOrder).filter((order) => order.status === 'Sold/Completed');
  const totalSales = normalized.reduce((sum, order) => sum + order.totalAmount, 0);
  const topProducts = new Map();
  for (const order of normalized) {
    for (const item of order.items || []) {
      const name = item.product?.name || item.productName || 'Product';
      const current = topProducts.get(name) || { name, quantity: 0, revenue: 0 };
      current.quantity += Number(item.quantity);
      current.revenue += Number(item.quantity) * Number(item.price);
      topProducts.set(name, current);
    }
  }
  const completedMetrics = normalized.map((order) => ({ ...order, productsSold: (order.items || []).reduce((sum, item) => sum + Number(item.quantity), 0) }));
  const dailySales = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (11 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, value: normalized.filter((order) => order.completedAt?.slice(0, 10) === day).reduce((sum, order) => sum + order.totalAmount, 0) };
  });
  res.json({
    totals: {
      today: normalized.filter((order) => order.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((sum, order) => sum + order.totalAmount, 0),
      thisWeek: normalized.filter((order) => order.completedAt && new Date(order.completedAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((sum, order) => sum + order.totalAmount, 0),
      thisMonth: normalized.filter((order) => order.completedAt && new Date(order.completedAt).getMonth() === new Date().getMonth()).reduce((sum, order) => sum + order.totalAmount, 0),
      thisYear: normalized.filter((order) => order.completedAt && new Date(order.completedAt).getFullYear() === new Date().getFullYear()).reduce((sum, order) => sum + order.totalAmount, 0),
      totalSales,
      productsSold: completedMetrics.reduce((sum, order) => sum + order.productsSold, 0),
      orders: normalized.length,
    },
    dailySales,
    bestSellingProducts: [...topProducts.values()].sort((left, right) => right.revenue - left.revenue).slice(0, 5),
    metrics: computeDashboardMetrics(completedMetrics),
  });
}));

app.get('/api/admin/inventory', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('products').select('*, category:categories(name)').order('stock'));
  res.json(data.map(apiProduct));
}));

app.get('/api/admin/customers', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('users').select('id,username,email,role,phone,address,profile_image,created_at,updated_at').eq('role', 'customer').order('created_at', { ascending: false }));
  res.json(data.map(apiUser));
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('users').select('id,username,email,role,phone,address,created_at,updated_at').order('created_at', { ascending: false }));
  res.json(data.map(apiUser));
}));

app.put('/api/admin/users/:id/role', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.rpc('set_app_user_role', { p_user_id: req.params.id, p_role: req.body?.role }));
  res.json(apiUser(data));
}));

app.get('/api/admin/orders', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const data = failOnError(await req.supabase.from('orders').select(orderSelect).order('created_at', { ascending: false }));
  res.json(data.map(apiOrder));
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === '42501' || error.code === 'PGRST301' ? 403
    : error.code === 'PGRST116' || error.code === 'P0002' ? 404
      : error.code === '23505' ? 409
        : error.code === '22023' ? 400 : 500;
  const message = status === 500 ? 'A server or Supabase database error occurred.' : error.message;
  if (status === 500) console.error('Supabase API error:', error.message);
  res.status(status).json({ message });
});

module.exports = { app, PORT };
