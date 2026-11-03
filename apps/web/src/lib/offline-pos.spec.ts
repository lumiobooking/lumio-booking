/**
 * The till's offline menu and offline sales belong to ONE salon (3 Nov 2026:
 * a browser that had opened a restaurant's till showed that restaurant's menu
 * on another salon's till, labelled "Offline"). Kept per tenant now.
 */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

import { cacheCatalog, queueCount, queueOrder, readCachedCatalog, readQueue, setOfflineScope } from './offlinePos';

beforeEach(() => { store.clear(); setOfflineScope(null); });

describe('offline till, one salon at a time', () => {
  it('a menu cached at salon A is never shown at salon B', () => {
    setOfflineScope('A');
    cacheCatalog({ menu: 'A-menu' });
    setOfflineScope('B');
    expect(readCachedCatalog()).toBeNull();
    setOfflineScope('A');
    expect(readCachedCatalog()?.data).toEqual({ menu: 'A-menu' });
  });
  it('a sale queued at salon A is not uploaded by salon B', () => {
    setOfflineScope('A');
    queueOrder({ clientRef: 'r1', payload: {}, at: 1, totalCents: 500 });
    setOfflineScope('B');
    expect(queueCount()).toBe(0);
    setOfflineScope('A');
    expect(readQueue().map((q) => q.clientRef)).toEqual(['r1']);
  });
  it('no salon signed in: nothing is read or written', () => {
    cacheCatalog({ menu: 'x' });
    queueOrder({ clientRef: 'r2', payload: {}, at: 1, totalCents: 1 });
    expect(store.size).toBe(0);
    expect(readCachedCatalog()).toBeNull();
  });
  it('sales queued before the cache was per salon move to this device\'s salon; the old shared menu is dropped', () => {
    store.set('lumio_pos_queue', JSON.stringify([{ clientRef: 'old', payload: {}, at: 1, totalCents: 9 }]));
    store.set('lumio_pos_catalog', JSON.stringify({ at: 1, data: { menu: 'someone' } }));
    setOfflineScope('A');
    expect(readQueue().map((q) => q.clientRef)).toEqual(['old']);
    expect(readCachedCatalog()).toBeNull();
    expect(store.has('lumio_pos_queue')).toBe(false);
  });
});
