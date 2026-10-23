import { createHash, randomBytes } from 'crypto';

/**
 * One-touch printer setup — the pure parts.
 *
 * A "print device" is a Windows PC at the shop that has the printers. The
 * owner (or Lumio support, from far away) clicks "Add a computer" and gets one
 * line to paste into Windows' Run box. That line downloads a small PowerShell
 * script carrying a one-time code (8 characters, 30 minutes); the script trades
 * the code for the device's own token, installs the agent, starts it with
 * Windows, and reports the printers it found. From then on everything — which
 * printer prints bills, which prints the kitchen tickets, test prints — is set
 * on the web. No Node.js, no config file, no API key to copy.
 *
 * Every device belongs to one tenant; its token is stored hashed and is
 * revocable. A device only ever sees its own tenant's jobs.
 */

export const ROUTE_ANY = '*';
/** `drawer`: a cash drawer is plugged into this printer (RJ11); a cash sale opens it. */
export interface Route { printer?: string; host?: string; port?: number; beep?: boolean; drawer?: boolean; paper?: 58 | 80 }
export type Routes = Record<string, Route>;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_MINUTES = 30;

export function makeCode(): string {
  return [...randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function cleanCode(raw: unknown): string | null {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export function makeToken(): string {
  return `lpd_${randomBytes(24).toString('base64url')}`;
}

export function tokenShapeOk(raw: unknown): raw is string {
  return typeof raw === 'string' && /^lpd_[A-Za-z0-9_-]{20,60}$/.test(raw);
}

const text = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

/** The printer names a PC reported: clean, unique, at most 40. */
export function cleanPrinters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => text(x, 120)).filter(Boolean))].slice(0, 40);
}

export function cleanName(raw: unknown): string {
  return text(raw, 60);
}

/** A route key: a station code (KITCHEN, BAR, COUNTER…) or "*" for everything else. */
export function cleanKey(raw: unknown): string | null {
  const k = String(raw ?? '').trim().toUpperCase();
  return k === ROUTE_ANY || /^[A-Z0-9_]{2,20}$/.test(k) ? k : null;
}

const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*)$/;

function hostOk(h: string): boolean {
  if (!HOST_RE.test(h)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h.split('.').every((x) => Number(x) <= 255);
  return true;
}

/**
 * Which printer each kind of ticket goes to, on one computer:
 * { COUNTER: { printer: 'XP-80C' }, KITCHEN: { host: '192.168.1.50', port: 9100, beep: true }, '*': { printer: '' } }.
 * `printer: ''` is the computer's default printer. Anything else is dropped.
 */
export function cleanRoutes(raw: unknown): Routes {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Routes = {};
  for (const [k, v] of Object.entries(o).slice(0, 20)) {
    const key = cleanKey(k);
    if (!key || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const host = text(r.host, 120);
    if (host) {
      if (!hostOk(host)) continue;
      const port = Math.round(Number(r.port));
      out[key] = { host, port: port >= 1 && port <= 65535 ? port : 9100, ...(r.beep === true ? { beep: true } : {}), ...(r.drawer === true ? { drawer: true } : {}) };
    } else {
      out[key] = { printer: text(r.printer, 120), ...(r.drawer === true ? { drawer: true } : {}), ...(Number(r.paper) === 58 ? { paper: 58 as const } : {}) };
    }
  }
  return out;
}

export interface DeviceLike { id: string; routes: unknown; pairedAt: Date | null }

/**
 * Which computer prints a job, and on which printer. A test print names its
 * computer and route. Otherwise the first computer (oldest first) that routes
 * the job's station takes it; then the first one with an "everything else"
 * route. None → the job waits.
 */
export function routeFor(job: { station: string | null; route?: string | null; deviceId?: string | null }, devices: DeviceLike[]): { deviceId: string; key: string; route: Route } | null {
  const live = devices.filter((d) => d.pairedAt).sort((a, b) => a.pairedAt!.getTime() - b.pairedAt!.getTime());
  const key = cleanKey(job.route) ?? (job.station ? String(job.station).toUpperCase() : 'COUNTER');
  if (job.deviceId) {
    const d = live.find((x) => x.id === job.deviceId);
    if (!d) return null;
    const r = cleanRoutes(d.routes);
    return { deviceId: d.id, key, route: r[key] ?? r[ROUTE_ANY] ?? { printer: '' } };
  }
  for (const d of live) { const r = cleanRoutes(d.routes)[key]; if (r) return { deviceId: d.id, key, route: r }; }
  for (const d of live) { const r = cleanRoutes(d.routes)[ROUTE_ANY]; if (r) return { deviceId: d.id, key: ROUTE_ANY, route: r }; }
  return null;
}

/**
 * Where "open the cash drawer" goes when no ticket prints with it (the till's
 * "Mở két" button, a cash sale without a receipt): the printer the drawer is
 * plugged into — the counter's first, then "everything else", then any.
 */
export function drawerRoute(devices: DeviceLike[], deviceId?: string | null, key?: string | null): { deviceId: string; key: string; route: Route } | null {
  const live = devices.filter((d) => d.pairedAt).sort((a, b) => a.pairedAt!.getTime() - b.pairedAt!.getTime());
  if (deviceId) {
    const d = live.find((x) => x.id === deviceId);
    const k = cleanKey(key);
    const r = d && k ? cleanRoutes(d.routes)[k] : undefined;
    return d && k && r ? { deviceId: d.id, key: k, route: r } : null;
  }
  for (const pick of ['COUNTER', ROUTE_ANY, '']) {
    for (const d of live) {
      const routes = cleanRoutes(d.routes);
      const hit = pick ? (routes[pick]?.drawer ? pick : null) : Object.keys(routes).find((k) => routes[k].drawer) ?? null;
      if (hit) return { deviceId: d.id, key: hit, route: routes[hit] };
    }
  }
  return null;
}

/** ESC p — pulse both drawer pins (2 and 5); a pin with no drawer does nothing. */
export const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa]);

