// Application State Management
const State = {
  cart: [],
  products: [],
  categories: [],
  storeInfo: null,
  activeView: 'cashier',
  currentCategory: 'Semua',
  discountPercent: 0,
  taxRate: 10,
  serviceChargeRate: 5,
  paymentMethod: 'Cash',
  cameraScanner: null,
  activeProductEdit: null,
  currentUser: { role: 'admin', name: 'Admin / Owner' },
  authSettings: { required: false, adminPin: '1234', cashierPin: '0000' },
  authPendingAction: null,
  targetAuthRole: 'admin',
  pinInput: ''
};

// Initialization on DOM Loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Database
  try {
    await DB.init();
    await loadInitialData();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    alert('Gagal menginisialisasi database lokal.');
  }

  // Register PWA Service Worker
  registerServiceWorker();

  // Initialize Routing & System Clock
  initClock();
  setupEventListeners();
  switchView('cashier');

  // Load digital state indicators
  updateConnectionStatus();
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
});

// Update online/offline connection state indicator
function updateConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  if (navigator.onLine) {
    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-success-500 animate-pulse"></span> Online`;
    statusEl.className = 'flex items-center gap-1.5 font-medium text-success-500';
  } else {
    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-danger-500"></span> Offline`;
    statusEl.className = 'flex items-center gap-1.5 font-medium text-danger-500';
  }
}

// Service Worker Registration
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Relative scope and path for GitHub Pages compatibility
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('PWA Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  }

  // Handle PWA Install prompt
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
    const mInstallBadge = document.getElementById('m-menu-install-badge');
    if (mInstallBadge) {
      mInstallBadge.innerText = 'Tersedia';
      mInstallBadge.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse';
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', triggerPWAInstall);
  }

  window.addEventListener('appinstalled', () => {
    console.log('POS App installed to homescreen!');
    if (installBtn) installBtn.classList.add('hidden');
    const mInstallBadge = document.getElementById('m-menu-install-badge');
    if (mInstallBadge) {
      mInstallBadge.innerText = 'Terpasang';
      mInstallBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700';
    }
  });

  // Inisialisasi modul CloudDB jika ada
  if (typeof CloudDB !== 'undefined') {
    initCloudModule();
  }
}

// Global PWA Trigger function for Mobile Menu & Header
let deferredPrompt = null;
function triggerPWAInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(({ outcome }) => {
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) installBtn.classList.add('hidden');
      const mInstallBadge = document.getElementById('m-menu-install-badge');
      if (mInstallBadge) {
        mInstallBadge.innerText = 'Terpasang';
        mInstallBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700';
      }
    });
  } else {
    showToast('Untuk pasang di HP: buka menu browser (titik 3 di Chrome atau tombol Share di Safari) lalu pilih "Tambahkan ke Layar Utama" (Add to Home screen).', 'info');
  }
}

// Database Loading
async function loadInitialData() {
  State.products = await DB.getProducts();
  State.categories = await DB.getCategories();
  State.storeInfo = await DB.getSettings('store_info');

  if (State.storeInfo) {
    State.taxRate = State.storeInfo.taxRate ?? 10;
    State.serviceChargeRate = State.storeInfo.serviceCharge ?? 0;
    const sNameEl = document.getElementById('sidebar-store-name');
    if (sNameEl) sNameEl.innerText = State.storeInfo.name;
    const taxEl = document.getElementById('label-cart-tax');
    if (taxEl) taxEl.innerText = `${State.taxRate + State.serviceChargeRate}%`;
  }

  // Update store switcher and branding UI
  updateStoreBrandingUI();

  // Load Auth / PIN Settings
  try {
    State.authSettings = await DB.getAuthSettings();
    const savedRole = sessionStorage.getItem('pos_user_role');
    if (savedRole === 'cashier' || (State.authSettings?.required && !savedRole)) {
      State.currentUser = { role: 'cashier', name: 'Kasir Utama' };
    } else {
      State.currentUser = { role: 'admin', name: 'Admin / Owner' };
    }
    updateAuthUI();
  } catch (err) {
    console.warn('Failed to load auth settings:', err);
  }

  renderCategories();
  renderProducts();
  populateCategorySelects();

  // Load saved cart state from localStorage
  const savedCart = localStorage.getItem('pos_cart_cache');
  if (savedCart) {
    try {
      const parsed = JSON.parse(savedCart);
      State.cart = parsed.map(item => {
        const product = State.products.find(p => p.id === item.productId);
        if (product) {
          return { product, quantity: item.quantity };
        }
        return null;
      }).filter(Boolean);
      renderCart();
    } catch (err) {
      console.error('Failed to load cart cache:', err);
    }
  }
}

