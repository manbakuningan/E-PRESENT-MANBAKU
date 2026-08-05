// ==========================================================================
// INLINE QR SCANNER — pengganti popup window terpisah (lebih stabil di mobile)
// ==========================================================================
let inlineScanState = { stream: null, scanLoop: null };

// --- RIWAYAT SCAN TERAKHIR (tampil di bawah kamera, 5-10 entri terakhir) ---
let scanHistoryList = []; // {id, name, status, note, jam}
const SCAN_HISTORY_MAX = 5; // jumlah baris riwayat yang ditampilkan

function addScanHistoryEntry(id, name, status, note) {
    const now = new Date();
    const jam = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const cleanName = (name || '').trim();
    const key = id ? String(id).trim() : '';

    // 1) Cocokkan dulu berdasarkan ID (NISN/NIP) — ini selalu ada walau scan gagal
    let existingIndex = -1;
    if (key) {
        existingIndex = scanHistoryList.findIndex(item => item.id && item.id === key);
    }
    // 2) Fallback: cocokkan berdasarkan nama (untuk kompatibilitas kalau id tidak dikirim)
    if (existingIndex === -1 && cleanName) {
        existingIndex = scanHistoryList.findIndex(item =>
            item.name && item.name.trim().toLowerCase() === cleanName.toLowerCase()
        );
    }

    // Pertahankan nama lama jika scan kali ini tidak membawa nama (mis. gagal karena NISN belum dikenal)
    let finalName = cleanName;
    if (!finalName && existingIndex !== -1) finalName = scanHistoryList[existingIndex].name;
    if (!finalName) finalName = key || '-';

    if (existingIndex !== -1) {
        // Sudah ada orang yang sama: hapus entri lama, ganti dengan status terbaru (tidak menumpuk)
        scanHistoryList.splice(existingIndex, 1);
    }

    scanHistoryList.unshift({ id: key, name: finalName, status, note: note || '', jam });
    if (scanHistoryList.length > SCAN_HISTORY_MAX) scanHistoryList.length = SCAN_HISTORY_MAX;
    renderScanHistoryPanel();
}

function renderScanHistoryPanel() {
    const panel = document.getElementById('inlineScanHistoryList');
    const countEl = document.getElementById('inlineScanHistoryCount');
    if (!panel) return;
    if (countEl) countEl.textContent = scanHistoryList.length + ' terakhir';
    if (scanHistoryList.length === 0) {
        panel.innerHTML = '<div style="text-align:center;color:#64748b;font-size:11px;padding:20px 0;">Belum ada riwayat scan</div>';
        return;
    }
    panel.innerHTML = scanHistoryList.map(item => {
        const ok = item.status === 'success';
        const bg = ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
        const border = ok ? '#10b981' : '#ef4444';
        const icon = ok ? '✅' : '❌';
        return `<div style="display:flex;align-items:center;gap:10px;background:${bg};border-left:3px solid ${border};padding:8px 10px;border-radius:8px;margin-bottom:6px;">
            <span style="font-size:16px;flex-shrink:0;">${icon}</span>
            <div style="flex:1;min-width:0;">
                <div style="color:#f1f5f9;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
                ${item.note ? `<div style="color:#94a3b8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.note}</div>` : ''}
            </div>
            <div style="color:#94a3b8;font-size:10px;font-family:monospace;flex-shrink:0;">${item.jam}</div>
        </div>`;
    }).join('');
}

function closeInlineScanner() {
    if (inlineScanState.scanLoop) { clearInterval(inlineScanState.scanLoop); inlineScanState.scanLoop = null; }
    if (inlineScanState.stream) { inlineScanState.stream.getTracks().forEach(t => t.stop()); inlineScanState.stream = null; }
    const overlay = document.getElementById('inlineScannerOverlay');
    if (overlay) overlay.remove();
}

async function openInlineScanner({ title = 'Scan QR', onDetect }) {
    closeInlineScanner();

    const overlay = document.createElement('div');
    overlay.id = 'inlineScannerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0f172a;display:flex;flex-direction:column;align-items:center;padding:16px;gap:12px;overflow-y:auto;';
    overlay.innerHTML = `
      <div style="width:100%;max-width:440px;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="color:#e2e8f0;font-size:13px;font-weight:700;margin:0;letter-spacing:.5px;">${title}</h3>
        <button id="btnCloseInlineScan" style="background:#1e293b;color:#fff;border:1px solid #334155;padding:8px 14px;border-radius:10px;font-size:11px;font-weight:700;">&#10005; Tutup</button>
      </div>
      <div style="position:relative;width:100%;max-width:440px;flex-shrink:0;">
        <video id="inlineScanVideo" autoplay playsinline muted style="width:100%;max-height:32vh;border-radius:14px;background:#000;min-height:180px;object-fit:cover;display:block;"></video>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <div style="width:180px;height:180px;border:3px solid #6366f1;border-radius:14px;"></div>
        </div>
      </div>
      <p id="inlineScanStatus" style="color:#94a3b8;font-size:12px;text-align:center;max-width:400px;min-height:20px;flex-shrink:0;">Meminta izin kamera...</p>
      <button id="btnSwitchCamInline" style="width:100%;max-width:440px;background:#4f46e5;color:#fff;border:none;padding:11px;border-radius:12px;font-size:12px;font-weight:700;flex-shrink:0;">&#128260; Ganti Kamera</button>

      <div style="width:100%;max-width:440px;flex:1;min-height:150px;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 6px;">
          <span style="color:#cbd5e1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;"><i class="fas fa-history" style="margin-right:6px;"></i>Riwayat Scan Terakhir</span>
          <span id="inlineScanHistoryCount" style="color:#64748b;font-size:10px;"></span>
        </div>
        <div id="inlineScanHistoryList" style="flex:1;min-height:0;overflow-y:auto;background:rgba(15,23,42,0.5);border-radius:12px;padding:8px;border:1px solid #1e293b;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    renderScanHistoryPanel();

    const video = overlay.querySelector('#inlineScanVideo');
    const statusEl = overlay.querySelector('#inlineScanStatus');
    overlay.querySelector('#btnCloseInlineScan').onclick = closeInlineScanner;

    let facing = 'environment';
    overlay.querySelector('#btnSwitchCamInline').onclick = () => {
        facing = facing === 'environment' ? 'user' : 'environment';
        startInlineCam(facing);
    };

    async function startInlineCam(f) {
        try {
            if (inlineScanState.stream) inlineScanState.stream.getTracks().forEach(t => t.stop());
            if (inlineScanState.scanLoop) { clearInterval(inlineScanState.scanLoop); inlineScanState.scanLoop = null; }
            statusEl.textContent = 'Membuka kamera...';
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw { name: 'NotSupportedError', message: 'Browser tidak mendukung kamera.' };
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: f === 'environment' ? { ideal: 'environment' } : 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            inlineScanState.stream = stream;
            video.srcObject = stream;
            // Mirror kamera depan agar tidak terbalik saat dilihat user (kamera belakang tetap normal)
            video.style.transform = (f === 'user') ? 'scaleX(-1)' : 'none';
            await video.play();
            statusEl.textContent = 'Arahkan QR ke kamera';
            beginInlineScan(video, onDetect, statusEl);
        } catch (e) {
            let msg = 'Kamera gagal: ' + (e.message || e.name || 'Error');
            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                msg = 'Izin kamera ditolak. Buka Setelan browser → Izin Situs → Kamera → Izinkan.';
            } else if (e.name === 'NotReadableError') {
                msg = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi lain lalu coba lagi.';
            } else if (e.name === 'OverconstrainedError') {
                msg = 'Kamera tidak mendukung mode ini, coba ganti kamera.';
            }
            statusEl.textContent = msg;
            statusEl.style.color = '#f87171';
        }
    }

    startInlineCam(facing);
}

    function beginInlineScan(video, onDetect, statusEl) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let lastScan = 0;

        function runZXingLoop() {
            let reader;
            try {
                const hints = new Map();
                hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
                hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
                reader = new ZXing.BrowserQRCodeReader(hints);
            } catch (e) { runJsQRLoop(); return; }

            inlineScanState.scanLoop = setInterval(() => {
                if (video.readyState < video.HAVE_ENOUGH_DATA) return;
                const now = Date.now();
                if (now - lastScan < 1500) return;
                const W = video.videoWidth, H = video.videoHeight;
                if (!W || !H) return;
                canvas.width = W; canvas.height = H;
                ctx.drawImage(video, 0, 0, W, H);
                try {
                    const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
                    const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
                    const result = reader.decodeBitmap(bmp);
                    if (result && result.getText()) {
                        lastScan = now;
                        if (statusEl) { statusEl.textContent = '✓ Terdeteksi!'; statusEl.style.color = '#4ade80'; }
                        onDetect(result.getText());
                        setTimeout(() => { if (statusEl) { statusEl.textContent = 'Arahkan QR ke kamera'; statusEl.style.color = '#94a3b8'; } }, 1200);
                    }
                } catch (e) {}
            }, 150);
        }

        function runJsQRLoop() {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
            s.onload = () => {
                inlineScanState.scanLoop = setInterval(() => {
                    if (video.readyState < video.HAVE_ENOUGH_DATA) return;
                    const now = Date.now();
                    if (now - lastScan < 1500) return;
                    const W = video.videoWidth, H = video.videoHeight;
                    if (!W || !H) return;
                    canvas.width = W; canvas.height = H;
                    ctx.drawImage(video, 0, 0, W, H);
                    const d = ctx.getImageData(0, 0, W, H);
                    const r = jsQR(d.data, W, H, { inversionAttempts: 'attemptBoth' });
                    if (r && r.data) {
                        lastScan = now;
                        onDetect(r.data);
                    }
                }, 150);
            };
            document.head.appendChild(s);
        }

        if (typeof ZXing !== 'undefined') {
            runZXingLoop();
        } else {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
            s.onload = runZXingLoop;
            s.onerror = runJsQRLoop;
            document.head.appendChild(s);
        }
    }

    let DEPLOYMENT_URL = '';
    let currentUser = null;
    let html5QrCode = null;
    let isScanning = false;
    let isSidebarOpen = true;

    // --- SCAN LIVE TABLE STATE ---
    let scanLiveCount = 0;
    let scanLiveMap = {}; // nisn -> tr element 
    
    // --- SMART CACHE ---
    let appCache = {
        siswa: null,
        guru: null
    };

    // --- CHART & UTILS ---
    let dashboardChart = null;
    let existingClasses = []; // Untuk autocomplete kelas
    let guruChartInstance = null;
    let adminChartInstance = null;

    // Set Tanggal Hari Ini
    const dateElement = document.getElementById('currentDateDisplay');
    if (dateElement) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateElement.textContent = new Date().toLocaleDateString('id-ID', options);
    }

    const tableState = {
                siswa: { fullData: [], filtered: [], limit: 10, page: 1, search: '', classFilter: '' },
                // UPDATE BAGIAN INI: Tambahkan classFilter: ''
                guru: { fullData: [], filtered: [], limit: 10, page: 1, search: '', classFilter: '' },
                
                libur: { fullData: [], filtered: [], limit: 10, page: 1, search: '' },
                rekap: { fullData: [], filtered: [], limit: 10, page: 1, search: '' },
                monitoring: { fullData: [], filtered: [], limit: 10, page: 1, search: '', statusFilter: '', classFilter: '' }
            };

function handleTableSearch(type, query) {
        tableState[type].search = query.toLowerCase();
        tableState[type].page = 1; // Reset ke halaman 1 saat search
        processTableData(type);
    }

// FUNGSI BARU: Handle perubahan dropdown filter kelas
    function handleTableClassFilter(type, value) {
        if (tableState[type]) {
            tableState[type].classFilter = value;
            tableState[type].page = 1; // Reset ke halaman 1
            processTableData(type);
        }
    }
    
function handleTableStatusFilter(type, status) {
        if (tableState[type]) {
            tableState[type].statusFilter = status;
            tableState[type].page = 1; // Reset ke halaman 1
            processTableData(type);
        }
    }

    function handleTableLimit(type, limit) {
        tableState[type].limit = limit === 'all' ? 999999 : parseInt(limit);
        tableState[type].page = 1; // Reset ke halaman 1 saat ganti limit
        processTableData(type);
    }

    function changePage(type, direction) {
        const state = tableState[type];
        const maxPage = Math.ceil(state.filtered.length / state.limit);
        const newPage = state.page + direction;
        
        if (newPage >= 1 && newPage <= maxPage) {
            state.page = newPage;
            processTableData(type);
        }
    }

function processTableData(type) {
        const state = tableState[type];
        
        // 1. Mulai dari data mentah (Full Data)
        let result = [...state.fullData];

        // 2. FILTER KHUSUS: KELAS (Untuk Siswa, Guru, dan Monitoring)
        if ((type === 'siswa' || type === 'guru' || type === 'monitoring') && state.classFilter) {
            result = result.filter(item => item.kelas === state.classFilter);
        }

        // 3. FILTER KHUSUS: STATUS KEHADIRAN (Untuk Monitoring)
        if (type === 'monitoring' && state.statusFilter) {
            result = result.filter(item => item.status === state.statusFilter);
        }

        // 4. FILTER UMUM: PENCARIAN (SEARCH)
        if (state.search) {
            const query = state.search.toLowerCase();
            result = result.filter(item => 
                Object.values(item).some(val => 
                    String(val).toLowerCase().includes(query)
                )
            );
        }

        // 5. Simpan hasil penyaringan ke state
        state.filtered = result;

        // 6. LOGIKA PAGINASI
        const total = state.filtered.length;
        const totalPages = Math.ceil(total / state.limit);
        
        // Koreksi halaman jika melebihi total halaman (misal setelah search/filter)
        if (state.page > totalPages && totalPages > 0) state.page = totalPages;
        if (total === 0) state.page = 1;

        const startIdx = (state.page - 1) * state.limit;
        const endIdx = startIdx + state.limit;
        
        // Ambil data untuk halaman saat ini
        const pagedData = state.filtered.slice(startIdx, endIdx);

        // 7. RENDER TABEL (Pilih renderer berdasarkan tipe)
        if (type === 'siswa') renderSiswaRows(pagedData, startIdx);
        else if (type === 'guru') renderGuruRows(pagedData, startIdx);
        else if (type === 'libur') renderLiburRows(pagedData, startIdx);
        else if (type === 'rekap') renderRekapRows(pagedData);
        else if (type === 'monitoring') renderMonitoringRows(pagedData, startIdx);

        // 8. UPDATE UI PAGINATION (Footer Tabel)
        updatePaginationUI(type, startIdx, pagedData.length, total, state.page, totalPages);
    }

    function updatePaginationUI(type, startIdx, currentCount, total, currentPage, totalPages) {
        const infoEl = document.getElementById(`info-${type}`);
        const btnPrev = document.getElementById(`btn-prev-${type}`);
        const btnNext = document.getElementById(`btn-next-${type}`);
        
        if (total === 0) {
            infoEl.textContent = 'Tidak ada data ditemukan.';
            btnPrev.disabled = true;
            btnNext.disabled = true;
        } else {
            const end = startIdx + currentCount;
            infoEl.textContent = `Menampilkan ${startIdx + 1} - ${end} dari ${total} data`;
            btnPrev.disabled = currentPage === 1;
            btnNext.disabled = currentPage >= totalPages;
        }
    }
    // ==========================================================================
// ABSENSI GURU
// ==========================================================================
let guruLocalCache = {};
let guruLocalCacheLoaded = false;
let guruScanCount = 0;
let cameraPopupGuru = null;

function loadAbsensiGuruMenu() {
    setActiveMenu('Absensi Guru');
    showView('view-absensi-guru');
    showGuruScanSection();
    resetGuruScanTable();

    // 1. Coba muat dari localStorage dulu
    if (!guruLocalCacheLoaded) {
        try {
            const cached = localStorage.getItem('guruLocalCache_v1');
            if (cached) {
                guruLocalCache = JSON.parse(cached);
                guruLocalCacheLoaded = true;
            }
        } catch (e) {}
    }

    // 2. Refresh dari server kalau online
    if (navigator.onLine) {
        callGAS('getGuruForScanCache').then(res => {
            if (res.success) {
                guruLocalCache = {};
                res.data.forEach(g => { guruLocalCache[g.nip] = { nama: g.nama }; });
                guruLocalCacheLoaded = true;
                try { localStorage.setItem('guruLocalCache_v1', JSON.stringify(guruLocalCache)); } catch (e) {}
            }
        }).catch(() => {});
    }
}

function showGuruScanSection() {
    document.getElementById('guruScanSection').classList.remove('hidden');
    document.getElementById('guruMonitoringSection').classList.add('hidden');
}

function loadMonitoringGuru() {
    document.getElementById('guruScanSection').classList.add('hidden');
    document.getElementById('guruMonitoringSection').classList.remove('hidden');
    const tbody = document.getElementById('tbody-monitoring-guru');
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat...</td></tr>';

    callGAS('getMonitoringGuruRealtime').then(res => {
        if (!res.success) { tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">${res.message}</td></tr>`; return; }
        if (res.data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400">Belum ada data guru.</td></tr>'; return; }
        tbody.innerHTML = res.data.map((g, i) => {
            const badge = g.status === 'Hadir'
                ? '<span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full">✓ Hadir</span>'
                : '<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded-full">Belum Absen</span>';
            return `<tr class="border-b border-gray-50 hover:bg-gray-50">
                <td class="p-3 text-center text-gray-400 text-xs">${i+1}</td>
                <td class="p-3 text-xs font-mono text-gray-600">${g.nip}</td>
                <td class="p-3 text-sm font-bold text-gray-800">${g.nama}</td>
                <td class="p-3 text-center text-xs font-mono">${g.jamDatang}</td>
                <td class="p-3 text-center text-xs font-mono">${g.jamPulang}</td>
                <td class="p-3 text-center">${badge}</td>
            </tr>`;
        }).join('');
    }).catch(err => showAlert('error', 'Gagal koneksi: ' + err));
}

function openCameraPopupGuru() {
    openInlineScanner({
        title: '&#128247; SCAN QR GURU',
        onDetect: (text) => { onScanSuccessGuru(text); }
    });
}

function submitManualNipGuru() {
    const inp = document.getElementById('manualNipGuru');
    const val = inp.value.trim();
    if (!val) { showAlert('error', 'Masukkan ID Guru terlebih dahulu'); return; }
    inp.value = '';
    onScanSuccessGuru(val);
}

function onScanSuccessGuru(decodedText) {
    const key = String(decodedText).replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!key) return;

    const doSubmit = (nama) => {
        callGASOffline('batchScanAbsensiGuru', [key]).then(res => {
            if (res.offline) {
                showBigScanPopup({ type: 'success', nama: nama, mode: 'masuk', id: key, customMsg: 'Tersimpan offline' });
                addToGuruScanQueue(nama, 'datang', 'Offline');
                return;
            }
            if (res.success && res.results && res.results[0]) {
                const r = res.results[0];
                if (r.success) {
                    showBigScanPopup({ type: 'success', nama: r.nama, mode: r.type === 'datang' ? 'masuk' : 'pulang' });
                    addToGuruScanQueue(r.nama, r.type, r.jamDatang || r.jamPulang);
                } else if (isSudahAbsenMsg(r.message)) {
                    showBigScanPopup({ type: 'success', nama: r.nama || '', mode: 'masuk', customMsg: r.message });
                } else {
                    showBigScanPopup({ type: 'error', nama: r.nama || '', customMsg: r.message });
                }
            } else {
                showBigScanPopup({ type: 'error', customMsg: res.message || 'Gagal memproses absensi' });
            }
        }).catch(err => {
            showBigScanPopup({ type: 'error', customMsg: String(err) });
        });
    };

    if (guruLocalCacheLoaded && guruLocalCache[key]) {
        doSubmit(guruLocalCache[key].nama);
    } else if (navigator.onLine) {
        callGAS('lookupGuruForScan', key).then(res => {
            if (res.success) doSubmit(res.nama);
            else showBigScanPopup({ type: 'error', customMsg: res.message || 'ID Guru tidak terdaftar' });
        }).catch(err => showBigScanPopup({ type: 'error', customMsg: String(err) }));
    } else {
        // Offline & tidak ada di cache — tetap simpan ke antrian, nama tidak diketahui dulu
        doSubmit(key);
    }
}

function addToGuruScanQueue(nama, type, jam) {
    const tbody = document.getElementById('tbody-scan-guru');
    const emptyRow = document.getElementById('guru-scan-empty-row');
    if (emptyRow) emptyRow.remove();

    guruScanCount++;
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-50 scan-row-highlight';
    const badge = type === 'datang'
        ? '<span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full">Masuk</span>'
        : '<span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded-full">Pulang</span>';
    tr.innerHTML = `
        <td class="px-3 py-3 text-center text-xs text-gray-400">${guruScanCount}</td>
        <td class="px-4 py-3 font-bold text-sm text-gray-800">${nama}</td>
        <td class="px-3 py-3 text-center">${badge}</td>
        <td class="px-3 py-3 text-center text-xs font-mono text-gray-600">${jam}</td>
    `;
    tbody.prepend(tr);
    document.getElementById('guruScanCountBadge').textContent = guruScanCount + ' Scan';
    setTimeout(() => tr.classList.remove('scan-row-highlight'), 2000);
}

function resetGuruScanTable() {
    const tbody = document.getElementById('tbody-scan-guru');
    tbody.innerHTML = `<tr id="guru-scan-empty-row"><td colspan="4" class="py-16 text-center">
        <div class="flex flex-col items-center gap-3">
            <i class="fas fa-user-tie text-5xl text-gray-200"></i>
            <p class="font-semibold text-sm text-gray-400">Belum ada scan</p>
        </div></td></tr>`;
    guruScanCount = 0;
    document.getElementById('guruScanCountBadge').textContent = '0 Scan';
}

// ==========================================================================
// KARTU TANDA PENGAJAR (Guru)
// ==========================================================================
function loadQRCodeGuru(idParam, namaParam, jabatanParam) {
    stopAndBack(false);
    showView('view-kartu-guru');

    let rawId = idParam || (currentUser ? currentUser.idGuru : "") || "BELUM ADA ID";
    const namaGuru = namaParam || (currentUser ? currentUser.nama : "Guru");
    const jabatanGuru = jabatanParam || (currentUser ? currentUser.jabatan : "") || "";
    let cleanId = String(rawId).replace(/[^a-zA-Z0-9]/g, "").trim();

    const jabatanHtml = jabatanGuru
        ? String(jabatanGuru).split(',').map(j => j.trim()).filter(Boolean)
            .map(j => `<div class="flex items-center gap-1.5 justify-center"><span class="text-amber-500">•</span><span>${j}</span></div>`).join('')
        : '<span class="text-gray-400 italic">Tenaga Pendidik</span>';

    const container = document.getElementById('kartuGuruContainer');
    container.innerHTML = `
        <div class="flex justify-center items-center h-full py-12 animate-slide-up">
            <div class="bg-white rounded-3xl shadow-2xl overflow-hidden w-full max-w-sm relative transform hover:scale-[1.02] transition duration-300">
                <div class="bg-gradient-to-r from-amber-700 to-orange-700 p-6 text-white text-center relative">
                    <h2 class="text-2xl font-bold tracking-tight">KARTU TANDA PENGAJAR</h2>
                    <p class="text-xs tracking-[0.2em] uppercase opacity-80 mt-1">MANBA'UL HUDA</p>
                </div>
                <div class="p-8 text-center bg-gray-50">
                    <div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 inline-block mb-5">
                        <div id="myQrcodeGuru"></div>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-800 mb-1">${namaGuru}</h3>
                    <p class="text-amber-600 font-mono font-bold text-lg mb-3 tracking-wider">${cleanId}</p>
                    <div class="text-sm text-gray-600 font-semibold space-y-0.5">${jabatanHtml}</div>
                </div>
                <div class="p-5 bg-white border-t border-gray-100 flex gap-4">
                    <button onclick="window.print()" class="flex-1 bg-gray-900 text-white py-3 rounded-xl font-bold text-sm shadow hover:bg-black transition"><i class="fas fa-print mr-2"></i>Cetak</button>
                    <button onclick="loadDataGuru()" class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition">Tutup</button>
                </div>
            </div>
        </div>`;

    setTimeout(() => {
        const qrElement = document.getElementById("myQrcodeGuru");
        if (qrElement && cleanId) {
            qrElement.innerHTML = "";
            new QRCode(qrElement, { text: cleanId, width: 160, height: 160, colorDark: "#7c2d12", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        }
    }, 100);
}
    // ==========================================================================
    // 2. SESSION MANAGEMENT
    // ==========================================================================
    function checkSession() {
        const storedSession = localStorage.getItem('absensiAppSession');
        if (storedSession) {
            try {
                const sessionData = JSON.parse(storedSession);
                if (sessionData && sessionData.success) {
                    currentUser = sessionData;
                    document.getElementById('loginPage').classList.add('hidden');
                    document.getElementById('dashboardContainer').classList.remove('hidden');
                    
                    if (window.innerWidth < 768) {
                         document.getElementById('sidebar').classList.add('-translate-x-full');
                    }
                    
                    initDashboard();
                }
            } catch (e) {
                localStorage.removeItem('absensiAppSession');
            }
        }
    }

    // ==========================================================================
    // 3. UI NAVIGATION & SIDEBAR
    // ==========================================================================
    function showView(viewId) {
        // Hentikan kamera Daftar Hadir jika pindah ke halaman lain
        if (viewId !== 'view-daftar-hadir-guru' && typeof dhStopPopup === 'function') {
            dhStopPopup();
        }
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none'; 
        });
        
        const target = document.getElementById(viewId);
        if (target) {
            target.classList.add('active');
            target.style.display = 'block'; 
            target.classList.add('animate-fade-in');
        }

        let title = "Dashboard";
        switch (viewId) {
            case 'view-data-siswa': title = "Direktori Siswa"; break;
            case 'view-manajemen-kelas': title = "Manajemen Kelas"; break;
            case 'view-data-guru': title = "Manajemen Guru"; break;
            case 'view-kelola-absen': title = "Kelola Hari Libur"; break; // JUDUL BARU
            case 'view-scanner': title = "Scan Absensi"; break;
            case 'view-daftar-hadir-guru': title = "Daftar Hadir"; break;
            case 'view-monitoring': title = "Monitoring Realtime"; break;
            case 'view-rekap-absensi': title = "Laporan Kehadiran"; break;
            case 'view-kartu-siswa': title = "Kartu Pelajar Digital"; break;
        }
        document.getElementById('pageTitle').textContent = title;
        closeSidebarMobile();
    }

    function setActiveMenu(targetName) {
        const allLinks = document.querySelectorAll('#sidebarMenu a');
        
        const centerClass = !isSidebarOpen ? 'justify-center px-0' : 'space-x-3 px-4';
        const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
        
        const activeStyle = "bg-indigo-600 text-white shadow-lg shadow-indigo-900/50";
        const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";

        allLinks.forEach(link => {
            const menuName = link.getAttribute('data-name');
            if (menuName === targetName) {
                link.className = baseStyle + activeStyle;
            } else {
                link.className = baseStyle + inactiveStyle;
            }
        });
    }

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const main = document.getElementById('mainContent');
        const overlay = document.getElementById('mobileOverlay');
        const labels = document.querySelectorAll('.sidebar-label');
        const header = document.getElementById('sidebarHeader');
        const userCard = document.getElementById('userProfileCard');
        const logoutBtn = document.getElementById('btnLogout');
        const menuLinks = document.querySelectorAll('#sidebarMenu a');

        const isMobile = window.innerWidth < 768;

        if (isMobile) {
            if (sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
                setTimeout(() => overlay.classList.remove('opacity-0'), 10);
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('opacity-0');
                setTimeout(() => overlay.classList.add('hidden'), 300);
            }
        } else {
            if (isSidebarOpen) {
                // COLLAPSE
                sidebar.classList.remove('w-64');
                sidebar.classList.add('w-20');
                main.classList.remove('md:ml-64');
                main.classList.add('md:ml-20');

                // Centering items
                header.classList.remove('px-6', 'justify-start'); header.classList.add('px-0', 'justify-center');
                userCard.classList.remove('space-x-3', 'p-3', 'bg-black/20', 'border'); userCard.classList.add('justify-center', 'p-0', 'bg-transparent', 'border-transparent');
                logoutBtn.classList.remove('space-x-3', 'justify-start', 'px-4'); logoutBtn.classList.add('justify-center', 'px-0');
                menuLinks.forEach(link => { link.classList.remove('space-x-3', 'px-4'); link.classList.add('justify-center', 'px-0'); });
                labels.forEach(el => { el.classList.add('hidden'); });

                isSidebarOpen = false;
            } else {
                // EXPAND
                sidebar.classList.remove('w-20');
                sidebar.classList.add('w-64');
                main.classList.remove('md:ml-20');
                main.classList.add('md:ml-64');

                // Reset items
                header.classList.add('px-6', 'justify-start'); header.classList.remove('px-0', 'justify-center');
                userCard.classList.add('space-x-3', 'p-3', 'bg-black/20', 'border'); userCard.classList.remove('justify-center', 'p-0', 'bg-transparent', 'border-transparent');
                logoutBtn.classList.add('space-x-3', 'justify-start', 'px-4'); logoutBtn.classList.remove('justify-center', 'px-0');
                menuLinks.forEach(link => { link.classList.add('space-x-3', 'px-4'); link.classList.remove('justify-center', 'px-0'); });
                labels.forEach(el => { el.classList.remove('hidden'); });

                isSidebarOpen = true;
            }
        }
    }

    function closeSidebarMobile() {
        if (window.innerWidth < 768) {
            document.getElementById('sidebar').classList.add('-translate-x-full');
            const overlay = document.getElementById('mobileOverlay');
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }

    // ==========================================================================
    // 4. AUTENTIKASI
    // ==========================================================================
    function switchLoginTab(tab) {
        document.getElementById('loginError').classList.add('hidden');
        const btnSiswa = document.getElementById('btnSiswaTab');
        const btnAdmin = document.getElementById('btnAdminTab');
        
        const activeClass = "bg-white text-indigo-600 shadow-sm";
        const inactiveClass = "text-gray-500 hover:text-gray-700 hover:bg-gray-200";

        btnSiswa.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === 'siswa' ? activeClass : inactiveClass}`;
        btnAdmin.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === 'admin' ? activeClass : inactiveClass}`;

        if (tab === 'admin') {
            document.getElementById('formAdminLogin').classList.remove('hidden');
            document.getElementById('formSiswaLogin').classList.add('hidden');
        } else {
            document.getElementById('formAdminLogin').classList.add('hidden');
            document.getElementById('formSiswaLogin').classList.remove('hidden');
        }
    }

    function handleLogin(event) {
        event.preventDefault();
        showLoading();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const nisn = document.getElementById('nisn').value;

        callGAS('login', username, password, nisn).then(onLoginSuccess).catch(onLoginFailure);
    }

    function onLoginSuccess(result) {
        hideLoading(); // Sembunyikan animasi loading
        
        if (result.success) {
            // 1. Simpan data user + TOKEN ke variabel global
            currentUser = result; 
            
            // 2. Simpan ke LocalStorage agar token bertahan saat refresh page
            localStorage.setItem('absensiAppSession', JSON.stringify(result));
            
            // 3. Update UI: Sembunyikan Login, Tampilkan Dashboard
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('dashboardContainer').classList.remove('hidden');
            
            // 4. Inisialisasi Dashboard
            initDashboard();
        } else {
            // Tampilkan pesan error jika login gagal
            const errorDiv = document.getElementById('loginError');
            document.getElementById('errorText').textContent = result.message;
            errorDiv.classList.remove('hidden');
            setTimeout(() => errorDiv.classList.add('hidden'), 5000);
        }
    }

    function onLoginFailure(error) {
        hideLoading();
        alert('Gagal terhubung ke server: ' + error.message);
    }

    function logout() {
        stopAndBack(false);
        localStorage.removeItem('absensiAppSession');
        currentUser = null;
        appCache = { siswa: null, guru: null };
        document.getElementById('dashboardContainer').classList.add('hidden');
        document.getElementById('loginPage').classList.remove('hidden');
        
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('nisn').value = '';
        document.getElementById('sidebar').classList.add('-translate-x-full');
    }

    // ==========================================================================
    // 5. DASHBOARD & MENU
    // ==========================================================================
