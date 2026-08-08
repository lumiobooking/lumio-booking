export type PolicyMode = 'salon' | 'platform';

export interface FeatureDef {
  key: string;
  label: string;
  hrefs: string[]; // salon nav routes hidden when platform-managed
  default: PolicyMode;
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
  { key: 'voiceAi', label: 'AI Hotline (phone bot)', hrefs: ['/salon/voice'], default: 'platform' },
  { key: 'messengerAi', label: 'Messenger bot', hrefs: ['/salon/messenger'], default: 'platform' },
  { key: 'reviews', label: 'Reviews & rewards (anti-fraud)', hrefs: ['/salon/reviews', '/salon/reviews-replies'], default: 'platform' },
  { key: 'marketing', label: 'Marketing & campaigns', hrefs: ['/salon/marketing', '/salon/marketing/monthly'], default: 'platform' },
  // Nav-hide only (no API block): the basic Connections page shares this API
  // to issue the WordPress license key.
  { key: 'integrations', label: 'Integrations & API keys', hrefs: ['/salon/integrations'], default: 'platform' },
  { key: 'emailMarketing', label: 'Email marketing (bulk campaigns)', hrefs: ['/salon/email'], default: 'platform' },
  // Plan add-ons: hidden from the menu until sold. APIs stay open (their data
  // is the salon's own — this tier is packaging, not secrecy).
  { key: 'payroll', label: 'Payroll & commissions', hrefs: ['/salon/payroll'], default: 'platform' },
  { key: 'chain', label: 'Multi-location (chain)', hrefs: ['/salon/chain'], default: 'platform' },
  { key: 'terminals', label: 'Payment terminals', hrefs: ['/salon/payment-terminals'], default: 'platform' },
];

export const FEATURE_KEYS = FEATURE_DEFS.map((f) => f.key);
