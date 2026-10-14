import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * How long Lumio's service runs for a salon — so the agency list can say which
 * shops have run out, which are about to, and whether anyone has told the
 * renewals people yet.
 *
 * A label the team keeps, stored per salon in a Setting row (like the service
 * package). It bills nobody and LOCKS NOTHING: an expired term only paints the
 * row red. The real lock stays Tenant.accessUntil / status, owned by Super
 * Admin.
 *
 * Dates are calendar days ("2026-10-19"), not instants: "hết hạn 19/10" means
 * the same day wherever the person reading it sits.
 *
 * The renewal mark belongs to ONE cycle. "Đã báo" records the end date it was
 * about (forEnd); once the term moves on — renewed, or edited by hand — the
 * old mark no longer matches and the next cycle starts un-told. Nobody has to
 * remember to clear it.
 */

export const SERVICE_TERM_KEY = 'service_term';
export const DEFAULT_ALERT_DAYS = 14;
const MAX_MONTHS = 60;
const MAX_NOTE = 500;

export interface RenewMark {
  state: 'told' | 'renewed';
  /** Email of the support account that marked it. */
  by: string | null;
  at: string;
  note?: string;
  /** told: the end date this warning was about. */
  forEnd?: string;
  /** renewed: the new end date, and the one it replaced. */
  renewedTo?: string;
  prevEnd?: string;
  months?: number;
}

export interface ServiceTerm {
  start: string | null;
  end: string;
  months: number | null;
  alertDays: number;
  renew: RenewMark | null;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day written YYYY-MM-DD. "2026-02-30" is not one. */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** 31 Jan + 1 month = 28/29 Feb: the day is clamped to the month, never spills over. */
export function addMonthsDay(day: string, months: number): string {
  const m = DAY.exec(day)!;
  const y = +m[1]; const mo = +m[2] - 1 + months; const d = +m[3];
  const ty = y + Math.floor(mo / 12); const tm = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(ty, tm, Math.min(d, last)));
  return out.toISOString().slice(0, 10);
}

function wholeMonths(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_MONTHS ? v : null;
}
function alertDaysOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 120 ? v : null;
}
function cleanNote(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, MAX_NOTE);
  return s || undefined;
}

function renewOf(v: unknown): RenewMark | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.state !== 'told' && r.state !== 'renewed') return null;
  if (typeof r.at !== 'string') return null;
  const out: RenewMark = { state: r.state, by: typeof r.by === 'string' ? r.by : null, at: r.at };
  const note = cleanNote(r.note); if (note) out.note = note;
  if (isDay(r.forEnd)) out.forEnd = r.forEnd;
  if (isDay(r.renewedTo)) out.renewedTo = r.renewedTo;
  if (isDay(r.prevEnd)) out.prevEnd = r.prevEnd;
  const mo = wholeMonths(r.months); if (mo) out.months = mo;
  return out;
}

/** The stored value, read safely: anything unreadable is "no term recorded". */
export function serviceTermOf(stored: unknown): ServiceTerm | null {
  if (!stored || typeof stored !== 'object') return null;
  const s = stored as Record<string, unknown>;
  if (!isDay(s.end)) return null;
  return {
    start: isDay(s.start) ? s.start : null,
    end: s.end,
    months: wholeMonths(s.months),
    alertDays: alertDaysOf(s.alertDays) ?? DEFAULT_ALERT_DAYS,
    renew: renewOf(s.renew),
  };
}

/** The slice of Prisma the setters need — so they can be tested without the whole support module. */
interface TermStore {
  tenant: { findFirst: (a: { where: { id: string; deletedAt: null }; select: { id: true } }) => Promise<{ id: string } | null> };
  setting: {
    findUnique: (a: { where: { tenantId_key: { tenantId: string; key: string } }; select: { value: true } }) => Promise<{ value: unknown } | null>;
    upsert: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  auditLog: { create: (a: unknown) => Promise<unknown> };
}
type Actor = { userId?: string | null; email?: string | null };

async function mustExist(prisma: TermStore, tenantId: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }).catch(() => null);
  if (!tenant) throw new NotFoundException('Salon not found');
}
async function readTerm(prisma: TermStore, tenantId: string): Promise<ServiceTerm | null> {
  const row = await prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SERVICE_TERM_KEY } }, select: { value: true } }).catch(() => null);
  return serviceTermOf(row?.value);
}
async function writeTerm(prisma: TermStore, tenantId: string, term: ServiceTerm, user: Actor) {
  const value = { ...term, at: new Date().toISOString(), by: user.email ?? null };
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: SERVICE_TERM_KEY } },
    create: { tenantId, key: SERVICE_TERM_KEY, value },
    update: { value },
  });
}
async function audit(prisma: TermStore, tenantId: string, user: Actor, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { tenantId, userId: user.userId ?? null, action, resourceType: 'tenant', resourceId: tenantId, metadata: { ...metadata, by: user.email ?? null } },
  }).catch(() => undefined);
}

