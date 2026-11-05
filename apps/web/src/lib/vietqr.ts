/**
 * VietQR without a third party: the NAPAS 247 payload (EMVCo) for a bank
 * account, an amount and a note, and a QR matrix for it.
 *
 * The same file lives in apps/web/src/lib/vietqr.ts and apps/api/src/common/vietqr.ts (a spec keeps the two
 * identical). The screen draws the matrix as an SVG, the printer as dots, so
 * the code a guest scans on paper is the code the cashier sees on screen —
 * and nothing depends on img.vietqr.io being up.
 *
 * Pure. The QR encoder is a byte-mode, error-correction-M port of Project
 * Nayuki's reference generator (MIT).
 */

export interface VietQrAccount { bin: string; accountNo: string; accountName?: string }

/** Banks people in Vietnam use, with the NAPAS BIN a VietQR needs. */
export const VN_BANK_LIST: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' }, { bin: '970415', name: 'VietinBank' }, { bin: '970418', name: 'BIDV' }, { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' }, { bin: '970422', name: 'MB Bank' }, { bin: '970416', name: 'ACB' }, { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' }, { bin: '970403', name: 'Sacombank' }, { bin: '970441', name: 'VIB' }, { bin: '970437', name: 'HDBank' },
  { bin: '970443', name: 'SHB' }, { bin: '970448', name: 'OCB' }, { bin: '970426', name: 'MSB' }, { bin: '970440', name: 'SeABank' },
  { bin: '970431', name: 'Eximbank' }, { bin: '970449', name: 'LPBank' }, { bin: '970428', name: 'Nam A Bank' }, { bin: '970409', name: 'Bac A Bank' },
  { bin: '970412', name: 'PVcomBank' }, { bin: '970452', name: 'KienlongBank' }, { bin: '970454', name: 'BVBank (Bản Việt)' }, { bin: '970425', name: 'ABBANK' },
  { bin: '970419', name: 'NCB' }, { bin: '970433', name: 'VietBank' }, { bin: '970400', name: 'Saigonbank' }, { bin: '970429', name: 'SCB' },
  { bin: '970427', name: 'VietABank' }, { bin: '970430', name: 'PGBank' }, { bin: '970438', name: 'BaoViet Bank' }, { bin: '970408', name: 'GPBank' },
  { bin: '970446', name: 'Co-opBank' }, { bin: '970424', name: 'Shinhan Bank' }, { bin: '970457', name: 'Woori Bank' }, { bin: '970458', name: 'UOB' },
  { bin: '970439', name: 'Public Bank' }, { bin: '970410', name: 'Standard Chartered' }, { bin: '970434', name: 'Indovina Bank' }, { bin: '458761', name: 'HSBC' },
  { bin: '422589', name: 'CIMB' }, { bin: '668888', name: 'KBank' }, { bin: '546034', name: 'Cake by VPBank' }, { bin: '546035', name: 'Ubank by VPBank' },
  { bin: '963388', name: 'Timo' }, { bin: '971005', name: 'Viettel Money' }, { bin: '971011', name: 'VNPT Money' },
];

export function bankLabel(bin: string): string {
  return VN_BANK_LIST.find((b) => b.bin === bin)?.name ?? `BIN ${bin}`;
}

/** "Nguyễn Văn Á" → "NGUYEN VAN A": what banks show and what fits a QR note. */
export function plainUpper(s: unknown, max = 50): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** A usable account (6-digit BIN, 4–24 letters/digits), cleaned; otherwise null. */
export function cleanAccount(raw: unknown): VietQrAccount | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bin = String(o.bin ?? '').replace(/\D/g, '');
  const accountNo = String(o.accountNo ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 24);
  const accountName = plainUpper(o.accountName);
  return bin.length === 6 && accountNo.length >= 4 ? { bin, accountNo, accountName } : null;
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE, what EMVCo puts in tag 63. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * The VietQR text: the account, and — when given — the exact amount (đồng)
 * and a short note (no accents, ≤ 25 characters, e.g. the bill code "LM57").
 * Any banking app, MoMo and ZaloPay fill the transfer in from it.
 */
