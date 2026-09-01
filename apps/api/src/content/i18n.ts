/**
 * Two languages for one screen.
 *
 * THE MISTAKE THIS FIXES
 *
 * The salon dashboard has an EN/VI switch, and the switch worked — for every
 * word the FRONTEND owns. Everything the backend produced (where the profile
 * came from, the aim of the week, the name of the holiday two weeks out) was
 * written as a Vietnamese string literal in a service file, so an owner who
 * pressed EN got an English frame around Vietnamese content and no way to tell
 * whether the switch was broken or the plan was.
 *
 * WHY BOTH LANGUAGES TRAVEL TOGETHER
 *
 * The alternative was to send the UI language up with the request and have the
 * server pick. That works until something else reads the same plan — the
 * nightly drafter, an email, the AI prompt — at which point the language of a
 * stored plan depends on who happened to open a screen last. So the server
 * keeps every phrase in BOTH languages and renders the payload twice; the
 * screen picks, nothing upstream has to know a UI exists, and the Vietnamese
 * text stays available for the prompts, which are written in Vietnamese.
 *
 * HOW IT IS USED
 *
 *   title: bi('Nền móng', 'Foundation')
 *
 * and the type of that field becomes `Txt` — which is `string | Bi`. The union
 * is deliberate: a plain string is still a legal value, so a file that has not
 * been converted yet keeps compiling and keeps working (it simply reads the
 * same in both languages). Conversion can therefore happen file by file
 * instead of in one unreviewable commit.
 *
 * Anything that feeds a MODEL, not a screen, unwraps with `viOf()`: the prompt
 * library is Vietnamese and must stay one language regardless of who is
 * looking.
 */

/** A phrase the product says, in the two languages the product speaks. */
export interface Bi {
  vi: string;
  en: string;
}

/** A field that may hold either a bilingual phrase or a plain (untranslated) string. */
export type Txt = string | Bi;

export type Lang = 'vi' | 'en';

/** Build a bilingual phrase. */
export const bi = (vi: string, en: string): Bi => ({ vi, en });

export function isBi(v: unknown): v is Bi {
  return typeof v === 'object' && v !== null
    && typeof (v as Bi).vi === 'string' && typeof (v as Bi).en === 'string'
    && Object.keys(v as object).length === 2;
}

/** The Vietnamese side. What every prompt and every log line uses. */
export const viOf = (t: Txt | null | undefined): string =>
  t == null ? '' : typeof t === 'string' ? t : t.vi;

/** The English side, falling back to Vietnamese so a half-translated phrase still reads. */
export const enOf = (t: Txt | null | undefined): string =>
  t == null ? '' : typeof t === 'string' ? t : (t.en || t.vi);

export const pick = (t: Txt | null | undefined, lang: Lang): string =>
  lang === 'en' ? enOf(t) : viOf(t);

/**
 * Join bilingual parts into one bilingual phrase.
 *
 *   join(['Còn thiếu ', n, ' đánh giá'], ...) is the wrong shape for two
 *   languages, because word order is not the same in both. So a sentence with a
 *   number in it is written twice, whole:
 *
 *     bi(`Xin đánh giá Google — còn thiếu ${n} cái`, `Ask for ${n} more Google reviews`)
 *
 * `join` exists for the other case: a list of already-bilingual fragments.
 */
export const join = (parts: (Txt | null | undefined)[], sep = ' · '): Bi => ({
  vi: parts.filter(Boolean).map(viOf).join(sep),
  en: parts.filter(Boolean).map(enOf).join(sep),
});

/**
 * Render a whole payload in one language.
 *
 * Walks the structure and replaces every `{vi, en}` pair with the string for
 * `lang`. Everything else — numbers, booleans, dates, ids, URLs — is copied
 * through untouched, so this is safe to run over an entire plan.
 *
 * Cycles are not expected in a JSON payload and are not handled; this runs on
 * objects that are about to be serialised anyway.
 */
export function localizeDeep<T>(value: T, lang: Lang): T {
  return walk(value, lang) as T;
}

function walk(v: unknown, lang: Lang): unknown {
  if (v === null || v === undefined) return v;
  if (isBi(v)) return pick(v, lang);
  if (Array.isArray(v)) return v.map((x) => walk(x, lang));
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    // Class instances (Prisma Decimal, etc.) are left alone: rebuilding one as a
    // plain object is how a money value turns into `{}` on its way to a screen.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, lang);
    return out;
  }
  return v;
}
