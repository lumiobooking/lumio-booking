/**
 * A minimal ZIP writer — because a .docx IS a zip, and the npm registry is not
 * reachable from every environment this app is built in, so a docx library
 * cannot be a dependency. Entries are STORED (method 0, no compression): Word,
 * LibreOffice and Google Docs all accept it, the report weighs a few hundred
 * kilobytes at most, and "no compression" removes the one part of the format
 * that would actually need a library.
 *
 * Format, for the next reader: [local header + data] per entry, then a central
 * directory repeating every header with its offset, then one end-of-central-
 * directory record pointing at the directory. Names are UTF-8 (flag 0x0800).
 */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

/** Little-endian byte writer — the whole format is little-endian. */
class Bytes {
  private chunks: Uint8Array[] = [];
  private len = 0;
  get length(): number { return this.len; }
  u16(v: number): void { this.chunks.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])); this.len += 2; }
  u32(v: number): void { this.chunks.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])); this.len += 4; }
  raw(b: Uint8Array): void { this.chunks.push(b); this.len += b.length; }
  out(): Uint8Array {
    const o = new Uint8Array(this.len);
    let at = 0;
    for (const c of this.chunks) { o.set(c, at); at += c.length; }
    return o;
  }
}

// A fixed DOS timestamp (2026-01-01 00:00). Reproducible output beats a real
// clock here: the same report data must produce byte-identical files, which is
// also what makes this module testable.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Build a stored-method zip from named entries, in the given order. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const body = new Bytes();
  const dir = new Bytes();
  let count = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const offset = body.length;

    body.u32(0x04034b50); body.u16(20); body.u16(0x0800); body.u16(0);
    body.u16(DOS_TIME); body.u16(DOS_DATE);
    body.u32(crc); body.u32(e.data.length); body.u32(e.data.length);
    body.u16(name.length); body.u16(0);
    body.raw(name); body.raw(e.data);

    dir.u32(0x02014b50); dir.u16(20); dir.u16(20); dir.u16(0x0800); dir.u16(0);
    dir.u16(DOS_TIME); dir.u16(DOS_DATE);
    dir.u32(crc); dir.u32(e.data.length); dir.u32(e.data.length);
    dir.u16(name.length); dir.u16(0); dir.u16(0);
    dir.u16(0); dir.u16(0); dir.u32(0);
    dir.u32(offset);
    dir.raw(name);
    count += 1;
  }

  const out = new Bytes();
  out.raw(body.out());
  const dirBytes = dir.out();
  out.raw(dirBytes);
  out.u32(0x06054b50); out.u16(0); out.u16(0);
  out.u16(count); out.u16(count);
  out.u32(dirBytes.length); out.u32(body.length);
  out.u16(0);
  return out.out();
}