function initDashboard() {
    const name = currentUser.nama || currentUser.username;
    document.getElementById('navUserName').textContent = name;
    
    // Tampilkan Role dengan format yang rapi
    let displayRole = currentUser.role.toUpperCase();
    if (currentUser.role === 'pimpinan') displayRole = 'PIMPINAN';
    document.getElementById('navUserRole').textContent = displayRole;
    
    document.getElementById('navUserInitial').textContent = name.charAt(0).toUpperCase();

    const menuContainer = document.getElementById('sidebarMenu');
    let menuHTML = '';

    // Helper untuk membuat HTML menu item
    const createItem = (label, icon, onclick, isDefaultActive = false) => {
        const hideText = !isSidebarOpen ? 'hidden' : ''; 
        const centerClass = !isSidebarOpen ? 'justify-center px-0' : 'space-x-3 px-4';
        const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
        const activeStyle = "bg-indigo-600 text-white shadow-lg shadow-indigo-900/50";
        const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";
        const currentStyle = isDefaultActive ? (baseStyle + activeStyle) : (baseStyle + inactiveStyle);

        return `
        <a data-name="${label}" onclick="${onclick}" class="${currentStyle}">
            <i class="fas ${icon} w-6 text-center flex-shrink-0 group-hover:scale-110 transition-transform"></i>
            <span class="sidebar-label font-medium transition-opacity duration-300 ${hideText}">${label}</span>
        </a>`;
    };

    // --- MENU UNTUK ADMIN ---
    if (currentUser.role === 'admin') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadAdminDashboard()', true);
        menuHTML += createItem('Monitoring', 'fa-eye', 'loadMonitoringAbsensi()');
        menuHTML += createItem('Daftar Hadir', 'fa-clipboard-check', 'loadDaftarHadirGuru()');
        menuHTML += createItem('Absensi Guru', 'fa-user-tie', 'loadAbsensiGuruMenu()');
        menuHTML += createItem('Data Siswa', 'fa-user-graduate', 'loadDataSiswa()');
        menuHTML += createItem('Data Guru', 'fa-chalkboard-teacher', 'loadDataGuru()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        menuHTML += createItem('Rekap Guru', 'fa-calendar-check', 'loadMenuRekapGuru()');
        menuHTML += createItem('Kelola Absen', 'fa-calendar-times', 'loadKelolaAbsen()');
        menuHTML += createItem('Manajemen Kelas', 'fa-th-large', 'loadManajemenKelas()'); 
        menuHTML += createItem('Kenaikan Kelas', 'fa-level-up-alt', 'loadKenaikanKelas()');
        loadAdminDashboard();
    } 
    // --- MENU UNTUK GURU ---
     else if (currentUser.role === 'guru') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadGuruDashboard()', true);
        menuHTML += createItem('Absensi Guru', 'fa-user-tie', 'loadAbsensiGuruMenu()');
        menuHTML += createItem('Daftar Hadir', 'fa-clipboard-check', 'loadDaftarHadirGuru()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        loadGuruDashboard();
    }
    // --- MENU UNTUK PIMPINAN (BARU) ---
    else if (currentUser.role === 'pimpinan') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadAdminDashboard()', true);
        menuHTML += createItem('Laporan', 'fa-clipboard-list', 'loadRekapAbsensi()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        loadAdminDashboard();
    }
    // --- MENU UNTUK SISWA ---
    else if (currentUser.role === 'siswa') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadSiswaDashboard()', true);
        menuHTML += createItem('Kartu Saya', 'fa-id-card', 'loadQRCodeSiswa()');
        loadSiswaDashboard();
    }

    // Render Menu ke HTML
    menuContainer.innerHTML = menuHTML;
    
    // --- AMBIL DATA KELAS (Untuk Autocomplete/Dropdown) ---
    loadKelasSuggestions();
}

    // Auto-refresh ringan agar status Alpa/Bolos langsung terpantau
    if (window._autoRefreshInterval) clearInterval(window._autoRefreshInterval);
    window._autoRefreshInterval = setInterval(() => {
        const activeView = document.querySelector('.view-section.active');
        if (!activeView) return;
        if (activeView.id === 'view-monitoring') { tableState.monitoring.fullData = []; loadMonitoringAbsensi(); }
        else if (activeView.id === 'view-admin-dashboard') { 
            if (currentUser.role === 'admin' || currentUser.role === 'pimpinan') loadAdminDashboard();
            else if (currentUser.role === 'guru') loadGuruDashboard();
        }
        else if (activeView.id === 'view-siswa-dashboard') { loadSiswaDashboard(); }
    }, 60000); // tiap 60 detik
  
    // --- DROPDOWN KELAS LOGIC ---
    function loadKelasSuggestions() {
        console.log("Memuat daftar kelas dari Konfigurasi...");
        
        callGAS('getDaftarKelas').then(function(classes) {
            existingClasses = classes; // Simpan ke variabel global
            
            // Populate semua dropdown yang ada di HTML saat ini
            populateAllClassDropdowns();
            
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err))); // Memanggil fungsi backend yang baru kita ubah
    }

function populateAllClassDropdowns() {
    const dropdownIds = [
        'filterKelas',      // Di Data Siswa
        'filterKelasGuru',  // Di Data Guru (jika ada)
        'rekapKelas',       // Di Rekap Bulanan
        'promoKelasAsal',   // Di Kenaikan Kelas
        'promoKelasTujuan'  // Di Kenaikan Kelas
    ];

    dropdownIds.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            // Simpan value yang sedang dipilih (jika ada) biar tidak ke-reset total
            const currentValue = select.value;
            
            // Simpan opsi default/pertama (biasanya "-- Pilih Kelas --" atau "Semua Kelas")
            const defaultOption = select.options[0] ? select.options[0].cloneNode(true) : null;
            
            // Opsional khusus: Untuk Promo Tujuan ada opsi LULUS
            let extraOption = null;
            if(id === 'promoKelasTujuan') {
               extraOption = select.querySelector('option[value="LULUS"]');
            }

            // Kosongkan dropdown
            select.innerHTML = '';
            
            // Kembalikan opsi default
            if (defaultOption) select.appendChild(defaultOption);
            if (extraOption) select.appendChild(extraOption.cloneNode(true));

            // Isi dengan data dari Konfigurasi
            existingClasses.forEach(kelas => {
                const option = document.createElement('option');
                option.value = kelas;
                option.text = kelas;
                select.appendChild(option);
            });

            // Restore value jika masih valid
            if (existingClasses.includes(currentValue)) {
                select.value = currentValue;
            }
        }
    });
}
    function openKelasDropdown() {
        const input = document.getElementById('inputKelas');
        const dropdown = document.getElementById('dropdownKelasList');
        if (!dropdown) return;
        renderKelasDropdown(existingClasses);
        dropdown.classList.remove('hidden');
    }

    function filterKelasDropdown(keyword) {
        const filtered = existingClasses.filter(c => c.toLowerCase().includes(keyword.toLowerCase()));
        renderKelasDropdown(filtered);
    }

    function renderKelasDropdown(items) {
        const dropdown = document.getElementById('dropdownKelasList');
        if (!items || items.length === 0) {
            dropdown.innerHTML = '<div class="px-4 py-3 text-xs text-gray-400 italic">Kelas tidak ditemukan. Ketik untuk membuat baru.</div>';
            return;
        }
        dropdown.innerHTML = items.map(kelas => `
            <div onclick="selectKelas('${kelas}')" class="px-4 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-gray-700 transition-colors border-b border-gray-50 last:border-none">
                ${kelas}
            </div>
        `).join('');
    }

    function selectKelas(value) {
        const input = document.getElementById('inputKelas');
        if (input) {
            input.value = value;
            closeKelasDropdown();
        }
    }

    function closeKelasDropdown() {
        const dropdown = document.getElementById('dropdownKelasList');
        if (dropdown) {
            setTimeout(() => dropdown.classList.add('hidden'), 200);
        }
    }

    // ==========================================================================
    // 6. FUNGSI REFRESH DATA
    // ==========================================================================
function refreshData(type) {
        const btnIcon = event ? event.currentTarget.querySelector('i') : null;
        if(btnIcon) btnIcon.classList.add('fa-spin');

        if (type === 'siswa') {
            tableState.siswa.fullData = []; // Clear cache
            loadDataSiswa();       
            showAlert('success', 'Data siswa diperbarui.');
        } 
        else if (type === 'guru') {
             tableState.guru.fullData = []; // Clear cache
            loadDataGuru();        
            showAlert('success', 'Data guru diperbarui.');
        }
        else if (type === 'dashboard') {
            if (currentUser.role === 'admin') loadAdminDashboard();
            else if (currentUser.role === 'guru') loadGuruDashboard();
            else loadSiswaDashboard();
            showAlert('success', 'Statistik Dashboard diperbarui.');
        }

        else if (type === 'monitoring') {
            tableState.monitoring.fullData = [];
            // Pertahankan classFilter & statusFilter agar dropdown tidak reset
            loadMonitoringAbsensi(); 
            showAlert('success', 'Data monitoring diperbarui.');
        }

        if(btnIcon) setTimeout(() => btnIcon.classList.remove('fa-spin'), 1000);
    }

    // ==========================================================================
    // 7. HALAMAN & LOGIKA DATA
    // ==========================================================================
    
    // --- ADMIN DASHBOARD ---
function loadAdminDashboard() {
    stopAndBack(false);
    setActiveMenu('Dashboard');
    showView('view-admin-dashboard');

    document.getElementById('adminDateDisplay').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const quickAccessPanel = document.getElementById('adminQuickAccess');
    const dashboardTitle = document.querySelector('#view-admin-dashboard h2');

    if (currentUser.role === 'pimpinan') {
        if (quickAccessPanel) quickAccessPanel.style.display = 'none';
        if (dashboardTitle) dashboardTitle.textContent = 'Dashboard Pimpinan';
    } else {
        if (quickAccessPanel) quickAccessPanel.style.display = 'block';
        if (dashboardTitle) dashboardTitle.textContent = 'Dashboard Admin';
    }

    // --- Statistik & Chart Siswa ---
    callGAS('getMonitoringRealtime').then(result => {
    if (result.success) {
        const data = result.data;
        const total = data.length;
        const hadir = data.filter(d => d.status === 'Hadir').length;
        const sakit = data.filter(d => d.status === 'Sakit').length;
        const izin = data.filter(d => d.status === 'Izin').length;
        const alpa = data.filter(d => d.status === 'Alpa').length;
        const bolos = data.filter(d => d.status === 'Bolos').length; // BARU
        const belum = data.filter(d => d.status === 'Belum Absen').length;

        animateValue("admStatTotal", 0, total, 800);
        animateValue("admStatHadir", 0, hadir, 800);
        animateValue("admStatSakit", 0, sakit, 800);
        animateValue("admStatIzin", 0, izin, 800);
        animateValue("admStatAlpa", 0, alpa, 800);
        animateValue("admStatBolos", 0, bolos, 800); // BARU

        renderAdminChart(hadir, sakit, izin, alpa, belum, bolos); // tambahkan bolos
    }
}).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));

    // --- Statistik & Chart Guru ---
    callGAS('getMonitoringGuruRealtime').then(res => {
        if (res.success) {
            const data = res.data;
            const total = data.length;
            const hadir = data.filter(g => g.status === 'Hadir').length;
            const belum = total - hadir;
            animateValue("admStatGuruTotal", 0, total, 800);
            animateValue("admStatGuruHadir", 0, hadir, 800);
            animateValue("admStatGuruBelum", 0, belum, 800);
            renderAdminGuruChart(hadir, belum);
        } else {
            console.warn('getMonitoringGuruRealtime gagal:', res.message);
        }
    }).catch(err => console.error('Error ambil data guru dashboard:', err));
}   // ⬅ HANYA SATU tanda penutup di sini, untuk seluruh fungsi loadAdminDashboard()

let adminGuruChartInstance = null;
function renderAdminGuruChart(hadir, belum) {
    const ctx = document.getElementById('adminGuruAttendanceChart');
    if (!ctx) return;
    if (adminGuruChartInstance) adminGuruChartInstance.destroy();
    if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);
    adminGuruChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Hadir', 'Belum Absen'],
            datasets: [{ data: [hadir, belum], backgroundColor: ['#F59E0B', '#E5E7EB'], borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                datalabels: { color: '#fff', font: { weight: 'bold' }, formatter: (val) => val > 0 ? val : '' }
            }
        }
    });
}

        function renderAdminChart(hadir, sakit, izin, alpa, belum, bolos) {
        const ctx = document.getElementById('adminAttendanceChart');
        if (!ctx) return;
        if (adminChartInstance) adminChartInstance.destroy();
        if (typeof ChartDataLabels !== 'undefined') { Chart.register(ChartDataLabels); }
    
        adminChartInstance = new Chart(ctx, {
          type: 'bar',
          data: {
              labels: ['Hadir', 'Sakit', 'Izin', 'Alpa', 'Bolos', 'Belum Absen'],
              datasets: [{
                  label: 'Jumlah Siswa',
                  data: [hadir, sakit, izin, alpa, bolos || 0, belum],
                  backgroundColor: ['#10B981', '#EAB308', '#3B82F6', '#EF4444', '#F97316', '#9CA3AF'],
                  borderRadius: 8,
                  barPercentage: 0.5,
              }]
          },                 // ✅ koma ditambahkan
          options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                  legend: { display: false },
                  datalabels: {
                      anchor: 'end',
                      align: 'top',
                      formatter: (val) => val > 0 ? val : '',
                      font: { weight: 'bold' },
                      color: '#666'
                  }
              },
              scales: {
                  y: { beginAtZero: true, grid: { borderDash: [2, 2] } },
                  x: { grid: { display: false } }
              }
          }
      });
    }

    // --- GURU DASHBOARD ---

// ============================================================
// DAFTAR HADIR GURU — Logika JavaScript
// ============================================================
let dhStudents      = [];   // [{nisn, nama, kelas}] list siswa aktif
let dhStatusMap     = {};   // {nisn: 'hadir'|'sakit'|'izin'|'alpa'}
let dhCamStream     = null; // kept for compatibility
let dhScanLoop      = null; // kept for compatibility
let dhLastScan      = 0;
let dhCamActive     = false; // kept for compatibility
let dhTorchOn       = false;
let dhTorchTrack    = null;
let dhCamFacing     = 'environment'; // kept for compatibility
let dhZxingReader   = null; // kept for compatibility
let dhMode          = 'masuk'; // 'masuk' | 'pulang'
let dhPulangMap     = {}; // { nisn: { rowIndex, jamDatang, jamPulang, checked } }
let dhLockedMap     = {}; // { nisn: status } — sudah absen, tidak bisa diubah

// -- Set mode Masuk / Pulang --
function dhSetMode(mode) {
    dhMode = mode;
    const btnMasuk  = document.getElementById('dhModeMasukBtn');
    const btnPulang = document.getElementById('dhModePulangBtn');
    const slider    = document.getElementById('dhModeSlider');
    const hMasuk    = document.getElementById('dhTheadMasuk');
    const hPulang   = document.getElementById('dhTheadPulang');
    const counterLbl= document.getElementById('dhCounterLabel');
    const submitLbl = document.getElementById('dhSubmitLabel');
    const header    = document.getElementById('dhScanCardHeader');
    const camBtn    = document.getElementById('dhCamBtn');
    const title     = document.getElementById('dhScanCardTitle');
    const sub       = document.getElementById('dhScanCardSub');
    const pollTxt   = document.getElementById('dhPollingText');

    if (mode === 'masuk') {
        // Slider
        if (slider) { slider.className = 'dh-mode-slider masuk'; }
        if (btnMasuk)  { btnMasuk.className  = 'dh-mode-btn active'; }
        if (btnPulang) { btnPulang.className = 'dh-mode-btn inactive'; }
        hMasuk.classList.remove('hidden'); hPulang.classList.add('hidden');
        if (counterLbl) counterLbl.textContent = 'Terisi:';
        if (submitLbl)  submitLbl.textContent  = 'Kirim Absensi';
        if (header) header.className = 'bg-gradient-to-r from-purple-600 to-indigo-600 p-4 text-white text-center';
        if (camBtn) { camBtn.className = 'w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-md'; camBtn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Live'; }
        if (title) title.textContent = 'Scan QR Siswa';
        if (sub)   sub.textContent   = 'Scan langsung tandai Hadir';
        if (pollTxt) pollTxt.textContent = 'Kamera aktif — menunggu QR...';
    } else {
        // Slider
        if (slider) { slider.className = 'dh-mode-slider pulang'; }
        if (btnPulang) { btnPulang.className = 'dh-mode-btn active'; }
        if (btnMasuk)  { btnMasuk.className  = 'dh-mode-btn inactive'; }
        hPulang.classList.remove('hidden'); hMasuk.classList.add('hidden');
        if (counterLbl) counterLbl.textContent = 'Dipilih:';
        if (submitLbl)  submitLbl.textContent  = 'Catat Pulang';
        if (header) header.className = 'bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white text-center';
        if (camBtn) { camBtn.className = 'w-full bg-orange-500 hover:bg-orange-600 active:scale-95 text-white py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-md'; camBtn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Pulang'; }
        if (title) title.textContent = 'Scan QR Pulang';
        if (sub)   sub.textContent   = 'Scan langsung catat Jam Pulang';
        if (pollTxt) pollTxt.textContent = 'Kamera aktif — scan QR untuk pulang...';
    }
    onDhKelasChange();
}

// -- Buka halaman --
function loadDaftarHadirGuru() {
    dhStopPopup();
    dhMode = 'masuk';
    setActiveMenu('Daftar Hadir');
    showView('view-daftar-hadir-guru');

    // Reset mode toggle tampilan
    dhSetMode('masuk');

    // Isi tanggal hari ini
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dhTanggal').value = today;

    const sel = document.getElementById('dhKelasSelect');
    sel.innerHTML = '<option value="">-- Pilih Kelas --</option>';

    if (currentUser && currentUser.role === 'admin') {
        // Admin: muat semua kelas dari database
        sel.innerHTML = '<option value="">Memuat kelas...</option>';
        sel.disabled = true;
        callGAS('getKelasList').then(result => {
                sel.disabled = false;
                sel.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
                    '<option value="SEMUA">📋 Semua Kelas</option>';
                const kelasList = (result && result.success && result.data) ? result.data : [];
                kelasList.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k;
                    opt.textContent = k;
                    sel.appendChild(opt);
                });
            }).catch(() => {
                sel.disabled = false;
                sel.innerHTML = '<option value="">-- Gagal memuat kelas --</option>';
            });
    } else {
        // Guru: hanya tampilkan kelas miliknya
        if (currentUser && currentUser.kelas) {
            const kelasList = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);
            kelasList.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                sel.appendChild(opt);
            });
            if (kelasList.length === 1) {
                sel.value = kelasList[0];
                onDhKelasChange();
            }
        }
    }
}

// -- Ketika kelas atau tanggal berubah --
function onDhKelasChange() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas) return;

    dhStudents  = [];
    dhStatusMap = {};
    dhPulangMap = {};
    dhLockedMap = {};
    document.getElementById('dhCounter').textContent = '0 / 0';
    document.getElementById('dhSubmittedBanner').classList.add('hidden');
    dhUpdateSubmitBtn();

    const colspan = dhMode === 'pulang' ? 5 : 3;
    const tbody = document.getElementById('dhSiswaTbody');
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="py-8 text-center text-gray-400"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat siswa...</td></tr>`;

    if (dhMode === 'pulang') {
        // Mode pulang: ambil detail datang+pulang langsung
        if (!tanggal) { tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400">Pilih tanggal.</td></tr>`; return; }
        callGAS('getSiswaByKelas', kelas).then(result => {
                dhStudents = result || [];
                callGAS('getDaftarHadirDetailByKelasAndTanggal', kelas, tanggal).then(res => {
                        dhPulangMap = {};
                        if (res.success && res.data) {
                            Object.entries(res.data).forEach(([nisn, d]) => {
                                dhPulangMap[nisn] = { ...d, checked: false };
                            });
                        }
                        dhRenderPulangTable();
                    }).catch(() => dhRenderPulangTable());
            }).catch(() => {
                tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-400">Gagal memuat data siswa.</td></tr>`;
            });
        return;
    }

    // Mode masuk (default)
    callGAS('getSiswaByKelas', kelas).then(result => {
            dhStudents = result || [];
            dhStatusMap = {};

            if (tanggal) {
                callGAS('getDaftarHadirByKelasAndTanggal', kelas, tanggal).then(res => {
                        dhLockedMap = {};
                        dhStatusMap = {};
                        if (res.success && res.data && Object.keys(res.data).length > 0) {
                            document.getElementById('dhSubmittedBanner').classList.remove('hidden');
                            Object.entries(res.data).forEach(([nisn, d]) => {
                                // Simpan seluruh objek agar bisa tampilkan jam di UI
                                if (d && typeof d === 'object') {
                                    dhLockedMap[nisn] = d; // { status, jamDatang, hasJamDatang }
                                } else {
                                    dhLockedMap[nisn] = { status: d, jamDatang: '', hasJamDatang: true };
                                }
                            });
                        }
                        dhRenderStudentTable();
                    }).catch(() => dhRenderStudentTable());
            } else {
                dhLockedMap = {};
                dhRenderStudentTable();
            }
        }).catch(() => {
            tbody.innerHTML = '<tr><td colspan="3" class="py-8 text-center text-red-400">Gagal memuat data siswa.</td></tr>';
        });
}

