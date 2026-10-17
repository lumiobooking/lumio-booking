/**
 * MASSAGE / SPA PAPERWORK — the salon's rules, and what a visit still needs.
 *
 * One setting per salon (`client_forms`). A massage or spa salon starts with
 * the forms switched on; every other industry starts with them off and sees
 * nothing new. Sending links by text before a visit is off until the owner
 * turns it on — it costs the salon a text.
 *
 * Which visit needs which consent: the services the owner ticked for
 * cupping / hot stone, or — while nothing is ticked — the service's name
 * ("Cupping", "Giác hơi", "Hot stone", "Đá nóng").
 *
 * Pure: no database, no clock (tested in form-settings.spec.ts).
 */
import { CONSENT_KINDS, type ConsentKind, type ExtraQuestion, type FormKind } from './form-templates';

export const CLIENT_FORMS_KEY = 'client_forms';

export interface ConsentRule { enabled: boolean; serviceIds: string[]; categoryIds: string[] }

export interface ClientFormSettings {
  enabled: boolean;
  /** Ask a new client for the intake before the first session. */
  intakeRequired: boolean;
  /** How long a signed intake stays good; 0 = every visit. */
  intakeValidMonths: number;
  consents: Record<ConsentKind, ConsentRule>;
  /** How long a signed consent stays good; 0 = every visit. */
  consentValidMonths: number;
  /** The therapist writes a SOAP note after each session. */
  soapRequired: boolean;
  /** Text the client a link before a booked visit. */
  autoSend: { enabled: boolean; hoursBefore: number };
  extraQuestions: ExtraQuestion[];
}

export const FORM_INDUSTRIES = ['MASSAGE', 'SPA'];

