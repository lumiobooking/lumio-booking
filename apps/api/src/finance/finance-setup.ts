import { DEFAULT_CATEGORIES, type CatGroup, type Direction, type FundKind } from './finance-calc';

/**
 * A salon's books, made the first time anyone opens them (or the drawer asks
 * for its categories): one cash fund, one default bank fund, the standard
 * income and expense categories in the salon's language. Idempotent — a
 * category is keyed by its systemKey, a fund by its kind — so two first
 * visits at once cannot leave two cash drawers behind (the oldest wins).
 *
 * Only the caller's tenant is ever read or written.
 */

export interface FundDb { id: string; tenantId: string; kind: FundKind; name: string; last4: string | null; openingCents: number; openingDate: string; isDefault: boolean; archivedAt: Date | null; createdAt: Date }
export interface CategoryDb { id: string; tenantId: string; direction: Direction; group: CatGroup; name: string; countsInPl: boolean; systemKey: string | null; budgetCents: number | null; hidden: boolean; sort: number }

export interface SetupDelegate<T> {
  findMany(args: unknown): Promise<T[]>;
  create(args: unknown): Promise<T>;
  update(args: unknown): Promise<T>;
}
export interface SetupDb {
  cashFund: SetupDelegate<FundDb>;
  cashCategory: SetupDelegate<CategoryDb>;
}

const done = new Set<string>();
const running = new Map<string, Promise<void>>();

/** Forget that a salon is set up (tests). */
export function resetSetupCache(): void { done.clear(); running.clear(); }

export async function ensureFinanceSetup(db: SetupDb, tenantId: string, vi: boolean, today: string): Promise<void> {
  if (done.has(tenantId)) return;
  const inflight = running.get(tenantId);
  if (inflight) return inflight;
  const job = (async () => {
    const funds = await db.cashFund.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    if (!funds.some((f) => f.kind === 'CASH')) {
      await db.cashFund.create({ data: { tenantId, kind: 'CASH', name: vi ? 'Tiền mặt (két)' : 'Cash drawer', openingCents: 0, openingDate: today, isDefault: false } });
    }
    const banks = funds.filter((f) => f.kind === 'BANK' && !f.archivedAt);
    if (!banks.length) {
      await db.cashFund.create({ data: { tenantId, kind: 'BANK', name: vi ? 'Ngân hàng' : 'Bank account', openingCents: 0, openingDate: today, isDefault: true } });
    } else if (!banks.some((b) => b.isDefault)) {
      await db.cashFund.update({ where: { id: banks[0].id }, data: { isDefault: true } });
    }
    const have = new Set((await db.cashCategory.findMany({ where: { tenantId }, select: { systemKey: true } }))
      .map((c) => c.systemKey).filter(Boolean) as string[]);
    let sort = 0;
    for (const c of DEFAULT_CATEGORIES) {
      sort += 10;
      if (have.has(c.key)) continue;
      try {
        await db.cashCategory.create({
          data: { tenantId, direction: c.direction, group: c.group, name: vi ? c.vi : c.en, countsInPl: c.countsInPl, systemKey: c.key, sort },
        });
      } catch { /* another request made it first (unique tenantId + systemKey) */ }
    }
    done.add(tenantId);
  })().finally(() => running.delete(tenantId));
  running.set(tenantId, job);
  return job;
}

/** Of several cash funds (a race long ago), the oldest is THE drawer. */
export function cashFundOf(funds: FundDb[]): FundDb | null {
  return [...funds].filter((f) => f.kind === 'CASH').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

/** The bank fund card / transfer / online sales land in. */
export function defaultBankOf(funds: FundDb[]): FundDb | null {
  const banks = funds.filter((f) => f.kind === 'BANK');
  return banks.find((f) => f.isDefault && !f.archivedAt) ?? banks.find((f) => !f.archivedAt) ?? banks[0] ?? null;
}
