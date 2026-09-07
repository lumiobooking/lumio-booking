/**
 * The cross-salon inbox, folded to one line per salon.
 *
 * A card per thing sent reads fine with three salons and is a wall with
 * three hundred. What the person at the desk needs is: which salons have
 * something waiting, how much, how fresh — and one tap into the right one.
 * The things themselves are on that salon's own inbox, where they are
 * handled.
 */

export interface InboxItem {
  id: string; tenantId: string; salon: string; slug: string; title: string; note: string | null;
  fromShop: boolean; doneAt: string | null; files: number; clips: number; archived: number;
  working?: boolean; workingByName?: string | null;
}

export interface SalonGroup {
  tenantId: string;
  salon: string;
  slug: string;
  /** Everything waiting on the team at this salon. */
  count: number;
  /** Nobody has picked these up yet. */
  fresh: number;
  /** Someone on the team is on these. */
  working: number;
  /** Who — first names of the people on it, at most two. */
  workingBy: string[];
  files: number;
  clips: number;
  /** The newest thing's time — what the list is sorted by. */
  latest: string | null;
  /** The newest thing's title, for the one line of context. */
  headline: string;
  /** Any of them sent by the shop unasked (as opposed to answering a card). */
  fromShop: boolean;
}

function first(name: string | null | undefined): string {
  const s = String(name ?? '').split('@')[0].trim();
  return s ? s.split(/\s+/)[0] : 'Lumio';
}

export function groupInbox(rows: InboxItem[]): SalonGroup[] {
  const by = new Map<string, SalonGroup>();
  for (const r of rows) {
    const g = by.get(r.tenantId) ?? {
      tenantId: r.tenantId, salon: r.salon, slug: r.slug, count: 0, fresh: 0, working: 0, workingBy: [],
      files: 0, clips: 0, latest: null, headline: '', fromShop: false,
    };
    g.count += 1;
    if (r.working) {
      g.working += 1;
      const who = first(r.workingByName);
      if (!g.workingBy.includes(who) && g.workingBy.length < 2) g.workingBy.push(who);
    } else g.fresh += 1;
    g.files += r.files;
    g.clips += r.clips;
    g.fromShop = g.fromShop || r.fromShop;
    const t = r.doneAt ? Date.parse(r.doneAt) : NaN;
    const cur = g.latest ? Date.parse(g.latest) : NaN;
    if (!Number.isNaN(t) && (Number.isNaN(cur) || t > cur)) { g.latest = r.doneAt; g.headline = r.title; }
    else if (!g.headline) g.headline = r.title;
    by.set(r.tenantId, g);
  }
  return [...by.values()].sort((a, b) => {
    // Untouched first, then newest.
    if ((a.fresh > 0) !== (b.fresh > 0)) return a.fresh > 0 ? -1 : 1;
    return (b.latest ? Date.parse(b.latest) : 0) - (a.latest ? Date.parse(a.latest) : 0);
  });
}

/** "2 mới · 1 đang làm · 3 clip" — the numbers a row shows, only the ones that are not zero. */
export function groupSummary(g: SalonGroup): string {
  const parts: string[] = [];
  if (g.fresh) parts.push(`${g.fresh} mới`);
  if (g.working) parts.push(`${g.working} đang làm${g.workingBy.length ? ` (${g.workingBy.join(', ')})` : ''}`);
  if (g.clips) parts.push(`${g.clips} clip`);
  const photos = g.files - g.clips;
  if (photos > 0) parts.push(`${photos} ảnh`);
  return parts.join(' · ');
}
