/**
 * AI AGENT - KONSULTAN BISNIS & KEUANGAN TOKO (POS STATIC)
 * Mendukung analisis mendalam penjualan, penentuan gaji karyawan berdasarkan omzet,
 * evaluasi laba rugi riil, produk terlaris vs dead stock, dan titik impas (BEP).
 *
 * Mode Hybrid:
 * 1. Online: Google Gemini API (1.5 Flash / 2.0 Flash) dengan context data toko riil
 * 2. Offline: Built-in Smart Rule-Based & Statistical Business Intelligence Engine
 */

const AIAgent = {
  // State
  messages: [],
  apiKey: '',
  selectedModel: 'auto',
  cachedModels: [],
  isThinking: false,

  // Inisialisasi
  async init() {
    this.apiKey = localStorage.getItem('ai_gemini_api_key') || '';
    this.selectedModel = localStorage.getItem('ai_selected_model') || 'auto';
    
    try {
      this.cachedModels = JSON.parse(localStorage.getItem('ai_cached_models') || '[]');
    } catch (e) {
      this.cachedModels = [];
    }
    
    // Muat riwayat chat terakhir dari local storage jika ada
    try {
      const savedChat = localStorage.getItem('ai_chat_history');
      if (savedChat) {
        this.messages = JSON.parse(savedChat);
      }
    } catch (e) {
      this.messages = [];
    }

    if (!this.messages || this.messages.length === 0) {
      this.resetGreeting();
    }
  },

  // Sambutan default ramah bisnis
  resetGreeting() {
    const store = (typeof DB !== 'undefined' && DB.getActiveStore) ? DB.getActiveStore() : { name: 'Usaha Anda' };
    this.messages = [
      {
        role: 'assistant',
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        text: `Halo Bos! 👋 Saya **AI Asisten Bisnis** untuk **${store.name}**.\n\nSaya dapat menganalisis data transaksi, laba bersih riil, pengeluaran, serta membantu Anda membuat keputusan penting seperti:\n- 💰 **Menentukan simulasi gaji & komisi karyawan** berbasis omzet riil.\n- 📊 **Evaluasi margin keuntungan & performa produk** (mana paling laku vs mati).\n- ⚖️ **Perhitungan titik impas (BEP)** dan target penjualan harian.\n\nAda yang ingin Anda konsultasikan atau tanyakan hari ini?`
      }
    ];
    this.saveChatHistory();
  },

  saveChatHistory() {
    try {
      // Simpan maksimal 30 pesan terakhir agar efisien
      const recent = this.messages.slice(-30);
      localStorage.setItem('ai_chat_history', JSON.stringify(recent));
    } catch (e) {
      console.warn('Gagal menyimpan riwayat chat AI:', e);
    }
  },

  clearChat() {
    this.resetGreeting();
    this.renderMessages();
  },

  setApiKey(key, model = 'gemini-1.5-flash') {
    this.apiKey = (key || '').trim();
    this.selectedModel = model || 'gemini-1.5-flash';
    localStorage.setItem('ai_gemini_api_key', this.apiKey);
    localStorage.setItem('ai_selected_model', this.selectedModel);
  },

  // Mengumpulkan data riil toko secara instan dari IndexedDB
  async collectBusinessSnapshot() {
    try {
      const store = (typeof DB !== 'undefined' && DB.getActiveStore) ? DB.getActiveStore() : { name: 'Toko POS', type: 'retail' };
      const transactions = (typeof DB !== 'undefined' && DB.getTransactions) ? await DB.getTransactions() : [];
      const products = (typeof DB !== 'undefined' && DB.getProducts) ? await DB.getProducts() : [];
      const expenses = (typeof DB !== 'undefined' && DB.getExpenses) ? await DB.getExpenses() : [];
      
      let sempolStock = null;
      if (typeof DB !== 'undefined' && DB.getSempolStock) {
        sempolStock = await DB.getSempolStock();
      }

      // 1. Analisis Transaksi
      const now = new Date();
      const oneDay = 24 * 60 * 60 * 1000;
      const sevenDaysAgo = new Date(now.getTime() - (7 * oneDay));
      const thirtyDaysAgo = new Date(now.getTime() - (30 * oneDay));

      let totalRevenueAllTime = 0;
      let totalTransactionsCount = transactions.length;
      let revenue30Days = 0;
      let revenue7Days = 0;
      let revenueToday = 0;
      let totalHPPAllTime = 0;
      let paymentMethods = {};
      let productSalesMap = {};

      const todayDateStr = now.toISOString().split('T')[0];

      transactions.forEach(tx => {
        const txTotal = Number(tx.total) || 0;
        const txTime = new Date(tx.timestamp || tx.date || now);
        totalRevenueAllTime += txTotal;

        // Payment method breakdown
        const method = tx.paymentMethod || 'cash';
        paymentMethods[method] = (paymentMethods[method] || 0) + txTotal;

        // Time ranges
        if (txTime >= thirtyDaysAgo) {
          revenue30Days += txTotal;
        }
        if (txTime >= sevenDaysAgo) {
          revenue7Days += txTotal;
        }
        if ((tx.timestamp && String(tx.timestamp).startsWith(todayDateStr)) || (tx.date && String(tx.date).startsWith(todayDateStr))) {
          revenueToday += txTotal;
        }

        // Hitung HPP & Product performance
        if (Array.isArray(tx.items)) {
          tx.items.forEach(item => {
            const qty = Number(item.qty || item.quantity || 1);
            const cost = Number(item.cost || item.costPrice || 0);
            const price = Number(item.price || 0);
            totalHPPAllTime += (cost * qty);

            const pId = item.id || item.productId || item.name;
            if (!productSalesMap[pId]) {
              productSalesMap[pId] = {
                name: item.name || 'Produk',
                qtySold: 0,
                revenue: 0,
                grossProfit: 0
              };
            }
            productSalesMap[pId].qtySold += qty;
            productSalesMap[pId].revenue += (price * qty);
            productSalesMap[pId].grossProfit += ((price - cost) * qty);
          });
        }
      });

      const totalGrossProfitAllTime = totalRevenueAllTime - totalHPPAllTime;
      const avgOrderValue = totalTransactionsCount > 0 ? (totalRevenueAllTime / totalTransactionsCount) : 0;

      // 2. Analisis Pengeluaran (Buku Kas)
      let totalExpensesAllTime = 0;
      let expensesByCategory = {};
      let salaryExpenses = 0;
      let rentExpenses = 0;
      let rawMaterialExpenses = 0;

      expenses.forEach(exp => {
        const amount = Number(exp.amount) || 0;
        totalExpensesAllTime += amount;
        const cat = exp.category || 'Lainnya';
        expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amount;

        const lowerCat = cat.toLowerCase();
        if (lowerCat.includes('gaji') || lowerCat.includes('salary') || lowerCat.includes('upah')) {
          salaryExpenses += amount;
        } else if (lowerCat.includes('sewa') || lowerCat.includes('tempat') || lowerCat.includes('outlet')) {
          rentExpenses += amount;
        } else if (lowerCat.includes('bahan') || lowerCat.includes('belanja') || lowerCat.includes('kemasan')) {
          rawMaterialExpenses += amount;
        }
      });

      const netProfitRiil = totalGrossProfitAllTime - totalExpensesAllTime;

      // 3. Top Products & Dead Stock
      const sortedProducts = Object.values(productSalesMap).sort((a, b) => b.revenue - a.revenue);
      const top5Products = sortedProducts.slice(0, 5);

      const deadStock = products.filter(p => {
        const sales = productSalesMap[p.id] || productSalesMap[p.name];
        return (!sales || sales.qtySold === 0) && (Number(p.stock) > 0);
      }).slice(0, 5);

      return {
        storeName: store.name,
        storeTagline: store.tagline || '',
        currency: store.currency || 'Rp',
        totalTransactionsCount,
        totalRevenueAllTime,
        revenue30Days,
        revenue7Days,
        revenueToday,
        totalHPPAllTime,
        totalGrossProfitAllTime,
        grossProfitMarginPercent: totalRevenueAllTime > 0 ? ((totalGrossProfitAllTime / totalRevenueAllTime) * 100).toFixed(1) : '0',
        totalExpensesAllTime,
        netProfitRiil,
        netProfitMarginPercent: totalRevenueAllTime > 0 ? ((netProfitRiil / totalRevenueAllTime) * 100).toFixed(1) : '0',
        avgOrderValue,
        expensesByCategory,
        salaryExpenses,
        rentExpenses,
        rawMaterialExpenses,
        top5Products,
        deadStock,
        totalProductCatalog: products.length,
        sempolStock
      };
    } catch (err) {
      console.error('Gagal membuat snapshot bisnis:', err);
      return null;
    }
  },

  // Kirim Pertanyaan Pengguna
  async ask(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return;

    const trimmed = userPrompt.trim();
    const timeNow = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    // Tambahkan pesan user ke UI
    this.messages.push({
      role: 'user',
      time: timeNow,
      text: trimmed
    });
    this.renderMessages();
    this.saveChatHistory();

    this.isThinking = true;
    this.renderLoading(true);

    try {
      const snapshot = await this.collectBusinessSnapshot();
      let responseText = '';

      if (this.apiKey && this.apiKey.length > 10) {
        // Mode Online via Gemini LLM
        try {
          responseText = await this.queryGemini(trimmed, snapshot);
        } catch (apiError) {
          console.warn('Gagal memanggil Gemini API, beralih ke Smart Offline Engine:', apiError);
          responseText = `⚠️ *Koneksi Gemini API terkendala (${apiError.message}). Menggunakan analisis Smart Engine internal:* \n\n` +
            this.generateSmartOfflineResponse(trimmed, snapshot);
        }
      } else {
        // Mode Offline Smart Rule-Based Engine
        await new Promise(r => setTimeout(r, 500));
        responseText = this.generateSmartOfflineResponse(trimmed, snapshot);
      }

      this.messages.push({
        role: 'assistant',
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        text: responseText
      });
      this.saveChatHistory();
    } catch (err) {
      console.error('Error in AIAgent.ask:', err);
      this.messages.push({
        role: 'assistant',
        time: timeNow,
        text: `Maaf Bos, terjadi kendala saat menganalisis data: ${err.message}. Silakan coba kembali.`
      });
    } finally {
      this.isThinking = false;
      this.renderLoading(false);
      this.renderMessages();
    }
  },

  // Query Google Gemini REST API
  async queryGemini(prompt, snapshot) {
    let activeModel = this.selectedModel || 'auto';
    if (activeModel === 'auto') {
      // Prioritaskan model flash yang cepat dan hemat kuota
      const flashModel = (this.cachedModels || []).find(m => (m.name || '').includes('flash'));
      activeModel = flashModel ? flashModel.name.replace(/^models\//, '') : 'gemini-1.5-flash';
    } else {
      activeModel = activeModel.replace(/^models\//, '');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${this.apiKey}`;

    const systemInstruction = `
Kamu adalah "AI Asisten Bisnis & Financial Advisor CFO" profesional untuk usaha UMKM di Indonesia bernama "${snapshot.storeName}".
Tugasmu adalah menganalisis data riil penjualan, mengevaluasi biaya, dan memberikan rekomendasi strategis manajemen usaha yang tajam, praktis, realistis, dan ramah seperti seorang konsultan bisnis terpercaya.

DATA RIIL USAHA SAAT INI DARI APLIKASI KASIR POS:
- Nama Toko: ${snapshot.storeName}
- Total Transaksi Tercatat: ${snapshot.totalTransactionsCount} struk
- Omzet Total Keseluruhan: Rp ${Number(snapshot.totalRevenueAllTime).toLocaleString('id-ID')}
- Omzet 30 Hari Terakhir: Rp ${Number(snapshot.revenue30Days).toLocaleString('id-ID')}
- Omzet 7 Hari Terakhir: Rp ${Number(snapshot.revenue7Days).toLocaleString('id-ID')}
- Omzet Hari Ini: Rp ${Number(snapshot.revenueToday).toLocaleString('id-ID')}
- Total Laba Kotor: Rp ${Number(snapshot.totalGrossProfitAllTime).toLocaleString('id-ID')} (Margin: ${snapshot.grossProfitMarginPercent}%)
- Total Beban Operasional Buku Kas: Rp ${Number(snapshot.totalExpensesAllTime).toLocaleString('id-ID')}
- Laba Bersih Riil: Rp ${Number(snapshot.netProfitRiil).toLocaleString('id-ID')} (Net Margin: ${snapshot.netProfitMarginPercent}%)
- Rata-rata Nilai Belanja per Struk (AOV): Rp ${Math.round(snapshot.avgOrderValue).toLocaleString('id-ID')}
- Beban Gaji Karyawan Saat Ini: Rp ${Number(snapshot.salaryExpenses).toLocaleString('id-ID')}
- Beban Sewa: Rp ${Number(snapshot.rentExpenses).toLocaleString('id-ID')}
- Produk Paling Laris: ${snapshot.top5Products.map(p => `${p.name} (${p.qtySold} terjual, Omzet: Rp ${p.revenue.toLocaleString('id-ID')})`).join(', ') || 'Belum ada data'}
- Dead Stock (Belum laku ada stok): ${snapshot.deadStock.map(p => p.name).join(', ') || 'Tidak ada'}
${snapshot.sempolStock ? `- Info Khusus Sempol: Stok tusuk siap jual: ${snapshot.sempolStock.stock} tusuk, Modal per tusuk: Rp ${snapshot.sempolStock.costPerStick}` : ''}

PANDUAN MENJAWAB:
1. Jika pengguna menanyakan tentang GAJI KARYAWAN:
   - Gunakan prinsip standar keuangan usaha (UMKM F&B/Retail): Total anggaran beban gaji (payroll) yang sehat dan aman adalah sekitar 15% - 25% dari total omzet, atau 30% - 40% dari laba kotor.
   - Berikan skema yang menguntungkan kedua belah pihak: Gaji Pokok + Komisi/Bonus Insentif Berdasarkan Target Penjualan harian/bulanan (agar karyawan termotivasi menjual lebih banyak).
   - Hitungkan simulasi angka rupiah nyata berdasarkan omzet toko di atas!
2. Jika menanyakan tentang PERFORMA BISNIS & LABA:
   - Paparkan apakah bisnis saat ini sehat, berapa margin keuntungan, dan saran menekan biaya operasional atau menaikkan omzet.
3. Berikan jawaban dalam Bahasa Indonesia yang profesional, hangat, terstruktur rapi dengan bullet points, angka konkret, dan kesimpulan langkah aksi (actionable steps).
    `.trim();

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemInstruction}\n\nPertanyaan Pemilik Usaha:\n${prompt}` }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1200
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('Tidak ada respon teks dari AI.');
    }
    return candidate;
  },

  // Smart Offline Rule-Based & Statistical Engine
  generateSmartOfflineResponse(prompt, snapshot) {
    const q = prompt.toLowerCase();

    // 1. Kueri seputar Gaji / Komisi Karyawan
    if (q.includes('gaji') || q.includes('upah') || q.includes('salary') || q.includes('karyawan') || q.includes('komisi') || q.includes('bonus')) {
      return this.generateSalaryAnalysisResponse(snapshot);
    }

    // 2. Kueri seputar Laba Bersih / Keuangan / Rugi / Profit
    if (q.includes('laba') || q.includes('profit') || q.includes('untung') || q.includes('rugi') || q.includes('keuangan') || q.includes('kas')) {
      return this.generateProfitAnalysisResponse(snapshot);
    }

    // 3. Kueri seputar Produk Terlaris / Dead Stock / Menu
    if (q.includes('produk') || q.includes('menu') || q.includes('laris') || q.includes('laku') || q.includes('dead') || q.includes('stok') || q.includes('mati')) {
      return this.generateProductAnalysisResponse(snapshot);
    }

    // 4. Kueri seputar Titik Impas (BEP) / Balik Modal
    if (q.includes('bep') || q.includes('impas') || q.includes('balik modal') || q.includes('target')) {
      return this.generateBEPResponse(snapshot);
    }

    // 5. Default General Overview
    return this.generateGeneralBusinessOverview(snapshot);
  },

  // Logika Khusus: Rekomendasi Gaji Karyawan Berdasarkan Omzet
  generateSalaryAnalysisResponse(snapshot) {
    const omzet30 = snapshot.revenue30Days > 0 ? snapshot.revenue30Days : (snapshot.totalRevenueAllTime > 0 ? snapshot.totalRevenueAllTime : 0);
    const omzetAvgDaily = snapshot.revenue7Days > 0 ? Math.round(snapshot.revenue7Days / 7) : Math.round(omzet30 / 30 || 0);

    // Standar Industri UMKM Retail & Kuliner:
    // Beban gaji sehat = 15% - 25% dari Omzet (atau 30% - 40% dari Laba Kotor)
    const budgetLow = Math.round(omzet30 * 0.15);
    const budgetMed = Math.round(omzet30 * 0.20);
    const budgetHigh = Math.round(omzet30 * 0.25);

    const gross30 = snapshot.totalRevenueAllTime > 0 ? (omzet30 * (snapshot.totalGrossProfitAllTime / snapshot.totalRevenueAllTime)) : (omzet30 * 0.4);
    const existingSalary = snapshot.salaryExpenses;

    let response = `### 💼 Rekomendasi Penentuan Gaji Karyawan Berdasarkan Omzet\n\n`;
    response += `Berdasarkan data operasional toko **${snapshot.storeName}**, berikut adalah analisis finansial untuk menentukan sistem gaji yang sehat dan adil:\n\n`;

    response += `📊 **Data Penjualan Toko Saat Ini:**\n`;
    response += `- **Estimasi Omzet 30 Hari:** Rp ${omzet30.toLocaleString('id-ID')}\n`;
    response += `- **Rata-rata Omzet Harian:** Rp ${omzetAvgDaily.toLocaleString('id-ID')}/hari\n`;
    response += `- **Margin Laba Kotor:** ~${snapshot.grossProfitMarginPercent}%\n`;
    if (existingSalary > 0) {
      response += `- **Pengeluaran Gaji Terdata di Buku Kas:** Rp ${existingSalary.toLocaleString('id-ID')}\n`;
    }
    response += `\n`;

    response += `🎯 **Batas Anggaran Beban Gaji (Payroll Budget Rule):**\n`;
    response += `Dalam manajemen bisnis UMKM (F&B / Retail), alokasi total biaya gaji karyawan yang aman agar usaha tidak tekor adalah **15% s/d 25% dari total omzet**:\n`;
    response += `- **Batas Aman/Konservatif (15%):** Rp ${budgetLow.toLocaleString('id-ID')}/bulan\n`;
    response += `- **Batas Ideal/Moderat (20%):** Rp ${budgetMed.toLocaleString('id-ID')}/bulan\n`;
    response += `- **Batas Maksimal (25%):** Rp ${budgetHigh.toLocaleString('id-ID')}/bulan *(Hati-hati jika melebihi angka ini karena dapat menggerus modal usaha)*\n\n`;

    response += `💡 **Rekomendasi 2 Skema Sistem Gaji Terbaik:**\n\n`;
    response += `**1. Skema Gaji Pokok + Bonus Target Harian (Paling Direkomendasikan):**\n`;
    response += `- **Gaji Pokok:** Berikan 65% - 75% dari total budget (misal Rp ${Math.round(budgetMed * 0.7).toLocaleString('id-ID')}).\n`;
    response += `- **Bonus Omzet Harian:** Jika penjualan hari itu mencapai target minimal (misal > Rp ${(omzetAvgDaily * 1.2).toLocaleString('id-ID')}), berikan insentif harian tambahan (contoh: Rp 10.000 - Rp 25.000/hari atau Rp 500/porsi terjual).\n`;
    response += `*Keuntungan:* Karyawan termotivasi aktif melayani pelanggan dan meningkatkan omzet karena semakin ramai toko, semakin besar komisi mereka.\n\n`;

    response += `**2. Skema Bagi Hasil Komisi Per Struk/Porsi:**\n`;
    response += `- Gaji harian dasar terjangkau + komisi Rp 500 - Rp 1.000 per cup/porsi/struk yang berhasil dijual.\n`;
    response += `- Memberikan perlindungan arus kas bagi pemilik toko saat hari sepi, sekaligus memacu kerja keras saat toko ramai.\n\n`;

    response += `⚠️ **Tips Penting:** Pastikan Anda tetap mencatat pengeluaran gaji karyawan ke menu **Laporan > Buku Kas & Laba Rugi** agar kalkulasi laba bersih riil selalu akurat.`;

    return response;
  },

  // Logika Khusus: Analisis Laba Rugi Riil
  generateProfitAnalysisResponse(snapshot) {
    let resp = `### 📈 Analisis Kesehatan Keuangan & Laba Rugi Riil\n\n`;
    resp += `Berikut rangkuman kesehatan finansial toko **${snapshot.storeName}**:\n\n`;

    resp += `**Ringkasan Arus Kas:**\n`;
    resp += `- **Total Omzet Penjualan:** Rp ${snapshot.totalRevenueAllTime.toLocaleString('id-ID')} (${snapshot.totalTransactionsCount} transaksi)\n`;
    resp += `- **Total HPP (Harga Pokok Penjualan):** Rp ${snapshot.totalHPPAllTime.toLocaleString('id-ID')}\n`;
    resp += `- **Laba Kotor (Gross Profit):** Rp ${snapshot.totalGrossProfitAllTime.toLocaleString('id-ID')} (Margin: **${snapshot.grossProfitMarginPercent}%**)\n`;
    resp += `- **Beban Pengeluaran (Buku Kas):** Rp ${snapshot.totalExpensesAllTime.toLocaleString('id-ID')}\n`;
    resp += `- **Laba Bersih Riil (Net Profit):** **Rp ${snapshot.netProfitRiil.toLocaleString('id-ID')}** (Margin Bersih: **${snapshot.netProfitMarginPercent}%**)\n\n`;

    if (snapshot.netProfitRiil > 0) {
      resp += `✅ **Status Bisnis:** Usaha Anda berada dalam kondisi **PROFIT/MENGUNTUNGKAN**. Laba kotor berhasil menutup beban operasional dengan sisa surplus bersih Rp ${snapshot.netProfitRiil.toLocaleString('id-ID')}.\n\n`;
    } else if (snapshot.netProfitRiil < 0) {
      resp += `⚠️ **Status Bisnis:** Usaha saat ini mencatat **DEFISIT/MINUS** sebesar Rp ${Math.abs(snapshot.netProfitRiil).toLocaleString('id-ID')}. Beban operasional lebih besar daripada laba kotor yang dihasilkan.\n\n`;
      resp += `**Saran Perbaikan Arus Kas:**\n`;
      resp += `1. Cek pengeluaran terbesar di Buku Kas (apakah beban sewa/modal awal masih dalam tahap amortisasi).\n`;
      resp += `2. Naikkan margin harga produk terlaris sebesar 5-10% atau tawarkan paket bundling untuk mendongkrak rata-rata struk (AOV).\n\n`;
    } else {
      resp += `ℹ️ **Status Bisnis:** Berada di titik seimbang (BEP). Terus tingkatkan volume penjualan harian!\n\n`;
    }

    resp += `💡 **Rata-rata Nilai Belanja Pelanggan (AOV):** Rp ${Math.round(snapshot.avgOrderValue).toLocaleString('id-ID')} per transaksi.`;
    return resp;
  },

  // Logika Khusus: Produk Terlaris & Dead Stock
  generateProductAnalysisResponse(snapshot) {
    let resp = `### 🏆 Analisis Performa Produk & Menu Penjualan\n\n`;

    resp += `**Top Produk Penyumbang Omzet Terbesar:**\n`;
    if (snapshot.top5Products.length > 0) {
      snapshot.top5Products.forEach((p, idx) => {
        resp += `${idx + 1}. **${p.name}** — ${p.qtySold} item terjual | Omzet: Rp ${p.revenue.toLocaleString('id-ID')} (Laba Kotor: Rp ${p.grossProfit.toLocaleString('id-ID')})\n`;
      });
    } else {
      resp += `*Belum ada data penjualan produk yang tercatat.*\n`;
    }
    resp += `\n`;

    resp += `**⚠️ Produk Kurang Laris / Dead Stock:**\n`;
    if (snapshot.deadStock.length > 0) {
      resp += `Produk berikut memiliki stok tapi belum menghasilkan penjualan:\n`;
      snapshot.deadStock.forEach(p => {
        resp += `- **${p.name}** (Sisa Stok: ${p.stock} unit | Harga: Rp ${Number(p.price).toLocaleString('id-ID')})\n`;
      });
      resp += `\n💡 *Saran Strategis:* Buat program promo "Buy 1 Get 1" atau paket bundling produk terlaris dengan produk yang lambat ini untuk mencairkan modal mati.`;
    } else {
      resp += `Bagus! Tidak ada produk tertahan yang mengalami penumpukan dead stock. Perputaran inventaris Anda berjalan lancar.\n`;
    }

    if (snapshot.sempolStock) {
      resp += `\n\n🍢 **Status Khusus Bahan Tusuk Sempol:**\n`;
      resp += `- Sisa Stok Tusukan Siap Jual: **${snapshot.sempolStock.stock} tusuk**\n`;
      resp += `- Modal per Tusuk: Rp ${snapshot.sempolStock.costPerStick.toLocaleString('id-ID')}\n`;
      if (snapshot.sempolStock.stock < 50) {
        resp += `⚠️ *Peringatan:* Stok tusukan menipis di bawah 50 tusuk! Segera lakukan produksi/restock bahan.`;
      }
    }

    return resp;
  },

  // Logika Khusus: Titik Impas (BEP)
  generateBEPResponse(snapshot) {
    const totalExpenses = snapshot.totalExpensesAllTime;
    const avgMarginRatio = snapshot.totalRevenueAllTime > 0 ? (snapshot.totalGrossProfitAllTime / snapshot.totalRevenueAllTime) : 0.4;
    const bepOmzet = avgMarginRatio > 0 ? Math.round(totalExpenses / avgMarginRatio) : 0;
    const aov = snapshot.avgOrderValue > 0 ? snapshot.avgOrderValue : 25000;
    const bepTransactions = Math.ceil(bepOmzet / aov);

    let resp = `### ⚖️ Analisis Titik Impas (Break-Even Point / BEP)\n\n`;
    resp += `Titik Impas adalah kondisi di mana seluruh biaya usaha tertutupi oleh keuntungan penjualan (tidak untung dan tidak rugi).\n\n`;

    resp += `**Kalkulasi Finansial:**\n`;
    resp += `- **Total Beban Pengeluaran Operasional:** Rp ${totalExpenses.toLocaleString('id-ID')}\n`;
    resp += `- **Rasio Laba Kotor Toko:** ${(avgMarginRatio * 100).toFixed(1)}%\n`;
    resp += `- **Target Omzet Minimal untuk BEP:** **Rp ${bepOmzet.toLocaleString('id-ID')}**\n`;
    resp += `- **Target Jumlah Transaksi (Struk):** Sekitar **${bepTransactions.toLocaleString('id-ID')} transaksi** (asumsi rata-rata belanja Rp ${Math.round(aov).toLocaleString('id-ID')})\n\n`;

    const progressBEP = snapshot.totalRevenueAllTime >= bepOmzet ? 100 : Math.round((snapshot.totalRevenueAllTime / bepOmzet) * 100);
    resp += `**Status Pencapaian:** [${progressBEP}%]\n`;
    if (progressBEP >= 100) {
      resp += `🎉 Selamat! Usaha Anda sudah berhasil **melewati titik impas modal**. Setiap penjualan berikutnya sudah menghasilkan laba bersih riil murni.`;
    } else {
      const sisaOmzet = bepOmzet - snapshot.totalRevenueAllTime;
      resp += `Toko Anda memerlukan tambahan omzet penjualan sebesar **Rp ${sisaOmzet.toLocaleString('id-ID')}** lagi untuk mencapai titik impas modal.`;
    }

    return resp;
  },

  // Overview Umum Bisnis
  generateGeneralBusinessOverview(snapshot) {
    let resp = `### 📊 Ikhtisar Kesehatan Usaha ${snapshot.storeName}\n\n`;
    resp += `Halo Bos! Berikut adalah potret ringkas operasional toko saat ini:\n\n`;
    resp += `- **Omzet Keseluruhan:** Rp ${snapshot.totalRevenueAllTime.toLocaleString('id-ID')} (${snapshot.totalTransactionsCount} struk)\n`;
    resp += `- **Omzet 7 Hari Terakhir:** Rp ${snapshot.revenue7Days.toLocaleString('id-ID')}\n`;
    resp += `- **Laba Bersih Riil:** Rp ${snapshot.netProfitRiil.toLocaleString('id-ID')} (Margin: ${snapshot.netProfitMarginPercent}%)\n`;
    resp += `- **Katalog Produk Aktif:** ${snapshot.totalProductCatalog} produk\n\n`;

    resp += `💡 **Anda bisa menanyakan pertanyaan spesifik kepada saya, seperti:**\n`;
    resp += `1. *"Berapa rekomendasi gaji karyawan saya dari omzet sekarang?"*\n`;
    resp += `2. *"Bagaimana analisis laba rugi toko saya?"*\n`;
    resp += `3. *"Produk apa yang paling laku dan apa yang harus dipromokan?"*\n`;
    resp += `4. *"Berapa target omzet harian agar cepat balik modal (BEP)?"*`;
    return resp;
  },

  // Formatting sederhana untuk pesan AI (Markdown to HTML)
  formatMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3 class="font-bold text-xs sm:text-sm text-white mt-2 mb-1 flex items-center gap-1.5 flex-wrap">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="font-bold text-sm sm:text-base text-primary-400 mt-2 mb-1.5">$1</h2>');

    // Bold & Italics
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em class="text-slate-300 italic">$1</em>');

    // Bullet points
    html = html.replace(/^\- (.*$)/gim, '<li class="ml-3 sm:ml-4 list-disc text-slate-300 my-0.5 break-words">$1</li>');
    html = html.replace(/^([0-9]+)\. (.*$)/gim, '<li class="ml-3 sm:ml-4 list-decimal text-slate-300 my-0.5 break-words"><span class="font-semibold text-white">$1.</span> $2</li>');

    // Paragraphs / line breaks
    html = html.replace(/\n\n/g, '<div class="h-1.5 sm:h-2"></div>');
    html = html.replace(/\n/g, '<br/>');

    return html;
  },

  // Render Pesan ke DOM
  renderMessages() {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;

    container.innerHTML = this.messages.map(msg => {
      const isUser = msg.role === 'user';
      return `
        <div class="flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-2.5 sm:mb-3">
          <div class="flex items-end gap-1.5 sm:gap-2 max-w-[94%] sm:max-w-[85%] md:max-w-[80%] ${isUser ? 'flex-row-reverse' : 'flex-row'}">
            <div class="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-[10px] sm:text-xs flex-shrink-0 mb-0.5 ${
              isUser ? 'bg-primary-600 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-glow-primary'
            }">
              <i class="fa-solid ${isUser ? 'fa-user' : 'fa-robot'}"></i>
            </div>
            <div class="p-2.5 sm:p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words overflow-x-auto ${
              isUser 
                ? 'bg-primary-600 text-white rounded-br-sm shadow-md' 
                : 'bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-bl-sm shadow-lg'
            }">
              ${isUser ? msg.text.replace(/\n/g, '<br/>') : this.formatMarkdown(msg.text)}
            </div>
          </div>
          <span class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 ${isUser ? 'mr-7 sm:mr-9' : 'ml-7 sm:ml-9'}">${msg.time || ''}</span>
        </div>
      `;
    }).join('');

    // Scroll ke paling bawah
    container.scrollTop = container.scrollHeight;
  },

  renderLoading(show) {
    const loadingEl = document.getElementById('ai-chat-loading');
    if (!loadingEl) return;
    if (show) {
      loadingEl.classList.remove('hidden');
      loadingEl.classList.add('flex');
      const container = document.getElementById('ai-chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    } else {
      loadingEl.classList.add('hidden');
      loadingEl.classList.remove('flex');
    }
  }
};

// Global UI Trigger Helpers
function openAIChatModal() {
  const modal = document.getElementById('modal-ai-chat');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  if (typeof AIAgent !== 'undefined') {
    AIAgent.init();
    AIAgent.renderMessages();
    // Update badge status API key
    updateAIEngineBadge();
  }

  // Fokus ke input
  setTimeout(() => {
    const input = document.getElementById('ai-chat-input');
    if (input) input.focus();
  }, 100);
}

function closeAIChatModal() {
  const modal = document.getElementById('modal-ai-chat');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function sendAIChatPrompt(promptText) {
  const input = document.getElementById('ai-chat-input');
  const text = promptText || (input ? input.value : '');
  if (!text || !text.trim()) return;

  if (input && !promptText) input.value = '';
  AIAgent.ask(text);
}

function updateAIEngineBadge() {
  const badge = document.getElementById('ai-engine-badge');
  const banner = document.getElementById('ai-api-key-banner');
  const hasKey = AIAgent.apiKey && AIAgent.apiKey.length > 10;

  if (badge) {
    if (hasKey) {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Gemini AI Online`;
      badge.className = "flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full";
    } else {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Smart Engine Lokal`;
      badge.className = "flex items-center gap-1.5 text-[10px] font-medium text-amber-300 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-full";
    }
  }

  if (banner) {
    if (hasKey) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }
}

// Ambil daftar model yang tersedia dari Google Gemini API
AIAgent.fetchAvailableModels = async function(apiKey) {
  const key = (apiKey || this.apiKey || '').trim();
  if (!key || key.length < 10) return [];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const rawModels = data.models || [];
    
    // Filter hanya model yang mendukung generateContent dan berupa gemini
    const contentModels = rawModels.filter(m => {
      const name = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && name.includes('gemini') && !name.includes('vision');
    });

    // Urutkan: Flash terlebih dahulu, lalu pro
    contentModels.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName.includes('flash') && !bName.includes('flash')) return -1;
      if (!aName.includes('flash') && bName.includes('flash')) return 1;
      return aName.localeCompare(bName);
    });

    this.cachedModels = contentModels;
    localStorage.setItem('ai_cached_models', JSON.stringify(contentModels));
    return contentModels;
  } catch (err) {
    console.warn('Gagal memuat model dari Gemini:', err);
    throw err;
  }
};

