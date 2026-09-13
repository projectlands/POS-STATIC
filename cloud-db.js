/**
 * Multi-Database Cloud & Remote Sync Module for POS Static
 * Mendukung:
 * 1. Google Spreadsheet (Google Apps Script Web App Endpoint)
 * 2. MySQL / MariaDB (via REST API Bridge: api.php / Node endpoint)
 * 3. Firebase Firestore Cloud Database
 */

const CLOUD_STORAGE_KEY = 'pos_cloud_config';

const CloudDB = {
  app: null,
  firestore: null,
  isConfigured: false,
  isEnabled: false,
  status: 'disconnected', // 'connected' | 'connecting' | 'disconnected' | 'error'
  statusMessage: 'Database eksternal belum dikonfigurasi',
  provider: 'sheets', // 'sheets' | 'mysql' | 'firebase'
  onStatusChange: null,

  // Inisialisasi CloudDB dari localStorage
  async init() {
    const config = this.getConfig();
    if (!config) {
      this.setStatus('disconnected', 'Database eksternal belum dikonfigurasi');
      return false;
    }

    this.provider = config.provider || (config.projectId ? 'firebase' : 'sheets');
    this.isEnabled = config.enabled !== false;

    if (!this.isEnabled) {
      this.setStatus('disconnected', 'Mode Database Dinonaktifkan (Lokal Saja)');
      return false;
    }

    return this.connect(config);
  },

  // Mengambil konfigurasi dari localStorage
  getConfig() {
    try {
      const raw = localStorage.getItem(CLOUD_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Error reading cloud config:', e);
      return null;
    }
  },

  // Menyimpan konfigurasi
  saveConfig(config) {
    localStorage.setItem(CLOUD_STORAGE_KEY, JSON.stringify(config));
    this.provider = config.provider || 'sheets';
    this.isEnabled = config.enabled !== false;
  },

  // Update status dan trigger listener jika ada
  setStatus(status, message = '') {
    this.status = status;
    this.statusMessage = message;
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(status, message);
    }
  },

  // Menghubungkan ke Database yang Dipilih
  async connect(config) {
    const provider = config.provider || (config.projectId ? 'firebase' : 'sheets');
    this.provider = provider;
    this.setStatus('connecting', `Menghubungkan ke ${this.getProviderName(provider)}...`);

    try {
      if (provider === 'sheets') {
        if (!config.sheetsUrl) {
          this.setStatus('disconnected', 'URL Google Apps Script belum diisi');
          return false;
        }
        // Test ping ke Apps Script
        const res = await fetch(`${config.sheetsUrl}?action=ping`, { method: 'GET', mode: 'cors' });
        const json = await res.json();
        if (json.success) {
          this.isConfigured = true;
          this.setStatus('connected', `Terhubung ke Google Spreadsheet (${json.sheetName || 'Aktif'})`);
          await this.enforceAuthRequirement();
          return true;
        } else {
          throw new Error(json.message || 'Respon Google Sheets tidak valid');
        }

      } else if (provider === 'mysql') {
        if (!config.mysqlApiUrl) {
          this.setStatus('disconnected', 'URL Endpoint MySQL API belum diisi');
          return false;
        }
        const url = `${config.mysqlApiUrl}?action=ping&key=${encodeURIComponent(config.mysqlApiKey || '')}`;
        const res = await fetch(url, { method: 'GET' });
        const json = await res.json();
        if (json.success) {
          this.isConfigured = true;
          this.setStatus('connected', `Terhubung ke MySQL (${json.db_name || 'Online'})`);
          await this.enforceAuthRequirement();
          return true;
        } else {
          throw new Error(json.message || 'Respon MySQL API tidak valid');
        }

      } else {
        // Firebase Firestore
        if (!config.projectId || !config.apiKey) {
          this.setStatus('disconnected', 'Kredensial Firebase belum lengkap');
          return false;
        }
        if (typeof firebase === 'undefined') {
          this.setStatus('error', 'Library Firebase SDK belum termuat.');
          return false;
        }

        if (firebase.apps && firebase.apps.length > 0) {
          this.app = firebase.apps[0];
        } else {
          this.app = firebase.initializeApp({
            apiKey: config.apiKey,
            authDomain: config.authDomain,
            projectId: config.projectId,
            storageBucket: config.storageBucket,
            messagingSenderId: config.messagingSenderId,
            appId: config.appId
          });
        }

        this.firestore = firebase.firestore(this.app);
        this.isConfigured = true;

        await this.firestore.collection('_ping').doc('status').set({
          lastActive: new Date().toISOString(),
          client: 'POS Static PWA'
        }, { merge: true });

        this.setStatus('connected', 'Terhubung ke Firebase Firestore Cloud');
        await this.enforceAuthRequirement();
        return true;
      }
    } catch (err) {
      console.warn('Connection failed:', err);
      this.setStatus('error', err.message || 'Gagal terhubung ke database.');
      return false;
    }
  },

  // Otomatis aktifkan proteksi PIN saat database terhubung
  async enforceAuthRequirement() {
    if (typeof DB !== 'undefined' && DB.getAuthSettings) {
      try {
        const auth = await DB.getAuthSettings();
        if (!auth.required) {
          auth.required = true;
          await DB.saveAuthSettings(auth);
          console.log('[CloudDB] Auth security automatically activated upon database connection.');
        }
      } catch (e) {
        console.error('Failed to enforce auth:', e);
      }
    }
  },

  // Test koneksi secara eksplisit untuk tombol UI
  async testConnection(config) {
    const provider = config.provider || 'sheets';
    
    if (provider === 'sheets') {
      if (!config.sheetsUrl) throw new Error('URL Google Apps Script wajib diisi.');
      const res = await fetch(`${config.sheetsUrl}?action=ping`, { method: 'GET', mode: 'cors' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal tersambung ke Google Spreadsheet');
      return { success: true, message: `Koneksi Google Spreadsheet Sukses! Sheet: ${json.sheetName || 'Online'}` };

    } else if (provider === 'mysql') {
      if (!config.mysqlApiUrl) throw new Error('URL Endpoint MySQL API wajib diisi.');
      const url = `${config.mysqlApiUrl}?action=ping&key=${encodeURIComponent(config.mysqlApiKey || '')}`;
      const res = await fetch(url, { method: 'GET' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal tersambung ke MySQL API');
      return { success: true, message: `Koneksi MySQL / MariaDB Sukses! DB: ${json.db_name || 'OK'}` };

    } else {
      if (typeof firebase === 'undefined') throw new Error('Firebase SDK tidak ditemukan.');
      let tempApp = null;
      try {
        const appName = 'test_app_' + Date.now();
        tempApp = firebase.initializeApp({
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
          storageBucket: config.storageBucket,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId
        }, appName);

        const db = firebase.firestore(tempApp);
        await db.collection('_ping').doc('status').set({ testedAt: new Date().toISOString() }, { merge: true });
        await tempApp.delete();
        return { success: true, message: 'Koneksi ke Firebase Firestore Sukses!' };
      } catch (err) {
        if (tempApp) { try { await tempApp.delete(); } catch (_) {} }
        throw err;
      }
    }
  },

  // Putus koneksi
  disconnect() {
    this.firestore = null;
    this.isConfigured = false;
    this.setStatus('disconnected', 'Mode Database Dinonaktifkan (Lokal Saja)');
  },

  getProviderName(p) {
    if (p === 'sheets') return 'Google Spreadsheet';
    if (p === 'mysql') return 'MySQL / MariaDB';
    return 'Firebase Firestore';
  },

  // --- Realtime Sync Handlers ---

  async syncTransaction(transaction) {
    if (!this.isEnabled) return;
    const config = this.getConfig();
    if (!config) return;

    try {
      if (this.provider === 'sheets') {
        await fetch(config.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_transaction', data: transaction })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_transaction', data: transaction, key: config.mysqlApiKey })
        });
      } else if (this.firestore) {
        await this.firestore.collection('transactions').doc(String(transaction.id)).set({
          ...transaction,
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Transaction synced to remote database:', transaction.id);
    } catch (err) {
      console.error('Failed to sync transaction:', err);
    }
  },

  async syncProduct(product) {
    if (!this.isEnabled) return;
    const config = this.getConfig();
    if (!config) return;

    try {
      if (this.provider === 'sheets') {
        await fetch(config.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_product', data: product })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_product', data: product, key: config.mysqlApiKey })
        });
      } else if (this.firestore) {
        await this.firestore.collection('products').doc(String(product.id)).set({
          ...product,
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Product synced to remote database:', product.id);
    } catch (err) {
      console.error('Failed to sync product:', err);
    }
  },

  async syncExpense(expense) {
    if (!this.isEnabled) return;
    const config = this.getConfig();
    if (!config) return;

    try {
      if (this.provider === 'sheets') {
        await fetch(config.sheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_expense', data: expense })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_expense', data: expense, key: config.mysqlApiKey })
        });
      } else if (this.firestore) {
        await this.firestore.collection('expenses').doc(String(expense.id || Date.now())).set({
          ...expense,
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Expense synced to remote database:', expense.title);
    } catch (err) {
      console.error('Failed to sync expense:', err);
    }
  },

  // --- Bulk Sync Operations (Upload & Download) ---

  async uploadAllLocalData(localDB) {
    const config = this.getConfig();
    if (!config) throw new Error('Database belum dikonfigurasi');

    const [products, categories, transactions, storeInfo, expenses] = await Promise.all([
      localDB.getProducts(),
      localDB.getCategories(),
      localDB.getTransactions(),
      localDB.getSettings('store_info'),
      localDB.getExpenses ? localDB.getExpenses() : Promise.resolve([])
    ]);

    const payload = { products, categories, transactions, storeInfo, expenses };

    if (this.provider === 'sheets') {
      const res = await fetch(config.sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_upload', data: payload })
      });
      return {
        productsCount: products.length,
        categoriesCount: categories.length,
        transactionsCount: transactions.length,
        expensesCount: expenses.length
      };

    } else if (this.provider === 'mysql') {
      const res = await fetch(config.mysqlApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_upload', data: payload, key: config.mysqlApiKey })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal upload ke MySQL');
      return json;

    } else {
      // Firebase Firestore Batch
      if (!this.firestore) throw new Error('Firebase belum terhubung');
      const batch = this.firestore.batch();
      let opCount = 0;
      const maxBatch = 450;

      const commitIfNeeded = async () => {
        if (opCount >= maxBatch) {
          await batch.commit();
          opCount = 0;
        }
      };

      for (const p of products) {
        batch.set(this.firestore.collection('products').doc(String(p.id)), { ...p, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      for (const t of transactions) {
        batch.set(this.firestore.collection('transactions').doc(String(t.id)), { ...t, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      for (const e of expenses) {
        batch.set(this.firestore.collection('expenses').doc(String(e.id)), { ...e, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      if (opCount > 0) await batch.commit();

      return {
        productsCount: products.length,
        categoriesCount: categories.length,
        transactionsCount: transactions.length,
        expensesCount: expenses.length
      };
    }
  },

  async downloadAllCloudData(localDB) {
    const config = this.getConfig();
    if (!config) throw new Error('Database belum dikonfigurasi');

    if (this.provider === 'sheets') {
      const res = await fetch(`${config.sheetsUrl}?action=bulk_download`, { method: 'GET' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal download dari Google Sheets');

      await localDB.importFromCloud(json);
      return {
        productsCount: (json.products || []).length,
        transactionsCount: (json.transactions || []).length,
        expensesCount: (json.expenses || []).length
      };

    } else if (this.provider === 'mysql') {
      const res = await fetch(`${config.mysqlApiUrl}?action=bulk_download&key=${encodeURIComponent(config.mysqlApiKey || '')}`, { method: 'GET' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal download dari MySQL');

      await localDB.importFromCloud(json);
      return {
        productsCount: (json.products || []).length,
        transactionsCount: (json.transactions || []).length,
        expensesCount: (json.expenses || []).length
      };

    } else {
      // Firebase Firestore
      if (!this.firestore) throw new Error('Firebase belum terhubung');

      const [productsSnap, transactionsSnap, expensesSnap, settingsSnap] = await Promise.all([
        this.firestore.collection('products').get(),
        this.firestore.collection('transactions').get(),
        this.firestore.collection('expenses').get(),
        this.firestore.collection('settings').doc('store_info').get()
      ]);

      const products = productsSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const transactions = transactionsSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const expenses = expensesSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const storeInfo = settingsSnap.exists ? settingsSnap.data() : null;

      await localDB.importFromCloud({ products, transactions, expenses, storeInfo, categories: [] });

      return {
        productsCount: products.length,
        transactionsCount: transactions.length,
        expensesCount: expenses.length
      };
    }
  }
};