/**
 * Record (or clear) a salon's service term. Any support account, like the
 * package: it is a label for the team. The end date is given, or worked out
 * from the start plus a number of months. Audited.
 */
export async function setServiceTerm(
  prisma: TermStore,
  user: Actor,
  tenantId: string,
  dto: { start?: unknown; end?: unknown; months?: unknown; alertDays?: unknown; clear?: unknown } | null | undefined,
): Promise<{ ok: true; serviceTerm: ServiceTerm | null }> {
  const d = dto ?? {};
  await mustExist(prisma, tenantId);
  if (d.clear === true) {
    await prisma.setting.deleteMany({ where: { tenantId, key: SERVICE_TERM_KEY } });
    await audit(prisma, tenantId, user, 'support.service_term_cleared', {});
    return { ok: true, serviceTerm: null };
  }
  const start = d.start == null || d.start === '' ? null : d.start;
  if (start !== null && !isDay(start)) throw new BadRequestException('start phải là ngày YYYY-MM-DD');
  const months = d.months == null || d.months === '' ? null : wholeMonths(d.months);
  if (d.months != null && d.months !== '' && months === null) throw new BadRequestException(`months phải là số nguyên 1–${MAX_MONTHS}`);
  let end: string | null = d.end == null || d.end === '' ? null : (d.end as string);
  if (end !== null && !isDay(end)) throw new BadRequestException('end phải là ngày YYYY-MM-DD');
  if (end === null && start && months) end = addMonthsDay(start, months);
  if (end === null) throw new BadRequestException('Cần ngày kết thúc, hoặc ngày bắt đầu và số tháng');
  if (start && end < start) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  if (d.alertDays != null && alertDaysOf(d.alertDays) === null) throw new BadRequestException('alertDays phải là số nguyên 1–120');
  const before = await readTerm(prisma, tenantId);
  const term: ServiceTerm = {
    start,
    end,
    months,
    alertDays: alertDaysOf(d.alertDays) ?? before?.alertDays ?? DEFAULT_ALERT_DAYS,
    // The mark is kept as it is; it only counts while it matches the end date.
    renew: before?.renew ?? null,
  };
  await writeTerm(prisma, tenantId, term, user);
  await audit(prisma, tenantId, user, 'support.service_term_set', { start, end, months, alertDays: term.alertDays, prevEnd: before?.end ?? null });
  return { ok: true, serviceTerm: term };
}

/**
 * The renewal trail of the current cycle:
 *   told    — someone passed it to the renewals people (with an optional note)
 *   undo    — that was a mistake; back to un-told
 *   renewed — the customer renewed: the term moves on by N months (or to a
 *             given date), starting where the old one ended.
 */
export async function markRenewal(
  prisma: TermStore,
  user: Actor,
  tenantId: string,
  dto: { action?: unknown; note?: unknown; months?: unknown; end?: unknown } | null | undefined,
): Promise<{ ok: true; serviceTerm: ServiceTerm }> {
  const d = dto ?? {};
  if (d.action !== 'told' && d.action !== 'undo' && d.action !== 'renewed') {
    throw new BadRequestException('action phải là told | undo | renewed');
  }
  await mustExist(prisma, tenantId);
  const term = await readTerm(prisma, tenantId);
  if (!term) throw new BadRequestException('Tiệm này chưa có thời hạn — ghi thời hạn trước.');
  const at = new Date().toISOString();
  const by = user.email ?? null;
  let next: ServiceTerm;
  if (d.action === 'told') {
    next = { ...term, renew: { state: 'told', by, at, forEnd: term.end, ...(cleanNote(d.note) ? { note: cleanNote(d.note) } : {}) } };
  } else if (d.action === 'undo') {
    next = { ...term, renew: null };
  } else {
    const months = d.months == null ? null : wholeMonths(d.months);
    if (d.months != null && months === null) throw new BadRequestException(`months phải là số nguyên 1–${MAX_MONTHS}`);
    let newEnd: string | null = null;
    if (d.end != null && d.end !== '') {
      if (!isDay(d.end)) throw new BadRequestException('end phải là ngày YYYY-MM-DD');
      newEnd = d.end;
    } else if (months) {
      newEnd = addMonthsDay(term.end, months);
    }
    if (!newEnd) throw new BadRequestException('Cần số tháng gia hạn hoặc ngày kết thúc mới');
    if (newEnd <= term.end) throw new BadRequestException('Ngày kết thúc mới phải sau ngày kết thúc cũ');
    next = {
      ...term,
      start: term.end,
      end: newEnd,
      months: months ?? term.months,
      renew: { state: 'renewed', by, at, renewedTo: newEnd, prevEnd: term.end, ...(months ? { months } : {}), ...(cleanNote(d.note) ? { note: cleanNote(d.note) } : {}) },
    };
  }
  await writeTerm(prisma, tenantId, next, user);
  await audit(prisma, tenantId, user, `support.service_term_${d.action === 'undo' ? 'untold' : d.action}`, {
    end: next.end, prevEnd: term.end, note: next.renew?.note ?? null,
  });
  return { ok: true, serviceTerm: next };
}
