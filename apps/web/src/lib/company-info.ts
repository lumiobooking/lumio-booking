/**
 * Who runs Lumio Booking — ONE copy, read by every public page.
 *
 * Partner reviewers (Google Actions Center, Meta, TikTok, the SMS carriers)
 * compare the company details on the home page, the Company page, the legal
 * pages and the support page against each other and against what was typed
 * into their forms. Two pages quoting two different addresses or two different
 * inboxes is exactly the kind of inconsistency that gets an application
 * refused without a reason, so the facts live here and nowhere else.
 */
export const COMPANY = {
  legalName: 'Lumio Agency LLC',
  tradingName: 'Lumio Booking',
  website: 'https://lumiobooking.com',
  /** Where the team works. */
  office: ['10650 Montclair Way', 'Johns Creek, GA 30097', 'United States'],
  /** The LLC's registered address. */
  registered: ['5900 Balcones Drive, Suite 100', 'Austin, TX 78731', 'United States'],
  phone: '+1 (512) 886-8189',
  phoneHref: 'tel:+15128868189',
  supportEmail: 'support@lumiobooking.com',
  partnersEmail: 'partners@lumiobooking.com',
  /** What we promise in public — Google requires a reply within 2 business days. */
  replyTime: '1 business day',
  markets: 'United States and Canada',
} as const;

/** "10650 Montclair Way, Johns Creek, GA 30097, United States" */
export const officeLine = (): string => COMPANY.office.join(', ');
/** "5900 Balcones Drive, Suite 100, Austin, TX 78731, United States" */
export const registeredLine = (): string => COMPANY.registered.join(', ');
