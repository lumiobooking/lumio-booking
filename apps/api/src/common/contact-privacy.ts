/**
 * WHAT A TECHNICIAN'S PHONE MAY KNOW ABOUT HOW TO REACH A CLIENT.
 *
 * The technician app showed every client's phone (with Call / Text buttons)
 * and email. A salon's client list is its business; staff leave and take it
 * with them. The owner now chooses, per salon (setting STAFF_PRIVACY_KEY):
 *   'last4'  — "••• 2832": enough to tell two Jennifers apart (DEFAULT)
 *   'hidden' — nothing
 *   'full'   — as before
 * Applied on the SERVER (contact-privacy.interceptor) to every response the
 * technician app reads, so the numbers never reach her phone at all. Owners,
 * managers and the front desk always see everything. Pure.
 */
export const STAFF_PRIVACY_KEY = 'staff_privacy';
export type ContactMode = 'hidden' | 'last4' | 'full';
export const CONTACT_MODES: readonly ContactMode[] = ['hidden', 'last4', 'full'];
export const DEFAULT_CONTACT_MODE: ContactMode = 'last4';

export function contactModeOf(v: unknown): ContactMode {
  const m = (v as { contact?: unknown } | null)?.contact;
  return typeof m === 'string' && (CONTACT_MODES as readonly string[]).includes(m) ? (m as ContactMode) : DEFAULT_CONTACT_MODE;
}

/** A technician (or a staff login with no role yet) — the only viewer this applies to. */
export function isTechViewer(user: { role?: string | null; staffRole?: string | null } | null | undefined): boolean {
  return !!user && user.role === 'STAFF' && (!user.staffRole || user.staffRole === 'TECHNICIAN');
}

export const MASK = '•••';

export function maskPhone(phone: unknown, mode: ContactMode): string | null {
  if (typeof phone !== 'string' || !phone.trim()) return (phone as null) ?? null;
  if (mode === 'full') return phone;
  if (mode === 'hidden') return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `${MASK} ${digits.slice(-4)}` : MASK;
}

const PHONE_IN_TEXT = /\+?\d[\d\s().-]{5,}\d/g;
const EMAIL_IN_TEXT = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/g;

/** A client's note keeps what it says about the visit; numbers and emails in it are covered. */
export function maskText(text: unknown, mode: ContactMode): unknown {
  if (typeof text !== 'string' || mode === 'full') return text;
  return text
    .replace(EMAIL_IN_TEXT, '(email hidden)')
    .replace(PHONE_IN_TEXT, (m) => (m.replace(/\D/g, '').length >= 7 ? (mode === 'last4' ? `${MASK} ${m.replace(/\D/g, '').slice(-4)}` : '(phone hidden)') : m));
}

const PHONE_KEYS = new Set(['phone', 'phoneNumber', 'customerPhone', 'mobile', 'sentTo']);
const EMAIL_KEYS = new Set(['email', 'customerEmail']);
const TEXT_KEYS = new Set(['notes', 'note', 'customerNote', 'message']);

/**
 * The response, with every client contact masked, however deep it sits
 * (booking.customer.phone, a ticket's phone, a note). Returns a copy; Dates
 * and other non-plain objects pass through untouched.
 */
export function redactContacts<T>(value: T, mode: ContactMode, depth = 0): T {
  if (mode === 'full' || value === null || value === undefined || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => redactContacts(v, mode, depth + 1)) as unknown as T;
  if (typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PHONE_KEYS.has(k) && (typeof v === 'string' || v === null)) out[k] = maskPhone(v, mode);
    else if (EMAIL_KEYS.has(k) && (typeof v === 'string' || v === null)) out[k] = v ? null : v;
    else if (TEXT_KEYS.has(k)) out[k] = maskText(v, mode);
    else out[k] = redactContacts(v, mode, depth + 1);
  }
  return out as T;
}