// -- Render tabel siswa (hanya menampilkan siswa yang BELUM absen) --
function dhRenderStudentTable() {
    const tbody = document.getElementById('dhSiswaTbody');
    if (!dhStudents || dhStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="py-12 text-center text-gray-400"><i class="fas fa-user-slash mr-2"></i>Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }

    // Siswa yang sudah punya status absen (terkunci) disembunyikan dari daftar manual
    const belumAbsenList = dhStudents.filter(s => !dhLockedMap[s.nisn]);

    if (belumAbsenList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-14 text-center">
            <div class="flex flex-col items-center gap-2">
                <i class="fas fa-circle-check text-4xl text-emerald-300"></i>
                <p class="text-sm font-bold text-emerald-600">Semua siswa sudah absen hari ini</p>
                <p class="text-[10px] text-gray-400">Tidak ada lagi yang perlu diisi manual</p>
            </div>
        </td></tr>`;
        dhUpdateCounter();
        return;
    }

    const statusConfig = {
        hadir: { label: 'Hadir', bg: 'bg-emerald-500', ring: 'ring-emerald-300', text: 'text-emerald-700', rowBg: 'bg-emerald-50' },
        sakit: { label: 'Sakit', bg: 'bg-yellow-400',  ring: 'ring-yellow-200',  text: 'text-yellow-700',  rowBg: 'bg-yellow-50'  },
        izin:  { label: 'Izin',  bg: 'bg-blue-400',    ring: 'ring-blue-200',    text: 'text-blue-700',    rowBg: 'bg-blue-50'    },
        alpa:  { label: 'Alpa',  bg: 'bg-red-400',     ring: 'ring-red-200',     text: 'text-red-700',     rowBg: 'bg-red-50'     },
    };

    tbody.innerHTML = belumAbsenList.map((s, i) => {
        const st   = dhStatusMap[s.nisn] || '';
        const cfg  = statusConfig[st] || null;
        const rowBg = cfg ? cfg.rowBg : '';
        const isLastScan = s.nisn === dhLastScannedNisn;
        const isSemua = document.getElementById('dhKelasSelect').value === 'SEMUA';
        return `
        <tr id="dh-row-${s.nisn}" class="${isLastScan ? 'dh-row-last-scan' : rowBg} border-b border-gray-50 transition-colors duration-500">
          <td class="px-3 py-3 text-center text-xs text-gray-400">${i+1}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full ${cfg ? cfg.bg : 'bg-gray-200'} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                ${cfg ? cfg.label[0] : s.nama.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="font-semibold text-sm text-gray-800">${s.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${s.nisn}${isSemua ? ` <span class="ml-1 bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">${s.kelas}</span>` : ''}</div>
              </div>
            </div>
          </td>
          <td class="px-3 py-3">
            <div class="flex justify-center gap-1 flex-wrap">
               ${['hadir','sakit','izin','alpa'].map(status => {
                 const c = statusConfig[status];
                 const active = st === status;
                 const btnClass = 'px-2 py-1 rounded-lg text-[10px] font-bold transition border ' + (active ? c.bg + ' text-white ring-2 ' + c.ring + ' border-transparent shadow-sm' : 'bg-gray-100 text-gray-500 border-gray-200 hover:border-gray-300');
                 const btnTitle = active ? 'Klik untuk batalkan' : c.label;
                 const btnLabel = active ? '✕ ' + c.label : c.label;
                 return `<button onclick="dhSetStatus('${s.nisn}','${status}')" title="${btnTitle}" class="${btnClass}">${btnLabel}</button>`;
               }).join('')}
            </div>
          </td>
        </tr>`;
    }).join('');

    dhUpdateCounter();
}
  
// -- Set status satu siswa (klik ulang = batalkan) --
function dhSetStatus(nisn, status) {
    if (dhStatusMap[nisn] === status) {
        // Klik status yang sudah aktif → batalkan
        delete dhStatusMap[nisn];
    } else {
        dhStatusMap[nisn] = status;
    }
    dhRenderStudentTable();
    const row = document.getElementById('dh-row-' + nisn);
    if (row) {
        row.classList.add('dh-row-flash');
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => row.classList.remove('dh-row-flash'), 800);
    }
}

// -- Tandai semua hadir --
function dhTandaiSemua() {
    if (dhMode === 'pulang') {
        // Centang semua siswa yang sudah datang tapi belum pulang
        let count = 0;
        dhStudents.forEach(s => {
            const d = dhPulangMap[s.nisn];
            const sudahDatang = d && d.status === 'hadir' && d.jamDatang;
            const sudahPulang = d && d.jamPulang && d.jamPulang.trim() !== '';
            if (sudahDatang && !sudahPulang) {
                dhPulangMap[s.nisn].checked = true;
                count++;
            }
        });
        dhRenderPulangTable();
        if (count === 0) showAlert('error', 'Tidak ada siswa yang bisa ditandai pulang.');
    } else {
        // Tandai semua yang belum terkunci (belum absen)
        dhStudents.forEach(s => { if (!dhLockedMap[s.nisn]) dhStatusMap[s.nisn] = 'hadir'; });
        dhRenderStudentTable();
    }
}

// -- Update counter & tombol kirim --
function dhUpdateCounter() {
    if (dhMode === 'pulang') {
        const checked = Object.values(dhPulangMap).filter(d => d.checked).length;
        document.getElementById('dhCounter').textContent = checked + ' dipilih';
        dhUpdateSubmitBtn();
        return;
    }
    const total   = dhStudents.length;
    const locked  = Object.keys(dhLockedMap).filter(k => dhStudents.find(s => s.nisn === k)).length;
    const filled  = Object.keys(dhStatusMap).filter(k => dhStudents.find(s => s.nisn === k) && !dhLockedMap[k]).length;
    const unset   = total - locked - filled;
    document.getElementById('dhCounter').textContent = filled + ' baru / ' + unset + ' belum (' + locked + ' terkunci)';
    dhUpdateSubmitBtn();
}

function dhUpdateSubmitBtn() {
    const btn = document.getElementById('dhSubmitBtn');
    let enabled = false;
    if (dhMode === 'pulang') {
        enabled = Object.values(dhPulangMap).some(d => d.checked);
    } else {
        enabled = Object.keys(dhStatusMap).filter(k => dhStudents.find(s => s.nisn === k) && !dhLockedMap[k]).length > 0;
    }

    btn.disabled = !enabled;
    btn.className = 'px-6 py-3 rounded-xl font-bold text-sm transition flex items-center gap-2 w-full sm:w-auto justify-center flex-shrink-0';

    if (enabled) {
        btn.style.backgroundColor = '#16a34a'; // hijau
        btn.style.color = '#ffffff';           // teks putih
        btn.style.cursor = 'pointer';
        btn.style.opacity = '1';
    } else {
        btn.style.backgroundColor = '#e5e7eb'; // abu-abu
        btn.style.color = '#9ca3af';
        btn.style.cursor = 'not-allowed';
        btn.style.opacity = '1';
    }
}

// -- Render tabel pulang --
function dhRenderPulangTable() {
    const tbody = document.getElementById('dhSiswaTbody');
    if (!dhStudents || dhStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-gray-400"><i class="fas fa-user-slash mr-2"></i>Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }
    tbody.innerHTML = dhStudents.map((s, i) => {
        const d = dhPulangMap[s.nisn];
        const sudahDatang  = d && d.status === 'hadir' && d.jamDatang;
        const sudahPulang  = d && d.jamPulang && d.jamPulang.trim() !== '';
        const checked      = d && d.checked;
        const jamDatangTxt = d && d.jamDatang ? d.jamDatang : '-';
        const jamPulangTxt = sudahPulang ? d.jamPulang : '-';
        const rowBg        = sudahPulang ? 'bg-green-50' : (sudahDatang ? 'bg-orange-50' : '');
        const isSemua = document.getElementById('dhKelasSelect').value === 'SEMUA';
        return `
        <tr id="dhp-row-${s.nisn}" class="${rowBg} border-b border-gray-50 transition-colors duration-300">
          <td class="px-3 py-3 text-center text-xs text-gray-400">${i+1}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full ${sudahPulang ? 'bg-green-500' : sudahDatang ? 'bg-orange-400' : 'bg-gray-200'} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                ${s.nama.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="font-semibold text-sm text-gray-800">${s.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${s.nisn}${isSemua ? ` <span class="ml-1 bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold">${s.kelas}</span>` : ''}</div>
              </div>
            </div>
          </td>
          <td class="px-3 py-3 text-center text-xs font-bold ${sudahDatang ? 'text-indigo-600' : 'text-gray-300'}">${jamDatangTxt}</td>
          <td class="px-3 py-3 text-center text-xs font-bold ${sudahPulang ? 'text-green-600' : 'text-gray-300'}">${jamPulangTxt}</td>
          <td class="px-3 py-3 text-center">
            ${sudahPulang
              ? '<span class="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-1 rounded-lg"><i class="fas fa-check mr-1"></i>Sudah Pulang</span>'
              : sudahDatang
                ? `<label class="flex items-center justify-center gap-1.5 cursor-pointer">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="dhTogglePulang('${s.nisn}', this.checked)"
                      class="w-4 h-4 accent-orange-500 cursor-pointer">
                    <span class="text-xs font-bold text-gray-600">Tandai Pulang</span>
                  </label>`
                : '<span class="text-[10px] text-gray-300 italic">Belum Absen Masuk</span>'
            }
          </td>
        </tr>`;
    }).join('');
    dhUpdateCounter();
}

function dhTogglePulang(nisn, checked) {
    if (dhPulangMap[nisn]) {
        dhPulangMap[nisn].checked = checked;
    } else {
        dhPulangMap[nisn] = { checked };
    }
    dhUpdateCounter();
}

// -- Dispatch submit sesuai mode --
function dhHandleSubmit() {
    if (dhMode === 'pulang') {
        submitPulang();
    } else {
        submitDaftarHadir();
    }
}

// -- Kirim pulang ke server --
function submitPulang() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas || !tanggal) { showAlert('error', 'Pilih kelas dan tanggal.'); return; }

    const pulangList = Object.entries(dhPulangMap)
        .filter(([, d]) => d.checked && d.rowIndex)
        .map(([nisn, d]) => ({ nisn, rowIndex: d.rowIndex }));

    if (pulangList.length === 0) { showAlert('error', 'Belum ada siswa yang dipilih untuk pulang.'); return; }

    const kelasLabelPulang = kelas === 'SEMUA' ? 'Semua Kelas' : kelas;
    Swal.fire({
        title: 'Catat Pulang?',
        html: `<p class="text-gray-500 text-sm">Kelas: <b>${kelasLabelPulang}</b> &bull; Tanggal: <b>${tanggal}</b></p>
               <p class="mt-2 text-sm"><b>${pulangList.length}</b> siswa akan dicatat pulang sekarang.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#f97316',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '&#10003; Ya, Catat',
        cancelButtonText: 'Batal'
    }).then(res => {
        if (!res.isConfirmed) return;
        showLoading();
        callGAS('submitPulangGuru', pulangList, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru').then(result => {
                hideLoading();
                if (result.success) {
                    Swal.fire({ icon: 'success', title: 'Berhasil!', text: result.message, timer: 2000, showConfirmButton: false });
                    onDhKelasChange(); // refresh
                } else {
                    Swal.fire('Gagal', result.message, 'error');
                }
            }).catch(err => {
                hideLoading();
                Swal.fire('Error', String(err), 'error');
            });
    });
}

// -- Kirim ke server --
function submitDaftarHadir() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas || !tanggal) { showAlert('error', 'Pilih kelas dan tanggal terlebih dahulu.'); return; }

    // Hanya kirim siswa yang belum pernah absen (tidak terkunci)
    const dataList = dhStudents
        .filter(s => dhStatusMap[s.nisn] && !dhLockedMap[s.nisn])
        .map(s => ({ nisn: s.nisn, nama: s.nama, kelas: s.kelas, status: dhStatusMap[s.nisn] }));

    if (dataList.length === 0) { showAlert('error', 'Belum ada siswa yang diisi statusnya.'); return; }

    const kelasLabel = kelas === 'SEMUA' ? 'Semua Kelas' : kelas;
    const hadir = dataList.filter(d => d.status === 'hadir').length;
    const lain  = dataList.length - hadir;

    Swal.fire({
        title: 'Kirim Absensi?',
        html: `<p class="text-gray-500 text-sm">Kelas: <b>${kelasLabel}</b> &bull; Tanggal: <b>${tanggal}</b></p>
               <div class="flex justify-center gap-4 mt-3 text-sm">
                 <span class="text-emerald-600 font-bold">${hadir} Hadir</span>
                 <span class="text-yellow-600 font-bold">${lain} Lainnya</span>
               </div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '&#10003; Ya, Kirim',
        cancelButtonText: 'Batal'
    }).then(res => {
        if (!res.isConfirmed) return;
        showLoading();
        callGAS('submitDaftarHadirGuru', dataList, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru').then(result => {
                hideLoading();
                if (result.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Absensi Tersimpan!',
                        text: result.message,
                        timer: 2000,
                        showConfirmButton: false
                    });
                    // Refresh tabel agar banner "sudah dikirim" muncul
                    onDhKelasChange();
                } else {
                    Swal.fire('Gagal', result.message, 'error');
                }
            }).catch(err => {
                hideLoading();
                Swal.fire('Error Server', err.message || String(err), 'error');
            });
    });
}

// ---- KAMERA POPUP (Daftar Hadir Guru) ----
let dhCameraPopup     = null;
let dhPollingInterval = null;
const DH_LS_KEY       = 'dh_qr_result';

// Listener postMessage dari popup kamera DH
window.addEventListener('message', function(event) {
    if (!event.data || event.data.type !== 'DH_QR_SCAN_RESULT') return;
    const nisn = event.data.nisn;
    if (!nisn || typeof nisn !== 'string') return;
    if (event.data.ts && (Date.now() - event.data.ts) > 30000) return;
    dhOnScanResult(nisn);
    // Kirim feedback ke popup
    if (dhCameraPopup && !dhCameraPopup.closed) {
        const siswa = dhStudents.find(s => s.nisn === String(nisn).replace(/[^a-zA-Z0-9]/g,'').trim());
        if (siswa) {
            try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: siswa.nama }, '*'); } catch(e) {}
        } else {
            try { dhCameraPopup.postMessage({ type: 'DH_SCAN_ERROR', message: 'NISN tidak ada di kelas ini' }, '*'); } catch(e) {}
        }
    }
});

function dhStopPolling() {
    if (dhPollingInterval) { clearInterval(dhPollingInterval); dhPollingInterval = null; }
    const ps = document.getElementById('dhPollingStatus');
    if (ps) ps.classList.add('hidden');
    const btn = document.getElementById('dhCamBtn');
    if (btn) {
        btn.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Live';
    }
}

function dhStartPolling() {
    dhStopPolling();
    try { localStorage.removeItem(DH_LS_KEY); } catch(e) {}
    const ps = document.getElementById('dhPollingStatus');
    if (ps) ps.classList.remove('hidden');
    const btn = document.getElementById('dhCamBtn');
    if (btn) btn.classList.add('hidden');

    dhPollingInterval = setInterval(() => {
        if (dhCameraPopup && dhCameraPopup.closed) {
            dhCameraPopup = null;
            dhStopPolling();
            return;
        }
        try {
            const raw = localStorage.getItem(DH_LS_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (Date.now() - data.ts > 30000) { localStorage.removeItem(DH_LS_KEY); return; }
            localStorage.removeItem(DH_LS_KEY);
            dhOnScanResult(data.nisn);
        } catch(e) {}
    }, 300);
}

function dhStopPopup() {
    closeInlineScanner();
    dhStopPolling();
}

function dhOpenCameraPopup() {
    const kelas = document.getElementById('dhKelasSelect')?.value;
    if (!kelas) {
        showAlert('error', 'Pilih kelas terlebih dahulu sebelum membuka kamera.');
        return;
    }
    openInlineScanner({
        title: dhMode === 'pulang' ? '&#128247; SCAN QR PULANG' : '&#128247; SCAN QR — DAFTAR HADIR',
        onDetect: (text) => { dhOnScanResult(String(text).replace(/[^a-zA-Z0-9]/g,'').trim()); }
    });
}


// Fungsi lama (stub agar tidak error jika masih dipanggil)
function dhToggleCamera() { dhOpenCameraPopup(); }
function dhStartCamera()  {}
function dhStopCamera()   { dhStopPopup(); }
function dhSwitchCam()    {}
function dhToggleTorch()  {}

// dhBeginScan tidak lagi digunakan (diganti sistem popup)
function dhBeginScan(video, canvas) {}

// dhOnDetected tidak lagi digunakan (kamera sudah di popup), tapi tetap ada sebagai stub
function dhOnDetected(text) {
    if (!text || (Date.now() - dhLastScan) < 1500) return;
    dhLastScan = Date.now();
    dhOnScanResult(text.trim());
}

// -- Suara notifikasi scan --
function dhPlayBeep(type = 'success') {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (type === 'success') {
            // Dua nada naik: bip bip ✅
            [0, 0.15].forEach((delay, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(i === 0 ? 880 : 1100, ctx.currentTime + delay);
                gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.18);
            });
        } else {
            // Satu nada rendah pendek: bup ❌
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            gain.gain.setValueAtTime(0.35, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.25);
        }
    } catch(e) { /* AudioContext tidak didukung, abaikan */ }
}

var dhLastScannedNisn = null;
let dhPendingBatch = [];
let dhBatchTimer = null;
const DH_BATCH_INTERVAL = 1500;

function dhQueueScanForBatch(item) {
    dhPendingBatch.push(item);
    if (!dhBatchTimer) dhBatchTimer = setTimeout(dhFlushBatch, DH_BATCH_INTERVAL);
}

function dhFlushBatch() {
    dhBatchTimer = null;
    if (dhPendingBatch.length === 0) return;
    const batch = dhPendingBatch;
    dhPendingBatch = [];
    const tanggalScan = document.getElementById('dhTanggal').value;
    callGASOffline('submitDaftarHadirGuru', batch, tanggalScan,
        currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru')
        .catch(err => console.warn('Batch gagal:', err));
}
window.addEventListener('beforeunload', dhFlushBatch);
var dhLastScannedNisn = null;

function dhOnScanResult(rawNisn) {
    const nisn = String(rawNisn).replace(/[^a-zA-Z0-9]/g,'').trim();
    const notif = document.getElementById('dhScanNotif');

    // Cari siswa di daftar
    const siswa = dhStudents.find(s => s.nisn === nisn);
    if (!siswa) {
        dhPlayBeep('error');
        showBigScanPopup({ type: 'error', customMsg: 'NISN [' + nisn + '] tidak ada di kelas ini' });
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
        notif.textContent = '❌ NISN [' + nisn + '] tidak ada di kelas ini';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 3000);
        return;
    }

    // ── Mode Pulang ──
    if (dhMode === 'pulang') {
        dhOnPulangResult(nisn, siswa.nama);
        return;
    }

    // ── Mode Masuk ──
    if (dhLockedMap[nisn]) {
        dhPlayBeep('success');
        const lockedObj = dhLockedMap[nisn];
        const st = (lockedObj && typeof lockedObj === 'object') ? lockedObj.status : String(lockedObj);
        showBigScanPopup({ type: 'success', nama: siswa.nama, mode: 'masuk', id: nisn, customMsg: 'Sudah absen (' + st + ')' });
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
        notif.textContent = '✅ ' + siswa.nama + ' — sudah tercatat (' + st.charAt(0).toUpperCase() + st.slice(1) + ')';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        return;
    }
dhLastScannedNisn = nisn;
dhPlayBeep('success');
showBigScanPopup({ type: 'success', nama: siswa.nama, mode: 'masuk' });

const now = new Date();
const jamNow = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
dhLockedMap[nisn] = { status: 'hadir', jamDatang: jamNow, hasJamDatang: true };
delete dhStatusMap[nisn];
dhRenderStudentTable();

notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
notif.textContent = '✅ ' + siswa.nama + ' — Hadir tersimpan';
notif.classList.remove('hidden');
setTimeout(() => notif.classList.add('hidden'), 1500);

const kelasSiswaScan = siswa.kelas || document.getElementById('dhKelasSelect').value;
dhQueueScanForBatch({ nisn: siswa.nisn, nama: siswa.nama, kelas: kelasSiswaScan, status: 'hadir' });
  

    callGASOffline('submitDaftarHadirGuru', [{ nisn: siswa.nisn, nama: siswa.nama, kelas: kelasSiswaScan, status: 'hadir' }], tanggalScan, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru')
        .then(res => {
            if (res && res.success) {
                const now = new Date();
                const jamNow = res.offline ? 'Offline' : now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                dhLockedMap[nisn] = { status: 'hadir', jamDatang: jamNow, hasJamDatang: true };
                delete dhStatusMap[nisn];
                dhRenderStudentTable();
                if (res.offline) {
                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-amber-50 text-amber-700 border border-amber-100';
                    notif.textContent = '📥 ' + siswa.nama + ' — tersimpan offline';
                } else {
                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
                    notif.textContent = '✅ ' + siswa.nama + ' — Hadir tersimpan';
                }
            } else {
                notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
                notif.textContent = '❌ ' + (res && res.message ? res.message : 'Gagal menyimpan absensi');
            }
            notif.classList.remove('hidden');
            setTimeout(() => notif.classList.add('hidden'), 2000);
        })
        .catch(err => {
            notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
            notif.textContent = '❌ Error: ' + String(err);
            notif.classList.remove('hidden');
            setTimeout(() => notif.classList.add('hidden'), 3000);
        });

    const row = document.getElementById('dh-row-' + nisn);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// -- Handler scan pulang (OPTIMISTIC: feedback instan, kirim ke server di background) --
function dhOnPulangResult(nisn, nama) {
    const notif  = document.getElementById('dhScanNotif');
    const kelasDropdown = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;

    if (!kelasDropdown || !tanggal) {
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-yellow-50 text-yellow-700 border border-yellow-100';
        notif.textContent = '⚠️ Pilih kelas dan tanggal terlebih dahulu';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        return;
    }

    // Gunakan kelas aktual siswa jika mode Semua Kelas
    const siswaData = dhStudents.find(s => s.nisn === nisn);
    const kelas = (kelasDropdown === 'SEMUA' && siswaData) ? siswaData.kelas : kelasDropdown;

    const d = dhPulangMap[nisn];

    // 1. Cek dulu di data lokal — kalau sudah pulang, langsung kasih tahu tanpa hit server
    if (d && d.jamPulang && d.jamPulang.trim()) {
        dhPlayBeep('success');
        showBigScanPopup({ type: 'success', nama: nama, mode: 'pulang', id: nisn, customMsg: 'Sudah pulang (' + d.jamPulang + ')' });
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
        notif.textContent = '✅ ' + (nama || nisn) + ' — sudah tercatat pulang (' + d.jamPulang + ')';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        return;
    }

    // 2. Belum pulang di data lokal → cek juga apakah sudah datang (wajib sebelum bisa pulang)
    const sudahDatang = d && d.status === 'hadir' && d.jamDatang;
    if (!sudahDatang) {
        dhPlayBeep('error');
        showBigScanPopup({ type: 'error', nama: nama, customMsg: 'Belum absen masuk hari ini' });
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
        notif.textContent = '❌ ' + (nama || nisn) + ' — belum absen masuk hari ini';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 3000);
        return;
    }

    // 3. OPTIMISTIC UPDATE — langsung tampilkan sukses pakai jam lokal, tanpa menunggu server
    const now = new Date();
    const jamLokal = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    dhPulangMap[nisn] = {
        ...(dhPulangMap[nisn] || {}),
        jamPulang: jamLokal,
        checked: false,
        _pending: true // tandai belum terkonfirmasi server
    };
    dhRenderPulangTable();

    dhPlayBeep('success');
    showBigScanPopup({ type: 'success', nama: nama, mode: 'pulang' });
    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
    notif.textContent = '✅ ' + nama + ' pulang — ' + jamLokal;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 2000);

    if (dhCameraPopup && !dhCameraPopup.closed) {
        try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: nama + ' pulang' }, '*'); } catch (e) {}
    }

    // 4. Kirim ke server DI BELAKANG LAYAR — tidak memblokir scan berikutnya
    callGASOffline('submitPulangSatu', nisn, kelas, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru')
        .then(res => {
            if (res.offline) {
                // Tetap tersimpan optimis, akan disinkronkan otomatis nanti
                if (dhPulangMap[nisn]) dhPulangMap[nisn]._pending = true;
                return;
            }
            if (res.success) {
                // Konfirmasi dari server — samakan jam persis dengan catatan server
                if (dhPulangMap[nisn]) {
                    dhPulangMap[nisn].jamPulang = res.jamPulang;
                    dhPulangMap[nisn]._pending = false;
                }
                dhRenderPulangTable();
            } else {
                // Gagal karena alasan lain (bukan offline) — beri tahu & batalkan optimistic update
                if (dhPulangMap[nisn]) {
                    delete dhPulangMap[nisn].jamPulang;
                    dhPulangMap[nisn]._pending = false;
                }
                dhRenderPulangTable();
                showAlert('error', (nama || nisn) + ': ' + res.message);
                if (dhCameraPopup && !dhCameraPopup.closed) {
                    try { dhCameraPopup.postMessage({ type: 'DH_SCAN_ERROR', message: res.message }, '*'); } catch (e) {}
                }
            }
        })
        .catch(err => {
            // Error jaringan tak terduga — callGASOffline seharusnya sudah menangani ini,
            // tapi tetap jaga-jaga: biarkan data optimistic tersimpan agar tidak hilang
            console.warn('[dhOnPulangResult] unexpected error:', err);
        });
}

// -- Input NISN Manual --
function dhSubmitManual() {
    const inp = document.getElementById('dhManualNisn');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) { showAlert('error', 'Masukkan NISN terlebih dahulu.'); return; }
    inp.value = '';
    dhOnScanResult(val);
}


function loadGuruDashboard() {
    stopAndBack(false);
    setActiveMenu('Dashboard');
    showView('view-admin-dashboard'); // reuse tampilan admin yang sudah ada elemennya

    document.getElementById('adminDateDisplay').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Guru tidak butuh Quick Access & judul beda
    const quickAccessPanel = document.getElementById('adminQuickAccess');
    if (quickAccessPanel) quickAccessPanel.style.display = 'none';
    const dashboardTitle = document.querySelector('#view-admin-dashboard h2');

    const myClass = currentUser.kelas;
    const kelasLabel = myClass
        ? String(myClass).split(',').map(k => k.trim()).filter(Boolean).join(', ')
        : null;
    if (dashboardTitle) dashboardTitle.textContent = kelasLabel ? `Dashboard Guru (${kelasLabel})` : 'Dashboard Guru';

    callGAS('getMonitoringRealtime', myClass).then(result => {
        if (result.success) {
            const data = result.data;
            const total = data.length;
            const hadir = data.filter(d => d.status === 'Hadir').length;
            const sakit = data.filter(d => d.status === 'Sakit').length;
            const izin = data.filter(d => d.status === 'Izin').length;
            const alpa = data.filter(d => d.status === 'Alpa').length;
            const belum = data.filter(d => d.status === 'Belum Absen').length;

            animateValue("admStatTotal", 0, total, 800);
            animateValue("admStatHadir", 0, hadir, 800);
            animateValue("admStatSakit", 0, sakit, 800);
            animateValue("admStatIzin", 0, izin, 800);
            animateValue("admStatAlpa", 0, alpa, 800);

            renderAdminChart(hadir, sakit, izin, alpa, belum);
        }
    }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));

    // Sembunyikan bagian rekap guru (tidak relevan untuk guru biasa)
    const guruSection = document.querySelector('#view-admin-dashboard .bg-white.rounded-2xl.border.border-amber-100');
    if (guruSection && guruSection.closest('#view-admin-dashboard')) {
        // biarkan tampil atau sembunyikan sesuai selera; contoh: sembunyikan
        guruSection.style.display = 'none';
    }
}

    // Helper: Animasi Angka (Counter Up)
    function animateValue(id, start, end, duration) {
        const obj = document.getElementById(id);
        if(!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    // --- SISWA DASHBOARD (DENGAN CEK LIBUR) ---
    function loadSiswaDashboard() {
        stopAndBack(false);
        setActiveMenu('Dashboard');
        showView('view-siswa-dashboard');
        showLoading();

        try {
            const safeSetText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            if (currentUser) {
                const firstName = currentUser.nama ? currentUser.nama.split(' ')[0] : 'Siswa';
                safeSetText('dashGreeting', firstName);
                safeSetText('profileNameSidebar', currentUser.nama);
                safeSetText('profileNisnSidebar', currentUser.nisn);
                safeSetText('profileKelasSidebar', currentUser.kelas);
            }
            const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            safeSetText('dashDate', today);
        } catch (e) {}

        callGAS('getAbsensiToday', currentUser.nisn).then(result => {
            hideLoading();
            try {
                const absensi = result && result.success ? result.data : null;
                const isLibur = result.isLibur; // Status libur dari server
                const infoLibur = result.keteranganLibur;

                const elHero = document.getElementById('heroCard');
                const elBadge = document.getElementById('dashStatusBadge');
                const elValMasuk = document.getElementById('valMasuk');
                const elValPulang = document.getElementById('valPulang');
                const elAlert = document.getElementById('alertBelumAbsen');

                // 1. MODE HARI LIBUR
                if (isLibur) {
                    if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-600 to-red-800 p-6 text-white shadow-xl shadow-rose-200 transition-all duration-500 group";
                    
                    if (elBadge) {
                        elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                        elBadge.innerHTML = `<i class="fas fa-calendar-times mr-2"></i> HARI LIBUR`;
                    }
                    
                    if (elValMasuk) {
                        elValMasuk.parentElement.innerHTML = `
                            <div class="text-center py-2">
                                <i class="fas fa-mug-hot text-3xl mb-2 opacity-80"></i>
                                <p class="text-sm font-bold uppercase tracking-widest">${infoLibur}</p>
                                <p class="text-[10px] mt-1 opacity-75">Tidak ada absensi hari ini</p>
                            </div>
                        `;
                        if(elValPulang) elValPulang.parentElement.style.display = 'none';
                        if(elValMasuk) elValMasuk.parentElement.classList.add('col-span-2');
                    }

                    if (elAlert) { elAlert.classList.add('hidden'); elAlert.classList.remove('flex'); }
                    return; 
                }

                // 2. MODE NORMAL (TIDAK LIBUR)
                // (Note: Idealnya kita reset style elValMasuk di sini jika aplikasi SPA kompleks)
                
                if (!absensi) {
                    if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-slate-800 p-6 text-white shadow-xl shadow-slate-200 transition-all duration-500 group";
                    if (elBadge) {
                        elBadge.className = "px-4 py-2 rounded-xl bg-rose-500/20 backdrop-blur-md border border-rose-500/30 text-rose-200 text-xs font-bold shadow-sm animate-pulse";
                        elBadge.innerHTML = `<i class="fas fa-circle text-[8px] mr-2"></i> BELUM ABSEN`;
                    }
                    if (elValMasuk) elValMasuk.textContent = "--:--";
                    if (elValPulang) elValPulang.textContent = "--:--";
                    if (elAlert) { elAlert.classList.remove('hidden'); elAlert.classList.add('flex'); }
                } else if (absensi.status === 'Alpa') {
                    if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-700 to-red-900 p-6 text-white shadow-xl shadow-rose-200 transition-all duration-500 group";
                    if (elBadge) {
                        elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                        elBadge.innerHTML = `<i class="fas fa-times-circle mr-2"></i> ALPA HARI INI`;
                    }
                    if (elValMasuk) elValMasuk.textContent = "--:--";
                    if (elValPulang) elValPulang.textContent = "--:--";
                    if (elAlert) { elAlert.classList.add('hidden'); elAlert.classList.remove('flex'); }
                } else {
                    if (elAlert) { elAlert.classList.add('hidden'); elAlert.classList.remove('flex'); }
                    if (elValMasuk) elValMasuk.textContent = absensi.jamDatang || "--:--";
                    
                    if (!absensi.jamPulang) {
                        if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-800 p-6 text-white shadow-xl shadow-emerald-200 transition-all duration-500 group";
                        if (elBadge) {
                            elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                            elBadge.innerHTML = `<i class="fas fa-clock animate-pulse mr-2"></i> SEDANG BERLANGSUNG`;
                        }
                        if (elValPulang) elValPulang.textContent = "--:--";
                    } else {
                        if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-800 p-6 text-white shadow-xl shadow-indigo-200 transition-all duration-500 group";
                        if (elBadge) {
                            elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                            elBadge.innerHTML = `<i class="fas fa-check-circle mr-2"></i> SELESAI HARI INI`;
                        }
                        if (elValPulang) elValPulang.textContent = absensi.jamPulang;
                    }
                }
            } catch (err) { console.error("Error rendering dashboard:", err); }
        }).catch(error => { hideLoading(); });
    }

    // --- KELOLA HARI LIBUR (ADMIN) ---
// --- KELOLA WAKTU & HARI LIBUR (ADMIN) ---

// ====================================================
// MANAJEMEN KELAS
// ====================================================
let mkAllKelas = []; // cache semua kelas

function loadManajemenKelas() {
    setActiveMenu('Manajemen Kelas');
    showView('view-manajemen-kelas');
    mkLoadKelas();
}

function mkLoadKelas() {
    const list = document.getElementById('mkKelasList');
    list.innerHTML = '<div class="text-center py-10 text-gray-400"><i class="fas fa-circle-notch fa-spin text-2xl mb-3 block"></i><p class="text-sm">Memuat data kelas...</p></div>';
    document.getElementById('mkTotalKelas').textContent = '—';
    document.getElementById('mkTotalSiswa').textContent = '— siswa terdaftar';

    callGAS('getKelasMaster').then(res => {
            if (!res.success) { mkShowListError(res.message); return; }
            mkAllKelas = res.data || [];
            mkRenderList(mkAllKelas);
            document.getElementById('mkTotalKelas').textContent = mkAllKelas.length;
        }).catch(err => mkShowListError(String(err)));

    // Count siswa per kelas
    callGAS('getSiswaList', null).then(res => {
            if (res && res.success && res.data) {
                const total = res.data.length;
                document.getElementById('mkTotalSiswa').textContent = total + ' siswa terdaftar';
            }
        }).catch(() => {});
}

function mkShowListError(msg) {
    document.getElementById('mkKelasList').innerHTML =
        `<div class="text-center py-10 text-red-400"><i class="fas fa-exclamation-circle text-2xl mb-2 block"></i><p class="text-sm">${msg}</p></div>`;
}

function mkFilterKelas() {
    const q = document.getElementById('mkSearchKelas').value.trim().toLowerCase();
    const filtered = q ? mkAllKelas.filter(k => k.nama.toLowerCase().includes(q)) : mkAllKelas;
    mkRenderList(filtered);
}

function mkRenderList(kelasList) {
    const list = document.getElementById('mkKelasList');
    if (!kelasList || kelasList.length === 0) {
        list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-inbox text-3xl mb-3 block opacity-40"></i><p class="text-sm font-semibold">Belum ada kelas terdaftar</p><p class="text-xs mt-1">Tambahkan kelas baru menggunakan form di sebelah kiri.</p></div>';
        return;
    }
    list.innerHTML = kelasList.map((k, i) => {
        const initials = k.nama.substring(0, 2).toUpperCase();
        return `
        <div class="kelas-card" id="kelas-card-${k.rowIndex}">
          <div class="kelas-avatar">${initials}</div>
          <div class="flex-1 min-w-0">
            <div id="kelas-label-${k.rowIndex}" class="font-bold text-sm text-gray-800">${k.nama}</div>
            <input id="kelas-input-${k.rowIndex}" type="text" value="${k.nama}"
              class="kelas-input-edit hidden"
              onkeydown="if(event.key==='Enter') mkSimpanEdit(${k.rowIndex}); if(event.key==='Escape') mkBatalEdit(${k.rowIndex});">
            <div class="text-[10px] text-gray-400 mt-0.5">Kelas ke-${i + 1}</div>
          </div>
          <div class="flex items-center gap-1.5" id="kelas-actions-${k.rowIndex}">
            <button onclick="mkMulaiEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition text-sm" title="Edit">
              <i class="fas fa-pen text-xs"></i>
            </button>
            <button onclick="mkHapusKelas(${k.rowIndex}, '${k.nama.replace(/'/g, "\'")}')"
              class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition text-sm" title="Hapus">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
          <div class="hidden items-center gap-1.5" id="kelas-edit-actions-${k.rowIndex}">
            <button onclick="mkSimpanEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-green-500 hover:bg-green-600 text-white flex items-center justify-center transition" title="Simpan">
              <i class="fas fa-check text-xs"></i>
            </button>
            <button onclick="mkBatalEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center transition" title="Batal">
              <i class="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>`;
    }).join('');
}

