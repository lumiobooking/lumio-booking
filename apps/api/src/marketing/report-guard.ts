/**
 * NARRATIVE GUARD — every figure in the AI's text must exist in the data it
 * was given. The report's numbers are rendered by the app from the data; the
 * AI only writes the words around them. When it writes a figure anyway, that
 * figure is checked here against the set of numbers in the data payload
 * (with the usual spellings: 1,234 · 1.234 · 1 234 · 12% · $450 · 450.000đ ·
 * cents ÷ 100 · rounded percents). A figure that is not in the data is a
 * "stray": the caller regenerates once with a correction, and whatever still
 * strays is marked so the editor can see it. Pure.
 *
 * Alarm words are a second gate: "cần hành động ngay" / "fell sharply" on a
 * month that is still running (compared through day N) is the sentence that
 * made a client panic over eight days of data. While the month runs, the
 * headline and summary may not sound an alarm.
 */

export interface GuardReport {
  /** Figures found in the text that are not in the data. */
  stray: Array<{ path: string; figure: string }>;
  /** Alarm language on a running month. */
  alarms: string[];
  ok: boolean;
}

const ALARM_RE = /\b(ngay lập tức|hành động ngay|khẩn cấp|báo động|sụt giảm mạnh|giảm mạnh|lao dốc|immediate(ly)? action|urgent|alarming|fell sharply|dropped sharply|plummet(ed|ing)?|collapse[sd]?)\b/i;

/** Every number in a data payload, plus the spellings a writer might use. */
export function numbersIn(data: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    const abs = Math.abs(n);
    const forms = new Set<string>();
    forms.add(String(abs));
    forms.add(String(Math.round(abs)));
    forms.add(abs.toFixed(1));
    forms.add(abs.toFixed(2));
    forms.add(String(Math.round(abs / 100)));          // cents → whole units
    forms.add((abs / 100).toFixed(2));
    forms.add((abs / 100).toFixed(1));
    forms.add(String(Math.round(abs / 1000)));         // "12k"
    forms.add(String(Math.round(abs / 1_000_000)));    // "2 triệu"
    forms.add((abs / 1000).toFixed(1));
    forms.add((abs / 1_000_000).toFixed(1));
    for (const f of forms) out.add(f.replace(/\.0+$/, ''));
  };
  const walk = (v: unknown): void => {
    if (typeof v === 'number') add(v);
    else if (typeof v === 'string') { const n = Number(v.replace(/[,\s]/g, '')); if (v.trim() && Number.isFinite(n)) add(n); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(data);
  return out;
}

/** Numeric figures written in a sentence, normalised: "1,234" → "1234", "12%" → "12", "450.000đ" → "450000". */
export function figuresIn(text: string): string[] {
  const out: string[] = [];
  // Years, times and ordinals are not figures: 2026, 10:30, "tháng 10", "ngày 8", "T10", "Q3".
  const cleaned = text
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b(tháng|ngày|day|month|week|tuần|quý|q|t)\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ');
  const re = /(?<![\w.])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(%|k|K|tr|triệu|đ|₫|\$|usd|vnd)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    let raw = m[1];
    // 1,234 / 1.234 / 1.234.567 → thousands; 12.5 / 12,5 → decimal
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');
    else raw = raw.replace(',', '.');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // Small counts in a sentence ("2 bài", "3 kênh", "1 tuần") are prose, not data claims.
    if (n <= 3 && !m[2]) continue;
    out.push(String(n).replace(/\.0+$/, ''));
  }
  return out;
}

type Bi = { vi?: string; en?: string } | null | undefined;

/** Walk the bilingual report content; yield (path, text). */
function* texts(content: Record<string, unknown>, prefix = ''): Generator<[string, string]> {
  for (const [k, v] of Object.entries(content ?? {})) {
    if (k.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const bi = v as Bi & Record<string, unknown>;
      if (typeof bi?.vi === 'string' || typeof bi?.en === 'string') {
        if (typeof bi.vi === 'string') yield [`${path}.vi`, bi.vi];
        if (typeof bi.en === 'string') yield [`${path}.en`, bi.en];
      } else yield* texts(v as Record<string, unknown>, path);
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const it = v[i];
        if (it && typeof it === 'object') yield* texts({ [i]: it } as Record<string, unknown>, path);
      }
    }
  }
}

/**
 * @param content  the AI's bilingual JSON
 * @param data     what the AI was given (numbers are extracted from it)
 * @param running  the month is still in progress (alarm gate)
 */
export function guardNarrative(content: Record<string, unknown>, data: unknown, running: boolean): GuardReport {
  const allowed = numbersIn(data);
  const stray: GuardReport['stray'] = [];
  const alarms: string[] = [];
  for (const [path, text] of texts(content)) {
    // Next month's plan and KPI targets are proposals ("Reach ≥ 14,000"),
    // not claims about this month: new figures are what they are for.
    const proposal = /^(nextMonth|plan)\./.test(path);
    if (!proposal) for (const f of figuresIn(text)) if (!allowed.has(f)) stray.push({ path, figure: f });
    if (running && /^(headline|tldr|summary)\./.test(path) && ALARM_RE.test(text)) alarms.push(path);
  }
  return { stray, alarms, ok: stray.length === 0 && alarms.length === 0 };
}

/** One correction line for the retry, naming what went wrong. */
export function correctionFor(g: GuardReport): string {
  const parts: string[] = [];
  if (g.stray.length) parts.push(`These figures are NOT in the data and must be removed or replaced by qualitative wording: ${[...new Set(g.stray.map((s) => s.figure))].slice(0, 12).join(', ')}.`);
  if (g.alarms.length) parts.push('The month is still in progress (compared only through the same day of last month): no alarm language ("immediate action", "fell sharply", "cần hành động ngay") in headline/tldr/summary — describe the to-date trend calmly.');
  return `SYSTEM CORRECTION: ${parts.join(' ')} Output the full JSON again.`;
}
