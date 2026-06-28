// Offline POS support: cache the catalog so the register still loads without
// internet, and queue sales taken while offline so they auto-sync to the backend
// when the connection returns. Uses localStorage — a real outage produces only a
// handful of orders, so this avoids IndexedDB boilerplate while staying robust.
//
// Safety: every queued sale carries a client-generated `clientRef`. The backend
// treats it as an idempotency key, so re-syncing the same sale can never create a
// duplicate order (it returns the already-created one).

const CATALOG_KEY = 'lumio_pos_catalog';
const QUEUE_KEY = 'lumio_pos_queue';

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
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
}
export function readCachedCatalog<T = unknown>(): { at: number; data: T } | null {
  try { const raw = localStorage.getItem(CATALOG_KEY); return raw ? (JSON.parse(raw) as { at: number; data: T }) : null; } catch { return null; }
}

export interface QueuedOrder { clientRef: string; payload: unknown; at: number; totalCents: number }

export function readQueue(): QueuedOrder[] {
  try { const raw = localStorage.getItem(QUEUE_KEY); return raw ? (JSON.parse(raw) as QueuedOrder[]) : []; } catch { return []; }
}
function writeQueue(q: QueuedOrder[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ }
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
    try { r = await post(item.payload); }
    catch { break; } // network error — try again next time
    if (r.ok) { removeFromQueue(item.clientRef); synced++; }
    else if (r.permanent) { removeFromQueue(item.clientRef); }
    else break;
  }
  return synced;
}
