/**
 * Table service, the rules that do not need a database.
 *
 * A restaurant bill lives on its table while the guests eat (a TableCheck),
 * and only becomes a sale (an Order) when it is paid. Lines go through three
 * states: UNSENT (the server is still typing, edit freely) → SENT (the kitchen
 * has the ticket, locked) → VOID (taken back, with a reason). "Send to kitchen"
 * sends only what is new, split by prep station, so pressing it twice prints
 * nothing the second time. Kept pure so every rule is tested.
 */

export type LineState = 'UNSENT' | 'SENT' | 'VOID';
export type CheckStatus = 'OPEN' | 'PAYING' | 'PAID' | 'VOID';

export interface Station { key: string; name: string }

export interface RestaurantSettings {
  stations: Station[];
  /** Menu category (as typed by the owner) → station key. */
  byCategory: Record<string, string>;
  defaultStation: string;
  /** Print a CANCEL ticket at the station when a sent dish is taken back. */
  printVoid: boolean;
  /** Print a MOVED ticket at every station still cooking for the table. */
  printMove: boolean;
  /** Taking back a sent dish needs pos.void or a manager PIN. */
  voidNeedsApproval: boolean;
  /** The floor turns a table yellow / red after this many minutes. */
  warnMinutes: number;
  lateMinutes: number;
  /** A dish marked sold out comes back by itself the next morning. */
  soldOutReset: boolean;
  /** When set, only these staff logins (and the owner) may take payment; the rest send "ready to pay". */
  cashierUserIds: string[];
}

export const SETTINGS_KEY = 'restaurant_service';

export const DEFAULT_SETTINGS: RestaurantSettings = {
  stations: [{ key: 'KITCHEN', name: 'Bếp' }, { key: 'BAR', name: 'Bar' }],
  byCategory: {},
  defaultStation: 'KITCHEN',
  printVoid: true,
  printMove: true,
  voidNeedsApproval: true,
  warnMinutes: 60,
  lateMinutes: 90,
  soldOutReset: true,
  cashierUserIds: [],
};

const KEY_RE = /^[A-Z0-9_]{2,20}$/;

/** Whatever was stored (or sent), as settings the till can trust. */
export function cleanSettings(raw: unknown): RestaurantSettings {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const stations: Station[] = [];
  if (Array.isArray(r.stations)) {
    for (const s of r.stations.slice(0, 8)) {
      const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const key = String(o.key ?? '').trim().toUpperCase();
      const name = String(o.name ?? '').trim().slice(0, 30);
      if (KEY_RE.test(key) && name && !stations.some((x) => x.key === key)) stations.push({ key, name });
    }
  }
  const list = stations.length ? stations : DEFAULT_SETTINGS.stations.map((s) => ({ ...s }));
  const keys = new Set(list.map((s) => s.key));
  const byCategory: Record<string, string> = {};
  if (r.byCategory && typeof r.byCategory === 'object' && !Array.isArray(r.byCategory)) {
    for (const [cat, key] of Object.entries(r.byCategory as Record<string, unknown>).slice(0, 200)) {
      const c = catKey(cat);
      const k = String(key ?? '').trim().toUpperCase();
      if (c && keys.has(k)) byCategory[c] = k;
    }
  }
  const def = String(r.defaultStation ?? '').trim().toUpperCase();
  const minutes = (v: unknown, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 5 && n <= 600 ? n : d;
  };
  const warn = minutes(r.warnMinutes, DEFAULT_SETTINGS.warnMinutes);
  const late = Math.max(warn + 5, minutes(r.lateMinutes, DEFAULT_SETTINGS.lateMinutes));
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    stations: list,
    byCategory,
    defaultStation: keys.has(def) ? def : list[0].key,
    printVoid: bool(r.printVoid, DEFAULT_SETTINGS.printVoid),
    printMove: bool(r.printMove, DEFAULT_SETTINGS.printMove),
    voidNeedsApproval: bool(r.voidNeedsApproval, DEFAULT_SETTINGS.voidNeedsApproval),
    warnMinutes: warn,
    lateMinutes: late,
    soldOutReset: bool(r.soldOutReset, DEFAULT_SETTINGS.soldOutReset),
    cashierUserIds: Array.isArray(r.cashierUserIds)
      ? [...new Set(r.cashierUserIds.map((x) => String(x ?? '').trim()).filter((x) => /^[A-Za-z0-9-]{8,64}$/.test(x)))].slice(0, 50)
      : [],
  };
}

