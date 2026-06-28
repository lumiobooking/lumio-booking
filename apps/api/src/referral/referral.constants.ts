// Customer referral program. Stored as JSON in the `settings` table. OFF by
// default. A customer shares their personal link (/book/:slug?ref=CODE); when a
// NEW customer books through it and completes their first visit, the referrer
// earns points and the new customer gets a welcome bonus.
export const REFERRAL_SETTINGS_KEY = 'referral_settings';

export interface ReferralSettings {
  enabled: boolean;
  referrerPoints: number; // bonus points to the referrer when the referee completes their first visit
  refereePoints: number; // welcome bonus points to the new (referred) customer
  message: string; // optional share copy shown to the salon/customer
}

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: false,
  referrerPoints: 100,
  refereePoints: 50,
  message: 'Refer a friend — you both get rewarded!',
};

/** Build a short, human-ish referral code from a name + random suffix. */
export function buildReferralCode(firstName: string | null | undefined): string {
  const base = (firstName ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'REF';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${rand}`;
}
