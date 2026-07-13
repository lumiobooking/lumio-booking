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
export const FEATURE_DEFS: FeatureDef[] = [
  { key: 'voiceAi', label: 'AI Hotline (phone bot)', hrefs: ['/salon/voice'], default: 'salon' },
  { key: 'messengerAi', label: 'Messenger bot', hrefs: ['/salon/messenger'], default: 'salon' },
  { key: 'reviews', label: 'Reviews & rewards (anti-fraud)', hrefs: ['/salon/reviews', '/salon/reviews-replies'], default: 'salon' },
  { key: 'marketing', label: 'Marketing & campaigns', hrefs: ['/salon/marketing'], default: 'salon' },
  { key: 'integrations', label: 'Integrations & API keys', hrefs: ['/salon/integrations'], default: 'salon' },
  // Off unless Lumio switches it on for a salon (sold as an add-on): bulk email
  // marketing is easy to abuse and puts our sending reputation on the line.
  { key: 'emailMarketing', label: 'Email marketing (bulk campaigns)', hrefs: ['/salon/email'], default: 'platform' },
];

export const FEATURE_KEYS = FEATURE_DEFS.map((f) => f.key);