/** Categories are matched loosely: "Đồ uống" and " đồ  uống " are the same. */
export function catKey(cat: unknown): string {
  return String(cat ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

const DRINK_RE = /(uống|uong|drink|beverage|bia|beer|bar\b|cà phê|ca phe|cafe|coffee|trà|tea|nước|juice|sinh tố|smoothie|cocktail|wine|rượu|soda|sữa|milk)/i;

/**
 * Where a dish is made. The owner's mapping wins; with none, a drinks-looking
 * category goes to the bar when the restaurant has one, everything else to the
 * default station.
 */
export function stationFor(category: string | null | undefined, s: RestaurantSettings): string {
  const c = catKey(category);
  if (c && s.byCategory[c]) return s.byCategory[c];
  if (c && DRINK_RE.test(c) && s.stations.some((x) => x.key === 'BAR')) return 'BAR';
  return s.defaultStation;
}

export function stationName(key: string | null | undefined, s: RestaurantSettings): string {
  return s.stations.find((x) => x.key === key)?.name ?? String(key ?? '');
}

export interface LineLike {
  id: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  note?: string | null;
  station: string;
  state: LineState | string;
  batch?: number | null;
}

/** What the guests owe: every line not taken back. */
export function checkTotals(lines: LineLike[]) {
  let subtotal = 0; let unsent = 0; let sent = 0; let voided = 0; let count = 0;
  for (const l of lines) {
    const amt = Math.max(0, l.unitPriceCents) * Math.max(0, l.quantity);
    if (l.state === 'VOID') { voided += amt; continue; }
    subtotal += amt;
    count += l.quantity;
    if (l.state === 'UNSENT') unsent += l.quantity; else sent += l.quantity;
  }
  return { subtotalCents: subtotal, itemCount: count, unsentCount: unsent, sentCount: sent, voidedCents: voided };
}

/** The new lines of one send, one group per station, in the station order. */
export function groupForSend(lines: LineLike[], s: RestaurantSettings): { station: string; lines: LineLike[] }[] {
  const todo = lines.filter((l) => l.state === 'UNSENT' && l.quantity > 0);
  const order = s.stations.map((x) => x.key);
  const keys = [...new Set(todo.map((l) => l.station))].sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((station) => ({ station, lines: todo.filter((l) => l.station === station) }));
}

/** Stations still cooking something for this bill (for a MOVED ticket). */
export function stationsCooking(lines: LineLike[]): string[] {
  return [...new Set(lines.filter((l) => l.state === 'SENT').map((l) => l.station))];
}

/** A clean quantity: whole, 1–99. */
export function qty(v: unknown, min = 1): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= 99 ? n : null;
}

/** A free-text kitchen note: one line, short, never priced. */
export function cleanNote(v: unknown): string | null {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return t || null;
}

// ---------------------------------------------------------------- printing --

export type Lang = 'vi' | 'en';
export const langFor = (currency: string | null | undefined): Lang => (String(currency || '').toUpperCase() === 'VND' ? 'vi' : 'en');

const W = 32; // fits 58 mm and 80 mm paper in the default font

const L = {
  vi: { NEW: 'MÓN MỚI', VOID: '*** HUỶ MÓN ***', MOVE: 'CHUYỂN BÀN', table: 'BÀN', check: 'Bill bàn', send: 'Lần gửi', guests: 'khách', server: 'PV', reason: 'Lý do', by: 'Huỷ', ok: 'Duyệt', items: 'món', sentAt: 'gửi lúc', still: 'Món đang làm ra bàn mới:', prebill: 'PHIẾU TẠM TÍNH', printed: 'in lần', total: 'TỔNG', notReceipt: 'CHƯA PHẢI HOÁ ĐƠN', cashier: 'TN' },
  en: { NEW: 'NEW ORDER', VOID: '*** CANCEL ***', MOVE: 'TABLE MOVED', table: 'TABLE', check: 'Check', send: 'Send', guests: 'guests', server: 'Server', reason: 'Reason', by: 'By', ok: 'Approved', items: 'items', sentAt: 'sent', still: 'Now cooking for the new table:', prebill: 'GUEST CHECK', printed: 'print', total: 'TOTAL', notReceipt: 'NOT A RECEIPT', cashier: 'Cashier' },
};

const center = (t: string) => {
  const s = t.slice(0, W);
  const pad = Math.max(0, Math.floor((W - s.length) / 2));
  return ' '.repeat(pad) + s;
};
const rule = () => '-'.repeat(W);
const wrap = (t: string, indent = '') => {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + word).trim().length > W - indent.length) { if (line) out.push(indent + line); line = word; } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(indent + line);
  return out;
};
const twoCol = (left: string, right: string) => {
  const room = W - right.length - 1;
  const l = left.length > room ? left.slice(0, room) : left;
  return l + ' '.repeat(Math.max(1, W - l.length - right.length)) + right;
};

