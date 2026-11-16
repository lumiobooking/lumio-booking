/**
 * "VÌ SAO AI TRẢ LỜI VẬY?" — what one AI reply was built from.
 *
 * An owner who sees a wrong answer in the Inbox could only guess where it came
 * from: an old note, a line in a linked document, an instruction, or nothing
 * at all (the model's own words). They fixed the wrong place, and the wrong
 * answer came back — Lumio Agency had eleven stale notes arguing with its own
 * price list. Every AI turn now carries a small record of its sources:
 *
 *   - rule:  an owner instruction matched to THIS message (exact — the match
 *            is the one the prompt used);
 *   - fact / doc: the saved note or the line of a linked document whose
 *            numbers and words the reply repeats (the closest line is kept so
 *            the owner reads the sentence the AI read);
 *   - tool:  what the AI looked up or did (availability, prices, a booking);
 *   - guard: a draft was stopped and rewritten (a price with no source, an
 *            instruction broken).
 *
 * The fact/doc part is a MATCH, not a confession by the model: the screen
 * says "nguồn khớp với câu trả lời". No match on a factual-looking reply is a
 * signal of its own ("không thấy nguồn") — the answer nobody taught.
 *
 * Stored on the salon's own thread row (tenant-scoped like the turn itself),
 * shown only in the staff Inbox: the public web-chat view (web-chat.ts
 * turnsSince) and the model's prompt read role/content alone.
 *
 * Pure: no database, no clock (reply-trace.spec.ts).
 */

export type TraceKind = 'rule' | 'fact' | 'doc' | 'tool' | 'guard';
export interface TraceRef {
  kind: TraceKind;
  /** The rule's text, the note's label, the document's label, the tool's name, the guard's name. */
  label: string;
  /** The line the reply matches (fact / doc), cut short. */
  snippet?: string;
  /** Instruction id / source id, so the screen can open the thing to fix. */
  id?: string;
}
export interface ReplyTrace { v: 1; refs: TraceRef[] }

export interface TraceCandidate { kind: 'fact' | 'doc'; label: string; id?: string; text: string }

const MAX_REFS = 6;
const SNIPPET = 160;

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Words that carry no fact: both languages, folded. */
const STOP = new Set(('anh chi minh ben nhe duoc khong nhung nhieu cung trong ngoai cua cho voi hoac neu thi nay kia roi them rat cac mot hai '
  + 'dang lam the nao gia bao gom tren duoi khi sau truoc luon chua vang cam on xin chao '
  + 'this that with from your have will would there their about what when which they them then than also just only more very into here please thanks thank hello').split(/\s+/));

/** Numbers that say something: a price, a time, a percentage — digits only, two or more. */
export function numbersOf(text: string): string[] {
  const out = new Set<string>();
  // "990k", "990 nghìn", "1 triệu" first, taken out so the bare 990 is not counted again.
  const rest = fold(text).replace(/(\d+)\s*(k|nghin|ngan|tr|trieu)\b/g, (_m, d: string, u: string) => { out.add(`${d}${u.startsWith('tr') ? 'kk' : 'k'}`); return ' '; });
  for (const m of rest.matchAll(/\d[\d.,]*\d|\d{2,}/g)) {
    // "$45.00" is 45; "1.50" stays 150 (a price nobody rounds).
    const d = m[0].replace(/[.,]00$/, '').replace(/[.,]/g, '');
    if (d.length >= 2) out.add(d.replace(/0{6}$/, 'kk').replace(/0{3}$/, 'k')); // 990.000 and 990k meet
  }
  return [...out];
}

export function wordsOf(text: string): string[] {
  const out = new Set<string>();
  for (const w of fold(text).split(/[^a-z0-9]+/)) if (w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w)) out.add(w);
  return [...out];
}

