/**
 * Which pair of people looks after which salons.
 *
 * WHY A NAME AND NOT A TABLE
 *
 * A team here is a plain string carried by a person and by a salon. No
 * membership rows, no roles, no join. The moment a team becomes a permission,
 * covering for a colleague who is off needs an administrator — and covering
 * for each other is the entire reason the teams exist. So this organises the
 * screen and answers "whose salon is this", and it changes nothing about what
 * anybody may open.
 *
 * WHY THE LIST IS SHORTENED THIS WAY
 *
 * Thirty salons in one flat list is thirty rows to read before finding the
 * one you want, whoever you are. Grouping alone does not fix that — thirty
 * rows in five groups is still thirty rows. What fixes it is a default: your
 * own team open, everybody else's folded to one line each.
 *
 * UNASSIGNED SALONS ARE NOT FILED LAST
 *
 * They sit second, open, under their own heading. A salon nobody owns is the
 * one that goes a fortnight without a post, and burying it under the teams
 * that DO have owners is how it stays that way. On the first day every salon
 * is in that group, which is correct: the list is a to-do.
 */

export const UNASSIGNED = '';

/**
 * How long a salon stays at the top of its group.
 *
 * A week is about one setup cycle: long enough that a salon created on Friday
 * is still on top when someone gets to it on Monday, short enough that the
 * top of the list does not slowly become a list of its own.
 */
export const NEW_SALON_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

/** Was this salon created inside the window? Anything unparseable is not new. */
export function isNewSalon(createdAt: unknown, now: number = Date.now()): boolean {
  const at = createdAt instanceof Date ? createdAt.getTime()
    : typeof createdAt === 'number' ? createdAt
      : typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(at)) return false;
  return now - at < NEW_SALON_DAYS * DAY && at <= now + DAY;
}

/** Newest arrivals first, then the alphabet. Used inside every group. */
export function sortSalons<T extends TeamRow>(list: T[]): T[] {
  const at = (r: TeamRow) => {
    const v = r.createdAt instanceof Date ? r.createdAt.getTime()
      : typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  return [...list].sort((a, b) => {
    const an = a.isNew ? 1 : 0;
    const bn = b.isNew ? 1 : 0;
    if (an !== bn) return bn - an;
    if (an && bn) return at(b) - at(a);
    return a.name.localeCompare(b.name);
  });
}

export interface TeamRow {
  /** The salon's own fields, whatever the caller selected. */
  id: string;
  name: string;
  supportTeam?: string | null;
  createdAt?: Date | string | null;
  /** Set by the caller from isNewSalon, so the window is decided in one place. */
  isNew?: boolean;
}

export interface TeamGroup<T extends TeamRow> {
  /** '' for the salons nobody has claimed. */
  team: string;
  /** The heading, already decided — the screen never invents a label. */
  label: string;
  salons: T[];
  /** How many of them arrived this week — the number the heading shows. */
  newCount: number;
  /** Is this the viewer's own team? */
  mine: boolean;
  /** Open on arrival, or folded to one line. */
  open: boolean;
}

/** Trim, collapse spaces, cap. Empty means unassigned, and stays empty. */
export function cleanTeam(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * The salon list, grouped and ordered for one particular viewer.
 *
 *   1. my team, open
 *   2. salons with no team, open
 *   3. everyone else's, folded, alphabetical
 *
 * Inside every group, this week's arrivals first (newest at the very top),
 * then the alphabet. Mark them with isNewSalon before calling.
 *
 * A viewer with no team of their own gets the unassigned group first and
 * every team folded — which is the right screen for the owner, who is looking
 * across all of them rather than working one.
 */
export function groupSalons<T extends TeamRow>(
  salons: T[],
  myTeam: string | null | undefined,
  labels: { unassigned: string } = { unassigned: 'Chưa phân nhóm' },
): TeamGroup<T>[] {
  const mine = cleanTeam(myTeam);
  const by = new Map<string, T[]>();
  for (const s of salons ?? []) {
    const t = cleanTeam(s.supportTeam);
    by.set(t, [...(by.get(t) ?? []), s]);
  }
  // A viewer's own team is a heading even when it currently holds nothing —
  // an empty "Nhóm 1" says the salons moved, where a missing one says nothing.
  if (mine && !by.has(mine)) by.set(mine, []);

  const groups: TeamGroup<T>[] = [...by.entries()].map(([team, list]) => ({
    team,
    label: team || labels.unassigned,
    salons: sortSalons(list),
    newCount: list.filter((s) => s.isNew).length,
    mine: Boolean(mine) && team === mine,
    open: (Boolean(mine) && team === mine) || team === UNASSIGNED,
  }));

  return groups.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    if ((a.team === UNASSIGNED) !== (b.team === UNASSIGNED)) return a.team === UNASSIGNED ? -1 : 1;
    return a.team.localeCompare(b.team);
  });
}

export interface TeamSummary {
  team: string;
  label: string;
  salons: number;
  /** Who is on it, by first name — enough to know who to ask. */
  members: string[];
}

/** Every team that exists, from either side: a team with people but no salons still counts. */
export function teamSummaries(
  salons: { supportTeam?: string | null }[],
  staff: { email?: string | null; firstName?: string | null; supportTeam?: string | null }[],
  labels: { unassigned: string } = { unassigned: 'Chưa phân nhóm' },
): TeamSummary[] {
  const counts = new Map<string, number>();
  for (const s of salons ?? []) {
    const t = cleanTeam(s.supportTeam);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const members = new Map<string, string[]>();
  for (const p of staff ?? []) {
    const t = cleanTeam(p.supportTeam);
    if (!t) continue;
    const who = (p.firstName || String(p.email ?? '').split('@')[0] || '').trim();
    if (who) members.set(t, [...(members.get(t) ?? []), who]);
  }
  const names = new Set<string>([...counts.keys(), ...members.keys()]);
  return [...names].map((team) => ({
    team,
    label: team || labels.unassigned,
    salons: counts.get(team) ?? 0,
    members: members.get(team) ?? [],
  })).sort((a, b) => {
    if ((a.team === UNASSIGNED) !== (b.team === UNASSIGNED)) return a.team === UNASSIGNED ? 1 : -1;
    return a.team.localeCompare(b.team);
  });
}