export interface TicketInput {
  kind: 'NEW' | 'VOID' | 'MOVE';
  lang: Lang;
  stationName: string;
  tables: string;
  /** A to-go bill: print its label without "TABLE". */
  takeaway?: boolean;
  checkNumber: number;
  batch?: number | null;
  guests?: number | null;
  server?: string | null;
  at: string;
  lines: { quantity: number; name: string; note?: string | null; options?: string[] | null; sentAt?: string | null }[];
  reason?: string | null;
  by?: string | null;
  approver?: string | null;
  fromTables?: string | null;
}

/** A kitchen / bar ticket: big table name, quantities first, notes indented. */
export function ticketText(t: TicketInput): string {
  const w = L[t.lang];
  const out: string[] = [];
  out.push(center(`${t.stationName.toUpperCase()} · ${w[t.kind]}`));
  if (t.kind === 'MOVE') out.push(center(`${t.fromTables ?? ''} -> ${t.tables}`));
  else out.push(center(t.takeaway ? t.tables.toUpperCase() : `${w.table} ${t.tables}`));
  out.push(`${w.check} #${t.checkNumber}${t.kind === 'NEW' && t.batch ? ` · ${w.send} ${t.batch}` : ''}`);
  const who = [t.guests ? `${t.guests} ${w.guests}` : '', t.server ? `${w.server}: ${t.server}` : ''].filter(Boolean).join(' · ');
  if (who) out.push(who);
  out.push(t.at);
  out.push(rule());
  if (t.kind === 'MOVE') out.push(...wrap(w.still));
  for (const l of t.lines) {
    out.push(...wrap(`${l.quantity} x ${l.name}`));
    for (const o of l.options ?? []) out.push(...wrap(`+ ${o}`, '    '));
    if (l.note) out.push(...wrap(`- ${l.note}`, '    '));
    if (t.kind === 'VOID' && l.sentAt) out.push(`    (${w.sentAt} ${l.sentAt})`);
  }
  out.push(rule());
  if (t.kind === 'VOID') {
    if (t.reason) out.push(...wrap(`${w.reason}: ${t.reason}`));
    const by = [t.by ? `${w.by}: ${t.by}` : '', t.approver ? `${w.ok}: ${t.approver}` : ''].filter(Boolean).join(' · ');
    if (by) out.push(...wrap(by));
  } else {
    out.push(center(`${t.lines.reduce((s, l) => s + l.quantity, 0)} ${w.items}`));
  }
  return out.join('\n') + '\n\n\n';
}

export interface PrebillInput {
  lang: Lang;
  business: string;
  address?: string | null;
  phone?: string | null;
  tables: string;
  takeaway?: boolean;
  checkNumber: number;
  count: number;
  at: string;
  cashier?: string | null;
  lines: { quantity: number; name: string; amountCents: number; options?: string[] | null }[];
  totalCents: number;
  money: (cents: number) => string;
  footer?: string | null;
}

/** The guest check printed before paying (tạm tính). Says plainly it is not the receipt. */
export function prebillText(p: PrebillInput): string {
  const w = L[p.lang];
  const out: string[] = [];
  out.push(center(p.business.toUpperCase()));
  if (p.address) out.push(...wrap(p.address).map(center));
  if (p.phone) out.push(center(p.phone));
  out.push('');
  out.push(center(w.prebill));
  out.push(`${p.takeaway ? p.tables : `${w.table} ${p.tables}`} · ${w.check} #${p.checkNumber} · ${w.printed} ${p.count}`);
  out.push(`${p.at}${p.cashier ? ` · ${w.cashier}: ${p.cashier}` : ''}`);
  out.push(rule());
  for (const l of p.lines) {
    out.push(twoCol(`${l.quantity} ${l.name}`, p.money(l.amountCents)));
    for (const o of l.options ?? []) out.push(...wrap(`+ ${o}`, '  '));
  }
  out.push(rule());
  out.push(twoCol(w.total, p.money(p.totalCents)));
  out.push('');
  if (p.footer) out.push(...wrap(p.footer).map(center));
  out.push(center(w.notReceipt));
  return out.join('\n') + '\n\n\n';
}

/** "415.000 ₫" / "$12.50": the restaurant's own currency, no fractions for the đồng. */
export function moneyText(cents: number, currency: string | null | undefined): string {
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'VND') return `${Math.round(cents).toLocaleString('vi-VN')} đ`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

/** "22/10 19:24" in the restaurant's own time zone. */
export function clockText(d: Date, tz: string | null | undefined, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
      timeZone: tz || 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: lang !== 'vi',
    }).format(d);
  } catch {
    return d.toISOString().slice(5, 16).replace('T', ' ');
  }
}

