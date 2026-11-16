/**
 * No "Đã có bản cập nhật" for anyone (owner's rule, 16/11/2026: he deploys
 * several times a day and customers must not be told each time).
 * Read from the source: these are the three places that could bring it back.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('updates are silent', () => {
  it('the old route names no build — tabs opened before the change read that as "nothing to do"', () => {
    const route = src('app/api/build/route.ts');
    expect(route).not.toMatch(/buildId\s*:/);
  });

  it('current code asks the new route and renders nothing', () => {
    const pwa = src('components/PwaRegister.tsx');
    expect(pwa).toContain("fetch('/api/version'");
    expect(pwa).not.toContain("fetch('/api/build'");
    expect(pwa).toMatch(/return null;\s*}\s*$/);
    expect(pwa).not.toMatch(/Tải lại|Reload'/);
    expect(src('app/api/version/route.ts')).toMatch(/buildId\s*:/);
  });

  it('the worker still takes over at once — that is what reloads a tab left on the old code', () => {
    const sw = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
    expect(sw).toMatch(/addEventListener\('install', \(\) => self\.skipWaiting\(\)\)/);
    expect(sw).toContain('self.clients.claim()');
    expect(sw).toMatch(/const CACHE = 'lumio-cache-v(1[1-9]|[2-9]\d)'/);
  });
});

