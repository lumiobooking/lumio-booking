// Streamlined booking settings. All stored as JSON in the `settings` table
// (no schema migration needed). Times are minutes from midnight, salon-local.
export const BOOKING_RULES_KEY = 'booking_rules';
export const COMPANY_EXTRA_KEY = 'company_extra';
export const PAYMENT_GATEWAYS_KEY = 'payment_gateways';
export const NOTIFICATION_SETTINGS_KEY = 'notifications';
export const POS_SETTINGS_KEY = 'pos_settings';

// POS (counter checkout) settings. Tax applies to retail products only
// (nail services are tax-exempt in many US states); receiptFooter prints at the
// bottom of every receipt.
export interface PosSettings {
  taxRatePercent: number; // e.g. 8.25 for 8.25% sales tax on retail
  receiptFooter: string;
  primaryCardGateway: string; // which enabled gateway the POS "Card" button uses ('' = none)
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  taxRatePercent: 0,
  receiptFooter: '',
  primaryCardGateway: '',
};

/** When/where booking notifications go, plus the SMS (Twilio) connection. */
export interface NotificationSettings {
  // Which delivery method this salon uses for emails (Amelia-style explicit choice).
  //  'off'  = don't send real emails (logged only)
  //  'smtp' = the salon's own SMTP server
  //  'brevo'= the salon's Brevo HTTPS API
  mailService: 'off' | 'smtp' | 'brevo';
  senderName: string; // "From" name on emails
  senderEmail: string; // shared "From" address (used by every provider)
  replyTo: string; // optional Reply-To address
  adminEmail: string; // where the salon receives booking alerts
  adminPhone: string; // where the salon receives booking SMS
  emailCustomerOnBooking: boolean;
  emailAdminOnBooking: boolean;
  smsCustomerOnBooking: boolean;
  smsAdminOnBooking: boolean;
  // Message templates (support placeholders like {salon} {customer} {service}
  // {date} {time} {technician} {total} {duration} {addons}).
  emailSubjectCustomer: string;
  emailIntroCustomer: string;
  emailSubjectAdmin: string;
  emailIntroAdmin: string;
  emailFooter: string;
  smsCustomer: string;
  smsAdmin: string;
  // Email gateway (SMTP, e.g. Gmail). pass is private and never returned to UI.
  // `secure` mirrors Amelia: ssl (465), tls/STARTTLS (587), or none (25).
  smtp: { host: string; port: number; user: string; pass: string; fromEmail: string; secure: 'ssl' | 'tls' | 'none' };
  // Email via Brevo HTTPS API (recommended: reliable from the cloud, free tier).
  // apiKey is private and never returned to the UI.
  brevo: { apiKey: string; senderEmail: string; senderName: string };
  // SMS gateway (Twilio). authToken is private and never returned to the UI.
  twilio: { accountSid: string; authToken: string; fromNumber: string };
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  mailService: 'off',
  senderName: '',
  senderEmail: '',
  replyTo: '',
  adminEmail: '',
  adminPhone: '',
  emailCustomerOnBooking: true,
  emailAdminOnBooking: true,
  smsCustomerOnBooking: false,
  smsAdminOnBooking: false,
  emailSubjectCustomer: 'Your booking is confirmed — {salon}',
  emailIntroCustomer: 'Hi {customer}, thank you for booking with {salon}! Here are your appointment details:',
  emailSubjectAdmin: 'New booking — {service} for {customer}',
  emailIntroAdmin: 'A new booking has just come in. Details below:',
  emailFooter: 'We look forward to seeing you. If you need to make changes, just reply to this email.',
  smsCustomer: '{salon}: your {service} on {date} at {time} is booked. See you soon!',
  smsAdmin: 'New booking: {service} for {customer} on {date} at {time}.',
  smtp: { host: 'smtp.gmail.com', port: 465, user: '', pass: '', fromEmail: '', secure: 'ssl' },
  brevo: { apiKey: '', senderEmail: '', senderName: '' },
  twilio: { accountSid: '', authToken: '', fromNumber: '' },
};

/** Supported card/online gateways (most popular for US/Canada salons). */
export const GATEWAY_IDS = ['stripe', 'square', 'clover', 'authorizenet', 'paypal', 'sumup'] as const;
export type GatewayId = (typeof GATEWAY_IDS)[number];

/** Stored per gateway. apiKey is the public/identifier value; secret is private. */
export interface GatewayConfig {
  enabled: boolean;
  apiKey: string; // public/identifier value (publishable key / location id / client id…)
  secret: string; // private value (secret key / access token…)
}
export type PaymentGateways = Record<GatewayId, GatewayConfig>;

export const DEFAULT_GATEWAY: GatewayConfig = { enabled: false, apiKey: '', secret: '' };
export const DEFAULT_PAYMENT_GATEWAYS: PaymentGateways = {
  stripe: { ...DEFAULT_GATEWAY },
  square: { ...DEFAULT_GATEWAY },
  clover: { ...DEFAULT_GATEWAY },
  authorizenet: { ...DEFAULT_GATEWAY },
  paypal: { ...DEFAULT_GATEWAY },
  sumup: { ...DEFAULT_GATEWAY },
};