export function vietQrPayload(account: VietQrAccount | null | undefined, amount?: number | null, note?: string | null): string | null {
  const a = cleanAccount(account);
  if (!a) return null;
  const amt = Math.round(Number(amount ?? 0));
  const memo = plainUpper(note ?? '', 25);
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', a.bin) + tlv('01', a.accountNo)) + tlv('02', 'QRIBFTTA');
  let s = tlv('00', '01') + tlv('01', amt > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amt > 0) s += tlv('54', String(Math.min(amt, 9_999_999_999_999)));
  s += tlv('58', 'VN');
  if (memo) s += tlv('62', tlv('08', memo));
  s += '6304';
  return s + crc16(s);
}

// ------------------------------------------------------------ QR matrix --

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_M[ver] * BLOCKS_M[ver];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/**
 * The QR code for a text as rows of booleans (true = dark), without the
 * quiet zone; error correction M, the smallest version that fits (≤ 40).
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    const need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new Error('QR_TOO_LONG');
  const cap = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Error correction, interleaved.
  const nBlocks = BLOCKS_M[ver];
  const eccLen = ECC_M[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });
  }

  const size = ver * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { mod[y][x] = dark; fn[y][x] = true; };

  const formatBits = (mask: number) => {
    const d = (0 << 3) | mask; // M = 0
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };

  // Function patterns.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx; const yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align: number[] = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
  }
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  formatBits(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      set(a, c, dark); set(c, a, dark);
    }
  }

  // Data, zig-zag.
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const up = ((right + 1) & 2) === 0;
      const y = up ? size - 1 - v : v;
      if (!fn[y][x] && bi < all.length * 8) { mod[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
    }
  }

  const flip = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv: boolean;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv && !fn[y][x]) mod[y][x] = !mod[y][x];
    }
  };

  const penalty = (): number => {
    let score = 0;
    const count = (h: number[]) => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const add = (len: number, h: number[]) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
    const line = (get: (i: number) => boolean) => {
      let color = false; let run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < size; i++) {
        if (get(i) === color) {
          run++;
          if (run === 5) score += 3; else if (run > 5) score++;
        } else {
          add(run, h);
          if (!color) score += count(h) * 40;
          color = get(i); run = 1;
        }
      }
      if (color) { add(run, h); run = 0; }
      run += size; add(run, h);
      score += count(h) * 40;
    };
    for (let y = 0; y < size; y++) line((x) => mod[y][x]);
    for (let x = 0; x < size; x++) line((y) => mod[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
    }
    let dark = 0;
    for (const row of mod) for (const c of row) if (c) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  };

  let best = 0; let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    flip(m); formatBits(m);
    const s = penalty();
    if (s < bestScore) { bestScore = s; best = m; }
    flip(m);
  }
  flip(best); formatBits(best);
  return mod;
}

/** The matrix as one SVG path (with a 4-module quiet zone), for an <img> or inline. */
export function qrSvg(text: string, px = 220): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let e = x;
      while (e < row.length && row[e]) e++;
      d += `M${x + 4} ${y + 4}h${e - x}v1h-${e - x}z`;
      x = e;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** A data: URL any <img> can show (no network). */
export function qrDataUrl(text: string, px = 220): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, px))}`;
}

/**
 * The line a print job carries for a QR: the printing computer draws the
 * code in its place. Text-only printers drop it (the account lines stay).
 */
export const QR_LINE = /^\s*\[\[QR:([\x20-\x7e]{1,600})\]\]\s*$/;
export const qrLine = (payload: string) => `[[QR:${payload}]]`;

/** A print job's text without its QR lines (for printers and screens that cannot draw one). */
export function withoutQrLines(text: string, replacement = ''): string {
  return String(text ?? '').split('\n').flatMap((l) => (QR_LINE.test(l) ? (replacement ? [replacement] : []) : [l])).join('\n');
}
