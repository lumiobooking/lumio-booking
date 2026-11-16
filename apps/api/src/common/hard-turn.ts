/**
 * BỘ NÃO 2 TẦNG — the everyday model for everyday messages, a stronger one
 * for the few that deserve it.
 *
 * Haiku answers "mai mấy giờ mở cửa" as well as any model and three times
 * faster. It is the complaint, the party of five, the long message with four
 * questions in it, the customer comparing two packages — and the reply a
 * guard already had to send back — where a stronger model earns its price:
 * those are the conversations an owner later screenshots.
 *
 * OFF until the platform turns it on: with ANTHROPIC_HARD_MODEL unset every
 * turn runs on the everyday model exactly as before. Set it (for example
 * claude-sonnet-5-5) and only the turns named below use it, at most
 * ANTHROPIC_HARD_DAILY times per salon per day (default 40) — so one salon's
 * busy day cannot spend another salon's share, and the bill has a ceiling.
 *
 * Pure except for the day counter, which lives in this process (a restart or
 * a second instance loosens the cap a little; it never tightens it wrongly).
 */

export type HardReason = 'complaint' | 'group' | 'long' | 'compare' | 'corrected';

export function hardModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.ANTHROPIC_HARD_MODEL ?? '').trim();
}

export function hardDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ANTHROPIC_HARD_DAILY);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
}

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

const COMPLAINT = /\b(buc|buc minh|that vong|te qua|qua te|khieu nai|phan nan|hoan tien|tra lai tien|den bu|lua dao|lam hong|bi hong|bi bong|bi troc|bi dau|bi di ung|nhiem trung|khong hai long|chan qua|thai do|upset|angry|furious|terrible|awful|horrible|worst|disappointed|disappointing|complain|complaint|refund|money back|ruined|unacceptable|rip ?off|scam|infection|infected|allergic reaction|never coming back|bad review|report you)\b/;
const GROUP_DIGIT = /\b([3-9]|1\d)\s*(nguoi|ng|ban|khach|chi em|people|persons|ladies|girls|guys|of us|adults|kids)\b/;
const GROUP_WORD = /\b(ba|bon|tu|nam|sau|bay|tam|chin|muoi)\s+(nguoi|ban|chi em)\b|\b(three|four|five|six|seven|eight|nine|ten)\s+(of us|people|persons|ladies|girls|guys)\b|\b(party|group) of (three|four|five|six|seven|eight|nine|ten|[3-9]|1\d)\b|\bnhom\s+([3-9]|1\d)\b/;
const COMPARE = /\b(so sanh|khac nhau|khac gi|khac biet|nen chon|goi nao|loai nao tot hon|compare|comparison|difference between|which (one|plan|package) (is|should)|versus|vs)\b/;

/** Why this message deserves the stronger model — or null for the everyday one. */
export function hardTurnReason(text: string): HardReason | null {
  const raw = String(text ?? '');
  const t = fold(raw);
  if (!t.trim()) return null;
  if (COMPLAINT.test(t)) return 'complaint';
  if (GROUP_DIGIT.test(t) || GROUP_WORD.test(t)) return 'group';
  if (COMPARE.test(t)) return 'compare';
  if (raw.length > 400 || (raw.match(/\?/g) ?? []).length >= 3) return 'long';
  return null;
}

/** Per salon, per UTC day. Injected in tests. */
export class HardBudget {
  private day = '';
  private used = new Map<string, number>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  /** Take one use for this salon if there is one left today. */
  take(tenantId: string, cap: number): boolean {
    const d = this.now().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.used.clear(); }
    const n = this.used.get(tenantId) ?? 0;
    if (n >= cap) return false;
    this.used.set(tenantId, n + 1);
    return true;
  }
  usedToday(tenantId: string): number { return this.used.get(tenantId) ?? 0; }
}

/**
 * The model for one turn. `undefined` = the everyday model (the caller's
 * default) — which is always the answer while the hard model is not set.
 */
export function modelForTurn(o: { tenantId: string; reason: HardReason | null; budget: HardBudget; env?: Record<string, string | undefined> }): string | undefined {
  const hard = hardModel(o.env);
  if (!hard || !o.reason) return undefined;
  return o.budget.take(o.tenantId, hardDailyCap(o.env)) ? hard : undefined;
}