function mkMulaiEdit(rowIndex) {
    document.getElementById('kelas-label-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-input-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-actions-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.add('flex');
    const inp = document.getElementById('kelas-input-' + rowIndex);
    inp.focus(); inp.select();
}

function mkBatalEdit(rowIndex) {
    const k = mkAllKelas.find(x => x.rowIndex === rowIndex);
    if (k) document.getElementById('kelas-input-' + rowIndex).value = k.nama;
    document.getElementById('kelas-label-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-input-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-actions-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.remove('flex');
}

function mkSimpanEdit(rowIndex) {
    const namaBaru = document.getElementById('kelas-input-' + rowIndex).value.trim();
    if (!namaBaru) { showAlert('error', 'Nama kelas tidak boleh kosong.'); return; }
    showLoading();
    callGAS('updateKelas', rowIndex, namaBaru).then(res => {
            hideLoading();
            if (res.success) {
                showAlert('success', res.message);
                mkLoadKelas();
            } else {
                showAlert('error', res.message);
                mkBatalEdit(rowIndex);
            }
        }).catch(err => { hideLoading(); showAlert('error', String(err)); mkBatalEdit(rowIndex); });
}

function mkHapusKelas(rowIndex, namaKelas) {
    Swal.fire({
        title: 'Hapus Kelas?',
        html: `<p class="text-gray-600 text-sm">Kelas <b>${namaKelas}</b> akan dihapus dari sistem.<br><span class="text-red-500 text-xs">Kelas tidak bisa dihapus jika masih ada siswa terdaftar.</span></p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Ya, Hapus',
        cancelButtonText: 'Batal'
    }).then(r => {
        if (!r.isConfirmed) return;
        showLoading();
        callGAS('deleteKelas', rowIndex, namaKelas).then(res => {
                hideLoading();
                if (res.success) { showAlert('success', res.message); mkLoadKelas(); }
                else Swal.fire('Gagal', res.message, 'error');
            }).catch(err => { hideLoading(); showAlert('error', String(err)); });
    });
}

function mkTambahKelas() {
    const inp = document.getElementById('inputNamaKelas');
    const nama = inp.value.trim();
    if (!nama) { inp.focus(); showAlert('error', 'Masukkan nama kelas terlebih dahulu.'); return; }
    const btn = document.getElementById('btnTambahKelas');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';
    callGAS('addKelas', nama).then(res => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Tambah Kelas';
            if (res.success) {
                showAlert('success', res.message);
                inp.value = '';
                mkLoadKelas();
            } else {
                showAlert('error', res.message);
            }
        }).catch(err => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Tambah Kelas';
            showAlert('error', String(err));
        });
}

    function loadKelolaAbsen() {
        stopAndBack(false);
        setActiveMenu('Kelola Absen');
        showView('view-kelola-absen');
        
        // 1. Load Data Hari Libur (Seperti Biasa)
        document.getElementById('tbody-libur').innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';
        
        callGAS('getHariLibur').then(result => {
            if (result.success) {
                tableState.libur.fullData = result.data;
                processTableData('libur');
            } else {
                document.getElementById('tbody-libur').innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Gagal memuat data.</td></tr>';
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));

        // 2. Load Data Konfigurasi Jam (BARU)
        loadGlobalConfig();
    }

    // ---- Data jadwal harian (state lokal) ----
    const HARI_NAMES = { '1':'Senin', '2':'Selasa', '3':'Rabu', '4':'Kamis', '5':'Jumat', '6':'Sabtu', '7':'Minggu' };
    const HARI_COLORS = { '1':'indigo', '2':'indigo', '3':'indigo', '4':'indigo', '5':'indigo', '6':'orange', '7':'red' };
    let _jadwalHarian = null;

    function renderJadwalHarian(jadwal) {
        _jadwalHarian = jadwal;
        const container = document.getElementById('jadwal-hari-container');
        if (!container) return;
        let html = '';
        for (let d = 1; d <= 7; d++) {
            const key = String(d);
            const hari = jadwal[key] || { libur: d===7, libur_rutinan: true, masuk_mulai:'06:00', masuk_akhir:'07:15', pulang_mulai:'15:00', pulang_akhir:'17:00', ket_libur:'' };
            const isLibur = !!hari.libur;
            // Default rutinan: jika libur_rutinan undefined (data lama), anggap rutinan=true
            const isRutinan = hari.libur_rutinan !== false;
            const ketLibur = hari.ket_libur || '';
            const col = HARI_COLORS[key];
            const colClass = isLibur ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
            const badgeClass = isLibur
                ? (isRutinan ? 'bg-purple-100 text-purple-600' : 'bg-red-100 text-red-600')
                : 'bg-green-100 text-green-700';
            const badgeText = isLibur
                ? (isRutinan ? '<i class=\"fas fa-redo mr-1\"></i>Libur Rutin' : '<i class=\"fas fa-star mr-1\"></i>Libur Khusus')
                : '<i class=\"fas fa-check-circle mr-1\"></i>Masuk';
            html += `
            <div class="rounded-lg border ${colClass} overflow-hidden" id="card-hari-${key}">
              <div class="flex items-center justify-between px-3 py-2 cursor-pointer" onclick="toggleHariExpand('${key}')">
                <span class="text-xs font-bold text-gray-700 flex items-center gap-2">
                  <i class="fas fa-calendar-day text-${col}-500 w-4"></i> ${HARI_NAMES[key]}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}" id="badge-${key}">${badgeText}</span>
                  <label class="relative inline-flex items-center cursor-pointer" onclick="event.stopPropagation()">
                    <input type="checkbox" class="sr-only peer" id="toggle-libur-${key}" ${isLibur ? '' : 'checked'}
                      onchange="onToggleMasuk('${key}', this.checked)">
                    <div class="w-9 h-5 bg-red-300 peer-checked:bg-green-400 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>
              </div>
              <div id="ket-libur-wrap-${key}" class="${isLibur ? '' : 'hidden'} px-3 pb-2 pt-2 border-t border-red-100">
                <p class="text-[9px] uppercase font-bold text-red-400 mb-1.5"><i class="fas fa-tag mr-1"></i>Jenis Libur</p>
                <div class="flex gap-2 mb-1.5">
                  <label class="flex-1 flex items-center gap-1.5 cursor-pointer rounded-lg border px-2 py-1.5 text-[11px] font-semibold
                    ${isRutinan ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}"
                    id="label-rutinan-${key}" onclick="event.stopPropagation()">
                    <input type="radio" name="jenis-libur-${key}" id="radio-rutinan-${key}" value="rutinan"
                      ${isRutinan ? 'checked' : ''} onchange="onJenisLiburChange('${key}','rutinan')" class="accent-purple-500">
                    <i class="fas fa-redo text-xs"></i> Rutinan
                  </label>
                  <label class="flex-1 flex items-center gap-1.5 cursor-pointer rounded-lg border px-2 py-1.5 text-[11px] font-semibold
                    ${!isRutinan ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-400'}"
                    id="label-khusus-${key}" onclick="event.stopPropagation()">
                    <input type="radio" name="jenis-libur-${key}" id="radio-khusus-${key}" value="khusus"
                      ${!isRutinan ? 'checked' : ''} onchange="onJenisLiburChange('${key}','khusus')" class="accent-red-500">
                    <i class="fas fa-star text-xs"></i> Khusus
                  </label>
                </div>
                <div id="ket-khusus-wrap-${key}" class="${!isRutinan ? '' : 'hidden'}">
                  <label class="text-[9px] text-gray-400 mb-0.5 block">Keterangan (akan masuk ke Daftar Hari Libur)</label>
                  <input type="text" id="h${key}_ket_libur" value="${ketLibur}"
                    placeholder="cth: Pertemuan Guru, Libur Semester..."
                    class="w-full border border-red-200 rounded text-[11px] p-1.5 focus:ring-red-300 focus:border-red-400 bg-white text-gray-700"
                    onclick="event.stopPropagation()">
                </div>
                <p id="ket-rutinan-info-${key}" class="text-[10px] text-purple-400 italic mt-0.5 ${isRutinan ? '' : 'hidden'}">
                  <i class="fas fa-info-circle mr-1"></i>Libur rutinan tidak dicatat ke Daftar Hari Libur
                </p>
              </div>
              <div id="detail-hari-${key}" class="${isLibur ? 'hidden' : ''}">
                <div class="px-3 pb-3 pt-1 border-t border-gray-200 grid grid-cols-2 gap-2">
                  <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-1">⏰ Datang</p>
                    <div class="flex gap-1">
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Buka</label>
                        <input type="time" id="h${key}_masuk_mulai" value="${hari.masuk_mulai||'06:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                      <div class="flex-1">
                        <label class="text-[9px] text-orange-500">Batas</label>
                        <input type="time" id="h${key}_masuk_akhir" value="${hari.masuk_akhir||'07:15'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                    </div>
                  </div>
                  <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-1">🏠 Pulang</p>
                    <div class="flex gap-1">
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Buka</label>
                        <input type="time" id="h${key}_pulang_mulai" value="${hari.pulang_mulai||'15:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Tutup</label>
                        <input type="time" id="h${key}_pulang_akhir" value="${hari.pulang_akhir||'17:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;
        }
        container.innerHTML = html;
    }

    function onToggleMasuk(key, isChecked) {
        const isLibur = !isChecked;
        const detail = document.getElementById('detail-hari-' + key);
        const badge = document.getElementById('badge-' + key);
        const card = document.getElementById('card-hari-' + key);
        const ketWrap = document.getElementById('ket-libur-wrap-' + key);
        if (isLibur) {
            detail.classList.add('hidden');
            if (ketWrap) ketWrap.classList.remove('hidden');
            card.className = card.className.replace('bg-gray-50 border-gray-200','bg-red-50 border-red-200');
            // Default ke Rutinan saat toggle ke libur
            const radioRutinan = document.getElementById('radio-rutinan-' + key);
            if (radioRutinan && !radioRutinan.checked && !document.getElementById('radio-khusus-'+key).checked) {
                radioRutinan.checked = true;
            }
            // Update badge sesuai pilihan saat ini
            _updateBadgeLibur(key);
        } else {
            detail.classList.remove('hidden');
            if (ketWrap) ketWrap.classList.add('hidden');
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700';
            badge.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Masuk';
            card.className = card.className.replace('bg-red-50 border-red-200','bg-gray-50 border-gray-200');
        }
        if (_jadwalHarian) _jadwalHarian[key].libur = isLibur;
    }

    function onJenisLiburChange(key, jenis) {
        const isRutinan = (jenis === 'rutinan');
        const ketWrap = document.getElementById('ket-khusus-wrap-' + key);
        const infoRutinan = document.getElementById('ket-rutinan-info-' + key);
        const labelRutinan = document.getElementById('label-rutinan-' + key);
        const labelKhusus = document.getElementById('label-khusus-' + key);
        if (isRutinan) {
            if (ketWrap) ketWrap.classList.add('hidden');
            if (infoRutinan) infoRutinan.classList.remove('hidden');
            if (labelRutinan) labelRutinan.className = labelRutinan.className
                .replace('bg-white border-gray-200 text-gray-400','bg-purple-50 border-purple-300 text-purple-700');
            if (labelKhusus) labelKhusus.className = labelKhusus.className
                .replace('bg-red-50 border-red-300 text-red-700','bg-white border-gray-200 text-gray-400');
        } else {
            if (ketWrap) ketWrap.classList.remove('hidden');
            if (infoRutinan) infoRutinan.classList.add('hidden');
            if (labelKhusus) labelKhusus.className = labelKhusus.className
                .replace('bg-white border-gray-200 text-gray-400','bg-red-50 border-red-300 text-red-700');
            if (labelRutinan) labelRutinan.className = labelRutinan.className
                .replace('bg-purple-50 border-purple-300 text-purple-700','bg-white border-gray-200 text-gray-400');
            // Fokus ke input keterangan
            setTimeout(() => {
                const inp = document.getElementById('h' + key + '_ket_libur');
                if (inp) inp.focus();
            }, 50);
        }
        _updateBadgeLibur(key);
    }

    function _updateBadgeLibur(key) {
        const badge = document.getElementById('badge-' + key);
        const radioRutinan = document.getElementById('radio-rutinan-' + key);
        const isRutinan = radioRutinan ? radioRutinan.checked : true;
        if (isRutinan) {
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-600';
            badge.innerHTML = '<i class="fas fa-redo mr-1"></i>Libur Rutin';
        } else {
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600';
            badge.innerHTML = '<i class="fas fa-star mr-1"></i>Libur Khusus';
        }
    }

    function toggleHariExpand(key) {
        const toggle = document.getElementById('toggle-libur-' + key);
        if (!toggle.checked) return; // sedang libur, tidak bisa expand
        const detail = document.getElementById('detail-hari-' + key);
        detail.classList.toggle('hidden');
    }

    function loadGlobalConfig() {
        const container = document.getElementById('jadwal-hari-container');
        if (container) container.innerHTML = '<div class="text-center py-6 text-gray-400 text-xs"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat jadwal...</div>';

        callGAS('getAppConfig').then(res => {
            if(res.success) {
                const conf = res.data;
                const defaultHari = {libur:false, masuk_mulai:'06:00', masuk_akhir:'07:15', pulang_mulai:'15:00', pulang_akhir:'17:00'};
                const jadwal = conf.jadwal_harian || {};
                for(let d=1;d<=7;d++){
                    if(!jadwal[String(d)]) jadwal[String(d)] = {...defaultHari, libur: d===7};
                }
                renderJadwalHarian(jadwal);
            } else {
                if(container) container.innerHTML = '<div class="text-center py-4 text-red-400 text-xs">Gagal memuat konfigurasi.</div>';
            }
        }).catch(err => {
            if(container) container.innerHTML = '<div class="text-center py-4 text-red-400 text-xs">Error: ' + err + '</div>';
        });
    }

    function saveGlobalConfig(e) {
        e.preventDefault();
        const btn = document.getElementById('btnSaveConfig');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';

        // Kumpulkan jadwal dari form
        const jadwal = {};
        for (let d = 1; d <= 7; d++) {
            const key = String(d);
            const toggle = document.getElementById('toggle-libur-' + key);
            const isLibur = toggle ? !toggle.checked : (d === 7);
            jadwal[key] = {
                libur: isLibur,
                masuk_mulai:  (document.getElementById('h'+key+'_masuk_mulai')  || {value:'06:00'}).value || '06:00',
                masuk_akhir:  (document.getElementById('h'+key+'_masuk_akhir')  || {value:'07:15'}).value || '07:15',
                pulang_mulai: (document.getElementById('h'+key+'_pulang_mulai') || {value:'15:00'}).value || '15:00',
                pulang_akhir: (document.getElementById('h'+key+'_pulang_akhir') || {value:'17:00'}).value || '17:00',
                libur_rutinan: (() => {
                    const r = document.getElementById('radio-rutinan-'+key);
                    // Jika tidak libur, libur_rutinan tidak relevan; default true
                    if (!isLibur) return true;
                    return r ? r.checked : true;
                })(),
                ket_libur:    (document.getElementById('h'+key+'_ket_libur')    || {value:''}).value.trim() || '',
            };
        }

        // Ambil jam default dari hari Senin (tidak libur) sebagai backward-compat
        const refDay = Object.values(jadwal).find(h => !h.libur) || jadwal['1'];
        const newConfig = {
            jam_masuk_mulai:  refDay.masuk_mulai,
            jam_masuk_akhir:  refDay.masuk_akhir,
            jam_pulang_mulai: refDay.pulang_mulai,
            jam_pulang_akhir: refDay.pulang_akhir,
            jadwal_harian: jadwal
        };

        callGAS('saveAppConfig', newConfig).then(res => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            if(res.success) {
                showAlert('success', 'Pengaturan waktu berhasil disimpan!');
            } else {
                showAlert('error', res.message);
            }
        }).catch(err => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            showAlert('error', 'Gagal koneksi: ' + err);
        });
    }


    function renderLiburRows(data, startIdx) {
            const tbody = document.getElementById('tbody-libur');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Tidak ada jadwal libur.</td></tr>';
                return;
            }
            
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            
            tbody.innerHTML = data.map((item, i) => `
                <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
                    <td class="p-4 text-center text-gray-500">${startIdx + i + 1}</td>
                    <td class="p-4 font-mono font-medium text-indigo-700">
                        ${new Date(item.tanggal).toLocaleDateString('id-ID', options)}
                    </td>
                    <td class="p-4 font-bold text-gray-700">${item.keterangan}</td>
                    <td class="p-4 text-center">
                        <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                            <button onclick="editLibur('${item.tanggal}', '${item.keterangan}')" class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteLiburConfirm('${item.tanggal}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }

  // 1. Fungsi Trigger saat tombol edit ditekan
      function editLibur(tgl, ket) {
          // Tampilkan modal dengan data yang sudah terisi
          showModal(createLiburModal({ tanggal: tgl, keterangan: ket }));
      }

      function createLiburModal(data) {
              const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-3 transition-all mb-4";
              
              return `
              <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden animate-fade-in">
                  <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                      <i class="fas fa-times"></i>
                  </button>
                  
                  <div class="text-center mb-6">
                      <div class="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm">
                          <i class="fas fa-calendar-day"></i>
                      </div>
                      <h3 class="font-bold text-xl text-gray-800">Edit Hari Libur</h3>
                      <p class="text-xs text-gray-500 mt-1">Perbarui tanggal atau keterangan</p>
                  </div>
                  
                  <form onsubmit="saveUpdateLibur(event)">
                      <input type="hidden" name="oldDate" value="${data.tanggal}">
                      
                      <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Tanggal</label>
                      <input type="date" name="newDate" value="${data.tanggal}" required class="${inputClass}">
                      
                      <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Keterangan</label>
                      <input type="text" name="newKeterangan" value="${data.keterangan}" required placeholder="Contoh: Cuti Bersama" class="${inputClass}">

                      <div class="flex gap-3 mt-4">
                          <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">
                              Batal
                          </button>
                          <button type="submit" id="btnSaveLibur" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2">
                              Simpan Perubahan
                          </button>
                      </div>
                  </form>
              </div>`;
          }

          // 3. Fungsi Simpan Perubahan (Submit Form Modal)
      function saveUpdateLibur(e) {
        e.preventDefault();
        
        // 1. Ambil elemen tombol
        const btn = document.getElementById('btnSaveLibur');
        const originalText = btn.innerHTML; // Simpan teks asli
        
        // 2. Ubah tampilan tombol menjadi Loading
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';
        btn.classList.add('opacity-75', 'cursor-not-allowed'); // Visual feedback tambahan

        // Tetap tampilkan loading overlay global (opsional, bisa dihapus jika ingin hanya tombol saja)
        showLoading(); 
        
        const fd = new FormData(e.target);
        const oldDate = fd.get('oldDate');
        const newDate = fd.get('newDate');
        const newKet = fd.get('newKeterangan');
        
        callGAS('updateHariLibur', oldDate, newDate, newKet).then(res => {
            hideLoading(); // Sembunyikan overlay global
            
            // 3. Kembalikan tombol ke keadaan semula (penting jika terjadi error)
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');

            if (res.success) {
                closeModal();
                loadKelolaAbsen(); 
                showAlert('success', res.message);
            } else {
                showAlert('error', res.message);
            }
        }).catch(error => {
            // Handler jika koneksi gagal total
            hideLoading();
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            showAlert('error', 'Gagal menghubungi server: ' + error);
        });
    }
            
    function updatePreviewLibur() {
        const mulai = document.getElementById('input-libur-mulai').value;
        const akhir = document.getElementById('input-libur-akhir').value;
        const preview = document.getElementById('preview-libur');
        const previewText = document.getElementById('preview-libur-text');
        if (!mulai || !akhir) { preview.classList.add('hidden'); return; }
        const dMulai = new Date(mulai + 'T00:00:00');
        const dAkhir = new Date(akhir + 'T00:00:00');
        if (dAkhir < dMulai) {
            previewText.textContent = '⚠ Tanggal akhir tidak boleh sebelum tanggal mulai.';
            preview.classList.remove('hidden');
            preview.className = preview.className.replace('bg-amber-50 border-amber-200 text-amber-700','bg-red-50 border-red-200 text-red-600');
            return;
        }
        preview.className = 'bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2';
        const selisih = Math.round((dAkhir - dMulai) / (1000*60*60*24)) + 1;
        const fmtOpt = { day: 'numeric', month: 'long', year: 'numeric' };
        if (selisih === 1) {
            previewText.textContent = '1 hari: ' + dMulai.toLocaleDateString('id-ID', fmtOpt);
        } else {
            previewText.textContent = selisih + ' hari: ' + dMulai.toLocaleDateString('id-ID', fmtOpt) + ' s/d ' + dAkhir.toLocaleDateString('id-ID', fmtOpt);
        }
        preview.classList.remove('hidden');
    }

    function handleAddLibur(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        const tglMulai = fd.get('tanggal_mulai');
        const tglAkhir = fd.get('tanggal_akhir');
        const ket = fd.get('keterangan');

        // Validasi range
        if (tglAkhir < tglMulai) {
            showAlert('error', 'Tanggal akhir tidak boleh sebelum tanggal mulai.');
            return;
        }

        showLoading();
        callGAS('addHariLiburRange', tglMulai, tglAkhir, ket).then(res => {
            hideLoading();
            if (res.success) {
                e.target.reset();
                document.getElementById('preview-libur').classList.add('hidden');
                loadKelolaAbsen();
                showAlert('success', res.message);
            } else {
                showAlert('error', res.message);
            }
        }).catch(err => {
            hideLoading();
            showAlert('error', 'Gagal: ' + err);
        });
    }

    function deleteLiburConfirm(tgl) {
        if (confirm('Hapus hari libur ini? Siswa akan bisa absen kembali pada tanggal tersebut.')) {
            showLoading();
            callGAS('deleteHariLibur', tgl).then(res => {
                hideLoading();
                loadKelolaAbsen();
                showAlert('success', 'Jadwal libur dihapus');
            }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
        }
    }

    // --- DATA SISWA ---
// 
// Cari function loadDataSiswa() dan GANTI SEMUANYA dengan ini:

function loadDataSiswa() {
    stopAndBack(false);
    setActiveMenu('Data Siswa');
    showView('view-data-siswa');
    
    // 1. Tentukan Filter Kelas Berdasarkan Role
    // Guru: currentUser.kelas bisa berisi "Kelas A" atau "Kelas A,Kelas B"
    const filterKelas = (currentUser.role === 'guru') ? currentUser.kelas : null;
    // Untuk judul halaman: list kelas yang dipisah koma
    const kelasLabel = filterKelas
        ? String(filterKelas).split(',').map(k => k.trim()).filter(Boolean).join(', ')
        : null;

    // --- JUDUL HALAMAN DISESUAIKAN ---
    const pageTitle = document.querySelector('#view-data-siswa h3');
    if (kelasLabel) {
        pageTitle.textContent = `Direktori Siswa (${kelasLabel})`;
        // Sembunyikan dropdown filter kelas karena guru hanya boleh lihat kelasnya
        document.getElementById('filterKelasSiswa').parentElement.style.display = 'none';
    } else {
        pageTitle.textContent = 'Direktori Siswa';
        // Tampilkan dropdown filter untuk Admin
        document.getElementById('filterKelasSiswa').parentElement.style.display = 'flex';
    }

    // --- LOGIKA POPULATE DROPDOWN (Khusus Admin) ---
    const dropdown = document.getElementById('filterKelasSiswa');
    const fillDropdown = (dataKelas) => {
        if (!dropdown) return;
        const currentValue = dropdown.value; 
        let options = '<option value="">Semua Kelas</option>';
        if (dataKelas && dataKelas.length > 0) {
            dataKelas.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
        }
        dropdown.innerHTML = options;
        if (currentValue) dropdown.value = currentValue;
    };

    if (existingClasses && existingClasses.length > 0) {
        fillDropdown(existingClasses);
    } else {
        dropdown.innerHTML = '<option value="">Memuat data...</option>';
        callGAS('getKelasList').then(result => {
            if (result.success) {
                existingClasses = result.data;
                fillDropdown(existingClasses);
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }

    // --- AMBIL DATA SISWA DENGAN PARAMETER FILTER ---
    // Reset tabel dulu agar terlihat loading
    document.getElementById('tbody-siswa').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data siswa...</td></tr>';
    
    // Panggil Backend dengan parameter filterKelas
    callGAS('getSiswaList', filterKelas).then(result => {
        if (result.success) {
            tableState.siswa.fullData = result.data;
            processTableData('siswa');
        } else {
            showAlert('error', result.message);
        }
    }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err))); // <--- PERUBAHAN UTAMA DISINI
}

function renderSiswaRows(data, startIdx) {
        const tbody = document.getElementById('tbody-siswa');
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map((siswa, i) => {
            const checkCell = selectModeSiswa
                ? `<td class="p-4 text-center">
                     <input type="checkbox" class="w-4 h-4 cursor-pointer siswa-check" value="${siswa.nisn}"
                       ${selectedSiswaSet.has(String(siswa.nisn)) ? 'checked' : ''}
                       onchange="toggleSiswaSelected('${siswa.nisn}', this.checked)">
                   </td>`
                : '';
            return `
        <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
            ${checkCell}
            <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
            <td class="p-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold mr-3">
                        ${siswa.nama.charAt(0)}
                    </div>
                    <div>
                        <div class="font-bold text-sm text-gray-900">${siswa.nama}</div>
                        <div class="text-xs text-gray-500 md:hidden">${siswa.nisn}</div>
                    </div>
                </div>
            </td>
            <td class="p-4 hidden md:table-cell text-sm text-gray-600 font-mono">${siswa.nisn}</td>
            <td class="p-4 hidden sm:table-cell"><span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">${siswa.kelas}</span></td>
            <td class="p-4 text-center">
                <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                    <button onclick='viewSiswa(${JSON.stringify(siswa)})' class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition" title="Lihat Detail">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button onclick='editSiswa(${JSON.stringify(siswa)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteSiswaConfirm('${siswa.nisn}', '${siswa.nama}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus"><i class="fas fa-trash"></i></button>
                    <button onclick="generateQRForSiswa('${siswa.nisn}', '${siswa.nama}', '${siswa.kelas}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition" title="QR Code"><i class="fas fa-qrcode"></i></button>
                </div>
            </td>
        </tr>`;
        }).join('');
    }

    // --- DATA GURU ---
function loadDataGuru() {
        stopAndBack(false);
        setActiveMenu('Data Guru');
        showView('view-data-guru');
        
        // --- LOGIKA POPULATE DROPDOWN KELAS GURU ---
        const dropdown = document.getElementById('filterKelasGuru');
        if (dropdown && existingClasses && existingClasses.length > 0) {
            const currentValue = dropdown.value; 
            
            let options = '<option value="">Semua Kelas</option>';
            existingClasses.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
            dropdown.innerHTML = options;
            
            if (currentValue) dropdown.value = currentValue;
        }
        // --------------------------------------------------

        // Cek Cache Data
        if (tableState.guru.fullData.length > 0) {
            processTableData('guru');
        } else {
            // Tampilkan Loading di Tabel
            document.getElementById('tbody-guru').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data guru...</td></tr>';
            
            // === KEAMANAN: AMBIL TOKEN ===
            const token = currentUser.token;

            // Panggil Backend dengan Token
            callGAS('getGuruList', token).then(result => {
                if (result.success) {
                    tableState.guru.fullData = result.data;
                    processTableData('guru');
                } else {
                    // Jika gagal (Token invalid/Bukan Admin)
                    document.getElementById('tbody-guru').innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${result.message}</td></tr>`;
                    showAlert('error', result.message);
                }
            }).catch(error => {
                document.getElementById('tbody-guru').innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">Gagal koneksi: ${error}</td></tr>`;
            }); // <-- PARAMETER TOKEN DITAMBAHKAN DI SINI
        }
    }

// UPDATE: Menampilkan kolom kelas di tabel
function formatJabatanBullets(jabatanStr) {
    if (!jabatanStr) return '<span class="text-gray-400 italic text-xs">-</span>';
    const list = String(jabatanStr).split(',').map(j => j.trim()).filter(Boolean);
    return list.map(j => `<div class="flex items-start gap-1"><span class="text-amber-500">•</span><span>${j}</span></div>`).join('');
}

function renderGuruRows(data, startIdx) {
    const tbody = document.getElementById('tbody-guru');
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map((guru, i) => {
        const checkCell = selectModeGuru
            ? `<td class="p-4 text-center">
                 <input type="checkbox" class="w-4 h-4 cursor-pointer guru-check" value="${guru.idGuru}"
                   ${selectedGuruSet.has(String(guru.idGuru)) ? 'checked' : ''}
                   onchange="toggleGuruSelected('${guru.idGuru}', this.checked)">
               </td>`
            : '';
        return `
    <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
        ${checkCell}
        <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
        <td class="p-4 text-xs font-mono font-bold text-amber-600">${guru.idGuru || '-'}</td>
        <td class="p-4 text-sm font-bold text-gray-800">${guru.nama || guru.username}</td>
        <td class="p-4 text-xs text-gray-600">${formatJabatanBullets(guru.jabatan)}</td>
        <td class="p-4 text-center">
            <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                <button onclick='editGuru(${JSON.stringify(guru)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit Akun"><i class="fas fa-edit"></i></button>
                <button onclick="loadQRCodeGuru('${guru.idGuru}', '${(guru.nama||guru.username).replace(/'/g,"\\'")}', '${(guru.jabatan||'').replace(/'/g,"\\'")}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition" title="Kartu Pengajar"><i class="fas fa-id-card"></i></button>
                <button onclick="deleteGuruConfirm('${guru.username}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus Akun"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`}).join('');
}
function saveSiswa(e, isEdit) {
    e.preventDefault();
    showLoading();

    const fd = new FormData(e.target);
    const siswaData = {
        nama: fd.get('nama'),
        nisn: "'" + fd.get('nisn'),
        jenisKelamin: fd.get('jenisKelamin'),
        tanggalLahir: fd.get('tanggalLahir'),
        agama: fd.get('agama'),
        namaAyah: fd.get('namaAyah'),
        namaIbu: fd.get('namaIbu'),
        noHp: "'" + fd.get('noHp'),
        kelas: fd.get('kelas'),
        alamat: fd.get('alamat')
    };

    // --- PERUBAHAN UTAMA DISINI ---
    // Ambil token dari user yang sedang login
    const token = currentUser ? currentUser.token : null; 
    // ------------------------------

    const callback = (res) => {
        hideLoading();
        if (res.success) {
            closeModal();
            tableState.siswa.fullData = [];
            loadDataSiswa();
            showAlert('success', res.message);
        } else {
            showAlert('error', res.message);
        }
    };

    const failureCallback = (err) => {
        hideLoading();
        showAlert('error', 'Terjadi kesalahan: ' + err);
    };

    // Kirim Token ke Server
    if (isEdit) {
        const oldNisn = fd.get('oldNisn');
        callGAS('updateSiswa', token, oldNisn, siswaData).then(callback).catch(failureCallback); // <-- Pastikan updateSiswa di code.gs juga sudah ditambah parameter token!
    } else {
        callGAS('addSiswa', token, siswaData).then(callback).catch(failureCallback); // <-- KIRIM TOKEN
    }
}
    // --- REKAP ABSENSI ---
