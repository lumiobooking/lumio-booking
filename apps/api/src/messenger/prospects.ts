/**
 * rt215 — "Khách tiềm năng": people who wrote to the Page, even left a phone
 * number, and never booked / signed up. The owner: "lọc ra những khách hàng
 * tiềm năng, họ đã liên hệ và thậm chí đưa cả số phone nhưng chưa đăng ký, để
 * nhân viên tôi follow up lại".
 *
 * A phone number counts when the CUSTOMER typed it (never the salon's own
 * number in a reply), or when it was saved on the conversation (the AI's
 * save_contact, a lead card). Booked = the linked customer, or a customer with
 * that number, has an appointment that was not cancelled; or the lead card is
 * marked won / lost.
 */

/** Digits of a phone number in a customer's line, or null. 9–12 digits with spaces, dots, dashes or brackets between. */
export function phoneIn(text: unknown): string | null {
  const s = String(text ?? '');
  const re = /(?:\+?\d[\s.\-()]{0,2}){9,13}/g;
  let found: string | null = null;
  for (const m of s.match(re) ?? []) {
    let d = m.replace(/\D/g, '');
    if (d.length < 9 || d.length > 12) continue;
    // A price written with dots ("1.500.000.000") is not a phone.
    if (/^\d{1,3}([.,]\d{3}){2,}$/.test(m.trim())) continue;
    if (/^0{4,}/.test(d) || /^(\d)\1{8,}$/.test(d)) continue;
    if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`;
    found = d;
  }
  return found;
}

/** An email address in a customer's line, lower-cased, or null. */
export function emailIn(text: unknown): string | null {
  const m = String(text ?? '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (!m) return null;
  const e = m[m.length - 1].toLowerCase().replace(/\.+$/, '');
  return e.length <= 120 ? e : null;
}

/** The last email the customer typed in this conversation's history. */
export function customerEmailFrom(history: unknown): string | null {
  if (!Array.isArray(history)) return null;
  let out: string | null = null;
  for (const t of history as { role?: string; content?: unknown }[]) {
    if (!t || t.role !== 'user') continue;
    const e = emailIn(t.content);
    if (e) out = e;
  }
  return out;
}

/** The last phone number the customer typed in this conversation's history. */
export function customerPhoneFrom(history: unknown): string | null {
  if (!Array.isArray(history)) return null;
  let out: string | null = null;
  for (const t of history as { role?: string; content?: unknown }[]) {
    if (!t || t.role !== 'user') continue;
    const p = phoneIn(t.content);
    if (p) out = p;
  }
  return out;
}

/** Same number written two ways (0912…, +84 912…, 912…) compares equal. */
export function phoneKeyOf(p: unknown): string {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) return d.slice(2);
  if (d.startsWith('0')) return d.slice(1);
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d;
}

export const PROSPECT_DAYS = [30, 90, 365] as const;
export function prospectDays(v: unknown): number {
  const n = Number(v);
  return (PROSPECT_DAYS as readonly number[]).includes(n) ? n : 90;
}

export interface ProspectFacts {
  threadId: string;
  phoneTyped: string | null;
  phoneSaved: string | null;
  leadStatus: string | null;
  booked: boolean;
}

/** Is this conversation a prospect to follow up, and with which number. */
export function prospectPhone(f: ProspectFacts): string | null {
  if (f.booked) return null;
  if (f.leadStatus === 'WON' || f.leadStatus === 'LOST') return null;
  return f.phoneSaved || f.phoneTyped || null;
}

/** rt218: phone and/or email to follow up with, or null when not a prospect. */
export function prospectContact(f: ProspectFacts & { emailTyped?: string | null; emailSaved?: string | null }): { phone: string | null; email: string | null } | null {
  if (f.booked) return null;
  if (f.leadStatus === 'WON' || f.leadStatus === 'LOST') return null;
  const phone = f.phoneSaved || f.phoneTyped || null;
  const email = f.emailSaved || f.emailTyped || null;
  return phone || email ? { phone, email } : null;
}
