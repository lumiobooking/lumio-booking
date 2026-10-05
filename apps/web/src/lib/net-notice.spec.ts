import { readFileSync } from 'fs';
import { join } from 'path';
import { networkNotice, isAbortError, NET_TOAST_GAP_MS, NetFailure } from './net-notice';

const base: NetFailure = { method: 'GET', aborted: false, unloading: false, online: true, now: 100_000, lastShownAt: 0, vi: true };

describe('"Mất kết nối mạng" only when it is true and useful', () => {
  it('says nothing for requests the browser cancelled on purpose', () => {
    expect(networkNotice({ ...base, aborted: true })).toBeNull();
    expect(networkNotice({ ...base, method: 'POST', aborted: true })).toBeNull();
  });

  it('says nothing while the page is leaving (reload, link, the TikTok / Google consent redirect)', () => {
    expect(networkNotice({ ...base, unloading: true })).toBeNull();
    expect(networkNotice({ ...base, method: 'POST', unloading: true })).toBeNull();
  });

  it('a background refresh that failed (after its silent retry) is a soft notice, not a red alarm', () => {
    const n = networkNotice(base);
    expect(n?.kind).toBe('info');
    expect(n?.text).not.toMatch(/Mất kết nối/);
  });

  it('really offline → says so', () => {
    const n = networkNotice({ ...base, online: false });
    expect(n).toEqual({ kind: 'error', text: expect.stringMatching(/Mất kết nối mạng/) });
  });

  it('refresh notices are throttled — a laptop waking up does not stack ten toasts', () => {
    expect(networkNotice({ ...base, lastShownAt: base.now - 5_000 })).toBeNull();
    expect(networkNotice({ ...base, lastShownAt: base.now - NET_TOAST_GAP_MS - 1 })).not.toBeNull();
  });

  it('a save that did not land is ALWAYS reported, never throttled, and says it was not saved', () => {
    for (const online of [true, false, null]) {
      const n = networkNotice({ ...base, method: 'POST', online, lastShownAt: base.now - 1 });
      expect(n?.kind).toBe('error');
      expect(n?.text).toMatch(/chưa được lưu/);
    }
    expect(networkNotice({ ...base, method: 'PATCH', online: false, vi: false })?.text).toMatch(/offline — this was not saved/);
  });

  it('recognises an aborted fetch', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('api.ts uses it', () => {
  const src = readFileSync(join(__dirname, 'api.ts'), 'utf8');
  it('no longer raises the bare toast on every thrown fetch', () => {
    expect(src).not.toContain("notify('error', toastVi ? 'Mất kết nối mạng' : 'Network error');");
    expect(src).toMatch(/networkNotice\(/);
  });
  it('retries a failed GET once before saying anything, and never retries a write', () => {
    expect(src).toMatch(/method === 'GET' && !isAbortError\(e\) && !pageUnloading/);
    expect(src).toMatch(/GET_RETRY_DELAY_MS/);
  });
});
