/**
 * Cloud Database Module (Firebase Firestore) for POS Static
 * Mendukung sinkronisasi hybrid: IndexedDB Lokal <-> Firebase Firestore Cloud
 */

const CLOUD_STORAGE_KEY = 'pos_cloud_config';

const CloudDB = {
  app: null,
  firestore: null,
  isConfigured: false,
  isEnabled: false,
  status: 'disconnected', // 'connected' | 'connecting' | 'disconnected' | 'error'
  statusMessage: 'Cloud belum dikonfigurasi',
  onStatusChange: null,

  // Inisialisasi CloudDB dari localStorage
  async init() {
    const config = this.getConfig();
    if (!config || !config.projectId || !config.apiKey) {
      this.setStatus('disconnected', 'Cloud belum dikonfigurasi');
      return false;
    }

    this.isEnabled = config.enabled !== false;
    if (!this.isEnabled) {
      this.setStatus('disconnected', 'Cloud dinonaktifkan (Mode Lokal)');
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

  // Menghubungkan ke Firebase
  async connect(config) {
    this.setStatus('connecting', 'Menghubungkan ke Firebase Firestore...');

    if (typeof firebase === 'undefined') {
      this.setStatus('error', 'Library Firebase SDK belum termuat.');
      return false;
    }

    try {
      // Hapus app sebelumnya jika ada
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

      // Test koneksi ringan dengan ping collection info
      await this.firestore.collection('_ping').doc('status').set({
        lastActive: new Date().toISOString(),
        client: 'POS Static PWA'
      }, { merge: true });

      this.setStatus('connected', 'Terhubung ke Firebase Cloud');
      return true;
    } catch (err) {
      console.warn('Firebase connection test warning:', err);
      if (err.code === 'permission-denied') {
        this.setStatus('error', 'Izin ditolak. Pastikan Firestore Rules dalam mode test.');
      } else {
        this.setStatus('error', err.message || 'Gagal terhubung ke Cloud');
      }
      return false;
    }
  },

  // Test koneksi secara eksplisit untuk tombol UI
  async testConnection(config) {
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase SDK tidak ditemukan di browser');
    }

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
      await db.collection('_ping').doc('status').set({
        testedAt: new Date().toISOString(),
        test: true
      }, { merge: true });

      await tempApp.delete();
      return { success: true, message: 'Koneksi ke Firebase Firestore Berhasil!' };
    } catch (err) {
      if (tempApp) {
        try { await tempApp.delete(); } catch (_) {}
      }
      throw err;
    }
  },

  // --- Realtime / Event-driven Data Sync ---

  // Sinkronisasi 1 Transaksi Baru ke Cloud
  async syncTransaction(transaction) {
    if (!this.isEnabled || !this.firestore) return;
    try {
      const docId = String(transaction.id || ('TRX-' + Date.now()));
      await this.firestore.collection('transactions').doc(docId).set({
        ...transaction,
        _syncedAt: new Date().toISOString()
      }, { merge: true });
      console.log('Transaction synced to cloud:', docId);
    } catch (err) {
      console.error('Failed to sync transaction to cloud:', err);
    }
  },

  // Sinkronisasi 1 Produk ke Cloud
  async syncProduct(product) {
    if (!this.isEnabled || !this.firestore) return;
    try {
      const docId = String(product.id);
      await this.firestore.collection('products').doc(docId).set({
        ...product,
        _syncedAt: new Date().toISOString()
      }, { merge: true });
      console.log('Product synced to cloud:', docId);
    } catch (err) {
      console.error('Failed to sync product to cloud:', err);
    }
  },

  // Hapus 1 Produk dari Cloud
  async deleteProduct(productId) {
    if (!this.isEnabled || !this.firestore) return;
    try {
      await this.firestore.collection('products').doc(String(productId)).delete();
      console.log('Product deleted from cloud:', productId);
    } catch (err) {
      console.error('Failed to delete product from cloud:', err);
    }
  },

  // Sinkronisasi 1 Kategori ke Cloud
  async syncCategory(category) {
    if (!this.isEnabled || !this.firestore) return;
    try {
      const docId = String(category.id);
      await this.firestore.collection('categories').doc(docId).set({
        ...category,
        _syncedAt: new Date().toISOString()
      }, { merge: true });
      console.log('Category synced to cloud:', docId);
    } catch (err) {
      console.error('Failed to sync category to cloud:', err);
    }
  },

  // Hapus 1 Kategori dari Cloud
  async deleteCategory(categoryId) {
    if (!this.isEnabled || !this.firestore) return;
    try {
      await this.firestore.collection('categories').doc(String(categoryId)).delete();
      console.log('Category deleted from cloud:', categoryId);
    } catch (err) {
      console.error('Failed to delete category from cloud:', err);
    }
  },

  // --- Bulk Sync Operations (Upload & Download) ---

  // Upload semua data lokal (IndexedDB) ke Cloud Firestore
  async uploadAllLocalData(localDB) {
    if (!this.firestore) throw new Error('Cloud belum terhubung');

    const [products, categories, transactions, storeInfo] = await Promise.all([
      localDB.getProducts(),
      localDB.getCategories(),
      localDB.getTransactions(),
      localDB.getSettings('store_info')
    ]);

    const batch = this.firestore.batch();
    let opCount = 0;
    const maxBatchSize = 450; // Firestore limit 500 per batch

    const commitBatchIfNeeded = async () => {
      if (opCount >= maxBatchSize) {
        await batch.commit();
        opCount = 0;
      }
    };

    // 1. Upload Products
    for (const p of products) {
      const ref = this.firestore.collection('products').doc(String(p.id));
      batch.set(ref, { ...p, _syncedAt: new Date().toISOString() }, { merge: true });
      opCount++;
      await commitBatchIfNeeded();
    }

    // 2. Upload Categories
    for (const c of categories) {
      const ref = this.firestore.collection('categories').doc(String(c.id));
      batch.set(ref, { ...c, _syncedAt: new Date().toISOString() }, { merge: true });
      opCount++;
      await commitBatchIfNeeded();
    }

    // 3. Upload Transactions
    for (const t of transactions) {
      const ref = this.firestore.collection('transactions').doc(String(t.id));
      batch.set(ref, { ...t, _syncedAt: new Date().toISOString() }, { merge: true });
      opCount++;
      await commitBatchIfNeeded();
    }

    // 4. Upload Store Info
    if (storeInfo) {
      const ref = this.firestore.collection('settings').doc('store_info');
      batch.set(ref, { ...storeInfo, _syncedAt: new Date().toISOString() }, { merge: true });
      opCount++;
    }

    if (opCount > 0) {
      await batch.commit();
    }

    return {
      productsCount: products.length,
      categoriesCount: categories.length,
      transactionsCount: transactions.length
    };
  },

  // Download semua data dari Cloud Firestore ke IndexedDB Lokal
  async downloadAllCloudData(localDB) {
    if (!this.firestore) throw new Error('Cloud belum terhubung');

    const [productsSnap, categoriesSnap, transactionsSnap, settingsSnap] = await Promise.all([
      this.firestore.collection('products').get(),
      this.firestore.collection('categories').get(),
      this.firestore.collection('transactions').get(),
      this.firestore.collection('settings').doc('store_info').get()
    ]);

    let productsCount = 0;
    let categoriesCount = 0;
    let transactionsCount = 0;

    // Simpan Produk ke IndexedDB
    for (const doc of productsSnap.docs) {
      const data = doc.data();
      delete data._syncedAt;
      if (data.id) data.id = Number(data.id) || data.id;
      await localDB.saveProduct(data);
      productsCount++;
    }

    // Simpan Kategori ke IndexedDB
    for (const doc of categoriesSnap.docs) {
      const data = doc.data();
      delete data._syncedAt;
      if (data.id) data.id = Number(data.id) || data.id;
      await localDB.saveCategory(data);
      categoriesCount++;
    }

    // Simpan Transaksi ke IndexedDB
    for (const doc of transactionsSnap.docs) {
      const data = doc.data();
      delete data._syncedAt;
      await localDB.saveTransaction(data);
      transactionsCount++;
    }

    // Simpan Pengaturan Toko jika ada
    if (settingsSnap.exists) {
      const storeInfo = settingsSnap.data();
      delete storeInfo._syncedAt;
      await localDB.saveSettings('store_info', storeInfo);
    }

    return { productsCount, categoriesCount, transactionsCount };
  }
};