/** Open/close for one weekday (index 0 = Sunday … 6 = Saturday). */
export interface DayHours {
  closed: boolean;
  openMinutes: number;
  closeMinutes: number;
}

export interface BookingRules {
  slotStepMinutes: number; // gap between offered start times
  minLeadHours: number; // earliest a customer can book from now
  maxAdvanceDays: number; // how far ahead bookings are allowed
  allowCustomerChooseStaff: boolean; // customer may pick a preferred technician
  // What happens when a customer booking has no technician chosen:
  //  'none' = leave unassigned for the salon to handle manually
  //  'auto' = auto-assign via the engine (fair round-robin + history rules)
  assignmentMode: 'none' | 'auto';
  currency: string; // ISO 4217 code, e.g. USD / EUR / VND
  currencySymbol: string; // optional custom symbol; '' = derive from currency
  symbolPosition: 'before' | 'after'; // $10 vs 10$
  priceDecimals: number; // decimal places shown
  defaultPaymentMethod: 'online' | 'onsite'; // pre-selected at checkout
  onlinePaymentEnabled: boolean;
  payLaterEnabled: boolean;
  businessHours: DayHours[]; // length 7, indexed by JS getDay()
  daysOff: string[]; // ISO dates "YYYY-MM-DD" the salon is closed
}

const open9to6: DayHours = { closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60 };

export const DEFAULT_BOOKING_RULES: BookingRules = {
  slotStepMinutes: 30,
  minLeadHours: 1,
  maxAdvanceDays: 60,
  allowCustomerChooseStaff: true,
  assignmentMode: 'auto',
  currency: 'USD',
  currencySymbol: '',
  symbolPosition: 'before',
  priceDecimals: 2,
  defaultPaymentMethod: 'onsite',
  onlinePaymentEnabled: true,
  payLaterEnabled: true,
  // Sun closed by default, Mon–Sat open 09:00–18:00.
  businessHours: [
    { closed: true, openMinutes: 9 * 60, closeMinutes: 18 * 60 },
    open9to6, open9to6, open9to6, open9to6, open9to6, open9to6,
  ],
  daysOff: [],
};

export interface CompanyExtra {
  address: string;
  website: string;
}

export const DEFAULT_COMPANY_EXTRA: CompanyExtra = { address: '', website: '' };

export interface Branding {
  accentColor: string;
  logoUrl: string;
}

export const DEFAULT_BRANDING: Branding = {
  accentColor: '#6366f1',
  logoUrl: '',
};

// ===========================================================================
// Notification template catalog (Amelia-style). Each tenant gets a map of
// per-event templates they can edit. Stored as JSON under
// NOTIFICATION_TEMPLATES_KEY — no schema migration. Placeholders use the
// %name% syntax and are filled at send time. The *delivery connection*
// (sender, admin contacts, SMTP, Twilio) stays in NotificationSettings.
// ===========================================================================
export const NOTIFICATION_TEMPLATES_KEY = 'notification_templates';

/** One editable message (one event). `offsetHours` only matters for scheduled events. */
export interface NotifTemplate {
  enabled: boolean; // master on/off for this event
  email: boolean; // send via email
  sms: boolean; // send via SMS
  subject: string; // email subject
  body: string; // email body (plain text, \n line breaks, %placeholders%)
  smsBody: string; // SMS text
  offsetHours: number; // scheduled events: how many hours before/after (0 = immediate)
}

export type NotificationTemplates = Record<string, NotifTemplate>;