// Digital clock ticking
function initClock() {
  const clockEl = document.getElementById('digital-clock');
  const updateClock = () => {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('id-ID', { hour12: false });
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// View switcher / Routing (SPA)
function switchView(viewName) {
  // If desktop screen size and trying to open mobile cart view, redirect to cashier
  if (window.innerWidth >= 768 && viewName === 'cart') {
    viewName = 'cashier';
  }

  // Auth Guard: Kasir hanya boleh mengakses kasir & keranjang
  if ((viewName === 'products' || viewName === 'reports') && State.currentUser?.role === 'cashier') {
    showToast('Akses dibatasi untuk Kasir. Masukkan PIN Admin untuk membuka menu ini.', 'info');
    openAuthModal('admin', () => switchView(viewName));
    return;
  }

  State.activeView = viewName;
  
  // Hide all main view screens
  document.getElementById('view-cashier').classList.add('hidden');
  document.getElementById('view-products').classList.add('hidden');
  document.getElementById('view-reports').classList.add('hidden');

  // Handle cashier sections for mobile (products list vs cart list)
  const prodSec = document.getElementById('cashier-products-section');
  const cartSec = document.getElementById('cashier-cart-section');

  // Remove active styling from desktop nav buttons
  const navButtons = {
    cashier: document.getElementById('btn-nav-cashier'),
    products: document.getElementById('btn-nav-products'),
    reports: document.getElementById('btn-nav-reports'),
    settings: document.getElementById('btn-nav-settings')
  };

  Object.keys(navButtons).forEach((key) => {
    if (navButtons[key]) {
      navButtons[key].className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 text-slate-400 hover:bg-slate-800/50 hover:text-white";
    }
  });

  // Remove active styling from mobile nav buttons
  const mNavButtons = {
    cashier: document.getElementById('btn-m-nav-cashier'),
    cart: document.getElementById('btn-m-nav-cart'),
    products: document.getElementById('btn-m-nav-products'),
    reports: document.getElementById('btn-m-nav-reports'),
    menu: document.getElementById('btn-m-nav-menu')
  };

  Object.keys(mNavButtons).forEach((key) => {
    if (mNavButtons[key]) {
      mNavButtons[key].className = "flex flex-col items-center justify-center flex-1 py-1 text-slate-400 relative";
    }
  });

  // Show/Hide views based on viewName
  if (viewName === 'cashier') {
    document.getElementById('view-cashier').classList.remove('hidden');
    prodSec.classList.remove('hidden');
    prodSec.classList.add('flex');
    cartSec.classList.add('hidden');
    cartSec.classList.remove('flex', 'w-full');
    
    if (navButtons.cashier) navButtons.cashier.className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-primary-600 text-white shadow-glow-primary";
    if (mNavButtons.cashier) mNavButtons.cashier.className = "flex flex-col items-center justify-center flex-1 py-1 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Mesin Kasir";
    renderProducts();
  } else if (viewName === 'cart') {
    document.getElementById('view-cashier').classList.remove('hidden');
    prodSec.classList.add('hidden');
    prodSec.classList.remove('flex');
    cartSec.classList.remove('hidden');
    cartSec.classList.add('flex', 'w-full');
    
    if (mNavButtons.cart) mNavButtons.cart.className = "flex flex-col items-center justify-center flex-1 py-1 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Keranjang";
    renderCart();
  } else if (viewName === 'products') {
    document.getElementById('view-products').classList.remove('hidden');
    if (navButtons.products) navButtons.products.className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-primary-600 text-white shadow-glow-primary";
    if (mNavButtons.products) mNavButtons.products.className = "flex flex-col items-center justify-center flex-1 py-1 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Kelola Produk";
    renderInventoryTable();
  } else if (viewName === 'reports') {
    document.getElementById('view-reports').classList.remove('hidden');
    if (navButtons.reports) navButtons.reports.className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-primary-600 text-white shadow-glow-primary";
    if (mNavButtons.reports) mNavButtons.reports.className = "flex flex-col items-center justify-center flex-1 py-1 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Laporan Penjualan";
    
    // Set default dates for report (using local date string)
    const todayStr = getLocalDateString(0);
    const sevenDaysAgoStr = getLocalDateString(-6);
    document.getElementById('filter-date-start').value = sevenDaysAgoStr;
    document.getElementById('filter-date-end').value = todayStr;
    
    loadReportData();
  }
}

// ----------------------------------------------------
// UI RENDERING - CASHIER VIEW
// ----------------------------------------------------

function renderCategories() {
  const container = document.getElementById('category-tabs');
  if (!container) return;

  let html = `
    <button onclick="selectCategory('Semua')" class="px-5 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all border ${
      State.currentCategory === 'Semua' 
        ? 'bg-primary-600 border-primary-500 text-white shadow-glow-primary' 
        : 'bg-dark-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
    }">Semua Kategori</button>
  `;

  State.categories.forEach(cat => {
    const isActive = State.currentCategory === cat.name;
    html += `
      <button onclick="selectCategory('${cat.name}')" class="px-5 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all border ${
        isActive 
          ? 'bg-primary-600 border-primary-500 text-white shadow-glow-primary' 
          : 'bg-dark-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
      }">${cat.name}</button>
    `;
  });

  container.innerHTML = html;
}

function selectCategory(categoryName) {
  State.currentCategory = categoryName;
  renderCategories();
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  const emptyState = document.getElementById('products-empty-state');
  if (!grid) return;

  const searchQuery = document.getElementById('search-product').value.toLowerCase().trim();
  
  // Filter products by category and search query
  const filteredProducts = State.products.filter(p => {
    const matchesCategory = State.currentCategory === 'Semua' || p.category === State.currentCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery) || p.code.toLowerCase().includes(searchQuery);
    return matchesCategory && matchesSearch;
  });

  if (filteredProducts.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  let html = '';
  filteredProducts.forEach(p => {
    const colorClasses = {
      amber: 'from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400',
      orange: 'from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-400',
      yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/30 text-yellow-400',
      green: 'from-green-500/20 to-green-600/10 border-green-500/30 text-green-400',
      emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400',
      red: 'from-red-500/20 to-red-600/10 border-red-500/30 text-red-400',
      rose: 'from-rose-500/20 to-rose-600/10 border-rose-500/30 text-rose-400',
      pink: 'from-pink-500/20 to-pink-600/10 border-pink-500/30 text-pink-400',
      indigo: 'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30 text-indigo-400'
    };

    const accentColor = colorClasses[p.color] || colorClasses.indigo;

    html += `
      <div onclick="addToCart(${p.id})" class="group cursor-pointer bg-dark-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 flex flex-col justify-between h-48 transition-all hover:-translate-y-1 hover:shadow-lg relative overflow-hidden">
        <!-- Accent Glow background decoration -->
        <div class="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${accentColor} opacity-5 blur-2xl group-hover:opacity-10 transition-opacity"></div>
        
        <!-- Product Icon / Badge -->
        <div class="flex justify-between items-start">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${accentColor} flex items-center justify-center border">
            <i class="fa-solid ${p.icon || 'fa-tag'} text-lg"></i>
          </div>
          <span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700/80 text-slate-400">
            #${p.code}
          </span>
        </div>

        <!-- Product Info -->
        <div class="mt-4 space-y-1">
          <h4 class="font-bold text-slate-200 text-sm group-hover:text-white line-clamp-2 leading-snug">${p.name}</h4>
          <div class="flex justify-between items-center pt-1 border-t border-slate-800/50 mt-1">
            <span class="font-extrabold text-sm text-primary-500">Rp ${p.price.toLocaleString('id-ID')}</span>
            <span class="text-[10px] ${p.stock <= 5 ? 'text-danger-500 font-bold' : 'text-slate-500'}">Stok: ${p.stock}</span>
          </div>
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;
}

// ----------------------------------------------------
// CART SYSTEM OPERATIONS
// ----------------------------------------------------

function addToCart(productId) {
  const product = State.products.find(p => p.id === productId);
  if (!product) return;

  if (product.stock <= 0) {
    alert('Stok produk habis!');
    return;
  }

  const existingItem = State.cart.find(item => item.product.id === product.id);

  if (existingItem) {
    if (existingItem.quantity >= product.stock) {
      alert(`Stok tidak mencukupi. Stok maksimal: ${product.stock}`);
      return;
    }
    existingItem.quantity += 1;
  } else {
    State.cart.push({
      product: product,
      quantity: 1,
      discount: 0, // item discount amount or percentage if needed
      notes: ''
    });
  }

  renderCart();
  // Trigger a soft sound/feedback if desired
}

function updateCartQty(productId, amount) {
  const item = State.cart.find(i => i.product.id === productId);
  if (!item) return;

  const newQty = item.quantity + amount;

  if (newQty <= 0) {
    State.cart = State.cart.filter(i => i.product.id !== productId);
  } else {
    if (newQty > item.product.stock) {
      alert(`Stok tidak mencukupi. Stok maksimal: ${item.product.stock}`);
      return;
    }
    item.quantity = newQty;
  }

  renderCart();
}

function removeCartItem(productId) {
  State.cart = State.cart.filter(i => i.product.id !== productId);
  renderCart();
}

function clearCart() {
  State.cart = [];
  State.discountPercent = 0;
  localStorage.removeItem('pos_cart_cache');
  renderCart();
}

function applyDiscountPrompt() {
  const current = State.discountPercent;
  const input = prompt("Masukkan diskon belanja global (%):", current);
  if (input === null) return;
  
  const val = parseInt(input);
  if (isNaN(val) || val < 0 || val > 100) {
    alert("Masukkan persentase diskon yang valid (0 - 100).");
    return;
  }

  State.discountPercent = val;
  document.getElementById('label-cart-discount').innerText = `${val}%`;
  renderCart();
}

function toggleTaxServicePrompt() {
  const useTax = confirm("Aktifkan Pajak (10%) & Layanan (5%)?");
  if (useTax) {
    State.taxRate = 10;
    State.serviceChargeRate = 5;
    document.getElementById('label-cart-tax').innerText = '15%';
  } else {
    State.taxRate = 0;
    State.serviceChargeRate = 0;
    document.getElementById('label-cart-tax').innerText = '0%';
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const btnCheckout = document.getElementById('btn-checkout');
  if (!container) return;

  // Update mobile cart badge
  const totalQty = State.cart.reduce((sum, item) => sum + item.quantity, 0);
  const badgeEl = document.getElementById('cart-badge');
  if (badgeEl) {
    if (totalQty > 0) {
      badgeEl.innerText = totalQty;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  if (State.cart.length === 0) {
    container.innerHTML = `
      <div id="cart-empty-state" class="flex flex-col items-center justify-center h-full text-slate-500 py-10 animate-[fadeIn_0.15s_ease-out]">
        <i class="fa-solid fa-cart-shopping text-4xl mb-3 text-slate-600"></i>
        <p class="text-sm">Keranjang masih kosong</p>
        <span class="text-xs text-slate-600 mt-1">Klik item atau scan kode QR</span>
      </div>
    `;
    btnCheckout.disabled = true;
    
    document.getElementById('cart-subtotal').innerText = 'Rp 0';
    document.getElementById('cart-discount-value').innerText = '- Rp 0';
    document.getElementById('cart-tax-value').innerText = 'Rp 0';
    document.getElementById('cart-total').innerText = 'Rp 0';
    return;
  }

  btnCheckout.disabled = false;

  let html = '';
  let subtotal = 0;

  State.cart.forEach(item => {
    const itemTotal = item.product.price * item.quantity;
    subtotal += itemTotal;

    html += `
      <div class="bg-dark-950/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3 animate-[fadeIn_0.15s_ease-out]">
        <div class="min-w-0 flex-grow">
          <h5 class="font-bold text-white text-xs truncate">${item.product.name}</h5>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-[10px] text-slate-500 font-mono">Rp ${item.product.price.toLocaleString('id-ID')}</span>
            <span class="text-[10px] text-primary-500 font-extrabold">Rp ${itemTotal.toLocaleString('id-ID')}</span>
          </div>
        </div>

        <!-- Quantity Adjuster -->
        <div class="flex items-center gap-2.5 flex-shrink-0">
          <button onclick="updateCartQty(${item.product.id}, -1)" class="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center text-xs transition-colors">
            <i class="fa-solid fa-minus text-[9px]"></i>
          </button>
          <span class="font-bold text-white text-xs w-4 text-center">${item.quantity}</span>
          <button onclick="updateCartQty(${item.product.id}, 1)" class="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center text-xs transition-colors">
            <i class="fa-solid fa-plus text-[9px]"></i>
          </button>
          
          <!-- Delete button -->
          <button onclick="removeCartItem(${item.product.id})" class="text-slate-600 hover:text-danger-500 transition-colors ml-1.5">
            <i class="fa-regular fa-trash-can text-sm"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Calculators
  const discountVal = Math.round(subtotal * (State.discountPercent / 100));
  const postDiscountSub = subtotal - discountVal;
  
  const taxVal = Math.round(postDiscountSub * (State.taxRate / 100));
  const serviceVal = Math.round(postDiscountSub * (State.serviceChargeRate / 100));
  const totalTaxSvc = taxVal + serviceVal;
  
  const totalBill = postDiscountSub + totalTaxSvc;

  document.getElementById('cart-subtotal').innerText = `Rp ${subtotal.toLocaleString('id-ID')}`;
  document.getElementById('cart-discount-value').innerText = `- Rp ${discountVal.toLocaleString('id-ID')}`;
  document.getElementById('cart-tax-value').innerText = `Rp ${totalTaxSvc.toLocaleString('id-ID')}`;
  document.getElementById('cart-total').innerText = `Rp ${totalBill.toLocaleString('id-ID')}`;

  // Save cart state to localStorage
  localStorage.setItem('pos_cart_cache', JSON.stringify(State.cart.map(item => ({
    productId: item.product.id,
    quantity: item.quantity
  }))));
}

// ----------------------------------------------------
// INTEGRATION OF BARCODE / QR SCANNING
// ----------------------------------------------------

// 1. Camera Scanning (html5-qrcode wrapper)
function openCameraScanner() {
  const modal = document.getElementById('modal-scanner');
  modal.classList.remove('hidden');

  // Instantiate HTML5 QR code scanner inside modal reader
  State.cameraScanner = new Html5Qrcode("scanner-reader");

  const config = { fps: 15, qrbox: { width: 250, height: 250 } };

  State.cameraScanner.start(
    { facingMode: "environment" },
    config,
    onQrScanSuccess,
    onQrScanError
  ).catch(err => {
    console.error("Gagal memulai kamera:", err);
    alert("Izin kamera ditolak atau kamera tidak ditemukan.");
    closeCameraScanner();
  });
}

function closeCameraScanner() {
  const modal = document.getElementById('modal-scanner');
  modal.classList.add('hidden');

  if (State.cameraScanner) {
    State.cameraScanner.stop().then(() => {
      State.cameraScanner = null;
    }).catch(err => console.error("Gagal mematikan kamera:", err));
  }
}

function onQrScanSuccess(decodedText) {
  console.log(`Scan QR sukses: ${decodedText}`);
  handleScannedCode(decodedText);
  closeCameraScanner();
}

function onQrScanError(err) {
  // Silent logs to avoid verbose terminal logs on scan failures
}

// Match the scanned code against products
async function handleScannedCode(code) {
  // Flash effect or trigger visual notification
  const cleanCode = code.trim();
  const product = await DB.getProductByCode(cleanCode);

  if (product) {
    addToCart(product.id);
    
    // Alert via brief UI toast
    showToast(`Produk ditambahkan: ${product.name}`);
  } else {
    // Check if we are in products list view to maybe auto-fill the code form
    if (State.activeView === 'products' && document.getElementById('modal-product').classList.contains('hidden') === false) {
      document.getElementById('product-code').value = cleanCode;
      showToast(`Kode QR diisi: ${cleanCode}`);
    } else {
      alert(`Kode QR/Barcode tidak dikenali: "${cleanCode}"`);
    }
  }
}

// Simple dynamic Toast notification using robust transitions
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-slate-900 border border-primary-500/50 shadow-glow-primary text-white font-semibold text-xs py-3 px-6 rounded-xl z-50 flex items-center gap-2 transition-all duration-300 opacity-0 transform translate-y-2';
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-success-500"></i> ${message}`;
  
  document.body.appendChild(toast);
  
  // Trigger transition in next tick
  setTimeout(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
  }, 10);
  
  // Trigger exit and removal
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2500);
}

// 2. Hardware Scanner Gun support: capturing key inputs
let scanBuffer = '';
let lastKeyTime = Date.now();

window.addEventListener('keypress', (e) => {
  // If active element is a form input inside the modals, ignore global scanner gun addition
  const activeTag = document.activeElement.tagName;
  const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
  
  // Exception: Let's allow the search-product input to use scanning directly
  const isSearchInput = document.activeElement.id === 'search-product';

  if (isInputActive && !isSearchInput) {
    // User is editing forms, allow keypresses normally without scanner gun interception
    return;
  }

  const currentTime = Date.now();
  
  // Set buffer threshold: keypresses within 45ms represent scanner gun outputs
  if (currentTime - lastKeyTime > 45) {
    scanBuffer = '';
  }
  
  lastKeyTime = currentTime;

  if (e.key === 'Enter') {
    if (scanBuffer.length >= 2) {
      e.preventDefault();
      console.log(`Scanner Gun mendeteksi kode: ${scanBuffer}`);
      handleScannedCode(scanBuffer);
      scanBuffer = '';
      
      // If we were in the search box, clear it
      if (isSearchInput) {
        document.getElementById('search-product').value = '';
      }
    }
  } else {
    if (e.key.length === 1) {
      scanBuffer += e.key;
    }
  }
});

// Setup General Input search events
function setupEventListeners() {
  const searchInput = document.getElementById('search-product');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderProducts();
    });
  }

  const searchInvInput = document.getElementById('search-inventory');
  if (searchInvInput) {
    searchInvInput.addEventListener('input', () => {
      renderInventoryTable();
    });
  }
}

// ----------------------------------------------------
// PAYMENT & CHECKOUT FLOW
// ----------------------------------------------------

let checkoutTotals = {
  subtotal: 0,
  discount: 0,
  taxSvc: 0,
  total: 0
};

function openPaymentModal() {
  if (State.cart.length === 0) return;

  const modal = document.getElementById('modal-payment');
  modal.classList.remove('hidden');

  // Compute exact totals
  let subtotal = 0;
  State.cart.forEach(item => {
    subtotal += item.product.price * item.quantity;
  });

  const discountVal = Math.round(subtotal * (State.discountPercent / 100));
  const postDiscountSub = subtotal - discountVal;
  
  const taxVal = Math.round(postDiscountSub * (State.taxRate / 100));
  const serviceVal = Math.round(postDiscountSub * (State.serviceChargeRate / 100));
  const totalTaxSvc = taxVal + serviceVal;
  
  const totalBill = postDiscountSub + totalTaxSvc;

  checkoutTotals = {
    subtotal: subtotal,
    discount: discountVal,
    taxSvc: totalTaxSvc,
    total: totalBill
  };

  document.getElementById('payment-bill-amount').innerText = `Rp ${totalBill.toLocaleString('id-ID')}`;
  
  // Set default method
  selectPaymentMethod('Cash');

  // Generate quick cash buttons
  generateQuickCashButtons(totalBill);
}

function closePaymentModal() {
  document.getElementById('modal-payment').classList.add('hidden');
}

function selectPaymentMethod(method) {
  State.paymentMethod = method;

  const btnCash = document.getElementById('btn-pay-cash');
  const btnQris = document.getElementById('btn-pay-qris');
  const btnCard = document.getElementById('btn-pay-card');
  const fields = document.getElementById('cash-payment-fields');
  const fastCash = document.getElementById('fast-cash-container');

  // Reset stylings
  [btnCash, btnQris, btnCard].forEach(btn => {
    btn.className = "flex flex-col items-center justify-center p-3 rounded-xl border border-slate-800 hover:border-slate-700 text-slate-400 font-bold text-sm gap-1.5 transition-all";
  });

  if (method === 'Cash') {
    btnCash.className = "flex flex-col items-center justify-center p-3 rounded-xl border border-primary-500 bg-primary-600/10 text-white font-bold text-sm gap-1.5 transition-all shadow-md";
    fields.classList.remove('hidden');
    fastCash.classList.remove('hidden');
    document.getElementById('input-cash-amount').value = '';
    document.getElementById('payment-change-amount').innerText = 'Rp 0';
  } else {
    fields.classList.add('hidden');
    // For card/qris, cash received equals the exact total bill
    if (method === 'QRIS') {
      btnQris.className = "flex flex-col items-center justify-center p-3 rounded-xl border border-primary-500 bg-primary-600/10 text-white font-bold text-sm gap-1.5 transition-all shadow-md";
    } else {
      btnCard.className = "flex flex-col items-center justify-center p-3 rounded-xl border border-primary-500 bg-primary-600/10 text-white font-bold text-sm gap-1.5 transition-all shadow-md";
    }
  }
}

function calculateChange() {
  const cashPaid = parseInt(document.getElementById('input-cash-amount').value) || 0;
  const total = checkoutTotals.total;
  const change = cashPaid - total;

  const changeEl = document.getElementById('payment-change-amount');
  if (change < 0) {
    changeEl.innerText = `Kurang Rp ${Math.abs(change).toLocaleString('id-ID')}`;
    changeEl.className = 'text-xl font-extrabold text-danger-500';
  } else {
    changeEl.innerText = `Rp ${change.toLocaleString('id-ID')}`;
    changeEl.className = 'text-xl font-extrabold text-success-500';
  }
}