/** Table names for a bill on one or more tables: "A7 + A8". */
export function tablesLabel(ids: string[], names: Map<string, string>): string {
  return ids.map((id) => names.get(id) ?? '?').join(' + ');
}

// ------------------------------------------------------------ dish options --

export interface OptionChoice { id: string; name: string; priceCents: number }
export interface OptionGroup { id: string; name: string; required: boolean; max: number; choices: OptionChoice[] }
export interface ChosenOption { group: string; name: string; priceCents: number }

const OID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The owner's option groups for a dish ("Cỡ tô: thường / lớn +15k", "Thêm:
 * trứng +10k, quẩy +5k"), made safe: named groups with named choices, no
 * negative prices, at most 8 groups of 20 choices, ids kept or made up.
 */
export function cleanOptionGroups(raw: unknown): OptionGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: OptionGroup[] = [];
  raw.slice(0, 8).forEach((g, gi) => {
    const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return;
    const choices: OptionChoice[] = [];
    (Array.isArray(o.choices) ? o.choices : []).slice(0, 20).forEach((c, ci) => {
      const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const cn = String(x.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!cn) return;
      const price = Math.round(Number(x.priceCents ?? 0));
      const id = OID.test(String(x.id ?? '')) ? String(x.id) : `c${gi}_${ci}`;
      if (choices.some((y) => y.id === id)) return;
      choices.push({ id, name: cn, priceCents: Number.isFinite(price) && price > 0 ? Math.min(price, 100_000_000) : 0 });
    });
    if (!choices.length) return;
    const id = OID.test(String(o.id ?? '')) ? String(o.id) : `g${gi}`;
    if (out.some((y) => y.id === id)) return;
    const max = Math.round(Number(o.max ?? 1));
    out.push({ id, name, required: o.required === true, max: Number.isFinite(max) && max >= 1 ? Math.min(max, choices.length) : 1, choices });
  });
  return out;
}

/**
 * What the server picked, checked against the dish's groups: every required
 * group answered, no group over its maximum, nothing invented. Throws a code
 * the till turns into words.
 */
export function pickOptions(groups: OptionGroup[], picks: unknown): { chosen: ChosenOption[]; extraCents: number } {
  const list = Array.isArray(picks) ? picks : [];
  const byGroup = new Map<string, string[]>();
  for (const p of list) {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const gid = String(o.groupId ?? '');
    const ids = Array.isArray(o.choiceIds) ? o.choiceIds.map((x) => String(x)) : [];
    byGroup.set(gid, [...new Set([...(byGroup.get(gid) ?? []), ...ids])]);
  }
  for (const gid of byGroup.keys()) if (!groups.some((g) => g.id === gid)) throw new Error('OPTION_UNKNOWN');
  const chosen: ChosenOption[] = [];
  for (const g of groups) {
    const ids = byGroup.get(g.id) ?? [];
    if (g.required && ids.length === 0) throw new Error(`OPTION_REQUIRED:${g.name}`);
    if (ids.length > g.max) throw new Error(`OPTION_TOO_MANY:${g.name}`);
    for (const id of ids) {
      const c = g.choices.find((x) => x.id === id);
      if (!c) throw new Error('OPTION_UNKNOWN');
      chosen.push({ group: g.name, name: c.name, priceCents: c.priceCents });
    }
  }
  return { chosen, extraCents: chosen.reduce((s, c) => s + c.priceCents, 0) };
}

/** Chosen options as stored on a line, read back safely. */
export function chosenOf(raw: unknown): ChosenOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
    .filter((x) => typeof x.name === 'string' && x.name)
    .map((x) => ({ group: String(x.group ?? ''), name: String(x.name), priceCents: Math.max(0, Math.round(Number(x.priceCents) || 0)) }));
}

export const optionsKey = (c: ChosenOption[]) => c.map((x) => `${x.group}:${x.name}`).join('|');

// ---------------------------------------------------------------- sold out --

/** YYYY-MM-DD of an instant in the restaurant's own time zone. */
export function dayIn(d: Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Sold out now? With the daily reset a dish marked yesterday is back today. */
export function soldOutNow(soldOutAt: Date | null | undefined, reset: boolean, tz: string | null | undefined, now: Date = new Date()): boolean {
  if (!soldOutAt) return false;
  if (!reset) return true;
  return dayIn(soldOutAt, tz) === dayIn(now, tz);
}

/** What a bill is called on screens and tickets: its tables, or "Mang về #12". */
export function checkLabel(tableIds: string[], names: Map<string, string>, number: number, lang: Lang): string {
  return tableIds.length ? tablesLabel(tableIds, names) : `${lang === 'vi' ? 'Mang về' : 'To go'} #${number}`;
}
