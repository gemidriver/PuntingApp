// Service worker for The Top Punter PWA
// Handles: caching, Web Push, Background Sync, Periodic Background Sync

const CACHE = 'toppunter-v2';
const PRECACHE = ['/', '/TheTopPunter.png'];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ─── Activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch (cache-then-network) ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Don't cache API routes
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Web Push Notifications ────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = { title: 'The Top Punter', body: 'You have a new notification.', url: '/' };
  try { data = { ...data, ...event.data.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/TheTopPunter.png',
      badge: '/TheTopPunter.png',
      data: { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else self.clients.openWindow(url);
    })
  );
});

// ─── Background Sync (retry queued tip submissions) ────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-tips') {
    event.waitUntil(retrySyncTips());
  }
});

async function retrySyncTips() {
  const db = await openSyncDB();
  const queued = await dbGetAll(db, 'syncQueue');
  for (const item of queued) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json', ...item.headers },
        body: item.body,
      });
      if (res.ok) await dbDelete(db, 'syncQueue', item.id);
    } catch {
      // leave in queue for next sync attempt
    }
  }
}

// ─── Periodic Background Sync (refresh race data) ──────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-race-data') {
    event.waitUntil(prefetchRaceData());
  }
});

async function prefetchRaceData() {
  try {
    const res = await fetch('/api/meets');
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put('/api/meets', res);
    }
  } catch {}
}

// ─── IndexedDB helpers for sync queue ──────────────────────────────────────
function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('toppunter-sync', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(db, store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

