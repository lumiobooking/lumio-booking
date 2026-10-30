/**
 * Booking page pictures: the 1 KB gradient tiles stay inline (they used to
 * become /img links that always 404'd — dark squares, then nothing), real
 * photos become versioned links kept a year, and the picture route is not
 * strangled by the rate limit on a menu of dozens.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PictureCache, decodeRaster, pictureVersion, publicPicture } from './public-images';

const tile = "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'480'%3E%3C%2Fsvg%3E";
const jpeg = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
const url = (v: string) => `https://api.test/api/public/salons/lumio/img/service/s1?v=${v}`;

describe('what the booking page gets for a picture', () => {
  it('our own SVG tile stays inline — no request, nothing to 404', () => {
    expect(publicPicture(tile, url)).toBe(tile);
  });
  it('a base64 photo becomes a link carrying its content version', () => {
    const out = publicPicture(jpeg, url)!;
    expect(out).toBe(url(pictureVersion(jpeg)));
    expect(pictureVersion(jpeg)).toMatch(/^[A-Za-z0-9_-]{10}$/);
    // A new photo, a new link (so a year of caching never shows the old one).
    expect(publicPicture(`data:image/jpeg;base64,${Buffer.from('another').toString('base64')}`, url)).not.toBe(out);
  });
  it('an https photo is passed through; empty is null', () => {
    expect(publicPicture('https://cdn.test/a.jpg', url)).toBe('https://cdn.test/a.jpg');
    expect(publicPicture('', url)).toBeNull();
    expect(publicPicture(null, url)).toBeNull();
  });
  it('a data URI the picture route cannot serve is dropped, not handed out as a dead link', () => {
    expect(publicPicture('data:text/html;base64,PHNjcmlwdD4=', url)).toBeNull();
    expect(publicPicture(`data:image/svg+xml,${'x'.repeat(70 * 1024)}`, url)).toBeNull();
  });
});

describe('the picture route', () => {
  it('decodes base64 photos (line breaks tolerated) and nothing else', () => {
    const wrapped = `data:image/png;base64,${Buffer.from('png-bytes-here').toString('base64').replace(/(.{4})/g, '$1\n')}`;
    expect(decodeRaster(wrapped)?.buf.toString()).toBe('png-bytes-here');
    expect(decodeRaster(jpeg)?.type).toBe('image/jpeg');
    expect(decodeRaster(tile)).toBeNull();
    expect(decodeRaster('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
  });
  it('keeps decoded pictures in a bounded cache; oldest go first; entries expire', () => {
    const c = new PictureCache(100, 1000);
    c.set('a', { type: 'image/png', buf: Buffer.alloc(20) }, 0);
    c.set('b', { type: 'image/png', buf: Buffer.alloc(20) }, 0);
    expect(c.get('a', 10)).not.toBeNull();
    for (const k of ['c', 'd', 'e']) c.set(k, { type: 'image/png', buf: Buffer.alloc(20) }, 10);
    c.set('f', { type: 'image/png', buf: Buffer.alloc(20) }, 10); // over 100 bytes → "b" (least recent) goes
    expect(c.get('b', 20)).toBeNull();
    expect(c.get('a', 20)).not.toBeNull();
    expect(c.get('a', 5000)).toBeNull(); // expired
  });
  it('is wired: versioned + cached, a generous budget, keys carry the salon; bootstrap uses publicPicture', () => {
    const src = readFileSync(join(__dirname, 'public-salon.controller.ts'), 'utf8');
    expect(src).toMatch(/@RateLimit\(1500, 60_000\)\n  async image\(/);
    expect(src).toMatch(/const key = `\$\{slug\}\|\$\{kind\}\|\$\{id\}\|\$\{version\}`/);
    expect(src).toMatch(/publicPicture\(x\.imageUrl/);
    expect(src).toMatch(/publicPicture\(x\.avatarUrl/);
    // Every read still goes through THIS salon (tenantId) and active rows only.
    expect(src).toMatch(/where: \{ id, tenantId: tenant\.id, isActive: true \}, select: \{ imageUrl: true \}/);
  });
});
