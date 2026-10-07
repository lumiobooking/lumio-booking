/**
 * NHẬP KHÁCH CŨ — one row of a salon's old client list, made safe.
 *
 * The page maps the file's columns to these keys (Square, Vagaro, Fresha,
 * GlossGenius… all name them differently); the server is the authority on
 * what each value means. Money like "$1,234.50", dates like "03/14/2024",
 * "2024-03-14" or "Mar 14", yes/no like "Subscribed" — all read here.
 * Pure.
 */
export interface ImportIn {
  firstName?: unknown; lastName?: unknown; name?: unknown; phone?: unknown; email?: unknown;
  birthday?: unknown; points?: unknown; spent?: unknown; visits?: unknown; lastVisit?: unknown; notes?: unknown; smsOptIn?: unknown;
}
export interface ImportRow {
  firstName: string; lastName: string | null; phone: string | null; email: string | null;
  birthDate: Date | null; points: number; spentCents: number; visits: number; lastVisitAt: Date | null; notes: string | null; smsOptIn: boolean;
}

const str = (v: unknown, max = 200) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "$1,234.50" / "1.234,50 ₫" / "(12.00)" → cents. Negative or junk → 0. */
export function moneyToCents(v: unknown): number {
  let s = str(v, 40).replace(/[^\d.,-]/g, '');
  if (!s || s.startsWith('-')) return 0;
  // "1.234,50" (comma decimals) vs "1,234.50"
  if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), 2_000_000_000) : 0;
}

export function toInt(v: unknown, max = 1_000_000): number {
  const n = Math.round(Number(str(v, 20).replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100;
const utc = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 ? t : null; };

/**
 * A date as US salons' exports write it. MM/DD/YYYY is read month-first (US/CA
 * exports); a first number above 12 is read as DD/MM. `noYear` dates (a
 * birthday "03/14", "Mar 14") get year 2000 — only month/day are used.
 */
export function parseDate(v: unknown): Date | null {
  const s = str(v, 40);
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]) ? utc(+m[1], +m[2], +m[3]) : null;
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(s);
  if (m) {
    let a = +m[1], b = +m[2];
    let y = m[3] ? +m[3] : 2000;
    if (y < 100) y += y > 50 ? 1900 : 2000;
    if (a > 12 && b <= 12) [a, b] = [b, a];
    return valid(y, a, b) ? utc(y, a, b) : null;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(s);
  if (m) {
    const w = m[1].toLowerCase();
    const mo = MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
    const y = m[3] ? +m[3] : 2000;
    if (mo && valid(y, mo, +m[2])) return utc(y, mo, +m[2]);
  }
  return null;
}

export function yes(v: unknown): boolean {
  return /^(y|yes|true|1|x|✓|opted ?in|subscribed|consent(ed)?|có|co|đồng ý|dong y)$/i.test(str(v, 30));
}

/** One row, cleaned; null when there is no name and no way to reach the person. */
export function normalizeImportRow(r: ImportIn): ImportRow | null {
  let first = str(r.firstName, 80);
  let last = str(r.lastName, 80);
  if (!first && str(r.name, 160)) {
    const parts = str(r.name, 160).split(' ');
    first = parts.shift() ?? '';
    last = last || parts.join(' ');
  }
  const phoneRaw = str(r.phone, 40);
  const phone = phoneRaw.replace(/\D/g, '').length >= 7 ? phoneRaw : null;
  const emailRaw = str(r.email, 160).toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  if (!first && !phone && !email) return null;
  return {
    firstName: first || (email ? email.split('@')[0] : 'Client'),
    lastName: last || null,
    phone, email,
    birthDate: parseDate(r.birthday),
    points: toInt(r.points),
    spentCents: moneyToCents(r.spent),
    visits: toInt(r.visits, 100_000),
    lastVisitAt: parseDate(r.lastVisit),
    notes: str(r.notes, 1000) || null,
    smsOptIn: yes(r.smsOptIn),
  };
}

/** Phone key for matching an existing client: the last 9 digits (7 at least). */
export function phoneTail(p: string | null | undefined): string {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
}
