/**
 * TEXT THAT THE DATABASE WILL ACCEPT.
 *
 * Cutting a message with .slice(0, 300) can split an emoji (two UTF-16 code
 * units) and leave half of it behind. Prisma's engine then refuses the whole
 * write ("unexpected end of hex escape") — a new chat was not created, or a
 * thread's history silently stopped updating (Render log, 16/11/2026). These
 * keep every string whole.
 */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const HAS_LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The same text with any half emoji removed. */
export function wellFormed(s: unknown): string {
  return String(s ?? '').replace(LONE, '');
}

/** At most n code units, never ending inside an emoji. */
export function cutText(s: unknown, n: number): string {
  let t = String(s ?? '').slice(0, Math.max(0, n));
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return wellFormed(t);
}

/** Every turn's text made whole before it is written. */
export function cleanTurns<T extends { content?: unknown }>(turns: T[]): T[] {
  return turns.map((t) => (t && typeof t.content === 'string' && HAS_LONE.test(t.content) ? { ...t, content: wellFormed(t.content) } : t));
}
