import { useEffect, useRef } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushSubscription(accessToken: string | null) {
  const subscribed = useRef(false);

  useEffect(() => {
    if (!accessToken || subscribed.current) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    async function subscribe() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) { subscribed.current = true; return; }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        const json = sub.toJSON();
        await fetch('/api/push-subscription', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });

        subscribed.current = true;
      } catch (err) {
        console.error('Push subscription failed:', err);
      }
    }

    // Register periodic sync if supported
    async function registerPeriodicSync() {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ('periodicSync' in reg) {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
          if (status.state === 'granted') {
            await (reg as any).periodicSync.register('refresh-race-data', { minInterval: 60 * 60 * 1000 }); // 1 hour
          }
        }
      } catch {}
    }

    subscribe();
    registerPeriodicSync();
  }, [accessToken]);
}

// Call this when submitting tips offline to queue a background sync retry
export async function queueSyncTip(url: string, method: string, body: string, headers: Record<string, string> = {}) {
  // Store in IndexedDB for the SW to retry
  const dbReq = indexedDB.open('toppunter-sync', 1);
  dbReq.onupgradeneeded = () => {
    dbReq.result.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
  };
  dbReq.onsuccess = () => {
    const db = dbReq.result;
    const tx = db.transaction('syncQueue', 'readwrite');
    tx.objectStore('syncQueue').add({ url, method, body, headers });
  };

  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await (reg as any).sync.register('sync-tips');
  }
}