function generateQuickCashButtons(billAmount) {
  const container = document.getElementById('quick-cash-grid');
  if (!container) return;

  // Compute common Indonesian cash denoms greater than or equal to billAmount
  const denoms = [10000, 20000, 50000, 100000, 150000, 200000];
  const list = [billAmount]; // Option 1: Uang Pas

  denoms.forEach(d => {
    if (d > billAmount && !list.includes(d)) {
      list.push(d);
    }
  });

  // Sort and display top 4 suggestions
  const sorted = list.sort((a, b) => a - b).slice(0, 4);

  let html = '';
  sorted.forEach((amt, idx) => {
    const isExact = amt === billAmount;
    html += `
      <button onclick="setFastCashAmount(${amt})" class="py-2.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 font-semibold hover:border-slate-700 transition-colors text-xs">
        ${isExact ? 'Uang Pas' : `Rp ${amt.toLocaleString('id-ID')}`}
      </button>
    `;
  });

  container.innerHTML = html;
}

function setFastCashAmount(amount) {
  document.getElementById('input-cash-amount').value = amount;
  calculateChange();
}

async function submitTransaction() {
  const total = checkoutTotals.total;
  let cashPaid = total;
  let change = 0;

  if (State.paymentMethod === 'Cash') {
    cashPaid = parseInt(document.getElementById('input-cash-amount').value) || 0;
    if (cashPaid < total) {
      alert("Pembayaran kurang! Harap periksa kembali uang tunai yang diterima.");
      return;
    }
    change = cashPaid - total;
  }

  // Create Transaction Record
  const now = new Date();
  const txId = `TR-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  
  const transaction = {
    id: txId,
    timestamp: now.getTime(),
    items: State.cart.map(item => ({
      productId: item.product.id,
      name: item.product.name,
      price: item.product.price,
      cost: item.product.cost || 0,
      quantity: item.quantity,
      subtotal: item.product.price * item.quantity
    })),
    subtotal: checkoutTotals.subtotal,
    discount: checkoutTotals.discount,
    taxSvc: checkoutTotals.taxSvc,
    total: total,
    paymentMethod: State.paymentMethod,
    amountPaid: cashPaid,
    change: change
  };

  try {
    // Save to Database
    await DB.saveTransaction(transaction);

    // Deduct stocks for Sempol shared inventory if any
    let sempolSticksDeducted = 0;
    State.cart.forEach(item => {
      if (item.product.isSempol) {
        sempolSticksDeducted += (item.product.piecesPerUnit || 1) * item.quantity;
      }
    });

    if (sempolSticksDeducted > 0) {
      // Deduct from ALL sempol products in the shared inventory
      const currentSempolStock = await DB.getSempolStock();
      const newSempolStock = Math.max(0, currentSempolStock - sempolSticksDeducted);
      await DB.updateSempolStock(newSempolStock);
    }

    // Deduct stocks for non-sempol items
    for (const item of State.cart) {
      if (!item.product.isSempol) {
        const prod = State.products.find(p => p.id === item.product.id);
        if (prod) {
          prod.stock = Math.max(0, prod.stock - item.quantity);
          await DB.saveProduct(prod);
        }
      }
    }

    // Refresh data
    await loadInitialData();

    // Render receipt view modal
    renderReceipt(transaction);

    // Reset keranjang
    clearCart();
    closePaymentModal();

  } catch (err) {
    console.error('Checkout failed:', err);
    alert('Gagal memproses transaksi.');
  }
}

function renderReceipt(tx) {
  const preview = document.getElementById('receipt-preview');
  const printArea = document.getElementById('print-area');
  const modal = document.getElementById('modal-receipt');
  
  const shopName = State.storeInfo ? State.storeInfo.name : 'Ruang Temu';
  const shopAddr = State.storeInfo ? State.storeInfo.address : 'Jakarta, Indonesia';
  const shopPhone = State.storeInfo ? State.storeInfo.phone : '0812-9876-5432';
  const footer = State.storeInfo ? State.storeInfo.receiptFooter : 'Terima kasih atas kunjungan Anda!';
  
  const dateStr = new Date(tx.timestamp).toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  let itemsHtml = '';
  tx.items.forEach(item => {
    // Left side: Qty x Price
    const qtyPrice = `  ${item.quantity} x Rp ${item.price.toLocaleString('id-ID')}`;
    // Right side: Subtotal
    const itemSubtotal = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
    
    itemsHtml += `${item.name}\n${formatReceiptLine(qtyPrice, itemSubtotal, 40)}\n`;
  });

  // Split, wrap, and dynamically center-align text lines for thermal roll layout (40 cols)
  const nameLine = shopName.split(/\r?\n/).map(line => wrapAndCenter(line.toUpperCase())).join('\n');
  const addrLines = shopAddr.split(/\r?\n/).map(line => wrapAndCenter(line)).join('\n');
  const phoneLine = wrapAndCenter(`Telp: ${shopPhone}`);
  const footerLines = footer.split(/\r?\n/).map(line => wrapAndCenter(line)).join('\n');

  const metadataLines = [
    formatReceiptLine("No Nota  :", tx.id, 40),
    formatReceiptLine("Tanggal  :", dateStr, 40),
    formatReceiptLine("Kasir    :", "Administrator", 40)
  ].join('\n');

  const summaryLines = [
    formatReceiptLine("Subtotal", `Rp ${tx.subtotal.toLocaleString('id-ID')}`, 40),
    formatReceiptLine("Diskon", `-Rp ${tx.discount.toLocaleString('id-ID')}`, 40),
    formatReceiptLine("Pajak & Layanan", `Rp ${tx.taxSvc.toLocaleString('id-ID')}`, 40)
  ].join('\n');

  const totalLine = formatReceiptLine("TOTAL", `Rp ${tx.total.toLocaleString('id-ID')}`, 40);
  const paymentLine = formatReceiptLine(`Bayar (${tx.paymentMethod})`, `Rp ${tx.amountPaid.toLocaleString('id-ID')}`, 40);
  const changeLine = formatReceiptLine("Kembalian", `Rp ${tx.change.toLocaleString('id-ID')}`, 40);

  const rawReceipt = `========================================
${nameLine}
${addrLines}
${phoneLine}
----------------------------------------
${metadataLines}
----------------------------------------
${itemsHtml.trim()}
----------------------------------------
${summaryLines}
----------------------------------------
${totalLine}
========================================
${paymentLine}
${changeLine}
========================================
${footerLines}
========================================`;

  const receiptHtml = `<pre class="whitespace-pre font-mono text-black leading-relaxed text-[11px]">${rawReceipt}</pre>`;
  
  if (preview) preview.innerHTML = receiptHtml;
  if (printArea) printArea.innerHTML = receiptHtml;
  
  modal.classList.remove('hidden');
}

function closeReceiptModal() {
  document.getElementById('modal-receipt').classList.add('hidden');
  switchView('cashier');
}

// ----------------------------------------------------
// PRODUCT MANAGEMENT VIEW
// ----------------------------------------------------

async function renderInventoryTable() {
  const tbody = document.getElementById('inventory-table-body');
  const mobList = document.getElementById('inventory-mobile-list');
  if (!tbody) return;

  const searchQuery = document.getElementById('search-inventory').value.toLowerCase().trim();
  const products = await DB.getProducts();

  const filtered = products.filter(p => {
    return p.name.toLowerCase().includes(searchQuery) || p.code.toLowerCase().includes(searchQuery);
  });

  // Render Desktop view
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center text-slate-500 font-semibold">
          Tidak ada produk terdaftar dalam katalog
        </td>
      </tr>
    `;
  } else {
    let html = '';
    filtered.forEach(p => {
      html += `
        <tr class="border-b border-slate-800 hover:bg-slate-900/20 text-xs">
          <td class="p-4 pl-6 flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400">
              <i class="fa-solid ${p.icon || 'fa-tag'}"></i>
            </div>
            <div>
              <div class="font-bold text-slate-200 text-sm">${p.name}</div>
            </div>
          </td>
          <td class="p-4 text-slate-400 font-medium">${p.category}</td>
          <td class="p-4 font-mono text-slate-400 font-semibold">${p.code}</td>
          <td class="p-4 text-right font-medium">Rp ${p.cost.toLocaleString('id-ID')}</td>
          <td class="p-4 text-right font-bold text-primary-500">Rp ${p.price.toLocaleString('id-ID')}</td>
          <td class="p-4 text-center">
            <span class="px-2 py-0.5 rounded-full font-bold text-[10px] ${p.stock <= 5 ? 'bg-danger-500/20 text-danger-400' : 'bg-success-500/20 text-success-400'}">
              ${p.stock} ${p.isSempol ? 'tusuk' : 'pcs'}
            </span>
          </td>
          <td class="p-4 text-right pr-6">
            <div class="flex justify-end gap-2">
              <button onclick="editProduct(${p.id})" class="p-2 bg-slate-800 hover:bg-slate-700 text-amber-500 rounded-lg transition-colors border border-slate-700/50">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="deleteProductHandler(${p.id})" class="p-2 bg-slate-800 hover:bg-slate-700 text-danger-500 rounded-lg transition-colors border border-slate-700/50">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // Render Mobile view
  if (mobList) {
    if (filtered.length === 0) {
      mobList.innerHTML = `
        <div class="py-8 text-center text-slate-500 font-semibold text-xs">
          Tidak ada produk terdaftar dalam katalog
        </div>
      `;
    } else {
      let mHtml = '';
      filtered.forEach(p => {
        mHtml += `
          <div class="py-4 flex items-center justify-between gap-4 animate-[fadeIn_0.15s_ease-out]">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 flex-shrink-0">
                <i class="fa-solid ${p.icon || 'fa-tag'}"></i>
              </div>
              <div class="min-w-0">
                <div class="font-bold text-slate-200 text-sm truncate">${p.name}</div>
                <div class="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                  <span class="bg-slate-800 px-1.5 py-0.5 rounded font-medium">${p.category}</span>
                  <span class="font-mono text-slate-500">QR: ${p.code}</span>
                </div>
              </div>
            </div>
            
            <div class="flex items-center gap-4 flex-shrink-0">
              <div class="text-right">
                <div class="font-extrabold text-sm text-primary-500">Rp ${p.price.toLocaleString('id-ID')}</div>
                <div class="text-[10px] text-slate-500 mt-0.5">Stok: <span class="font-bold text-slate-300">${p.stock} ${p.isSempol ? 'tusuk' : 'pcs'}</span></div>
              </div>
              
              <div class="flex gap-1.5">
                <button onclick="editProduct(${p.id})" class="w-8 h-8 bg-slate-800 hover:bg-slate-700 text-amber-500 rounded-lg flex items-center justify-center transition-colors border border-slate-700/50">
                  <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button onclick="deleteProductHandler(${p.id})" class="w-8 h-8 bg-slate-800 hover:bg-slate-700 text-danger-500 rounded-lg flex items-center justify-center transition-colors border border-slate-700/50">
                  <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      mobList.innerHTML = mHtml;
    }
  }
}

function openProductModal(mode, prodId = null) {
  if (!requireAdmin(() => openProductModal(mode, prodId))) return;
  const modal = document.getElementById('modal-product');
  const title = document.getElementById('product-modal-title');
  const form = document.getElementById('form-product');

  form.reset();
  document.getElementById('product-id').value = '';
  State.activeProductEdit = null;

  const isSempolStore = DB.getActiveStoreId() === 'store_sempol';
  const sempolCheckbox = document.getElementById('product-is-sempol');
  if (sempolCheckbox) sempolCheckbox.checked = isSempolStore;
  const prodPieces = document.getElementById('product-pieces');
  if (prodPieces) prodPieces.value = 1;
  const prodUnitCost = document.getElementById('product-unit-cost');
  if (prodUnitCost) prodUnitCost.value = 400;

  if (mode === 'add') {
    title.innerText = "Tambah Produk Baru";
    if (isSempolStore) {
      document.getElementById('product-color').value = 'amber';
      document.getElementById('product-icon').value = 'fa-utensils';
    }
  } else {
    title.innerText = "Edit Produk";
  }

  toggleSempolFields();
  modal.classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
}

function toggleSempolFields() {
  const checkbox = document.getElementById('product-is-sempol');
  if (!checkbox) return;
  const isChecked = checkbox.checked;
  const fields = document.getElementById('sempol-product-fields');
  const hint = document.getElementById('sempol-calc-hint');
  if (fields) {
    if (isChecked) {
      fields.classList.remove('hidden');
    } else {
      fields.classList.add('hidden');
    }
  }
  if (hint) {
    if (isChecked) {
      hint.classList.remove('hidden');
      calculateProductCostFromUnit();
    } else {
      hint.classList.add('hidden');
    }
  }
}

function calculateProductCostFromUnit() {
  const sempolCheckbox = document.getElementById('product-is-sempol');
  if (!sempolCheckbox || !sempolCheckbox.checked) return;
  const pieces = Number(document.getElementById('product-pieces').value) || 1;
  const unitCost = Number(document.getElementById('product-unit-cost').value) || 0;
  if (pieces > 0 && unitCost > 0) {
    document.getElementById('product-cost').value = pieces * unitCost;
  }
}

function populateCategorySelects() {
  const select = document.getElementById('product-category');
  if (!select) return;

  let html = '';
  State.categories.forEach(cat => {
    html += `<option value="${cat.name}">${cat.name}</option>`;
  });
  select.innerHTML = html;
}