// Render opsi model ke elemen select
AIAgent.populateModelSelect = function(models, selectedVal = 'auto') {
  const select = document.getElementById('ai-model-select');
  if (!select) return;

  const currentVal = selectedVal || this.selectedModel || 'auto';
  let html = `<option value="auto">✨ Otomatis (Model Cepat &amp; Terbaik - Direkomendasikan)</option>`;

  if (Array.isArray(models) && models.length > 0) {
    models.forEach(m => {
      const cleanName = (m.name || '').replace(/^models\//, '');
      const displayName = m.displayName ? `${m.displayName} (${cleanName})` : cleanName;
      const isSelected = (currentVal === cleanName || currentVal === m.name);
      html += `<option value="${cleanName}" ${isSelected ? 'selected' : ''}>${displayName}</option>`;
    });
  } else {
    // Fallback default
    html += `
      <option value="gemini-1.5-flash" ${currentVal === 'gemini-1.5-flash' ? 'selected' : ''}>Gemini 1.5 Flash (Cepat &amp; Efisien)</option>
      <option value="gemini-2.0-flash" ${currentVal === 'gemini-2.0-flash' ? 'selected' : ''}>Gemini 2.0 Flash (Generasi Baru)</option>
      <option value="gemini-1.5-pro" ${currentVal === 'gemini-1.5-pro' ? 'selected' : ''}>Gemini 1.5 Pro (Analisis Kompleks)</option>
    `;
  }

  select.innerHTML = html;
  if (currentVal === 'auto') select.value = 'auto';

  const countBadge = document.getElementById('ai-model-count');
  if (countBadge) {
    countBadge.innerText = (models && models.length > 0) ? `${models.length} Model Ditemukan` : 'Auto-Detect Aktif';
  }
};

// Modal Pengaturan API Key AI
function openAISettingsModal() {
  const modal = document.getElementById('modal-ai-settings');
  if (!modal) return;
  const inputKey = document.getElementById('ai-api-key-input');
  if (inputKey) inputKey.value = AIAgent.apiKey || '';
  
  // Tampilkan model yang tersimpan di cache
  AIAgent.populateModelSelect(AIAgent.cachedModels, AIAgent.selectedModel);

  const statusEl = document.getElementById('ai-api-status');
  if (statusEl) {
    if (AIAgent.apiKey && AIAgent.apiKey.length > 10) {
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> <span class="text-emerald-300">API Key terpasang (${AIAgent.cachedModels.length || 0} model terdeteksi).</span>`;
      statusEl.classList.remove('hidden');
    } else {
      statusEl.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeAISettingsModal() {
  const modal = document.getElementById('modal-ai-settings');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// Debounce deteksi otomatis saat pengguna mengetik/paste API key
let apiKeyDebounceTimer = null;
function onApiKeyInputChange(val) {
  clearTimeout(apiKeyDebounceTimer);
  const trimmed = (val || '').trim();
  const statusEl = document.getElementById('ai-api-status');
  if (trimmed.length < 15) {
    if (statusEl) statusEl.classList.add('hidden');
    return;
  }

  apiKeyDebounceTimer = setTimeout(() => {
    loadGeminiModelsFromInput(false);
  }, 700);
}

// Cek API Key dan ambil daftar model aktif dari Google
async function loadGeminiModelsFromInput(showToastNotice = false) {
  const inputKey = document.getElementById('ai-api-key-input');
  const key = inputKey ? inputKey.value.trim() : '';
  const statusEl = document.getElementById('ai-api-status');
  const icon = document.getElementById('icon-fetch-models');

  if (!key || key.length < 10) {
    if (statusEl) {
      statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation text-amber-400"></i> <span class="text-amber-300">Masukkan API Key terlebih dahulu.</span>`;
      statusEl.classList.remove('hidden');
    }
    return;
  }

  if (icon) icon.className = 'fa-solid fa-circle-notch fa-spin text-indigo-400';
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-indigo-400"></i> <span class="text-slate-400">Menghubungi Google Gemini &amp; mendeteksi model...</span>`;
    statusEl.classList.remove('hidden');
  }

  try {
    const models = await AIAgent.fetchAvailableModels(key);
    if (models.length > 0) {
      AIAgent.populateModelSelect(models, AIAgent.selectedModel);
      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> <span class="text-emerald-300 font-semibold">API Key Valid! Ditemukan ${models.length} model Gemini aktif.</span>`;
        statusEl.classList.remove('hidden');
      }
      if (showToastNotice && typeof showToast === 'function') {
        showToast(`Berhasil menemukan ${models.length} model Gemini aktif!`, 'success');
      }
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-400"></i> <span class="text-amber-300">Kunci valid, menggunakan model bawaan standar.</span>`;
        statusEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark text-rose-400"></i> <span class="text-rose-300">Gagal: ${err.message}</span>`;
      statusEl.classList.remove('hidden');
    }
    if (showToastNotice && typeof showToast === 'function') {
      showToast(`Gagal verifikasi API Key: ${err.message}`, 'error');
    }
  } finally {
    if (icon) icon.className = 'fa-solid fa-arrows-rotate';
  }
}

