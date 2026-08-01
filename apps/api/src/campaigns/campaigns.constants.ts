// Automated marketing campaigns (win-back, reactivation, birthday). Stored as
// JSON in the `settings` table — no schema migration needed. OFF by default so a
// salon must opt in before any marketing message is sent. SMS only ever goes to
// customers who gave explicit consent (smsConsent); email goes to customers who
// have an email on file. Messages support %placeholders%:
//   %customer_name% %salon_name% %salon_contact% %booking_link%
export const CAMPAIGN_SETTINGS_KEY = 'campaign_settings';

/**
 * The incentive attached to a campaign. Without one, a win-back message is just
 * a reminder — and "enjoy a little something on us" with nothing behind it is
 * worse than silence, because the customer arrives expecting a gift the front
 * desk has never heard of. One shared code per campaign: the salon reads it off
 * the ticket and the till applies it.
 */
export interface CampaignOffer {
  enabled: boolean;
  kind: 'percent' | 'amount' | 'gift'; // % off · fixed $ off · a free extra
  value: number; // percent (1–90) or cents (for 'amount'); ignored for 'gift'
  gift: string; // what the customer gets when kind = 'gift'
  code: string; // shared code shown in the message and typed at the till
  expiryDays: number; // how long the message says the offer lasts (0 = no expiry line)
}

export const DEFAULT_OFFER: CampaignOffer = { enabled: false, kind: 'percent', value: 15, gift: '', code: '', expiryDays: 21 };

/** Short teaser for the subject line — what makes someone open the email at all. */
export function offerTeaser(o?: CampaignOffer | null): string {
  if (!o?.enabled) return '';
  if (o.kind === 'gift') return 'a gift inside';
  if (o.kind === 'amount') return `$${(Math.max(0, o.value) / 100).toFixed(0)} off inside`;
  return `${Math.max(0, Math.min(90, o.value))}% off inside`;
}

/** Human wording for the offer, used for the %offer% placeholder. */
export function offerLabel(o?: CampaignOffer | null): string {
  if (!o?.enabled) return '';
  if (o.kind === 'gift') return (o.gift || '').trim();
  if (o.kind === 'amount') return `$${(Math.max(0, o.value) / 100).toFixed(2)} off your next visit`;
  return `${Math.max(0, Math.min(90, o.value))}% off your next visit`;
}

export interface CampaignMessage {
  enabled: boolean;
  email: boolean;
  sms: boolean;
  subject: string; // email subject
  body: string; // email body (plain text / light HTML)
  smsBody: string; // SMS text (keep short; STOP wording auto-respected)
  offer?: CampaignOffer;
}

export interface LapsedCampaign extends CampaignMessage {
  daysSince: number; // fire when the last completed visit was exactly this many days ago
}

export interface CampaignSettings {
  sendHour: number; // tenant-local hour (0–23) to dispatch (best-effort)
  winBack: LapsedCampaign;
  reactivation: LapsedCampaign;
  birthday: CampaignMessage;
}

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  sendHour: 10,
  winBack: {
    enabled: false,
    email: true,
    sms: false,
    daysSince: 45,
    subject: 'Your nails are due, %customer_name%%offer_subject%',
    body:
      'Hi %customer_name%,\n\nIt has been about six weeks since your last visit to %salon_name% — right about when most sets are ready for a refresh. Here is something to make the next one nicer:\n\n%offer_block%Mornings midweek are our quietest if you prefer a calm room. Your chair is waiting whenever you are.\n\nSee you soon,\n%salon_name% · %salon_contact%',
    smsBody:
      '%salon_name%: Hi %customer_name%, your set is about due for a refresh. %offer_sms%Book: %booking_link% Reply STOP to opt out.',
    offer: { enabled: false, kind: 'gift', value: 0, gift: 'a free nail-art accent on us', code: '', expiryDays: 21 },
  },
  reactivation: {
    enabled: false,
    email: true,
    sms: false,
    daysSince: 120,
    subject: '%customer_name%, come back to %salon_name%%offer_subject%',
    body:
      'Hi %customer_name%,\n\nIt has been a few months since we last looked after you at %salon_name%. We would love to have you back — and we saved something for you:\n\n%offer_block%Nothing has changed about the part you liked: same technicians, same care, same clean room. Pick any time that suits you and we take it from there.\n\nWarmly,\n%salon_name% · %salon_contact%',
    smsBody:
      '%salon_name%: %customer_name%, we would love to have you back. %offer_sms%Book: %booking_link% Reply STOP to opt out.',
    offer: { enabled: false, kind: 'percent', value: 20, gift: '', code: '', expiryDays: 21 },
  },
  birthday: {
    enabled: false,
    email: true,
    sms: false,
    subject: 'Happy birthday, %customer_name% 🎉%offer_subject%',
    body:
      'Happy birthday, %customer_name%!\n\nEveryone at %salon_name% hopes today is a good one — and that someone else is doing the cooking. We have a little something for you:\n\n%offer_block%Come in whenever suits you this month and let us spoil you a little.\n\nWith love,\nThe team at %salon_name% · %salon_contact%',
    smsBody:
      'Happy birthday from %salon_name%, %customer_name%! 🎉 %offer_sms%Book: %booking_link% Reply STOP to opt out.',
    offer: { enabled: false, kind: 'gift', value: 0, gift: 'a free birthday add-on — nail art or a 10-minute hand massage', code: '', expiryDays: 30 },
  },
};

export type CampaignKey = 'winBack' | 'reactivation' | 'birthday';

/** relatedType stored on the notification log, used for dedup + stats. */
export const campaignRelatedType = (key: CampaignKey) => `campaign:${key}`;