function loadRekapAbsensi() {
    stopAndBack(false);
    setActiveMenu('Laporan');
    showView('view-rekap-absensi');
    
    // 1. Reset Tampilan (Bersihkan tabel lama)
    document.getElementById('rekapEmptyState').classList.remove('hidden');
    document.getElementById('rekapContainer').classList.add('hidden');
    document.getElementById('rekapLoading').classList.add('hidden');
    
    // Reset data di memori
    tableState.rekap.fullData = [];

    // 2. Logika Pengisian Dropdown Kelas (Anti-Kosong)
    const selectKelas = document.getElementById('fKelasRekap');
    
    // Fungsi pembantu untuk render opsi HTML
    const fillDropdown = (dataKelas) => {
        if (!selectKelas) return;
        
        // Simpan nilai yang mungkin sudah dipilih user sebelumnya (jika reload)
        const currentVal = selectKelas.value; 
        
        let options = '<option value="">Semua Kelas</option>';
        if (dataKelas && dataKelas.length > 0) {
            dataKelas.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
        }
        selectKelas.innerHTML = options;
        
        // Kembalikan pilihan user jika masih valid
        if (currentVal) selectKelas.value = currentVal;
    };

    // --- CEK DATA KELAS ---
    // A. Jika data kelas sudah tersimpan di variabel global 'existingClasses'
    if (existingClasses && existingClasses.length > 0) {
        fillDropdown(existingClasses);
    } 
    // B. Jika data masih kosong (karena aplikasi baru dibuka), ambil paksa dari server
    else {
        if (selectKelas) selectKelas.innerHTML = '<option value="">Memuat data...</option>';
        
        callGAS('getKelasList').then(result => {
            if (result.success) {
                existingClasses = result.data; // Simpan ke global agar akses berikutnya cepat
                fillDropdown(existingClasses); // Render ke dropdown
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }
}

function applyFilter() {
        const emptyState = document.getElementById('rekapEmptyState');
        const container = document.getElementById('rekapContainer');
        const loading = document.getElementById('rekapLoading');

        emptyState.classList.add('hidden');
        container.classList.add('hidden');
        loading.classList.remove('hidden');

        // UPDATE: Ambil nilai kelas juga
        const filter = {
            tanggalMulai: document.getElementById('fStart').value,
            tanggalAkhir: document.getElementById('fEnd').value,
            kelas: document.getElementById('fKelasRekap').value // BARU
        };

        callGAS('getAbsensiList', filter).then(result => {
            loading.classList.add('hidden');
            container.classList.remove('hidden');
            
            if (result.success) {
                tableState.rekap.fullData = result.data;
                processTableData('rekap');
            } else {
                 tableState.rekap.fullData = [];
                 processTableData('rekap');
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }

    function exportToExcel() {
        const start = document.getElementById('fStart').value;
        const end = document.getElementById('fEnd').value;
        // UPDATE: Ambil nilai kelas
        const kelas = document.getElementById('fKelasRekap').value; 

        if (!start || !end) {
            showAlert('error', 'Harap pilih rentang tanggal terlebih dahulu.');
            return;
        }

        const btn = document.getElementById('btnExportExcel');
        const originalText = btn.innerHTML;
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';
        
        // UPDATE: Masukkan kelas ke object filters
        const filters = {
            tanggalMulai: start,
            tanggalAkhir: end,
            kelas: kelas // BARU
        };

        callGAS('generateExcel', 'laporan_absensi', filters).then(result => {
            btn.disabled = false;
            btn.innerHTML = originalText;

            if (result.success) {
                window.open(result.url, '_blank');
                showAlert('success', 'File Excel berhasil diunduh!');
            } else {
                showAlert('error', result.message);
            }
        }).catch(err => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            showAlert('error', 'Terjadi kesalahan server: ' + err);
        });
    }

function renderRekapRows(data) {
    const tbody = document.getElementById('tbody-rekap');
    
    // Update colspan jadi 8 karena kolom bertambah
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-400">Tidak ada data ditemukan.</td></tr>';
        return;
    }
    
    // Helper untuk warna badge STATUS (Kolom H)
    const getStatusColor = (status) => {
         if(status === 'Hadir') return 'bg-green-100 text-green-700';
         if(status === 'Izin') return 'bg-blue-100 text-blue-700';
         if(status === 'Sakit') return 'bg-yellow-100 text-yellow-700';
         if(status === 'Alpa') return 'bg-red-100 text-red-700';
         if(status === 'Bolos') return 'bg-orange-100 text-orange-700';
         return 'bg-gray-100 text-gray-600';
    };

    tbody.innerHTML = data.map((d, i) => {
        
        // Helper untuk warna teks KETERANGAN (Kolom G)
        let ketText = d.keterangan || "-";
        let ketStyle = "text-gray-500";
        let ketIcon = "";
        
        if (String(ketText).includes("Terlambat")) {
            ketStyle = "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
            ketIcon = '<i class="fas fa-history mr-1"></i>';
        } else if (String(ketText).includes("Pulang Cepat")) {
            ketStyle = "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
            ketIcon = '<i class="fas fa-running mr-1"></i>';
        } else if (ketText === "Tepat Waktu") {
            ketStyle = "text-emerald-600 font-bold text-[10px]";
            ketIcon = '<i class="fas fa-check-double mr-1"></i>';
        }

        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition">
            <td class="p-4 text-center text-gray-500 text-xs">${i + 1}</td>
            
            <td class="p-4 text-sm text-gray-600">
               ${new Date(d.tanggal).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'})}
            </td>
            
            <td class="p-4 text-sm font-bold text-gray-900">${d.nama}</td>
            
            <td class="p-4 text-center text-sm text-gray-600">
               <span class="bg-gray-100 px-2 py-1 rounded text-xs font-bold">${d.kelas}</span>
            </td>
            
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamDatang}</td>
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamPulang}</td>
            
            <td class="p-4 text-center align-middle">
               <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>
            
            <td class="p-4 text-center text-sm">
                <span class="${getStatusColor(d.status)} px-2 py-1 rounded text-xs font-bold">
                   ${d.status || 'Hadir'}
                </span>
            </td>
        </tr>`;
    }).join('');
}

    // --- MONITORING ---
function loadMonitoringAbsensi() {
    stopAndBack(false);
    setActiveMenu('Monitoring');
    showView('view-monitoring');
    document.getElementById('monitoringDate').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    
    // --- Set Default Tanggal Export ke Hari Ini ---
    const todayISO = new Date().toISOString().split('T')[0];
    const elStart = document.getElementById('exportMonStart');
    const elEnd = document.getElementById('exportMonEnd');
    if(elStart && !elStart.value) elStart.value = todayISO;
    if(elEnd && !elEnd.value) elEnd.value = todayISO;

    // --- Populate dropdown filter kelas ---
    const kelasDropdown = document.getElementById('filterKelasMonitoring');
    if (kelasDropdown) {
        kelasDropdown.style.display = '';
        if (kelasDropdown.parentElement) kelasDropdown.parentElement.style.display = '';

        // Tentukan daftar kelas yang ditampilkan di dropdown
        let kelasList = [];
        if (currentUser.role === 'guru' && currentUser.kelas) {
            // Guru: hanya kelas yang dipegang (bisa lebih dari satu)
            kelasList = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);
        } else {
            // Admin / pimpinan: semua kelas
            kelasList = existingClasses || [];
        }

        const currentVal = kelasDropdown.value;
        let opts = '<option value="">Semua Kelas</option>';
        kelasList.forEach(k => {
            opts += `<option value="${k}" ${currentVal === k ? 'selected' : ''}>${k}</option>`;
        });
        kelasDropdown.innerHTML = opts;
    }

    // Tentukan filter kelas server-side:
    // - Guru 1 kelas : kirim kelas itu sebagai filter (hemat data)
    // - Guru multi-kelas : kirim semua kelas miliknya ke server
    // - Admin/pimpinan : tidak filter di server (ambil semua, filter di client)
    const myClass = currentUser.role === 'guru' ? currentUser.kelas : null;

    if (tableState.monitoring.fullData.length > 0) {
        processTableData('monitoring');
    } else {
        document.getElementById('tbody-monitoring').innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';
        callGAS('getMonitoringRealtime', myClass).then(result => {
            if (result.success) {
                tableState.monitoring.fullData = result.data;
                processTableData('monitoring');
            } else {
                document.getElementById('tbody-monitoring').innerHTML = '<tr><td colspan="7" class="p-12 text-center text-gray-400 italic bg-white">Data tidak ditemukan.</td></tr>';
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }
}

function exportMonitoringExcel() {
    // 1. Ambil elemen tombol
    const btn = document.getElementById('btnExportMonitoring');
    const originalContent = btn.innerHTML;

    // 2. AMBIL TANGGAL DARI INPUT (BARU)
    const startDate = document.getElementById('exportMonStart').value;
    const endDate = document.getElementById('exportMonEnd').value;

    if (!startDate || !endDate) {
        showAlert('error', 'Harap pilih tanggal mulai dan akhir untuk export.');
        return;
    }

    // 3. Ubah tampilan tombol menjadi "Loading"
    btn.disabled = true;
    btn.classList.add('cursor-not-allowed', 'opacity-75');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span class="hidden sm:inline">Memproses...</span>';
    
    // 4. Siapkan Filter
    // Prioritas: dropdown filter kelas (jika dipilih) > kelas guru (server-side)
    const dropdownKelas = document.getElementById('filterKelasMonitoring')?.value || '';
    const myClassDefault = (currentUser && currentUser.role === 'guru') ? currentUser.kelas : null;
    const kelasForExport = dropdownKelas || myClassDefault || null;
    
    const filters = {
        kelas: kelasForExport,
        tanggalMulai: startDate,
        tanggalAkhir: endDate
    };

    // 5. Panggil Backend
    callGAS('generateExcel', 'monitoring', filters).then(result => {
        btn.disabled = false;
        btn.classList.remove('cursor-not-allowed', 'opacity-75');
        btn.innerHTML = originalContent;

        if (result.success) {
            window.open(result.url, '_blank');
            showAlert('success', 'Data monitoring berhasil di-export!');
        } else {
            showAlert('error', result.message);
        }
    }).catch(err => {
        btn.disabled = false;
        btn.classList.remove('cursor-not-allowed', 'opacity-75');
        btn.innerHTML = originalContent;
        showAlert('error', 'Gagal menghubungi server: ' + err);
    });
}
    
function renderMonitoringRows(data, startIdx) {
    const tbody = document.getElementById('tbody-monitoring');
    
    // 1. Cek jika data kosong
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-12 text-center text-gray-400 italic bg-white">Tidak ada data ditemukan.</td></tr>';
        return;
    }

    // 2. Cek Hak Akses (Hanya Guru/Admin yang bisa edit dropdown)
    const canEdit = (currentUser.role === 'guru' || currentUser.role === 'admin');
    const cursorClass = canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70';
    const disabledAttr = canEdit ? '' : 'disabled';

    // 3. Render Baris Tabel
    tbody.innerHTML = data.map((d, i) => {
        
        // --- A. LOGIKA WARNA DROPDOWN STATUS (Kolom H) ---
        let statusColor = 'bg-gray-100 text-gray-600';
        if(d.status === 'Hadir') statusColor = 'bg-green-100 text-green-700';
        else if(d.status === 'Izin') statusColor = 'bg-blue-100 text-blue-700';
        else if(d.status === 'Sakit') statusColor = 'bg-yellow-100 text-yellow-700';
        else if(d.status === 'Alpa') statusColor = 'bg-red-100 text-red-700';
        else if(d.status === 'Bolos') statusColor = 'bg-orange-100 text-orange-700';

        // --- B. LOGIKA TAMPILAN KETERANGAN WAKTU (Kolom G) ---
        let ketText = d.keterangan || "-"; // Ambil teks dari server (misal: "Terlambat (15 m)")
        let ketStyle = "text-gray-400 font-mono text-[10px]"; // Default style
        let ketIcon = "";

        // Deteksi kata kunci dalam teks keterangan untuk memberi warna
        if (String(ketText).includes("Terlambat")) {
            // MERAH: Jika Terlambat
            ketStyle = "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
            ketIcon = '<i class="fas fa-history mr-1"></i>';
        } else if (String(ketText).includes("Pulang Cepat")) {
            // ORANYE: Jika Pulang Cepat
            ketStyle = "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
            ketIcon = '<i class="fas fa-running mr-1"></i>';
        } else if (ketText === "Tepat Waktu") {
            // HIJAU: Jika Tepat Waktu
            ketStyle = "text-emerald-600 font-bold text-[10px]";
            ketIcon = '<i class="fas fa-check-double mr-1"></i>';
        }

        // --- C. HTML ROW ---
        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
            <td class="p-4 text-center text-gray-400 text-xs">${startIdx + i + 1}</td>
            
            <td class="p-4">
                <div class="font-bold text-sm text-gray-900">${d.nama}</div>
                <div class="text-xs text-gray-500 font-mono">${d.nisn}</div>
            </td>
            
            <td class="p-4 text-center">
                <span class="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-xs font-bold border border-indigo-100">${d.kelas}</span>
            </td>
            
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamDatang}</td>
            
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamPulang}</td>

            <td class="p-4 text-center align-middle">
                 <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>

            <td class="p-4 text-center relative">
                <select onchange="changeStatus('${d.nisn}', '${d.nama}', '${d.kelas}', this)" 
                        class="text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 ${statusColor} ${cursorClass}"
                        ${disabledAttr}>
                    <option value="Belum Absen" ${d.status === 'Belum Absen' ? 'selected' : ''}>Belum Absen</option>
                    <option value="Hadir" ${d.status === 'Hadir' ? 'selected' : ''}>Hadir</option>
                    <option value="Izin" ${d.status === 'Izin' ? 'selected' : ''}>Izin</option>
                    <option value="Sakit" ${d.status === 'Sakit' ? 'selected' : ''}>Sakit</option>
                    <option value="Alpa" ${d.status === 'Alpa' ? 'selected' : ''}>Alpa</option>
                    <option value="Bolos" ${d.status === 'Bolos' ? 'selected' : ''}>Bolos</option>
                </select>
                ${canEdit ? '<i class="fas fa-chevron-down absolute right-6 top-1/2 transform -translate-y-1/2 text-[10px] pointer-events-none opacity-40"></i>' : ''}
            </td>
        </tr>`;
    }).join('');
}

    // Fungsi Handler saat Guru mengubah Status
function changeStatus(nisn, nama, kelas, selectElement) {
    const newStatus = selectElement.value;
    
    // Visual Feedback: Disable sementara dropdown saat memproses
    selectElement.disabled = true;
    selectElement.style.opacity = '0.5';

    // --- KEAMANAN: AMBIL TOKEN USER ---
    const token = currentUser ? currentUser.token : null;
    // ----------------------------------

    callGAS('updateAbsensiStatus', token, nisn, nama, kelas, newStatus).then(res => {
        // Aktifkan kembali dropdown
        selectElement.disabled = false;
        selectElement.style.opacity = '1';

        if (res.success) {
            // Update Warna Dropdown secara langsung agar interaktif (UI Feedback)
            let newColor = 'bg-gray-100 text-gray-600';
            if(newStatus === 'Hadir') newColor = 'bg-green-100 text-green-700';
            else if(newStatus === 'Izin') newColor = 'bg-blue-100 text-blue-700';
            else if(newStatus === 'Sakit') newColor = 'bg-yellow-100 text-yellow-700';
            else if(newStatus === 'Alpa') newColor = 'bg-red-100 text-red-700';
            
            // Reset class dan tambahkan yang baru (pertahankan base styles)
            selectElement.className = `text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 cursor-pointer ${newColor}`;
            
            // Opsional: Tampilkan notifikasi kecil
            // showAlert('success', 'Status diperbarui'); 
        } else {
            // Jika gagal (misal token expired/tidak ada hak akses)
            showAlert('error', 'Gagal update: ' + res.message);
            // Reload tabel untuk mengembalikan status asli dari server
            loadMonitoringAbsensi();
        }
    }).catch(error => {
        selectElement.disabled = false;
        selectElement.style.opacity = '1';
        showAlert('error', 'Error koneksi: ' + error);
    }); // <-- Token dikirim
}
    // --- KARTU SISWA ---
function loadQRCodeSiswa(nisnParam, namaParam, kelasParam) {
    if (typeof stopAndBack === "function") stopAndBack(false);
    if (currentUser && currentUser.role === 'siswa' && typeof setActiveMenu === "function") {
        setActiveMenu('Kartu Saya');
    }
    if (typeof showView === "function") showView('view-kartu-siswa');

    const container = document.getElementById('kartuSiswaContainer');
    if (!container) return;

    // Ambil data mentah
    let rawNisn = nisnParam || (currentUser ? currentUser.nisn : "1234567890");
    const namaSiswa = namaParam || (currentUser ? currentUser.nama : "Siswa");
    const kelasSiswa = kelasParam || (currentUser ? currentUser.kelas : "X");
    
    // --- PERBAIKAN UTAMA: PEMBERSIH DATA (SANITIZER) ---
    // Kita hanya ambil Angka dan Huruf saja. Spasi/Simbol aneh dibuang.
    // Ini akan mengubah "3122140501(spasi)(karakter_aneh)" menjadi "3122140501" murni.
    let cleanNisn = String(rawNisn).replace(/[^a-zA-Z0-9]/g, "").trim();
    
    // Cek di Console panjang karakter aslinya (untuk debug)
    console.log("NISN Mentah:", rawNisn, "| Panjang:", String(rawNisn).length);
    console.log("NISN Bersih:", cleanNisn, "| Panjang:", cleanNisn.length);

    let backFunction = (currentUser && (currentUser.role === 'admin' || currentUser.role === 'guru')) 
                       ? "loadDataSiswa()" : "loadSiswaDashboard()";

    container.innerHTML = `
        <div class="flex justify-center items-center h-full py-12 animate-slide-up">
            <div class="bg-white rounded-3xl shadow-2xl overflow-hidden w-full max-w-sm relative transform hover:scale-[1.02] transition duration-300">
                <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white text-center relative">
                    <div class="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
                    <h2 class="text-2xl font-bold tracking-tight">KARTU PELAJAR</h2>
                    <p class="text-xs tracking-[0.2em] uppercase opacity-80 mt-1">SEKOLAH</p>
                </div>
        
                <div class="p-8 text-center bg-gray-50">
                    <div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 inline-block mb-5">
                        <div id="myQrcode"></div>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-800 mb-1">${namaSiswa}</h3>
                    <p class="text-indigo-600 font-mono font-bold text-lg mb-3 tracking-wider">${cleanNisn}</p>
                    <span class="inline-block px-4 py-1.5 bg-gray-200 text-gray-700 rounded-full text-sm font-bold shadow-sm">${kelasSiswa}</span>
                </div>
                
                <div class="p-5 bg-white border-t border-gray-100 flex gap-4">
                    <button onclick="window.print()" class="flex-1 bg-gray-900 text-white py-3 rounded-xl font-bold text-sm shadow hover:bg-black transition flex items-center justify-center">
                        <i class="fas fa-print mr-2"></i> Cetak
                    </button>
                    <button onclick="${backFunction}" class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition">
                        Tutup
                    </button>
                </div>
            </div>
        </div>`;

    setTimeout(() => {
        const qrElement = document.getElementById("myQrcode");
        if (qrElement && cleanNisn) {
            qrElement.innerHTML = ""; 
            try {
                // Hapus opsi typeNumber agar library otomatis menyesuaikan ukuran
                new QRCode(qrElement, {
                    text: cleanNisn,       // Gunakan data yang sudah dibersihkan
                    width: 160,
                    height: 160,
                    colorDark: "#1f2937",
                    colorLight: "#ffffff",
                    correctLevel : QRCode.CorrectLevel.L  // Level L = Kapasitas Paling Besar
                });
            } catch (e) {
                console.error("Gagal generate QR:", e);
                qrElement.innerHTML = "<span class='text-red-500 text-xs'>Error Data</span>";
            }
        }
    }, 100);
}
// Cache data siswa di memori browser — diisi sekali saat buka halaman scan
let siswaLocalCache = {}; // { nisn: { nama, kelas } }
let siswaLocalCacheLoaded = false;

function loadScanAbsensi() {
    isScanning = false;
    setActiveMenu('Scan Absensi');
    showView('view-scanner');
    stopPolling();
    setTimeout(() => {
        const inp = document.getElementById('qrFileInput');
        if (inp) inp.value = '';
        const fr = document.getElementById('fileResult');
        if (fr) fr.innerHTML = '';
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.add('hidden');
    }, 100);

    // 1. Coba muat dari localStorage dulu — instan & jalan walau offline
    if (!siswaLocalCacheLoaded) {
        try {
            const cached = localStorage.getItem('siswaLocalCache_v1');
            if (cached) {
                siswaLocalCache = JSON.parse(cached);
                siswaLocalCacheLoaded = true;
                const cacheStatus = document.getElementById('scanCacheStatus');
                if (cacheStatus) {
                    cacheStatus.textContent = '✅ ' + Object.keys(siswaLocalCache).length + ' siswa siap discan (cache lokal)';
                    cacheStatus.className = 'text-xs text-green-500';
                    cacheStatus.classList.remove('hidden');
                    setTimeout(() => cacheStatus.classList.add('hidden'), 3000);
                }
            }
        } catch (e) {}
    }

    // 2. Kalau online, refresh cache dari server (data selalu terbaru)
    if (navigator.onLine) {
        const cacheStatus = document.getElementById('scanCacheStatus');
        if (cacheStatus && !siswaLocalCacheLoaded) {
            cacheStatus.textContent = '⏳ Memuat data siswa...';
            cacheStatus.className = 'text-xs text-yellow-500';
            cacheStatus.classList.remove('hidden');
        }
        callGAS('getSiswaForScanCache').then(res => {
                if (res.success) {
                    siswaLocalCache = {};
                    res.data.forEach(s => { siswaLocalCache[s.nisn] = { nama: s.nama, kelas: s.kelas }; });
                    siswaLocalCacheLoaded = true;
                    try { localStorage.setItem('siswaLocalCache_v1', JSON.stringify(siswaLocalCache)); } catch (e) {}
                    if (cacheStatus) {
                        cacheStatus.textContent = '✅ ' + res.data.length + ' siswa siap discan';
                        cacheStatus.className = 'text-xs text-green-500';
                        cacheStatus.classList.remove('hidden');
                        setTimeout(() => cacheStatus.classList.add('hidden'), 3000);
                    }
                }
            }).catch(() => {
                if (cacheStatus && !siswaLocalCacheLoaded) {
                    cacheStatus.textContent = '⚠️ Gagal muat data, gunakan cache lama jika ada';
                    cacheStatus.className = 'text-xs text-red-400';
                    cacheStatus.classList.remove('hidden');
                }
            });
    }
}

    function setScanMode(mode) {}

    // ============================================================
    // CAMERA POPUP - localStorage polling (bypass GAS iframe)
    // ============================================================
    let cameraPopup = null;
    let pollingInterval = null;
    const LS_KEY = 'gas_qr_result';

    function stopPolling() {
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.add('hidden');
    }

    // Listener postMessage dari popup kamera (metode utama, lebih andal dari localStorage)
    window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== 'QR_SCAN_RESULT') return;
        var nisn = event.data.nisn;
        if (!nisn || typeof nisn !== 'string') return;
        if (event.data.ts && (Date.now() - event.data.ts) > 30000) return;
        // JANGAN tutup popup & JANGAN stop polling — biarkan kamera tetap hidup untuk antrian berikutnya
        onScanSuccess(nisn);
    });

    function startPolling() {
        stopPolling();
        try { localStorage.removeItem(LS_KEY); } catch(e) {}
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.remove('hidden');

        pollingInterval = setInterval(() => {
            if (cameraPopup && cameraPopup.closed) {
                cameraPopup = null;
                stopPolling();
                return;
            }
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (Date.now() - data.ts > 30000) { localStorage.removeItem(LS_KEY); return; }
                localStorage.removeItem(LS_KEY);
                // JANGAN stop polling & JANGAN tutup popup — kamera harus tetap hidup untuk antrian
                onScanSuccess(data.nisn);
            } catch(e) {}
        }, 300);
    }

    function openCameraPopup() {
        openInlineScanner({
            title: '&#128247; SCAN QR ABSENSI',
            onDetect: (text) => { onScanSuccess(text); }
        });
    }

    function scanFromFile(input) {
        if (!input.files || !input.files[0]) return;
        const resDiv = document.getElementById('fileResult');
        resDiv.innerHTML = `<div class="text-center text-indigo-600 text-sm py-3 animate-pulse"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memindai QR...</div>`;
        Html5Qrcode.scanFile(input.files[0], true)
            .then(decodedText => { resDiv.innerHTML = ''; onScanSuccess(decodedText); })
            .catch(() => { resDiv.innerHTML = `<div class="bg-red-50 text-red-600 p-3 rounded-xl border border-red-100 text-xs text-center">QR tidak terdeteksi. Coba foto lebih dekat.</div>`; });
        input.value = '';
    }

    function submitManualNisn() {
        const nisn = document.getElementById('manualNisn')?.value?.trim();
        if (!nisn) { showAlert('error', 'Masukkan NISN terlebih dahulu'); return; }
        document.getElementById('manualNisn').value = '';
        onScanSuccess(nisn);
    }

function onScanSuccess(decodedText) {
    if (!decodedText || decodedText.trim() === "" || decodedText === "undefined") return;
    if (isScanning) return;

    const key = String(decodedText).replace(/[^a-zA-Z0-9]/g, '').trim();

    // Cegah scan duplikat
    if (scanLiveMap[key]) {
    const tr = scanLiveMap[key];
    const namaEl  = tr ? tr.querySelector('td:nth-child(2) .font-bold') : null;
    const kelasEl = tr ? tr.querySelector('td:nth-child(3) span') : null;
    const namaDup = namaEl ? namaEl.textContent : key;
    highlightScanRow(tr, document.getElementById('scanTableWrapper'));
    dhPlayBeep && dhPlayBeep('success');
    showBigScanPopup({ type: 'success', nama: namaDup, id: key, customMsg: 'Sudah ada di antrian' });
    if (cameraPopup && !cameraPopup.closed) {
        try { cameraPopup.postMessage({ type: 'SCAN_DUPLICATE', nama: namaDup, kelas: kelasEl ? kelasEl.textContent : '' }, '*'); } catch(e) {}
    }
    return;
}
    isScanning = true;

    if (siswaLocalCacheLoaded && Object.keys(siswaLocalCache).length > 0) {
        // ✅ Lookup lokal — instan tanpa server
        const found = siswaLocalCache[key];
        isScanning = false;
        if (found) {
            addToScanQueue({ nisn: key, nama: found.nama, kelas: found.kelas });
            showBigScanPopup({ type: 'success', nama: found.nama });
            if (cameraPopup && !cameraPopup.closed) {
                try { cameraPopup.postMessage({ type: 'SCAN_SUCCESS', nama: found.nama, kelas: found.kelas }, '*'); } catch(e) {}
            }
        } else {
            showAlert('error', 'NISN [' + key + '] tidak terdaftar');
            showBigScanPopup({ type: 'error', customMsg: 'NISN tidak terdaftar' });
            if (cameraPopup && !cameraPopup.closed) {
                try { cameraPopup.postMessage({ type: 'SCAN_ERROR', message: 'NISN tidak terdaftar' }, '*'); } catch(e) {}
            }
        }
    } else {
        // ⏳ Fallback ke server jika cache belum siap
        callGAS('lookupSiswaForScan', key).then(result => {
                isScanning = false;
                if (result.success) {
                    addToScanQueue({ nisn: key, nama: result.nama, kelas: result.kelas });
                    showBigScanPopup({ type: 'success', nama: result.nama });
                    if (cameraPopup && !cameraPopup.closed) {
                        try { cameraPopup.postMessage({ type: 'SCAN_SUCCESS', nama: result.nama, kelas: result.kelas }, '*'); } catch(e) {}
                    }
                } else {
                    showAlert('error', result.message || 'NISN tidak ditemukan');
                    showBigScanPopup({ type: 'error', customMsg: result.message || 'NISN tidak ditemukan' });
                    if (cameraPopup && !cameraPopup.closed) {
                        try { cameraPopup.postMessage({ type: 'SCAN_ERROR', message: result.message || 'NISN tidak ditemukan' }, '*'); } catch(e) {}
                    }
                }
            }).catch(err => {
                isScanning = false;
                showAlert('error', 'Error lookup: ' + (err.message || String(err)));
                showBigScanPopup({ type: 'error', customMsg: String(err.message || err) });
            });
    }
}

    function showScanModal(content) {}
    function closeScanModal() { isScanning = false; }

    // ==========================================================================
    // SCAN KOLEKTIF — antrian lokal, kirim sekaligus ke server
    // ==========================================================================

    function addToScanQueue(siswa) {
        const tbody   = document.getElementById('tbody-scan-live');
        const wrapper = document.getElementById('scanTableWrapper');
        if (!tbody) return;

        const emptyRow = document.getElementById('scan-empty-row');
        if (emptyRow) emptyRow.remove();

        const now = new Date();
        const jamScan = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        scanLiveCount++;
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-50 transition-colors duration-700 scan-row-highlight';
        tr.setAttribute('data-nisn', siswa.nisn);
        tr.innerHTML = `
            <td class="px-3 py-3 text-center text-xs text-gray-400 font-mono">${scanLiveCount}</td>
            <td class="px-4 py-3">
                <div class="font-bold text-sm text-gray-900">${siswa.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${siswa.nisn}</div>
            </td>
            <td class="px-3 py-3 text-center">
                <span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold border border-indigo-100">${siswa.kelas}</span>
            </td>
            <td class="px-3 py-3 text-center text-xs font-mono text-gray-600">${jamScan}</td>
            <td class="px-3 py-3 text-center">
                <button onclick="removeScanRow(this, '${siswa.nisn}')" class="w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-100 hover:text-red-500 transition mx-auto" title="Hapus dari antrian">
                    <i class="fas fa-times text-[10px]"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
        scanLiveMap[siswa.nisn] = tr;

        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = scanLiveCount + ' Siswa';
        updateBatchBtn();
        highlightScanRow(tr, wrapper);
    }

    function removeScanRow(btn, nisn) {
        const tr = btn.closest('tr');
        if (!tr) return;
        tr.remove();
        delete scanLiveMap[nisn];

        const rows = document.querySelectorAll('#tbody-scan-live tr[data-nisn]');
        rows.forEach((r, i) => { r.cells[0].textContent = i + 1; });
        scanLiveCount = rows.length;

        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = scanLiveCount + ' Siswa';

        if (scanLiveCount === 0) {
            const tbody = document.getElementById('tbody-scan-live');
            tbody.innerHTML = `<tr id="scan-empty-row"><td colspan="5" class="py-16 text-center">
                <div class="flex flex-col items-center gap-3">
                    <i class="fas fa-qrcode text-5xl text-gray-200"></i>
                    <p class="font-semibold text-sm text-gray-400">Belum ada siswa dalam antrian</p>
                    <p class="text-xs text-gray-300">Scan QR untuk menambahkan siswa</p>
                </div></td></tr>`;
        }
        updateBatchBtn();
    }

    function updateBatchBtn() {
        const btn   = document.getElementById('btnSubmitBatch');
        const label = document.getElementById('btnSubmitBatchLabel');
        if (!btn) return;
        if (scanLiveCount > 0) {
            btn.disabled = false;
            btn.style.pointerEvents = '';
            btn.className = 'w-full py-4 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-md shadow-emerald-200';
            label.textContent = `Kirim Absensi (${scanLiveCount} Siswa)`;
        } else {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.className = 'w-full py-4 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-gray-200 text-gray-400 cursor-not-allowed';
            label.textContent = 'Kirim Absensi (0 Siswa)';
        }
    }

    function submitBatchAbsensi() {
    if (scanLiveCount === 0) return;

    const rows = document.querySelectorAll('#tbody-scan-live tr[data-nisn]');
    const nisnList = Array.from(rows).map(r => r.getAttribute('data-nisn'));

    const myRole  = currentUser ? currentUser.role  : '';
    const myKelas = currentUser ? currentUser.kelas : '';

    Swal.fire({
        title: `Kirim ${nisnList.length} Absensi?`,
        html: `<p style="color:#6b7280;font-size:13px">Data akan dikirim sekaligus ke server dan dicatat secara permanen. Jika sedang offline, data akan disimpan lokal dan dikirim otomatis saat online kembali.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '\u2713 Ya, Kirim Sekarang',
        cancelButtonText: 'Batal'
    }).then(res => {
        if (!res.isConfirmed) return;
        showLoading();
        callGASOffline('batchScanAbsensi', nisnList, myRole, myKelas).then(result => {
                hideLoading();
                if (result.offline) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Tersimpan Offline',
                        html: `<p style="font-size:13px;color:#6b7280">${nisnList.length} data absensi disimpan lokal di perangkat ini dan akan otomatis terkirim ke server saat koneksi internet kembali tersedia.</p>`,
                        confirmButtonText: 'Mengerti'
                    });
                    resetScanTable();
                } else if (result.success) {
                    showBatchResultModal(result.results);
                    resetScanTable();
                } else {
                    Swal.fire('Gagal', result.message, 'error');
                }
            }).catch(err => {
                hideLoading();
                Swal.fire('Error Server', err.message || String(err), 'error');
            });
    });
}
  