// Simpan Pengaturan
async function saveAISettings() {
  const inputKey = document.getElementById('ai-api-key-input');
  const modelSelect = document.getElementById('ai-model-select');
  const btnSave = document.getElementById('btn-save-ai-settings');
  const key = inputKey ? inputKey.value.trim() : '';
  const model = modelSelect ? modelSelect.value : 'auto';

  // Jika ada API key baru dan belum pernah di-fetch modelnya, fetch dulu
  if (key && key.length > 10 && AIAgent.cachedModels.length === 0) {
    if (btnSave) btnSave.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Menyimpan &amp; Memeriksa...</span>`;
    try {
      const models = await AIAgent.fetchAvailableModels(key);
      AIAgent.populateModelSelect(models, model);
    } catch (e) {
      console.warn('Simpan tetap dilanjutkan meskipun fetch gagal:', e);
    } finally {
      if (btnSave) btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>Simpan Pengaturan</span>`;
    }
  }
  
  AIAgent.setApiKey(key, model);
  updateAIEngineBadge();
  closeAISettingsModal();

  if (typeof showToast === 'function') {
    const modelText = model === 'auto' ? 'Otomatis (Flash)' : model;
    showToast(key ? `Pengaturan Gemini AI tersimpan! Model: ${modelText}` : 'AI beralih ke Smart Engine internal.', 'success');
  }
}

// Inisialisasi awal saat dokumen siap
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    AIAgent.init();
  });
}
