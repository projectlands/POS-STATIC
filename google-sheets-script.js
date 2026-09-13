/**
 * Google Apps Script Web App for POS STATIC
 * 
 * CARA PAKAI:
 * 1. Buka Google Sheets baru di Google Drive (https://sheets.new)
 * 2. Klik menu 'Ekstensi' (Extensions) -> 'Apps Script'
 * 3. Hapus semua kode default dan Paste (tempel) seluruh isi file ini
 * 4. Klik 'Terapkan' (Deploy) -> 'Penerapan baru' (New deployment)
 * 5. Pilih jenis: 'Aplikasi Web' (Web app)
 * 6. Setel:
 *    - Jalankan sebagai (Execute as): Saya (Me)
 *    - Siapa yang memiliki akses (Who has access): Siapa saja (Anyone)
 * 7. Klik 'Terapkan' (Deploy) dan salin URL Aplikasi Web (Web app URL)
 * 8. Tempelkan URL tersebut ke Pengaturan Database POS STATIC Anda!
 */

function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : 'ping';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Koneksi ke Google Spreadsheet Berhasil!',
      sheetName: ss.getName()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'bulk_download') {
    var products = readSheetAsObjects(ss, 'Products');
    var transactions = readSheetAsObjects(ss, 'Transactions');
    var expenses = readSheetAsObjects(ss, 'Expenses');
    
    // Parse items JSON in transactions
    transactions.forEach(function(tx) {
      if (tx.items_json) {
        try { tx.items = JSON.parse(tx.items_json); } catch (_) { tx.items = []; }
      }
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      products: products,
      transactions: transactions,
      expenses: expenses
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Action invalid' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var contents = e.postData.contents;
  var data = {};
  try {
    data = JSON.parse(contents);
  } catch (err) {
    data = e.parameter || {};
  }
  
  var action = data.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === 'save_transaction') {
    var t = data.data;
    var sheet = getOrCreateSheet(ss, 'Transactions', [
      'ID', 'Waktu', 'Tanggal_Jam', 'Metode_Bayar', 'Total', 'Subtotal', 'Diskon', 'Pajak', 'Uang_Dibayar', 'Kembalian', 'Items_JSON'
    ]);
    
    sheet.appendRow([
      t.id,
      t.timestamp,
      new Date(t.timestamp).toLocaleString('id-ID'),
      t.paymentMethod || 'Cash',
      t.total,
      t.subtotal,
      t.discount || 0,
      t.taxSvc || 0,
      t.amountPaid || t.total,
      t.change || 0,
      JSON.stringify(t.items || [])
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Transaksi tercatat di Google Sheets' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'save_expense') {
    var exp = data.data;
    var sheetExp = getOrCreateSheet(ss, 'Expenses', [
      'ID', 'Tanggal', 'Jenis', 'Judul_Pengeluaran', 'Nominal', 'Catatan', 'Waktu_Simpan'
    ]);
    
    sheetExp.appendRow([
      exp.id || Date.now(),
      exp.date,
      exp.type,
      exp.title,
      exp.amount,
      exp.note || '',
      new Date().toLocaleString('id-ID')
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Pengeluaran tercatat di Google Sheets' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'save_product') {
    var p = data.data;
    var sheetProd = getOrCreateSheet(ss, 'Products', [
      'ID', 'Kode', 'Nama', 'Kategori', 'Harga_Jual', 'Harga_Modal', 'Stok', 'Is_Sempol', 'Isi_Tusuk', 'Modal_Tusuk'
    ]);
    
    sheetProd.appendRow([
      p.id,
      p.code || '',
      p.name,
      p.category || 'Umum',
      p.price,
      p.cost || 0,
      p.stock,
      p.isSempol ? 1 : 0,
      p.piecesPerUnit || 1,
      p.unitCost || 0
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Produk tercatat di Google Sheets' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'bulk_upload') {
    var payload = data.data || {};
    
    // Transactions
    if (payload.transactions && payload.transactions.length > 0) {
      var sTrx = getOrCreateSheet(ss, 'Transactions', [
        'ID', 'Waktu', 'Tanggal_Jam', 'Metode_Bayar', 'Total', 'Subtotal', 'Diskon', 'Pajak', 'Uang_Dibayar', 'Kembalian', 'Items_JSON'
      ]);
      sTrx.clearContents();
      sTrx.appendRow(['ID', 'Waktu', 'Tanggal_Jam', 'Metode_Bayar', 'Total', 'Subtotal', 'Diskon', 'Pajak', 'Uang_Dibayar', 'Kembalian', 'Items_JSON']);
      payload.transactions.forEach(function(t) {
        sTrx.appendRow([
          t.id, t.timestamp, new Date(t.timestamp).toLocaleString('id-ID'),
          t.paymentMethod || 'Cash', t.total, t.subtotal, t.discount || 0, t.taxSvc || 0,
          t.amountPaid || t.total, t.change || 0, JSON.stringify(t.items || [])
        ]);
      });
    }
    
    // Products
    if (payload.products && payload.products.length > 0) {
      var sPrd = getOrCreateSheet(ss, 'Products', [
        'ID', 'Kode', 'Nama', 'Kategori', 'Harga_Jual', 'Harga_Modal', 'Stok', 'Is_Sempol', 'Isi_Tusuk', 'Modal_Tusuk'
      ]);
      sPrd.clearContents();
      sPrd.appendRow(['ID', 'Kode', 'Nama', 'Kategori', 'Harga_Jual', 'Harga_Modal', 'Stok', 'Is_Sempol', 'Isi_Tusuk', 'Modal_Tusuk']);
      payload.products.forEach(function(p) {
        sPrd.appendRow([
          p.id, p.code || '', p.name, p.category || 'Umum', p.price, p.cost || 0,
          p.stock, p.isSempol ? 1 : 0, p.piecesPerUnit || 1, p.unitCost || 0
        ]);
      });
    }
    
    // Expenses
    if (payload.expenses && payload.expenses.length > 0) {
      var sExp = getOrCreateSheet(ss, 'Expenses', [
        'ID', 'Tanggal', 'Jenis', 'Judul_Pengeluaran', 'Nominal', 'Catatan', 'Waktu_Simpan'
      ]);
      sExp.clearContents();
      sExp.appendRow(['ID', 'Tanggal', 'Jenis', 'Judul_Pengeluaran', 'Nominal', 'Catatan', 'Waktu_Simpan']);
      payload.expenses.forEach(function(exp) {
        sExp.appendRow([
          exp.id || Date.now(), exp.date, exp.type, exp.title, exp.amount,
          exp.note || '', new Date().toLocaleString('id-ID')
        ]);
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Bulk Upload ke Google Sheets Sukses!'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Action unknown' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  }
  return sheet;
}

function readSheetAsObjects(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toLowerCase();
      obj[key] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}
