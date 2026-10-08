const state = {
  page: 'home',
  currentProductId: null,
  products: [],
  categories: [],
  cart: loadCart(),
  token: localStorage.getItem('alubarikaToken') || '',
  refreshToken: localStorage.getItem('alubarikaRefreshToken') || '',
  user: JSON.parse(localStorage.getItem('alubarikaUser') || 'null'),
  recoveryMode: false,
  orders: [],
  adminDashboard: null,
  adminUsers: [],
  adminProducts: [],
  editingProductId: null,
  settings: {
    heroImage: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80',
    logoImage: '/download.png',
  },
};
let motionObserver;

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem('alubarikaCart') || '[]');
  } catch (error) {
    return [];
  }
}

function saveCart() {
  localStorage.setItem('alubarikaCart', JSON.stringify(state.cart));
}

function showToast(message, tone = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '30px';
  toast.style.right = '24px';
  toast.style.background = tone === 'error' ? '#d93025' : '#111111';
  toast.style.color = '#fff';
  toast.style.padding = '12px 18px';
  toast.style.borderRadius = '12px';
  toast.style.zIndex = '100';
  toast.style.boxShadow = '0 18px 32px rgba(0,0,0,0.12)';
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2500);
}

function firstImage(product) {
  if (Array.isArray(product.images) && product.images.length) return product.images[0];
  return 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
}

function money(value) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function parseRoute() {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (rawHash.includes('type=recovery')) {
    const recovery = new URLSearchParams(rawHash);
    state.recoveryMode = true;
    state.token = recovery.get('access_token') || state.token;
    state.refreshToken = recovery.get('refresh_token') || state.refreshToken;
    if (state.token) localStorage.setItem('alubarikaToken', state.token);
    if (state.refreshToken) localStorage.setItem('alubarikaRefreshToken', state.refreshToken);
    state.page = 'auth';
    return;
  }

  const hash = rawHash || 'home';
  if (hash.startsWith('product/')) {
    state.page = 'product';
    state.currentProductId = hash.split('/')[1];
    return;
  }

  if (hash === 'dashboard') {
    state.page = 'dashboard';
    return;
  }

  if (hash === 'orders') {
    state.page = 'orders';
    return;
  }

  if (hash === 'admin') {
    state.page = 'admin';
    return;
  }

  if (hash === 'auth') {
    state.page = 'auth';
    return;
  }

  if (hash === 'checkout') {
    state.page = 'checkout';
    return;
  }

  if (hash === 'cart') {
    state.page = 'cart';
    return;
  }

  state.page = hash || 'home';
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 401 && state.refreshToken && path !== '/api/auth/refresh') {
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (refreshResponse.ok) {
      const session = await refreshResponse.json();
      setUser(session.user, session.token, session.refreshToken);
      headers.Authorization = `Bearer ${state.token}`;
      response = await fetch(path, { ...options, headers });
    }
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || 'Request failed');
  }

  return payload;
}

async function loadData() {
  try {
    const [productsResponse, categoriesResponse, settingsResponse] = await Promise.all([
      apiFetch('/api/products'),
      apiFetch('/api/categories'),
      apiFetch('/api/settings'),
    ]);

    state.products = Array.isArray(productsResponse) ? productsResponse.filter((product) => product.status !== 'draft') : [];
    state.categories = Array.isArray(categoriesResponse) ? categoriesResponse : [];
    state.settings = { ...state.settings, ...settingsResponse };
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to load products.', 'error');
  }
}

async function loadDashboard() {
  if (!state.user || !['admin', 'staff'].includes(state.user.role)) return;
  const dashboard = await apiFetch('/api/admin/dashboard');
  state.adminDashboard = dashboard;
  state.adminUsers = Array.isArray(dashboard.users) ? dashboard.users : [];
  state.adminProducts = Array.isArray(dashboard.products) ? dashboard.products : [];
}

async function loadOrders() {
  if (!state.user) return;
  try {
    const orders = await apiFetch('/api/orders');
    state.orders = orders;
  } catch (error) {
    console.error(error);
  }
}

function setUser(user, token, refreshToken = '') {
  state.user = user;
  state.token = token;
  state.refreshToken = refreshToken;

  if (user && token) {
    localStorage.setItem('alubarikaUser', JSON.stringify(user));
    localStorage.setItem('alubarikaToken', token);
    if (refreshToken) localStorage.setItem('alubarikaRefreshToken', refreshToken);
  } else {
    localStorage.removeItem('alubarikaUser');
    localStorage.removeItem('alubarikaToken');
    localStorage.removeItem('alubarikaRefreshToken');
  }
}