// ------------------------------------------------------------ the ticket --

/**
 * One printed line and how to draw it: 'n' normal, 'b' bold, 't' a title (the
 * shop name, "HOÁ ĐƠN"), 'h' huge (the table on a kitchen ticket), 's' a
 * dashed rule. `c` centred. `a` the amount of a two-column line ("2x Phở ...
 * 170.000 đ"), drawn pinned to the right edge.
 */
export type Row = { r: 'n' | 'b' | 't' | 'h' | 's'; t: string; a?: string; c?: true };

const TWO_COL = /^(.*?\S)\s{2,}(\S(?:.*\S)?)$/;

/**
 * The printable width the driver may draw on, in 1/100 inch: 72 mm of an
 * 80 mm roll, 48 mm of a 58 mm one. Some drivers report the whole paper, and
 * the amounts at the right edge of the bill fell off it.
 */
export function printableWidth(route: Route): number {
  return route.paper === 58 ? 189 : 283;
}

/** The base font size (points) of a ticket on this paper: readable, like the bill designer's preview. */
export function baseFontSize(route: Route): number {
  return route.paper === 58 ? 8.5 : 10;
}

/**
 * How each line is drawn, read from the ticket text every screen already
 * makes (monospace, centred with spaces): the shop name and the title large,
 * rules as rules, centred lines centred, amounts pinned right, the total bold,
 * the table huge on a kitchen ticket. The agent then draws it in a normal
 * font, so the paper looks like the bill designer's preview.
 */
export function styleRows(textIn: string, station: string | null): Row[] {
  const lines = String(textIn ?? '').replace(/\r/g, '').split('\n').map((x) => x.replace(/\s+$/, ''));
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  const cols = Math.max(32, Math.min(48, lines.reduce((m, x) => Math.max(m, x.length), 0)));
  const kitchen = !!station && String(station).toUpperCase() !== 'COUNTER';
  let seen = false;
  return lines.map((t, i) => {
    if (/^\s*[-=_]{8,}\s*$/.test(t)) return { r: 's', t } as Row;
    const body = t.trim();
    const lead = t.length - t.trimStart().length;
    const centred = !!body && lead >= 2 && Math.abs(lead - (cols - lead - body.length)) <= 2;
    let r: Row['r'] = 'n';
    if (kitchen) {
      if (i === 0 && body) r = 'b';
      else if (i === 1 && body) r = 'h';
      else if (/^\d+\s*x\s/i.test(body) || /^\s+[-+]\s/.test(t)) r = 'b';
    } else if (!seen && body) r = 't';
    else if (centred && /^(HOÁ ĐƠN|HÓA ĐƠN|PHIẾU TẠM TÍNH|TẠM TÍNH|PHIẾU THU|RECEIPT|GUEST CHECK)/i.test(body)) r = 't';
    else if (/^(TỔNG|TONG|TOTAL|PHẢI TRẢ|PHAI TRA|CHƯA PHẢI HOÁ ĐƠN|CHƯA PHẢI HÓA ĐƠN|NOT A RECEIPT)/i.test(body)) r = 'b';
    if (body) seen = true;
    const row: Row = { r, t };
    if (centred || r === 'h') { row.c = true; return row; }
    const m = TWO_COL.exec(t);
    if (m && m[2].length <= 22 && /\d/.test(m[2]) && m[1].trim()) row.a = m[2];
    return row;
  });
}

