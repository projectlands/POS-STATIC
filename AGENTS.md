# ATURAN & PANDUAN PENGEMBANGAN (AGENTS RULEBOOK)
# POS STATIC (RUANG TEMU & SEMPOL AYAM CRISPY)

Dokumen ini adalah pedoman **WAJIB** untuk semua AI Agent (Antigravity, Cursor, Copilot, dll.) yang bekerja di repositori ini.

---

## ⚠️ ATURAN EMAS (STRICT RULES - JANGAN DILANGGAR)

1. **DILARANG MENGHAPUS / MENYEDERHANAKAN FITUR LAMA:**
   - Semua penambahan fitur baru **TIDAK BOLEH** merusak, menghapus, atau menyederhanakan fitur yang sudah ada dan berjalan sempurna.
   - Jangan pernah mengganti komponen yang kaya fitur (misal: Dasbor Analitik dengan grafik dan metrik lengkap) menjadi tabel sederhana.

2. **JANGAN MEROMBAK ULANG (NO FULL REWRITES):**
   - Lakukan modifikasi bertahap (*incremental changes*) menggunakan patch atau fungsi modular.
   - Jangan menulis ulang file dari nol jika hanya diminta menambahkan fitur kecil.

3. **VERIFIKASI FITUR INTI SEBELUM COMMIT:**
   - Setiap selesai mengedit file JavaScript (`app.js`, `db.js`, `sw.js`, `cloud-db.js`), selalu pastikan sintaks valid (`node -c <file>`).
   - Pastikan Service Worker cache version dinaikkan jika ada perubahan aset (`sw.js`).

---

## 🏛️ ARSITEKTUR & FITUR INTI YANG WAJIB DIJAGA

### 1. Multi-Store Switcher (Multi-Toko)
- Sistem mendukung banyak profil toko secara dinamis (`DB.getAllStores()`, `DB.getActiveStore()`, `DB.switchStore()`).
- Database lokal IndexedDB terpisah per toko (`pos_database` untuk Ruang Temu Gadget, `pos_database_sempol` untuk Sempol Ayam).
- UI Selector tersedia di:
  - Header desktop/mobile: `#btn-header-store-switch`
  - Sidebar desktop: Klik logo toko
  - Drawer menu mobile: Tile *"Pindah POS / Toko"*

### 2. Toko Sempol Ayam Crispy Juara
- **Shared Tusuk Inventory:** Semua menu paket (Paket Puas 6 tusuk, Paket Hemat 3 tusuk, Paket Jumbo 10 tusuk, Eceran 1 tusuk) memotong dari satu stok bahan tusuk yang sama (`DB.getSempolStock()`, `DB.updateSempolStock()`).
- **Live Quick Stock Bar:** Terletak di halaman kasir (`#sempol-quick-bar`), menampilkan sisa tusuk & modal satuan serta tombol instan `+20` dan `+50` tusuk.
- **Modal Stok Sempol:** `#modal-sempol-stock` untuk mengatur stok siap jual dan modal per tusuk.
- **Form Produk Sempol:** Checkbox *"Menu Tusukan Sempol"* (`#product-is-sempol`), input isi tusuk per paket, dan kalkulasi modal otomatis.

### 3. Dasbor Analitik Lengkap (Laporan Penjualan)
- **4 Kartu Metrik:** Total Pendapatan, Laba Bersih, Jumlah Transaksi, Rata-rata Nilai Struk.
- **Grafik Tren Penjualan 7 Hari:** Menggunakan HTML5 Canvas murni (`#sales-trend-canvas`) dengan tooltip dan gradien warna.
- **5 Produk Terlaris:** Menampilkan produk paling laku beserta progress bar persentase.
- **Tabel Riwayat Transaksi Lengkap:** Menampilkan seluruh transaksi dengan tombol **"Lihat Struk"** untuk preview dan cetak ulang struk.

### 4. Database Cloud & Remote (Google Spreadsheet, MySQL/MariaDB & Firebase)
- Modul `cloud-db.js` tersambung secara modular tanpa merusak fungsionalitas offline lokal IndexedDB.
- Mendukung 3 penyedia database:
  1. **Google Spreadsheet:** Serverless gratis via Google Apps Script Web App (`google-sheets-script.js`).
  2. **MySQL / MariaDB:** Self-hosted database melalui file REST API bridge (`api.php`).
  3. **Firebase Firestore:** Database cloud realtime dari Google Firebase.
- Mendukung sinkronisasi otomatis transaksi & pengeluaran baru, test koneksi, upload manual, dan download manual seluruh data.

### 5. Antarmuka Mobile (5-Tab & Drawer Menu)
- Navigasi bawah 5-tab: Kasir, Keranjang (badge jumlah belanja), Produk, Laporan, Menu.
- Bottom Sheet Drawer (`#modal-mobile-menu`) untuk akses cepat ganti akun/peran, pengaturan toko, pindah POS toko, cloud, install PWA, dan reset data sampel.

### 6. Modul Keuangan, Buku Kas & Laba Rugi Riil (P&L & Balik Modal)
- Sub-tab di halaman Laporan: `Analitik Penjualan` dan `Buku Kas & Laba Rugi Riil`.
- Menghitung modal awal usaha, beban operasional (sewa, listrik, gas, kemasan), dan gaji karyawan.
- Menghitung **Laba Bersih Riil**: `Laba Kotor Penjualan - Beban Operasional & Gaji`.
- Menghitung **Status Balik Modal (Break-Even Point)** secara realtime.
- IndexedDB objectStore: `expenses` (CRUD lengkap per profil toko aktif).
- Modal Input: `#modal-expense` dengan form kategori, nominal, tanggal, dan catatan.

### 7. Otentikasi Peran Kasir & Admin (PIN Security)
- **Otomatis Aktif:** Saat koneksi database eksternal aktif (Google Sheets, MySQL, atau Firebase), sistem mewajibkan autentikasi peran.
- **Hak Akses Kasir:** Dibatasi hanya pada halaman Kasir (`#view-cashier`) dan Keranjang (`#view-cart`). Tidak bisa mengakses Produk, Laporan, Pengaturan Toko, Pindah Toko, Reset Data, atau Catatan Pengeluaran.
- **Hak Akses Admin:** Akses penuh seluruh fitur toko.
- **PIN Default:** Admin (`1234`), Kasir (`0000`).
- **Modal Input PIN:** `#modal-auth-pin` dengan numeric touch keypad.
- **Modal Ubah PIN:** `#modal-change-pin` untuk mengganti PIN Admin & Kasir kapan saja.

---

## 🛠️ STRUKTUR FILE
- `index.html`: Struktur SPA (Single Page Application) lengkap dengan Tailwind CSS CDN & FontAwesome.
- `app.js`: Logika UI, keranjang, otentikasi peran (PIN Admin & Kasir), chart analitik, dan multi-db cloud UI.
- `db.js`: Abstraksi database IndexedDB, multi-store manager, auth settings, dan initial seed data.
- `cloud-db.js`: Multi-adapter database eksternal (Google Spreadsheet, MySQL REST API, Firebase Firestore).
- `api.php`: REST API backend bridge untuk MySQL / MariaDB (auto-create table, secure key header).
- `google-sheets-script.js`: Template Google Apps Script Web App untuk integrasi Google Spreadsheet.
- `sw.js`: Service Worker untuk kapabilitas PWA offline penuh.
- `manifest.json`: Konfigurasi installable Web App.
