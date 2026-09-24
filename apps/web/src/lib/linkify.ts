/**
 * Links in a note become links.
 *
 * A shop owner pastes a Drive link under a post — "use this photo instead" —
 * and it arrived as plain text: three lines of URL nobody could click, and
 * because Facebook wrapped it (l.facebook.com/l.php?u=…) nobody could even
 * read which file it was. So: every http(s) URL becomes an anchor that opens
 * in a new tab, Facebook's redirect wrapper is unwrapped to the real address,
 * and the visible text is shortened to the host and the start of the path so
 * a long link is one readable line, not a wall.
 */

const URL_RE = /https?:\/\/[^\s<>"'）)\]]+/g;

/** l.facebook.com / lm.facebook.com wrap outbound links; return the inner one. */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url);
    if (/^(l|lm|l\.messenger)\.facebook\.com$/.test(u.hostname) && u.pathname === '/l.php') {
      const inner = u.searchParams.get('u');
      if (inner && /^https?:\/\//.test(inner)) return inner;
    }
  } catch { /* not a URL after all */ }
  return url;
}

/** Trailing punctuation belongs to the sentence, not the link. */
export function trimTail(raw: string): { url: string; tail: string } {
  const m = raw.match(/[.,;:!?…]+$/);
  if (!m) return { url: raw, tail: '' };
  return { url: raw.slice(0, raw.length - m[0].length), tail: m[0] };
}

/** "drive.google.com/file/d/1DblyX…" — enough to know what it is. */
export function shortLabel(url: string, max = 48): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const s = u.hostname.replace(/^www\./, '') + path;
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  } catch {
    return url.length > max ? url.slice(0, max - 1) + '…' : url;
  }
}

/** Text split into plain runs and links, for a renderer to draw. */
export type LinkRun = { kind: 'text'; text: string } | { kind: 'link'; url: string; label: string };

export function splitLinks(text: string): LinkRun[] {
  const out: LinkRun[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'text') prev.text += t;
    else out.push({ kind: 'text', text: t });
  };
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    pushText(text.slice(last, start));
    const { url: rawUrl, tail } = trimTail(m[0]);
    const url = unwrapRedirect(rawUrl);
    out.push({ kind: 'link', url, label: shortLabel(url) });
    pushText(tail);
    last = start + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}