export function defaultFormSettings(industry: string | null | undefined): ClientFormSettings {
  return {
    enabled: FORM_INDUSTRIES.includes(String(industry ?? '').toUpperCase()),
    intakeRequired: true,
    intakeValidMonths: 12,
    consents: {
      cupping: { enabled: true, serviceIds: [], categoryIds: [] },
      hot_stone: { enabled: true, serviceIds: [], categoryIds: [] },
    },
    consentValidMonths: 12,
    soapRequired: true,
    autoSend: { enabled: false, hoursBefore: 24 },
    extraQuestions: [],
  };
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const ids = (v: unknown, d: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 300) : d);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Stored or sent settings made safe, on top of `base` (unknown keys dropped, numbers clamped). */
export function sanitizeFormSettings(raw: unknown, base: ClientFormSettings): ClientFormSettings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const consentsRaw = r.consents && typeof r.consents === 'object' ? (r.consents as Record<string, unknown>) : {};
  const consents = {} as Record<ConsentKind, ConsentRule>;
  for (const k of CONSENT_KINDS) {
    const c = consentsRaw[k] && typeof consentsRaw[k] === 'object' ? (consentsRaw[k] as Record<string, unknown>) : {};
    const b = base.consents[k];
    consents[k] = { enabled: bool(c.enabled, b.enabled), serviceIds: ids(c.serviceIds, b.serviceIds), categoryIds: ids(c.categoryIds, b.categoryIds) };
  }
  const autoRaw = r.autoSend && typeof r.autoSend === 'object' ? (r.autoSend as Record<string, unknown>) : {};
  let extra = base.extraQuestions;
  if (Array.isArray(r.extraQuestions)) {
    const seen = new Set<string>();
    extra = [];
    for (const q of r.extraQuestions.slice(0, 20)) {
      if (!q || typeof q !== 'object') continue;
      const o = q as Record<string, unknown>;
      const vi = str(o.vi, 160), en = str(o.en, 160);
      if (!vi && !en) continue;
      let id = str(o.id, 24).replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (!id || seen.has(id)) id = `q${extra.length + 1}${Math.abs(hash(vi + en)).toString(36).slice(0, 4)}`;
      seen.add(id);
      extra.push({ id, vi, en, flag: bool(o.flag, true) });
    }
  }
  return {
    enabled: bool(r.enabled, base.enabled),
    intakeRequired: bool(r.intakeRequired, base.intakeRequired),
    intakeValidMonths: int(r.intakeValidMonths, base.intakeValidMonths, 0, 60),
    consents,
    consentValidMonths: int(r.consentValidMonths, base.consentValidMonths, 0, 60),
    soapRequired: bool(r.soapRequired, base.soapRequired),
    autoSend: { enabled: bool(autoRaw.enabled, base.autoSend.enabled), hoursBefore: int(autoRaw.hoursBefore, base.autoSend.hoursBefore, 1, 72) },
    extraQuestions: extra,
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const KEYWORDS: Record<ConsentKind, RegExp> = {
  cupping: /cupp|gi[áa]c\s*h[ơo]i/i,
  hot_stone: /hot\s*-?\s*stones?|đá\s*nóng|da\s*nong/i,
};

export interface VisitService { id: string | null; name: string; categoryId?: string | null }

/** The consents a visit with these services needs. */
export function consentKindsFor(s: ClientFormSettings, services: VisitService[]): ConsentKind[] {
  const out: ConsentKind[] = [];
  for (const k of CONSENT_KINDS) {
    const rule = s.consents[k];
    if (!rule?.enabled) continue;
    const ticked = rule.serviceIds.length > 0 || rule.categoryIds.length > 0;
    const hit = services.some((sv) => ticked
      ? (!!sv.id && rule.serviceIds.includes(sv.id)) || (!!sv.categoryId && rule.categoryIds.includes(sv.categoryId))
      : KEYWORDS[k].test(sv.name || ''));
    if (hit) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------- a visit's status

export interface EntryLite {
  id: string; kind: FormKind; signedAt: Date | string;
  appointmentId?: string | null; walkInId?: string | null;
}

export interface FormNeed {
  kind: FormKind;
  /** before = the client signs before the session; after = the therapist's note. */
  when: 'before' | 'after';
  status: 'signed' | 'missing' | 'expired';
  entryId: string | null;
  signedAt: string | null;
}

function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * What this visit needs and what is already on file.
 *
 * A form signed for THIS visit (its booking or its floor ticket — a booked
 * client checked in carries both) always counts. Otherwise the latest one of
 * that kind counts while it is younger than the salon's validity; with a
 * validity of 0 ("every visit"), one signed in the last 12 hours still counts
 * — the client who signed at the desk a moment before the ticket was made.
 */
export function visitNeeds(
  s: ClientFormSettings,
  visit: { appointmentId?: string | null; walkInId?: string | null; consentKinds: ConsentKind[] },
  entries: EntryLite[],
  now: Date,
): FormNeed[] {
  if (!s.enabled) return [];
  const sameVisit = (e: EntryLite) =>
    (!!visit.appointmentId && e.appointmentId === visit.appointmentId) || (!!visit.walkInId && e.walkInId === visit.walkInId);
  const latest = (kind: FormKind) => entries
    .filter((e) => e.kind === kind)
    .sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime());

  const need = (kind: FormKind, months: number, when: FormNeed['when']): FormNeed => {
    const list = latest(kind);
    const mine = list.find(sameVisit);
    if (mine) return { kind, when, status: 'signed', entryId: mine.id, signedAt: new Date(mine.signedAt).toISOString() };
    const last = list[0];
    if (!last) return { kind, when, status: 'missing', entryId: null, signedAt: null };
    const at = new Date(last.signedAt);
    const fresh = when === 'after' ? false : months > 0 ? at >= monthsBefore(now, months) : now.getTime() - at.getTime() <= 12 * 3600_000;
    return fresh
      ? { kind, when, status: 'signed', entryId: last.id, signedAt: at.toISOString() }
      : { kind, when, status: when === 'after' ? 'missing' : 'expired', entryId: last.id, signedAt: at.toISOString() };
  };

  const out: FormNeed[] = [];
  if (s.intakeRequired) out.push(need('intake', s.intakeValidMonths, 'before'));
  for (const k of visit.consentKinds) out.push(need(k, s.consentValidMonths, 'before'));
  if (s.soapRequired) out.push(need('soap', 0, 'after'));
  return out;
}

/** The client-signed forms a visit is still missing — what a link should ask for. */
export function missingClientKinds(needs: FormNeed[]): FormKind[] {
  return needs.filter((n) => n.when === 'before' && n.status !== 'signed').map((n) => n.kind);
}