async function editProduct(id) {
  const prod = State.products.find(p => p.id === id);
  if (!prod) return;

  openProductModal('edit');

  document.getElementById('product-id').value = prod.id;
  document.getElementById('product-name').value = prod.name;
  document.getElementById('product-category').value = prod.category;
  document.getElementById('product-code').value = prod.code;
  document.getElementById('product-cost').value = prod.cost || 0;
  document.getElementById('product-price').value = prod.price;
  document.getElementById('product-stock').value = prod.stock;
  document.getElementById('product-color').value = prod.color || 'indigo';
  document.getElementById('product-icon').value = prod.icon || 'fa-tag';

  const sempolCheckbox = document.getElementById('product-is-sempol');
  if (sempolCheckbox) sempolCheckbox.checked = !!prod.isSempol;
  const prodPieces = document.getElementById('product-pieces');
  if (prodPieces) prodPieces.value = prod.piecesPerUnit || 1;
  const prodUnitCost = document.getElementById('product-unit-cost');
  if (prodUnitCost) prodUnitCost.value = prod.unitCost || 400;

  toggleSempolFields();
}

async function saveProductHandler(e) {
  e.preventDefault();

  const id = document.getElementById('product-id').value;
  const sempolCheckbox = document.getElementById('product-is-sempol');
  const isSempol = sempolCheckbox ? sempolCheckbox.checked : false;
  const piecesPerUnit = Number(document.getElementById('product-pieces')?.value) || 1;
  const unitCost = Number(document.getElementById('product-unit-cost')?.value) || 0;
  let cost = Number(document.getElementById('product-cost').value);

  if (isSempol && piecesPerUnit > 0 && unitCost > 0 && (!cost || cost === 0)) {
    cost = piecesPerUnit * unitCost;
  }

  const product = {
    name: document.getElementById('product-name').value,
    category: document.getElementById('product-category').value,
    code: document.getElementById('product-code').value.trim(),
    cost: cost,
    unitCost: unitCost,
    piecesPerUnit: piecesPerUnit,
    isSempol: isSempol,
    price: Number(document.getElementById('product-price').value),
    stock: Number(document.getElementById('product-stock').value),
    color: document.getElementById('product-color').value,
    icon: document.getElementById('product-icon').value
  };

  if (id) {
    product.id = Number(id);
  }

  try {
    await DB.saveProduct(product);
    await loadInitialData();
    closeProductModal();
    renderInventoryTable();
    showToast("Produk berhasil disimpan!");
  } catch (err) {
    console.error("Gagal menyimpan produk:", err);
    alert("Gagal menyimpan produk. Periksa apakah kode QR/Barcode sudah digunakan produk lain.");
  }
}

async function deleteProductHandler(id) {
  if (!requireAdmin(() => deleteProductHandler(id))) return;
  if (confirm("Apakah Anda yakin ingin menghapus produk ini?")) {
    try {
      await DB.deleteProduct(id);
      await loadInitialData();
      renderInventoryTable();
      showToast("Produk berhasil dihapus!");
    } catch (err) {
      console.error(err);
      alert("Gagal menghapus produk.");
    }
  }
}

// Manage Categories (Dynamic)
async function manageCategoriesPrompt() {
  const currentCats = State.categories.map(c => c.name).join(', ');
  const input = prompt("Daftar kategori saat ini:\n" + currentCats + "\n\nTambahkan kategori baru (masukkan nama kategori):");
  if (!input) return;

  const newCat = input.trim();
  if (newCat.length === 0) return;

  if (State.categories.some(c => c.name.toLowerCase() === newCat.toLowerCase())) {
    alert("Kategori sudah ada!");
    return;
  }

  try {
    await DB.saveCategory({ name: newCat });
    await loadInitialData();
    showToast(`Kategori ${newCat} ditambahkan!`);
  } catch (err) {
    console.error(err);
  }
}

// ----------------------------------------------------
// REPORTS & ANALYTICS VIEWS
// ----------------------------------------------------

async function loadReportData() {
  const dateStartStr = document.getElementById('filter-date-start').value;
  const dateEndStr = document.getElementById('filter-date-end').value;

  if (!dateStartStr || !dateEndStr) return;

  const startTimestamp = parseLocalDate(dateStartStr, false);
  const endTimestamp = parseLocalDate(dateEndStr, true);

  const transactions = await DB.getTransactions();

  // Filter transactions within range
  const filteredTx = transactions.filter(tx => {
    return tx.timestamp >= startTimestamp && tx.timestamp <= endTimestamp;
  });

  // Calculate Metrics
  let revenue = 0;
  let netSales = 0;
  let cost = 0;
  let txCount = filteredTx.length;

  filteredTx.forEach(tx => {
    revenue += tx.total;
    netSales += (tx.subtotal - (tx.discount || 0));
    tx.items.forEach(item => {
      cost += (item.cost || 0) * item.quantity;
    });
  });

  const profit = netSales - cost;
  const avgBill = txCount > 0 ? Math.round(revenue / txCount) : 0;

  // Render Metric values
  document.getElementById('report-stat-revenue').innerText = `Rp ${revenue.toLocaleString('id-ID')}`;
  document.getElementById('report-stat-profit').innerText = `Rp ${profit.toLocaleString('id-ID')}`;
  document.getElementById('report-stat-count').innerText = txCount;
  document.getElementById('report-stat-avg').innerText = `Rp ${avgBill.toLocaleString('id-ID')}`;

  // Render transactions history table
  renderTransactionsHistoryTable(filteredTx);

  // Render Top selling list
  renderTopSellingProducts(filteredTx);

  // Render Sales Trend Chart (Canvas based)
  renderSalesTrendChart(filteredTx, dateStartStr, dateEndStr);

  // Load Financial & Operational Expenses Report Data
  await loadFinancialReportData(startTimestamp, endTimestamp, filteredTx);
}

function renderTransactionsHistoryTable(txList) {
  const tbody = document.getElementById('transactions-table-body');
  const mobList = document.getElementById('transactions-mobile-list');
  if (!tbody) return;

  // Sort descending by timestamp
  const sorted = txList.sort((a, b) => b.timestamp - a.timestamp);

  // Render Desktop
  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-slate-500 font-semibold">
          Tidak ada transaksi pada rentang tanggal ini
        </td>
      </tr>
    `;
  } else {
    let html = '';
    sorted.forEach(tx => {
      const dateStr = new Date(tx.timestamp).toLocaleString('id-ID');
      html += `
        <tr class="border-b border-slate-800 hover:bg-slate-900/20 text-xs">
          <td class="p-4 pl-6 font-mono font-bold text-slate-300">${tx.id}</td>
          <td class="p-4 text-slate-400">${dateStr}</td>
          <td class="p-4 text-center">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
              tx.paymentMethod === 'Cash' ? 'bg-success-500/20 text-success-400' : tx.paymentMethod === 'QRIS' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-500/20 text-amber-400'
            }">${tx.paymentMethod}</span>
          </td>
          <td class="p-4 text-right text-slate-400">Rp ${(tx.taxSvc - tx.discount).toLocaleString('id-ID')}</td>
          <td class="p-4 text-right font-bold text-white">Rp ${tx.total.toLocaleString('id-ID')}</td>
          <td class="p-4 text-right pr-6">
            <button onclick="viewTransactionDetail('${tx.id}')" class="text-xs text-primary-500 hover:underline">
              Lihat Struk
            </button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // Render Mobile
  if (mobList) {
    if (sorted.length === 0) {
      mobList.innerHTML = `
        <div class="py-8 text-center text-slate-500 font-semibold text-xs">
          Tidak ada transaksi pada rentang tanggal ini
        </div>
      `;
    } else {
      let mHtml = '';
      sorted.forEach(tx => {
        const dateStr = new Date(tx.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
        mHtml += `
          <div class="py-4 flex items-center justify-between gap-4 animate-[fadeIn_0.15s_ease-out]">
            <div class="min-w-0">
              <div class="font-mono font-bold text-slate-200 text-sm truncate">${tx.id}</div>
              <div class="text-[10px] text-slate-400 flex items-center gap-2 mt-1">
                <span>${dateStr}</span>
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  tx.paymentMethod === 'Cash' ? 'bg-success-500/20 text-success-400' : tx.paymentMethod === 'QRIS' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-500/20 text-amber-400'
                }">${tx.paymentMethod}</span>
              </div>
            </div>
            
            <div class="flex items-center gap-3.5 flex-shrink-0">
              <div class="text-right">
                <div class="font-extrabold text-sm text-white">Rp ${tx.total.toLocaleString('id-ID')}</div>
                <button onclick="viewTransactionDetail('${tx.id}')" class="text-[10px] text-primary-500 hover:underline mt-0.5 block">
                  Lihat Struk
                </button>
              </div>
            </div>
          </div>
        `;
      });
      mobList.innerHTML = mHtml;
    }
  }
}

async function viewTransactionDetail(txId) {
  const transactions = await DB.getTransactions();
  const tx = transactions.find(t => t.id === txId);
  if (tx) {
    renderReceipt(tx);
  }
}

