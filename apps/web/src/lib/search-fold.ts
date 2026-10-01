/**
 * Text search for the list screens, kept pure so a test can pin it.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  return fold(haystack).includes(q);
}

/**
 * Lower-case, accents stripped, đ → d: "Tiệm Nail Đẹp" is found by "tiem nail dep"
 * and by "Tiệm" alike. A receptionist typing on an English keyboard would
 * otherwise never find a Vietnamese customer by name.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}
