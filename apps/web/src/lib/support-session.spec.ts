/**
 * One tab, one salon. Two tabs of the same browser share localStorage but
 * each has its own sessionStorage — the whole reason a salon session lives
 * in the latter: entering salon B in one tab must never turn a tab opened
 * for salon A into B when it reloads (which every Connect round trip does).
 */
import { readSession, enterSupportSession, leaveSupportSession, clearAllSessions, AUTH_KEY, SUPPORT_SESSION_KEY } from './support-session';

type Store = Map<string, string>;
const storage = (m: Store) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } });
const shared: Store = new Map();
const tab = (own: Store) => { (globalThis as { window?: unknown }).window = { localStorage: storage(shared), sessionStorage: storage(own) }; };

const agency = { accessToken: 'agency-token', user: { id: 'u1', role: 'SUPPORT', tenantId: null } };
const salon = (id: string) => ({ accessToken: `tok-${id}`, user: { id: 'u1', role: 'SALON_ADMIN', tenantId: id, supportSession: true, tenantName: id } });

beforeEach(() => { shared.clear(); shared.set(AUTH_KEY, JSON.stringify(agency)); });

describe('a salon session belongs to the tab that opened it', () => {
  it('tab A keeps salon A after tab B enters salon B — and the agency login is untouched', () => {
    const tabA: Store = new Map(); const tabB: Store = new Map();
    tab(tabA); enterSupportSession(salon('A'));
    tab(tabB); enterSupportSession(salon('B'));
    tab(tabA); expect(readSession()?.user.tenantId).toBe('A'); // a reload in tab A (an OAuth callback, say)
    tab(tabB); expect(readSession()?.user.tenantId).toBe('B');
    expect(JSON.parse(shared.get(AUTH_KEY)!).accessToken).toBe('agency-token');
  });

  it('a brand-new tab starts at the agency login, never inside a salon', () => {
    tab(new Map()); enterSupportSession(salon('A'));
    tab(new Map());
    expect(readSession()?.user.tenantId).toBeNull();
    expect(readSession()?.accessToken).toBe('agency-token');
  });

  it('leaving a salon frees only that tab', () => {
    const tabA: Store = new Map(); const tabB: Store = new Map();
    tab(tabA); enterSupportSession(salon('A'));
    tab(tabB); enterSupportSession(salon('B'));
    tab(tabA); leaveSupportSession();
    expect(readSession()?.accessToken).toBe('agency-token');
    tab(tabB); expect(readSession()?.user.tenantId).toBe('B');
  });

  it('a salon session the old code left in the shared slot is moved into the tab, and the parked agency login restored', () => {
    shared.set(AUTH_KEY, JSON.stringify(salon('OLD')));
    shared.set('lumio_agency_home', JSON.stringify(agency));
    const t: Store = new Map(); tab(t);
    expect(readSession()?.user.tenantId).toBe('OLD');
    expect(JSON.parse(t.get(SUPPORT_SESSION_KEY)!).user.tenantId).toBe('OLD');
    expect(JSON.parse(shared.get(AUTH_KEY)!).accessToken).toBe('agency-token');
    expect(shared.has('lumio_agency_home')).toBe(false);
    // Another tab of that browser is NOT inside OLD any more.
    tab(new Map()); expect(readSession()?.user.tenantId).toBeNull();
  });

  it('sign-out clears the tab and the shared login alike', () => {
    const t: Store = new Map(); tab(t); enterSupportSession(salon('A'));
    clearAllSessions();
    expect(readSession()).toBeNull();
    expect(t.size).toBe(0); expect(shared.has(AUTH_KEY)).toBe(false);
  });
});
