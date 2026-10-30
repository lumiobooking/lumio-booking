/**
 * PICTURES ON THE BOOKING PAGE — which stay in the JSON, which become a URL.
 *
 * "Hệ thống vẫn đang bị load chậm mục hình ảnh" (Oct 2026). Lumio Salon's menu
 * showed dark squares that filled in slowly, then vanished. The cause:
 *
 *  - 65 of its 66 services carry the 1 KB gradient tile we draw ourselves
 *    (services.service: a URL-encoded `data:image/svg+xml,…`, not base64);
 *  - bootstrap turned EVERY data URI into /img/service/:id, but that route
 *    only serves base64 raster pictures, so all 65 came back 404 — each after
 *    a ~0.5 s round trip to the database, while the page showed a placeholder;
 *  - 66 requests per visit, counted in one rate-limit bucket per IP (150 a
 *    minute): a salon's Wi-Fi with a few customers on it got 429s.
 *
 * Now: a small SVG tile stays inline (gzip packs seven distinct tiles into a
 * few hundred bytes, and an <img> never runs script in an SVG); a real photo
 * (base64 png/jpeg/webp/gif/avif) becomes a URL with a content version, so the
 * browser may keep it a year and a changed photo shows at once; anything else
 * is dropped rather than handed out as a link that is certain to fail.
 */
import { createHash } from 'crypto';

export const RASTER_DATA_URI = /^data:(image\/(?:png|jpe?g|webp|gif|avif));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const SVG_INLINE_MAX = 64 * 1024;

/** What the booking page gets for one stored picture. */
export function publicPicture(raw: string | null | undefined, urlFor: (version: string) => string): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!v.startsWith('data:')) return v; // an https link the salon gave: as it is
  if (/^data:image\/svg\+xml[;,]/i.test(v)) return v.length <= SVG_INLINE_MAX ? v : null;
  if (RASTER_DATA_URI.test(v)) return urlFor(pictureVersion(v));
  return null;
}

/** A short content hash: same picture → same URL; a new picture → a new URL. */
export function pictureVersion(dataUri: string): string {
  return createHash('sha1').update(dataUri).digest('base64url').slice(0, 10);
}

/** A stored base64 raster data URI as bytes, or null. */
export function decodeRaster(raw: string | null | undefined): { type: string; buf: Buffer } | null {
  const m = RASTER_DATA_URI.exec((raw ?? '').trim());
  if (!m) return null;
  return { type: m[1].toLowerCase().replace('image/jpg', 'image/jpeg'), buf: Buffer.from(m[2].replace(/[\r\n]/g, ''), 'base64') };
}

/**
 * A tiny bounded cache of decoded pictures, so a menu of photos is not 30
 * database reads per visitor. Keyed by salon + picture + version (a changed
 * picture is a new key); entries expire, and the oldest go first past the cap.
 */
export class PictureCache {
  private readonly map = new Map<string, { type: string; buf: Buffer; at: number }>();
  private bytes = 0;
  constructor(private readonly maxBytes = 32 * 1024 * 1024, private readonly ttlMs = 30 * 60_000) {}

  get(key: string, now = Date.now()): { type: string; buf: Buffer } | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (now - e.at > this.ttlMs) { this.drop(key); return null; }
    this.map.delete(key); this.map.set(key, e); // most recent last
    return e;
  }

  set(key: string, v: { type: string; buf: Buffer }, now = Date.now()): void {
    if (v.buf.length > this.maxBytes / 4) return;
    this.drop(key);
    this.map.set(key, { ...v, at: now });
    this.bytes += v.buf.length;
    while (this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  get size(): number { return this.map.size; }

  private drop(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.buf.length;
    this.map.delete(key);
  }
}