function showBatchResultModal(results) {
    const isAlready = r => !r.success && isSudahAbsenMsg(r.message);
    const berhasil = results.filter(r => r.success || isAlready(r));
    const gagal    = results.filter(r => !r.success && !isAlready(r));

    const berhasilHtml = berhasil.map(r => {
        const sudah = !r.success; // masuk kategori "sudah absen"
        return `<div class="flex items-center gap-2 py-1 border-b border-gray-50">
            <span class="text-emerald-500 text-xs">\u2713</span>
            <div class="flex-1 text-left">
                <span class="font-semibold text-xs text-gray-800">${r.nama}</span>
                <span class="text-[10px] text-gray-400">(${r.kelas || ''})</span>
                ${sudah ? '<span class="text-[10px] text-amber-500 ml-1">— sudah absen</span>' : ''}
            </div>
            <span class="text-[10px] text-gray-400 font-mono">${r.jamDatang || r.jamPulang || ''}</span>
            ${r.type ? `<span class="text-[10px] px-1.5 py-0.5 rounded ${r.type==='datang' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}">${r.type==='datang' ? 'Masuk' : 'Pulang'}</span>` : ''}
        </div>`;
    }).join('');

    const gagalHtml = gagal.length > 0 ? `
        <div class="mt-3 bg-red-50 rounded-xl p-3 border border-red-100">
            <p class="text-xs font-bold text-red-600 mb-2"><i class="fas fa-exclamation-triangle mr-1"></i> ${gagal.length} Gagal</p>
            ${gagal.map(r => `<div class="text-xs text-red-500 py-0.5">\u2022 ${r.nama || r.nisn}: ${r.message}</div>`).join('')}
        </div>` : '';

    Swal.fire({
        title: `<span style="font-size:18px">\u2705 Absensi Tersimpan</span>`,
        html: `
            <div style="text-align:center;margin-bottom:12px">
                <span style="font-size:13px;color:#6b7280">${berhasil.length} dari ${results.length} data berhasil disimpan</span>
            </div>
            <div style="max-height:300px;overflow-y:auto;text-align:left;padding:0 4px">
                ${berhasilHtml}
            </div>
            ${gagalHtml}`,
        icon: berhasil.length === results.length ? 'success' : 'warning',
        confirmButtonText: 'Tutup',
        confirmButtonColor: '#111827',
    });
}


    function highlightScanRow(tr, wrapper) {
        document.querySelectorAll('.scan-row-highlight').forEach(el => el.classList.remove('scan-row-highlight'));
        tr.classList.add('scan-row-highlight');
        const wrapperEl = wrapper || document.getElementById('scanTableWrapper');
        if (wrapperEl && tr) {
            wrapperEl.scrollTo({ top: tr.offsetTop - (wrapperEl.clientHeight / 2) + (tr.offsetHeight / 2), behavior: 'smooth' });
        }
        setTimeout(() => tr.classList.remove('scan-row-highlight'), 3000);
    }

    function resetScanTable() {
        const tbody = document.getElementById('tbody-scan-live');
        if (!tbody) return;
        tbody.innerHTML = `<tr id="scan-empty-row"><td colspan="5" class="py-16 text-center">
            <div class="flex flex-col items-center gap-3">
                <i class="fas fa-qrcode text-5xl text-gray-200"></i>
                <p class="font-semibold text-sm text-gray-400">Belum ada siswa dalam antrian</p>
                <p class="text-xs text-gray-300">Scan QR untuk menambahkan siswa</p>
            </div></td></tr>`;
        scanLiveCount = 0;
        scanLiveMap   = {};
        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = '0 Siswa';
        updateBatchBtn();
    }

    function updateScanLiveTable() {}

    function stopAndBack(redirect = true) {
        stopPolling();
        closeInlineScanner();
        if (cameraPopup && !cameraPopup.closed) { cameraPopup.close(); cameraPopup = null; }
        if (html5QrCode) { try { html5QrCode.stop().catch(() => {}); } catch(e) {} html5QrCode = null; }
        isScanning = false;
        if (redirect && currentUser) returnToDashboard();
    }
    function returnToDashboard() {
        if(currentUser.role === 'admin') loadAdminDashboard();
        else if(currentUser.role === 'guru') loadGuruDashboard();
        else loadSiswaDashboard();
    }

    // --- MODALS ---
    function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
    function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

    function showModal(content) {
        const container = document.getElementById('modalContainer');
        container.innerHTML = `
            <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onclick="closeModal()"></div>
                <div class="relative w-full max-w-2xl transform transition-all animate-fade-in">
                    ${content}
                </div>
            </div>`;
    }

    function closeModal() { document.getElementById('modalContainer').innerHTML = ''; }

    function showAlert(type, message) {
        const bg = type === 'success' ? 'bg-green-600' : 'bg-red-600';
        const div = document.createElement('div');
        div.className = `fixed top-6 right-6 ${bg} text-white px-6 py-4 rounded-xl shadow-2xl z-[80] flex items-center font-medium animate-fade-in transform translate-y-2`;
        div.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'} mr-3 text-xl"></i> ${message}`;
        document.body.appendChild(div);
        setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
    }

    // --- MODAL GENERATORS (SISWA & GURU) ---
    function showAddSiswaModal() { showModal(createSiswaModal()); }
    function editSiswa(s) { showModal(createSiswaModal(s)); }
    
    function showAddGuruModal() { showModal(createGuruModal()); }
    function editGuru(guruData) { showModal(createGuruModal(guruData)); }

    function createSiswaModal(s = null) {
        const isEdit = s !== null;
        const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 transition-all";
        const labelClass = "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";
        
        return `
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800">${isEdit ? 'Edit Data Siswa' : 'Registrasi Siswa Baru'}</h3>
                <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6 max-h-[75vh] overflow-y-auto">
                <form onsubmit="saveSiswa(event, ${isEdit})" class="space-y-5">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div class="md:col-span-2">
                            <label class="${labelClass}">Nama Lengkap</label>
                            <input type="text" name="nama" value="${s?.nama || ''}" required class="${inputClass}" placeholder="Sesuai Akta Kelahiran">
                        </div>
                        <div>
                            <label class="${labelClass}">NISN</label>
                            <input type="number" name="nisn" value="${s?.nisn || ''}" required ${isEdit ? 'readonly class="' + inputClass + ' opacity-60 cursor-not-allowed"' : `class="${inputClass}"`} placeholder="Nomor Induk">
                        </div>
                        
                        <div class="relative group">
                            <label class="${labelClass}">Kelas</label>
                            <input type="text" name="kelas" id="inputKelas" 
                                value="${s?.kelas || ''}" 
                                required 
                                class="${inputClass}" 
                                placeholder="Ketik atau pilih kelas" 
                                autocomplete="off"
                                onfocus="openKelasDropdown()"
                                oninput="filterKelasDropdown(this.value)"
                                onblur="closeKelasDropdown()">
                            <div id="dropdownKelasList" class="hidden absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto mt-1 scrollbar-hide"></div>
                        </div>

                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div>
                            <label class="${labelClass}">Jenis Kelamin</label>
                            <select name="jenisKelamin" class="${inputClass}">
                                <option value="Laki-laki" ${s?.jenisKelamin === 'Laki-laki' ? 'selected' : ''}>Laki-laki</option>
                                <option value="Perempuan" ${s?.jenisKelamin === 'Perempuan' ? 'selected' : ''}>Perempuan</option>
                            </select>
                        </div>
                        <div>
                            <label class="${labelClass}">Tanggal Lahir</label>
                            <input type="date" name="tanggalLahir" value="${s?.tanggalLahir || ''}" required class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">Agama</label>
                            <select name="agama" class="${inputClass}">
                                <option value="Islam" ${s?.agama === 'Islam' ? 'selected' : ''}>Islam</option>
                                <option value="Kristen" ${s?.agama === 'Kristen' ? 'selected' : ''}>Kristen</option>
                                <option value="Katolik" ${s?.agama === 'Katolik' ? 'selected' : ''}>Katolik</option>
                                <option value="Hindu" ${s?.agama === 'Hindu' ? 'selected' : ''}>Hindu</option>
                                <option value="Buddha" ${s?.agama === 'Buddha' ? 'selected' : ''}>Buddha</option>
                                <option value="Lainnya" ${s?.agama === 'Lainnya' ? 'selected' : ''}>Lainnya</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div>
                            <label class="${labelClass}">Nama Ayah</label>
                            <input type="text" name="namaAyah" value="${s?.namaAyah || ''}" class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">Nama Ibu</label>
                            <input type="text" name="namaIbu" value="${s?.namaIbu || ''}" class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">No. Handphone</label>
                            <input type="tel" name="noHp" value="${s?.noHp || ''}" class="${inputClass}">
                        </div>
                    </div>
                    <div>
                        <label class="${labelClass}">Alamat Lengkap</label>
                        <textarea name="alamat" rows="2" class="${inputClass}">${s?.alamat || ''}</textarea>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Batal</button>
                        <button type="submit" class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition transform active:scale-95">Simpan Data</button>
                    </div>
                    ${isEdit ? `<input type="hidden" name="oldNisn" value="${s.nisn}">` : ''}
                </form>
            </div>
        </div>`;
    }

// Fungsi Trigger untuk menampilkan modal
    function viewSiswa(siswa) {
        showModal(createViewSiswaModal(siswa));
    }

    // Fungsi Generator HTML Modal Detail
    function createViewSiswaModal(s) {
        // Helper untuk styling label dan value agar rapi
        const item = (label, value, icon) => `
            <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div class="flex items-center gap-2 mb-1">
                    <i class="fas ${icon} text-gray-400 text-xs"></i>
                    <span class="text-[10px] uppercase font-bold text-gray-500 tracking-wider">${label}</span>
                </div>
                <div class="text-sm font-bold text-gray-800 break-words">${value || '-'}</div>
            </div>
        `;

        return `
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full animate-fade-in relative">
            
            <div class="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white flex justify-between items-start">
                <div class="flex gap-4 items-center">
                    <div class="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-2xl font-bold border-2 border-white/30 shadow-inner">
                        ${s.nama.charAt(0)}
                    </div>
                    <div>
                        <h3 class="text-xl font-bold tracking-tight">${s.nama}</h3>
                        <p class="opacity-90 text-sm flex items-center gap-2">
                            <i class="far fa-id-card"></i> ${s.nisn}
                            <span class="bg-white/20 px-2 py-0.5 rounded text-xs font-bold ml-2">${s.kelas}</span>
                        </p>
                    </div>
                </div>
                <button onclick="closeModal()" class="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition text-white">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="p-6 max-h-[70vh] overflow-y-auto">
                
                <div class="mb-6">
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-user-circle"></i> Data Pribadi
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        ${item('Jenis Kelamin', s.jenisKelamin, 'fa-venus-mars')}
                        ${item('Tanggal Lahir', s.tanggalLahir, 'fa-birthday-cake')}
                        ${item('Agama', s.agama, 'fa-pray')}
                        ${item('No. Handphone', s.noHp, 'fa-phone')}
                    </div>
                </div>

                <div class="mb-6">
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-users"></i> Data Orang Tua
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        ${item('Nama Ayah', s.namaAyah, 'fa-male')}
                        ${item('Nama Ibu', s.namaIbu, 'fa-female')}
                    </div>
                </div>

                <div>
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-map-marker-alt"></i> Alamat Lengkap
                    </h4>
                    <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 flex gap-3 items-start">
                        <i class="fas fa-home text-gray-400 mt-1"></i>
                        <p class="text-sm text-gray-700 leading-relaxed font-medium">
                            ${s.alamat || 'Alamat belum diisi.'}
                        </p>
                    </div>
                </div>

            </div>

            <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
                <button onclick="editSiswa(${JSON.stringify(s).replace(/"/g, '&quot;')})" class="px-5 py-2.5 bg-amber-100 text-amber-700 rounded-xl font-bold text-sm hover:bg-amber-200 transition flex items-center gap-2">
                    <i class="fas fa-edit"></i> Edit Data
                </button>
                <button onclick="closeModal()" class="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-300 transition">
                    Tutup
                </button>
            </div>
        </div>`;
    }

// UPDATE: Modal Guru kini mendukung MULTI-KELAS (checkbox)
    function createGuruModal(guru = null) {
    const isEdit = guru !== null;
    const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-purple-500 focus:border-purple-500 block p-3 transition-all mb-4";

    const selectedKelas = guru && guru.kelas
        ? String(guru.kelas).split(',').map(k => k.trim()).filter(Boolean)
        : [];

    let kelasCheckboxes = '';
    if (existingClasses && existingClasses.length > 0) {
        kelasCheckboxes = existingClasses.map(k => {
            const checked = selectedKelas.includes(k) ? 'checked' : '';
            return `<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-purple-50 cursor-pointer transition">
                <input type="checkbox" name="kelas_cb" value="${k}" ${checked} class="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer">
                <span class="text-sm text-gray-700 font-medium">${k}</span></label>`;
        }).join('');
    } else {
        kelasCheckboxes = '<p class="text-xs text-gray-400 px-3 py-2">Belum ada data kelas</p>';
    }

    return `
    <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        <div class="text-center mb-6">
            <div class="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm"><i class="fas fa-chalkboard-teacher"></i></div>
            <h3 class="font-bold text-xl text-gray-800">${isEdit ? 'Edit Data Guru' : 'Tambah Guru'}</h3>
            ${isEdit && guru.idGuru ? `<p class="text-xs text-amber-600 font-mono font-bold mt-1">ID: ${guru.idGuru}</p>` : `<p class="text-xs text-gray-400 mt-1">ID Guru akan dibuat otomatis</p>`}
        </div>

        <form onsubmit="saveGuru(event, ${isEdit})">
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Nama Lengkap</label>
            <input name="namaLengkap" value="${guru?.nama || ''}" placeholder="Nama Lengkap" required class="${inputClass}">

            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Jabatan (pisahkan dengan koma jika lebih dari 1)</label>
            <input name="jabatan" value="${guru?.jabatan || ''}" placeholder="cth: Guru Mapel, Wali Kelas" class="${inputClass}">

            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Username</label>
            <input name="username" value="${guru?.username || ''}" placeholder="Username" required class="${inputClass}">

            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Password</label>
            <input name="password" value="${guru?.password || ''}" placeholder="Password" required class="${inputClass}">

            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Wali Kelas Untuk</label>
            <div class="border border-gray-200 rounded-lg overflow-y-auto mb-1" style="max-height:140px;">${kelasCheckboxes}</div>
            <p class="text-[10px] text-gray-400 mb-4">Centang satu atau lebih kelas. Kosongkan = akses semua.</p>

            ${isEdit ? `<input type="hidden" name="oldUsername" value="${guru.username}">` : ''}

            <div class="flex gap-3 mt-2">
                <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">Batal</button>
                <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95">Simpan</button>
            </div>
        </form>
    </div>`;
}

    // --- FORM ACTIONS (SIMPAN & UPDATE) ---
    // FUNCTION UPDATE: Simpan Guru dengan Loading Button
function saveGuru(e, isEdit) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Menyimpan...';
    btn.classList.add('opacity-75', 'cursor-not-allowed');

    const fd = new FormData(form);
    const namaLengkap = fd.get('namaLengkap');
    const jabatan = fd.get('jabatan');
    const username = "'" + fd.get('username');
    const password = "'" + fd.get('password');
    const checkedKelas = Array.from(form.querySelectorAll('input[name="kelas_cb"]:checked')).map(cb => cb.value);
    const kelas = checkedKelas.join(',');

    const token = currentUser ? currentUser.token : null;

    const onComplete = (r) => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        if (r && r.success) {
            closeModal();
            tableState.guru.fullData = [];
            loadDataGuru();
            showAlert('success', isEdit ? 'Data guru berhasil diperbarui' : 'Akun Guru berhasil dibuat');
        } else {
            showAlert('error', r ? r.message : 'Terjadi kesalahan tidak diketahui');
        }
    };
    const onFailure = (error) => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        showAlert('error', 'Gagal koneksi server: ' + error);
    };

    if (isEdit) {
        const oldUsername = fd.get('oldUsername');
        callGAS('updateGuru', token, oldUsername, namaLengkap, jabatan, username, password, kelas).then(onComplete).catch(onFailure);
    } else {
        callGAS('addGuru', token, namaLengkap, jabatan, username, password, kelas).then(onComplete).catch(onFailure);
    }
}
    
function deleteSiswaConfirm(nisn, nama) {
        // Panggil SweetAlert untuk konfirmasi
        Swal.fire({
            title: 'Apakah Anda yakin?',
            text: `Data siswa "${nama}" akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EF4444', // Warna Merah
            cancelButtonColor: '#6B7280',  // Warna Abu
            confirmButtonText: 'Ya, Hapus!',
            cancelButtonText: 'Batal',
            reverseButtons: true
        }).then((result) => {
            // Jika tombol "Ya, Hapus!" diklik
            if (result.isConfirmed) {
                showLoading(); // Tampilkan loading overlay

                // === KEAMANAN: AMBIL TOKEN ===
                const token = currentUser.token; 

                // Panggil Backend dengan Token
                callGAS('deleteSiswa', token, nisn).then(r => {
                    hideLoading();
                    
                    if (r.success) {
                        // Refresh Tabel Siswa
                        tableState.siswa.fullData = []; // Clear cache
                        loadDataSiswa(); // Reload data
                        
                        // Pesan Sukses
                        Swal.fire(
                            'Terhapus!',
                            'Data siswa berhasil dihapus.',
                            'success'
                        );
                    } else {
                        // Pesan Gagal (Misal: Token expired atau bukan admin)
                        Swal.fire(
                            'Gagal!',
                            r.message,
                            'error'
                        );
                    }
                }).catch(err => {
                    hideLoading();
                    Swal.fire('Error', 'Terjadi kesalahan server: ' + err, 'error');
                }); // <-- PARAMETER TOKEN DITAMBAHKAN DI SINI
            }
        });
    }
// ==========================================================================
    // FITUR IMPORT EXCEL SISWA
    // ==========================================================================
    
    function triggerImportSiswa() {
        document.getElementById('fileInputSiswa').click();
    }

function handleFileImportSiswa(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); // Tampilkan loading overlay

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Ambil sheet pertama
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Konversi ke JSON
            // defval: "" memastikan sel kosong tetap terbaca sebagai string kosong
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; // Reset input
                return;
            }

            // === VALIDASI HEADER (DIPERBAIKI) ===
            const firstRow = jsonData[0];

            // Cek apakah ada kolom 'Nama' ATAU 'Nama Lengkap'
            const hasNama = firstRow.hasOwnProperty('Nama') || firstRow.hasOwnProperty('Nama Lengkap');
            // Cek apakah ada kolom 'NISN'
            const hasNISN = firstRow.hasOwnProperty('NISN');

            if (!hasNama || !hasNISN) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Nama (atau Nama Lengkap) dan NISN.');
                input.value = '';
                return;
            }
            // ====================================

            // Kirim ke Backend
            processImportSiswa(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

function processImportSiswa(data, inputElement) {
        // Mapping data Excel ke Format Database
        // Menggunakan operator || (OR) agar bisa membaca variasi nama kolom
        
        const formattedData = data.map(row => {
            // Helper untuk membersihkan data string
            const clean = (val) => (val ? String(val).trim() : '');

            return {
                // Prioritas 1: Nama Lengkap, Prioritas 2: Nama
                nama: clean(row['Nama Lengkap'] || row['Nama']),
                
                // NISN (Hapus kutip jika ada)
                nisn: clean(row['NISN']).replace(/'/g, ""), 
                
                // Prioritas 1: Jenis Kelamin, Prioritas 2: JK
                jenisKelamin: clean(row['Jenis Kelamin'] || row['JK']), 
                
                // Prioritas 1: Tanggal Lahir, Prioritas 2: Tgl Lahir
                // Pastikan format di Excel Text (YYYY-MM-DD) atau Date
                tanggalLahir: clean(row['Tanggal Lahir'] || row['Tgl Lahir']), 
                
                agama: clean(row['Agama']),
                
                namaAyah: clean(row['Nama Ayah']),
                
                namaIbu: clean(row['Nama Ibu']),
                
                // Prioritas 1: No Handphone, Prioritas 2: HP, Prioritas 3: No HP
                noHp: clean(row['No Handphone'] || row['HP'] || row['No HP']),
                
                kelas: clean(row['Kelas']),
                
                alamat: clean(row['Alamat'])
            };
        });

        // Debugging: Cek data pertama di console browser jika ingin memastikan
        console.log("Data Siap Import:", formattedData[0]);

        callGAS('importSiswaBulk', formattedData).then(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    tableState.siswa.fullData = [];
                    loadDataSiswa(); 
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            }).catch(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            });
    }


// ==========================================================================
    // FITUR IMPORT EXCEL GURU
    // ==========================================================================
    
    function triggerImportGuru() {
        document.getElementById('fileInputGuru').click();
    }

    function handleFileImportGuru(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); 

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; 
                return;
            }

            // Validasi Header
            const firstRow = jsonData[0];
            // Kita cek header 'Username' dan 'Password'
            const hasUser = firstRow.hasOwnProperty('Username');
            const hasPass = firstRow.hasOwnProperty('Password');

            if (!hasUser || !hasPass) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Username dan Password.');
                input.value = '';
                return;
            }

            processImportGuru(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

    function processImportGuru(data, inputElement) {
        // Mapping data Excel ke Format Database
        const formattedData = data.map(row => {
            const clean = (val) => (val ? String(val).trim() : '');
            return {
                username: clean(row['Username']),
                password: clean(row['Password']),
                // Opsional: Jika guru tersebut adalah Wali Kelas
                kelas: clean(row['Kelas'] || row['Wali Kelas']) 
            };
        });

        callGAS('importGuruBulk', formattedData).then(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    tableState.guru.fullData = []; // Clear cache
                    loadDataGuru(); // Reload tabel
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Guru Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            }).catch(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            });
    }

// ==========================================
// LOGIKA REKAP BULANAN
// ==========================================

function loadMenuRekapBulanan() {
    stopAndBack(false);
    setActiveMenu('Rekap Bulanan');
    showView('view-rekap-bulanan');

    // Setup Dropdown Tahun (5 tahun ke belakang)
    const selectTahun = document.getElementById('rekapTahun');
    const currentYear = new Date().getFullYear();
    selectTahun.innerHTML = '';
    for(let i = 0; i < 5; i++) {
        let yr = currentYear - i;
        let opt = document.createElement('option');
        opt.value = yr;
        opt.text = yr;
        selectTahun.appendChild(opt);
    }

    // Setup Dropdown Bulan (Default bulan ini)
    const selectBulan = document.getElementById('rekapBulan');
    selectBulan.value = new Date().getMonth();

    // Setup Dropdown Kelas
    const selectKelas = document.getElementById('rekapKelas');
    const fillDropdown = () => {
        // Jika role guru, hanya tampilkan kelas yang diajarkan
        if (currentUser && currentUser.role === 'guru' && currentUser.kelas) {
            const guruKelas = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);
            selectKelas.innerHTML = '';
            guruKelas.forEach(kelas => {
                const option = document.createElement('option');
                option.value = kelas;
                option.textContent = kelas;
                selectKelas.appendChild(option);
            });
            // Auto-select kelas pertama jika hanya ada 1 kelas
            if (guruKelas.length === 1) {
                selectKelas.value = guruKelas[0];
            }
        } else {
            selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
            if (existingClasses && existingClasses.length > 0) {
                existingClasses.forEach(kelas => {
                    const option = document.createElement('option');
                    option.value = kelas;
                    option.textContent = kelas;
                    selectKelas.appendChild(option);
                });
            }
        }
    };

    // Guru: langsung isi dropdown dari data currentUser (tidak perlu fetch)
    if (currentUser && currentUser.role === 'guru' && currentUser.kelas) {
        fillDropdown();
    } else if (existingClasses && existingClasses.length > 0) {
        fillDropdown();
    } else {
        callGAS('getKelasList').then(result => {
            if (result.success) {
                existingClasses = result.data;
                fillDropdown();
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }
}

function loadDataRekapBulanan() {
    const bulan = document.getElementById('rekapBulan').value;
    const tahun = document.getElementById('rekapTahun').value;
    const kelas = document.getElementById('rekapKelas').value;

    const tbody = document.getElementById('tbody-rekap-bulanan');
    const thead = document.getElementById('thead-rekap-bulanan');
    
    tbody.innerHTML = '<tr class="rekap-info-row"><td colspan="10" class="p-8 text-center"><i class="fas fa-circle-notch fa-spin mr-2"></i>Mengambil data...</td></tr>';

    callGAS('getMonthlyReportData', parseInt(bulan), parseInt(tahun), kelas).then(res => {
        if(!res.success) {
            tbody.innerHTML = `<tr class="rekap-info-row"><td colspan="10" class="p-4 text-center text-red-500">${res.message}</td></tr>`;
            return;
        }
        
        const data = res.data; // { daysInMonth, students: [...] }
        
        // 1. RENDER HEADER
        let headerHTML = '<th class="p-3 w-10 text-center bg-gray-100 sticky left-0 z-20">No</th>';
        headerHTML += '<th class="p-3 w-40 bg-gray-100 sticky left-10 z-20">Nama Siswa</th>';
        
        for(let d=1; d<=data.daysInMonth; d++) {
            headerHTML += `<th class="p-1 text-center w-8 text-[10px] border-l border-gray-200">${d}</th>`;
        }
        headerHTML += '<th class="p-2 w-8 text-center bg-green-50 text-green-700 border-l">H</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-yellow-50 text-yellow-700">S</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-blue-50 text-blue-700">I</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-red-50 text-red-700">A</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-orange-50 text-orange-700">B</th>';
        headerHTML += '<th class="p-2 w-12 text-center bg-gray-100">%</th>';
        
        thead.innerHTML = headerHTML;

        const totalCols = 2 + data.daysInMonth + 6;

        // 2. RENDER BODY
        if(data.students.length === 0) {
            tbody.innerHTML = `<tr class="rekap-info-row"><td colspan="${totalCols}" class="p-8 text-center text-gray-400">Tidak ada data siswa.</td></tr>`;
            return;
        }

        const renderSiswaRow = (siswa, nomor) => {
            let row = `<tr class="hover:bg-gray-50 border-b border-gray-100 group">`;
            row += `<td class="p-3 text-center text-gray-500 sticky left-0 bg-white group-hover:bg-gray-50 z-10">${nomor}</td>`;
            row += `<td class="p-3 font-bold text-gray-700 text-xs sticky left-10 bg-white group-hover:bg-gray-50 z-10 truncate max-w-[150px]" title="${siswa.nama}">${siswa.nama}</td>`;
            
            siswa.dailyCodes.forEach(day => {
                let colorClass = '';
                let bgClass = '';
                if(day.isHoliday) bgClass = 'bg-red-50';
                
                if(day.code === 'H') colorClass = 'text-green-600 font-bold';
                else if(day.code === 'S') colorClass = 'text-yellow-600 font-bold bg-yellow-50';
                else if(day.code === 'I') colorClass = 'text-blue-600 font-bold bg-blue-50';
                else if(day.code === 'A') colorClass = 'text-red-600 font-bold bg-red-50';
                else if(day.code === 'B') colorClass = 'text-orange-600 font-bold bg-orange-50';
                else if(day.code === 'L') { colorClass = 'text-red-300'; bgClass = 'bg-red-50'; }
                
                row += `<td class="p-1 text-center text-[10px] border-l border-gray-100 ${colorClass} ${bgClass}">${day.code}</td>`;
            });

            row += `<td class="p-2 text-center text-xs font-bold text-green-700 bg-green-50/30 border-l">${siswa.stats.h}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-yellow-700 bg-yellow-50/30">${siswa.stats.s}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-blue-700 bg-blue-50/30">${siswa.stats.i}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-red-700 bg-red-50/30">${siswa.stats.a}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-orange-700 bg-orange-50/30">${siswa.stats.b}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-gray-700 bg-gray-50">${siswa.stats.percent}%</td>`;
            
            row += `</tr>`;
            return row;
        };

        let rowsHTML = '';

        if (!kelas) {
            // "Semua Kelas" dipilih -> kelompokkan per kelas dengan baris header
            const groups = {};
            data.students.forEach(s => {
                const k = getKelas(s) || 'Tanpa Kelas';
                if (!groups[k]) groups[k] = [];
                groups[k].push(s);
            });

            const sortedKeys = Object.keys(groups).sort(compareKelasNatural);

            sortedKeys.forEach(k => {
                const list = groups[k];
                rowsHTML += `<tr class="rekap-group-header" data-kelas="${k}">
                    <td colspan="${totalCols}" class="p-2 text-left text-xs font-bold text-white bg-indigo-600 sticky left-0 z-10">
                        <i class="fas fa-users mr-1"></i> Kelas ${k} &nbsp;<span class="font-normal opacity-80">(${list.length} siswa)</span>
                    </td>
                </tr>`;
                list.forEach((siswa, i) => { rowsHTML += renderSiswaRow(siswa, i + 1); });
            });
        } else {
            data.students.forEach((siswa, idx) => { rowsHTML += renderSiswaRow(siswa, idx + 1); });
        }
        
        tbody.innerHTML = rowsHTML;

    }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
}

// --- Fungsi bantu: urutkan nama kelas secara natural (1A, 1B, 2A, ... bukan alfabet biasa) ---
function compareKelasNatural(a, b) {
    const parse = (s) => {
        const m = String(s).match(/(\d+)\s*([A-Za-z]*)/);
        return m ? { num: parseInt(m[1], 10), suf: (m[2] || '').toUpperCase() } : { num: 9999, suf: String(s) };
    };
    const pa = parse(a), pb = parse(b);
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suf.localeCompare(pb.suf);
}

