/**
 * ONE WEBSITE READER, NOT TWO.
 *
 * The salon's "Đọc từ website" button (Bot facts) and the content planner's
 * website import are two screens asking the same question: what does this
 * business say about itself? For a long time they were two DIFFERENT pieces of
 * code doing it — messenger.service.ts carried its own fetch, its own three
 * request headers and its own "this site blocks us" sentence.
 *
 * The cost was invisible and expensive. Every improvement to the real reader
 * (the full browser fingerprint that gets past a bot wall, the www fallback,
 * business facts lifted from the page's JSON-LD, the extra /services and
 * /pricing pages) landed in common/site-reader.ts, shipped, and changed
 * nothing on the Bot-facts screen — which kept failing on the same sites with
 * the same old message, deploy after deploy, while it looked like the fix
 * simply had not worked.
 *
 * These tests read the source. That is deliberate: the failure was never a
 * wrong return value, it was a second copy existing at all, and only the
 * source can see that.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SERVICE = join(__dirname, 'messenger.service.ts');
const SRC = join(__dirname, '..');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { tsFiles(full, out); continue; }
    if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('the website reader is not duplicated', () => {
  const service = readFileSync(SERVICE, 'utf8');

  it('importFacts calls the shared reader', () => {
    expect(service).toContain("from '../common/site-reader'");
    expect(service).toContain('readWebsite(');
    expect(service).toContain('readFacebookPage(');
  });

  it('messenger.service.ts no longer fetches a website itself', () => {
    // The tell of a hand-rolled fetch: a browser user-agent written out here.
    expect(service).not.toContain('Mozilla/5.0');
    // ...and the old blocked-site sentence, which is what the salon kept seeing.
    expect(service).not.toContain('chặn đọc tự động');
    expect(service).not.toContain('LumioBot/1.0');
  });

  it('only browser-headers.ts declares a browser identity, anywhere in the API', () => {
    const owners = tsFiles(SRC)
      .filter((f) => !f.endsWith('.spec.ts'))   // a test may name the string it guards
      .filter((f) => readFileSync(f, 'utf8').includes('Mozilla/5.0'))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(owners.sort()).toEqual(['common/browser-headers.ts']);
  });

  it('only browser-headers.ts words the blocked-site message', () => {
    const owners = tsFiles(SRC)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('chặn máy chủ đọc tự động'))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(owners.sort()).toEqual(['common/browser-headers.ts']);
  });
});
