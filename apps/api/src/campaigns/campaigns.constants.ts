// Automated marketing campaigns (win-back, reactivation, birthday). Stored as
// JSON in the `settings` table — no schema migration needed. OFF by default so a
// salon must opt in before any marketing message is sent. SMS only ever goes to
// customers who gave explicit consent (smsConsent); email goes to customers who
// have an email on file. Messages support %placeholders%:
//   %customer_name% %salon_name% %salon_contact% %booking_link%
export const CAMPAIGN_SETTINGS_KEY = 'campaign_settings';

export interface CampaignMessage {
  enabled: boolean;
  email: boolean;
  sms: boolean;
  subject: string; // email subject
  body: string; // email body (plain text / light HTML)
  smsBody: string; // SMS text (keep short; STOP wording auto-respected)
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
    subject: 'We miss you at %salon_name%!',
    body:
      'Hi %customer_name%,\n\nIt has been a little while since your last visit to %salon_name% — we would love to see you again! Treat yourself to some self-care.\n\nBook anytime: %booking_link%\n\nSee you soon! 💅\n%salon_name% · %salon_contact%',
    smsBody:
      '%salon_name%: We miss you, %customer_name%! Book your next visit: %booking_link% Reply STOP to opt out.',
  },
  reactivation: {
    enabled: false,
    email: true,
    sms: false,
    daysSince: 120,
    subject: 'A little treat to welcome you back to %salon_name%',
    body:
      'Hi %customer_name%,\n\nWe have not seen you in a while and we would love to welcome you back to %salon_name%. Come in for your next appointment and enjoy a little something on us.\n\nBook now: %booking_link%\n\nHope to see you soon!\n%salon_name% · %salon_contact%',
    smsBody:
      '%salon_name%: We would love to welcome you back, %customer_name%! Book here: %booking_link% Reply STOP to opt out.',
  },
  birthday: {
    enabled: false,
    email: true,
    sms: false,
    subject: 'Happy birthday from %salon_name%! 🎉',
    body:
      'Happy birthday, %customer_name%! 🎉\n\nEveryone at %salon_name% wishes you a wonderful day. Come celebrate with a little pampering — book your birthday treat anytime.\n\nBook now: %booking_link%\n\nWith love,\n%salon_name% · %salon_contact%',
    smsBody:
      'Happy birthday from %salon_name%, %customer_name%! 🎉 Treat yourself — book here: %booking_link% Reply STOP to opt out.',
  },
};

export type CampaignKey = 'winBack' | 'reactivation' | 'birthday';

/** relatedType stored on the notification log, used for dedup + stats. */
export const campaignRelatedType = (key: CampaignKey) => `campaign:${key}`;