// Email bodies are stored as lightweight HTML (the editor is now WYSIWYG). The
// readable plain-text defaults are converted to <p>/<br> markup at module load.
function toHtmlBody(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((par) => `<p>${par.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const t = (p: Partial<NotifTemplate> & Pick<NotifTemplate, 'subject' | 'body' | 'smsBody'>): NotifTemplate => ({
  enabled: true,
  email: true,
  sms: false,
  offsetHours: 0,
  ...p,
  body: toHtmlBody(p.body),
});

/**
 * Default, salon-appropriate content for every supported event. Ids are the
 * stable contract shared with the frontend catalog.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: NotificationTemplates = {
  // --- Customer · booking lifecycle ---
  customer_booking_confirmed: t({
    subject: 'Your %service_name% booking is confirmed — %salon_name%',
    body:
      'Hi %customer_name%,\n\n' +
      'Thank you for booking with %salon_name%! Your appointment is confirmed.\n\n' +
      'Service: %service_name%\n' +
      'Add-ons: %add_ons%\n' +
      'Technician: %staff_name%\n' +
      'Date: %appointment_date%\n' +
      'Time: %appointment_time%\n' +
      'Duration: %duration%\n' +
      'Total: %total_price%\n\n' +
      'We look forward to seeing you. Need to make a change? Just reply to this message.\n' +
      '%salon_name% — %salon_contact%',
    smsBody: '%salon_name%: your %service_name% on %appointment_date% at %appointment_time% is confirmed. See you soon!',
  }),
  customer_booking_pending: t({
    enabled: false,
    subject: 'We received your booking — %salon_name%',
    body:
      'Hi %customer_name%,\n\n' +
      "We've received your request for %service_name% on %appointment_date% at %appointment_time%. " +
      "We'll confirm it shortly.\n\n%salon_name%",
    smsBody: "%salon_name%: we received your booking for %appointment_date% %appointment_time%. We'll confirm soon.",
  }),
  customer_booking_cancelled: t({
    subject: 'Your booking has been cancelled — %salon_name%',
    body:
      'Hi %customer_name%,\n\n' +
      'Your appointment for %service_name% on %appointment_date% at %appointment_time% has been cancelled. ' +
      'We hope to see you again soon — book anytime.\n\n%salon_name%',
    smsBody: '%salon_name%: your booking on %appointment_date% %appointment_time% has been cancelled.',
  }),
  customer_booking_rescheduled: t({
    subject: 'Your appointment has been rescheduled — %salon_name%',
    body:
      'Hi %customer_name%,\n\n' +
      'Your appointment for %service_name% has been moved to %appointment_date% at %appointment_time% ' +
      'with %staff_name%. See you then!\n\n%salon_name%',
    smsBody: '%salon_name%: your appointment is now %appointment_date% at %appointment_time%.',
  }),

  // --- Customer · reminders & care (scheduled) ---
  customer_reminder: t({
    offsetHours: 24,
    subject: 'Reminder: your appointment at %salon_name% is coming up',
    body:
      'Hi %customer_name%,\n\n' +
      'This is a friendly reminder of your %service_name% appointment on %appointment_date% ' +
      'at %appointment_time% with %staff_name%.\n\nSee you soon!\n%salon_name% — %salon_contact%',
    smsBody: 'Reminder: %service_name% at %salon_name% on %appointment_date% %appointment_time%. See you soon!',
  }),
  customer_followup: t({
    enabled: false,
    offsetHours: 24,
    subject: 'Thank you for visiting %salon_name%!',
    body:
      'Hi %customer_name%,\n\n' +
      'Thank you for visiting %salon_name%! We hope you love your nails. ' +
      "We'd love your feedback, and we can't wait to see you again.\n\n%salon_name%",
    smsBody: 'Thanks for visiting %salon_name%! We hope you love your nails. Come back soon!',
  }),
  customer_birthday: t({
    enabled: false,
    subject: 'Happy birthday from %salon_name%!',
    body:
      'Hi %customer_name%,\n\n' +
      'Happy birthday from all of us at %salon_name%! Treat yourself — book your next ' +
      'appointment and enjoy a special birthday touch on us.\n\n%salon_name%',
    smsBody: 'Happy birthday from %salon_name%! Treat yourself to a visit on us.',
  }),

  // --- Customer · payment ---
  customer_payment_receipt: t({
    enabled: false,
    subject: 'Your receipt from %salon_name%',
    body:
      'Hi %customer_name%,\n\n' +
      'Thank you for your payment of %total_price% for %service_name% on %appointment_date%.\n\n' +
      'Booking reference: %booking_id%\n%salon_name%',
    smsBody: '%salon_name%: payment of %total_price% received. Thank you!',
  }),

  // --- Staff alerts ---
  staff_new_booking: t({
    subject: 'New booking assigned: %service_name% on %appointment_date%',
    body:
      'Hi %staff_name%,\n\n' +
      'You have a new appointment:\n\n' +
      'Client: %customer_name%\n' +
      'Service: %service_name%\n' +
      'Date: %appointment_date%\n' +
      'Time: %appointment_time%\n' +
      'Duration: %duration%\n\n%salon_name%',
    smsBody: 'New booking: %service_name% for %customer_name% on %appointment_date% %appointment_time%.',
  }),
  staff_booking_cancelled: t({
    subject: 'Booking cancelled: %appointment_date% %appointment_time%',
    body:
      'Hi %staff_name%,\n\n' +
      'The following appointment was cancelled:\n\n' +
      'Client: %customer_name%\n' +
      'Service: %service_name%\n' +
      'Date: %appointment_date%\n' +
      'Time: %appointment_time%\n\n%salon_name%',
    smsBody: 'Cancelled: %service_name% for %customer_name% on %appointment_date% %appointment_time%.',
  }),
  staff_daily_agenda: t({
    enabled: false,
    offsetHours: 24,
    subject: 'Your schedule for tomorrow — %salon_name%',
    body:
      'Hi %staff_name%,\n\n' +
      "Here's your schedule summary for %appointment_date%. Log in to your staff portal " +
      'for full details.\n\n%salon_name%',
    smsBody: '%salon_name%: your schedule for tomorrow is ready. Check your staff portal.',
  }),
};