function renderRekapTable(result) {
    if (!result.success) {
        document.getElementById('tbody-rekap-bulanan').innerHTML = `<tr><td colspan="100%" class="p-8 text-center text-red-500">${result.message}</td></tr>`;
        return;
    }

    const { daysInMonth, students } = result.data;
    const thead = document.getElementById('thead-rekap-bulanan');
    const tbody = document.getElementById('tbody-rekap-bulanan');

    // --- 1. GENERATE HEADER ---
    let headerHtml = `
        <th class="p-3 w-10 sticky left-0 bg-gray-100 z-20 border-r border-gray-200">No</th>
        <th class="p-3 w-64 sticky left-10 bg-gray-100 z-20 border-r border-gray-200 shadow-sm">Nama Siswa</th>
    `;
    
    // Ambil info libur dari siswa pertama (karena pola libur sama untuk semua)
    // Kita asumsikan siswa pertama ada datanya.
    const sampleDaily = students.length > 0 ? students[0].dailyCodes : [];

    // Loop Header Tanggal
    for (let d = 1; d <= daysInMonth; d++) {
        // Cek apakah hari ini libur berdasarkan data sample
        // index array mulai dari 0, tanggal mulai dari 1. Jadi index = d-1
        const dayInfo = sampleDaily[d-1]; 
        const isHoliday = dayInfo ? dayInfo.isHoliday : false;
        
        // Warna Header: Jika libur, background merah muda, teks merah
        const headerClass = isHoliday 
            ? "bg-red-50 text-red-600 border-red-100 font-bold" 
            : "bg-gray-50 text-gray-600 border-gray-200";

        headerHtml += `<th class="p-1 w-8 text-center border-l ${headerClass} text-[10px]">${d}</th>`;
    }
    
    // Header Statistik
    headerHtml += `
        <th class="p-2 w-10 text-center bg-green-50 text-green-700 border-l-2 border-gray-200">H</th>
        <th class="p-2 w-10 text-center bg-yellow-50 text-yellow-700">S</th>
        <th class="p-2 w-10 text-center bg-blue-50 text-blue-700">I</th>
        <th class="p-2 w-10 text-center bg-red-50 text-red-700">A</th>
        <th class="p-2 w-16 text-center bg-indigo-50 text-indigo-700 font-bold">%</th>
    `;
    thead.innerHTML = headerHtml;

    // --- 2. GENERATE BODY ---
    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100%" class="p-8 text-center text-gray-400">Tidak ada data siswa.</td></tr>';
        return;
    }

    let bodyHtml = '';
    students.forEach((siswa, index) => {
        let dailyCells = '';
        
        siswa.dailyCodes.forEach(day => {
            let bgClass = '';
            let textClass = 'text-gray-400';
            let content = day.code;

            // LOGIKA WARNA BARU
            if (day.isHoliday) {
                // HARI LIBUR: Full Block Warna Merah Muda (Arsir)
                bgClass = 'bg-red-50 pattern-grid-lg'; // pattern opsional
                textClass = 'text-red-300 select-none'; 
                content = ''; // Kosongkan visual atau isi 'L' samar
            } else {
                // HARI EFEKTIF
                if (day.code === 'H') { 
                    bgClass = 'bg-green-100'; 
                    textClass = 'text-green-700 font-bold'; 
                }
                else if (day.code === 'S') { 
                    bgClass = 'bg-yellow-100'; 
                    textClass = 'text-yellow-700 font-bold'; 
                }
                else if (day.code === 'I') { 
                    bgClass = 'bg-blue-100'; 
                    textClass = 'text-blue-700 font-bold'; 
                }
                else if (day.code === 'A') { 
                    // ALPHA: Merah Lebih Gelap/Kontras
                    bgClass = 'bg-red-100'; 
                    textClass = 'text-red-600 font-bold'; 
                }
                else { 
                    content = '-'; 
                }
            }
            
            // Border diperhalus
            const borderClass = day.isHoliday ? 'border-red-50' : 'border-gray-100';
            dailyCells += `<td class="p-1 text-center border ${borderClass} ${bgClass} ${textClass} text-[10px]">${content}</td>`;
        });

        const stats = siswa.stats;
        const percentColor = stats.percent < 70 ? 'text-red-600' : (stats.percent < 90 ? 'text-yellow-600' : 'text-green-600');

        bodyHtml += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-50">
                <td class="p-2 text-center border-r border-gray-200 sticky left-0 bg-white z-10 font-medium text-gray-500">${index + 1}</td>
                <td class="p-2 border-r border-gray-200 sticky left-10 bg-white z-10 shadow-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title="${siswa.nama}">
                    <div class="font-bold text-gray-700 text-xs">${siswa.nama}</div>
                    <div class="text-[10px] text-gray-400">${siswa.nisn}</div>
                </td>
                ${dailyCells}
                <td class="p-1 text-center font-bold text-green-600 bg-green-50/30 border-l-2 border-gray-100">${stats.h}</td>
                <td class="p-1 text-center font-bold text-yellow-600 bg-yellow-50/30">${stats.s}</td>
                <td class="p-1 text-center font-bold text-blue-600 bg-blue-50/30">${stats.i}</td>
                <td class="p-1 text-center font-bold text-red-600 bg-red-50/30">${stats.a}</td>
                <td class="p-1 text-center font-bold ${percentColor} bg-indigo-50 border-l border-gray-200">${stats.percent}%</td>
            </tr>
        `;
    });

    tbody.innerHTML = bodyHtml;
}

function exportRekapBulananExcel() {
    const theadRow = document.getElementById('thead-rekap-bulanan');
    const tbody = document.getElementById('tbody-rekap-bulanan');
    const hasStudentRow = tbody ? tbody.querySelector('tr:not(.rekap-info-row):not(.rekap-group-header)') : null;

    if (!theadRow || !theadRow.children.length || !tbody || !hasStudentRow) {
        showAlert('error', 'Tidak ada data untuk di-export. Silakan pilih filter dan klik Tampilkan dulu.');
        return;
    }

    const btn = document.getElementById('btnExportRekap');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span class="hidden sm:inline">Memproses...</span>';

    try {
        const head = Array.from(theadRow.children).map(th => th.textContent.trim());
        const totalCols = head.length;
        const rows = Array.from(tbody.querySelectorAll('tr'));

        const aoa = [head];
        const merges = [];

        rows.forEach(tr => {
            const rIndex = aoa.length; // baris ke-berapa di sheet (0-based, header sudah di index 0)
            if (tr.classList.contains('rekap-group-header')) {
                const label = tr.querySelector('td') ? tr.querySelector('td').textContent.trim() : '';
                const rowArr = new Array(totalCols).fill('');
                rowArr[0] = '>> ' + label.replace(/\s+/g, ' ').trim();
                aoa.push(rowArr);
                merges.push({ s: { r: rIndex, c: 0 }, e: { r: rIndex, c: totalCols - 1 } });
            } else {
                aoa.push(Array.from(tr.children).map(td => td.textContent.trim()));
            }
        });

        const kelasEl = document.getElementById('rekapKelas');
        const bulanEl = document.getElementById('rekapBulan');
        const tahunEl = document.getElementById('rekapTahun');
        const kelasText = kelasEl && kelasEl.selectedIndex >= 0 ? kelasEl.options[kelasEl.selectedIndex].text : 'Semua Kelas';
        const bulanText = bulanEl && bulanEl.selectedIndex >= 0 ? bulanEl.options[bulanEl.selectedIndex].text : '';
        const tahunText = tahunEl ? tahunEl.value : '';

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;

        ws['!cols'] = head.map((h, i) => {
            if (i === 0) return { wch: 5 };
            if (i === 1) return { wch: 28 };
            return { wch: 4 };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rekap Bulanan');

        const fileKelas = (kelasText || 'Semua_Kelas').replace(/\s+/g, '_');
        const fileName = `Rekap_Bulanan_${fileKelas}_${bulanText}_${tahunText}.xlsx`;
        XLSX.writeFile(wb, fileName);
    } catch (err) {
        console.error(err);
        showAlert('error', 'Gagal membuat Excel: ' + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ==========================================================================
// CETAK PDF - REKAP BULANAN SISWA (A4 Landscape, siap cetak)
// ==========================================================================
let _autoTableLoading = null;
function ensureAutoTableLoaded() {
    if (_autoTableLoading) return _autoTableLoading;
    _autoTableLoading = new Promise((resolve, reject) => {
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) {
            resolve();
            return;
        }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Gagal memuat modul PDF (AutoTable)'));
        document.head.appendChild(s);
    });
    return _autoTableLoading;
}

async function cetakPDFRekapBulanan() {
    const theadRow = document.getElementById('thead-rekap-bulanan');
    const tbody = document.getElementById('tbody-rekap-bulanan');
    const hasStudentRow = tbody.querySelector('tr:not(.rekap-info-row):not(.rekap-group-header)');
    if (!theadRow || !theadRow.children.length || !tbody || !hasStudentRow) {
        showAlert('error', 'Tidak ada data untuk dicetak. Silakan pilih filter dan klik Tampilkan dulu.');
        return;
    }

    const btn = document.getElementById('btnCetakPdfRekap');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span class="hidden sm:inline">Memproses...</span>';

    try {
        await ensureAutoTableLoaded();

      const head = Array.from(theadRow.children).map(th => th.textContent.trim());
      const totalCols = head.length;
      const statColsCount = 6; // H, S, I, A, B, %
      const dayColsCount = Math.max(totalCols - 2 - statColsCount, 0); // dikurangi No & Nama
      const lastDayColIndex = 1 + dayColsCount; // index kolom hari terakhir
      
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const body = rows.map(tr => {
          if (tr.classList.contains('rekap-group-header')) {
              const label = tr.querySelector('td') ? tr.querySelector('td').textContent.trim() : '';
              return [{
                  content: label,
                  colSpan: totalCols,
                  styles: { halign: 'left', fillColor: [67, 56, 202], textColor: [255, 255, 255], fontStyle: 'bold' }
              }];
          }
          return Array.from(tr.children).map(td => td.textContent.trim());
      });

        const kelasEl = document.getElementById('rekapKelas');
        const bulanEl = document.getElementById('rekapBulan');
        const tahunEl = document.getElementById('rekapTahun');
        const kelasText = kelasEl && kelasEl.selectedIndex >= 0 ? kelasEl.options[kelasEl.selectedIndex].text : 'Semua Kelas';
        const bulanText = bulanEl && bulanEl.selectedIndex >= 0 ? bulanEl.options[bulanEl.selectedIndex].text : '';
        const tahunText = tahunEl ? tahunEl.value : '';

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const marginLR = 3;
        const usableWidth = pageWidth - (marginLR * 2);

        const noColWidth = 8;
        const namaColWidth = Math.min(48, Math.max(30, usableWidth * 0.14));
        const statColWidth = Math.min(14, Math.max(9, (usableWidth - noColWidth - namaColWidth) * 0.028));
        const statTotalWidth = statColWidth * statColsCount;
        const remainingForDays = usableWidth - noColWidth - namaColWidth - statTotalWidth;
        const dayColWidth = dayColsCount > 0 ? (remainingForDays / dayColsCount) : 0;

        const columnStyles = {
            0: { cellWidth: noColWidth, halign: 'center' },
            1: { cellWidth: namaColWidth, halign: 'left', fontStyle: 'bold' }
        };
        for (let i = 2; i <= lastDayColIndex; i++) columnStyles[i] = { cellWidth: dayColWidth, halign: 'center' };
        for (let i = lastDayColIndex + 1; i < totalCols; i++) columnStyles[i] = { cellWidth: statColWidth, halign: 'center', fontStyle: 'bold' };

        let bodyFontSize = 9;
        if (dayColWidth < 9) bodyFontSize = 8;
        if (dayColWidth < 7) bodyFontSize = 7;
        if (dayColWidth < 5.5) bodyFontSize = 6;
        if (dayColWidth < 4.2) bodyFontSize = 5.2;

        const colorMap = {
            'H': { fill: [220, 252, 231], text: [21, 128, 61] },
            'S': { fill: [254, 249, 195], text: [161, 98, 7] },
            'I': { fill: [219, 234, 254], text: [29, 78, 216] },
            'A': { fill: [254, 226, 226], text: [185, 28, 28] },
            'B': { fill: [255, 237, 213], text: [194, 65, 12] },
            'L': { fill: [254, 242, 242], text: [252, 165, 165] }
        };

        doc.autoTable({
            head: [head],
            body: body,
            startY: 17,
            margin: { left: marginLR, right: marginLR, bottom: 10 },
            tableWidth: usableWidth,
            theme: 'grid',
            styles: {
                fontSize: bodyFontSize,
                cellPadding: { top: 1.6, bottom: 1.6, left: 0.8, right: 0.8 },
                halign: 'center',
                valign: 'middle',
                lineWidth: 0.15,
                lineColor: [150, 150, 150],
                textColor: [20, 20, 20],
                overflow: 'visible'
            },
            headStyles: {
                fillColor: [67, 56, 202],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: bodyFontSize + 0.5,
                halign: 'center',
                cellPadding: { top: 2, bottom: 2, left: 0.8, right: 0.8 }
            },
            columnStyles: columnStyles,
            didParseCell: function (data) {
                const colIdx = data.column.index;
                if (data.section === 'body' && colIdx > 1 && colIdx <= lastDayColIndex) {
                    const code = (data.cell.raw || '').toString().trim();
                    const c = colorMap[code];
                    if (c) {
                        data.cell.styles.fillColor = c.fill;
                        data.cell.styles.textColor = c.text;
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            },
            didDrawPage: function (data) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(13);
                doc.text('REKAPITULASI ABSENSI BULANAN SISWA', pageWidth / 2, 8, { align: 'center' });
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.text(`Kelas: ${kelasText}   |   Periode: ${bulanText} ${tahunText}`, pageWidth / 2, 13, { align: 'center' });

                doc.setFontSize(7);
                doc.setFont('helvetica', 'italic');
                doc.text('H: Hadir  S: Sakit  I: Izin  A: Alpha  B: Bolos  L: Libur', marginLR, pageHeight - 4);
                doc.text('Dicetak: ' + new Date().toLocaleString('id-ID'), pageWidth - marginLR, pageHeight - 4, { align: 'right' });
                doc.text('Hal. ' + data.pageNumber, pageWidth - marginLR, 13, { align: 'right' });
            }
        });

        const fileKelas = (kelasText || 'Semua_Kelas').replace(/\s+/g, '_');
        const fileName = `Rekap_Bulanan_${fileKelas}_${bulanText}_${tahunText}.pdf`;
        doc.save(fileName);
    } catch (err) {
        console.error(err);
        showAlert('error', 'Gagal membuat PDF: ' + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ==========================================
// LOGIKA KENAIKAN KELAS & ARSIP
// ==========================================

function loadKenaikanKelas() {
    stopAndBack(false);
    setActiveMenu('Kenaikan Kelas');
    showView('view-kenaikan-kelas');
    
    // Reset Form
    document.getElementById('container-promo-siswa').classList.add('hidden');
    document.getElementById('promo-placeholder').classList.remove('hidden');
    
    // Init Dropdown Kelas
    const selAsal = document.getElementById('promoKelasAsal');
    const selTujuan = document.getElementById('promoKelasTujuan');
    
    // Reset options (Keep default and LULUS)
    selAsal.innerHTML = '<option value="">-- Pilih Kelas --</option>';
    selTujuan.innerHTML = '<option value="">-- Pilih Tujuan --</option><option value="LULUS" class="font-bold text-green-600">🎓 LULUS (Alumni)</option>';

    if (existingClasses && existingClasses.length > 0) {
        existingClasses.sort();
        existingClasses.forEach(c => {
            // Isi Kelas Asal
            const opt1 = document.createElement('option');
            opt1.value = c;
            opt1.text = c;
            selAsal.add(opt1);

            // Isi Kelas Tujuan
            const opt2 = document.createElement('option');
            opt2.value = c;
            opt2.text = c;
            selTujuan.add(opt2);
        });
    } else {
        // Fetch jika belum ada cache
        callGAS('getDaftarKelas').then(classes => {
            existingClasses = classes;

            // PERBAIKAN: Jangan panggil loadKenaikanKelas() lagi karena bisa
            // memaksa kembali ke menu ini jika user sudah pindah ke menu lain.
            // Cek dulu apakah view kenaikan kelas masih aktif sebelum mengisi dropdown.
            const viewEl = document.getElementById('view-kenaikan-kelas');
            if (!viewEl || !viewEl.classList.contains('active')) return;

            // Isi dropdown langsung tanpa reload halaman
            if (classes && classes.length > 0) {
                classes.sort();
                classes.forEach(c => {
                    const opt1 = document.createElement('option');
                    opt1.value = c; opt1.text = c;
                    selAsal.add(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = c; opt2.text = c;
                    selTujuan.add(opt2);
                });
            }
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
    }
}

function loadSiswaUntukPromosi() {
    const asal = document.getElementById('promoKelasAsal').value;
    const tujuan = document.getElementById('promoKelasTujuan').value;

    if (!asal || !tujuan) {
        showAlert('error', 'Harap pilih Kelas Asal dan Kelas Tujuan.');
        return;
    }

    if (asal === tujuan) {
        showAlert('error', 'Kelas Asal dan Tujuan tidak boleh sama.');
        return;
    }

    showLoading(); // Overlay loading (buat function ini jika belum ada) atau manual:
    document.getElementById('tbody-promo-siswa').innerHTML = '<tr><td colspan="4" class="p-4 text-center"><i class="fas fa-circle-notch fa-spin"></i> Mengambil data siswa...</td></tr>';
    document.getElementById('container-promo-siswa').classList.remove('hidden');
    document.getElementById('promo-placeholder').classList.add('hidden');

    callGAS('getSiswaByKelas', asal).then(siswaList => {
        hideLoading();
        renderTablePromosi(siswaList, tujuan);
    }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
}

function renderTablePromosi(siswaList, namaKelasTujuan) {
    const tbody = document.getElementById('tbody-promo-siswa');
    tbody.innerHTML = '';

    if (siswaList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500">Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }

    siswaList.forEach((s, i) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition border-b border-gray-50";
        
        // Label tombol switch
        const labelNaik = namaKelasTujuan === 'LULUS' ? 'Lulus' : 'Naik Kelas';
        const classNaik = namaKelasTujuan === 'LULUS' ? 'text-green-600' : 'text-indigo-600';
        
        tr.innerHTML = `
            <td class="p-3 text-center text-gray-500">${i + 1}</td>
            <td class="p-3 font-medium text-gray-800">${s.nama}</td>
            <td class="p-3 text-gray-500 text-xs">${s.nisn}</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-4 promo-row" data-nisn="${s.nisn}" data-nama="${s.nama}">
                    
                    <label class="cursor-pointer flex items-center gap-2 p-2 rounded-lg border border-transparent hover:bg-green-50 transition">
                        <input type="radio" name="status_${s.nisn}" value="NAIK" checked class="w-4 h-4 text-green-600 focus:ring-green-500">
                        <span class="text-xs font-bold ${classNaik}">${labelNaik}</span>
                 
   </label>

                    <label class="cursor-pointer flex items-center gap-2 p-2 rounded-lg border border-transparent hover:bg-red-50 transition">
                        <input type="radio" name="status_${s.nisn}" value="TINGGAL" class="w-4 h-4 text-red-600 focus:ring-red-500">
                        <span class="text-xs font-bold text-red-600">Tinggal Kelas</span>
                    </label>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function executePromotion() {
    const asal = document.getElementById('promoKelasAsal').value;
    const tujuan = document.getElementById('promoKelasTujuan').value;
    
    // Kumpulkan Data
    const rows = document.querySelectorAll('.promo-row');
    const promoData = [];
    let countNaik = 0;
    let countTinggal = 0;

    rows.forEach(row => {
        const nisn = row.getAttribute('data-nisn');
        const nama = row.getAttribute('data-nama');
        // Cari radio button yang checked dalam baris ini
        const status = document.querySelector(`input[name="status_${nisn}"]:checked`).value;
        
        promoData.push({
            nisn: nisn,
            nama: nama,
            status: status // 'NAIK' atau 'TINGGAL'
        });

        if (status === 'NAIK') countNaik++;
        else countTinggal++;
    });

    if (promoData.length === 0) return;

    Swal.fire({
        title: 'Konfirmasi Kenaikan',
        html: `
            Anda akan memproses kelas <b>${asal}</b> ke <b>${tujuan}</b>.<br><br>
            <ul class="text-left text-sm bg-gray-50 p-3 rounded">
                <li>✅ <b>${countNaik}</b> siswa Naik/Lulus</li>
                <li>❌ <b>${countTinggal}</b> siswa Tinggal Kelas</li>
            </ul>
            <br>Lanjutkan?
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        confirmButtonText: 'Ya, Proses!'
    }).then((result) => {
        if (result.isConfirmed) {
            const btn = document.getElementById('btn-eksekusi-promo');
            const originalTxt = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sedang memproses database...';

            callGAS('processIndividualPromotion', asal, tujuan, promoData).then(res => {
                btn.disabled = false;
                btn.innerHTML = originalTxt;
                
                if (res.success) {
                    Swal.fire('Berhasil!', `Data berhasil diperbarui.`, 'success');
                    // Reset View
                    loadKenaikanKelas();
                    // Refresh Cache Data Siswa
                    loadDataSiswa();
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
        }
    });
}
function showModalArsip() {
    Swal.fire({
        title: 'Tutup Tahun Ajaran (Arsip)',
        html: `
            <p class="text-xs text-gray-600 mb-3">Backup data absensi ke file baru & reset database absensi utama.</p>
            <input type="text" id="swal-input-arsip" class="swal2-input" placeholder="Nama File Arsip (misal: Absensi 2024-2025)">
        `,
        showCancelButton: true,
        confirmButtonText: 'Arsipkan & Reset',
        confirmButtonColor: '#d33',
        preConfirm: () => {
            const nama = Swal.getPopup().querySelector('#swal-input-arsip').value;
            if (!nama) Swal.showValidationMessage('Nama arsip wajib diisi');
            return nama;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            // Panggil fungsi backend archiveAndResetYear (sama seperti sebelumnya)
            showLoading();
            callGAS('archiveAndResetYear', result.value).then(res => {
                hideLoading();
                if(res.success) Swal.fire('Sukses', 'Data berhasil diarsipkan', 'success');
                else Swal.fire('Gagal', res.message, 'error');
            }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
        }
    });
}

function showLoading() {
    Swal.fire({
        title: 'Loading...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading() }
    });
}
function hideLoading() {
    Swal.close();
}
function renderMappingTable(classes) {
    const tbody = document.getElementById('tbody-mapping-kelas');
    tbody.innerHTML = '';

    // Sort kelas agar rapi (1A, 1B, 2A...)
    classes.sort();

    classes.forEach(kelasAsal => {
        // Buat opsi dropdown untuk target kelas
        let options = `<option value="">-- Pilih --</option>`;
        options += `<option value="LULUS" class="font-bold text-red-600">🎓 LULUS (Jadi Alumni)</option>`;
        
        classes.forEach(kelasTujuan => {
            // Logika auto-select sederhana (Misal 1-A -> 2-A)
            // Ini opsional, user bisa ganti manual
            options += `<option value="${kelasTujuan}">${kelasTujuan}</option>`;
        });

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition";
        tr.innerHTML = `
            <td class="p-3 font-bold text-gray-700 border-b border-gray-100">
                <input type="hidden" class="input-kelas-asal" value="${kelasAsal}">
                ${kelasAsal}
            </td>
            <td class="p-3 text-center text-gray-400 border-b border-gray-100">
                <i class="fas fa-arrow-right"></i>
            </td>
            <td class="p-3 border-b border-gray-100">
                <select class="input-kelas-tujuan w-full p-1 border border-gray-300 rounded text-sm focus:ring-indigo-500">
                    ${options}
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function processKenaikanKelas() {
    // 1. Kumpulkan Data Mapping
    const mapping = [];
    const rows = document.querySelectorAll('#tbody-mapping-kelas tr');
    let isValid = true;

    rows.forEach(row => {
        const asal = row.querySelector('.input-kelas-asal').value;
        const tujuan = row.querySelector('.input-kelas-tujuan').value;
        
        if (tujuan) {
            mapping.push({ asal: asal, tujuan: tujuan });
        }
    });

    if (mapping.length === 0) {
        showAlert('error', 'Belum ada kenaikan kelas yang dipilih.');
        return;
    }

    // 2. Konfirmasi SweetAlert
    Swal.fire({
        title: 'Konfirmasi Kenaikan?',
        text: `Anda akan memproses ${mapping.length} aturan kenaikan kelas. Data siswa akan berubah permanen!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#4F46E5',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, Proses Sekarang!'
    }).then((result) => {
        if (result.isConfirmed) {
            // UI Loading
            const btn = document.getElementById('btn-proses-naik');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';

            callGAS('processGradePromotion', mapping).then(res => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                
                if (res.success) {
                    Swal.fire('Berhasil!', `Data berhasil diperbarui. ${res.movedCount} siswa dipindahkan/lulus.`, 'success');
                    // Refresh data
                    loadDataSiswa(); // Refresh cache siswa
                    loadKenaikanKelas(); // Reset form
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
        }
    });
}

function processTutupTahun() {
    const namaArsip = document.getElementById('namaArsip').value.trim();
    
    if (!namaArsip) {
        showAlert('error', 'Harap isi Label Arsip terlebih dahulu (Misal: Arsip 2024-2025)');
        return;
    }

    Swal.fire({
        title: 'TUTUP TAHUN AJARAN?',
        html: `Anda akan mengarsipkan data ke file <b>"${namaArsip}"</b> dan <span style="color:red; font-weight:bold;">MENGHAPUS SEMUA DATA ABSENSI</span> di aplikasi ini.<br><br>Tindakan ini tidak dapat dibatalkan!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#059669', // Emerald
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, Saya Paham & Lanjutkan'
    }).then((result) => {
        if (result.isConfirmed) {
            const btn = document.getElementById('btn-proses-arsip');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-cog fa-spin"></i> Mengarsipkan... (Bisa memakan waktu)';

            callGAS('archiveAndResetYear', namaArsip).then(res => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                
                if (res.success) {
                    Swal.fire('Selesai!', `Data absensi berhasil diarsipkan ke spreadsheet baru.<br><a href="${res.url}" target="_blank" class="text-blue-600 underline">Buka Arsip</a>`, 'success');
                    document.getElementById('namaArsip').value = '';
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).catch(err => showAlert('error', 'Gagal koneksi: ' + (err.message || err)));
        }
    });
}


// ==========================================================================
    // FITUR IMPORT EXCEL HARI LIBUR
    // ==========================================================================
    
    function triggerImportLibur() {
        document.getElementById('fileInputLibur').click();
    }

function handleFileImportLibur(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); 

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            
            // --- PERBAIKAN DISINI: Tambahkan cellDates: true ---
            // Opsi ini memaksa SheetJS mengubah angka Excel menjadi Date Object JS yang benar
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            // ----------------------------------------------------
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; 
                return;
            }

            // Validasi Header
            const firstRow = jsonData[0];
            const hasTanggal = firstRow.hasOwnProperty('Tanggal');
            const hasKet = firstRow.hasOwnProperty('Keterangan');

            if (!hasTanggal || !hasKet) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Tanggal dan Keterangan.');
                input.value = '';
                return;
            }

            processImportLibur(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

function processImportLibur(data, inputElement) {
        // Helper: Mengubah Date Object JS ke string "YYYY-MM-DD"
        // Ini penting untuk mencegah tanggal mundur 1 hari karena perbedaan zona waktu
        const formatDateCorrectly = (dateInput) => {
            if (!dateInput) return "";
            
            // Jika input sudah berupa Date Object (karena cellDates: true)
            if (dateInput instanceof Date) {
                const year = dateInput.getFullYear();
                const month = String(dateInput.getMonth() + 1).padStart(2, '0');
                const day = String(dateInput.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            
            // Jika masih string, kembalikan apa adanya
            return String(dateInput).trim();
        };

        // Mapping data Excel ke Format Backend
        const formattedData = data.map(row => {
            const clean = (val) => (val ? String(val).trim() : '');
            
            // Ambil tanggal dan format ulang
            let rawTanggal = row['Tanggal'];
            let fixedTanggal = formatDateCorrectly(rawTanggal);

            return {
                tanggal: fixedTanggal, 
                keterangan: clean(row['Keterangan'])
            };
        });

        callGAS('importHariLiburBulk', formattedData).then(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    loadKelolaAbsen(); 
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Hari Libur Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            }).catch(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            });
    }

// ====================================
// FITUR DOWNLOAD KARTU MASSAL (BULK) - LOGO DARI URL (Google Drive)
// ====================================
//
// CATATAN:
// - Logo tunggal dari server GAS, dipakai untuk header dan watermark (grayscale).
// - Header solid satu warna, tanpa glassmorphism.
// - Nama: auto-shrink berdasarkan lebar teks asli (bukan jumlah karakter).
// - NISN, Kelas, Alamat: font TETAP (tidak auto-shrink), dipotong "..." kalau kepanjangan.
// - Bagian atas QR sejajar dengan bagian atas teks Nama.

let _cachedLogoBase64 = null;
let _cachedLogoGrayscaleBase64 = null;

function loadLogoAsBase64() {
    if (_cachedLogoBase64) return Promise.resolve(_cachedLogoBase64);
    return new Promise((resolve) => {
        callGAS('getLogoBase64').then((base64) => {
                _cachedLogoBase64 = base64;
                resolve(base64);
            }).catch((err) => {
                console.error("Gagal load logo dari server:", err);
                resolve(null);
            });
    });
}

function loadLogoGrayscaleBase64() {
    if (_cachedLogoGrayscaleBase64) return Promise.resolve(_cachedLogoGrayscaleBase64);

    return new Promise((resolve) => {
        loadLogoAsBase64().then((base64) => {
            if (!base64) return resolve(null);

            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            if (data[i + 3] === 0) continue;
                            const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
                            data[i] = gray;
                            data[i + 1] = gray;
                            data[i + 2] = gray;
                        }
                        ctx.putImageData(imageData, 0, 0);

                        const grayBase64 = canvas.toDataURL('image/png');
                        _cachedLogoGrayscaleBase64 = grayBase64;
                        resolve(grayBase64);
                    } catch (e) {
                        console.error("Gagal konversi logo ke grayscale:", e);
                        resolve(base64);
                    }
                };
                img.onerror = () => {
                    console.error("Gagal load image untuk grayscale conversion");
                    resolve(base64);
                };
                img.src = base64;
            } catch (e) {
                console.error("Gagal konversi logo ke grayscale:", e);
                resolve(base64);
            }
        });
    });
}

// ====================================
// HELPER: Ambil field kelas
// ====================================
function getKelas(s) {
    const raw = s.kelas || s.Kelas || s.KELAS || s.class || s.Class || null;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ====================================
// HELPER: Ambil field alamat
// ====================================
function getAlamat(s) {
    const raw = s.alamat || s.Alamat || s.ALAMAT || s.address || s.Address || null;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ====================================
// HELPER: Format alamat jadi maksimal 3 baris (split by koma), font TETAP (tidak shrink)
// ====================================
function formatAlamatFixedFont(doc, alamat, maxWidth, options = {}) {
    const {
        maxLines = 3,
        fontSize = 7,
        font = "helvetica",
        fontStyle = "bold"
    } = options;

    const text = alamat || "-";
    let parts = text.split(",").map(p => p.trim()).filter(p => p.length > 0);

    if (parts.length > maxLines) {
        const head = parts.slice(0, maxLines - 1);
        const tail = parts.slice(maxLines - 1).join(", ");
        parts = [...head, tail];
    }
    if (parts.length === 0) parts = ["-"];

    doc.setFont(font, fontStyle);
    doc.setFontSize(fontSize);

    parts = parts.map(line => {
        if (doc.getTextWidth(line) <= maxWidth) return line;
        let truncated = line;
        while (doc.getTextWidth(truncated + "...") > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + "...";
    });

    return { lines: parts, fontSize };
}

async function downloadKartuSiswaBulk(nisnListTerpilih) {
    const filterKelas = document.getElementById('filterKelasSiswa').value;
    const allSiswa = (tableState.siswa && tableState.siswa.fullData) ? tableState.siswa.fullData : [];

    if (!allSiswa || allSiswa.length === 0) {
        showAlert('error', 'Data siswa belum dimuat. Refresh data dulu.');
        return;
    }

    let dataToPrint = allSiswa;

    if (nisnListTerpilih && nisnListTerpilih.length > 0) {
        const nisnSet = new Set(nisnListTerpilih.map(String));
        dataToPrint = allSiswa.filter(s => nisnSet.has(String(s.nisn)));
    } else if (filterKelas && filterKelas !== "") {
        dataToPrint = allSiswa.filter(s => s.kelas === filterKelas);
    }

    if (dataToPrint.length === 0) {
        showAlert('error', 'Tidak ada siswa ditemukan.');
        return;
    }

    const kosongKelas = dataToPrint.filter(s => !getKelas(s));
    if (kosongKelas.length > 0) {
        console.warn(
            `⚠️ ${kosongKelas.length} dari ${dataToPrint.length} siswa memiliki kelas kosong:`,
            kosongKelas.map(s => `${s.nama || '(tanpa nama)'} - NISN: ${s.nisn || '-'}`)
        );
    }
    const kosongAlamat = dataToPrint.filter(s => !getAlamat(s));
    if (kosongAlamat.length > 0) {
        console.warn(
            `⚠️ ${kosongAlamat.length} dari ${dataToPrint.length} siswa memiliki alamat kosong:`,
            kosongAlamat.map(s => `${s.nama || '(tanpa nama)'} - NISN: ${s.nisn || '-'}`)
        );
    }

    const result = await Swal.fire({
        title: 'Cetak Kartu Pelajar',
        text: `Mencetak ${dataToPrint.length} kartu. Layout: 10 Kartu per Halaman (A4).`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Cetak Sekarang',
        cancelButtonText: 'Batal'
    });
    if (!result.isConfirmed) return;

    Swal.fire({
        title: 'Generate PDF...',
        html: 'Sedang menyusun kartu...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const [logoBase64, logoWatermarkBase64] = await Promise.all([
        loadLogoAsBase64(),
        loadLogoGrayscaleBase64()
    ]);

    setTimeout(async () => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4'); // A4

            const pageWidth = 210;
            const pageHeight = 297;

            const cardWidth = 89;
            const cardHeight = 52;

            const gapX = 6;
            const gapY = 3;

            const marginX = (pageWidth - ((cardWidth * 2) + gapX)) / 2;
            const marginY = (pageHeight - ((cardHeight * 5) + (gapY * 4))) / 2;

            let x = marginX;
            let y = marginY;
            let col = 0;
            let row = 0;

            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '-9999px';
            document.body.appendChild(tempDiv);

            const headerHeight = 14;
            const accentHeight = 1;

            const tanggalCetak = new Date().toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });

            for (let i = 0; i < dataToPrint.length; i++) {
                const s = dataToPrint[i];

                let rawNisn = s.nisn || "0000";
                let cleanNisn = String(rawNisn).replace(/[^a-zA-Z0-9]/g, "").trim();

                // 1. BACKGROUND & BORDER
                doc.setDrawColor(200, 200, 200);
                doc.setFillColor(255, 255, 255);
                doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

                // 1b. WATERMARK LOGO
                if (logoWatermarkBase64) {
                    try {
                        const bodyTop = y + headerHeight + accentHeight;
                        const bodyHeight = cardHeight - headerHeight - accentHeight;

                        const wmSize = bodyHeight * 0.65;
                        const wmX = x + (cardWidth / 2) - (wmSize / 2);
                        const wmY = bodyTop + (bodyHeight / 2) - (wmSize / 2);

                        doc.saveGraphicsState();
                        doc.setGState(new doc.GState({ opacity: 0.10 }));
                        doc.addImage(logoWatermarkBase64, 'PNG', wmX, wmY, wmSize, wmSize);
                        doc.restoreGraphicsState();
                    } catch (e) {
                        console.error("Gagal menambahkan watermark logo:", e);
                    }
                }

                // 2. HEADER UTAMA
                doc.setFillColor(0, 61, 121);
                doc.rect(x, y, cardWidth, headerHeight, 'F');

                // 3. TEKS HEADER
                const headerTextCenterX = x + (cardWidth / 2);

                doc.setTextColor(255, 255, 255);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(10);
                doc.text("KARTU TANDA PELAJAR", headerTextCenterX, y + 5, { align: 'center' });

                doc.setFontSize(7);
                doc.setFont("helvetica", "bold");
                doc.text("Madrasah Mu'allimin Mu'allimat Manba'ul Huda", headerTextCenterX, y + 8, { align: 'center' });

                doc.setFontSize(5.5);
                doc.setFont("helvetica", "normal");
                doc.text("Pondok Pesantren Sidaraja, Ciawigebang, Kuningan", headerTextCenterX, y + 10.6, { align: 'center' });

                // 4. GARIS AKSEN EMAS
                doc.setFillColor(245, 158, 11);
                doc.rect(x, y + headerHeight, cardWidth, accentHeight, 'F');

                // 4b. ORNAMEN ISLAMI
                doc.setDrawColor(245, 158, 11);
                doc.setLineWidth(0.15);
                const ornamentY = y + cardHeight - 3;
                const ornamentStartX = x + 4;
                const ornamentEndX = x + cardWidth - 4;
                const ornamentStep = 4;
                for (let ox = ornamentStartX; ox < ornamentEndX; ox += ornamentStep) {
                    doc.lines(
                        [[1, -1], [1, 1], [-1, 1], [-1, -1]],
                        ox, ornamentY,
                        [0.6, 0.6], 'S', true
                    );
                }

                // 5. QR CODE
                const qrSize = 27;
                const qrX = x + 6;
                const qrY = y + 18;

                tempDiv.innerHTML = '';

                if (cleanNisn) {
                    try {
                        new QRCode(tempDiv, {
                            text: cleanNisn,
                            width: 500, height: 500,
                            correctLevel: QRCode.CorrectLevel.H,
                            colorDark: "#000000", colorLight: "#ffffff"
                        });

                        const canvas = tempDiv.querySelector('canvas');
                        if (canvas) {
                            const qrUrl = canvas.toDataURL("image/png");
                            doc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);

                            if (logoBase64) {
                                const logoQrSize = qrSize * 0.24;
                                const logoQrX = qrX + (qrSize / 2) - (logoQrSize / 2);
                                const logoQrY = qrY + (qrSize / 2) - (logoQrSize / 2);
                                doc.setFillColor(255, 255, 255);
                                doc.roundedRect(logoQrX - 0.8, logoQrY - 0.8, logoQrSize + 1.6, logoQrSize + 1.6, 0.8, 0.8, 'F');
                                doc.addImage(logoBase64, 'PNG', logoQrX, logoQrY, logoQrSize, logoQrSize);
                            }
                        }
                    } catch (e) {
                        console.error("Gagal buat QR untuk " + s.nama, e);
                    }
                }

                // 6. DATA SISWA
                const textX = x + 39;

                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);

                const namaMaxWidth = (x + cardWidth - 5) - textX;
                let namaCetak = (s.nama || "").toUpperCase();

                let namaFontSize = 11;
                const namaMinFontSize = 7;
                doc.setFontSize(namaFontSize);

                while (namaFontSize > namaMinFontSize && doc.getTextWidth(namaCetak) > namaMaxWidth) {
                    namaFontSize -= 0.25;
                    doc.setFontSize(namaFontSize);
                }

                if (doc.getTextWidth(namaCetak) > namaMaxWidth) {
                    let truncated = namaCetak;
                    while (doc.getTextWidth(truncated + "...") > namaMaxWidth && truncated.length > 0) {
                        truncated = truncated.slice(0, -1);
                    }
                    namaCetak = truncated + "...";
                }

                doc.setFontSize(namaFontSize);
                doc.text(namaCetak, textX, y + 25);

                doc.setDrawColor(226, 232, 240);
                doc.line(textX, y + 28, x + cardWidth - 5, y + 28);

                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.setFontSize(9);
                doc.text("Alamat :", textX, y + 33.5);

                const alamatMaxWidth = (x + cardWidth - 5) - (textX + 14);
                const { lines: alamatLines, fontSize: alamatFontSize } = formatAlamatFixedFont(
                    doc,
                    getAlamat(s),
                    alamatMaxWidth,
                    { maxLines: 5, fontSize: 7 }
                );

                doc.setFont("helvetica", "bold");
                doc.setFontSize(alamatFontSize);
                doc.setTextColor(15, 23, 42);
                doc.text(alamatLines, textX + 14, y + 33.5, { lineHeightFactor: 1.6 });

                // GRID LOGIC
                col++;
                if (col >= 2) {
                    col = 0;
                    row++;
                    x = marginX;
                    y += cardHeight + gapY;
                } else {
                    x += cardWidth + gapX;
                }

                if (row >= 5 && i < dataToPrint.length - 1) {
                    doc.addPage();
                    col = 0;
                    row = 0;
                    x = marginX;
                    y = marginY;
                }
            }

            document.body.removeChild(tempDiv);

            const fileName = filterKelas ? `Kartu_${filterKelas}.pdf` : `Kartu_Semua_Siswa.pdf`;
            doc.save(fileName);

            Swal.fire({
                icon: 'success',
                title: 'Selesai!',
                text: 'PDF Kartu berhasil diunduh.',
                timer: 2000
            });
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Gagal membuat PDF: ' + error.message, 'error');
        }
    }, 500);
}
    function deleteGuruConfirm(username) {
        if (confirm(`Hapus akses untuk guru: ${username}?`)) {
            showLoading(); // Tampilkan overlay loading

            // --- KEAMANAN: AMBIL TOKEN USER ---
            const token = currentUser ? currentUser.token : null;
            // ----------------------------------

            callGAS('deleteGuru', token, username).then(r => {
                hideLoading();
                
                if (r.success) {
                    // Bersihkan cache data guru
                    tableState.guru.fullData = []; 
                    // Reload tabel
                    loadDataGuru();
                    showAlert('success', 'Akun guru berhasil dihapus');
                } else {
                    showAlert('error', r.message);
                }
            }).catch(error => {
                hideLoading();
                showAlert('error', 'Gagal menghapus: ' + error);
            }); // <-- Token dikirim
        }
    }

