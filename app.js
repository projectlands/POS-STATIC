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
  activeProductEdit: null
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
  let deferredPrompt;
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    }
  });

  window.addEventListener('appinstalled', () => {
    console.log('POS App installed to homescreen!');
    installBtn.classList.add('hidden');
  });
}

// Database Loading
async function loadInitialData() {
  State.products = await DB.getProducts();
  State.categories = await DB.getCategories();
  State.storeInfo = await DB.getSettings('store_info');

  if (State.storeInfo) {
    State.taxRate = State.storeInfo.taxRate || 10;
    State.serviceChargeRate = State.storeInfo.serviceCharge || 5;
    document.getElementById('sidebar-store-name').innerText = State.storeInfo.name;
    document.getElementById('label-cart-tax').innerText = `${State.taxRate + State.serviceChargeRate}%`;
  }

  renderCategories();
  renderProducts();
  populateCategorySelects();
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
    reports: document.getElementById('btn-nav-reports')
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
    reports: document.getElementById('btn-m-nav-reports')
  };

  Object.keys(mNavButtons).forEach((key) => {
    if (mNavButtons[key]) {
      mNavButtons[key].className = "flex flex-col items-center justify-center w-16 text-slate-400 relative";
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
    if (mNavButtons.cashier) mNavButtons.cashier.className = "flex flex-col items-center justify-center w-16 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Mesin Kasir";
    renderProducts();
  } else if (viewName === 'cart') {
    document.getElementById('view-cashier').classList.remove('hidden');
    prodSec.classList.add('hidden');
    prodSec.classList.remove('flex');
    cartSec.classList.remove('hidden');
    cartSec.classList.add('flex', 'w-full');
    
    if (mNavButtons.cart) mNavButtons.cart.className = "flex flex-col items-center justify-center w-16 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Keranjang";
    renderCart();
  } else if (viewName === 'products') {
    document.getElementById('view-products').classList.remove('hidden');
    if (navButtons.products) navButtons.products.className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-primary-600 text-white shadow-glow-primary";
    if (mNavButtons.products) mNavButtons.products.className = "flex flex-col items-center justify-center w-16 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Kelola Produk";
    renderInventoryTable();
  } else if (viewName === 'reports') {
    document.getElementById('view-reports').classList.remove('hidden');
    if (navButtons.reports) navButtons.reports.className = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-primary-600 text-white shadow-glow-primary";
    if (mNavButtons.reports) mNavButtons.reports.className = "flex flex-col items-center justify-center w-16 text-primary-500 font-bold relative";
    document.getElementById('view-title').innerText = "Laporan Penjualan";
    
    // Set default dates for report
    const todayStr = new Date().toISOString().split('T')[0];
    const sevenDaysAgoStr = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
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

// Simple dynamic Toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 border border-primary-500/50 shadow-glow-primary text-white font-semibold text-xs py-3 px-6 rounded-xl z-50 animate-[fadeIn_0.15s_ease-out] flex items-center gap-2';
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-success-500"></i> ${message}`;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('animate-[fadeOut_0.2s_ease-in]');
    toast.addEventListener('animationend', () => toast.remove());
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

    // Deduct stocks locally
    for (const item of State.cart) {
      const prod = State.products.find(p => p.id === item.product.id);
      if (prod) {
        prod.stock = Math.max(0, prod.stock - item.quantity);
        await DB.saveProduct(prod);
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
  const container = document.getElementById('print-area');
  const modal = document.getElementById('modal-receipt');
  
  const shopName = State.storeInfo ? State.storeInfo.name : 'Ruang Temu';
  const shopAddr = State.storeInfo ? State.storeInfo.address : 'Jakarta, Indonesia';
  const shopPhone = State.storeInfo ? State.storeInfo.phone : '0812-3456-7890';
  const footer = State.storeInfo ? State.storeInfo.receiptFooter : 'Terima kasih atas kunjungan Anda!';
  
  const dateStr = new Date(tx.timestamp).toLocaleString('id-ID');

  let itemsHtml = '';
  tx.items.forEach(item => {
    const priceText = `${item.quantity} x ${item.price.toLocaleString('id-ID')}`;
    const subtotalText = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
    itemsHtml += `
${item.name.padEnd(20)}
  ${priceText.padEnd(15)} ${subtotalText.padStart(15)}
`;
  });

  const rawReceipt = `
========================================
           ${shopName.toUpperCase()}
     ${shopAddr}
         Telp: ${shopPhone}
========================================
No Nota  : ${tx.id}
Tanggal  : ${dateStr}
Kasir    : Administrator
========================================
${itemsHtml.trim()}
========================================
Subtotal       : Rp ${tx.subtotal.toLocaleString('id-ID').padStart(15)}
Diskon         : Rp ${tx.discount.toLocaleString('id-ID').padStart(15)}
Pajak & Layanan: Rp ${tx.taxSvc.toLocaleString('id-ID').padStart(15)}
----------------------------------------
TOTAL          : Rp ${tx.total.toLocaleString('id-ID').padStart(15)}
========================================
Bayar (${tx.paymentMethod.padEnd(4)})  : Rp ${tx.amountPaid.toLocaleString('id-ID').padStart(15)}
Kembalian      : Rp ${tx.change.toLocaleString('id-ID').padStart(15)}
========================================
${footer}
========================================
`;

  container.innerHTML = `<pre class="whitespace-pre-wrap leading-tight text-[11px] font-mono text-black">${rawReceipt}</pre>`;
  modal.classList.remove('hidden');
}

function closeReceiptModal() {
  document.getElementById('modal-receipt').classList.add('hidden');
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
              ${p.stock} pcs
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
                <div class="text-[10px] text-slate-500 mt-0.5">Stok: <span class="font-bold text-slate-300">${p.stock}</span></div>
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
  const modal = document.getElementById('modal-product');
  const title = document.getElementById('product-modal-title');
  const form = document.getElementById('form-product');

  form.reset();
  document.getElementById('product-id').value = '';
  State.activeProductEdit = null;

  if (mode === 'add') {
    title.innerText = "Tambah Produk Baru";
  } else {
    title.innerText = "Edit Produk";
  }

  modal.classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
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
}

async function saveProductHandler(e) {
  e.preventDefault();

  const id = document.getElementById('product-id').value;
  const product = {
    name: document.getElementById('product-name').value,
    category: document.getElementById('product-category').value,
    code: document.getElementById('product-code').value.trim(),
    cost: Number(document.getElementById('product-cost').value),
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

  const startTimestamp = new Date(dateStartStr + 'T00:00:00').getTime();
  // Include whole end day
  const endTimestamp = new Date(dateEndStr + 'T23:59:59').getTime();

  const transactions = await DB.getTransactions();

  // Filter transactions within range
  const filteredTx = transactions.filter(tx => {
    return tx.timestamp >= startTimestamp && tx.timestamp <= endTimestamp;
  });

  // Calculate Metrics
  let revenue = 0;
  let cost = 0;
  let txCount = filteredTx.length;

  filteredTx.forEach(tx => {
    revenue += tx.total;
    tx.items.forEach(item => {
      cost += (item.cost || 0) * item.quantity;
    });
  });

  const profit = revenue - cost;
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
  const start = new Date(dateStartStr);
  const end = new Date(dateEndStr);
  const daysDiff = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;

  const datesList = [];
  for (let i = 0; i < Math.min(daysDiff, 10); i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    datesList.push(d.toISOString().split('T')[0]);
  }

  // Aggregate revenues by date
  const salesByDate = {};
  datesList.forEach(d => salesByDate[d] = 0);

  txList.forEach(tx => {
    const txDateStr = new Date(tx.timestamp).toISOString().split('T')[0];
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
