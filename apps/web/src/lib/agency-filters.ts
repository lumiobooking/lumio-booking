import type { RenewState, TermState } from './agency-term';

/**
 * The agency list's filters, as one small model.
 *
 * Inside a group the options are OR ("Hết hạn" or "Sắp hết hạn"); across
 * groups they are AND (… and Team 1). Each option's count is worked out
 * against the OTHER groups only, so the number beside an option is exactly
 * how many salons ticking it would leave — and an option that would leave
 * none can be shown dimmed instead of being a trap.
 */

export type GroupKey = 'term' | 'team' | 'renew' | 'pkg' | 'stage' | 'market' | 'growth' | 'ads' | 'flag';
export const GROUPS: GroupKey[] = ['term', 'team', 'renew', 'pkg', 'stage', 'market', 'growth', 'ads', 'flag'];
export type AgencyFilters = Record<GroupKey, string[]>;

export const NO_FILTERS: AgencyFilters = { term: [], team: [], renew: [], pkg: [], stage: [], market: [], growth: [], ads: [], flag: [] };

/** The facts about one salon that the filters read. */
export interface FilterFacts {
  id: string;
  term: TermState;
  /** null = not in the renewal view at all (term fine, or renewed in an earlier month). */
  renew: RenewState | null;
  /** '' = on no team. */
  team: string;
  /** '' = no package recorded → option 'none'. */
  pkg: string;
  stage: string;
  market: string;
  /** up | flat | down | thin — this month's bookings against the same span of last month. */
  growth: string;
  /** on | warn | off | none — paid ad spend this month, and whether anything came of it. */
  ads: string;
  /** waiting | new | locked */
  flags: string[];
}

function valuesOf(row: FilterFacts, g: GroupKey): string[] {
  switch (g) {
    case 'term': return [row.term];
    case 'team': return [row.team || 'none'];
    case 'renew': return row.renew ? [row.renew] : [];
    case 'pkg': return [row.pkg || 'none'];
    case 'stage': return [row.stage];
    case 'market': return [row.market];
    case 'growth': return [row.growth];
    case 'ads': return [row.ads];
    case 'flag': return row.flags;
  }
}

export function matches(row: FilterFacts, f: AgencyFilters, skip?: GroupKey): boolean {
  for (const g of GROUPS) {
    if (g === skip || !f[g].length) continue;
    const have = valuesOf(row, g);
    if (!f[g].some((v) => have.includes(v))) return false;
  }
  return true;
}

export function applyFilters<T extends FilterFacts>(rows: T[], f: AgencyFilters): T[] {
  return activeGroups(f).length ? rows.filter((r) => matches(r, f)) : rows;
}

export type FacetCounts = Record<GroupKey, Record<string, number>>;

export function facetCounts(rows: FilterFacts[], f: AgencyFilters): FacetCounts {
  const out = Object.fromEntries(GROUPS.map((g) => [g, {} as Record<string, number>])) as FacetCounts;
  for (const g of GROUPS) {
    for (const r of rows) {
      if (!matches(r, f, g)) continue;
      for (const v of valuesOf(r, g)) out[g][v] = (out[g][v] ?? 0) + 1;
    }
  }
  return out;
}

export function activeGroups(f: AgencyFilters): GroupKey[] {
  return GROUPS.filter((g) => f[g].length > 0);
}

export function toggleValue(f: AgencyFilters, g: GroupKey, v: string): AgencyFilters {
  const has = f[g].includes(v);
  return { ...f, [g]: has ? f[g].filter((x) => x !== v) : [...f[g], v] };
}

export function clearGroup(f: AgencyFilters, g: GroupKey): AgencyFilters {
  return { ...f, [g]: [] };
}

/**
 * What a group's button says: its first chosen label, "+N" for the rest.
 * Long lists are where buttons break, so past two the rest fold into a count.
 */
export function groupSummary(values: string[], labelOf: (v: string) => string, max = 2): string {
  if (!values.length) return '';
  if (values.length <= max) return values.map(labelOf).join(', ');
  return `${labelOf(values[0])} +${values.length - 1}`;
}

/** Only the groups that are worth remembering between visits, read safely. */
export const REMEMBERED: GroupKey[] = ['market', 'pkg'];
export function rememberedFilters(raw: unknown): AgencyFilters {
  const out: AgencyFilters = { ...NO_FILTERS };
  if (!raw || typeof raw !== 'object') return out;
  for (const g of REMEMBERED) {
    const v = (raw as Record<string, unknown>)[g];
    if (Array.isArray(v)) out[g] = v.filter((x): x is string => typeof x === 'string').slice(0, 20);
  }
  return out;
}