/** Columns the ticket was laid out for (32 for kitchen tickets, up to 48 for receipts). */
export function columnsOf(rows: Row[]): number {
  const longest = rows.filter((x) => x.r !== 'h').reduce((m, x) => Math.max(m, x.t.replace(/\s+$/, '').length), 0);
  return Math.max(32, Math.min(48, longest));
}

/** "Phở bò tái" → "Pho bo tai": thermal printers rarely have a Vietnamese code page. */
export function plain(s: string): string {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '-').replace(/′/g, "'")
    .replace(/[^\x0a\x20-\x7e]/g, '?');
}

/** Raw ESC/POS for a network printer: big table line, bold dishes, feed and cut (and the drawer). */
export function escposBytes(rows: Row[], route: Route, opts: { kick?: boolean; drawerOnly?: boolean } = {}): Buffer {
  const ESC = 0x1b; const GS = 0x1d;
  if (opts.drawerOnly) return Buffer.concat([Buffer.from([ESC, 0x40]), DRAWER_KICK]);
  // The drawer opens first: the cashier counts the change while the bill prints.
  const parts: Buffer[] = [Buffer.from([ESC, 0x40]), ...(opts.kick ? [DRAWER_KICK] : [])];
  if (route.beep) parts.push(Buffer.from([ESC, 0x42, 0x02, 0x02]));
  for (const x of rows) {
    const t = plain(x.t);
    const centre = x.c ? [ESC, 0x61, 0x01] : [];
    const back = x.c ? [ESC, 0x61, 0x00] : [];
    const body = x.c ? t.trim() : t;
    if (x.r === 'h') parts.push(Buffer.from([ESC, 0x61, 0x01, GS, 0x21, 0x11, ESC, 0x45, 0x01]), Buffer.from(t.trim(), 'latin1'), Buffer.from([0x0a, GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00]));
    else if (x.r === 't' || x.r === 'b') parts.push(Buffer.from([...centre, ESC, 0x45, 0x01, GS, 0x21, 0x01]), Buffer.from(body, 'latin1'), Buffer.from([0x0a, GS, 0x21, 0x00, ESC, 0x45, 0x00, ...back]));
    else parts.push(Buffer.from(centre), Buffer.from(body, 'latin1'), Buffer.from([0x0a, ...back]));
  }
  parts.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}

/**
 * JSON with every non-ASCII character escaped. Windows PowerShell 5.1 guesses
 * the text encoding of a response; plain ASCII cannot be guessed wrong, so
 * "Phở" reaches the printer as "Phở".
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The address the shop's PC reaches this API at, as the owner's browser did. */
export function publicApiBase(headers: Record<string, unknown>, fallbackProto = 'https'): string {
  const env = String(process.env.PRINT_AGENT_API_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//.test(env)) return env;
  const proto = String(headers['x-forwarded-proto'] ?? fallbackProto).split(',')[0].trim() || 'https';
  const host = String(headers['x-forwarded-host'] ?? headers.host ?? '').split(',')[0].trim();
  return `${proto}://${host}/api`;
}

/** The one line the shop pastes into Windows' Run box (Win + R). Under 260 characters. */
export function runLine(url: string): string {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=3072;irm '${url}'|iex"`;
}

export function testTicket(key: string, deviceName: string, at: string): string {
  const kitchen = key !== 'COUNTER' && key !== ROUTE_ANY;
  return [
    kitchen ? `      ${key} · IN THỬ` : '     LUMIO PRINT · IN THỬ',
    kitchen ? '        BÀN M3' : 'Phiếu in thử / Test page',
    `Máy tính: ${deviceName || '-'}`,
    at,
    '--------------------------------',
    '2 x Phở bò tái nạm',
    '    + Tô lớn',
    '    - Không hành',
    '1 x Cà phê sữa đá',
    '--------------------------------',
    kitchen ? '            3 món' : 'TỔNG CỘNG              150.000đ',
    '',
    'Có dấu tiếng Việt? In rõ? Tự cắt giấy?',
  ].join('\n');
}
