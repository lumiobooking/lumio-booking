/**
 * NO NAME SUGGESTIONS IN TEXT BOXES.
 *
 * The browser remembered every name typed at the desk and offered them back
 * in a dropdown: the receptionist typing "Lin…" got last week's customer, and
 * a tap later the booking carried somebody else's name. Every text box in the
 * app now says autocomplete="off" unless it asked for something on purpose.
 *
 * Left alone on purpose: sign-in and password boxes (username,
 * current-password, new-password, one-time-code) so password managers keep
 * working, and buttons / checkboxes / files that never suggest anything.
 */
const KEEP = new Set(['username', 'current-password', 'new-password', 'one-time-code']);
const SKIP_TYPES = new Set(['password', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color']);

/** Should this element be switched to autocomplete="off"? */
export function wantsOff(el: { tagName: string; getAttribute(n: string): string | null }): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (tag === 'INPUT' && SKIP_TYPES.has(type)) return false;
  const ac = (el.getAttribute('autocomplete') || '').trim().toLowerCase();
  if (ac === 'off') return false;
  if (ac && ac.split(/\s+/).some((t) => KEEP.has(t))) return false;
  return true;
}

/** Switch every text box under `root` (and root itself) to autocomplete="off". */
export function applyNoAutofill(root: ParentNode & { querySelectorAll: Document['querySelectorAll'] } | Element): number {
  let n = 0;
  const one = (el: Element) => { if (wantsOff(el)) { el.setAttribute('autocomplete', 'off'); n++; } };
  if ((root as Element).tagName) one(root as Element);
  root.querySelectorAll('input, textarea').forEach(one);
  return n;
}
