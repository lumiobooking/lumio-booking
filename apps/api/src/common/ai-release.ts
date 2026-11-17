/**
 * THE RELEASE CHANNEL — a new AI behaviour reaches the test accounts first.
 *
 * Until 16/11/2026 every change went straight to every salon's customers the
 * moment it was deployed, several times a day, and three of that day's fixes
 * broke something a customer saw. There is one production server and no
 * staging copy of Messenger, so "test it first" cannot mean another machine.
 *
 * It means this: a new behaviour ships SWITCHED TO "canary" — live only on
 * the platform's own test accounts (the demo salon and the company's own
 * page). It is watched there on real channels, and only then promoted to
 * "on" for every salon — a switch, not a deploy. "off" takes it away again
 * just as fast.
 *
 * Pure rules here; the stored state and the cache are in ai-release.service.
 */

export type ReleaseStage = 'off' | 'canary' | 'on';

/** Every behaviour that is released in stages, with the stage it SHIPS in. */
export const RELEASE_FEATURES = {
  /** The typing dots on Messenger and Instagram while the AI writes. */
  typing: { ships: 'canary', vi: 'Ba dấu chấm "đang soạn tin" khi AI trả lời', en: 'Typing indicator while the AI writes' },
  /**
   * The "Seen" receipt the moment a customer writes. Its own switch since
   * 17/11/2026: with both sent, a customer saw "Seen" and never the dots, and
   * the one may be taken away without a deploy to see whether it hides the other.
   */
  seen: { ships: 'canary', vi: 'Dấu "đã xem" ngay khi khách nhắn', en: 'Seen receipt when a customer writes' },
  /** A short, adaptive pause before answering instead of a fixed six seconds. */
  smartWait: { ships: 'canary', vi: 'Chờ thông minh thay cho chờ cố định 6 giây', en: 'Adaptive wait instead of a fixed six seconds' },
} as const satisfies Record<string, { ships: ReleaseStage; vi: string; en: string }>;

export type ReleaseFeature = keyof typeof RELEASE_FEATURES;
export const RELEASE_KEY = 'ai_release';

export interface ReleaseState {
  /** Only the features somebody moved; the rest are at the stage they ship in. */
  stages: Partial<Record<ReleaseFeature, ReleaseStage>>;
  /** Extra test accounts (tenant ids), beside the platform's own. */
  canary: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_RELEASE: ReleaseState = { stages: {}, canary: [], updatedAt: null, updatedBy: null };

const STAGES: ReleaseStage[] = ['off', 'canary', 'on'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The platform's own test accounts, by slug. Overridable; empty = none. */
export function canarySlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.AI_RELEASE_CANARY_SLUGS;
  const list = (raw === undefined ? 'lumio-salon,lumio-agency' : raw).split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9-]{2,80}$/.test(s));
  return [...new Set(list)].slice(0, 10);
}

/** Whatever was stored or posted, made safe: unknown features and stages are dropped. */
export function cleanRelease(raw: unknown): ReleaseState {
  let o: unknown = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  if (!o || typeof o !== 'object') return { ...EMPTY_RELEASE, stages: {}, canary: [] };
  const r = o as Record<string, unknown>;
  const stages: Partial<Record<ReleaseFeature, ReleaseStage>> = {};
  const s = (r.stages && typeof r.stages === 'object' ? r.stages : {}) as Record<string, unknown>;
  for (const f of Object.keys(RELEASE_FEATURES) as ReleaseFeature[]) {
    const v = s[f];
    if (typeof v === 'string' && STAGES.includes(v as ReleaseStage)) stages[f] = v as ReleaseStage;
  }
  const canary = Array.isArray(r.canary) ? [...new Set(r.canary.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, 20) : [];
  return {
    stages, canary,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 40) : null,
    updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy.slice(0, 80) : null,
  };
}

export function stageOf(state: ReleaseState, feature: ReleaseFeature): ReleaseStage {
  return state.stages[feature] ?? RELEASE_FEATURES[feature].ships;
}

/**
 * Is this behaviour live for this salon? "canary" = only the test accounts.
 * No tenant (a platform job) is never a test account.
 */
export function featureOn(state: ReleaseState, feature: ReleaseFeature, tenantId: string | null | undefined, testAccounts: ReadonlySet<string>): boolean {
  const stage = stageOf(state, feature);
  if (stage === 'on') return true;
  if (stage === 'off' || !tenantId) return false;
  const id = tenantId.toLowerCase();
  return testAccounts.has(id) || state.canary.includes(id);
}

/** What support sees: each feature, where it is, and who it reaches. */
export function releaseView(state: ReleaseState) {
  return (Object.keys(RELEASE_FEATURES) as ReleaseFeature[]).map((f) => ({
    feature: f, stage: stageOf(state, f), ships: RELEASE_FEATURES[f].ships, vi: RELEASE_FEATURES[f].vi, en: RELEASE_FEATURES[f].en,
  }));
}
