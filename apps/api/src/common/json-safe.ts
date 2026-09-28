/**
 * Text that Postgres will accept inside a JSON column.
 *
 * THE ERROR THIS FIXES
 *
 *   Invalid `prisma.socialInsight.upsert()` invocation:
 *   unexpected end of hex escape at line 1 column 3922
 *
 * A post caption was cut to 120 characters with `.slice()`, which counts
 * UTF-16 units — and an emoji is two of them. Cut between the two halves and
 * the string ends in a lone "high surrogate". JavaScript does not mind;
 * JSON.stringify writes it as `\ud83d`; the database engine's JSON parser
 * then expects the second half to follow and refuses the whole row. One emoji
 * in one caption, and the whole month's Facebook & Instagram sync failed.
 *
 * Two tools: `clip` cuts by characters (never inside an emoji), and
 * `jsonSafe` scrubs anything already broken — lone surrogate halves and the
 * NUL character, which Postgres also refuses — anywhere in a value before it
 * is written.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A string with nothing a JSON column would refuse. */
export function safeText(s: string): string {
  return s.replace(LONE_SURROGATE, '').replace(/\u0000/g, '');
}

/** The first `max` CHARACTERS (code points), never half an emoji. */
export function clip(s: string, max: number): string {
  const chars = Array.from(String(s ?? ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

/** The same value with every string in it made safe, however deep. */
export function jsonSafe<T>(v: T): T {
  if (typeof v === 'string') return safeText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x)) as unknown as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[safeText(k)] = jsonSafe(x);
    return out as T;
  }
  return v;
}