function renderTopSellingProducts(txList) {
  const container = document.getElementById('top-products-list');
  if (!container) return;

  const productCounts = {};

  txList.forEach(tx => {
    tx.items.forEach(item => {
      if (!productCounts[item.name]) {
        productCounts[item.name] = { qty: 0, revenue: 0 };
      }
      productCounts[item.name].qty += item.quantity;
      productCounts[item.name].revenue += item.subtotal;
    });
  });

  const sortedList = Object.keys(productCounts).map(name => ({
    name: name,
    qty: productCounts[name].qty,
    revenue: productCounts[name].revenue
  })).sort((a, b) => b.qty - a.qty).slice(0, 5);

  if (sortedList.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Belum ada data penjualan</p>`;
    return;
  }

  let html = '';
  sortedList.forEach((prod, index) => {
    html += `
      <div class="flex items-center justify-between py-1 border-b border-slate-800/40 pb-2">
        <div class="flex items-center gap-2.5">
          <span class="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400">
            ${index + 1}
          </span>
          <span class="text-xs font-semibold text-slate-200">${prod.name}</span>
        </div>
        <div class="text-right">
          <div class="text-xs font-bold text-white">${prod.qty} Pcs</div>
          <div class="text-[10px] text-slate-500">Rp ${prod.revenue.toLocaleString('id-ID')}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Render Sales Line Chart on standard HTML5 2D Canvas (No dependency version)
function renderSalesTrendChart(txList, dateStartStr, dateEndStr) {
  const canvas = document.getElementById('sales-trend-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Set resolution based on viewport size for super crisp renders
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Generate date list between start and end (Max 7 days for clear labels)
  const startParts = dateStartStr.split('-');
  const startYear = parseInt(startParts[0]);
  const startMonth = parseInt(startParts[1]) - 1;
  const startDay = parseInt(startParts[2]);

  const endParts = dateEndStr.split('-');
  const endYear = parseInt(endParts[0]);
  const endMonth = parseInt(endParts[1]) - 1;
  const endDay = parseInt(endParts[2]);

  const startLocal = new Date(startYear, startMonth, startDay);
  const endLocal = new Date(endYear, endMonth, endDay);
  const daysDiff = Math.round((endLocal - startLocal) / (24 * 60 * 60 * 1000)) + 1;

  const datesList = [];
  for (let i = 0; i < Math.min(daysDiff, 10); i++) {
    const d = new Date(startYear, startMonth, startDay + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayVal = String(d.getDate()).padStart(2, '0');
    datesList.push(`${y}-${m}-${dayVal}`);
  }

  // Aggregate revenues by date (local time)
  const salesByDate = {};
  datesList.forEach(d => salesByDate[d] = 0);

  txList.forEach(tx => {
    const txDateStr = formatLocalDate(tx.timestamp);
    if (salesByDate[txDateStr] !== undefined) {
      salesByDate[txDateStr] += tx.total;
    }
  });

  const chartData = datesList.map(d => salesByDate[d]);
  const maxVal = Math.max(...chartData, 50000); // Floor max value to avoid divide by zero

  // Drawing settings
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Grid Lines
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';

  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const val = (maxVal / gridSteps) * i;
    const y = paddingTop + chartHeight - (chartHeight * (i / gridSteps));

    // Dotted lines
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();

    // Labels
    ctx.setLineDash([]);
    ctx.fillText(val >= 1000000 ? `${(val/1000000).toFixed(1)}M` : val >= 1000 ? `${(val/1000).toFixed(0)}k` : val, paddingLeft - 10, y + 4);
  }

  // Draw X Axis labels
  ctx.textAlign = 'center';
  const pointSpacing = chartWidth / (datesList.length - 1 || 1);

  datesList.forEach((d, idx) => {
    const x = paddingLeft + (idx * pointSpacing);
    const dateObj = new Date(d);
    const label = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    ctx.fillText(label, x, height - 15);
  });

  // Calculate coordinates of data points
  const points = chartData.map((val, idx) => {
    return {
      x: paddingLeft + (idx * pointSpacing),
      y: paddingTop + chartHeight - (chartHeight * (val / maxVal))
    };
  });

  // Fill gradient area below the line
  if (points.length > 0) {
    const fillGrad = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
    fillGrad.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
    fillGrad.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - paddingBottom);
    
    // Draw lines
    points.forEach(p => {
      ctx.lineTo(p.x, p.y);
    });

    ctx.lineTo(points[points.length - 1].x, height - paddingBottom);
    ctx.closePath();
    ctx.fill();

    // Draw main Bezier glow stroke line
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(99, 102, 241, 0.4)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    // Smooth Bezier Curve plot
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();

    // Draw dots at point locations
    ctx.shadowBlur = 0; // Reset shadow
    ctx.fillStyle = '#6366f1';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
}


// Global Database Reset to default electronic sample data
async function resetDatabaseHandler() {
  if (!requireAdmin(() => resetDatabaseHandler())) return;
  if (confirm("Apakah Anda yakin ingin menghapus semua data dan memulihkan data sampel elektronik? Tindakan ini akan menghapus semua produk kustom dan transaksi Anda.")) {
    try {
      if (DB.db) {
        DB.db.close();
      }
      const req = indexedDB.deleteDatabase('pos_database');
      req.onblocked = () => {
        alert("Proses reset terhambat karena ada tab aplikasi POS lain yang masih terbuka. Harap tutup tab POS lainnya terlebih dahulu.");
      };
      req.onsuccess = () => {
        showToast("Database berhasil di-reset!");
        setTimeout(() => {
          window.location.reload();
        }, 800);
      };
      req.onerror = () => {
        alert("Gagal menghapus database.");
      };
    } catch (err) {
      console.error(err);
      alert("Terjadi kesalahan saat meriset database.");
    }
  }
}


// Store Settings Modal UI Handlers
function openStoreSettingsModal() {
  if (!requireAdmin(() => openStoreSettingsModal())) return;
  const modal = document.getElementById('modal-store-settings');
  if (!modal) return;
  
  const nameInput = document.getElementById('setting-store-name');
  const addrInput = document.getElementById('setting-store-address');
  const phoneInput = document.getElementById('setting-store-phone');
  const taxInput = document.getElementById('setting-store-tax');
  const footerInput = document.getElementById('setting-store-footer');
  
  if (State.storeInfo) {
    nameInput.value = State.storeInfo.name || '';
    addrInput.value = State.storeInfo.address || '';
    phoneInput.value = State.storeInfo.phone || '';
    taxInput.value = typeof State.storeInfo.taxRate !== 'undefined' ? State.storeInfo.taxRate : 11;
    footerInput.value = State.storeInfo.receiptFooter || '';
  } else {
    nameInput.value = 'Ruang Temu Gadget';
    addrInput.value = 'MTC Mall Lantai 2, Jakarta';
    phoneInput.value = '0812-9876-5432';
    taxInput.value = 11;
    footerInput.value = 'Terima kasih atas kunjungan Anda!';
  }
  
  modal.classList.remove('hidden');
}

function closeStoreSettingsModal() {
  const modal = document.getElementById('modal-store-settings');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function saveStoreSettingsHandler(event) {
  event.preventDefault();
  
  const name = document.getElementById('setting-store-name').value;
  const address = document.getElementById('setting-store-address').value;
  const phone = document.getElementById('setting-store-phone').value;
  const taxRate = parseFloat(document.getElementById('setting-store-tax').value);
  const receiptFooter = document.getElementById('setting-store-footer').value;
  
  const newSettings = {
    name,
    address,
    phone,
    taxRate,
    serviceCharge: State.storeInfo ? (State.storeInfo.serviceCharge ?? 0) : 0,
    currency: 'IDR',
    receiptFooter
  };
  
  try {
    await DB.saveSettings('store_info', newSettings);
    State.storeInfo = newSettings;
    State.taxRate = taxRate;
    
    // Update headers and text fields in UI
    document.getElementById('sidebar-store-name').innerText = name;
    document.getElementById('label-cart-tax').innerText = `${State.taxRate + State.serviceChargeRate}%`;
    
    renderCart();
    closeStoreSettingsModal();
    showToast("Pengaturan Toko berhasil disimpan!");
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert('Gagal menyimpan pengaturan toko.');
  }
}


// Center-align text dynamically for 40-character thermal roll layout
function centerText(text, width = 40) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length >= width) return trimmed.substring(0, width);
  const leftPad = Math.floor((width - trimmed.length) / 2);
  return ' '.repeat(leftPad) + trimmed;
}

// Get local date string formatted as YYYY-MM-DD
function getLocalDateString(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format local date string from timestamp as YYYY-MM-DD
function formatLocalDate(timestamp) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse local date string "YYYY-MM-DD" to millisecond timestamp
function parseLocalDate(dateStr, endOfDay = false) {
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const d = new Date(year, month, day);
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.getTime();
}

// Format a single line of receipt with left-aligned and right-aligned text
function formatReceiptLine(left, right, width = 40) {
  const leftStr = String(left);
  const rightStr = String(right);
  const spacesNeeded = width - leftStr.length - rightStr.length;
  if (spacesNeeded <= 0) {
    return leftStr + ' ' + rightStr;
  }
  return leftStr + ' '.repeat(spacesNeeded) + rightStr;
}

// Wrap a text string to max width without breaking words, and center each wrapped line
function wrapAndCenter(text, width = 40) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  words.forEach(word => {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) {
        lines.push(centerText(currentLine, width));
      }
      currentLine = word;
      if (currentLine.length > width) {
        currentLine = currentLine.substring(0, width);
      }
    }
  });
  if (currentLine) {
    lines.push(centerText(currentLine, width));
  }
  return lines.join('\n');
}


// ====================================================
// AUTHENTICATION & ROLE MANAGEMENT (ADMIN & KASIR)
// ====================================================

function requireAdmin(actionCallback) {
  if (State.currentUser?.role === 'cashier') {
    showToast('Aksi ini memerlukan hak akses Administrator. Masukkan PIN Admin.', 'info');
    openAuthModal('admin', actionCallback);
    return false;
  }
  if (typeof actionCallback === 'function') {
    actionCallback();
  }
  return true;
}

function updateAuthUI() {
  const role = State.currentUser?.role || 'admin';
  const isAdmin = role === 'admin';

  // Update Header Elements
  const headerName = document.getElementById('header-user-name');
  const headerBadge = document.getElementById('header-user-role-badge');
  const headerAvatar = document.getElementById('header-user-avatar');

  if (headerName) headerName.innerText = isAdmin ? 'Admin / Owner' : 'Kasir Utama';
  if (headerBadge) {
    headerBadge.innerText = isAdmin ? 'Administrator' : 'Kasir';
    headerBadge.className = isAdmin 
      ? 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-400 border border-primary-500/30 uppercase inline-block'
      : 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase inline-block';
  }
  if (headerAvatar) {
    headerAvatar.className = isAdmin
      ? 'w-8 h-8 md:w-9 md:h-9 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-primary-400 group-hover:bg-primary-500/30 transition-colors'
      : 'w-8 h-8 md:w-9 md:h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500/30 transition-colors';
    headerAvatar.innerHTML = `<i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-cash-register'} text-sm"></i>`;
  }

  // Update Mobile Drawer Elements
  const mRoleName = document.getElementById('m-menu-role-name');
  const mRoleBadge = document.getElementById('m-menu-role-badge');
  const mRoleAvatar = document.getElementById('m-menu-role-avatar');

  if (mRoleName) mRoleName.innerText = isAdmin ? 'Admin / Owner' : 'Kasir Utama';
  if (mRoleBadge) {
    mRoleBadge.innerText = isAdmin ? 'Admin' : 'Kasir';
    mRoleBadge.className = isAdmin
      ? 'text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-300 border border-primary-500/40'
      : 'text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }
  if (mRoleAvatar) {
    mRoleAvatar.className = isAdmin
      ? 'w-11 h-11 rounded-xl bg-primary-500/20 border border-primary-500/40 flex items-center justify-center text-primary-400 flex-shrink-0'
      : 'w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0';
    mRoleAvatar.innerHTML = `<i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-cash-register'} text-xl"></i>`;
  }

  // Auth notice in Cloud Modal
  const authNotice = document.getElementById('cloud-auth-notice');
  if (authNotice) {
    if (CloudDB?.status === 'connected' || State.authSettings?.required) {
      authNotice.classList.remove('hidden');
    } else {
      authNotice.classList.add('hidden');
    }
  }
}

function openAuthModal(targetRole = 'admin', onSuccess = null) {
  const modal = document.getElementById('modal-auth-pin');
  if (!modal) return;

  State.targetAuthRole = targetRole;
  State.authPendingAction = onSuccess;
  State.pinInput = '';
  updatePinDotsUI();

  const currentRoleEl = document.getElementById('auth-modal-current-role');
  if (currentRoleEl) {
    currentRoleEl.innerText = State.currentUser?.role === 'admin' ? 'Administrator' : 'Kasir';
    currentRoleEl.className = State.currentUser?.role === 'admin' ? 'text-primary-400 font-semibold' : 'text-emerald-400 font-semibold';
  }

  selectAuthRole(targetRole);

  const errorEl = document.getElementById('auth-error-msg');
  if (errorEl) errorEl.classList.add('hidden');

  modal.classList.remove('hidden');

  // Focus hidden input for physical keyboard entry
  const pinInput = document.getElementById('auth-pin-input');
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
    pinInput.oninput = (e) => {
      State.pinInput = e.target.value.replace(/\D/g, '').substring(0, 4);
      updatePinDotsUI();
      if (State.pinInput.length === 4) {
        submitPinLogin();
      }
    };
  }
}

function closeAuthModal() {
  const modal = document.getElementById('modal-auth-pin');
  if (modal) modal.classList.add('hidden');
  State.pinInput = '';
  State.authPendingAction = null;
}

function selectAuthRole(role) {
  State.targetAuthRole = role;
  const btnAdmin = document.getElementById('btn-auth-tab-admin');
  const btnCashier = document.getElementById('btn-auth-tab-cashier');
  const label = document.getElementById('auth-target-role-label');
  const modalIcon = document.getElementById('auth-modal-icon');
  const modalIconBox = document.getElementById('auth-modal-icon-box');

  if (role === 'admin') {
    if (btnAdmin) btnAdmin.className = "py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 bg-primary-600 text-white shadow-glow-primary";
    if (btnCashier) btnCashier.className = "py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    if (label) label.innerText = "Administrator";
    if (modalIcon) modalIcon.className = "fa-solid fa-user-shield text-sm";
    if (modalIconBox) modalIconBox.className = "w-8 h-8 rounded-lg bg-primary-500/20 border border-primary-500/40 flex items-center justify-center text-primary-400";
  } else {
    if (btnCashier) btnCashier.className = "py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 bg-emerald-600 text-white shadow-lg";
    if (btnAdmin) btnAdmin.className = "py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    if (label) label.innerText = "Kasir Utama";
    if (modalIcon) modalIcon.className = "fa-solid fa-cash-register text-sm";
    if (modalIconBox) modalIconBox.className = "w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400";
  }

  State.pinInput = '';
  updatePinDotsUI();
  const errorEl = document.getElementById('auth-error-msg');
  if (errorEl) errorEl.classList.add('hidden');
}

function pressPinKey(digit) {
  if (State.pinInput.length < 4) {
    State.pinInput += digit;
    updatePinDotsUI();
    if (State.pinInput.length === 4) {
      setTimeout(() => {
        submitPinLogin();
      }, 100);
    }
  }
}

function clearPinInput() {
  State.pinInput = '';
  updatePinDotsUI();
  const pinInput = document.getElementById('auth-pin-input');
  if (pinInput) pinInput.value = '';
  const errorEl = document.getElementById('auth-error-msg');
  if (errorEl) errorEl.classList.add('hidden');
}

function updatePinDotsUI() {
  const len = State.pinInput.length;
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`pin-dot-${i}`);
    if (dot) {
      if (i < len) {
        dot.className = "w-3.5 h-3.5 rounded-full border-2 border-primary-500 bg-primary-500 scale-110 transition-all";
      } else {
        dot.className = "w-3.5 h-3.5 rounded-full border-2 border-slate-600 bg-transparent transition-all";
      }
    }
  }
}

async function submitPinLogin() {
  const enteredPin = State.pinInput;
  const targetRole = State.targetAuthRole;
  const errorEl = document.getElementById('auth-error-msg');
  const errorText = document.getElementById('auth-error-text');

  if (enteredPin.length !== 4) {
    if (errorEl && errorText) {
      errorText.innerText = "Masukkan 4 digit PIN!";
      errorEl.classList.remove('hidden');
    }
    return;
  }

  // Verify PIN against authSettings
  const validAdminPin = State.authSettings?.adminPin || '1234';
  const validCashierPin = State.authSettings?.cashierPin || '0000';

  let isValid = false;
  if (targetRole === 'admin' && enteredPin === validAdminPin) {
    isValid = true;
    State.currentUser = { role: 'admin', name: 'Admin / Owner' };
    sessionStorage.setItem('pos_user_role', 'admin');
  } else if (targetRole === 'cashier' && (enteredPin === validCashierPin || enteredPin === validAdminPin)) {
    // Admin PIN can also unlock cashier mode
    isValid = true;
    State.currentUser = { role: 'cashier', name: 'Kasir Utama' };
    sessionStorage.setItem('pos_user_role', 'cashier');
  }

  if (isValid) {
    updateAuthUI();
    const actionToRun = State.authPendingAction;
    closeAuthModal();
    showToast(`Berhasil masuk sebagai ${State.currentUser.name}`, 'success');

    if (typeof actionToRun === 'function') {
      actionToRun();
    }
  } else {
    if (errorEl && errorText) {
      errorText.innerText = `PIN salah untuk ${targetRole === 'admin' ? 'Administrator' : 'Kasir'}. Coba lagi.`;
      errorEl.classList.remove('hidden');
    }
    // Shake effect & clear
    clearPinInput();
  }
}

