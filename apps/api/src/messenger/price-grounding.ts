/**
 * THE PRICE CHECK — every amount of money in a reply must come from something
 * the AI was actually given: the business's documents, its notes, its menu, a
 * tool's answer this turn, or the customer's own words. A figure from nowhere
 * ("Boost $199", a made-up discount) is the most expensive kind of wrong a
 * sales chat can be, so the reply goes back once to be rewritten from the
 * sources (the big support AIs do the same: validate the answer against the
 * retrieved sources before it is sent).
 *
 * Arithmetic the AI may legitimately do is allowed: a sum of two known
 * figures (package + combo), a known figure × 2..12 months, and the 5% / 10%
 * term discounts.
 */

const MONEY = [
  // $179, US$1,200, A$ 99.50, $1.2k
  /(?:US|AU|A|C|CA|NZ|S|HK)?\$\s?(\d[\d.,]*)\s?(k|K)?/g,
  // 179 USD
  /(\d[\d.,]*)\s?(?:USD|AUD|CAD|NZD|SGD|EUR|GBP)\b/g,
  // 2.500.000đ, 500k đ
  /(\d[\d.,]*)\s?(k|K|tr|triệu|nghìn|ngàn)?\s?(?:đ|₫|vnd|vnđ)(?![\p{L}\d])/giu,
  // 500k/tháng, 3 triệu
  /(\d[\d.,]*)\s?(k|tr|triệu)(?![\p{L}\d])/giu,
];

function toNumber(raw: string, unit?: string): number | null {
  let s = raw.replace(/[.,]$/, '');
  // "1,200.50" / "1.200.000" / "99.50"
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'k' || u === 'nghìn' || u === 'ngàn') return n * 1000;
  if (u === 'tr' || u === 'triệu') return n * 1_000_000;
  return n;
}

/** Every amount of money written in a reply. */
export function moneyIn(text: string): number[] {
  const out: number[] = [];
  const t = String(text || '');
  for (const re of MONEY) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const n = toNumber(m[1], m[2]);
      if (n !== null && n > 0) out.push(n);
    }
  }
  return [...new Set(out)];
}

/** Every number in the material the AI was given (prices are written many ways; be generous here). */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  const t = String(text || '');
  const re = /(\d[\d.,]*)\s?(k|K|tr|triệu)?(?![\p{L}\d])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const plain = toNumber(m[1]);
    if (plain !== null) out.add(plain);
    const withUnit = toNumber(m[1], m[2]);
    if (withUnit !== null) out.add(withUnit);
  }
  return out;
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, b * 0.002);

/** True when an amount can be explained from the known figures. */
export function explained(amount: number, known: Set<number>, percents: number[] = []): boolean {
  const list = [...known].filter((n) => n > 0 && n < 1e10);
  for (const k of list) {
    if (near(amount, k)) return true;
    for (let m = 2; m <= 12; m++) if (near(amount, k * m)) return true;
    for (const f of [0.95, 0.9]) {
      if (near(amount, Math.round(k * f)) || near(amount, k * f)) return true;
      for (let m = 2; m <= 12; m++) if (near(amount, Math.round(k * f * m)) || near(amount, k * f * m)) return true;
    }
  }
  // A percentage the business itself states ("giảm 20% tháng này", "deposit 30%"): the price after it, and the part itself.
  // Only numbers the sources write WITH a % sign — a $35 price is not "35%".
  if (percents.length) {
    const prices = list.filter((n) => n >= 1).slice(0, 600);
    for (const p of percents) for (const k of prices) {
      const off = k * (1 - p / 100); const part = k * (p / 100);
      if (near(amount, off) || near(amount, Math.round(off)) || near(amount, part) || near(amount, Math.round(part))) return true;
    }
  }
  // package + add-on, setup + first month
  const small = list.filter((n) => n < 1e7).slice(0, 400);
  for (let i = 0; i < small.length; i++) for (let j = i; j < small.length; j++) if (near(amount, small[i] + small[j])) return true;
  return false;
}

/** The percentages the material states ("20%", "giảm 15 %"), 1–90. */
export function percentsIn(sources: string[]): number[] {
  const out = new Set<number>();
  for (const s of sources) for (const m of String(s || '').matchAll(/(\d{1,2})\s?%/g)) { const n = Number(m[1]); if (n >= 1 && n <= 90) out.add(n); }
  return [...out].slice(0, 40);
}

/** The amounts in a reply that nothing the AI was given can explain. */
export function ungroundedMoney(reply: string, sources: string[]): number[] {
  const found = moneyIn(reply);
  if (!found.length) return [];
  const known = new Set<number>();
  for (const s of sources) for (const n of numbersIn(s)) known.add(n);
  const percents = percentsIn(sources);
  return found.filter((n) => !explained(n, known, percents));
}

export function priceCorrection(bad: number[]): string {
  return 'SYSTEM CORRECTION — that reply was blocked before it was sent, because it states '
    + bad.map((n) => `${n}`).join(', ')
    + ' as a price, and that figure is not in the business\'s documents, notes or tool results.\n'
    + 'Rewrite the reply using ONLY the exact figures written in THE BUSINESS\'S OWN DOCUMENTS (or the notes / tool results). Name the exact package. '
    + 'If the figure they asked for is not written anywhere, do not estimate: say the team will confirm the exact price and offer to take their contact. Same language as the conversation. Send only the new reply.';
}

/** What goes out if the rewrite still invents a figure: no number, an honest promise. */
export function priceHoldLine(lang: string | null | undefined): string {
  return lang === 'vi'
    ? 'Dạ để em kiểm tra lại con số chính xác rồi báo anh/chị ngay ạ. Anh/chị cho em xin số điện thoại để team gửi báo giá chi tiết nhé?'
    : "Let me double-check the exact figure so I give you the right number. Could I take your phone number so the team can send you the detailed quote?";
}
