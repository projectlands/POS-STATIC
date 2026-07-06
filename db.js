const DB_NAME = 'pos_database';
const DB_VERSION = 1;

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

    // Default settings
    if (!storeInfo) {
      await this.saveSettings('store_info', {
        name: 'Kopi Ruang Temu',
        address: 'Jl. Senopati No. 45, Jakarta Selatan',
        phone: '0812-3456-7890',
        taxRate: 10, // 10% PB1
        serviceCharge: 5, // 5% Service Charge
        currency: 'IDR',
        receiptFooter: 'Terima kasih atas kunjungan Anda!'
      });
    }

    // Default categories
    let catList = categories;
    if (categories.length === 0) {
      const defaultCats = [
        { name: 'Coffee' },
        { name: 'Non-Coffee' },
        { name: 'Pastry' },
        { name: 'Main Course' }
      ];
      for (const cat of defaultCats) {
        await this.saveCategory(cat);
      }
      catList = await this.getCategories();
    }

    // Default products with mock QR/Barcodes
    if (products.length === 0) {
      const initialProducts = [
        {
          name: 'Espresso Single',
          price: 18000,
          cost: 5000,
          stock: 99,
          category: 'Coffee',
          code: '1001',
          color: 'amber',
          icon: 'fa-mug-hot'
        },
        {
          name: 'Iced Cafe Latte',
          price: 28000,
          cost: 8000,
          stock: 50,
          category: 'Coffee',
          code: '1002',
          color: 'orange',
          icon: 'fa-glass-water'
        },
        {
          name: 'Caramel Macchiato',
          price: 35000,
          cost: 11000,
          stock: 40,
          category: 'Coffee',
          code: '1003',
          color: 'yellow',
          icon: 'fa-mug-saucer'
        },
        {
          name: 'Matcha Latte Iced',
          price: 30000,
          cost: 9000,
          stock: 35,
          category: 'Non-Coffee',
          code: '2001',
          color: 'green',
          icon: 'fa-leaf'
        },
        {
          name: 'Signature Chocolate',
          price: 28000,
          cost: 8500,
          stock: 45,
          category: 'Non-Coffee',
          code: '2002',
          color: 'red',
          icon: 'fa-bowl-food'
        },
        {
          name: 'Butter Croissant',
          price: 22000,
          cost: 7000,
          stock: 20,
          category: 'Pastry',
          code: '3001',
          color: 'rose',
          icon: 'fa-bread-slice'
        },
        {
          name: 'Chocolate Danish',
          price: 25000,
          cost: 8000,
          stock: 15,
          category: 'Pastry',
          code: '3002',
          color: 'pink',
          icon: 'fa-cookie'
        },
        {
          name: 'Nasi Goreng Kampung',
          price: 38000,
          cost: 14000,
          stock: 30,
          category: 'Main Course',
          code: '4001',
          color: 'emerald',
          icon: 'fa-plate-wheat'
        },
        {
          name: 'Spaghetti Carbonara',
          price: 45000,
          cost: 17000,
          stock: 25,
          category: 'Main Course',
          code: '4002',
          color: 'indigo',
          icon: 'fa-utensils'
        }
      ];

      for (const prod of initialProducts) {
        await this.saveProduct(prod);
      }
    }
  }
};
window.DB = DB; // Make it globally accessible
