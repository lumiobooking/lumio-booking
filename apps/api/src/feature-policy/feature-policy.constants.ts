export type PolicyMode = 'salon' | 'platform';

export interface FeatureDef {
  key: string;
  label: string;
  hrefs: string[]; // salon nav routes hidden when platform-managed
  default: PolicyMode;
  /**
   * Where this key's value comes from when nobody has set it explicitly.
   *
   * Splitting one switch into two is otherwise a silent downgrade: a salon that
   * was sold "Marketing" and had the monthly report with it would lose the
   * report the moment the report got a switch of its own, because the new key
   * has no stored value and would fall back to its own default. Inheriting from
   * the key it was split out of means the split changes NOTHING for anyone
   * already running — which is the only acceptable way to ship it.
   */
  fallbackKey?: string;
}

/**
 * Curated list of salon-facing features whose access can be centrally governed.
 * 'platform' = hidden from the salon UI and write-blocked at the API (protects
 * Lumio's internal process). Keep this list small and intentional — do NOT add a
 * flag for every setting.
 */
/**
 * Since 08/2026 the deep/AI screens default to 'platform': a salon account sees
 * and configures only the basics (company, hours, services, staff, daily ops).
 * Lumio staff set the rest up through SUPPORT sessions; Super Admin can still
 * hand any single feature back to a salon that pays for the add-on.
 *
 * Hiding a CONFIG screen never stops the FEATURE: the Messenger webhook, the
 * public review page, campaign links and existing API keys all keep running.
 */
export const FEATURE_DEFS: FeatureDef[] = [
  // ---- the "Marketing & AI" menu, one switch per line the salon sees --------
  // Nine entries for nine menu items, so a salon can be sold the marketing plan
  // without being handed the phone bot. All default to 'platform': turning a
  // switch ON is a decision someone makes per salon, never a side effect of a
  // deploy.
  { key: 'contentPlan', label: 'Marketing plan & posts', hrefs: ['/salon/content'], default: 'platform' },
  { key: 'marketing', label: 'Marketing & campaigns', hrefs: ['/salon/marketing'], default: 'platform' },
  // Split out of 'marketing' — inherits it until someone sets it on its own.
  { key: 'marketingReport', label: 'Marketing report (monthly)', hrefs: ['/salon/marketing/monthly'], default: 'platform', fallbackKey: 'marketing' },
  { key: 'emailMarketing', label: 'Email marketing (bulk campaigns)', hrefs: ['/salon/email'], default: 'platform' },
  { key: 'reviews', label: 'Reviews & rewards (anti-fraud)', hrefs: ['/salon/reviews'], default: 'platform' },
  // Also split out of 'reviews'. Replying to your own customers is the salon's
  // own voice, so this is the one most likely to be handed over on its own.
  { key: 'googleReviews', label: 'Google reviews (reply to customers)', hrefs: ['/salon/reviews-replies'], default: 'platform', fallbackKey: 'reviews' },
  { key: 'inbox', label: 'Inbox (customer messages)', hrefs: ['/salon/inbox'], default: 'platform' },
  { key: 'messengerAi', label: 'Messenger bot', hrefs: ['/salon/messenger'], default: 'platform' },
  { key: 'voiceAi', label: 'AI Hotline (phone bot)', hrefs: ['/salon/voice'], default: 'platform' },

  // ---- everything else -----------------------------------------------------
  // Nav-hide only (no API block): the basic Connections page shares this API
  // to issue the WordPress license key.
  { key: 'integrations', label: 'Integrations & API keys', hrefs: ['/salon/integrations'], default: 'platform' },
  // Plan add-ons: hidden from the menu until sold. APIs stay open (their data
  // is the salon's own — this tier is packaging, not secrecy).
  { key: 'payroll', label: 'Payroll & commissions', hrefs: ['/salon/payroll'], default: 'platform' },
  { key: 'chain', label: 'Multi-location (chain)', hrefs: ['/salon/chain'], default: 'platform' },
  { key: 'terminals', label: 'Payment terminals', hrefs: ['/salon/payment-terminals'], default: 'platform' },
];

/**
 * One tenant's stored overrides + the built-in defaults, resolved.
 *
 * Pure on purpose: the interesting rules (an unset key inheriting from the key
 * it was split out of, and the market veto that cannot be outvoted) are worth
 * testing without a database in the room.
 */
export function resolvePolicy(
  stored: Record<string, unknown> | null | undefined,
  isAvailable: (key: string) => boolean = () => true,
): Record<string, PolicyMode> {
  const raw = stored ?? {};
  const read = (k: string): PolicyMode | null => {
    const v = raw[k];
    return v === 'platform' || v === 'salon' ? v : null;
  };
  const out: Record<string, PolicyMode> = {};
  for (const f of FEATURE_DEFS) {
    const resolved = read(f.key) ?? (f.fallbackKey ? read(f.fallbackKey) : null) ?? f.default;
    out[f.key] = isAvailable(f.key) ? resolved : 'platform';
  }
  return out;
}

/** Every salon nav route that has a switch, whatever that switch currently says. */
export const GOVERNED_HREFS: string[] = FEATURE_DEFS.flatMap((f) => f.hrefs);

export const FEATURE_KEYS = FEATURE_DEFS.map((f) => f.key);