function getCartSummary() {
  const items = state.cart.map((entry) => {
    const product = state.products.find((item) => item.id === entry.productId) || null;
    const unitPrice = product ? Number(product.discountPrice || product.price) : Number(entry.price || 0);
    return {
      ...entry,
      product,
      unitPrice,
      lineTotal: unitPrice * Number(entry.quantity || 0),
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = subtotal >= 150000 ? 0 : 15000;
  return { items, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function addToCart(productId, qty = 1) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += qty;
  } else {
    state.cart.push({ productId, quantity: qty });
  }
  saveCart();
  render();
  showToast('Added to cart.');
}

function updateCartQuantity(productId, delta) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (!existing) return;
  existing.quantity += delta;
  if (existing.quantity <= 0) {
    state.cart = state.cart.filter((item) => item.productId !== productId);
  }
  saveCart();
  render();
}

async function submitSignup(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    username: form.get('username'),
    email: form.get('email'),
    password: form.get('password'),
    confirmPassword: form.get('confirmPassword'),
  };

  try {
    const response = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
    if (!response.token) {
      showToast(response.message || 'Check your email to confirm your account.');
      return;
    }
    setUser(response.user, response.token, response.refreshToken);
    showToast('Signup successful!');
    window.location.hash = ['admin', 'staff'].includes(response.user.role) ? '#admin' : '#dashboard';
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    usernameOrEmail: form.get('usernameOrEmail'),
    password: form.get('password'),
  };

  try {
    const response = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    setUser(response.user, response.token, response.refreshToken);
    showToast('Welcome back!');
    window.location.hash = ['admin', 'staff'].includes(response.user.role) ? '#admin' : '#dashboard';
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function submitReset(event) {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    const response = await apiFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email: form.get('email') }) });
    showToast(response.message || 'Password reset email sent.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function submitNewPassword(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: form.get('newPassword'), confirmPassword: form.get('confirmPassword'), refreshToken: state.refreshToken }),
    });
    showToast('Password updated. Sign in with your new password.');
    state.recoveryMode = false;
    setUser(null, '');
    window.location.hash = '#auth';
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleCheckout(event) {
  event.preventDefault();
  const summary = getCartSummary();
  if (!state.user) {
    window.location.hash = '#auth';
    render();
    return;
  }

  if (!summary.items.length) {
    showToast('Your cart is empty.', 'error');
    return;
  }

  const form = new FormData(event.target);
  const payload = {
    items: summary.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
    address: form.get('address'),
    phone: form.get('phone'),
    whatsappNumber: form.get('whatsappNumber'),
    notes: form.get('note'),
  };

  try {
    const response = await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    state.cart = [];
    saveCart();
    showToast('Order created successfully.');
    window.location.hash = '#dashboard';
    await loadOrders();
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleAdminProductSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const selectedFiles = Array.from(form.getAll('mediaFiles')).filter((file) => file instanceof File && file.size > 0);
  let uploadedMedia = [];

  try {
    if (selectedFiles.length) {
      const uploadForm = new FormData();
      selectedFiles.forEach((file) => uploadForm.append('files', file));
      const uploadResponse = await apiFetch('/api/uploads', { method: 'POST', body: uploadForm });
      uploadedMedia = uploadResponse.media || [];
    }

  const payload = {
    name: form.get('name'),
    description: form.get('description'),
    price: Number(form.get('price')),
    discountPrice: Number(form.get('discountPrice') || 0),
    categoryId: Number(form.get('categoryId')),
    images: [
      ...String(form.get('images') || '').split(',').map((value) => value.trim()).filter(Boolean),
      ...uploadedMedia.filter((file) => file.mimeType.startsWith('image/')).map((file) => file.url),
    ],
    video: form.get('video') || uploadedMedia.find((file) => file.mimeType.startsWith('video/'))?.url || '',
    sizes: String(form.get('sizes') || '').split(',').map((value) => value.trim()).filter(Boolean),
    colors: String(form.get('colors') || '').split(',').map((value) => value.trim()).filter(Boolean),
    stock: Number(form.get('stock') || 0),
    status: form.get('status') || 'draft',
    featured: Boolean(form.get('featured')),
  };

    const editing = Boolean(state.editingProductId);
    const endpoint = editing ? `/api/products/${state.editingProductId}` : '/api/products';
    await apiFetch(endpoint, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.editingProductId = null;
    showToast(editing ? 'Product updated.' : 'Product published.');
    await loadData();
    await loadDashboard();
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleStoreMediaSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const selectedMedia = [
    { key: 'heroImage', file: form.get('heroFile') },
    { key: 'logoImage', file: form.get('logoFile') },
  ].filter((entry) => entry.file instanceof File && entry.file.size > 0);

  try {
    const settings = {
      heroImage: form.get('heroImage'),
      logoImage: form.get('logoImage'),
    };
    if (selectedMedia.length) {
      const uploadForm = new FormData();
      selectedMedia.forEach(({ file }) => uploadForm.append('files', file));
      const uploadResponse = await apiFetch('/api/uploads', { method: 'POST', body: uploadForm });
      selectedMedia.forEach(({ key }, index) => { settings[key] = uploadResponse.files[index]; });
    }

    state.settings = await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) });
    showToast('Storefront media updated.');
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function updateUserRole(userId, role) {
  try {
    await apiFetch(`/api/admin/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
    await loadDashboard();
    showToast('User role updated.');
    render();
  } catch (error) {
    showToast(error.message, 'error');
    await loadDashboard();
    render();
  }
}

function editAdminProduct(productId) {
  state.editingProductId = productId;
  render();
  document.getElementById('admin-product-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelAdminProductEdit() {
  state.editingProductId = null;
  render();
}

async function deleteAdminProduct(productId) {
  if (!window.confirm('Delete this product from the storefront?')) return;
  try {
    await apiFetch(`/api/products/${productId}`, { method: 'DELETE' });
    await loadData();
    await loadDashboard();
    showToast('Product deleted.');
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function submitCategory(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    name: form.get('name'),
    description: form.get('description'),
  };

  try {
    await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Category created.');
    await loadData();
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await apiFetch(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    showToast('Order status updated.');
    await loadOrders();
    await loadDashboard();
    render();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function productCard(product) {
  const price = Number(product.discountPrice || product.price || 0);
  const original = Number(product.price || 0);
  return `
    <article class="card product-card">
      <img src="${firstImage(product)}" alt="${product.name}" />
      <div class="product-body">
        <div class="product-meta">
          <span class="category-tag">${product.categoryName || 'Premium'}</span>
          <span class="qty-tag">${product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</span>
        </div>
        <h3>${product.name}</h3>
        <div class="price-wrap">
          <span class="price">${money(price)}</span>
          ${original > price ? `<span class="old-price">${money(original)}</span>` : ''}
        </div>
        <div class="product-footer">
          <a href="#product/${product.id}" class="secondary-btn" style="padding: 10px 14px; border-radius: 999px; display:inline-flex; align-items:center; justify-content:center;">View</a>
          <button class="small-btn" onclick="addToCart(${product.id})">Add to cart</button>
        </div>
      </div>
    </article>
  `;
}

function renderHeader() {
  const navLinks = [
    ['Home', '#home'],
    ['Shop', '#shop'],
    ['Categories', '#categories'],
    ['About', '#about'],
    ['Contact', '#contact'],
  ];

  const cartCount = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const accountLabel = state.user ? (state.user.role === 'admin' ? 'Admin' : state.user.role === 'staff' ? 'Staff' : state.user.username) : 'Account';
  const accountRoute = state.user && ['admin', 'staff'].includes(state.user.role) ? '#admin' : state.user ? '#dashboard' : '#auth';

  return `
    <div class="topbar">
      <div class="container">
        <span>Premium African Fashion</span>
        <span>08126539542</span>
      </div>
    </div>
    <header class="navbar">
      <div class="container nav-inner">
        <a href="#home" class="logo-box" aria-label="Alubarika Home of Designs homepage">
          <img src="${state.settings.logoImage}" alt="Alubarika Home of Designs logo" />
        </a>
        <nav class="nav-links">
          ${navLinks.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}
        </nav>
        <div class="nav-actions">
          <button class="icon-btn" onclick="window.location.hash='#shop'">Shop</button>
          <button class="icon-btn cart-pill" onclick="window.location.hash='#cart'">Cart (${cartCount})</button>
          <button class="icon-btn" onclick="window.location.hash='${accountRoute}'">${accountLabel}</button>
        </div>
      </div>
    </header>
  `;
}

function renderFooter() {
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <img src="${state.settings.logoImage}" alt="Alubarika logo" style="width: 220px; margin-bottom: 14px;" />
            <p style="color: rgba(255,255,255,0.75); max-width: 320px;">Luxury African fashion crafted with modern elegance and timeless confidence.</p>
          </div>
          <div>
            <h3>Quick Links</h3>
            <ul class="footer-list">
              <li><a href="#home">Home</a></li>
              <li><a href="#shop">Shop</a></li>
              <li><a href="#categories">Categories</a></li>
              <li><a href="#about">About</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </div>
          <div>
            <h3>Account</h3>
            <ul class="footer-list">
              <li><a href="#dashboard">My Account</a></li>
              <li><a href="#orders">Orders</a></li>
              <li><a href="#auth">Sign In</a></li>
            </ul>
          </div>
          <div>
            <h3>Contact</h3>
            <ul class="footer-list">
              <li>08126539542</li>
              <li><a href="https://www.tiktok.com/@alubarika11" target="_blank" rel="noreferrer">Follow us on TikTok</a></li>
              <li>@alubarika11</li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          © 2026 Alubarika Home of Designs. All rights reserved.
        </div>
      </div>
    </footer>
  `;
}

function renderHomePage() {
  const featured = state.products.filter((product) => product.featured).slice(0, 4);
  const popular = state.products.slice(0, 4);
  const categories = state.categories.slice(0, 4);

  return `
    <main>
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <span class="kicker">Alubarika Home of Designs</span>
            <h1>Quality Designs. Premium Style. Made for You.</h1>
            <p>Luxury African fashion for modern expression. Discover elegant silhouettes, statement pieces, and premium craftsmanship curated for your lifestyle.</p>
            <div class="hero-actions">
              <a href="#shop" class="primary-btn">Shop Now</a>
              <a href="#categories" class="secondary-btn">View Collection</a>
            </div>
          </div>
          <div class="hero-card">
            <div class="hero-image">
              <img src="${state.settings.heroImage}" alt="Alubarika collection" />
              <div class="badge-box">
                <strong>Luxury African Fashion</strong><br />
                <span>Curated for everyday elegance</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head">
            <div>
              <div class="section-label">New arrivals</div>
              <h2>Fresh drops</h2>
            </div>
            <a href="#shop" class="secondary-btn">Explore more</a>
          </div>
          <div class="product-grid">
            ${state.products.slice(0, 4).map(productCard).join('')}
          </div>
        </div>
      </section>

      <section class="section" style="background: var(--light);">
        <div class="container">
          <div class="section-head">
            <div>
              <div class="section-label">Featured</div>
              <h2>Popular designs</h2>
            </div>
          </div>
          <div class="product-grid">
            ${featured.map(productCard).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head">
            <div>
              <div class="section-label">Collections</div>
              <h2>Styles for every occasion</h2>
            </div>
          </div>
          <div class="category-grid">
            ${categories.map((category) => `
              <a href="#shop" class="card category-card">
                <h3>${category.name}</h3>
              </a>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="section" style="background: var(--light);">
        <div class="container">
          <div class="section-head">
            <div>
              <div class="section-label">Why choose us</div>
              <h2>Crafted with intention</h2>
            </div>
          </div>
          <div class="feature-grid">
            <div class="feature-box">
              <div class="feature-icon">✦</div>
              <h3>Premium fabrics</h3>
              <p class="muted">Thoughtful texture, durability, and elevated finishing for confident wear.</p>
            </div>
            <div class="feature-box">
              <div class="feature-icon">✓</div>
              <h3>Tailored fit</h3>
              <p class="muted">Modern silhouettes designed to flatter and feel luxurious all day.</p>
            </div>
            <div class="feature-box">
              <div class="feature-icon">⚡</div>
              <h3>Fast delivery</h3>
              <p class="muted">Timely dispatch and dependable order fulfillment across Nigeria.</p>
            </div>
            <div class="feature-box">
              <div class="feature-icon">◎</div>
              <h3>Secure checkout</h3>
              <p class="muted">Protected shopping with easy ordering and active customer support.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head">
            <div>
              <div class="section-label">Reviews</div>
              <h2>What customers say</h2>
            </div>
          </div>
          <div class="review-grid">
            <div class="review-card">
              <div class="review-stars">★★★★★</div>
              <p>“The craftsmanship is exceptional and the fit feels premium. I always get compliments.”</p>
              <strong>Amara K.</strong>
            </div>
            <div class="review-card">
              <div class="review-stars">★★★★★</div>
              <p>“Beautiful details, smooth delivery, and easy ordering. Alubarika is my go-to brand.”</p>
              <strong>Daniel O.</strong>
            </div>
            <div class="review-card">
              <div class="review-stars">★★★★★</div>
              <p>“Luxury design with a very modern feel. Everything arrived in perfect condition.”</p>
              <strong>Grace A.</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="cta-banner">
            <div>
              <div class="section-label" style="color: rgba(255,255,255,0.7);">Need styling help?</div>
              <h2>Chat with us on WhatsApp</h2>
            </div>
            <div class="btn-row">
              <a href="https://wa.me/2348126539542" class="primary-btn" target="_blank" rel="noreferrer">08126539542</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderShopPage() {
  const products = state.products;
  const categories = state.categories;

  return `
    <section class="page-shell">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-label">Shop</div>
            <h2>Curated fashion pieces</h2>
          </div>
        </div>
        <div class="filter-bar">
          <div class="field">
            <input id="shopSearch" placeholder="Search by name, category or description" />
          </div>
          <div class="field">
            <select id="shopCategory">
              <option value="">All categories</option>
              ${categories.map((category) => `<option value="${category.name}">${category.name}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <select id="shopSort">
              <option value="newest">Newest</option>
              <option value="low-high">Price: Low to High</option>
              <option value="high-low">Price: High to Low</option>
            </select>
          </div>
          <div class="field">
            <select id="shopAvailability">
              <option value="">All items</option>
              <option value="available">Available</option>
            </select>
          </div>
        </div>
        <div class="product-grid">
          ${products.map(productCard).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderCategoriesPage() {
  return `
    <section class="page-shell">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-label">Categories</div>
            <h2>Explore by style</h2>
          </div>
        </div>
        <div class="category-grid">
          ${state.categories.map((category) => `
            <div class="card category-card">
              <h3>${category.name}</h3>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderAboutPage() {
  return `
    <section class="page-shell">
      <div class="container" style="max-width: 900px;">
        <div class="section-label">About</div>
        <h2>Alubarika Home of Designs</h2>
        <p class="muted">We are a luxury African fashion house focused on premium craftsmanship, minimalist style, and expressive comfort. Our collections blend contemporary tailoring with timeless Nigerian heritage, giving you statement pieces for life’s most meaningful moments.</p>
        <div class="feature-grid" style="margin-top: 24px;">
          <div class="feature-box"><div class="feature-icon">✦</div><h3>Modern elegance</h3></div>
          <div class="feature-box"><div class="feature-icon">✦</div><h3>African heritage</h3></div>
          <div class="feature-box"><div class="feature-icon">✦</div><h3>Premium quality</h3></div>
          <div class="feature-box"><div class="feature-icon">✦</div><h3>Confident style</h3></div>
        </div>
      </div>
    </section>
  `;
}

function renderContactPage() {
  return `
    <section class="page-shell">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-label">Contact</div>
            <h2>We’re here to help</h2>
          </div>
        </div>
        <div class="two-col">
          <div class="detail-box">
            <h3>Call or message</h3>
            <p class="muted">Phone: 08126539542</p>
            <p class="muted">TikTok: @alubarika11</p>
            <a class="primary-btn" href="https://wa.me/2348126539542" target="_blank" rel="noreferrer">Chat with us on WhatsApp</a>
          </div>
          <div class="detail-box">
            <h3>Business hours</h3>
            <p class="muted">Monday - Saturday</p>
            <p class="muted">9:00 AM - 6:00 PM</p>
            <p class="muted">Premium support for boutique and custom orders.</p>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderProductPage() {
  const product = state.products.find((item) => String(item.id) === String(state.currentProductId));
  if (!product) {
    return `<section class="page-shell"><div class="container"><h2>Product not found.</h2></div></section>`;
  }

  const related = state.products.filter((item) => item.id !== product.id).slice(0, 4);

  return `
    <section class="page-shell">
      <div class="container product-page">
        <div>
          <div class="gallery-main">
            <img src="${firstImage(product)}" alt="${product.name}" />
          </div>
          <div class="gallery-thumbs">
            ${(Array.isArray(product.images) ? product.images : [firstImage(product)]).slice(0, 4).map((image) => `
              <img src="${image}" alt="${product.name}" />
            `).join('')}
          </div>
        </div>
        <div class="detail-box">
          <div class="section-label">${product.categoryName || 'Premium design'}</div>
          <h2>${product.name}</h2>
          <div class="price-wrap">
            <span class="price">${money(product.discountPrice || product.price)}</span>
            ${Number(product.price || 0) > Number(product.discountPrice || product.price) ? `<span class="old-price">${money(product.price)}</span>` : ''}
          </div>
          <div class="pill-row">
            ${Array.isArray(product.colors) ? product.colors.map((color) => `<span class="pill">${color}</span>`).join('') : ''}
            ${Array.isArray(product.sizes) ? product.sizes.map((size) => `<span class="pill">${size}</span>`).join('') : ''}
          </div>
          <p class="muted">${product.description}</p>
          <div class="counter-row">
            <div class="qty-box">
              <button type="button" onclick="updateQuantityForProduct(${product.id}, -1)">-</button>
              <span id="productQty">1</span>
              <button type="button" onclick="updateQuantityForProduct(${product.id}, 1)">+</button>
            </div>
            <strong>${product.stock > 0 ? `${product.stock} available` : 'Out of stock'}</strong>
          </div>
          <div class="btn-row">
            <button class="primary-btn" onclick="addToCart(${product.id}, Number(document.getElementById('productQty')?.textContent || 1))">Add to Cart</button>
            <button class="secondary-btn" onclick="window.location.hash='#checkout'">Buy Now</button>
          </div>
        </div>
      </div>

      <div class="container" style="margin-top: 48px;">
        <div class="section-head">
          <div>
            <div class="section-label">Related</div>
            <h2>Complete the look</h2>
          </div>
        </div>
        <div class="product-grid">
          ${related.map(productCard).join('')}
        </div>
      </div>
    </section>
  `;
}

function updateQuantityForProduct(productId, delta) {
  const qtyNode = document.getElementById('productQty');
  if (!qtyNode) return;
  let current = Number(qtyNode.textContent || 1);
  current = Math.max(1, current + delta);
  qtyNode.textContent = String(current);
}

function renderCartPage() {
  const summary = getCartSummary();

  if (!summary.items.length) {
    return `
      <section class="page-shell">
        <div class="container">
          <h2>Your cart is empty.</h2>
          <a href="#shop" class="primary-btn">Continue shopping</a>
        </div>
      </section>
    `;
  }

  return `
    <section class="page-shell">
      <div class="container cart-layout">
        <div>
          <div class="section-head">
            <div>
              <div class="section-label">Cart</div>
              <h2>Shopping bag</h2>
            </div>
          </div>
          ${summary.items.map((item) => `
            <div class="cart-item" style="margin-bottom: 14px;">
              <img src="${firstImage(item.product)}" alt="${item.product?.name || 'Product'}" />
              <div>
                <h3 style="margin-bottom: 8px;">${item.product?.name || 'Product'}</h3>
                <p class="muted">${money(item.unitPrice)}</p>
                <div class="qty-box">
                  <button type="button" onclick="updateCartQuantity(${item.productId}, -1)">-</button>
                  <span>${item.quantity}</span>
                  <button type="button" onclick="updateCartQuantity(${item.productId}, 1)">+</button>
                </div>
              </div>
              <strong>${money(item.lineTotal)}</strong>
            </div>
          `).join('')}
        </div>
        <aside class="summary-box">
          <h3>Order summary</h3>
          <div class="summary-row"><span>Subtotal</span><span>${money(summary.subtotal)}</span></div>
          <div class="summary-row"><span>Delivery fee</span><span>${money(summary.deliveryFee)}</span></div>
          <div class="summary-row total"><span>Total</span><span>${money(summary.total)}</span></div>
          <div class="btn-row" style="margin-top: 18px;">
            <a href="#shop" class="secondary-btn">Continue shopping</a>
            <a href="#checkout" class="primary-btn">Checkout</a>
          </div>
        </aside>
      </div>
    </section>
  `;
}

function renderCheckoutPage() {
  if (!state.user) {
    return `
      <section class="page-shell">
        <div class="container"><h2>Please sign in to place an order.</h2><a href="#auth" class="primary-btn">Sign in</a></div>
      </section>
    `;
  }

  const summary = getCartSummary();
  if (!summary.items.length) {
    return `
      <section class="page-shell">
        <div class="container"><h2>Your cart is empty.</h2><a href="#shop" class="primary-btn">Shop now</a></div>
      </section>
    `;
  }

  return `
    <section class="page-shell">
      <div class="container cart-layout">
        <div class="detail-box">
          <h2>Checkout</h2>
          <form class="form-grid" onsubmit="handleCheckout(event)">
            <div class="two-col">
              <div class="field"><input name="fullName" placeholder="Full name" value="${state.user.username || ''}" required /></div>
              <div class="field"><input name="phone" placeholder="Phone number" value="${state.user.phone || ''}" required /></div>
            </div>
            <div class="two-col">
              <div class="field"><input name="whatsappNumber" placeholder="WhatsApp number" value="${state.user.phone || ''}" required /></div>
              <div class="field"><input name="state" placeholder="State" required /></div>
            </div>
            <div class="field"><input name="city" placeholder="City" required /></div>
            <div class="field"><textarea name="address" rows="4" placeholder="Delivery address" required></textarea></div>
            <div class="field"><textarea name="note" rows="3" placeholder="Additional delivery instructions"></textarea></div>
            <button class="primary-btn" type="submit">Complete checkout</button>
          </form>
        </div>
        <aside class="summary-box">
          <h3>Order summary</h3>
          ${summary.items.map((item) => `
            <div class="summary-row">
              <span>${item.product?.name || 'Product'} x ${item.quantity}</span>
              <span>${money(item.lineTotal)}</span>
            </div>
          `).join('')}
          <div class="summary-row"><span>Subtotal</span><span>${money(summary.subtotal)}</span></div>
          <div class="summary-row"><span>Delivery fee</span><span>${money(summary.deliveryFee)}</span></div>
          <div class="summary-row total"><span>Total</span><span>${money(summary.total)}</span></div>
        </aside>
      </div>
    </section>
  `;
}

function renderAuthPage() {
  if (state.recoveryMode) {
    return `
      <section class="auth-shell">
        <div class="auth-card">
          <h2>Choose a new password</h2>
          <form class="form-grid" onsubmit="submitNewPassword(event)">
            <div class="field"><input name="newPassword" type="password" minlength="8" placeholder="New password" required /></div>
            <div class="field"><input name="confirmPassword" type="password" minlength="8" placeholder="Confirm new password" required /></div>
            <button class="primary-btn" type="submit">Update password</button>
          </form>
        </div>
      </section>
    `;
  }

  return `
    <section class="auth-shell">
      <div class="auth-card">
        <div class="auth-tabs">
          <button type="button" class="active">Sign In</button>
          <button type="button">Sign Up</button>
          <button type="button">Reset Password</button>
        </div>

        <div class="auth-panel">
          <form class="form-grid" onsubmit="submitLogin(event)">
            <div class="field"><input name="usernameOrEmail" type="email" placeholder="Email address" required /></div>
            <div class="field"><input name="password" type="password" placeholder="Password" required /></div>
            <button class="primary-btn" type="submit">Sign In</button>
          </form>
        </div>

        <div class="auth-panel" style="display:none; margin-top: 18px;">
          <form class="form-grid" onsubmit="submitSignup(event)">
            <div class="two-col">
              <div class="field"><input name="username" placeholder="Username" required /></div>
              <div class="field"><input name="email" type="email" placeholder="Email" required /></div>
            </div>
            <div class="two-col">
              <div class="field"><input name="password" type="password" placeholder="Password" required /></div>
              <div class="field"><input name="confirmPassword" type="password" placeholder="Confirm Password" required /></div>
            </div>
            <button class="primary-btn" type="submit">Create account</button>
          </form>
        </div>

        <div class="auth-panel" style="display:none; margin-top: 18px;">
          <form class="form-grid" onsubmit="submitReset(event)">
            <div class="field"><input name="email" type="email" placeholder="Account email" required /></div>
            <button class="primary-btn" type="submit">Send password reset link</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderOrdersPage() {
  const orders = state.orders || [];

  return `
    <section class="page-shell">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-label">My Orders</div>
            <h2>Order history</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Products</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map((order) => `
                <tr>
                  <td>#${order.id}</td>
                  <td>${(order.items || []).map((item) => `${item.productName || 'Product'} x${item.quantity}`).join(', ') || '—'}</td>
                  <td>${money(order.totalAmount)}</td>
                  <td>${new Date(order.createdAt).toLocaleDateString()}</td>
                  <td>${order.status}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">No orders yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderDashboardPage() {
  if (!state.user) {
    return `<section class="page-shell"><div class="container"><h2>Please sign in.</h2></div></section>`;
  }

  const userOrders = state.orders || [];
  const totalOrders = userOrders.length;
  const pending = userOrders.filter((order) => order.status === 'Pending').length;
  const completed = userOrders.filter((order) => order.status === 'Sold/Completed').length;

  return `
    <section class="page-shell">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-label">Dashboard</div>
            <h2>Welcome, ${state.user.username}</h2>
          </div>
        </div>
        <div class="dashboard-grid">
          <div class="metric-card"><h4>Total Orders</h4><div class="number">${totalOrders}</div></div>
          <div class="metric-card"><h4>Pending Orders</h4><div class="number">${pending}</div></div>
          <div class="metric-card"><h4>Completed Orders</h4><div class="number">${completed}</div></div>
          <div class="metric-card"><h4>Account</h4><div class="number">${state.user.role}</div></div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Products</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${userOrders.map((order) => `
                <tr>
                  <td>#${order.id}</td>
                  <td>${(order.items || []).map((item) => `${item.productName || 'Product'} x${item.quantity}`).join(', ') || '—'}</td>
                  <td>${money(order.totalAmount)}</td>
                  <td>${new Date(order.createdAt).toLocaleDateString()}</td>
                  <td>${order.status}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">No orders yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderAdminPage() {
  if (!state.user || !['admin', 'staff'].includes(state.user.role)) {
    return `<section class="page-shell"><div class="container"><h2>Staff access required.</h2></div></section>`;
  }

  const summary = state.adminDashboard?.totals || {
    totalSales: 0,
    productsSold: 0,
    totalOrders: 0,
    pendingOrders: 0,
    completedOrders: 0,
    customers: 0,
    availableProducts: 0,
    lowStockProducts: 0,
  };

  const editingProduct = state.adminProducts.find((product) => product.id === state.editingProductId) || null;
  const orders = state.orders.length ? state.orders : [];

  return `
    <section class="page-shell">
      <div class="container admin-layout">
        <aside class="side-nav">
          <a class="active" href="#admin" onclick="document.getElementById('admin-overview')?.scrollIntoView({behavior:'smooth'})">Dashboard</a>
          <a href="#admin" onclick="document.getElementById('admin-products')?.scrollIntoView({behavior:'smooth'})">Products</a>
          <a href="#admin" onclick="document.getElementById('admin-categories')?.scrollIntoView({behavior:'smooth'})">Categories</a>
          <a href="#admin" onclick="document.getElementById('admin-orders')?.scrollIntoView({behavior:'smooth'})">Orders</a>
          ${state.user.role === 'admin' ? `<a href="#admin" onclick="document.getElementById('admin-users')?.scrollIntoView({behavior:'smooth'})">Users</a>` : ''}
          <a href="#admin" onclick="document.getElementById('admin-storefront')?.scrollIntoView({behavior:'smooth'})">Storefront media</a>
          <a href="#home" onclick="setUser(null, '')">Logout</a>
        </aside>

        <div class="admin-panel">
          <div id="admin-overview" class="admin-heading">
            <div><span class="section-label">Alubarika operations</span><h2>Store dashboard</h2></div>
            <span class="role-chip">${state.user.role}</span>
          </div>
          <div class="dashboard-grid">
            <div class="metric-card"><h4>Total sales</h4><div class="number">${money(summary.totalSales)}</div></div>
            <div class="metric-card"><h4>Products sold</h4><div class="number">${summary.productsSold}</div></div>
            <div class="metric-card"><h4>Total orders</h4><div class="number">${summary.totalOrders}</div></div>
            <div class="metric-card"><h4>Pending orders</h4><div class="number">${summary.pendingOrders}</div></div>
            <div class="metric-card"><h4>Completed orders</h4><div class="number">${summary.completedOrders}</div></div>
            <div class="metric-card"><h4>Customers</h4><div class="number">${summary.customers}</div></div>
            <div class="metric-card"><h4>Available products</h4><div class="number">${summary.availableProducts}</div></div>
            <div class="metric-card"><h4>Low stock</h4><div class="number">${summary.lowStockProducts}</div></div>
          </div>

          <section id="admin-products" class="admin-section">
            <h3>${editingProduct ? 'Edit product' : 'Add product'}</h3>
            <form id="admin-product-form" class="form-grid" onsubmit="handleAdminProductSubmit(event)">
              <div class="two-col">
                <div class="field"><label>Product name<input name="name" placeholder="Product name" value="${editingProduct?.name || ''}" required /></label></div>
                <div class="field"><label>Price (NGN)<input name="price" type="number" min="1" placeholder="Price" value="${editingProduct?.price || ''}" required /></label></div>
              </div>
              <div class="two-col">
                <div class="field"><label>Sale price (NGN)<input name="discountPrice" type="number" min="0" placeholder="Optional sale price" value="${editingProduct?.discountPrice || ''}" /></label></div>
                <div class="field"><label>Stock quantity<input name="stock" type="number" min="0" placeholder="Stock" value="${editingProduct?.stock ?? ''}" required /></label></div>
              </div>
              <div class="field"><label>Description<textarea name="description" rows="4" placeholder="Fabric, fit, care, and design details">${editingProduct?.description || ''}</textarea></label></div>
              <div class="two-col">
                <div class="field">
                  <label>Category<select name="categoryId" required>
                    ${state.categories.map((category) => `<option value="${category.id}" ${category.id === editingProduct?.categoryId ? 'selected' : ''}>${category.name}</option>`).join('')}
                  </select></label>
                </div>
                <div class="field"><label>Publication status<select name="status">
                  <option value="published" ${editingProduct?.status !== 'draft' ? 'selected' : ''}>Published</option>
                  <option value="draft" ${editingProduct?.status === 'draft' ? 'selected' : ''}>Draft</option>
                </select></label></div>
              </div>
              <div class="field"><label>Product images<input name="images" placeholder="Image URLs separated by commas" value="${(editingProduct?.images || []).join(', ')}" /></label></div>
              <div class="two-col">
                <div class="field"><label>Upload images or one video<input name="mediaFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple /></label></div>
                <div class="field"><label>Video URL<input name="video" type="url" placeholder="Optional product video URL" value="${editingProduct?.video || ''}" /></label></div>
              </div>
              <div class="two-col">
                <div class="field"><label>Sizes<input name="sizes" placeholder="S, M, L, XL" value="${(editingProduct?.sizes || []).join(', ')}" /></label></div>
                <div class="field"><label>Colors<input name="colors" placeholder="Black, white, green" value="${(editingProduct?.colors || []).join(', ')}" /></label></div>
              </div>
              <div class="field"><label class="checkbox-field"><input type="checkbox" name="featured" ${editingProduct?.featured ? 'checked' : ''} /> Featured product</label></div>
              <div class="btn-row">
                <button class="primary-btn" type="submit">${editingProduct ? 'Save changes' : 'Publish product'}</button>
                ${editingProduct ? `<button class="secondary-btn" type="button" onclick="cancelAdminProductEdit()">Cancel edit</button>` : ''}
              </div>
            </form>
            <div class="table-wrap admin-table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  ${state.adminProducts.map((product) => `
                    <tr>
                      <td><div class="admin-product-cell"><img src="${firstImage(product)}" alt="" /><span>${product.name}</span></div></td>
                      <td>${money(product.discountPrice || product.price)}</td>
                      <td>${product.stock}</td>
                      <td>${product.status}</td>
                      <td><div class="btn-row"><button class="small-btn" type="button" onclick="editAdminProduct(${product.id})">Edit</button><button class="secondary-btn admin-delete-btn" type="button" onclick="deleteAdminProduct(${product.id})">Delete</button></div></td>
                    </tr>
                  `).join('') || '<tr><td colspan="5">No products yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>

          <section id="admin-storefront" class="admin-section">
            <h3>Storefront media</h3>
            <form class="form-grid" onsubmit="handleStoreMediaSubmit(event)">
              <div class="two-col">
                <div class="field"><label>Hero image URL<input name="heroImage" type="url" value="${state.settings.heroImage || ''}" /></label><label class="file-label">Replace hero image<input name="heroFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label></div>
                <div class="field"><label>Logo image URL<input name="logoImage" type="text" value="${state.settings.logoImage || ''}" /></label><label class="file-label">Replace logo<input name="logoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label></div>
              </div>
              <button class="primary-btn" type="submit">Save storefront media</button>
            </form>
          </section>

          ${state.user.role === 'admin' ? `
          <section id="admin-users" class="admin-section">
            <h3>Users <span class="section-count">${state.adminUsers.length}</span></h3>
            <div class="table-wrap admin-table-wrap">
              <table>
                <thead><tr><th>Account</th><th>Contact</th><th>Joined</th><th>Role</th></tr></thead>
                <tbody>
                  ${state.adminUsers.map((user) => `
                    <tr>
                      <td><strong>${user.username}</strong><small>${user.email}</small></td>
                      <td>${user.phone || '—'}<small>${user.address || 'No address'}</small></td>
                      <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>${user.role === 'admin' ? '<span class="role-chip">Admin</span>' : `<select aria-label="Role for ${user.username}" onchange="updateUserRole(${user.id}, this.value)"><option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option><option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option></select>`}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="4">No accounts found.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>` : ''}

          <section id="admin-categories" class="admin-section">
            <h3>Add category</h3>
            <form class="form-grid" onsubmit="submitCategory(event)">
              <div class="two-col">
                <div class="field"><input name="name" placeholder="Category name" required /></div>
                <div class="field"><input name="description" placeholder="Description" /></div>
              </div>
              <button class="primary-btn" type="submit">Add category</button>
            </form>
          </section>

          <section id="admin-orders" class="admin-section">
            <h3>Customer orders</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Placed</th>
                    <th>Status</th>
                    <th>Update</th>
                  </tr>
                </thead>
                <tbody>
                  ${orders.map((order) => `
                    <tr>
                      <td>#${order.id}</td>
                      <td>${order.user?.username || 'Customer'}<small>${order.user?.email || ''}</small></td>
                      <td>${(order.items || []).map((item) => `${item.productName || 'Product'} x${item.quantity}`).join(', ') || '—'}</td>
                      <td>${money(order.totalAmount)}</td>
                      <td>${new Date(order.createdAt).toLocaleDateString()}</td>
                      <td>${order.status}</td>
                      <td>
                        <select aria-label="Update order ${order.id}" onchange="updateOrderStatus(${order.id}, this.value)">
                          <option value="">Change status</option>
                          <option value="Pending">Pending</option>
                          <option value="Confirmed">Confirmed</option>
                          <option value="Processing">Processing</option>
                          <option value="Ready">Ready</option>
                          <option value="Shipped">Shipped</option>
                          <option value="Delivered">Delivered</option>
                          <option value="Sold/Completed">Sold/Completed</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  `).join('') || '<tr><td colspan="7">No orders.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderPageContent() {
  const pages = {
    home: renderHomePage,
    shop: renderShopPage,
    categories: renderCategoriesPage,
    about: renderAboutPage,
    contact: renderContactPage,
    product: renderProductPage,
    cart: renderCartPage,
    checkout: renderCheckoutPage,
    auth: renderAuthPage,
    dashboard: renderDashboardPage,
    orders: renderOrdersPage,
    admin: renderAdminPage,
  };

  const renderer = pages[state.page] || renderHomePage;
  return renderer();
}

function render() {
  parseRoute();
  const content = renderPageContent();
  root.innerHTML = `
    ${renderHeader()}
    ${content}
    ${renderFooter()}
    <a class="whatsapp-float" href="https://wa.me/2348126539542" target="_blank" rel="noreferrer">Chat with us on WhatsApp</a>
  `;

  if (motionObserver) motionObserver.disconnect();
  const motionTargets = root.querySelectorAll(state.page === 'admin'
    ? '.hero-grid, main > .section > .container, .auth-shell'
    : '.hero-grid, main > .section > .container, .page-shell, .auth-shell');
  if ('IntersectionObserver' in window) {
    motionObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: '0px' });
    motionTargets.forEach((target) => {
      target.classList.add('motion-in');
      motionObserver.observe(target);
    });
  } else {
    motionTargets.forEach((target) => target.classList.add('is-visible'));
  }

  const authTabs = document.querySelectorAll('.auth-tabs button');
  const panels = document.querySelectorAll('.auth-panel');

  authTabs.forEach((button, index) => {
    button.addEventListener('click', () => {
      authTabs.forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      panels.forEach((panel, panelIndex) => {
        panel.style.display = panelIndex === index ? 'block' : 'none';
      });
    });
  });

  if (state.page === 'shop') {
    const searchInput = document.getElementById('shopSearch');
    const categorySelect = document.getElementById('shopCategory');
    const sortSelect = document.getElementById('shopSort');
    const availabilitySelect = document.getElementById('shopAvailability');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const filtered = state.products.filter((p) => {
          const term = searchInput.value.toLowerCase();
          return !term || (p.name + ' ' + p.description + ' ' + (p.categoryName || '')).toLowerCase().includes(term);
        });
        const container = document.querySelector('.product-grid');
        if (container) {
          container.innerHTML = filtered.map(productCard).join('');
        }
      });
    }

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        const selected = categorySelect.value;
        const filtered = state.products.filter((p) => !selected || p.categoryName === selected);
        const container = document.querySelector('.product-grid');
        if (container) container.innerHTML = filtered.map(productCard).join('');
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        const sorted = [...state.products];
        if (sortSelect.value === 'low-high') sorted.sort((a, b) => Number(a.discountPrice || a.price) - Number(b.discountPrice || b.price));
        if (sortSelect.value === 'high-low') sorted.sort((a, b) => Number(b.discountPrice || b.price) - Number(a.discountPrice || a.price));
        const container = document.querySelector('.product-grid');
        if (container) container.innerHTML = sorted.map(productCard).join('');
      });
    }

    if (availabilitySelect) {
      availabilitySelect.addEventListener('change', () => {
        const filtered = availabilitySelect.value === 'available' ? state.products.filter((p) => p.stock > 0) : state.products;
        const container = document.querySelector('.product-grid');
        if (container) container.innerHTML = filtered.map(productCard).join('');
      });
    }
  }
}

window.addEventListener('hashchange', () => {
  render();
  if (state.page === 'dashboard' && state.user) {
    loadOrders().then(render);
  }
  if (state.page === 'admin' && state.user && ['admin', 'staff'].includes(state.user.role)) {
    Promise.all([loadOrders(), loadDashboard()]).then(render);
  }
});

async function init() {
  await loadData();
  if (state.user) {
    await loadOrders();
    if (['admin', 'staff'].includes(state.user.role)) await loadDashboard();
  }
  render();
}

window.addEventListener('load', init);

window.addToCart = addToCart;
window.updateCartQuantity = updateCartQuantity;
window.handleCheckout = handleCheckout;
window.submitLogin = submitLogin;
window.submitSignup = submitSignup;
window.submitReset = submitReset;
window.submitNewPassword = submitNewPassword;
window.handleAdminProductSubmit = handleAdminProductSubmit;
window.handleStoreMediaSubmit = handleStoreMediaSubmit;
window.updateUserRole = updateUserRole;
window.editAdminProduct = editAdminProduct;
window.cancelAdminProductEdit = cancelAdminProductEdit;
window.deleteAdminProduct = deleteAdminProduct;
window.submitCategory = submitCategory;
window.updateOrderStatus = updateOrderStatus;
window.updateQuantityForProduct = updateQuantityForProduct;
window.setUser = setUser;
