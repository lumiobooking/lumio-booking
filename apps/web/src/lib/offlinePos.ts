// Offline POS support: cache the catalog so the register still loads without
// internet, and queue sales taken while offline so they auto-sync to the backend
// when the connection returns. Uses localStorage — a real outage produces only a
// handful of orders, so this avoids IndexedDB boilerplate while staying robust.
//
// Safety: every queued sale carries a client-generated `clientRef`. The backend
// treats it as an idempotency key, so re-syncing the same sale can never create a
// duplicate order (it returns the already-created one).

//
// One device, one salon at a time — but not always the same salon: a Lumio
// support laptop, an owner of two shops, a tablet handed to a new tenant. The
// cache and the queue used to sit under ONE key for the whole browser, so the
// till could show another salon's menu when offline, and a sale queued at one
// salon could later be uploaded with the next salon's login. Both are now kept
// per salon (the key carries the tenant id); with no salon there is nothing to
// read or write.
const CATALOG_BASE = 'lumio_pos_catalog';
const QUEUE_BASE = 'lumio_pos_queue';
let scope: string | null = null;

/** The salon whose cache and queue this page uses (the signed-in tenant), or null. */
export function setOfflineScope(tenantId: string | null | undefined): void {
  const next = tenantId ? String(tenantId) : null;
  if (next === scope) return;
  scope = next;
  if (!scope) return;
  try {
    // Sales queued before the cache was per salon: this device's own salon is the
    // only one that could have taken them, so they move to it (never dropped).
    const legacy = localStorage.getItem(QUEUE_BASE);
    if (legacy) {
      const old = JSON.parse(legacy) as QueuedOrder[];
      if (Array.isArray(old) && old.length) {
        const cur = readQueue();
        writeQueue([...cur, ...old.filter((o) => !cur.some((c) => c.clientRef === o.clientRef))]);
      }
      localStorage.removeItem(QUEUE_BASE);
    }
    // An old shared menu cannot be told apart: drop it, the next load caches this salon's.
    localStorage.removeItem(CATALOG_BASE);
  } catch { /* ignore */ }
}
const catalogKey = () => (scope ? `${CATALOG_BASE}:${scope}` : null);
const queueKey = () => (scope ? `${QUEUE_BASE}:${scope}` : null);

export function genClientRef(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch { /* ignore */ }
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function cacheCatalog(data: unknown): void {
  const k = catalogKey(); if (!k) return;
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
}
export function readCachedCatalog<T = unknown>(): { at: number; data: T } | null {
  const k = catalogKey(); if (!k) return null;
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as { at: number; data: T }) : null; } catch { return null; }
}

export interface QueuedOrder { clientRef: string; payload: unknown; at: number; totalCents: number }

export function readQueue(): QueuedOrder[] {
  const k = queueKey(); if (!k) return [];
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as QueuedOrder[]) : []; } catch { return []; }
}
function writeQueue(q: QueuedOrder[]): void {
  const k = queueKey(); if (!k) return;
  try { localStorage.setItem(k, JSON.stringify(q)); } catch { /* ignore */ }
}
export function queueOrder(o: QueuedOrder): void {
  const q = readQueue();
  if (!q.some((x) => x.clientRef === o.clientRef)) { q.push(o); writeQueue(q); }
}
export function removeFromQueue(clientRef: string): void {
  writeQueue(readQueue().filter((x) => x.clientRef !== clientRef));
}
export function queueCount(): number { return readQueue().length; }

/**
 * Drain the queue. `post` POSTs one order and returns:
 *   - { ok:true }                 → synced (or idempotently already there) → remove
 *   - { ok:false, permanent:true }→ server rejected it for good (bad data) → remove
 *   - throws / { ok:false }       → transient (offline / server down) → keep, stop
 * Returns how many were actually sent this run.
 */
export async function syncQueue(
  post: (payload: unknown) => Promise<{ ok: boolean; permanent?: boolean }>,
): Promise<number> {
  let synced = 0;
  for (const item of readQueue()) {
    let r: { ok: boolean; permanent?: boolean };
    // The time it was sold rides along, so the sale lands on that day, not the sync day.
    const payload = item.payload && typeof item.payload === 'object' && item.at
      ? { ...(item.payload as Record<string, unknown>), soldAt: new Date(item.at).toISOString() }
      : item.payload;
    try { r = await post(payload); }
    catch { break; } // network error — try again next time
    if (r.ok) { removeFromQueue(item.clientRef); synced++; }
    else if (r.permanent) { removeFromQueue(item.clientRef); }
    else break;
  }
  return synced;
}