function handleArchiveAndReset() {
        const backupNameInput = document.getElementById('backupName');
        // Ambil value dan hapus spasi berlebih
        const backupName = backupNameInput ? backupNameInput.value.trim() : ''; 

        Swal.fire({
            title: 'Tutup Tahun Ajaran?',
            text: "Sistem akan membackup data saat ini (Absensi, Siswa, Kelas) lalu MERESET data utama untuk tahun ajaran baru. Tindakan ini tidak bisa dibatalkan!",
            icon: 'warning',
            input: 'text', // Opsional: Bisa minta input lagi disini atau pakai input form sebelumnya
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Ya, Tutup & Reset!',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                showLoading();
                
                // PANGGIL BACKEND
                callGAS('archiveAndResetYear', backupName).then(function(res) {
                        hideLoading();
                        if (res.success) {
                            Swal.fire({
                                title: 'Berhasil!',
                                text: res.message + '\nFile Backup: ' + res.backupName, // Tampilkan nama file
                                icon: 'success'
                            }).then(() => {
                                loadDashboardData(); // Refresh data
                            });
                        } else {
                            showAlert('error', res.message);
                        }
                    }).catch(function(err) {
                        hideLoading();
                        showAlert('error', 'Gagal server: ' + err);
                    }); // <--- PERBAIKAN: Masukkan parameter backupName
            }
        });
    }

    // Fungsi untuk Tampilkan/Sembunyikan Password
    function togglePassword() {
        const passwordInput = document.getElementById('password');
        const toggleIcon = document.getElementById('togglePasswordIcon');

        if (passwordInput.type === 'password') {
            // Ubah ke Text (Tampilkan)
            passwordInput.type = 'text';
            toggleIcon.classList.remove('fa-eye');
            toggleIcon.classList.add('fa-eye-slash');
        } else {
            // Ubah ke Password (Sembunyikan)
            passwordInput.type = 'password';
            toggleIcon.classList.remove('fa-eye-slash');
            toggleIcon.classList.add('fa-eye');
        }
    }
    function downloadTemplate(type) {
        // Tampilkan loading overlay
        showLoading();
        
        callGAS('getTemplateExcel', type).then(function(res) {
                hideLoading();
                if (res.success) {
                    // Buka URL download di tab baru
                    window.open(res.url, '_blank');
                    // Beri notifikasi (Opsional)
                    // showAlert('success', 'Template ' + type + ' berhasil diunduh');
                } else {
                    showAlert('error', res.message);
                }
            }).catch(function(err) {
                hideLoading();
                showAlert('error', 'Gagal: ' + err);
            });
    }
    function generateQRForSiswa(nisn, nama, kelas) {
        loadQRCodeSiswa(nisn, nama, kelas);
    }
  
// ==========================================================================
// POPUP BESAR + SUARA HASIL SCAN
// ==========================================================================
function speakScan(text) {
    try {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'id-ID';
        utter.rate = 0.95;
        utter.pitch = 1;
        window.speechSynthesis.speak(utter);
    } catch (e) { console.warn('TTS gagal:', e); }
}

const SAPAAN_MASUK = [
    'Yeay, sudah datang!',
    'Hai, semangat pagi!',
    'Asyik, sudah hadir!',
    'Wah, rajin sekali!',
    'Halo, selamat belajar!',
    'Cieee sudah datang!'
];

const SAPAAN_PULANG = [
    'Dadah, hati-hati di jalan!',
    'Sampai jumpa besok lagi!',
    'Yeay, waktunya pulang!',
    'Selamat pulang, jangan jajan sembarangan!',
    'Bye bye, sampai ketemu lagi!',
    'Pulang dulu ya, semangat!'
];

function pilihAcak(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function showBigScanPopup({ type = 'success', nama = '', mode = null, customMsg = '', id = null }) {
    const isSuccess = type === 'success';

    let sub;
    if (isSuccess) {
        sub = nama ? `Selamat ${mode === 'pulang' ? 'jalan' : 'datang'}, ${nama}!` : '';
    } else {
        sub = customMsg || (nama ? `${nama}` : 'Periksa kembali QR / NISN');
    }

    // Catat ke riwayat scan, dikunci berdasarkan ID (NISN/NIP) supaya 1 orang = 1 baris
    addScanHistoryEntry(id, nama, type, sub);

    if (isSuccess) {
        if (mode === 'masuk') {
            speakScan(pilihAcak(SAPAAN_MASUK));
        } else if (mode === 'pulang') {
            speakScan(pilihAcak(SAPAAN_PULANG));
        } else {
            speakScan('Absensi berhasil');
        }
    } else {
        speakScan(customMsg ? 'Yah, scan gagal, coba lagi ya' : 'Yah, scan gagal, coba lagi ya');
    }
}

  function isSudahAbsenMsg(msg) {
    if (!msg) return false;
    const m = String(msg).toLowerCase();
    return m.includes('sudah absen') || m.includes('sudah tercatat') ||
           m.includes('sudah scan') || m.includes('sudah pulang') || m.includes('sudah datang');
}
    // ==========================================================================
    // REKAP BULANAN GURU
    // ==========================================================================
    function loadMenuRekapGuru() {
        stopAndBack(false);
        setActiveMenu('Rekap Guru');
        showView('view-rekap-guru');
    
        const selectTahun = document.getElementById('rekapGuruTahun');
        const currentYear = new Date().getFullYear();
        selectTahun.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const yr = currentYear - i;
            selectTahun.innerHTML += `<option value="${yr}">${yr}</option>`;
        }
        document.getElementById('rekapGuruBulan').value = new Date().getMonth();
    }
    
    function loadDataRekapGuru() {
        const bulan = document.getElementById('rekapGuruBulan').value;
        const tahun = document.getElementById('rekapGuruTahun').value;
        const tbody = document.getElementById('tbody-rekap-guru');
        const thead = document.getElementById('thead-rekap-guru');
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center"><i class="fas fa-circle-notch fa-spin mr-2"></i>Mengambil data...</td></tr>';
    
        callGAS('getMonthlyReportDataGuru', parseInt(bulan), parseInt(tahun)).then(res => {
            if (!res.success) { tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-red-500">${res.message}</td></tr>`; return; }
            const data = res.data;
    
            let headerHTML = '<th class="p-3 w-10 text-center bg-gray-100 sticky left-0 z-20">No</th>';
            headerHTML += '<th class="p-3 w-48 bg-gray-100 sticky left-10 z-20">Nama Guru</th>';
            for (let d = 1; d <= data.daysInMonth; d++) {
                headerHTML += `<th class="p-1 text-center w-8 text-[10px] border-l border-gray-200">${d}</th>`;
            }
            headerHTML += '<th class="p-2 w-8 text-center bg-green-50 text-green-700 border-l">H</th>';
            headerHTML += '<th class="p-2 w-12 text-center bg-gray-100">%</th>';
            thead.innerHTML = headerHTML;
    
            if (data.guru.length === 0) {
                tbody.innerHTML = '<tr><td colspan="100%" class="p-8 text-center text-gray-400">Tidak ada data guru.</td></tr>';
                return;
            }
    
            let rowsHTML = '';
            data.guru.forEach((g, idx) => {
                let row = `<tr class="hover:bg-gray-50 border-b border-gray-100 group">`;
                row += `<td class="p-3 text-center text-gray-500 sticky left-0 bg-white group-hover:bg-gray-50 z-10">${idx+1}</td>`;
                row += `<td class="p-3 font-bold text-gray-700 text-xs sticky left-10 bg-white group-hover:bg-gray-50 z-10 truncate max-w-[180px]" title="${g.nama}">${g.nama}<div class="text-[10px] text-amber-600 font-mono">${g.nip}</div></td>`;
                g.dailyCodes.forEach(day => {
                    let colorClass = '', bgClass = '';
                    if (day.isHoliday) { bgClass = 'bg-red-50'; colorClass = 'text-red-300'; }
                    else if (day.code === 'H') colorClass = 'text-green-600 font-bold';
                    else if (day.code === 'A') { colorClass = 'text-red-600 font-bold'; bgClass = 'bg-red-50'; }
                    row += `<td class="p-1 text-center text-[10px] border-l border-gray-100 ${colorClass} ${bgClass}">${day.code}</td>`;
                });
                row += `<td class="p-2 text-center text-xs font-bold text-green-700 bg-green-50/30 border-l">${g.stats.h}</td>`;
                row += `<td class="p-2 text-center text-xs font-bold text-gray-700 bg-gray-50">${g.stats.percent}%</td>`;
                row += `</tr>`;
                rowsHTML += row;
            });
            tbody.innerHTML = rowsHTML;
        }).catch(err => showAlert('error', 'Gagal koneksi: ' + err));
    }
    
    function exportRekapGuruExcel() {
        const bulan = document.getElementById('rekapGuruBulan').value;
        const tahun = document.getElementById('rekapGuruTahun').value;
        showLoading();
        callGAS('generateExcel', 'laporan_bulanan_guru', { bulan: parseInt(bulan), tahun: parseInt(tahun) }).then(result => {
            hideLoading();
            if (result.success) window.open(result.url, '_blank');
            else showAlert('error', result.message);
        }).catch(err => { hideLoading(); showAlert('error', 'Gagal: ' + err); });
    }
    
    // ==========================================================================
    // CETAK KARTU GURU MASSAL (8 per halaman, reuse logika kartu siswa)
    // ==========================================================================
        async function downloadKartuGuruBulk(idGuruListTerpilih) {
        const token = currentUser ? currentUser.token : null;
        showLoading();
        const res = await new Promise(resolve => {
            callGAS('getGuruList', token).then(resolve).catch(() => resolve({ success: false }));
        });
        hideLoading();
    
        if (!res.success || !res.data || res.data.length === 0) {
            showAlert('error', 'Data guru tidak ditemukan.');
            return;
        }
    
        let dataToPrint = res.data.filter(g => g.idGuru);
    
        if (idGuruListTerpilih && idGuruListTerpilih.length > 0) {
            const idSet = new Set(idGuruListTerpilih.map(String));
            dataToPrint = dataToPrint.filter(g => idSet.has(String(g.idGuru)));
        }
        if (dataToPrint.length === 0) {
            showAlert('error', 'Belum ada guru dengan ID Guru. Jalankan backfillNipGuru() dulu dari Apps Script editor.');
            return;
        }
    
        const confirm = await Swal.fire({
            title: 'Cetak Kartu Tanda Pengajar',
            text: `Mencetak ${dataToPrint.length} kartu guru. Layout: 10 kartu per halaman (A4).`,
            icon: 'info', showCancelButton: true,
            confirmButtonText: 'Cetak Sekarang', cancelButtonText: 'Batal'
        });
        if (!confirm.isConfirmed) return;
    
        Swal.fire({ title: 'Generate PDF...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
        const [logoBase64, logoWatermarkBase64] = await Promise.all([
            loadLogoAsBase64(), loadLogoGrayscaleBase64()
        ]);
    
        setTimeout(async () => {
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('p', 'mm', 'a4'); // A4
    
                const pageWidth = 210;
                const pageHeight = 297;
    
                const cardWidth = 89;
                const cardHeight = 52;
    
                const gapX = 6;
                const gapY = 3;
    
                const marginX = (pageWidth - ((cardWidth * 2) + gapX)) / 2;
                const marginY = (pageHeight - ((cardHeight * 5) + (gapY * 4))) / 2;
                let x = marginX, y = marginY, col = 0, row = 0;
    
                const tempDiv = document.createElement('div');
                tempDiv.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
                document.body.appendChild(tempDiv);
    
                const headerHeight = 14, accentHeight = 1;
    
                for (let i = 0; i < dataToPrint.length; i++) {
                    const g = dataToPrint[i];
                    const cleanNip = String(g.idGuru || '').replace(/[^a-zA-Z0-9]/g, "").trim();
    
                    doc.setDrawColor(200, 200, 200);
                    doc.setFillColor(255, 255, 255);
                    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
    
                    if (logoWatermarkBase64) {
                        const bodyTop = y + headerHeight + accentHeight;
                        const bodyHeight = cardHeight - headerHeight - accentHeight;
                        const wmSize = bodyHeight * 0.65;
                        doc.saveGraphicsState();
                        doc.setGState(new doc.GState({ opacity: 0.10 }));
                        doc.addImage(logoWatermarkBase64, 'PNG', x + (cardWidth / 2) - (wmSize / 2), bodyTop + (bodyHeight / 2) - (wmSize / 2), wmSize, wmSize);
                        doc.restoreGraphicsState();
                    }
    
                    // 2. HEADER UTAMA
                    doc.setFillColor(0, 61, 121);
                    doc.rect(x, y, cardWidth, headerHeight, 'F');
    
                    const headerTextCenterX = x + (cardWidth / 2);
    
                    doc.setTextColor(255, 255, 255);
                    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
                    doc.text("KARTU TANDA PENGAJAR", headerTextCenterX, y + 5, { align: 'center' });
                    doc.setFontSize(7);
                    doc.text("Madrasah Mu'allimin Mu'allimat Manba'ul Huda", headerTextCenterX, y + 8, { align: 'center' });
                    doc.setFontSize(5.5); doc.setFont("helvetica", "normal");
                    doc.text("Pondok Pesantren Sidaraja, Ciawigebang, Kuningan", headerTextCenterX, y + 10.6, { align: 'center' });
    
                    doc.setFillColor(245, 158, 11);
                    doc.rect(x, y + headerHeight, cardWidth, accentHeight, 'F');
    
                    doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.15);
                    const ornamentY = y + cardHeight - 3;
                    for (let ox = x + 4; ox < x + cardWidth - 4; ox += 4) {
                        doc.lines([[1, -1], [1, 1], [-1, 1], [-1, -1]], ox, ornamentY, [0.6, 0.6], 'S', true);
                    }
    
                    // 5. QR CODE
                    const bodyTop2 = y + headerHeight + accentHeight;
                    const bodyBottom2 = y + cardHeight - 4;
                    const headerGap = 3;
                    const qrAreaTop = bodyTop2 + headerGap;
                    const qrSize = Math.min(22, (bodyBottom2 - qrAreaTop) - 2);
                    const qrX = x + 9;
                    const qrY = qrAreaTop + ((bodyBottom2 - qrAreaTop) - qrSize) / 2;
    
                    tempDiv.innerHTML = '';
                    if (cleanNip) {
                        new QRCode(tempDiv, { text: cleanNip, width: 500, height: 500, correctLevel: QRCode.CorrectLevel.H, colorDark: "#000000", colorLight: "#ffffff" });
                        const canvas = tempDiv.querySelector('canvas');
                        if (canvas) {
                            doc.addImage(canvas.toDataURL("image/png"), 'PNG', qrX, qrY, qrSize, qrSize);
                            if (logoBase64) {
                                const logoQrSize = qrSize * 0.24;
                                const logoQrX = qrX + (qrSize / 2) - (logoQrSize / 2);
                                const logoQrY = qrY + (qrSize / 2) - (logoQrSize / 2);
                                doc.setFillColor(255, 255, 255);
                                doc.roundedRect(logoQrX - 0.8, logoQrY - 0.8, logoQrSize + 1.6, logoQrSize + 1.6, 0.8, 0.8, 'F');
                                doc.addImage(logoBase64, 'PNG', logoQrX, logoQrY, logoQrSize, logoQrSize);
                            }
                        }
                    }
    
                    // 6. DATA GURU
                    const textX = x + 38;
                    const textAreaWidth = (x + cardWidth - 5) - textX;
    
                    const jabatanList = g.jabatan
                        ? String(g.jabatan).split(',').map(j => j.trim()).filter(Boolean)
                        : ['Tenaga Pendidik'];
    
                    const namaFontSizeMax = 10.5;
                    const namaFontSizeMin = 6.5;
                    const namaY = bodyTop2 + headerGap + 3;
    
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(15, 23, 42);
                    let namaFontSize = namaFontSizeMax;
                    let namaCetak = String(g.nama || g.username || "").trim();
                    doc.setFontSize(namaFontSize);
                    while (namaFontSize > namaFontSizeMin && doc.getTextWidth(namaCetak) > textAreaWidth) {
                        namaFontSize -= 0.25;
                        doc.setFontSize(namaFontSize);
                    }
                    if (doc.getTextWidth(namaCetak) > textAreaWidth) {
                        let truncated = namaCetak;
                        while (doc.getTextWidth(truncated + "...") > textAreaWidth && truncated.length > 0) {
                            truncated = truncated.slice(0, -1);
                        }
                        namaCetak = truncated + "...";
                    }
                    doc.text(namaCetak, textX, namaY);
    
                    doc.setDrawColor(226, 232, 240);
                    const separatorY = namaY + 2.2;
                    doc.line(textX, separatorY, x + cardWidth - 5, separatorY);
    
                    const jabatanTop = separatorY + 2.6;
                    const jabatanAvailableHeight = bodyBottom2 - jabatanTop;
                    let jabatanListToShow = jabatanList.slice();
    
                    let jabatanFontSize = 7.5;
                    let jabatanLineHeight = 3.2;
                    const jabatanFontSizeFloor = 3.2;
                    const jabatanLineHeightFloor = 1.55;
    
                    while (
                        (jabatanListToShow.length * jabatanLineHeight) > jabatanAvailableHeight &&
                        (jabatanFontSize > jabatanFontSizeFloor || jabatanLineHeight > jabatanLineHeightFloor)
                    ) {
                        if (jabatanFontSize > jabatanFontSizeFloor) jabatanFontSize -= 0.2;
                        if (jabatanLineHeight > jabatanLineHeightFloor) jabatanLineHeight -= 0.1;
                    }
    
                    let maxLinesFit = Math.floor(jabatanAvailableHeight / jabatanLineHeight);
                    if (maxLinesFit < 1) maxLinesFit = 1;
                    if (jabatanListToShow.length > maxLinesFit) {
                        const shown = jabatanListToShow.slice(0, maxLinesFit - 1);
                        const sisa = jabatanListToShow.length - shown.length;
                        jabatanListToShow = shown;
                        jabatanListToShow.push(`+${sisa} lainnya`);
                    }
    
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(jabatanFontSize);
                    doc.setTextColor(71, 85, 105);
    
                    let jabatanY = jabatanTop + jabatanLineHeight * 0.75;
                    jabatanListToShow.forEach(j => {
                        let line = j.startsWith('+') ? j : '• ' + j;
                        const maxW = textAreaWidth;
                        if (doc.getTextWidth(line) > maxW) {
                            while (doc.getTextWidth(line + "...") > maxW && line.length > 2) {
                                line = line.slice(0, -1);
                            }
                            line += "...";
                        }
                        doc.text(line, textX, jabatanY);
                        jabatanY += jabatanLineHeight;
                    });
    
                    // GRID LOGIC
                    col++;
                    if (col >= 2) { col = 0; row++; x = marginX; y += cardHeight + gapY; }
                    else { x += cardWidth + gapX; }
                    if (row >= 5 && i < dataToPrint.length - 1) {
                        doc.addPage(); col = 0; row = 0; x = marginX; y = marginY;
                    }
                }
    
                document.body.removeChild(tempDiv);
                doc.save(`Kartu_Guru_Semua.pdf`);
                Swal.fire({ icon: 'success', title: 'Selesai!', text: 'PDF Kartu Guru berhasil diunduh.', timer: 2000 });
            } catch (error) {
                console.error(error);
                Swal.fire('Error', 'Gagal membuat PDF: ' + error.message, 'error');
            }
        }, 500);
    }
    // ==========================================================================
    // CETAK BEBERAPA — SISWA
    // ==========================================================================
    let selectModeSiswa = false;
    let selectedSiswaSet = new Set();
    
    function toggleSelectModeSiswa() {
        selectModeSiswa = !selectModeSiswa;
        if (!selectModeSiswa) selectedSiswaSet.clear();
    
        document.getElementById('thCheckSiswa').classList.toggle('hidden', !selectModeSiswa);
        document.getElementById('btnPrintSelectedSiswa').classList.toggle('hidden', !selectModeSiswa);
    
        const btnToggle = document.getElementById('btnToggleSelectSiswa');
        btnToggle.innerHTML = selectModeSiswa
            ? '<i class="fas fa-times mr-1"></i> Batal Pilih'
            : '<i class="fas fa-check-square mr-1"></i> Cetak Beberapa';
    
        updateSiswaSelectedCount();
        processTableData('siswa');
    }
    
    function toggleSiswaSelected(nisn, checked) {
        if (checked) selectedSiswaSet.add(String(nisn));
        else selectedSiswaSet.delete(String(nisn));
        updateSiswaSelectedCount();
    }
    
    function toggleCheckAllSiswa(checked) {
        document.querySelectorAll('.siswa-check').forEach(cb => {
            cb.checked = checked;
            if (checked) selectedSiswaSet.add(cb.value);
            else selectedSiswaSet.delete(cb.value);
        });
        updateSiswaSelectedCount();
    }
    
    function updateSiswaSelectedCount() {
        document.getElementById('countSelectedSiswa').textContent = selectedSiswaSet.size;
    }
    
    function downloadKartuSiswaSelected() {
        if (selectedSiswaSet.size === 0) {
            showAlert('error', 'Pilih minimal 1 siswa terlebih dahulu.');
            return;
        }
        downloadKartuSiswaBulk(Array.from(selectedSiswaSet));
    }

    // ==========================================================================
    // CETAK BEBERAPA — GURU
    // ==========================================================================
    let selectModeGuru = false;
    let selectedGuruSet = new Set();
    
    function toggleSelectModeGuru() {
        selectModeGuru = !selectModeGuru;
        if (!selectModeGuru) selectedGuruSet.clear();
    
        document.getElementById('thCheckGuru').classList.toggle('hidden', !selectModeGuru);
        document.getElementById('btnPrintSelectedGuru').classList.toggle('hidden', !selectModeGuru);
    
        const btnToggle = document.getElementById('btnToggleSelectGuru');
        btnToggle.innerHTML = selectModeGuru
            ? '<i class="fas fa-times mr-1"></i> Batal Pilih'
            : '<i class="fas fa-check-square mr-1"></i> Cetak Beberapa';
    
        updateGuruSelectedCount();
        processTableData('guru');
    }
    
    function toggleGuruSelected(idGuru, checked) {
        if (checked) selectedGuruSet.add(String(idGuru));
        else selectedGuruSet.delete(String(idGuru));
        updateGuruSelectedCount();
    }
    
    function toggleCheckAllGuru(checked) {
        document.querySelectorAll('.guru-check').forEach(cb => {
            cb.checked = checked;
            if (checked) selectedGuruSet.add(cb.value);
            else selectedGuruSet.delete(cb.value);
        });
        updateGuruSelectedCount();
    }
    
    function updateGuruSelectedCount() {
        document.getElementById('countSelectedGuru').textContent = selectedGuruSet.size;
    }
    
    function downloadKartuGuruSelected() {
        if (selectedGuruSet.size === 0) {
            showAlert('error', 'Pilih minimal 1 guru terlebih dahulu.');
            return;
        }
        downloadKartuGuruBulk(Array.from(selectedGuruSet));
}
    checkSession();

// ============================================================
// PWA: Service Worker Registration, Install Prompt, Offline UI
// ============================================================

(function () {
  'use strict';

  /* ---- Hide boot splash once DOM is ready ---- */
  function hideBootSplash() {
    var splash = document.getElementById('pwaBootSplash');
    if (splash) {
      splash.classList.add('hide');
      setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideBootSplash, { once: true });
  } else {
    hideBootSplash();
  }
  // Safety fallback: hide after 4s no matter what
  setTimeout(hideBootSplash, 4000);

  /* ---- Offline / Online indicator ---- */
  var offlineIndicator = document.getElementById('offlineIndicator');
  function updateOnlineStatus() {
    if (!offlineIndicator) return;
    if (navigator.onLine) {
      offlineIndicator.classList.remove('show');
    } else {
      offlineIndicator.classList.add('show');
    }
  }
  window.addEventListener('online', function () {
    updateOnlineStatus();
    // Notify user they're back online
    if (window.Swal) {
      Swal.fire({
        toast: true, position: 'top-end',
        icon: 'success', title: 'Koneksi internet kembali tersedia',
        showConfirmButton: false, timer: 2500, timerProgressBar: true
      });
    }
  });
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  /* ---- Service Worker registration ---- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(function (reg) {
          // Listen for updates
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version ready — prompt user to refresh
                if (window.Swal) {
                  Swal.fire({
                    title: 'Versi baru tersedia',
                    text: 'Muat ulang untuk mendapatkan versi terbaru E-PRESENT.',
                    icon: 'info',
                    showCancelButton: true,
                    confirmButtonText: 'Muat Ulang',
                    cancelButtonText: 'Nanti'
                  }).then(function (r) {
                    if (r.isConfirmed) {
                      newWorker.postMessage({ type: 'SKIP_WAITING' });
                      window.location.reload();
                    }
                  });
                }
              }
            });
          });
          // Check for updates every hour
          setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
        })
        .catch(function (err) {
          console.warn('[PWA] Service Worker registration failed:', err);
        });

      // Reload when new SW takes control
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  /* ---- PWA Install Prompt (beforeinstallprompt) ---- */
  var deferredPrompt = null;
  var installBanner = document.getElementById('pwaInstallBanner');
  var installBtn = document.getElementById('pwaInstallBtn');
  var dismissBtn = document.getElementById('pwaDismissBtn');

  // Don't show banner if already installed (standalone)
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }

  // Respect dismissal for 7 days
  var DISMISS_KEY = 'pwa_install_dismissed_until';
  function isRecentlyDismissed() {
    try {
      var until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return Date.now() < until;
    } catch (e) { return false; }
  }
  function dismissFor7Days() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + (7 * 24 * 60 * 60 * 1000)));
    } catch (e) {}
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show our custom install banner if not dismissed and not already installed
    if (!isStandalone() && !isRecentlyDismissed() && installBanner) {
      // Delay 3s so it doesn't interrupt initial UX
      setTimeout(function () { installBanner.classList.add('show'); }, 3000);
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) {
        if (window.Swal) {
          Swal.fire({
            icon: 'info',
            title: 'Pasang Aplikasi',
            html: 'Untuk memasang E-PRESENT:<br><br>' +
                  '<b>Android (Chrome):</b> Menu ⋮ → "Tambahkan ke Layar Utama"<br>' +
                  '<b>iOS (Safari):</b> Tombol Share → "Tambahkan ke Layar Utama"<br>' +
                  '<b>Desktop (Chrome/Edge):</b> Ikon install di address bar',
            confirmButtonText: 'Mengerti'
          });
        }
        return;
      }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted install');
        } else {
          console.log('[PWA] User dismissed install');
        }
        deferredPrompt = null;
        installBanner.classList.remove('show');
      });
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', function () {
      installBanner.classList.remove('show');
      dismissFor7Days();
    });
  }

  // Hide banner if app is already installed
  window.addEventListener('appinstalled', function () {
    if (installBanner) installBanner.classList.remove('show');
    if (window.Swal) {
      Swal.fire({
        toast: true, position: 'top-end',
        icon: 'success', title: 'E-PRESENT berhasil dipasang',
        showConfirmButton: false, timer: 3000, timerProgressBar: true
      });
    }
  });

  /* ---- Handle PWA shortcut ?view= param ---- */
  try {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view');
    if (view && sessionStorage.getItem('pwa_shortcut_handled') !== '1') {
      sessionStorage.setItem('pwa_shortcut_handled', '1');
      // Wait for app to initialize, then attempt navigation
      window.addEventListener('load', function () {
        setTimeout(function () {
          // Try common view-switcher functions exposed by the app
          var attempts = [
            function () { if (typeof showView === 'function') showView('view-' + view); },
            function () { if (typeof navigateTo === 'function') navigateTo(view); },
            function () {
              var el = document.getElementById('view-' + view);
              if (el) {
                document.querySelectorAll('.view-section').forEach(function (s) { s.classList.remove('active'); });
                el.classList.add('active');
              }
            }
          ];
          attempts.forEach(function (fn) { try { fn(); } catch (e) {} });
        }, 1500);
      });
    }
  } catch (e) {}
})();
