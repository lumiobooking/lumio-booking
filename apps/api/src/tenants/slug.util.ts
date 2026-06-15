/**
 * Converts a salon name into a URL-safe slug.
 * "Anna's Nail Spa!" -> "annas-nail-spa"
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (combining marks)
    .toLowerCase()
    .trim()
    .replace(/['’`]/g, '') // drop apostrophes so "Anna's" -> "annas"
    .replace(/[^a-z0-9]+/g, '-') // other non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse repeats
}

/**
 * Given a base slug and the set of slugs already taken, returns a unique slug
 * by appending -2, -3, ... when needed.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = slugify(base) || 'salon';
  if (!taken.has(root)) {
    return root;
  }
  let n = 2;
  while (taken.has(`${root}-${n}`)) {
    n += 1;
  }
  return `${root}-${n}`;
}