// PIN Settings (Ubah PIN)
function openChangePinModal() {
  const modal = document.getElementById('modal-change-pin');
  if (!modal) return;
  const form = document.getElementById('form-change-pin');
  if (form) form.reset();
  modal.classList.remove('hidden');
}

function closeChangePinModal() {
  const modal = document.getElementById('modal-change-pin');
  if (modal) modal.classList.add('hidden');
}

async function saveNewPinHandler(e) {
  e.preventDefault();
  const currentAdminPin = document.getElementById('input-current-admin-pin').value.trim();
  const newAdminPin = document.getElementById('input-new-admin-pin').value.trim();
  const newCashierPin = document.getElementById('input-new-cashier-pin').value.trim();

  const validAdminPin = State.authSettings?.adminPin || '1234';
  if (currentAdminPin !== validAdminPin) {
    alert("PIN Admin saat ini tidak cocok! Verifikasi gagal.");
    return;
  }

  if (newAdminPin.length < 4 || newCashierPin.length < 4) {
    alert("PIN baru harus minimal 4 digit angka!");
    return;
  }

  try {
    const updatedSettings = {
      required: true,
      adminPin: newAdminPin,
      cashierPin: newCashierPin
    };
    await DB.saveAuthSettings(updatedSettings);
    State.authSettings = updatedSettings;
    closeChangePinModal();
    showToast("PIN Admin dan Kasir berhasil diperbarui!", 'success');
  } catch (err) {
    console.error('Failed to update PIN:', err);
    alert('Gagal menyimpan PIN: ' + err.message);
  }
}


// ====================================================
// MULTI-DATABASE INTEGRATION (SHEETS / MYSQL / FIREBASE)
// ====================================================

function switchCloudProviderTab(provider) {
  const providers = ['sheets', 'mysql', 'firebase'];
  providers.forEach(p => {
    const tabBtn = document.getElementById(`tab-provider-${p}`);
    const panel = document.getElementById(`panel-provider-${p}`);
    if (p === provider) {
      if (panel) panel.classList.remove('hidden');
      if (tabBtn) {
        if (p === 'sheets') {
          tabBtn.className = "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all bg-emerald-950/40 border-emerald-500 text-emerald-300 shadow-md";
        } else if (p === 'mysql') {
          tabBtn.className = "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all bg-sky-950/40 border-sky-500 text-sky-300 shadow-md";
        } else {
          tabBtn.className = "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all bg-amber-950/40 border-amber-500 text-amber-300 shadow-md";
        }
      }
    } else {
      if (panel) panel.classList.add('hidden');
      if (tabBtn) {
        tabBtn.className = "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700";
      }
    }
  });

  const hiddenInput = document.getElementById('cloud-selected-provider');
  if (hiddenInput) hiddenInput.value = provider;
}

function initCloudModule() {
  if (typeof CloudDB === 'undefined') return;

  CloudDB.onStatusChange = (status, message) => {
    updateCloudStatusUI(status, message);
  };

  CloudDB.init().then(async (connected) => {
    console.log('CloudDB initialized. Connected:', connected);
    if (connected) {
      State.authSettings = await DB.getAuthSettings();
      updateAuthUI();
    }
    updateCloudStatusUI(CloudDB.status, CloudDB.statusMessage);
  }).catch((err) => {
    console.error('CloudDB init error:', err);
    updateCloudStatusUI('error', err.message);
  });

  updateCloudStatusUI(CloudDB.status, CloudDB.statusMessage);
}

function updateCloudStatusUI(status, message) {
  const badge = document.getElementById('cloud-status-badge');
  const dot = document.getElementById('cloud-status-dot');
  const text = document.getElementById('cloud-status-text');
  const headerDot = document.getElementById('cloud-header-dot');
  const modalBadge = document.getElementById('cloud-modal-status-badge');
  const alertIcon = document.getElementById('cloud-status-alert-icon');
  const alertTitle = document.getElementById('cloud-status-alert-title');
  const alertDesc = document.getElementById('cloud-status-alert-desc');
  const mMenuStatus = document.getElementById('m-menu-cloud-status');
  const mNavDot = document.getElementById('m-nav-menu-dot');
  const authNotice = document.getElementById('cloud-auth-notice');

  const provider = CloudDB?.provider || 'sheets';
  const providerName = CloudDB ? CloudDB.getProviderName(provider) : 'Database Eksternal';

  let dotColor = 'bg-slate-500';
  let badgeText = 'Lokal Saja';
  let textColor = 'text-slate-400';
  let alertIconClass = 'fa-solid fa-circle-info text-sky-400';
  let alertTitleText = 'Status: Database Lokal Saja';

  if (status === 'connected') {
    dotColor = 'bg-emerald-500';
    badgeText = `${providerName} Aktif`;
    textColor = 'text-emerald-400';
    alertIconClass = 'fa-solid fa-circle-check text-emerald-400';
    alertTitleText = `Terhubung ke ${providerName}`;
    if (authNotice) authNotice.classList.remove('hidden');
  } else if (status === 'connecting') {
    dotColor = 'bg-amber-500 animate-ping';
    badgeText = 'Menghubungkan...';
    textColor = 'text-amber-400';
    alertIconClass = 'fa-solid fa-arrows-rotate fa-spin text-amber-400';
    alertTitleText = `Menghubungkan ke ${providerName}...`;
  } else if (status === 'error') {
    dotColor = 'bg-danger-500';
    badgeText = 'Koneksi Error';
    textColor = 'text-danger-400';
    alertIconClass = 'fa-solid fa-triangle-exclamation text-danger-400';
    alertTitleText = 'Koneksi Database Bermasalah';
  } else {
    if (authNotice) {
      if (State.authSettings?.required) authNotice.classList.remove('hidden');
      else authNotice.classList.add('hidden');
    }
  }

  if (dot) dot.className = `w-2 h-2 rounded-full ${dotColor}`;
  if (text) text.innerText = badgeText;
  if (badge) badge.className = `flex items-center gap-1.5 font-medium ${textColor} cursor-pointer transition-colors`;
  if (headerDot) headerDot.className = `w-1.5 h-1.5 rounded-full ${dotColor}`;
  if (modalBadge) {
    modalBadge.innerText = badgeText;
    modalBadge.className = `text-[10px] font-semibold px-2 py-0.5 rounded-full ${textColor} bg-dark-950 border border-slate-800`;
  }
  if (mMenuStatus) {
    mMenuStatus.innerText = badgeText;
    mMenuStatus.className = `text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${textColor} bg-dark-950 border border-slate-800`;
  }
  if (mNavDot) {
    mNavDot.className = `w-1.5 h-1.5 rounded-full absolute -top-0.5 -right-1.5 ${dotColor}`;
  }
  if (alertIcon) alertIcon.className = `${alertIconClass} mt-0.5 text-base`;
  if (alertTitle) alertTitle.innerText = alertTitleText;
  if (alertDesc) alertDesc.innerText = message || 'Aplikasi siap digunakan.';
}

function openCloudSettingsModal() {
  if (!requireAdmin(() => openCloudSettingsModal())) return;
  const modal = document.getElementById('modal-cloud-settings');
  if (!modal) return;

  const config = CloudDB.getConfig() || {};
  const provider = config.provider || (config.projectId ? 'firebase' : 'sheets');

  // Populate Google Sheets
  const elSheetsUrl = document.getElementById('cloud-sheets-url');
  const elSheetsId = document.getElementById('cloud-sheets-id');
  const elSheetsToken = document.getElementById('cloud-sheets-token');
  if (elSheetsUrl) elSheetsUrl.value = config.sheetsUrl || '';
  if (elSheetsId) elSheetsId.value = config.sheetsId || '';
  if (elSheetsToken) elSheetsToken.value = config.sheetsToken || '';

  // Populate MySQL
  const elMysqlUrl = document.getElementById('cloud-mysql-endpoint');
  const elMysqlKey = document.getElementById('cloud-mysql-apikey');
  const elMysqlDb = document.getElementById('cloud-mysql-dbname');
  if (elMysqlUrl) elMysqlUrl.value = config.mysqlApiUrl || '';
  if (elMysqlKey) elMysqlKey.value = config.mysqlApiKey || '';
  if (elMysqlDb) elMysqlDb.value = config.mysqlDbName || 'pos_db';

  // Populate Firebase
  const elProj = document.getElementById('cloud-project-id');
  const elKey = document.getElementById('cloud-api-key');
  const elAuth = document.getElementById('cloud-auth-domain');
  const elBucket = document.getElementById('cloud-storage-bucket');
  const elMsg = document.getElementById('cloud-messaging-sender-id');
  const elApp = document.getElementById('cloud-app-id');
  if (elProj) elProj.value = config.projectId || '';
  if (elKey) elKey.value = config.apiKey || '';
  if (elAuth) elAuth.value = config.authDomain || '';
  if (elBucket) elBucket.value = config.storageBucket || '';
  if (elMsg) elMsg.value = config.messagingSenderId || '';
  if (elApp) elApp.value = config.appId || '';

  const elToggle = document.getElementById('cloud-toggle-enabled');
  if (elToggle) elToggle.checked = config.enabled !== false;

  switchCloudProviderTab(provider);
  updateCloudStatusUI(CloudDB.status, CloudDB.statusMessage);
  modal.classList.remove('hidden');
}

function closeCloudSettingsModal() {
  const modal = document.getElementById('modal-cloud-settings');
  if (modal) modal.classList.add('hidden');
}

async function saveCloudConfigHandler(e) {
  e.preventDefault();
  const provider = document.getElementById('cloud-selected-provider')?.value || 'sheets';
  const isEnabled = document.getElementById('cloud-toggle-enabled')?.checked ?? true;

  const config = {
    provider,
    enabled: isEnabled,
    // Sheets
    sheetsUrl: document.getElementById('cloud-sheets-url')?.value.trim() || '',
    sheetsId: document.getElementById('cloud-sheets-id')?.value.trim() || '',
    sheetsToken: document.getElementById('cloud-sheets-token')?.value.trim() || '',
    // MySQL
    mysqlApiUrl: document.getElementById('cloud-mysql-endpoint')?.value.trim() || '',
    mysqlApiKey: document.getElementById('cloud-mysql-apikey')?.value.trim() || '',
    mysqlDbName: document.getElementById('cloud-mysql-dbname')?.value.trim() || 'pos_db',
    // Firebase
    projectId: document.getElementById('cloud-project-id')?.value.trim() || '',
    apiKey: document.getElementById('cloud-api-key')?.value.trim() || '',
    authDomain: document.getElementById('cloud-auth-domain')?.value.trim() || '',
    storageBucket: document.getElementById('cloud-storage-bucket')?.value.trim() || '',
    messagingSenderId: document.getElementById('cloud-messaging-sender-id')?.value.trim() || '',
    appId: document.getElementById('cloud-app-id')?.value.trim() || ''
  };

  CloudDB.saveConfig(config);

  if (!config.enabled) {
    CloudDB.disconnect();
    showToast('Mode Database Eksternal dinonaktifkan. POS berjalan offline lokal.', 'info');
    closeCloudSettingsModal();
    return;
  }

  const provName = CloudDB.getProviderName(provider);
  showToast(`Menghubungkan ke ${provName}...`, 'info');
  const connected = await CloudDB.connect(config);

  if (connected) {
    State.authSettings = await DB.getAuthSettings();
    updateAuthUI();
    showToast(`Berhasil terhubung ke ${provName}! Autentikasi Kasir & Admin aktif.`, 'success');
  } else {
    showToast(`Gagal terhubung ke ${provName}. Silakan periksa kredensial / URL Anda.`, 'error');
  }
}

