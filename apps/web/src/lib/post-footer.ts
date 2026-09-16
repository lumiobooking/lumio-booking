/**
 * Swapping the footer under a caption — without leaving the old one there.
 *
 * The composer opens every post with the shop's footer already typed at the
 * bottom. When the person edits that footer and saves it as the template,
 * the post they are looking at still carries the OLD footer; if the new one
 * were simply appended, the post would go out with two addresses. So the
 * old footer is found and replaced in place, the caption above it untouched.
 *
 * Pure, so it is testable: the composer state is one string.
 */

const norm = (s: string) => s.replace(/\r/g, '').trim();

/**
 * `message` with `oldFooter` (or, failing that, `oldBlock` — the contact
 * lines alone) replaced by `next`. When neither is present the footer is
 * appended under a blank line. `next` empty means "remove the footer".
 */
export function swapFooter(message: string, oldFooter: string, oldBlock: string, next: string): string {
  const body = message.replace(/\r/g, '');
  const candidates = [norm(oldFooter), norm(oldBlock)].filter(Boolean);
  const replacement = norm(next);
  for (const old of candidates) {
    const at = body.indexOf(old);
    if (at < 0) continue;
    const before = body.slice(0, at).replace(/\s+$/, '');
    const after = body.slice(at + old.length).replace(/^\s+/, '');
    const parts = [before, replacement, after].filter(Boolean);
    return parts.join('\n\n');
  }
  if (!replacement) return body.trimEnd();
  return body.trimEnd() ? `${body.trimEnd()}\n\n${replacement}` : replacement;
}

/** True when the caption already carries this footer (so "insert" is not offered). */
export function hasFooter(message: string, footer: string): boolean {
  const f = norm(footer);
  return Boolean(f) && message.replace(/\r/g, '').includes(f);
}
