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
        // Mode Online via Gemini LLM (dengan Multi-Model Fallback Otomatis)
        try {
          responseText = await this.queryGemini(trimmed, snapshot);
        } catch (apiError) {
          console.warn('Gagal memanggil Gemini API, beralih ke Smart Offline Engine:', apiError);
          const errLower = (apiError.message || '').toLowerCase();
          const isHighDemand = errLower.includes('demand') || errLower.includes('503') || errLower.includes('429') || errLower.includes('overloaded');
          const noticeText = isHighDemand
            ? `ℹ️ *Server Google AI sedang mengalami antrean trafik tinggi (High Demand). Sistem otomatis mengalihkan ke analisis cerdas Smart Engine internal POS berbasis data riil toko Anda:* \n\n`
            : `⚠️ *Koneksi Gemini AI terkendala (${apiError.message}). Menggunakan analisis Smart Engine internal:* \n\n`;
          responseText = noticeText + this.generateSmartOfflineResponse(trimmed, snapshot);
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

  // Query Google Gemini REST API dengan Multi-Model Fallback
  async queryGemini(prompt, snapshot) {
    let primaryModel = this.selectedModel || 'auto';
    if (primaryModel === 'auto') {
      const flashModel = (this.cachedModels || []).find(m => (m.name || '').includes('flash'));
      primaryModel = flashModel ? flashModel.name.replace(/^models\//, '') : 'gemini-1.5-flash';
    } else {
      primaryModel = primaryModel.replace(/^models\//, '');
    }

    // Urutan model alternatif jika server Google sedang sibuk (high demand)
    const fallbackList = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-2.5-flash', 'gemini-1.5-pro'];
    const modelsToTry = [primaryModel, ...fallbackList.filter(m => m !== primaryModel)];

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

    let lastError = null;

    // Coba model secara berurutan jika ada model yang high demand / 503
    for (const model of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          const errMsg = errJson.error?.message || `HTTP ${res.status}`;
          
          // Cek apakah server Google sedang sibuk/overloaded/rate-limited
          const isOverloaded = res.status === 503 || res.status === 429 || res.status === 500 || 
            errMsg.toLowerCase().includes('demand') || errMsg.toLowerCase().includes('overloaded') || 
            errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('resource');
          
          if (isOverloaded) {
            console.warn(`[AI Gemini] Model ${model} sibuk/overloaded (${errMsg}), mencoba model cadangan...`);
            lastError = new Error(errMsg);
            continue; // Coba model cadangan berikutnya
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate && candidate.trim()) {
          return candidate;
        }
      } catch (err) {
        lastError = err;
        const errMsgLower = (err.message || '').toLowerCase();
        if (errMsgLower.includes('demand') || errMsgLower.includes('overloaded') || errMsgLower.includes('503') || errMsgLower.includes('429')) {
          console.warn(`[AI Gemini] Kendala pada ${model}: ${err.message}, mencoba model berikutnya...`);
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('Semua model Gemini saat ini sedang mengalami lonjakan antrean trafik tinggi.');
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

    let response = `### 💼 Rekomendasi Penentuan Gaji Karyawan Berdasarkan Laba Bersih & Omzet\n\n`;
    response += `Berdasarkan data operasional toko **${snapshot.storeName}**, berikut adalah analisis finansial untuk menentukan sistem gaji yang sehat dan adil:\n\n`;

    const netProfit = snapshot.netProfitRiil > 0 ? snapshot.netProfitRiil : Math.round(omzet30 * 0.35);
    const netBudgetLow = Math.round(netProfit * 0.20);
    const netBudgetIdeal = Math.round(netProfit * 0.30);
    const netBudgetHigh = Math.round(netProfit * 0.40);

    response += `📊 **Data Finansial Toko Saat Ini:**\n`;
    response += `- **Estimasi Omzet 30 Hari:** Rp ${omzet30.toLocaleString('id-ID')}\n`;
    response += `- **Laba Bersih Riil Toko:** **Rp ${netProfit.toLocaleString('id-ID')}** (Margin: ~${snapshot.netProfitMarginPercent}%)\n`;
    if (existingSalary > 0) {
      response += `- **Pengeluaran Gaji Terdata di Buku Kas:** Rp ${existingSalary.toLocaleString('id-ID')}\n`;
    }
    response += `\n`;

    response += `🎯 **Aturan Alokasi Gaji dari Laba Bersih (Profit-Sharing Rule):**\n`;
    response += `Jika gaji diambil dari **Laba Bersih**, rasio alokasi yang ideal dan sehat agar pemilik toko tetap memegang cadangan modal yang kuat adalah **20% s/d 40% dari laba bersih**:\n`;
    response += `- **Batas Hemat & Aman (20% Laba):** Total Rp ${netBudgetLow.toLocaleString('id-ID')}/bulan (Sisa 80% untuk modal pemilik)\n`;
    response += `- **Batas Ideal Standar Bisnis (30% Laba):** Total Rp ${netBudgetIdeal.toLocaleString('id-ID')}/bulan (Sisa 70% untuk pemilik) ⭐\n`;
    response += `- **Batas Maksimal (40% Laba):** Total Rp ${netBudgetHigh.toLocaleString('id-ID')}/bulan (Sisa 60% untuk pemilik)\n\n`;

    response += `💡 **Rekomendasi 2 Skema Sistem Gaji Terbaik:**\n\n`;
    response += `**1. Skema Gaji Pokok + Bonus Bagi Hasil Laba (Paling Direkomendasikan):**\n`;
    response += `- Berikan gaji pokok dasar yang terjangkau + bonus insentif bulanan diambil dari 20%-30% laba bersih toko jika target operasional tercapai.\n`;
    response += `*Keuntungan:* Karyawan merasa memiliki usaha (*sense of belonging*) dan termotivasi menjaga efisiensi biaya serta menaikkan penjualan.\n\n`;

    response += `**2. Skema Bagi Rata Laba Bersih (Flat Profit Sharing):**\n`;
    response += `- Total alokasi (misal 30% = Rp ${netBudgetIdeal.toLocaleString('id-ID')}) dibagi rata dengan jumlah karyawan aktif.\n\n`;

    response += `🧮 **Ingin Coba Simulasi Interaktif?**\n`;
    response += `Gunakan fitur baru **Kalkulator Simulasi Gaji dari Laba Bersih** dengan mengklik tombol kalkulator di bagian atas jendela chat ini atau di sub-tab menu Laporan Toko!`;

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

/**
 * KALKULATOR SIMULASI GAJI DARI LABA BERSIH
 * Menghitung pembagian laba bersih toko untuk alokasi gaji karyawan & pemilik toko
 */
const SalaryCalculator = {
  currentPeriod: '30days',
  netProfit: 0,
  omzet: 0,
  hpp: 0,
  expenses: 0,
  employeeCount: 1,
  percentage: 30,

  async init() {
    await this.loadDataForPeriod(this.currentPeriod);
  },

  async setPeriod(period) {
    this.currentPeriod = period;
    ['today', '7days', '30days', 'all'].forEach(p => {
      const btn = document.getElementById(`btn-calc-period-${p}`);
      if (btn) {
        if (p === period) {
          btn.className = 'py-1.5 rounded text-[10px] sm:text-[11px] bg-emerald-600 text-white font-bold transition-colors';
        } else {
          btn.className = 'py-1.5 rounded text-[10px] sm:text-[11px] text-slate-400 hover:text-white transition-colors';
        }
      }
    });
    await this.loadDataForPeriod(period);
  },

  async loadDataForPeriod(period) {
    const store = (typeof DB !== 'undefined' && DB.getActiveStore) ? DB.getActiveStore() : { name: 'Toko Aktif' };
    const storeNameEl = document.getElementById('calc-store-name');
    if (storeNameEl) storeNameEl.innerText = store.name;

    const txs = (typeof DB !== 'undefined' && DB.getTransactions) ? await DB.getTransactions() : [];
    const exps = (typeof DB !== 'undefined' && DB.getExpenses) ? await DB.getExpenses() : [];

    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    let startDate = new Date(0); // all
    const todayStr = now.toISOString().split('T')[0];

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === '7days') {
      startDate = new Date(now.getTime() - (7 * oneDay));
    } else if (period === '30days') {
      startDate = new Date(now.getTime() - (30 * oneDay));
    }

    let omzet = 0;
    let hpp = 0;

    txs.forEach(tx => {
      const txTime = new Date(tx.timestamp || tx.date || now);
      if (period === 'today') {
        const isToday = (tx.timestamp && String(tx.timestamp).startsWith(todayStr)) || (tx.date && String(tx.date).startsWith(todayStr));
        if (!isToday) return;
      } else if (txTime < startDate) {
        return;
      }

      const total = Number(tx.total) || 0;
      omzet += total;

      if (Array.isArray(tx.items)) {
        tx.items.forEach(item => {
          const qty = Number(item.qty || item.quantity || 1);
          const cost = Number(item.cost || item.costPrice || 0);
          hpp += (cost * qty);
        });
      }
    });

    let expenses = 0;
    exps.forEach(exp => {
      const expTime = new Date(exp.date || now);
      if (period === 'today') {
        const isToday = (exp.date && String(exp.date).startsWith(todayStr));
        if (!isToday) return;
      } else if (expTime < startDate) {
        return;
      }
      expenses += (Number(exp.amount) || 0);
    });

    const grossProfit = omzet - hpp;
    const netProfit = grossProfit - expenses;

    this.omzet = omzet;
    this.hpp = hpp;
    this.expenses = expenses;
    this.netProfit = netProfit > 0 ? netProfit : (omzet > 0 ? Math.round(omzet * 0.35) : 3500000);

    // Update previews
    const elOmzet = document.getElementById('calc-preview-omzet');
    const elHpp = document.getElementById('calc-preview-hpp');
    const elExpenses = document.getElementById('calc-preview-expenses');
    const elInputProfit = document.getElementById('calc-input-net-profit');

    if (elOmzet) elOmzet.innerText = 'Rp ' + omzet.toLocaleString('id-ID');
    if (elHpp) elHpp.innerText = 'Rp ' + hpp.toLocaleString('id-ID');
    if (elExpenses) elExpenses.innerText = 'Rp ' + expenses.toLocaleString('id-ID');
    if (elInputProfit) elInputProfit.value = this.netProfit;

    this.calculate();
  },

  changeEmployeeCount(delta) {
    const el = document.getElementById('calc-input-employees');
    if (!el) return;
    let val = (parseInt(el.value, 10) || 1) + delta;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    el.value = val;
    this.employeeCount = val;
    this.calculate();
  },

  onSliderChange(val) {
    this.percentage = parseInt(val, 10) || 0;
    const disp = document.getElementById('calc-display-percent');
    if (disp) disp.innerText = this.percentage + '%';
    this.calculate();
  },

  setPercentage(pct) {
    this.percentage = pct;
    const slider = document.getElementById('calc-slider-percent');
    const disp = document.getElementById('calc-display-percent');
    if (slider) slider.value = pct;
    if (disp) disp.innerText = pct + '%';
    this.calculate();
  },

  onOwnerSliderChange(val) {
    this.ownerPercentage = parseInt(val, 10) || 0;
    const disp = document.getElementById('calc-display-owner-percent');
    if (disp) disp.innerText = this.ownerPercentage + '%';
    this.calculate();
  },

  calculate() {
    const elInputProfit = document.getElementById('calc-input-net-profit');
    const elInputEmployees = document.getElementById('calc-input-employees');
    const elInputBase = document.getElementById('calc-input-base-salary');
    const elInputAttendance = document.getElementById('calc-input-attendance');

    const netProfit = Math.max(0, Number(elInputProfit?.value) || 0);
    const employees = Math.max(1, parseInt(elInputEmployees?.value, 10) || 1);
    const baseSalary = Math.max(0, Number(elInputBase?.value) || 0);
    const attendance = Math.max(0, Number(elInputAttendance?.value) || 0);
    const empSharePercent = (this.percentage !== undefined) ? this.percentage : 20;
    const ownerPercent = (this.ownerPercentage !== undefined) ? this.ownerPercentage : 60;

    // 1. Hitung Komponen Karyawan
    const totalEmpProfitBonus = Math.round(netProfit * (empSharePercent / 100));
    const perEmpProfitBonus = Math.round(totalEmpProfitBonus / employees);
    const perEmpTakeHome = baseSalary + attendance + perEmpProfitBonus;
    const totalEmpPayroll = perEmpTakeHome * employees;

    // 2. Sisa Laba Bersih Toko setelah seluruh beban karyawan dipotong
    const remainingNetProfit = Math.max(0, netProfit - totalEmpPayroll);

    // 3. Distribusi Sisa Laba: Owner vs Kas Usaha
    const ownerSalary = Math.round(remainingNetProfit * (ownerPercent / 100));
    const businessRetained = remainingNetProfit - ownerSalary;
    const businessPercent = 100 - ownerPercent;

    // Render Preview & Badges
    const elPreviewRemainder = document.getElementById('calc-preview-net-remainder');
    if (elPreviewRemainder) {
      elPreviewRemainder.innerText = `Sisa Laba: Rp ${remainingNetProfit.toLocaleString('id-ID')}`;
    }

    const elTotalPayrollBadge = document.getElementById('calc-res-total-payroll-badge');
    if (elTotalPayrollBadge) {
      elTotalPayrollBadge.innerText = `Total: Rp ${totalEmpPayroll.toLocaleString('id-ID')}`;
    }

    const elResPerEmp = document.getElementById('calc-res-per-employee');
    if (elResPerEmp) {
      elResPerEmp.innerHTML = `Rp ${perEmpTakeHome.toLocaleString('id-ID')} <span class="text-xs font-normal text-slate-400">/ orang</span>`;
    }

    const elResBreakdown = document.getElementById('calc-res-employee-breakdown');
    if (elResBreakdown) {
      elResBreakdown.innerText = `Pokok: Rp ${baseSalary.toLocaleString('id-ID')} | Kehadiran: Rp ${attendance.toLocaleString('id-ID')} | Bagi Hasil (${empSharePercent}%): Rp ${perEmpProfitBonus.toLocaleString('id-ID')}`;
    }

    // Owner Draw
    const elResOwnerProfit = document.getElementById('calc-res-owner-profit');
    const elResOwnerDetail = document.getElementById('calc-res-owner-detail');
    if (elResOwnerProfit) elResOwnerProfit.innerText = 'Rp ' + ownerSalary.toLocaleString('id-ID');
    if (elResOwnerDetail) elResOwnerDetail.innerText = `${ownerPercent}% dari sisa laba (Rp ${remainingNetProfit.toLocaleString('id-ID')})`;

    // Kas Usaha
    const elResBusinessRetained = document.getElementById('calc-res-business-retained');
    const elResBusinessDetail = document.getElementById('calc-res-business-detail');
    if (elResBusinessRetained) elResBusinessRetained.innerText = 'Rp ' + businessRetained.toLocaleString('id-ID');
    if (elResBusinessDetail) elResBusinessDetail.innerText = `${businessPercent}% sisa untuk modal toko`;

    // Indikator Keamanan Finansial Usaha
    const safetyBar = document.getElementById('calc-safety-bar');
    const safetyStatus = document.getElementById('calc-safety-status');
    const safetyNote = document.getElementById('calc-safety-note');

    const retainedRatio = netProfit > 0 ? (businessRetained / netProfit) : 0;
    const retainedRatioPct = Math.round(retainedRatio * 100);

    if (safetyBar) safetyBar.style.width = Math.min(100, Math.max(5, retainedRatioPct)) + '%';

    if (businessRetained >= netProfit * 0.25) {
      if (safetyBar) safetyBar.className = 'h-full bg-emerald-500 rounded-full transition-all duration-300';
      if (safetyStatus) {
        safetyStatus.innerText = `Sangat Aman & Sehat (${retainedRatioPct}% Kas Usaha)`;
        safetyStatus.className = 'font-bold text-emerald-400';
      }
      if (safetyNote) {
        safetyNote.innerText = `Arus kas toko sangat prima. Setelah gaji ${employees} karyawan dan gaji owner dibayarkan, usaha masih menyisakan Rp ${businessRetained.toLocaleString('id-ID')} (${retainedRatioPct}%) untuk cadangan kas dan pertumbuhan modal.`;
      }
    } else if (businessRetained >= netProfit * 0.10) {
      if (safetyBar) safetyBar.className = 'h-full bg-amber-400 rounded-full transition-all duration-300';
      if (safetyStatus) {
        safetyStatus.innerText = `Cukup Seimbang (${retainedRatioPct}% Kas Usaha)`;
        safetyStatus.className = 'font-bold text-amber-400';
      }
      if (safetyNote) {
        safetyNote.innerText = `Arus kas berada pada ambang batas wajar. Kas usaha yang disisihkan sebesar Rp ${businessRetained.toLocaleString('id-ID')} (${retainedRatioPct}%). Disarankan menjaga pengeluaran operasional agar modal tidak terkuras.`;
      }
    } else {
      if (safetyBar) safetyBar.className = 'h-full bg-rose-500 rounded-full transition-all duration-300';
      if (safetyStatus) {
        safetyStatus.innerText = `Ketat / Berisiko (${retainedRatioPct}% Kas Usaha)`;
        safetyStatus.className = 'font-bold text-rose-400';
      }
      if (safetyNote) {
        safetyNote.innerText = `Peringatan: Kas usaha yang tersisa sangat minim (hanya Rp ${businessRetained.toLocaleString('id-ID')}). Beban gaji karyawan atau tarikan gaji owner terlalu besar, berisiko kesulitan modal saat hari sepi.`;
      }
    }
  },

  // Kirim hasil simulasi ke AI Chat untuk dikonsultasikan
  consultWithAI() {
    const elInputProfit = document.getElementById('calc-input-net-profit');
    const elInputEmployees = document.getElementById('calc-input-employees');
    const elInputBase = document.getElementById('calc-input-base-salary');
    const elInputAttendance = document.getElementById('calc-input-attendance');

    const netProfit = Number(elInputProfit?.value) || 0;
    const employees = parseInt(elInputEmployees?.value, 10) || 1;
    const baseSalary = Number(elInputBase?.value) || 0;
    const attendance = Number(elInputAttendance?.value) || 0;
    const empPercent = (this.percentage !== undefined) ? this.percentage : 20;
    const ownerPercent = (this.ownerPercentage !== undefined) ? this.ownerPercentage : 60;

    const totalEmpProfitBonus = Math.round(netProfit * (empPercent / 100));
    const perEmpProfitBonus = Math.round(totalEmpProfitBonus / employees);
    const perEmpTakeHome = baseSalary + attendance + perEmpProfitBonus;
    const totalEmpPayroll = perEmpTakeHome * employees;
    const remainingNetProfit = Math.max(0, netProfit - totalEmpPayroll);
    const ownerSalary = Math.round(remainingNetProfit * (ownerPercent / 100));
    const businessRetained = remainingNetProfit - ownerSalary;

    const promptText = `Saya membuat simulasi keuangan penggajian dari Laba Bersih Toko sebesar Rp ${netProfit.toLocaleString('id-ID')}:\n- Karyawan (${employees} orang): Gaji Pokok Rp ${baseSalary.toLocaleString('id-ID')} + Uang Kehadiran Rp ${attendance.toLocaleString('id-ID')} + Bonus Laba ${empPercent}% (Rp ${perEmpProfitBonus.toLocaleString('id-ID')}) = Total Take Home Rp ${perEmpTakeHome.toLocaleString('id-ID')} / orang (Total Beban: Rp ${totalEmpPayroll.toLocaleString('id-ID')})\n- Gaji / Prive Owner: ${ownerPercent}% dari sisa laba = Rp ${ownerSalary.toLocaleString('id-ID')}\n- Kas Ditahan untuk Usaha (Modal): Rp ${businessRetained.toLocaleString('id-ID')} (${100 - ownerPercent}%)\n\nSebagai konsultan bisnis, bagaimana evaluasi Anda terhadap komposisi 3 pilar keuangan toko saya ini? Apakah rasio ini sehat dan ada saran penyempurnaan?`;

    closeSalaryCalculatorModal();
    openAIChatModal();
    sendAIChatPrompt(promptText);
  },

  // Catat langsung ke Buku Kas
  recordToBukuKas() {
    const elInputEmployees = document.getElementById('calc-input-employees');
    const elInputBase = document.getElementById('calc-input-base-salary');
    const elInputAttendance = document.getElementById('calc-input-attendance');
    const elInputProfit = document.getElementById('calc-input-net-profit');

    const netProfit = Number(elInputProfit?.value) || 0;
    const employees = parseInt(elInputEmployees?.value, 10) || 1;
    const baseSalary = Number(elInputBase?.value) || 0;
    const attendance = Number(elInputAttendance?.value) || 0;
    const empPercent = (this.percentage !== undefined) ? this.percentage : 20;

    const totalEmpProfitBonus = Math.round(netProfit * (empPercent / 100));
    const perEmpTakeHome = baseSalary + attendance + Math.round(totalEmpProfitBonus / employees);
    const totalPayroll = perEmpTakeHome * employees;

    closeSalaryCalculatorModal();

    if (typeof openExpenseModal === 'function') {
      openExpenseModal();
      setTimeout(() => {
        const catSelect = document.getElementById('expense-category');
        const amountInput = document.getElementById('expense-amount');
        const notesInput = document.getElementById('expense-notes');

        if (catSelect) catSelect.value = 'Gaji';
        if (amountInput) amountInput.value = totalPayroll;
        if (notesInput) notesInput.value = `Gaji ${employees} karyawan (Pokok: ${baseSalary.toLocaleString('id-ID')}, Hadir: ${attendance.toLocaleString('id-ID')}, Bonus Laba: ${totalEmpProfitBonus.toLocaleString('id-ID')})`;
      }, 150);
    } else {
      if (typeof showToast === 'function') {
        showToast('Silakan buka menu Laporan > Buku Kas untuk mencatat pengeluaran gaji ini.', 'info');
      }
    }
  }
};

function openSalaryCalculatorModal() {
  const modal = document.getElementById('modal-salary-calculator');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  SalaryCalculator.init();
}

function closeSalaryCalculatorModal() {
  const modal = document.getElementById('modal-salary-calculator');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}
