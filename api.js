    // ==========================================================================
    // 1. GLOBAL STATE & KONFIGURASI
    // ==========================================================================
    // ==========================================================================
    // KONEKSI KE BACKEND (Apps Script Web App) — pengganti google.script.run
    // ==========================================================================
    // GANTI dengan URL Web App hasil deploy ulang Apps Script (harus diakhiri /exec)
    const API_URL = 'https://script.google.com/macros/s/AKfycbwiWT3pZCosH3cwWjTkMaa6ftFSpsKO-71rQdU9LCvJl5Xvo7IRP1TOoBAXA4vJZYnx/exec';

// ==========================================================================
// REQUEST QUEUE — batasi request bersamaan + retry otomatis
// ==========================================================================
const REQUEST_QUEUE_MAX_CONCURRENT = 3;
let _activeRequests = 0;
const _requestQueue = [];

function _processQueue() {
    if (_activeRequests >= REQUEST_QUEUE_MAX_CONCURRENT) return;
    const item = _requestQueue.shift();
    if (!item) return;
    _activeRequests++;
    item.fn().then(item.resolve).catch(item.reject)
        .finally(() => { _activeRequests--; _processQueue(); });
}

function queuedFetch(fn) {
    return new Promise((resolve, reject) => {
        _requestQueue.push({ fn, resolve, reject });
        _processQueue();
    });
}

async function callGASRaw(functionName, args, attempt = 1) {
    const MAX_RETRY = 3;
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ fn: functionName, args })
        });
        if (!res.ok) throw new Error('Network error: ' + res.status);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json.result;
    } catch (err) {
        if (attempt < MAX_RETRY) {
            await new Promise(r => setTimeout(r, attempt * 1500));
            return callGASRaw(functionName, args, attempt + 1);
        }
        throw err;
    }
}

async function callGAS(functionName, ...args) {
    return queuedFetch(() => callGASRaw(functionName, args));
}
// ==========================================================================
// OFFLINE QUEUE SYSTEM — antrian absensi saat tidak ada koneksi internet
// ==========================================================================
const OFFLINE_QUEUE_DB = 'epresent-offline-db';
const OFFLINE_QUEUE_STORE = 'pending-absensi';

function openOfflineDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
                req.result.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function queueOfflineCall(functionName, args) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_QUEUE_STORE).add({ fn: functionName, args, ts: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getQueueCount() {
    try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
            const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
            const req = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
            req.onsuccess = () => resolve(req.result.length);
            req.onerror = () => resolve(0);
        });
    } catch (e) {
        return 0;
    }
}

function updateOfflineQueueBadge() {
    getQueueCount().then(count => {
        const el = document.getElementById('offlineQueueBadge');
        if (!el) return;
        if (count > 0) {
            el.textContent = count + ' data belum terkirim';
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });
}

// callGAS versi offline-aware — dipakai KHUSUS untuk aksi absensi (submit/tulis data),
// BUKAN untuk lookup/read data (biarkan pakai callGAS biasa)
async function callGASOffline(functionName, ...args) {
    if (!navigator.onLine) {
        await queueOfflineCall(functionName, args);
        updateOfflineQueueBadge();
        showAlert('success', '📥 Tersimpan offline — akan terkirim otomatis saat online');
        return { success: true, offline: true, message: 'Tersimpan offline, menunggu koneksi.' };
    }
    try {
        const result = await callGAS(functionName, ...args);
        return result;
    } catch (e) {
        // Gagal walau status online=true (misal sinyal lemah / timeout)
        await queueOfflineCall(functionName, args);
        updateOfflineQueueBadge();
        showAlert('success', '📥 Koneksi bermasalah, data disimpan offline');
        return { success: true, offline: true, message: 'Tersimpan offline, menunggu koneksi.' };
    }
}

let _isSyncingOfflineQueue = false;
async function syncOfflineQueue() {
    if (!navigator.onLine || _isSyncingOfflineQueue) return;
    _isSyncingOfflineQueue = true;
    try {
        const db = await openOfflineDB();
        const items = await new Promise(res => {
            const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
            const r = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => res([]);
        });

        if (items.length === 0) { _isSyncingOfflineQueue = false; return; }

        showAlert('success', `🔄 Menyinkronkan ${items.length} data absensi offline...`);
        let successCount = 0;

        for (const item of items) {
            try {
                await callGAS(item.fn, ...item.args);
                const db2 = await openOfflineDB();
                await new Promise(res => {
                    const delTx = db2.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
                    delTx.objectStore(OFFLINE_QUEUE_STORE).delete(item.id);
                    delTx.oncomplete = () => res();
                });
                successCount++;
            } catch (e) {
                // Masih gagal (offline lagi / server error) — hentikan, sisa data tetap di antrian
                break;
            }
        }

        updateOfflineQueueBadge();
        if (successCount > 0) {
            showAlert('success', `✅ ${successCount} data absensi berhasil disinkronkan`);
        }

        // Refresh tampilan yang sedang aktif supaya data terbaru langsung terlihat
        if (currentUser) {
            const dhView = document.getElementById('view-daftar-hadir-guru');
            if (dhView && dhView.classList.contains('active') && typeof onDhKelasChange === 'function') {
                onDhKelasChange();
            }
        }
    } finally {
        _isSyncingOfflineQueue = false;
    }
}

// Coba sync begitu koneksi kembali
window.addEventListener('online', syncOfflineQueue);
// Coba sync juga saat app baru dibuka (barangkali ada antrian dari sesi sebelumnya)
window.addEventListener('load', () => {
    setTimeout(() => { updateOfflineQueueBadge(); syncOfflineQueue(); }, 1500);
});
