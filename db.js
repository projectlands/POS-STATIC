const STORE_REGISTRY_KEY = 'pos_stores_registry';
const ACTIVE_STORE_KEY = 'pos_active_store_id';
const DB_VERSION = 4;

const DEFAULT_STORES = [
  {
    id: 'store_gadget',
    name: 'Ruang Temu Gadget & Electronic',
    tagline: 'Retail & Aksesoris Elektronik',
    type: 'retail',
    icon: 'fa-mobile-screen-button',
    badgeColor: 'from-indigo-500 to-purple-600',
    dbName: 'pos_database'
  },
  {
    id: 'store_sempol',
    name: 'Sempol Ayam Crispy Juara',
    tagline: 'Kuliner & Gorengan Tusukan',
    type: 'food',
    icon: 'fa-utensils',
    badgeColor: 'from-amber-500 to-orange-600',
    dbName: 'pos_database_sempol'
  }
];

const DB = {
  db: null,

  getActiveStoreId() {
    return localStorage.getItem(ACTIVE_STORE_KEY) || 'store_gadget';
  },

  setActiveStoreId(id) {
    localStorage.setItem(ACTIVE_STORE_KEY, id);
  },

  getAllStores() {
    try {
      const raw = localStorage.getItem(STORE_REGISTRY_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading store registry:', e);
    }
    localStorage.setItem(STORE_REGISTRY_KEY, JSON.stringify(DEFAULT_STORES));
    return DEFAULT_STORES;
  },

  getActiveStore() {
    const stores = this.getAllStores();
    const activeId = this.getActiveStoreId();
    return stores.find(s => s.id === activeId) || stores[0];
  },

  getCurrentDbName() {
    const store = this.getActiveStore();
    return store.dbName || (store.id === 'store_gadget' ? 'pos_database' : 'pos_database_' + store.id);
  },

  async switchStore(storeId) {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.setActiveStoreId(storeId);
    await this.init();
    if (storeId === 'store_sempol') {
      await this.repairSempolStoreData();
    }
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.startRealtimeListeners();
    }
  },

  addNewStore(storeData) {
    const stores = this.getAllStores();
    const newId = 'store_' + Date.now();
    const newStore = {
      id: newId,
      name: storeData.name,
      tagline: storeData.tagline || 'Outlet Cabang Baru',
      type: storeData.type || 'food',
      icon: storeData.icon || 'fa-store',
      badgeColor: storeData.badgeColor || 'from-emerald-500 to-teal-600',
      dbName: 'pos_database_' + newId
    };
    stores.push(newStore);
    localStorage.setItem(STORE_REGISTRY_KEY, JSON.stringify(stores));
    return newStore;
  },

  init() {
    return new Promise((resolve, reject) => {
      const dbName = this.getCurrentDbName();
      console.log('Opening IndexedDB for store:', this.getActiveStoreId(), '-> DB:', dbName);
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onblocked = (e) => {
        console.warn('Database open is blocked. Reloading to release locks...');
        window.location.reload();
      };

      request.onerror = (e) => {
        console.error('Database failed to open:', e);
        reject(e);
      };

      request.onsuccess = async (e) => {
        this.db = e.target.result;
        console.log('Database initialized successfully');
        if (this.getActiveStoreId() === 'store_sempol') {
          try {
            await this.repairSempolStoreData();
          } catch (err) {
            console.warn('[DB] Auto-repair sempol warning:', err);
          }
        }
        this.seedInitialData().then(resolve).catch(resolve);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Reset database if upgrading from v1 to v2 to seed new electronics products
        if (e.oldVersion < 2) {
          try {
            if (db.objectStoreNames.contains('products')) db.deleteObjectStore('products');
            if (db.objectStoreNames.contains('categories')) db.deleteObjectStore('categories');
            if (db.objectStoreNames.contains('transactions')) db.deleteObjectStore('transactions');
            if (db.objectStoreNames.contains('settings')) db.deleteObjectStore('settings');
          } catch (err) {
            console.error('Error clearing old object stores:', err);
          }
        }

        // Products store
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          productStore.createIndex('code', 'code', { unique: true });
          productStore.createIndex('category', 'category', { unique: false });
        }

        // Categories store
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        }

        // Transactions store
        if (!db.objectStoreNames.contains('transactions')) {
          const transactionStore = db.createObjectStore('transactions', { keyPath: 'id' });
          transactionStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Expenses store (Modal Awal, Biaya Operasional, Gaji, dll)
        if (!db.objectStoreNames.contains('expenses')) {
          const expenseStore = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
          expenseStore.createIndex('timestamp', 'timestamp', { unique: false });
          expenseStore.createIndex('type', 'type', { unique: false });
          expenseStore.createIndex('category', 'category', { unique: false });
        }

        // Stock Mutations store (Kulakan Supplier & Mutasi Tusuk Sempol)
        if (!db.objectStoreNames.contains('stock_mutations')) {
          const stockStore = db.createObjectStore('stock_mutations', { keyPath: 'id', autoIncrement: true });
          stockStore.createIndex('timestamp', 'timestamp', { unique: false });
          stockStore.createIndex('date', 'date', { unique: false });
          stockStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  },

  // Helper to execute operations
  execute(storeName, mode, callback) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('Database not initialized');
      }
      const transaction = this.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);

      transaction.oncomplete = () => {
        resolve(request.result);
      };

      transaction.onerror = (e) => {
        reject(e.target.error);
      };

      if (request) {
        request.onerror = (e) => {
          reject(e.target.error);
        };
      }
    });
  },

  // Products CRUD
  getProducts() {
    return this.execute('products', 'readonly', (store) => store.getAll());
  },

  getProductByCode(code) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction('products', 'readonly');
      const store = transaction.objectStore('products');
      const index = store.index('code');
      const request = index.get(code);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async saveProduct(product) {
    const resId = await this.execute('products', 'readwrite', (store) => {
      if (product.id) {
        product.id = Number(product.id);
        return store.put(product);
      } else {
        return store.add(product);
      }
    });
    const savedProduct = { ...product, id: product.id || resId };
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncProduct(savedProduct).catch(console.error);
    }
    return resId;
  },

  async deleteProduct(id) {
    const res = await this.execute('products', 'readwrite', (store) => store.delete(Number(id)));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.deleteProduct(id).catch(console.error);
    }
    return res;
  },

  // Categories CRUD
  getCategories() {
    return this.execute('categories', 'readonly', (store) => store.getAll());
  },

  async saveCategory(category) {
    const resId = await this.execute('categories', 'readwrite', (store) => {
      if (category.id) {
        category.id = Number(category.id);
        return store.put(category);
      } else {
        return store.add(category);
      }
    });
    const savedCategory = { ...category, id: category.id || resId };
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncCategory(savedCategory).catch(console.error);
    }
    return resId;
  },

  async deleteCategory(id) {
    const res = await this.execute('categories', 'readwrite', (store) => store.delete(Number(id)));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.deleteCategory(id).catch(console.error);
    }
    return res;
  },

  // Transactions CRUD
  getTransactions() {
    return this.execute('transactions', 'readonly', (store) => store.getAll());
  },

  async saveTransaction(transaction) {
    const res = await this.execute('transactions', 'readwrite', (store) => store.add(transaction));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncTransaction(transaction).catch(console.error);
    }
    return res;
  },

  async deleteTransaction(id) {
    let res = await this.execute('transactions', 'readwrite', (store) => store.delete(id));
    if (typeof id === 'string' && !isNaN(id)) {
      await this.execute('transactions', 'readwrite', (store) => store.delete(Number(id)));
    } else if (typeof id === 'number') {
      await this.execute('transactions', 'readwrite', (store) => store.delete(String(id)));
    }
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.deleteTransaction(id).catch(console.error);
    }
    return res;
  },

  // Settings CRUD
  getSettings(key) {
    return new Promise((resolve) => {
      this.execute('settings', 'readonly', (store) => store.get(key))
        .then((result) => resolve(result ? result.value : null))
        .catch(() => resolve(null));
    });
  },

  async saveSettings(key, value) {
    const res = await this.execute('settings', 'readwrite', (store) => store.put({ key, value }));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncSetting(key, value).catch(console.error);
    }
    return res;
  },

  // Auth Settings (PIN Kasir & Admin)
  async getAuthSettings() {
    const defaultAuth = {
      required: false,
      adminPin: '1234',
      cashierPin: '0000',
      adminName: 'Admin / Owner',
      cashierName: 'Kasir Utama'
    };
    const saved = await this.getSettings('auth_config');
    return saved ? { ...defaultAuth, ...saved } : defaultAuth;
  },

  async saveAuthSettings(config) {
    return this.saveSettings('auth_config', config);
  },

  // Expenses CRUD (Buku Kas & Pengeluaran)
  getExpenses(includeDeleted = false) {
    return new Promise((resolve) => {
      this.execute('expenses', 'readonly', (store) => store.getAll())
        .then((res) => {
          const all = res || [];
          resolve(includeDeleted ? all : all.filter(e => !e.isDeleted));
        })
        .catch(() => resolve([]));
    });
  },

  getDeletedExpenses() {
    return new Promise((resolve) => {
      this.execute('expenses', 'readonly', (store) => store.getAll())
        .then((res) => {
          const all = res || [];
          resolve(all.filter(e => !!e.isDeleted));
        })
        .catch(() => resolve([]));
    });
  },

  async saveExpense(expense) {
    if (!expense.timestamp) expense.timestamp = Date.now();
    if (!expense.id) expense.id = Date.now();
    const res = await this.execute('expenses', 'readwrite', (store) => store.put(expense));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncExpense(expense).catch(console.error);
    }
    return res;
  },

  // Soft delete: tandai isDeleted agar bisa dipulihkan dari Kotak Sampah
  async deleteExpense(id) {
    const expense = await this.execute('expenses', 'readonly', (store) => store.get(Number(id)));
    if (expense) {
      expense.isDeleted = true;
      expense.deletedAt = Date.now();
      await this.execute('expenses', 'readwrite', (store) => store.put(expense));
      if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
        CloudDB.syncExpense(expense).catch(console.error);
      }
      return true;
    }
    return false;
  },

  // Pulihkan catatan dari Kotak Sampah kembali ke Buku Kas
  async restoreExpense(id) {
    const expense = await this.execute('expenses', 'readonly', (store) => store.get(Number(id)));
    if (expense) {
      expense.isDeleted = false;
      delete expense.deletedAt;
      await this.execute('expenses', 'readwrite', (store) => store.put(expense));
      if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
        CloudDB.syncExpense(expense).catch(console.error);
      }
      return expense;
    }
    return null;
  },

  // Hapus permanen selamanya dari database lokal dan Cloud
  async permanentlyDeleteExpense(id) {
    const res = await this.execute('expenses', 'readwrite', (store) => store.delete(Number(id)));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.deleteExpense(id).catch(console.error);
    }
    return res;
  },

  // Import data dari Cloud Firestore ke IndexedDB Lokal
  async importFromCloud({ products, categories, transactions, storeInfo, expenses, stockMutations }) {
    if (categories && categories.length > 0) {
      for (const cat of categories) {
        if (cat.id && !isNaN(cat.id)) cat.id = Number(cat.id);
        await this.execute('categories', 'readwrite', (store) => store.put(cat));
      }
    }
    if (products && Array.isArray(products) && products.length > 0) {
      const cloudProductIds = new Set();
      for (const prod of products) {
        if (prod.id && !isNaN(prod.id)) prod.id = Number(prod.id);
        cloudProductIds.add(prod.id);
        await this.execute('products', 'readwrite', (store) => store.put(prod));
      }
      // Hapus produk lokal yang sudah dihapus di cloud
      try {
        const localProds = await this.getProducts();
        for (const lp of localProds) {
          if (!cloudProductIds.has(lp.id)) {
            console.log('[DB] Removing product deleted from cloud:', lp.name, lp.id);
            await this.execute('products', 'readwrite', (store) => store.delete(lp.id));
          }
        }
      } catch (err) {
        console.warn('[DB] Error pruning deleted cloud products:', err);
      }
    }
    if (transactions && transactions.length > 0) {
      for (const trx of transactions) {
        if (trx.id && !isNaN(trx.id)) trx.id = Number(trx.id);
        await this.execute('transactions', 'readwrite', (store) => store.put(trx));
      }
    }
    if (expenses && expenses.length > 0) {
      for (const exp of expenses) {
        if (exp.id && !isNaN(exp.id)) exp.id = Number(exp.id);
        await this.execute('expenses', 'readwrite', (store) => store.put(exp));
      }
    }
    if (stockMutations && stockMutations.length > 0) {
      if (this.db && this.db.objectStoreNames.contains('stock_mutations')) {
        for (const mut of stockMutations) {
          if (mut.id && !isNaN(mut.id)) mut.id = Number(mut.id);
          await this.execute('stock_mutations', 'readwrite', (store) => store.put(mut));
        }
      }
    }
    if (storeInfo) {
      await this.saveSettings('store_info', storeInfo);
    }
    return true;
  },

  // Stock Mutations CRUD (Kartu Stok & Kulakan Tusuk Sempol)
  getStockMutations(includeDeleted = false) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('stock_mutations')) {
        return resolve([]);
      }
      this.execute('stock_mutations', 'readonly', (store) => store.getAll())
        .then((res) => {
          const all = res || [];
          resolve(includeDeleted ? all : all.filter(m => !m.isDeleted));
        })
        .catch(() => resolve([]));
    });
  },

  async saveStockMutation(mutation) {
    if (!this.db || !this.db.objectStoreNames.contains('stock_mutations')) {
      return null;
    }
    if (!mutation.timestamp) mutation.timestamp = Date.now();
    if (!mutation.date) mutation.date = new Date().toISOString().split('T')[0];
    const resId = await this.execute('stock_mutations', 'readwrite', (store) => {
      if (mutation.id) {
        mutation.id = Number(mutation.id);
        return store.put(mutation);
      } else {
        return store.add(mutation);
      }
    });
    const savedMutation = { ...mutation, id: mutation.id || resId };
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.syncStockMutation(savedMutation).catch(console.error);
    }
    return resId;
  },

  async deleteStockMutation(id) {
    if (!this.db || !this.db.objectStoreNames.contains('stock_mutations')) {
      return Promise.resolve(false);
    }
    const mut = await this.execute('stock_mutations', 'readonly', (store) => store.get(Number(id)));
    if (mut) {
      mut.isDeleted = true;
      mut.deletedAt = Date.now();
      await this.execute('stock_mutations', 'readwrite', (store) => store.put(mut));
      if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
        CloudDB.syncStockMutation(mut).catch(console.error);
      }
      return true;
    }
    return false;
  },

  async restoreStockMutation(id) {
    if (!this.db || !this.db.objectStoreNames.contains('stock_mutations')) {
      return Promise.resolve(null);
    }
    const mut = await this.execute('stock_mutations', 'readonly', (store) => store.get(Number(id)));
    if (mut) {
      mut.isDeleted = false;
      delete mut.deletedAt;
      await this.execute('stock_mutations', 'readwrite', (store) => store.put(mut));
      if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
        CloudDB.syncStockMutation(mut).catch(console.error);
      }
      return mut;
    }
    return null;
  },

  async permanentlyDeleteStockMutation(id) {
    if (!this.db || !this.db.objectStoreNames.contains('stock_mutations')) {
      return Promise.resolve(false);
    }
    const res = await this.execute('stock_mutations', 'readwrite', (store) => store.delete(Number(id)));
    if (typeof CloudDB !== 'undefined' && CloudDB.isEnabled) {
      CloudDB.deleteStockMutation(id).catch(console.error);
    }
    return res;
  },

  // Helper untuk mendapatkan stok bahan tusuk sempol
  async getSempolStock() {
    const products = await this.getProducts();
    const sempol = products.find(p => p.isSempol);
    return sempol ? sempol.stock : 0;
  },

  // Helper untuk menambah atau mengupdate stok tusuk sempol ke semua menu paket
  async updateSempolStock(newStock) {
    const products = await this.getProducts();
    for (const p of products) {
      if (p.isSempol) {
        p.stock = Math.max(0, newStock);
        await this.saveProduct(p);
      }
    }
  },

  // Perbaikan & Pembersihan data khusus POS Sempol Ayam
  async repairSempolStoreData() {
    if (this.getActiveStoreId() !== 'store_sempol') return;
    console.log('[DB] Running repair & deduplication for Sempol store...');

    // 1. Perbaiki Identitas Toko jika tertimpa Toko Gadget
    const currentStoreInfo = await this.getSettings('store_info');
    if (!currentStoreInfo || !currentStoreInfo.name || currentStoreInfo.name.includes('Ruang Temu') || currentStoreInfo.name.includes('Gadget') || currentStoreInfo.taxRate === 11) {
      const sempolInfo = {
        name: 'Sempol Ayam Crispy Juara',
        address: 'Jl. Kuliner No. 8, Lapak Kaki Lima',
        phone: '0812-3456-7890',
        taxRate: 0,
        serviceCharge: 0,
        currency: 'IDR',
        receiptFooter: 'Matur nuwun! Gurih, Renyah, Mantap!'
      };
      await this.saveSettings('store_info', sempolInfo);
      if (typeof State !== 'undefined') {
        State.storeInfo = sempolInfo;
      }
    }

    // 2. Perbaiki Kategori: Hapus kategori gadget yang sempat masuk
    const sempolCatNames = ['Paket Sempol', 'Minuman Segar', 'Ekstra & Saus'];
    const currentCats = await this.getCategories();
    for (const cat of currentCats) {
      if (!sempolCatNames.includes(cat.name)) {
        await this.deleteCategory(cat.id);
      }
    }
    const freshCats = await this.getCategories();
    const existingCatNames = freshCats.map(c => c.name);
    for (const name of sempolCatNames) {
      if (!existingCatNames.includes(name)) {
        await this.saveCategory({ name });
      }
    }

    // 3. Perbaiki Produk: Bersihkan produk gadget & duplikat
    const allProducts = await this.getProducts();
    const seenCodes = new Map();
    let maxSempolStock = 100;

    for (const prod of allProducts) {
      const isGadgetCode = prod.code && String(prod.code).startsWith('EL');
      const isGadgetCat = ['Smartphone & Tablet', 'Audio & Headphone', 'Aksesoris & Charger', 'Laptop & Komputer', 'Wearable & Smartwatch'].includes(prod.category);

      if (isGadgetCode || isGadgetCat) {
        console.log('[DB] Removing alien gadget product from Sempol store:', prod.name, prod.code);
        await this.deleteProduct(prod.id);
        continue;
      }

      if (prod.isSempol && prod.stock && prod.stock > 0) {
        if (prod.stock > maxSempolStock) maxSempolStock = prod.stock;
      }

      if (prod.code) {
        if (seenCodes.has(prod.code)) {
          console.log('[DB] Removing duplicate product in Sempol store:', prod.name, prod.code, 'ID:', prod.id);
          await this.deleteProduct(prod.id);
        } else {
          seenCodes.set(prod.code, prod);
        }
      }
    }

    // 4. Pastikan menu utama Sempol hanya di-seed jika database produk masih kosong bersih
    // (Produk yang sudah dihapus oleh pengguna tidak akan dipaksa muncul kembali)

    // 5. Samakan stok tusuk sempol di semua menu sempol
    const finalProducts = await this.getProducts();
    for (const p of finalProducts) {
      if (p.isSempol && p.stock !== maxSempolStock) {
        p.stock = maxSempolStock;
        await this.execute('products', 'readwrite', (store) => store.put(p));
      }
    }

    // 6. Bersihkan transaksi alien / duplikat di Sempol
    const txList = await this.getTransactions();
    const seenTxKeys = new Set();
    for (const tx of txList) {
      const isGadgetTx = tx.items && tx.items.some(it => it.code && String(it.code).startsWith('EL'));
      const txKey = String(tx.id);
      if (isGadgetTx) {
        console.log('[DB] Removing alien gadget transaction from Sempol store:', tx.id);
        await this.deleteTransaction(tx.id);
      } else if (seenTxKeys.has(txKey)) {
        console.log('[DB] Removing duplicate transaction from Sempol store:', tx.id);
        await this.deleteTransaction(tx.id);
      } else {
        seenTxKeys.add(txKey);
      }
    }
  },

  // Seeding initial premium products & settings
  async seedInitialData() {
    const activeStoreId = this.getActiveStoreId();
    const products = await this.getProducts();
    const categories = await this.getCategories();
    const storeInfo = await this.getSettings('store_info');

    // ==========================================
    // SEEDING KHUSUS: POS SEMPOL AYAM CRISPY
    // ==========================================
    if (activeStoreId === 'store_sempol') {
      if (!storeInfo) {
        await this.saveSettings('store_info', {
          name: 'Sempol Ayam Crispy Juara',
          address: 'Jl. Kuliner No. 8, Lapak Kaki Lima',
          phone: '0812-3456-7890',
          taxRate: 0,
          serviceCharge: 0,
          currency: 'IDR',
          receiptFooter: 'Matur nuwun! Gurih, Renyah, Mantap!'
        });
      }

      if (categories.length === 0) {
        const sempolCats = [
          { name: 'Paket Sempol' },
          { name: 'Minuman Segar' },
          { name: 'Ekstra & Saus' }
        ];
        for (const cat of sempolCats) {
          await this.saveCategory(cat);
        }
      }

      if (products.length === 0) {
        const initialSempolProducts = [
          {
            name: 'Sempol Paket Puas (6 Tusuk)',
            price: 10000,
            cost: 2400,
            unitCost: 400,
            piecesPerUnit: 6,
            stock: 100,
            category: 'Paket Sempol',
            code: 'SMP-001',
            color: 'amber',
            icon: 'fa-utensils',
            isSempol: true
          },
          {
            name: 'Sempol Paket Hemat (3 Tusuk)',
            price: 5000,
            cost: 1200,
            unitCost: 400,
            piecesPerUnit: 3,
            stock: 100,
            category: 'Paket Sempol',
            code: 'SMP-002',
            color: 'orange',
            icon: 'fa-utensils',
            isSempol: true
          },
          {
            name: 'Sempol Paket Jumbo (10 Tusuk)',
            price: 15000,
            cost: 4000,
            unitCost: 400,
            piecesPerUnit: 10,
            stock: 100,
            category: 'Paket Sempol',
            code: 'SMP-003',
            color: 'yellow',
            icon: 'fa-fire',
            isSempol: true
          },
          {
            name: 'Sempol Eceran (1 Tusuk)',
            price: 2000,
            cost: 400,
            unitCost: 400,
            piecesPerUnit: 1,
            stock: 100,
            category: 'Paket Sempol',
            code: 'SMP-004',
            color: 'rose',
            icon: 'fa-utensils',
            isSempol: true
          },
          {
            name: 'Es Teh Manis Jumbo',
            price: 5000,
            cost: 1500,
            unitCost: 1500,
            piecesPerUnit: 1,
            stock: 50,
            category: 'Minuman Segar',
            code: 'DRK-001',
            color: 'emerald',
            icon: 'fa-glass-water',
            isSempol: false
          },
          {
            name: 'Air Mineral Dingin',
            price: 3000,
            cost: 1500,
            unitCost: 1500,
            piecesPerUnit: 1,
            stock: 40,
            category: 'Minuman Segar',
            code: 'DRK-002',
            color: 'sky',
            icon: 'fa-bottle-water',
            isSempol: false
          },
          {
            name: 'Ekstra Saus Sambal Pedas Manis',
            price: 1000,
            cost: 300,
            unitCost: 300,
            piecesPerUnit: 1,
            stock: 80,
            category: 'Ekstra & Saus',
            code: 'TOP-001',
            color: 'red',
            icon: 'fa-pepper-hot',
            isSempol: false
          }
        ];

        for (const prod of initialSempolProducts) {
          await this.saveProduct(prod);
        }
      }
      return;
    }

    // ==========================================
    // SEEDING DEFAULT: TOKO GADGET & ELECTRONIC
    // ==========================================
    if (!storeInfo) {
      await this.saveSettings('store_info', {
        name: 'Ruang Temu Gadget & Electronic',
        address: 'MTC Mall Lantai 2, Jakarta Pusat',
        phone: '0812-9876-5432',
        taxRate: 11, // 11% PPN Indonesia
        serviceCharge: 0, // No service charge for retail
        currency: 'IDR',
        receiptFooter: 'Terima kasih telah berbelanja di toko kami!'
      });
    }

    // Default categories for electronics
    if (categories.length === 0) {
      const defaultCats = [
        { name: 'Smartphone & Tablet' },
        { name: 'Audio & Headphone' },
        { name: 'Aksesoris & Charger' },
        { name: 'Laptop & Komputer' },
        { name: 'Wearable & Smartwatch' }
      ];
      for (const cat of defaultCats) {
        await this.saveCategory(cat);
      }
    }

    // Default products with mock QR/Barcodes (Electronics)
    if (products.length === 0) {
      const initialProducts = [
        {
          name: 'iPhone 15 Pro Max 256GB',
          price: 22499000,
          cost: 18000000,
          unitCost: 18000000,
          piecesPerUnit: 1,
          stock: 15,
          category: 'Smartphone & Tablet',
          code: 'EL001',
          color: 'indigo',
          icon: 'fa-mobile-screen-button'
        },
        {
          name: 'Samsung Galaxy S24 Ultra',
          price: 20999000,
          cost: 16500000,
          unitCost: 16500000,
          piecesPerUnit: 1,
          stock: 10,
          category: 'Smartphone & Tablet',
          code: 'EL002',
          color: 'amber',
          icon: 'fa-mobile-screen-button'
        },
        {
          name: 'Sony WH-1000XM5 ANC Headphone',
          price: 4899000,
          cost: 3800000,
          unitCost: 3800000,
          piecesPerUnit: 1,
          stock: 20,
          category: 'Audio & Headphone',
          code: 'EL003',
          color: 'rose',
          icon: 'fa-headphones'
        },
        {
          name: 'JBL Charge 5 Bluetooth Speaker',
          price: 2599000,
          cost: 1950000,
          unitCost: 1950000,
          piecesPerUnit: 1,
          stock: 25,
          category: 'Audio & Headphone',
          code: 'EL004',
          color: 'orange',
          icon: 'fa-volume-high'
        },
        {
          name: 'Anker PowerCore 30W Powerbank',
          price: 450000,
          cost: 290000,
          unitCost: 290000,
          piecesPerUnit: 1,
          stock: 50,
          category: 'Aksesoris & Charger',
          code: 'EL005',
          color: 'green',
          icon: 'fa-plug'
        },
        {
          name: 'MacBook Air M3 8/256GB',
          price: 16999000,
          cost: 14200000,
          unitCost: 14200000,
          piecesPerUnit: 1,
          stock: 8,
          category: 'Laptop & Komputer',
          code: 'EL006',
          color: 'emerald',
          icon: 'fa-laptop'
        },
        {
          name: 'Logitech MX Master 3S Mouse',
          price: 1450000,
          cost: 1050000,
          unitCost: 1050000,
          piecesPerUnit: 1,
          stock: 30,
          category: 'Laptop & Komputer',
          code: 'EL007',
          color: 'yellow',
          icon: 'fa-computer-mouse'
        },
        {
          name: 'Apple Watch Series 9 GPS 45mm',
          price: 6499000,
          cost: 5100000,
          unitCost: 5100000,
          piecesPerUnit: 1,
          stock: 12,
          category: 'Wearable & Smartwatch',
          code: 'EL008',
          color: 'pink',
          icon: 'fa-stopwatch'
        },
        {
          name: 'Baseus USB-C to USB-C 100W Cable',
          price: 85000,
          cost: 40000,
          unitCost: 40000,
          piecesPerUnit: 1,
          stock: 100,
          category: 'Aksesoris & Charger',
          code: 'EL009',
          color: 'red',
          icon: 'fa-plug'
        }
      ];

      for (const prod of initialProducts) {
        await this.saveProduct(prod);
      }
    }
  }
};
window.DB = DB; // Make it globally accessible
