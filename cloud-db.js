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
  unsubscribers: [],

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
        this.startRealtimeListeners();
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
    this.stopRealtimeListeners();
    this.firestore = null;
    this.isConfigured = false;
    this.setStatus('disconnected', 'Mode Database Dinonaktifkan (Lokal Saja)');
  },

  getActiveStoreId() {
    if (typeof DB !== 'undefined' && DB.getActiveStoreId) {
      return DB.getActiveStoreId() || 'store_gadget';
    }
    return localStorage.getItem('pos_active_store_id') || 'store_gadget';
  },

  getCollection(name) {
    if (!this.firestore) return null;
    const storeId = this.getActiveStoreId();
    return this.firestore.collection(`stores/${storeId}/${name}`);
  },

  getProviderName(p) {
    if (p === 'sheets') return 'Google Spreadsheet';
    if (p === 'mysql') return 'MySQL / MariaDB';
    return 'Firebase Firestore';
  },

  // --- Realtime Sync Handlers (Store-Scoped) ---

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
          body: JSON.stringify({ action: 'save_transaction', data: transaction, storeId: this.getActiveStoreId() })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_transaction', data: transaction, key: config.mysqlApiKey, storeId: this.getActiveStoreId() })
        });
      } else if (this.firestore) {
        await this.getCollection('transactions').doc(String(transaction.id)).set({
          ...transaction,
          storeId: this.getActiveStoreId(),
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Transaction synced to remote database:', transaction.id, 'Store:', this.getActiveStoreId());
    } catch (err) {
      console.error('Failed to sync transaction:', err);
    }
  },

  async deleteTransaction(id) {
    if (!this.isEnabled) return;
    const config = this.getConfig();
    try {
      if (this.provider === 'mysql' && config?.mysqlApiUrl) {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete_transaction', id: id, key: config.mysqlApiKey, storeId: this.getActiveStoreId() })
        }).catch(() => {});
      } else if (this.firestore) {
        await this.getCollection('transactions').doc(String(id)).delete();
        console.log('Transaction deleted from Firestore:', id, 'Store:', this.getActiveStoreId());
      }
    } catch (err) {
      console.error('Failed to delete transaction in remote database:', err);
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
          body: JSON.stringify({ action: 'save_product', data: product, storeId: this.getActiveStoreId() })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_product', data: product, key: config.mysqlApiKey, storeId: this.getActiveStoreId() })
        });
      } else if (this.firestore) {
        await this.getCollection('products').doc(String(product.id)).set({
          ...product,
          storeId: this.getActiveStoreId(),
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Product synced to remote database:', product.id, 'Store:', this.getActiveStoreId());
    } catch (err) {
      console.error('Failed to sync product:', err);
    }
  },

  async deleteProduct(id) {
    if (!this.isEnabled) return;
    try {
      if (this.firestore) {
        await this.getCollection('products').doc(String(id)).delete();
        console.log('Product deleted from Firestore:', id);
      }
    } catch (err) {
      console.error('Failed to delete product in Firestore:', err);
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
          body: JSON.stringify({ action: 'save_expense', data: expense, storeId: this.getActiveStoreId() })
        });
      } else if (this.provider === 'mysql') {
        await fetch(config.mysqlApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_expense', data: expense, key: config.mysqlApiKey, storeId: this.getActiveStoreId() })
        });
      } else if (this.firestore) {
        const docId = String(expense.id || expense.timestamp || Date.now());
        if (!expense.id) expense.id = !isNaN(Number(docId)) ? Number(docId) : docId;
        await this.getCollection('expenses').doc(docId).set({
          ...expense,
          id: expense.id,
          storeId: this.getActiveStoreId(),
          _syncedAt: new Date().toISOString()
        }, { merge: true });
      }
      console.log('Expense synced to remote database:', expense.title, 'Store:', this.getActiveStoreId());
    } catch (err) {
      console.error('Failed to sync expense:', err);
    }
  },

  async deleteExpense(id) {
    if (!this.isEnabled) return;
    try {
      if (this.firestore) {
        await this.getCollection('expenses').doc(String(id)).delete();
        console.log('Expense deleted from Firestore:', id);
      }
    } catch (err) {
      console.error('Failed to delete expense in Firestore:', err);
    }
  },

  async syncStockMutation(mutation) {
    if (!this.isEnabled) return;
    const config = this.getConfig();
    if (!config) return;

    try {
      if (this.firestore) {
        await this.getCollection('stock_mutations').doc(String(mutation.id || Date.now())).set({
          ...mutation,
          storeId: this.getActiveStoreId(),
          _syncedAt: new Date().toISOString()
        }, { merge: true });
        console.log('Stock mutation synced to Firestore:', mutation.id, 'Store:', this.getActiveStoreId());
      }
    } catch (err) {
      console.error('Failed to sync stock mutation:', err);
    }
  },

  async deleteStockMutation(id) {
    if (!this.isEnabled) return;
    try {
      if (this.firestore) {
        await this.getCollection('stock_mutations').doc(String(id)).delete();
        console.log('Stock mutation deleted from Firestore:', id);
      }
    } catch (err) {
      console.error('Failed to delete stock mutation in Firestore:', err);
    }
  },

  async syncSetting(key, value) {
    if (!this.isEnabled) return;
    try {
      if (this.firestore) {
        await this.getCollection('settings').doc(String(key)).set({
          key,
          value,
          storeId: this.getActiveStoreId(),
          _syncedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`Setting '${key}' synced to Firestore for store:`, this.getActiveStoreId());
      }
    } catch (err) {
      console.error(`Failed to sync setting '${key}':`, err);
    }
  },

  // --- Realtime Multi-Device Listeners (Store-Scoped) ---

  stopRealtimeListeners() {
    if (this.unsubscribers && this.unsubscribers.length > 0) {
      console.log(`[CloudDB] Stopping ${this.unsubscribers.length} active Firestore realtime listeners`);
      this.unsubscribers.forEach(unsub => {
        try { if (typeof unsub === 'function') unsub(); } catch (_) {}
      });
      this.unsubscribers = [];
    }
  },

  startRealtimeListeners() {
    this.stopRealtimeListeners();
    if (!this.firestore || typeof DB === 'undefined') return;

    const currentStoreId = this.getActiveStoreId();
    console.log(`[CloudDB] Starting Firestore Realtime Listeners for store '${currentStoreId}'...`);

    // 1. Realtime Products & Sempol Stock
    try {
      const unsubProducts = this.getCollection('products').onSnapshot(async (snapshot) => {
        if (this.getActiveStoreId() !== currentStoreId) return;
        let hasChanges = false;
        for (const change of snapshot.docChanges()) {
          const docData = change.doc.data();
          if (!docData) continue;
          delete docData._syncedAt;
          if (docData.id) docData.id = Number(docData.id);

          if (change.type === 'added' || change.type === 'modified') {
            await DB.execute('products', 'readwrite', (store) => store.put(docData));
            hasChanges = true;
          } else if (change.type === 'removed') {
            if (docData.id) {
              await DB.execute('products', 'readwrite', (store) => store.delete(Number(docData.id)));
              hasChanges = true;
            }
          }
        }
        if (hasChanges && typeof window.onCloudProductsUpdated === 'function') {
          window.onCloudProductsUpdated();
        }
      }, (err) => console.warn('[CloudDB] Products realtime error:', err));
      this.unsubscribers.push(unsubProducts);
    } catch (e) {
      console.warn('Failed to start products listener:', e);
    }

    // 2. Realtime Expenses
    try {
      const unsubExpenses = this.getCollection('expenses').onSnapshot(async (snapshot) => {
        if (this.getActiveStoreId() !== currentStoreId) return;
        let hasChanges = false;
        for (const change of snapshot.docChanges()) {
          const docData = change.doc.data();
          if (!docData) continue;
          delete docData._syncedAt;
          const docId = change.doc.id;
          if (!docData.id) {
            docData.id = !isNaN(Number(docId)) ? Number(docId) : docId;
          } else if (!isNaN(Number(docData.id))) {
            docData.id = Number(docData.id);
          }

          if (change.type === 'added' || change.type === 'modified') {
            // Cek apakah di lokal sudah ada expense yang identik (untuk mencegah duplikasi)
            const localExpenses = await DB.execute('expenses', 'readonly', (store) => store.getAll());
            const duplicateLocal = (localExpenses || []).find(e => 
              String(e.id) !== String(docData.id) &&
              e.type === docData.type &&
              e.title === docData.title &&
              Number(e.amount) === Number(docData.amount) &&
              e.date === docData.date &&
              Math.abs((e.timestamp || 0) - (docData.timestamp || 0)) < 3000
            );
            if (duplicateLocal) {
              await DB.execute('expenses', 'readwrite', (store) => store.delete(duplicateLocal.id));
            }

            await DB.execute('expenses', 'readwrite', (store) => store.put(docData));
            hasChanges = true;
          } else if (change.type === 'removed') {
            if (docData.id) {
              await DB.execute('expenses', 'readwrite', (store) => store.delete(Number(docData.id)));
              hasChanges = true;
            }
          }
        }
        if (hasChanges && typeof window.onCloudExpensesUpdated === 'function') {
          window.onCloudExpensesUpdated();
        }
      }, (err) => console.warn('[CloudDB] Expenses realtime error:', err));
      this.unsubscribers.push(unsubExpenses);
    } catch (e) {
      console.warn('Failed to start expenses listener:', e);
    }

    // 3. Realtime Transactions
    try {
      const unsubTransactions = this.getCollection('transactions').onSnapshot(async (snapshot) => {
        if (this.getActiveStoreId() !== currentStoreId) return;
        let hasChanges = false;
        for (const change of snapshot.docChanges()) {
          const docData = change.doc.data();
          if (!docData) continue;
          delete docData._syncedAt;
          if (docData.id) docData.id = Number(docData.id);

          if (change.type === 'added' || change.type === 'modified') {
            await DB.execute('transactions', 'readwrite', (store) => store.put(docData));
            hasChanges = true;
          } else if (change.type === 'removed') {
            if (docData.id) {
              await DB.execute('transactions', 'readwrite', (store) => store.delete(Number(docData.id)));
              hasChanges = true;
            }
          }
        }
        if (hasChanges && typeof window.onCloudTransactionsUpdated === 'function') {
          window.onCloudTransactionsUpdated();
        }
      }, (err) => console.warn('[CloudDB] Transactions realtime error:', err));
      this.unsubscribers.push(unsubTransactions);
    } catch (e) {
      console.warn('Failed to start transactions listener:', e);
    }

    // 4. Realtime Stock Mutations (Kulakan & Stok Opname)
    try {
      const unsubMutations = this.getCollection('stock_mutations').onSnapshot(async (snapshot) => {
        if (this.getActiveStoreId() !== currentStoreId) return;
        let hasChanges = false;
        for (const change of snapshot.docChanges()) {
          const docData = change.doc.data();
          if (!docData) continue;
          delete docData._syncedAt;
          if (docData.id) docData.id = Number(docData.id);

          if (DB.db && DB.db.objectStoreNames.contains('stock_mutations')) {
            if (change.type === 'added' || change.type === 'modified') {
              await DB.execute('stock_mutations', 'readwrite', (store) => store.put(docData));
              hasChanges = true;
            } else if (change.type === 'removed') {
              if (docData.id) {
                await DB.execute('stock_mutations', 'readwrite', (store) => store.delete(Number(docData.id)));
                hasChanges = true;
              }
            }
          }
        }
        if (hasChanges && typeof window.onCloudMutationsUpdated === 'function') {
          window.onCloudMutationsUpdated();
        }
      }, (err) => console.warn('[CloudDB] Stock mutations realtime error:', err));
      this.unsubscribers.push(unsubMutations);
    } catch (e) {
      console.warn('Failed to start stock mutations listener:', e);
    }

    // 5. Realtime Store Info & Branding
    try {
      const unsubSettings = this.getCollection('settings').doc('store_info').onSnapshot(async (doc) => {
        if (this.getActiveStoreId() !== currentStoreId) return;
        if (doc.exists) {
          const data = doc.data();
          const info = data ? (data.value || data) : null;
          if (info && info.name) {
            await DB.execute('settings', 'readwrite', (store) => store.put({ key: 'store_info', value: info }));
            if (typeof window.onCloudStoreInfoUpdated === 'function') {
              window.onCloudStoreInfoUpdated(info);
            }
          }
        }
      }, (err) => console.warn('[CloudDB] Settings realtime error:', err));
      this.unsubscribers.push(unsubSettings);
    } catch (e) {
      console.warn('Failed to start settings listener:', e);
    }
  },

  // --- Bulk Sync Operations (Store-Scoped Upload & Download) ---

  async uploadAllLocalData(localDB) {
    const config = this.getConfig();
    if (!config) throw new Error('Database belum dikonfigurasi');

    const storeId = this.getActiveStoreId();
    const [products, categories, transactions, storeInfo, expenses, stockMutations] = await Promise.all([
      localDB.getProducts(),
      localDB.getCategories(),
      localDB.getTransactions(),
      localDB.getSettings('store_info'),
      localDB.getExpenses ? localDB.getExpenses() : Promise.resolve([]),
      localDB.getStockMutations ? localDB.getStockMutations() : Promise.resolve([])
    ]);

    const payload = { products, categories, transactions, storeInfo, expenses, stockMutations, storeId };

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
        expensesCount: expenses.length,
        mutationsCount: stockMutations.length
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
      // Firebase Firestore Batch with Store Scoping
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

      // 1. Products
      for (const p of products) {
        batch.set(this.getCollection('products').doc(String(p.id)), { ...p, storeId, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      // 2. Transactions
      for (const t of transactions) {
        batch.set(this.getCollection('transactions').doc(String(t.id)), { ...t, storeId, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      // 3. Expenses
      for (const e of expenses) {
        batch.set(this.getCollection('expenses').doc(String(e.id)), { ...e, storeId, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      // 4. Stock Mutations
      for (const m of stockMutations) {
        batch.set(this.getCollection('stock_mutations').doc(String(m.id)), { ...m, storeId, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      // 5. Store Settings
      if (storeInfo) {
        batch.set(this.getCollection('settings').doc('store_info'), { key: 'store_info', value: storeInfo, storeId, _syncedAt: new Date().toISOString() }, { merge: true });
        opCount++;
        await commitIfNeeded();
      }

      if (opCount > 0) await batch.commit();

      return {
        productsCount: products.length,
        categoriesCount: categories.length,
        transactionsCount: transactions.length,
        expensesCount: expenses.length,
        mutationsCount: stockMutations.length
      };
    }
  },

  async downloadAllCloudData(localDB) {
    const config = this.getConfig();
    if (!config) throw new Error('Database belum dikonfigurasi');

    const storeId = this.getActiveStoreId();

    if (this.provider === 'sheets') {
      const res = await fetch(`${config.sheetsUrl}?action=bulk_download&storeId=${encodeURIComponent(storeId)}`, { method: 'GET' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal download dari Google Sheets');

      await localDB.importFromCloud(json);
      return {
        productsCount: (json.products || []).length,
        transactionsCount: (json.transactions || []).length,
        expensesCount: (json.expenses || []).length,
        mutationsCount: (json.stockMutations || []).length
      };

    } else if (this.provider === 'mysql') {
      const res = await fetch(`${config.mysqlApiUrl}?action=bulk_download&storeId=${encodeURIComponent(storeId)}&key=${encodeURIComponent(config.mysqlApiKey || '')}`, { method: 'GET' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal download dari MySQL');

      await localDB.importFromCloud(json);
      return {
        productsCount: (json.products || []).length,
        transactionsCount: (json.transactions || []).length,
        expensesCount: (json.expenses || []).length,
        mutationsCount: (json.stockMutations || []).length
      };

    } else {
      // Firebase Firestore with Store Scoping
      if (!this.firestore) throw new Error('Firebase belum terhubung');

      const [productsSnap, transactionsSnap, expensesSnap, settingsSnap, mutationsSnap] = await Promise.all([
        this.getCollection('products').get(),
        this.getCollection('transactions').get(),
        this.getCollection('expenses').get(),
        this.getCollection('settings').doc('store_info').get(),
        this.getCollection('stock_mutations').get()
      ]);

      const products = productsSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const transactions = transactionsSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const expenses = expensesSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; });
      const stockMutations = mutationsSnap ? mutationsSnap.docs.map(d => { const dt = d.data(); delete dt._syncedAt; return dt; }) : [];
      const storeInfo = settingsSnap.exists ? (settingsSnap.data().value || settingsSnap.data()) : null;

      await localDB.importFromCloud({ products, transactions, expenses, stockMutations, storeInfo, categories: [] });

      return {
        productsCount: products.length,
        transactionsCount: transactions.length,
        expensesCount: expenses.length,
        mutationsCount: stockMutations.length
      };
    }
  },

  // --- DEVICE PAIRING & INSTANT CLOUD SHARING (QR CODE & MAGIC LINK) ---

  // Ekspor konfigurasi ke payload aman (Base64) untuk dishare via QR / Link
  exportPairingPayload(extraMeta = {}) {
    const config = this.getConfig();
    if (!config) return null;
    const payload = {
      provider: config.provider || 'sheets',
      sheetsUrl: config.sheetsUrl || '',
      sheetsId: config.sheetsId || '',
      sheetsToken: config.sheetsToken || '',
      mysqlApiUrl: config.mysqlApiUrl || '',
      mysqlApiKey: config.mysqlApiKey || '',
      projectId: config.projectId || '',
      apiKey: config.apiKey || '',
      authDomain: config.authDomain || '',
      storageBucket: config.storageBucket || '',
      messagingSenderId: config.messagingSenderId || '',
      appId: config.appId || '',
      enabled: true,
      storeName: extraMeta.storeName || '',
      exportedAt: new Date().toISOString()
    };
    try {
      return btoa(encodeURIComponent(JSON.stringify(payload)));
    } catch (e) {
      console.error('Export payload error:', e);
      return null;
    }
  },

  // Generate URL lengkap dengan hash fragment
  generatePairingUrl(extraMeta = {}) {
    const payload = this.exportPairingPayload(extraMeta);
    if (!payload) return null;
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    return `${origin}${pathname}#cloud_connect=${payload}`;
  },

  // Parse payload dari QR atau Magic Link
  importPairingPayload(payloadStr) {
    if (!payloadStr) throw new Error('Payload kosong');
    try {
      let cleanStr = payloadStr.trim();
      // Handle jika kasir mem-paste URL utuh
      if (cleanStr.includes('#cloud_connect=')) {
        cleanStr = cleanStr.split('#cloud_connect=')[1];
      } else if (cleanStr.includes('cloud_connect=')) {
        const match = cleanStr.match(/cloud_connect=([^&]+)/);
        if (match) cleanStr = match[1];
      }
      const jsonStr = decodeURIComponent(atob(cleanStr));
      const config = JSON.parse(jsonStr);
      if (!config || !config.provider) {
        throw new Error('Data konfigurasi tidak lengkap');
      }
      return config;
    } catch (e) {
      console.error('Failed to parse pairing payload:', e);
      throw new Error('Kode atau tautan koneksi tidak valid atau rusak.');
    }
  },

  // Terapkan konfigurasi hasil pairing dan langsung sambungkan
  async applyPairingConfig(config) {
    if (!config) throw new Error('Konfigurasi tidak valid');
    this.saveConfig(config);
    return this.connect(config);
  }
};
