const DB_NAME = 'pos_database';
const DB_VERSION = 2;

const DB = {
  db: null,

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (e) => {
        console.error('Database failed to open:', e);
        reject(e);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        console.log('Database initialized successfully');
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

  saveProduct(product) {
    return this.execute('products', 'readwrite', (store) => {
      if (product.id) {
        product.id = Number(product.id);
        return store.put(product);
      } else {
        return store.add(product);
      }
    });
  },

  deleteProduct(id) {
    return this.execute('products', 'readwrite', (store) => store.delete(Number(id)));
  },

  // Categories CRUD
  getCategories() {
    return this.execute('categories', 'readonly', (store) => store.getAll());
  },

  saveCategory(category) {
    return this.execute('categories', 'readwrite', (store) => {
      if (category.id) {
        category.id = Number(category.id);
        return store.put(category);
      } else {
        return store.add(category);
      }
    });
  },

  deleteCategory(id) {
    return this.execute('categories', 'readwrite', (store) => store.delete(Number(id)));
  },

  // Transactions CRUD
  getTransactions() {
    return this.execute('transactions', 'readonly', (store) => store.getAll());
  },

  saveTransaction(transaction) {
    return this.execute('transactions', 'readwrite', (store) => store.add(transaction));
  },

  deleteTransaction(id) {
    return this.execute('transactions', 'readwrite', (store) => store.delete(id));
  },

  // Settings CRUD
  getSettings(key) {
    return new Promise((resolve) => {
      this.execute('settings', 'readonly', (store) => store.get(key))
        .then((result) => resolve(result ? result.value : null))
        .catch(() => resolve(null));
    });
  },

  saveSettings(key, value) {
    return this.execute('settings', 'readwrite', (store) => store.put({ key, value }));
  },

  // Seeding initial premium products & settings
  async seedInitialData() {
    const products = await this.getProducts();
    const categories = await this.getCategories();
    const storeInfo = await this.getSettings('store_info');

    // Default settings - Universal Electronic Shop
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
    let catList = categories;
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
      catList = await this.getCategories();
    }

    // Default products with mock QR/Barcodes (Electronics)
    if (products.length === 0) {
      const initialProducts = [
        {
          name: 'iPhone 15 Pro Max 256GB',
          price: 22499000,
          cost: 18000000,
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
