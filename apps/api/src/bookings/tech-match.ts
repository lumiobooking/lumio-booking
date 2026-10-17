/**
 * "WITH SANG" — WHICH TECHNICIAN THE CALLER MEANT. Pure.
 *
 * The phone assistant hears names through speech recognition: "Sang" comes
 * back as "Sung", "Song" or "sang." and staff names are often saved with a
 * trailing space ("Cindy "). The old match was an exact, case-only compare,
 * so a caller asking for her usual technician was told there is nobody by
 * that name — and the booking stalled. This matches the way a receptionist
 * would: accents and case ignored, the full name or the first name, then a
 * name that SOUNDS the same — but only when exactly one person fits; two
 * possible matches still go back to the caller as a question.
 */

export interface TechLike { id: string; firstName: string; lastName?: string | null }

export function foldName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Consonant outline with the first letter kept: sang/sung/song → "sng". */
function skeleton(w: string): string {
  if (!w) return '';
  return w[0] + w.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

export type TechMatch<T extends TechLike> = { tech: T } | { tech: null; candidates: T[] };

export function matchTech<T extends TechLike>(wanted: string, staff: T[]): TechMatch<T> {
  const want = foldName(wanted);
  if (!want) return { tech: null, candidates: [] };
  const first = (t: T) => foldName(t.firstName);
  const full = (t: T) => foldName(`${t.firstName} ${t.lastName ?? ''}`);
  const one = (list: T[]): TechMatch<T> | null => (list.length === 1 ? { tech: list[0] } : null);

  // 1. Exactly the name (first or full).
  const exact = staff.filter((t) => first(t) === want || full(t) === want);
  if (exact.length) return one(exact) ?? { tech: null, candidates: exact };
  // 2. The caller said more or less than the saved name ("Sang Nguyen", "Kim" for "Kimmy").
  const word = want.split(' ')[0];
  const partial = staff.filter((t) => first(t) && (first(t) === word || (word.length >= 3 && (first(t).startsWith(word) || (first(t).length >= 3 && word.startsWith(first(t)))))));
  if (partial.length) return one(partial) ?? { tech: null, candidates: partial };
  // 3. Sounds the same: one letter off, or the same consonants (sang ~ sung ~ song).
  if (word.length >= 3) {
    const alike = staff.filter((t) => {
      const f = first(t).split(' ')[0];
      return f.length >= 3 && (editDistance(f, word) <= 1 || (f[0] === word[0] && skeleton(f) === skeleton(word)));
    });
    if (alike.length) return one(alike) ?? { tech: null, candidates: alike };
  }
  return { tech: null, candidates: [] };
}