async function testCloudConnectionHandler() {
  const provider = document.getElementById('cloud-selected-provider')?.value || 'sheets';
  const config = {
    provider,
    sheetsUrl: document.getElementById('cloud-sheets-url')?.value.trim() || '',
    sheetsId: document.getElementById('cloud-sheets-id')?.value.trim() || '',
    sheetsToken: document.getElementById('cloud-sheets-token')?.value.trim() || '',
    mysqlApiUrl: document.getElementById('cloud-mysql-endpoint')?.value.trim() || '',
    mysqlApiKey: document.getElementById('cloud-mysql-apikey')?.value.trim() || '',
    mysqlDbName: document.getElementById('cloud-mysql-dbname')?.value.trim() || 'pos_db',
    projectId: document.getElementById('cloud-project-id')?.value.trim() || '',
    apiKey: document.getElementById('cloud-api-key')?.value.trim(),
    authDomain: document.getElementById('cloud-auth-domain')?.value.trim(),
    storageBucket: document.getElementById('cloud-storage-bucket')?.value.trim(),
    messagingSenderId: document.getElementById('cloud-messaging-sender-id')?.value.trim(),
    appId: document.getElementById('cloud-app-id')?.value.trim()
  };

  const btn = document.getElementById('btn-test-cloud');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Menguji...';

  try {
    const res = await CloudDB.testConnection(config);
    alert(res.message || `Koneksi ke ${CloudDB.getProviderName(provider)} Sukses!`);
  } catch (err) {
    console.error('Test connection error:', err);
    alert('Koneksi Gagal: ' + (err.message || 'Periksa URL atau kredensial database Anda.'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function syncUploadAllHandler() {
  if (CloudDB.status !== 'connected') {
    alert('Database eksternal belum terhubung. Harap simpan konfigurasi dan pastikan koneksi tersambung terlebih dahulu.');
    return;
  }

  const btn = document.getElementById('btn-sync-upload');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Mengunggah...';

  try {
    const result = await CloudDB.uploadAllLocalData(DB);
    showToast(`Berhasil upload ke ${CloudDB.getProviderName(CloudDB.provider)}: ${result.productsCount} produk, ${result.transactionsCount} transaksi, ${result.expensesCount} catatan!`, 'success');
  } catch (err) {
    console.error('Upload error:', err);
    alert('Gagal mengunggah data: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function syncDownloadAllHandler() {
  if (CloudDB.status !== 'connected') {
    alert('Database eksternal belum terhubung. Harap simpan konfigurasi dan pastikan koneksi tersambung terlebih dahulu.');
    return;
  }

  const confirmed = confirm(`Perhatian: Mengunduh data dari ${CloudDB.getProviderName(CloudDB.provider)} akan memperbarui produk, transaksi, dan catatan pengeluaran ke HP ini. Lanjutkan?`);
  if (!confirmed) return;

  const btn = document.getElementById('btn-sync-download');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Mengunduh...';

  try {
    const result = await CloudDB.downloadAllCloudData(DB);
    await loadInitialData();
    if (State.activeView === 'cashier') {
      renderProducts();
    } else if (State.activeView === 'products') {
      renderInventoryTable();
    } else if (State.activeView === 'reports') {
      loadReportData();
    }
    showToast(`Berhasil download: ${result.productsCount} produk, ${result.transactionsCount} transaksi, ${result.expensesCount || 0} catatan!`, 'success');
  } catch (err) {
    console.error('Download error:', err);
    alert('Gagal mengunduh data: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}


// ====================================================
// MOBILE MENU DRAWER (MODAL BOTTOM SHEET)
// ====================================================

function openMobileMenuModal() {
  const modal = document.getElementById('modal-mobile-menu');
  if (!modal) return;
  updateStoreBrandingUI();
  updateCloudStatusUI(CloudDB.status, CloudDB.statusMessage);
  modal.classList.remove('hidden');
}

function closeMobileMenuModal() {
  const modal = document.getElementById('modal-mobile-menu');
  if (modal) modal.classList.add('hidden');
}

// ====================================================
// MULTI-STORE SWITCHER & PROFILE MANAGEMENT
// ====================================================

function updateStoreBrandingUI() {
  const store = DB.getActiveStore();

  const storeNameEls = [
    document.getElementById('sidebar-store-name'),
    document.getElementById('header-store-name')
  ];
  storeNameEls.forEach(el => {
    if (el) el.innerText = store.name;
  });

  const taglineEl = document.getElementById('sidebar-store-tagline');
  if (taglineEl) taglineEl.innerText = store.tagline || (store.type === 'food' ? 'Kuliner & Street Food' : 'Retail Store');

  const sidebarIcon = document.getElementById('sidebar-store-icon');
  if (sidebarIcon) {
    sidebarIcon.className = `fa-solid ${store.icon || 'fa-store'} text-lg`;
  }

  const headerIcon = document.getElementById('header-store-icon');
  if (headerIcon) {
    headerIcon.className = `fa-solid ${store.icon || 'fa-store'} text-amber-400`;
  }

  const iconBox = document.getElementById('sidebar-store-icon-box');
  if (iconBox) {
    iconBox.className = `w-10 h-10 rounded-xl bg-gradient-to-br ${store.badgeColor || 'from-primary-500 to-purple-600'} flex items-center justify-center text-white shadow-glow-primary flex-shrink-0`;
  }

  // Update Mobile Menu Drawer Branding
  const mStoreName = document.getElementById('m-menu-store-name');
  if (mStoreName) mStoreName.innerText = store.name;

  const mTagline = document.getElementById('m-menu-store-tagline');
  if (mTagline) mTagline.innerText = store.tagline || (store.type === 'food' ? 'Kuliner & Street Food' : 'Retail Store');

  const mStoreIcon = document.getElementById('m-menu-store-icon');
  if (mStoreIcon) mStoreIcon.className = `fa-solid ${store.icon || 'fa-store'} text-base`;

  const mIconBox = document.getElementById('m-menu-store-icon-box');
  if (mIconBox) {
    mIconBox.className = `w-10 h-10 rounded-xl bg-gradient-to-br ${store.badgeColor || 'from-primary-500 to-purple-600'} flex items-center justify-center text-white shadow-glow-primary flex-shrink-0`;
  }

  // Update sempol live quick bar
  updateSempolQuickBarUI();
}

function openStoreSwitcherModal() {
  if (!requireAdmin(() => openStoreSwitcherModal())) return;
  const modal = document.getElementById('modal-store-switcher');
  if (!modal) return;
  renderStoreSwitcherList();
  modal.classList.remove('hidden');
}

function closeStoreSwitcherModal() {
  const modal = document.getElementById('modal-store-switcher');
  if (modal) modal.classList.add('hidden');
}

function renderStoreSwitcherList() {
  const container = document.getElementById('stores-list-container');
  if (!container) return;

  const stores = DB.getAllStores();
  const activeId = DB.getActiveStoreId();

  let html = '';
  stores.forEach(store => {
    const isActive = store.id === activeId;
    html += `
      <div class="p-4 rounded-xl border transition-all ${
        isActive 
          ? 'bg-amber-500/10 border-amber-500/50 shadow-lg' 
          : 'bg-dark-950/60 border-slate-800 hover:border-slate-700'
      } flex items-center justify-between gap-4">
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${store.badgeColor || 'from-amber-500 to-orange-600'} flex items-center justify-center text-white text-lg flex-shrink-0 shadow-md">
            <i class="fa-solid ${store.icon || 'fa-store'}"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-white text-sm md:text-base truncate">${store.name}</h4>
              ${isActive ? '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-extrabold text-[10px] border border-amber-500/40">Aktif</span>' : ''}
            </div>
            <p class="text-xs text-slate-400 truncate mt-0.5">${store.tagline || (store.type === 'food' ? 'Street Food & Minuman' : 'Retail & Toko')}</p>
          </div>
        </div>

        <div class="flex-shrink-0">
          ${isActive 
            ? '<span class="px-3 py-1.5 bg-slate-800/80 text-slate-400 rounded-lg text-xs font-bold border border-slate-700 cursor-default">Sedang Aktif</span>' 
            : `<button onclick="switchStoreHandler('${store.id}')" class="px-3.5 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold transition-all shadow-glow-primary flex items-center gap-1.5">
                <i class="fa-solid fa-arrow-right-arrow-left"></i>
                <span>Pilih POS Ini</span>
               </button>`
          }
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function switchStoreHandler(storeId) {
  try {
    showToast('Memuat database profil toko...', 'info');
    await DB.switchStore(storeId);
    State.cart = [];
    localStorage.removeItem('pos_cart_cache');
    await loadInitialData();
    switchView('cashier');
    closeStoreSwitcherModal();
    const activeStore = DB.getActiveStore();
    showToast(`Berhasil berpindah ke: ${activeStore.name}!`, 'success');
  } catch (err) {
    console.error('Error switching store:', err);
    alert('Gagal beralih toko: ' + err.message);
  }
}

async function createNewStoreHandler(e) {
  e.preventDefault();
  const name = document.getElementById('new-store-name').value.trim();
  const type = document.getElementById('new-store-type').value;
  const tagline = document.getElementById('new-store-tagline').value.trim();

  if (!name) return;

  const icon = type === 'food' ? 'fa-utensils' : (type === 'retail' ? 'fa-shop' : 'fa-handshake');
  const badgeColor = type === 'food' ? 'from-amber-500 to-orange-600' : 'from-indigo-500 to-purple-600';

  const newStore = DB.addNewStore({
    name,
    type,
    tagline,
    icon,
    badgeColor
  });

  document.getElementById('form-new-store').reset();
  await switchStoreHandler(newStore.id);
  showToast(`Toko baru "${newStore.name}" berhasil dibuat dan diaktifkan!`, 'success');
}


// ====================================================
// SEMPOL STOCK & BUNDLING MANAGEMENT
// ====================================================

async function updateSempolQuickBarUI() {
  const bar = document.getElementById('sempol-quick-bar');
  if (!bar) return;

  const isSempolMode = DB.getActiveStoreId() === 'store_sempol' || State.products.some(p => p.isSempol);
  if (!isSempolMode) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  const sempolProd = State.products.find(p => p.isSempol);
  const stockCount = sempolProd ? sempolProd.stock : 0;
  const unitCost = sempolProd ? (sempolProd.unitCost || 400) : 400;

  const badge = document.getElementById('sempol-stock-count-badge');
  if (badge) badge.innerText = `${stockCount} Tusuk`;

  const costEl = document.getElementById('sempol-unit-cost-val');
  if (costEl) costEl.innerText = unitCost.toLocaleString('id-ID');
}

async function quickAddSempolStock(amount) {
  const current = await DB.getSempolStock();
  const newStock = current + amount;
  await DB.updateSempolStock(newStock);
  await loadInitialData();
  renderProducts();
  showToast(`+${amount} Tusuk sempol berhasil ditambahkan! Total sekarang: ${newStock} tusuk.`, 'success');
}

function openSempolStockModal() {
  const modal = document.getElementById('modal-sempol-stock');
  if (!modal) return;
  const sempolProd = State.products.find(p => p.isSempol);
  const stock = sempolProd ? sempolProd.stock : 100;
  const unitCost = sempolProd ? (sempolProd.unitCost || 400) : 400;

  document.getElementById('input-modal-sempol-stock').value = stock;
  document.getElementById('input-modal-sempol-cost').value = unitCost;
  modal.classList.remove('hidden');
}

function closeSempolStockModal() {
  const modal = document.getElementById('modal-sempol-stock');
  if (modal) modal.classList.add('hidden');
}

function adjustSempolModalStock(amt) {
  const input = document.getElementById('input-modal-sempol-stock');
  input.value = Math.max(0, (Number(input.value) || 0) + amt);
}

async function saveSempolStockHandler(e) {
  e.preventDefault();
  const stock = Number(document.getElementById('input-modal-sempol-stock').value) || 0;
  const unitCost = Number(document.getElementById('input-modal-sempol-cost').value) || 400;

  const products = await DB.getProducts();
  for (const p of products) {
    if (p.isSempol) {
      p.stock = stock;
      p.unitCost = unitCost;
      p.cost = (p.piecesPerUnit || 1) * unitCost;
      await DB.saveProduct(p);
    }
  }

  await loadInitialData();
  renderProducts();
  closeSempolStockModal();
  showToast(`Stok Sempol berhasil diperbarui: ${stock} Tusuk (Modal: Rp ${unitCost}/tusuk)!`, 'success');
}


// ====================================================
// FINANCIAL MANAGEMENT & REAL P&L (BUKU KAS & BIAYA)
// ====================================================

function switchReportTab(tab) {
  const salesBtn = document.getElementById('btn-tab-report-sales');
  const financeBtn = document.getElementById('btn-tab-report-finance');
  const salesContent = document.getElementById('report-tab-sales-content');
  const financeContent = document.getElementById('report-tab-finance-content');

  if (tab === 'sales') {
    salesContent?.classList.remove('hidden');
    financeContent?.classList.add('hidden');
    if (salesBtn) {
      salesBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-primary-600 text-white shadow-glow-primary";
    }
    if (financeBtn) {
      financeBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-white hover:bg-slate-800/50";
    }
  } else {
    salesContent?.classList.add('hidden');
    financeContent?.classList.remove('hidden');
    if (financeBtn) {
      financeBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-emerald-600 text-white shadow-lg";
    }
    if (salesBtn) {
      salesBtn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-white hover:bg-slate-800/50";
    }
    loadFinancialReportData();
  }
}

function openExpenseModal(defaultType = 'operational') {
  if (!requireAdmin(() => openExpenseModal(defaultType))) return;
  const modal = document.getElementById('modal-expense');
  if (!modal) return;
  const form = document.getElementById('form-expense');
  if (form) form.reset();

  const typeEl = document.getElementById('expense-type');
  if (typeEl) typeEl.value = defaultType;

  const dateEl = document.getElementById('expense-date');
  if (dateEl) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }

  onExpenseTypeChange();
  modal.classList.remove('hidden');
}

function closeExpenseModal() {
  const modal = document.getElementById('modal-expense');
  if (modal) modal.classList.add('hidden');
}

function onExpenseTypeChange() {
  const type = document.getElementById('expense-type')?.value;
  const title = document.getElementById('expense-modal-title');
  const sub = document.getElementById('expense-modal-subtitle');
  const icon = document.getElementById('expense-modal-icon');
  const iconBox = document.getElementById('expense-modal-icon-box');
  const submitBtn = document.getElementById('btn-submit-expense');

  if (type === 'capital') {
    if (title) title.innerText = "Tambah Modal Awal / Usaha";
    if (sub) sub.innerText = "Suntikan dana investasi atau kas laci";
    if (icon) icon.className = "fa-solid fa-sack-dollar";
    if (iconBox) iconBox.className = "w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400";
    if (submitBtn) submitBtn.className = "px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg text-xs transition-colors shadow-lg flex items-center gap-1.5";
  } else if (type === 'salary') {
    if (title) title.innerText = "Catat Gaji / Upah Karyawan";
    if (sub) sub.innerText = "Gaji bulanan, mingguan, atau upah harian kasir/karyawan";
    if (icon) icon.className = "fa-solid fa-users";
    if (iconBox) iconBox.className = "w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400";
    if (submitBtn) submitBtn.className = "px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-lg flex items-center gap-1.5";
  } else if (type === 'packaging') {
    if (title) title.innerText = "Bahan Tambahan & Kemasan";
    if (sub) sub.innerText = "Minyak goreng, saus, cup plastik, plastik kresek, dll.";
    if (icon) icon.className = "fa-solid fa-box-open";
    if (iconBox) iconBox.className = "w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400";
    if (submitBtn) submitBtn.className = "px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors shadow-lg flex items-center gap-1.5";
  } else {
    if (title) title.innerText = "Catat Biaya Operasional";
    if (sub) sub.innerText = "Sewa lapak, listrik, gas LPG, transport, dll.";
    if (icon) icon.className = "fa-solid fa-receipt";
    if (iconBox) iconBox.className = "w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400";
    if (submitBtn) submitBtn.className = "px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs transition-colors shadow-lg flex items-center gap-1.5";
  }
}

async function saveExpenseHandler(e) {
  e.preventDefault();
  const type = document.getElementById('expense-type').value;
  const title = document.getElementById('expense-title').value.trim();
  const amount = Number(document.getElementById('expense-amount').value) || 0;
  const dateStr = document.getElementById('expense-date').value;
  const note = document.getElementById('expense-note').value.trim();

  if (!title || amount <= 0 || !dateStr) {
    alert("Harap isi semua kolom wajib dengan benar!");
    return;
  }

  const timestamp = parseLocalDate(dateStr, false);

  const expenseItem = {
    type,
    title,
    amount,
    date: dateStr,
    timestamp,
    note
  };

  try {
    await DB.saveExpense(expenseItem);
    closeExpenseModal();
    await loadFinancialReportData();
    showToast(`Catatan "${title}" (Rp ${amount.toLocaleString('id-ID')}) berhasil disimpan!`, 'success');
  } catch (err) {
    console.error('Failed to save expense:', err);
    alert('Gagal menyimpan catatan pengeluaran: ' + err.message);
  }
}

async function deleteExpenseHandler(id) {
  if (!requireAdmin(() => deleteExpenseHandler(id))) return;
  if (confirm("Apakah Anda yakin ingin menghapus catatan biaya ini?")) {
    try {
      await DB.deleteExpense(id);
      await loadFinancialReportData();
      showToast("Catatan pengeluaran berhasil dihapus!", 'info');
    } catch (err) {
      console.error('Failed to delete expense:', err);
      alert('Gagal menghapus catatan: ' + err.message);
    }
  }
}

async function loadFinancialReportData(startTimestamp = null, endTimestamp = null, filteredTx = null) {
  const dateStartStr = document.getElementById('filter-date-start')?.value;
  const dateEndStr = document.getElementById('filter-date-end')?.value;

  if (!startTimestamp && dateStartStr) {
    startTimestamp = parseLocalDate(dateStartStr, false);
  }
  if (!endTimestamp && dateEndStr) {
    endTimestamp = parseLocalDate(dateEndStr, true);
  }

  // Get transactions if not provided
  if (!filteredTx) {
    const allTransactions = await DB.getTransactions();
    filteredTx = (startTimestamp && endTimestamp)
      ? allTransactions.filter(tx => tx.timestamp >= startTimestamp && tx.timestamp <= endTimestamp)
      : allTransactions;
  }

  // Calculate Sales Revenue and COGS (Cost of Goods Sold)
  let revenue = 0;
  let netSales = 0;
  let cogs = 0;
  filteredTx.forEach(tx => {
    revenue += tx.total;
    netSales += (tx.subtotal - (tx.discount || 0));
    tx.items.forEach(item => {
      cogs += (item.cost || 0) * item.quantity;
    });
  });
  const grossProfit = netSales - cogs;

  // Get all expenses from DB
  const allExpenses = await DB.getExpenses();

  // Filter expenses by date range
  const filteredExpenses = (startTimestamp && endTimestamp)
    ? allExpenses.filter(e => {
        const t = e.timestamp || parseLocalDate(e.date, false);
        return t >= startTimestamp && t <= endTimestamp;
      })
    : allExpenses;

  // Sum expenses by category
  let totalCapital = 0;
  let salaries = 0;
  let operational = 0;
  let packaging = 0;
  let other = 0;

  // For Capital, we take cumulative all-time capital
  allExpenses.forEach(e => {
    if (e.type === 'capital') {
      totalCapital += (e.amount || 0);
    }
  });

  filteredExpenses.forEach(e => {
    const amt = e.amount || 0;
    if (e.type === 'salary') {
      salaries += amt;
    } else if (e.type === 'operational') {
      operational += amt;
    } else if (e.type === 'packaging') {
      packaging += amt;
    } else if (e.type === 'other') {
      other += amt;
    }
  });

  const totalOpex = salaries + operational + packaging + other;
  const realNetProfit = grossProfit - totalOpex;

  // Update Metric Cards
  const elCapital = document.getElementById('fin-stat-capital');
  if (elCapital) elCapital.innerText = `Rp ${totalCapital.toLocaleString('id-ID')}`;

  const elOpex = document.getElementById('fin-stat-opex');
  if (elOpex) elOpex.innerText = `Rp ${totalOpex.toLocaleString('id-ID')}`;

  const elNetProfit = document.getElementById('fin-stat-net-profit');
  if (elNetProfit) elNetProfit.innerText = `Rp ${realNetProfit.toLocaleString('id-ID')}`;

  const elNetBadge = document.getElementById('fin-stat-net-badge');
  if (elNetBadge) {
    if (realNetProfit >= 0) {
      elNetBadge.innerText = "Surplus Laba";
      elNetBadge.className = "px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300";
    } else {
      elNetBadge.innerText = "Defisit Beban";
      elNetBadge.className = "px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-rose-500/20 text-rose-300";
    }
  }

  // Break-even (Balik Modal) Analysis
  const elBepStatus = document.getElementById('fin-stat-bep-status');
  const elBepDiff = document.getElementById('fin-stat-bep-diff');
  if (elBepStatus && elBepDiff) {
    if (totalCapital === 0) {
      elBepStatus.innerText = "Modal Belum Dicatat";
      elBepStatus.className = "text-base font-bold text-slate-400";
      elBepDiff.innerText = "Klik '+ Tambah Modal Usaha' di atas";
    } else {
      // Calculate all-time gross profit for BEP
      const allTx = await DB.getTransactions();
      let allGrossProfit = 0;
      allTx.forEach(tx => {
        let txCogs = 0;
        tx.items.forEach(it => { txCogs += (it.cost || 0) * it.quantity; });
        allGrossProfit += ((tx.subtotal - (tx.discount || 0)) - txCogs);
      });

      // All-time opex
      let allOpex = 0;
      allExpenses.forEach(e => {
        if (e.type !== 'capital') allOpex += (e.amount || 0);
      });

      const netCashBalance = allGrossProfit - allOpex;
      const bepDiff = netCashBalance - totalCapital;

      if (bepDiff >= 0) {
        elBepStatus.innerText = "SUDAH BALIK MODAL!";
        elBepStatus.className = "text-base font-extrabold text-emerald-400";
        elBepDiff.innerHTML = `Surplus Bersih: <strong class="text-white">Rp ${bepDiff.toLocaleString('id-ID')}</strong>`;
      } else {
        const remaining = Math.abs(bepDiff);
        const percent = Math.min(100, Math.max(0, Math.round((Math.max(0, netCashBalance) / totalCapital) * 100)));
        elBepStatus.innerText = `${percent}% Menuju BEP`;
        elBepStatus.className = "text-base font-extrabold text-amber-400";
        elBepDiff.innerHTML = `Kurang <strong class="text-rose-300">Rp ${remaining.toLocaleString('id-ID')}</strong> lagi untuk balik modal`;
      }
    }
  }

  // Update P&L Summary Box
  const setPnl = (id, val, prefix = '') => {
    const el = document.getElementById(id);
    if (el) el.innerText = `${prefix}Rp ${val.toLocaleString('id-ID')}`;
  };
  setPnl('pnl-revenue', revenue);
  setPnl('pnl-cogs', cogs, '- ');
  setPnl('pnl-gross-profit', grossProfit);
  setPnl('pnl-salaries', salaries, '- ');
  setPnl('pnl-operational', operational, '- ');
  setPnl('pnl-packaging', packaging, '- ');
  setPnl('pnl-other', other, '- ');
  
  const elPnlNet = document.getElementById('pnl-net-profit');
  if (elPnlNet) {
    elPnlNet.innerText = `Rp ${realNetProfit.toLocaleString('id-ID')}`;
    elPnlNet.className = realNetProfit >= 0 ? "font-extrabold text-emerald-400" : "font-extrabold text-rose-400";
  }

  // Render Table & Mobile List
  renderExpensesTable(filteredExpenses);
}

function renderExpensesTable(expenseList) {
  const tbody = document.getElementById('expenses-table-body');
  const mobList = document.getElementById('expenses-mobile-list');
  if (!tbody) return;

  const categoryFilter = document.getElementById('filter-expense-category')?.value || 'all';
  const filtered = categoryFilter === 'all' 
    ? expenseList 
    : expenseList.filter(e => e.type === categoryFilter);

  // Sort descending by date/timestamp
  const sorted = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const getBadge = (type) => {
    switch(type) {
      case 'capital':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">Modal Usaha</span>';
      case 'salary':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">Gaji Karyawan</span>';
      case 'packaging':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Kemasan &amp; Bahan</span>';
      case 'other':
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400 border border-slate-500/30">Lain-lain</span>';
      default:
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">Operasional</span>';
    }
  };

  // Desktop Table
  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-slate-500 font-semibold">
          Belum ada catatan pengeluaran / modal pada periode ini
        </td>
      </tr>
    `;
  } else {
    let html = '';
    sorted.forEach(exp => {
      const isCapital = exp.type === 'capital';
      html += `
        <tr class="border-b border-slate-800 hover:bg-slate-900/20 text-xs">
          <td class="p-3.5 pl-5 text-slate-400">${exp.date || '-'}</td>
          <td class="p-3.5">${getBadge(exp.type)}</td>
          <td class="p-3.5 font-bold text-white">${exp.title}</td>
          <td class="p-3.5 text-slate-400 max-w-xs truncate">${exp.note || '-'}</td>
          <td class="p-3.5 text-right font-bold ${isCapital ? 'text-sky-400' : 'text-rose-400'}">
            ${isCapital ? '+' : '-'} Rp ${(exp.amount || 0).toLocaleString('id-ID')}
          </td>
          <td class="p-3.5 text-center pr-5">
            <button onclick="deleteExpenseHandler(${exp.id})" class="p-1.5 text-slate-500 hover:text-danger-500 hover:bg-slate-800 rounded transition-colors" title="Hapus Catatan">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  // Mobile List
  if (mobList) {
    if (sorted.length === 0) {
      mobList.innerHTML = `
        <div class="py-6 text-center text-slate-500 font-semibold text-xs">
          Belum ada catatan pengeluaran / modal
        </div>
      `;
    } else {
      let mHtml = '';
      sorted.forEach(exp => {
        const isCapital = exp.type === 'capital';
        mHtml += `
          <div class="py-3 flex items-center justify-between gap-3 animate-[fadeIn_0.15s_ease-out]">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-1">
                ${getBadge(exp.type)}
                <span class="text-[10px] text-slate-500">${exp.date}</span>
              </div>
              <div class="font-bold text-slate-200 text-sm truncate">${exp.title}</div>
              ${exp.note ? `<p class="text-[10px] text-slate-400 truncate">${exp.note}</p>` : ''}
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
              <div class="text-right font-extrabold text-sm ${isCapital ? 'text-sky-400' : 'text-rose-400'}">
                ${isCapital ? '+' : '-'} Rp ${(exp.amount || 0).toLocaleString('id-ID')}
              </div>
              <button onclick="deleteExpenseHandler(${exp.id})" class="p-2 text-slate-500 hover:text-danger-500 rounded">
                <i class="fa-solid fa-trash-can text-xs"></i>
              </button>
            </div>
          </div>
        `;
      });
      mobList.innerHTML = mHtml;
    }
  }
}




