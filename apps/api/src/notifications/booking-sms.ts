/**
 * THE BOOKING TEXT — everything that matters, in one segment when it can be.
 *
 * A text is billed per segment (160 GSM-7 characters, 153 each once split).
 * The old default confirmation read the long date ("Sunday, December 6,
 * 2026"), the whole time range, a "Tech:" line and a manage link — two or
 * three segments for one booking, and for a party it only named one person's
 * service. This writes the same facts short:
 *
 *   MT. HAWTHORN NAIL SPA: booked Sun Dec 6, 6:00 PM, 5 people:
 *   Mani & Pedi Deluxe x4, Gel X. Total $250. Manage: https://lumiobooking.com/a/…
 *
 * Built from the most complete version down; the first that fits ONE segment
 * is sent, else the first that fits TWO. What gets dropped first is what the
 * customer can live without (opt-out wording the carrier handles anyway, the
 * technician, then the total). Never more than two segments. Pure; the text
 * is passed through toGsm7 so the count is the count the carrier bills.
 *
 * Used only when the salon still has the built-in SMS wording. A salon that
 * wrote its own text keeps it.
 */
import { toGsm7, smsSegments } from './sms-text';

export interface BookingSmsInput {
  salon: string;
  /** "Sun Dec 6" — short, no year. */
  dateShort: string;
  /** "6:00 PM" — start only. */
  timeStart: string;
  /** One entry per person: the services that person is having. */
  people: Array<{ name?: string; services: string[] }>;
  tech?: string;
  total?: string;
  /** Customer copy: the short manage link. */
  link?: string;
  /** Owner copy: who booked, and how to call them. */
  customer?: string;
  customerPhone?: string;
  vi?: boolean;
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}.`);

/** "Mani & Pedi Deluxe x4, Gel X" — each service once, with how many people are having it. */
export function servicesSummary(people: BookingSmsInput['people'], maxEach = 40): string {
  const count = new Map<string, number>();
  for (const p of people) for (const s of p.services) { const k = s.trim(); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
  return [...count.entries()].map(([s, n]) => `${cut(s, maxEach)}${n > 1 ? ` x${n}` : ''}`).join(', ');
}

function fitting(candidates: string[]): string {
  const clean = candidates.map((c) => toGsm7(c.replace(/\s+/g, ' ').trim()));
  return clean.find((c) => smsSegments(c).segments <= 1)
    ?? clean.find((c) => smsSegments(c).segments <= 2)
    ?? clean[clean.length - 1];
}

/** The customer's confirmation text. */
export function customerBookingSms(i: BookingSmsInput): string {
  const n = i.people.length;
  const when = `${i.dateShort}, ${i.timeStart}`;
  const who = n > 1 ? (i.vi ? `, ${n} nguoi` : `, ${n} people`) : '';
  const booked = i.vi ? 'da dat lich' : 'booked';
  const link = i.link ? (i.vi ? ` Xem/huy: ${i.link}` : ` Manage: ${i.link}`) : '';
  const tech = n === 1 && i.tech ? (i.vi ? ` voi ${i.tech}` : ` with ${i.tech}`) : '';
  const total = i.total ? (i.vi ? ` Tong ${i.total}.` : ` Total ${i.total}.`) : '';
  const stop = i.vi ? '' : ' Reply STOP to opt out.';
  const svc = (max: number) => servicesSummary(i.people, max);
  const head = `${i.salon}: ${booked} ${when}${who}:`;
  return fitting([
    `${head} ${svc(40)}${tech}.${total}${link}${stop}`,
    `${head} ${svc(40)}${tech}.${total}${link}`,
    `${head} ${svc(40)}.${total}${link}`,
    `${head} ${svc(24)}.${total}${link}`,
    `${head} ${svc(24)}.${link}`,
    `${cut(i.salon, 24)}: ${booked} ${when}${who}: ${svc(18)}.${link}`,
  ]);
}

/** The salon's "new booking" text. */
export function ownerBookingSms(i: BookingSmsInput): string {
  const n = i.people.length;
  const who = `${i.customer || (i.vi ? 'Khach' : 'Guest')}${n > 1 ? ` +${n - 1}` : ''}`;
  const phone = i.customerPhone ? ` ${i.customerPhone}` : '';
  const head = i.vi ? 'Lich moi' : 'New booking';
  const when = `${i.dateShort} ${i.timeStart}`;
  const tech = n === 1 && i.tech ? ` - ${i.tech}` : '';
  const total = i.total ? ` - ${i.total}` : '';
  const svc = (max: number) => servicesSummary(i.people, max);
  const size = n > 1 ? (i.vi ? ` (${n} nguoi)` : ` (${n} ppl)`) : '';
  return fitting([
    `${head}: ${who}${phone} - ${when}${size}: ${svc(40)}${tech}${total}`,
    `${head}: ${who}${phone} - ${when}${size}: ${svc(24)}${total}`,
    `${head}: ${who}${phone} - ${when}${size}: ${svc(16)}`,
  ]);
}