/** One line against the reply: a shared number counts 3, a shared word 1. */
function lineScore(replyNums: Set<string>, replyWords: Set<string>, line: string): { score: number; nums: number; words: number } {
  let nums = 0; let words = 0;
  for (const n of numbersOf(line)) if (replyNums.has(n)) nums++;
  for (const w of wordsOf(line)) if (replyWords.has(w)) words++;
  return { score: nums * 3 + words, nums, words };
}

const cut = (s: string, n = SNIPPET) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/**
 * Which notes and document lines does this reply repeat? A line qualifies on
 * a shared number together with a shared word, or on three shared words —
 * one common word ("nails") never names a source. Best line per candidate,
 * best candidates first.
 */
export function likelySources(reply: string, candidates: TraceCandidate[], limit = 3): TraceRef[] {
  const rn = new Set(numbersOf(reply)); const rw = new Set(wordsOf(reply));
  if (!rn.size && rw.size < 3) return [];
  const hits: { ref: TraceRef; score: number }[] = [];
  for (const c of candidates) {
    let best: { score: number; line: string } | null = null;
    for (const raw of String(c.text ?? '').split(/\n+/)) {
      const line = raw.trim();
      if (line.length < 6) continue;
      const s = lineScore(rn, rw, line);
      const ok = (s.nums >= 1 && s.words >= 1) || s.words >= 3;
      if (ok && (!best || s.score > best.score)) best = { score: s.score, line };
    }
    if (best) hits.push({ score: best.score, ref: { kind: c.kind, label: cut(c.label, 80), snippet: cut(best.line), ...(c.id ? { id: c.id } : {}) } });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.ref);
}

/** Tools that answer nothing by themselves (they only shape the reply) are not sources. */
const SILENT_TOOLS = new Set(['offer_choices']);

export function buildTrace(o: {
  reply: string;
  rules?: { id: string; text: string }[];
  candidates?: TraceCandidate[];
  tools?: string[];
  guards?: string[];
}): ReplyTrace {
  const refs: TraceRef[] = [];
  const seen = new Set<string>();
  const push = (r: TraceRef) => { const k = `${r.kind}:${r.id ?? r.label}`; if (!seen.has(k) && refs.length < MAX_REFS) { seen.add(k); refs.push(r); } };
  for (const g of o.guards ?? []) push({ kind: 'guard', label: g });
  for (const r of o.rules ?? []) push({ kind: 'rule', label: cut(r.text, SNIPPET), id: r.id });
  for (const t of o.tools ?? []) if (!SILENT_TOOLS.has(t)) push({ kind: 'tool', label: t });
  for (const s of likelySources(o.reply, o.candidates ?? [])) push(s);
  // Kept even when empty: "nothing behind this reply" is what the Inbox must be able to say.
  return { v: 1, refs };
}

/** What is stored is read back defensively: an old row, a hand-edited row. */
export function traceFrom(raw: unknown): ReplyTrace | null {
  const refs = (raw as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(refs)) return null;
  const KINDS: TraceKind[] = ['rule', 'fact', 'doc', 'tool', 'guard'];
  const out: TraceRef[] = [];
  for (const r of refs as Record<string, unknown>[]) {
    if (!r || !KINDS.includes(r.kind as TraceKind) || typeof r.label !== 'string' || !r.label.trim()) continue;
    out.push({ kind: r.kind as TraceKind, label: cut(r.label, SNIPPET), ...(typeof r.snippet === 'string' && r.snippet.trim() ? { snippet: cut(r.snippet) } : {}), ...(typeof r.id === 'string' && r.id ? { id: r.id.slice(0, 80) } : {}) });
    if (out.length >= MAX_REFS) break;
  }
  return { v: 1, refs: out };
}

/**
 * A reply that states something checkable (a number, a price word) with no
 * note, document, rule or lookup behind it: the Inbox marks it so the owner
 * looks at THAT one first.
 */
export function looksUnsourced(reply: string, trace: ReplyTrace | null): boolean {
  if (trace?.refs.some((r) => r.kind !== 'guard')) return false;
  return numbersOf(reply).length > 0;
}
