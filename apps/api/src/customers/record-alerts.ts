/**
 * "⚠ DỊ ỨNG: PENICILLIN" WHERE IT MATTERS. A customer record can carry
 * warning fields (common/industry-fields.ts: allergies and medical history for
 * a clinic, dietary needs for a restaurant, sensitivities for nails / lashes /
 * hair / spa). They were only on the customer page; now the desk sees them
 * while booking and on the arrivals list. Pure.
 */
import { warnings } from '../common/industry-fields';

export interface AlertRow { id: string; industryFields: unknown }
export interface RecordAlert { id: string; warnings: { label: { vi: string; en: string }; value: string }[] }

/** The same number however it was typed: compare the last 9 digits (7 at least). */
export function samePhone(typed: string, stored: string | null | undefined): boolean {
  const a = typed.replace(/\D/g, ''); const b = (stored ?? '').replace(/\D/g, '');
  if (a.length < 7 || b.length < 7) return false;
  const n = Math.min(9, a.length, b.length);
  return a.slice(-n) === b.slice(-n);
}

export function alertsFor(industry: string, rows: AlertRow[]): RecordAlert[] {
  return rows.map((r) => ({ id: r.id, warnings: warnings(industry, r.industryFields) })).filter((x) => x.warnings.length > 0);
}

/** `ids=a,b,c` from a query string: trimmed, unique, at most 60. */
export function idList(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]{1,64}$/.test(s)))].slice(0, 60);
}
