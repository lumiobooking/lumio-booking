import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NotificationChannel, StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { INDUSTRY_KEY, resolveIndustry } from '../common/industry';
import { publicWebBase } from '../common/public-url.util';
import { liveEvents } from '../common/live-events';
import {
  CLIENT_KINDS, cleanSignature, isFormKind, redFlags, resolveTemplate, templateFor, validateAnswers, visitNotes,
  type Answers, type ConsentKind, type FormKind, type FormLang, type ResolvedTemplate,
} from './form-templates';
import {
  CLIENT_FORMS_KEY, consentKindsFor, defaultFormSettings, missingClientKinds, sanitizeFormSettings, visitNeeds,
  type ClientFormSettings, type EntryLite, type VisitService,
} from './form-settings';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Who sees what:
 *   full — owner, manager (and Lumio support with client-data access): everything
 *   tech — a technician: the forms of clients they serve or have served
 *   desk — reception: which forms are signed or missing, never what is in them
 */
export type FormAccess = 'full' | 'tech' | 'desk';

export function accessOf(user: AuthenticatedUser): FormAccess {
  if (user.role === UserRole.SALON_ADMIN || user.role === UserRole.SUPER_ADMIN) return 'full';
  if (user.role === UserRole.STAFF) {
    if (user.staffRole === StaffRole.MANAGER) return 'full';
    if (!user.staffRole || user.staffRole === StaffRole.TECHNICIAN) return 'tech';
    return 'desk';
  }
  return 'desk';
}

interface Visit {
  appointmentId: string | null;
  walkInId: string | null;
  customerId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: Date | null;
  staffIds: string[];
  services: VisitService[];
}

const LINK_DAYS = 7;
const OK_PHONE = /^\+?[0-9][0-9\s().-]{6,}$/;

/**
 * Massage / spa paperwork: intake, consent and SOAP notes.
 *
 * Every read and write is scoped to the caller's own salon; the public side
 * is reached only through a long random per-link token and resolves the
 * salon FROM that token. A signed entry is never edited — corrections are
 * appended as dated addenda. Viewing, signing and amending are audited.
 */
@Injectable()
export class ClientFormsService {
  private readonly log = new Logger('ClientForms');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** The generated client predates these models; reach them untyped. */
  private get db(): Row { return this.prisma as unknown as Row; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async staffOf(tenantId: string, user: AuthenticatedUser): Promise<{ id: string; name: string } | null> {
    if (user.role !== UserRole.STAFF) return null;
    const s = await this.db.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true, firstName: true, lastName: true } }).catch(() => null);
    return s ? { id: s.id, name: [s.firstName, s.lastName].filter(Boolean).join(' ') } : null;
  }

  // ---------------------------------------------------------------- settings

  private async industryOf(tenantId: string): Promise<string> {
    const [t, row] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { businessType: true } }).catch(() => null),
      this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: INDUSTRY_KEY } } }).catch(() => null),
    ]);
    return resolveIndustry(row?.value ?? null, t?.businessType ?? null);
  }

  async getSettings(tenantId: string): Promise<ClientFormSettings> {
    const [industry, row] = await Promise.all([
      this.industryOf(tenantId),
      this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: CLIENT_FORMS_KEY } } }).catch(() => null),
    ]);
    return sanitizeFormSettings(row?.value ?? null, defaultFormSettings(industry));
  }

  async settingsView(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [settings, industry, services, categories] = await Promise.all([
      this.getSettings(tenantId),
      this.industryOf(tenantId),
      this.db.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, categoryId: true }, orderBy: { name: 'asc' }, take: 500 }).catch(() => [] as Row[]),
      this.db.serviceCategory?.findMany?.({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }).catch(() => [] as Row[]) ?? [],
    ]);
    return { settings, industry, access: accessOf(user), services, categories };
  }

  async updateSettings(user: AuthenticatedUser, dto: unknown) {
    if (accessOf(user) !== 'full') throw new ForbiddenException('Only the owner or a manager can change the forms');
    const tenantId = this.tenantId(user);
    const next = sanitizeFormSettings(dto, await this.getSettings(tenantId));
    await this.db.setting.upsert({
      where: { tenantId_key: { tenantId, key: CLIENT_FORMS_KEY } },
      update: { value: next },
      create: { tenantId, key: CLIENT_FORMS_KEY, value: next },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'client_forms.settings_updated', resourceType: 'setting', resourceId: CLIENT_FORMS_KEY, metadata: { enabled: next.enabled } });
    return next;
  }

  /** The forms as this salon shows them (its own intake questions included), in both languages. */
  async templates(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    return { enabled: s.enabled, templates: this.resolvedAll(s, ['intake', 'cupping', 'hot_stone', 'soap']) };
  }

  private resolvedAll(s: ClientFormSettings, kinds: FormKind[]) {
    return kinds.map((k) => {
      const tpl = templateFor(k, s.extraQuestions, s.intakeStyle);
      return { kind: k, vi: resolveTemplate(tpl, 'vi'), en: resolveTemplate(tpl, 'en') };
    });
  }

  // ---------------------------------------------------------------- visits

  private async servicesOf(tenantId: string, ids: string[], names: Map<string, string>): Promise<VisitService[]> {
    const uniq = [...new Set(ids.filter(Boolean))];
    const rows: Row[] = uniq.length
      ? await this.db.service.findMany({ where: { tenantId, id: { in: uniq } }, select: { id: true, name: true, categoryId: true } }).catch(() => [] as Row[])
      : [];
    const out: VisitService[] = rows.map((r) => ({ id: r.id, name: r.name, categoryId: r.categoryId ?? null }));
    // Lines the menu no longer has still count by their name.
    for (const [id, name] of names) if (!rows.some((r) => r.id === id)) out.push({ id: null, name, categoryId: null });
    return out;
  }

  private lineIds(lines: unknown): { ids: string[]; names: Map<string, string>; staff: string[] } {
    const ids: string[] = [];
    const names = new Map<string, string>();
    const staff: string[] = [];
    for (const l of Array.isArray(lines) ? lines : []) {
      if (!l || typeof l !== 'object') continue;
      const o = l as Row;
      const id = typeof o.serviceId === 'string' ? o.serviceId : typeof o.id === 'string' ? o.id : '';
      if (id) { ids.push(id); if (typeof o.name === 'string') names.set(id, o.name); }
      else if (typeof o.name === 'string') names.set(`n:${o.name}`, o.name);
      if (typeof o.staffId === 'string') staff.push(o.staffId);
    }
    return { ids, names, staff };
  }

  /** One visit — a booking or a floor ticket (and its booking) — read under the salon's own id. */
  private async loadVisit(tenantId: string, q: { appointmentId?: string | null; walkInId?: string | null }): Promise<Visit> {
    const custSel = { select: { id: true, firstName: true, lastName: true, phone: true, email: true, birthDate: true } };
    let appt: Row | null = null;
    let walk: Row | null = null;
    if (q.walkInId) {
      walk = await this.db.walkIn.findFirst({
        where: { id: q.walkInId, tenantId },
        select: { id: true, customerId: true, customerName: true, phone: true, assignedStaffId: true, appointmentId: true, items: true, serviceId: true, customer: custSel },
      });
      if (!walk) throw new NotFoundException('Visit not found');
      if (walk.appointmentId) appt = await this.db.appointment.findFirst({ where: { id: walk.appointmentId, tenantId }, select: { id: true, customerId: true, assignedStaffId: true, serviceId: true, addons: true, customer: custSel } }).catch(() => null);
    } else if (q.appointmentId) {
      appt = await this.db.appointment.findFirst({ where: { id: q.appointmentId, tenantId }, select: { id: true, customerId: true, assignedStaffId: true, serviceId: true, addons: true, customer: custSel } });
      if (!appt) throw new NotFoundException('Visit not found');
      walk = await this.db.walkIn.findFirst({ where: { tenantId, appointmentId: appt.id }, select: { id: true, customerId: true, customerName: true, phone: true, assignedStaffId: true, appointmentId: true, items: true, serviceId: true, customer: custSel } }).catch(() => null);
    } else {
      throw new BadRequestException('A booking or a ticket is required');
    }
    const c: Row | null = walk?.customer ?? appt?.customer ?? null;
    const wl = this.lineIds(walk?.items);
    const al = this.lineIds(appt?.addons);
    const ids = [...wl.ids, ...al.ids, walk?.serviceId, appt?.serviceId].filter((x): x is string => typeof x === 'string' && !!x);
    const names = new Map([...al.names, ...wl.names]);
    return {
      appointmentId: appt?.id ?? null,
      walkInId: walk?.id ?? null,
      customerId: walk?.customerId ?? appt?.customerId ?? null,
      name: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : String(walk?.customerName ?? ''),
      phone: c?.phone ?? walk?.phone ?? null,
      email: c?.email ?? null,
      birthDate: c?.birthDate ?? null,
      staffIds: [...new Set([walk?.assignedStaffId, appt?.assignedStaffId, ...wl.staff].filter((x): x is string => typeof x === 'string' && !!x))],
      services: await this.servicesOf(tenantId, ids, names),
    };
  }

  /** The forms on file for this visit's client (or for the visit itself, when the client has no record). */
  private async entriesFor(tenantId: string, v: { customerId: string | null; appointmentId: string | null; walkInId: string | null }): Promise<Row[]> {
    const or: Row[] = [];
    if (v.customerId) or.push({ customerId: v.customerId });
    if (v.appointmentId) or.push({ appointmentId: v.appointmentId });
    if (v.walkInId) or.push({ walkInId: v.walkInId });
    if (!or.length) return [];
    return this.db.clientFormEntry.findMany({
      where: { tenantId, OR: or },
      orderBy: { signedAt: 'desc' },
      take: 200,
      select: { id: true, kind: true, signedAt: true, appointmentId: true, walkInId: true, answers: true, snapshot: true, signerRole: true, signedName: true, staffId: true, customerId: true },
    });
  }

  /** Has this technician served this client (a booking or a ticket of theirs)? */
  private async served(tenantId: string, staffId: string, customerId: string): Promise<boolean> {
    const [a, w] = await Promise.all([
      this.db.appointment.findFirst({ where: { tenantId, customerId, assignedStaffId: staffId }, select: { id: true } }).catch(() => null),
      this.db.walkIn.findFirst({ where: { tenantId, customerId, assignedStaffId: staffId }, select: { id: true } }).catch(() => null),
    ]);
    return !!(a || w);
  }

  private langOf(lang: unknown, market?: string | null): FormLang {
    if (lang === 'vi' || lang === 'en') return lang;
    return String(market ?? '').toUpperCase() === 'VN' || String(market ?? '').toUpperCase() === 'VI' ? 'vi' : 'en';
  }

  /** What a visit needs, what is on file and — for the people allowed — the cautions. */
  async visitStatus(user: AuthenticatedUser, q: { appointmentId?: string; walkInId?: string; lang?: string }) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    if (!s.enabled) return { enabled: false };
    const access = accessOf(user);
    const v = await this.loadVisit(tenantId, q);
    const me = await this.staffOf(tenantId, user);
    if (access === 'tech' && !(me && v.staffIds.includes(me.id))) throw new ForbiddenException('Not your client');
    const kinds = consentKindsFor(s, v.services);
    const entries = await this.entriesFor(tenantId, v);
    const needs = visitNeeds(s, { appointmentId: v.appointmentId, walkInId: v.walkInId, consentKinds: kinds }, entries as EntryLite[], new Date());
    const lang = this.langOf(q.lang);
    const reader = access !== 'desk';
    const signedClient = entries.filter((e) => e.kind !== 'soap' && needs.some((n) => n.entryId === e.id));
    const intake = entries.find((e) => e.kind === 'intake') ?? null;
    const soap = needs.find((n) => n.kind === 'soap' && n.status === 'signed');
    return {
      enabled: true,
      access,
      customer: v.customerId ? { id: v.customerId, name: v.name } : null,
      name: v.name,
      hasPhone: !!(v.phone && OK_PHONE.test(v.phone)),
      consentKinds: kinds,
      needs,
      flags: reader ? redFlags(signedClient.map((e) => ({ kind: e.kind as FormKind, answers: e.answers as Answers, snapshot: e.snapshot as ResolvedTemplate })), kinds, lang) : [],
      notes: reader ? visitNotes((intake?.answers as Answers) ?? null, lang) : [],
      canSoap: s.soapRequired !== false && (access === 'full' || (access === 'tech' && !!me && v.staffIds.includes(me.id))),
      soapId: soap?.entryId ?? null,
    };
  }

  // ---------------------------------------------------------------- a client's file

  async customerForms(user: AuthenticatedUser, customerId: string, langRaw?: string) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    const access = accessOf(user);
    const c = await this.db.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, firstName: true, lastName: true, phone: true } });
    if (!c) throw new NotFoundException('Client not found');
    const me = await this.staffOf(tenantId, user);
    if (access === 'tech' && !(me && (await this.served(tenantId, me.id, customerId)))) throw new ForbiddenException('Not your client');
    const rows: Row[] = await this.db.clientFormEntry.findMany({
      where: { tenantId, customerId },
      orderBy: { signedAt: 'desc' },
      take: 200,
      select: { id: true, kind: true, signedAt: true, signerRole: true, signedName: true, staffId: true, appointmentId: true, walkInId: true, answers: true, snapshot: true, addenda: true },
    });
    const staffIds = [...new Set(rows.map((r) => r.staffId).filter(Boolean))];
    const staff: Row[] = staffIds.length ? await this.db.staffMember.findMany({ where: { tenantId, id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const staffName = new Map(staff.map((x) => [x.id, [x.firstName, x.lastName].filter(Boolean).join(' ')]));
    const lang = this.langOf(langRaw);
    const reader = access !== 'desk';
    const needs = visitNeeds({ ...s, soapRequired: false }, { consentKinds: [] }, rows as EntryLite[], new Date());
    const latestClient = (['intake', 'cupping', 'hot_stone'] as FormKind[]).map((k) => rows.find((r) => r.kind === k)).filter(Boolean) as Row[];
    return {
      enabled: s.enabled,
      access,
      customer: { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), hasPhone: !!(c.phone && OK_PHONE.test(c.phone)) },
      needs,
      flags: reader ? redFlags(latestClient.map((e) => ({ kind: e.kind as FormKind, answers: e.answers as Answers, snapshot: e.snapshot as ResolvedTemplate })), ['cupping', 'hot_stone'], lang) : [],
      entries: rows.map((r) => ({
        id: r.id, kind: r.kind, signedAt: r.signedAt, signerRole: r.signerRole,
        signedName: reader ? r.signedName : null,
        staffName: r.staffId ? staffName.get(r.staffId) ?? null : null,
        title: (r.snapshot as Row)?.title ?? null,
        addenda: Array.isArray(r.addenda) ? r.addenda.length : 0,
        visit: r.appointmentId || r.walkInId ? true : false,
      })),
    };
  }

  /** The salon's newest forms (owner / manager). */
  async recent(user: AuthenticatedUser, q: { kind?: string }) {
    if (accessOf(user) !== 'full') throw new ForbiddenException('Owner or manager only');
    const tenantId = this.tenantId(user);
    const rows: Row[] = await this.db.clientFormEntry.findMany({
      where: { tenantId, ...(isFormKind(q.kind) ? { kind: q.kind } : {}) },
      orderBy: { signedAt: 'desc' },
      take: 60,
      select: { id: true, kind: true, signedAt: true, signedName: true, customerId: true, staffId: true, signerRole: true },
    });
    const cids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    const sids = [...new Set(rows.map((r) => r.staffId).filter(Boolean))];
    const [cs, ss] = await Promise.all([
      cids.length ? this.db.customer.findMany({ where: { tenantId, id: { in: cids } }, select: { id: true, firstName: true, lastName: true } }) : [],
      sids.length ? this.db.staffMember.findMany({ where: { tenantId, id: { in: sids } }, select: { id: true, firstName: true, lastName: true } }) : [],
    ]);
    const nm = (x: Row) => [x.firstName, x.lastName].filter(Boolean).join(' ');
    const cn = new Map((cs as Row[]).map((x) => [x.id, nm(x)]));
    const sn = new Map((ss as Row[]).map((x) => [x.id, nm(x)]));
    return rows.map((r) => ({
      id: r.id, kind: r.kind, signedAt: r.signedAt, signerRole: r.signerRole, customerId: r.customerId ?? null,
      customerName: (r.customerId && cn.get(r.customerId)) || (r.signerRole === 'client' ? r.signedName : null) || null,
      staffName: r.staffId ? sn.get(r.staffId) ?? null : null,
    }));
  }

  /** One signed form, in full. Reading it is audited. */
  async entry(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const access = accessOf(user);
    if (access === 'desk') throw new ForbiddenException('The front desk sees whether a form is signed, not what is in it');
    const e: Row | null = await this.db.clientFormEntry.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException('Form not found');
    if (access === 'tech') {
      const me = await this.staffOf(tenantId, user);
      const mine = !!me && (e.staffId === me.id || (e.customerId ? await this.served(tenantId, me.id, e.customerId) : await this.visitHas(tenantId, e, me.id)));
      if (!mine) throw new ForbiddenException('Not your client');
    }
    const [c, s] = await Promise.all([
      e.customerId ? this.db.customer.findFirst({ where: { id: e.customerId, tenantId }, select: { firstName: true, lastName: true } }) : null,
      e.staffId ? this.db.staffMember.findFirst({ where: { id: e.staffId, tenantId }, select: { firstName: true, lastName: true } }) : null,
    ]);
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }).catch(() => null);
    await this.audit.log({ tenantId, userId: user.userId, action: 'client_form.viewed', resourceType: 'client_form', resourceId: id, metadata: { kind: e.kind } });
    const nm = (x: Row | null) => (x ? [x.firstName, x.lastName].filter(Boolean).join(' ') : null);
    return {
      id: e.id, kind: e.kind, signedAt: e.signedAt, signerRole: e.signerRole, signedName: e.signedName,
      signatureData: e.signatureData ?? null, answers: e.answers ?? {}, snapshot: e.snapshot ?? null,
      addenda: Array.isArray(e.addenda) ? e.addenda : [], source: e.source,
      customerName: nm(c), staffName: nm(s), salonName: tenant?.name ?? '',
      canAmend: access === 'full' || (access === 'tech' && e.signerRole === 'staff'),
    };
  }

  private async visitHas(tenantId: string, e: Row, staffId: string): Promise<boolean> {
    if (!e.appointmentId && !e.walkInId) return false;
    try {
      const v = await this.loadVisit(tenantId, { appointmentId: e.appointmentId, walkInId: e.walkInId });
      return v.staffIds.includes(staffId);
    } catch { return false; }
  }

  /** A dated correction under a signed form — the form itself never changes. */
  async addendum(user: AuthenticatedUser, id: string, textRaw: unknown) {
    const tenantId = this.tenantId(user);
    const access = accessOf(user);
    const text = typeof textRaw === 'string' ? textRaw.trim().slice(0, 1000) : '';
    if (!text) throw new BadRequestException('Write the correction');
    const e: Row | null = await this.db.clientFormEntry.findFirst({ where: { id, tenantId }, select: { id: true, staffId: true, signerRole: true, addenda: true, kind: true } });
    if (!e) throw new NotFoundException('Form not found');
    const me = await this.staffOf(tenantId, user);
    const ok = access === 'full' || (access === 'tech' && e.signerRole === 'staff' && !!me && e.staffId === me.id);
    if (!ok) throw new ForbiddenException('Only the owner, a manager or the note\'s author can add to it');
    const list = Array.isArray(e.addenda) ? e.addenda : [];
    const item = { at: new Date().toISOString(), userId: user.userId, by: me?.name ?? user.email ?? '', text };
    await this.db.clientFormEntry.updateMany({ where: { id, tenantId }, data: { addenda: [...list, item] } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'client_form.addendum', resourceType: 'client_form', resourceId: id, metadata: { kind: e.kind } });
    return { ok: true, addenda: [...list, item] };
  }

  // ---------------------------------------------------------------- links

  private async newLink(tenantId: string, d: { customerId: string | null; appointmentId: string | null; walkInId: string | null; kinds: FormKind[]; lang?: FormLang | null }): Promise<Row> {
    const token = randomBytes(18).toString('base64url');
    return this.db.clientFormLink.create({
      data: {
        tenantId, token, customerId: d.customerId, appointmentId: d.appointmentId, walkInId: d.walkInId,
        kinds: d.kinds, lang: d.lang ?? null, expiresAt: new Date(Date.now() + LINK_DAYS * 86400_000),
      },
    });
  }

  private linkUrl(token: string): string { return `${publicWebBase()}/sign/${token}`; }

  /**
   * A link for the client to sign — on the salon's iPad ("sign here") or by
   * text. Asks for what the visit is missing unless the desk picked forms.
   */
  async createLink(user: AuthenticatedUser, dto: { appointmentId?: string; walkInId?: string; customerId?: string; kinds?: string[]; send?: boolean; lang?: string }) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    if (!s.enabled) throw new BadRequestException('Forms are switched off for this salon');
    const access = accessOf(user);
    const me = await this.staffOf(tenantId, user);
    let customerId: string | null = null, appointmentId: string | null = null, walkInId: string | null = null;
    let phone: string | null = null, name = '';
    let missing: FormKind[] = [];
    if (dto.appointmentId || dto.walkInId) {
      const v = await this.loadVisit(tenantId, dto);
      if (access === 'tech' && !(me && v.staffIds.includes(me.id))) throw new ForbiddenException('Not your client');
      ({ customerId, appointmentId, walkInId, phone } = v);
      name = v.name;
      const entries = await this.entriesFor(tenantId, v);
      missing = missingClientKinds(visitNeeds(s, { appointmentId, walkInId, consentKinds: consentKindsFor(s, v.services) }, entries as EntryLite[], new Date()));
    } else if (dto.customerId) {
      const c = await this.db.customer.findFirst({ where: { id: dto.customerId, tenantId }, select: { id: true, firstName: true, lastName: true, phone: true } });
      if (!c) throw new NotFoundException('Client not found');
      if (access === 'tech' && !(me && (await this.served(tenantId, me.id, c.id)))) throw new ForbiddenException('Not your client');
      customerId = c.id; phone = c.phone ?? null; name = [c.firstName, c.lastName].filter(Boolean).join(' ');
      const rows = await this.db.clientFormEntry.findMany({ where: { tenantId, customerId: c.id }, select: { id: true, kind: true, signedAt: true, appointmentId: true, walkInId: true } });
      missing = missingClientKinds(visitNeeds({ ...s, soapRequired: false }, { consentKinds: [] }, rows as EntryLite[], new Date()));
    } else {
      throw new BadRequestException('A booking, a ticket or a client is required');
    }
    const picked = Array.isArray(dto.kinds) ? dto.kinds.filter((k): k is FormKind => (CLIENT_KINDS as string[]).includes(k)) : [];
    const kinds = picked.length ? [...new Set(picked)] : missing.length ? missing : ['intake' as FormKind];
    const lang = dto.lang === 'vi' || dto.lang === 'en' ? dto.lang : null;
    const link = await this.newLink(tenantId, { customerId, appointmentId, walkInId, kinds, lang });
    let sentTo: string | null = null;
    if (dto.send) {
      if (!phone || !OK_PHONE.test(phone)) throw new BadRequestException('This client has no phone number to text');
      await this.sendSms(tenantId, link, phone, name);
      sentTo = phone.replace(/\d(?=\d{3})/g, '•');
    }
    await this.audit.log({ tenantId, userId: user.userId, action: dto.send ? 'client_form.link_sent' : 'client_form.link_created', resourceType: 'client_form_link', resourceId: link.id, metadata: { kinds } });
    return { token: link.token, url: this.linkUrl(link.token), kinds, sentTo, expiresAt: link.expiresAt };
  }

  private async sendSms(tenantId: string, link: Row, phone: string, name: string) {
    if (!this.notifications) throw new BadRequestException('Text messages are not available');
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, market: true } });
    const vi = this.langOf(link.lang, tenant?.market) === 'vi';
    const first = name ? String(name).split(' ')[0] : '';
    const url = `${this.linkUrl(link.token)}?src=sms`;
    const body = vi
      ? `${tenant?.name ?? ''}: ${first ? `Chào ${first}, ` : ''}vui lòng điền và ký phiếu trước buổi hẹn (1 phút, chỉ cần chạm): ${url}`
      : `${tenant?.name ?? ''}: ${first ? `Hi ${first}, ` : ''}please fill in and sign your forms before your visit (1 min, just tap): ${url} Reply STOP to opt out.`;
    let n: Row | null = null;
    try { n = await (this.settings as unknown as Row | undefined)?.getNotificationSettings?.(tenantId); } catch { n = null; }
    await this.db.clientFormLink.updateMany({ where: { id: link.id, tenantId }, data: { sentAt: new Date(), sentTo: phone } });
    await this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: phone, body: body.trim(), relatedType: 'client_form_link', relatedId: link.id, ...(n?.twilio ? { twilio: n.twilio } : {}) } as never);
  }

  /** For the check-in iPad: a link to sign right there, when the new ticket is missing forms. */
  async kioskLink(tenantId: string, walkInId: string): Promise<{ token: string } | null> {
    const s = await this.getSettings(tenantId);
    if (!s.enabled) return null;
    const v = await this.loadVisit(tenantId, { walkInId });
    const entries = await this.entriesFor(tenantId, v);
    const kinds = missingClientKinds(visitNeeds(s, { appointmentId: v.appointmentId, walkInId: v.walkInId, consentKinds: consentKindsFor(s, v.services) }, entries as EntryLite[], new Date()));
    if (!kinds.length) return null;
    const link = await this.newLink(tenantId, { customerId: v.customerId, appointmentId: v.appointmentId, walkInId: v.walkInId, kinds });
    return { token: link.token };
  }

  // ---------------------------------------------------------------- SOAP

  async createSoap(user: AuthenticatedUser, dto: { appointmentId?: string; walkInId?: string; answers?: unknown; signatureData?: unknown; signedName?: string; lang?: string }) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    if (!s.enabled) throw new BadRequestException('Forms are switched off for this salon');
    const access = accessOf(user);
    if (access === 'desk') throw new ForbiddenException('The therapist writes the SOAP note');
    const v = await this.loadVisit(tenantId, dto);
    const me = await this.staffOf(tenantId, user);
    if (access === 'tech' && !(me && v.staffIds.includes(me.id))) throw new ForbiddenException('Not your client');
    const tpl = templateFor('soap');
    const { answers, missing } = validateAnswers(tpl, dto.answers);
    if (missing.length) throw new BadRequestException(`Missing: ${missing.join(', ')}`);
    const signatureData = cleanSignature(dto.signatureData);
    if (!signatureData) throw new BadRequestException('Sign the note');
    const lang = this.langOf(dto.lang);
    const signedName = (typeof dto.signedName === 'string' && dto.signedName.trim().slice(0, 120)) || me?.name || user.email || '';
    const e = await this.db.clientFormEntry.create({
      data: {
        tenantId, customerId: v.customerId, kind: 'soap', templateVersion: tpl.version, lang,
        answers, snapshot: resolveTemplate(tpl, lang), signatureData, signedName, signerRole: 'staff',
        staffId: me?.id ?? (v.staffIds[0] ?? null), userId: user.userId,
        appointmentId: v.appointmentId, walkInId: v.walkInId, source: 'staff',
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'client_form.signed', resourceType: 'client_form', resourceId: e.id, metadata: { kind: 'soap' } });
    return { id: e.id, signedAt: e.signedAt };
  }

  /** The client's previous SOAP note, to start this one from. */
  async lastSoap(user: AuthenticatedUser, customerId: string) {
    const tenantId = this.tenantId(user);
    const access = accessOf(user);
    if (access === 'desk') throw new ForbiddenException('The therapist writes the SOAP note');
    if (access === 'tech') {
      const me = await this.staffOf(tenantId, user);
      if (!(me && (await this.served(tenantId, me.id, customerId)))) throw new ForbiddenException('Not your client');
    }
    const e: Row | null = await this.db.clientFormEntry.findFirst({ where: { tenantId, customerId, kind: 'soap' }, orderBy: { signedAt: 'desc' }, select: { id: true, answers: true, signedAt: true } });
    if (!e) return null;
    const { note: _drop, ...answers } = (e.answers ?? {}) as Answers; // the free note is about that day only
    void _drop;
    return { id: e.id, signedAt: e.signedAt, answers };
  }

  // ---------------------------------------------------------------- the public side

  private async linkByToken(token: string): Promise<Row> {
    if (!token || token.length < 16 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new NotFoundException('This link is not valid');
    const l: Row | null = await this.db.clientFormLink.findUnique({ where: { token } });
    if (!l || new Date(l.expiresAt).getTime() < Date.now()) throw new NotFoundException('This link is not valid');
    return l;
  }

  private kindsOf(l: Row): FormKind[] {
    return (Array.isArray(l.kinds) ? l.kinds : []).filter((k: unknown): k is FormKind => (CLIENT_KINDS as string[]).includes(String(k)));
  }

  async publicContext(token: string) {
    const l = await this.linkByToken(token);
    const tenantId: string = l.tenantId;
    const [s, tenant, done] = await Promise.all([
      this.getSettings(tenantId),
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, market: true, branding: true, status: true, deletedAt: true } }),
      this.db.clientFormEntry.findMany({ where: { tenantId, linkId: l.id }, select: { kind: true } }),
    ]);
    if (!tenant || tenant.deletedAt || !s.enabled) throw new NotFoundException('This link is not valid');
    let prefill: Record<string, string> = {};
    if (l.customerId) {
      const c = await this.db.customer.findFirst({ where: { id: l.customerId, tenantId }, select: { firstName: true, lastName: true, phone: true, email: true, birthDate: true } }).catch(() => null);
      if (c) prefill = {
        name: [c.firstName, c.lastName].filter(Boolean).join(' '), phone: c.phone ?? '', email: c.email ?? '',
        birthDate: c.birthDate ? new Date(c.birthDate).toISOString().slice(0, 10) : '',
      };
    } else if (l.walkInId) {
      const w = await this.db.walkIn.findFirst({ where: { id: l.walkInId, tenantId }, select: { customerName: true, phone: true } }).catch(() => null);
      if (w) prefill = { name: w.customerName ?? '', phone: w.phone ?? '' };
    }
    const doneKinds = new Set((done as Row[]).map((d) => d.kind));
    const kinds = this.kindsOf(l);
    const brand = this.settings?.brandingFrom?.(tenant.branding) as Row | undefined;
    return {
      salon: { name: tenant.name, logoUrl: brand?.logoUrl || null },
      lang: this.langOf(l.lang, tenant.market),
      prefill,
      forms: this.resolvedAll(s, kinds).map((f) => ({ ...f, done: doneKinds.has(f.kind) })),
      allDone: kinds.every((k) => doneKinds.has(k)),
    };
  }

  async publicSubmit(token: string, dto: { kind?: string; answers?: unknown; signatureData?: unknown; signedName?: string; lang?: string }, meta: { ip?: string | null; userAgent?: string | null }) {
    const l = await this.linkByToken(token);
    const tenantId: string = l.tenantId;
    const kinds = this.kindsOf(l);
    const kind = dto.kind as FormKind;
    if (!isFormKind(kind) || !kinds.includes(kind)) throw new BadRequestException('This form is not part of the link');
    const s = await this.getSettings(tenantId);
    if (!s.enabled) throw new NotFoundException('This link is not valid');
    const already = await this.db.clientFormEntry.findFirst({ where: { tenantId, linkId: l.id, kind }, select: { id: true } });
    if (already) return { ok: true, id: already.id, already: true };
    const tpl = templateFor(kind, s.extraQuestions, s.intakeStyle);
    const { answers, missing } = validateAnswers(tpl, dto.answers);
    if (missing.length) throw new BadRequestException({ message: 'Please answer every question', missing });
    const signatureData = cleanSignature(dto.signatureData);
    if (!signatureData) throw new BadRequestException('Please sign the form');
    const signedName = (typeof dto.signedName === 'string' && dto.signedName.trim().slice(0, 120)) || (typeof answers.name === 'string' ? answers.name : '');
    if (!signedName) throw new BadRequestException('Please type your name');
    const lang = this.langOf(dto.lang);
    const e = await this.db.clientFormEntry.create({
      data: {
        tenantId, customerId: l.customerId ?? null, kind, templateVersion: tpl.version, lang,
        answers, snapshot: resolveTemplate(tpl, lang), signatureData, signedName, signerRole: 'client',
        appointmentId: l.appointmentId ?? null, walkInId: l.walkInId ?? null, linkId: l.id,
        source: l.sentAt ? 'sms' : 'salon',
        ip: meta.ip ? String(meta.ip).slice(0, 64) : null, userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : null,
      },
    });
    const done: Row[] = await this.db.clientFormEntry.findMany({ where: { tenantId, linkId: l.id }, select: { kind: true } });
    const allDone = kinds.every((k) => done.some((d) => d.kind === k));
    if (allDone) await this.db.clientFormLink.updateMany({ where: { id: l.id, tenantId }, data: { usedAt: new Date() } });
    await this.audit.log({ tenantId, userId: null, action: 'client_form.signed', resourceType: 'client_form', resourceId: e.id, metadata: { kind, via: 'link' } });
    if (l.walkInId) liveEvents.emit(tenantId, 'walkins', l.walkInId);
    return { ok: true, id: e.id, allDone };
  }

  // ---------------------------------------------------------------- texts before a visit

  /**
   * Texts the forms link to clients booked in the next few hours who still
   * have something to sign — only for salons that switched it on, at most once
   * per booking (the link's sentAt is the proof).
   */
  async processDue(now = new Date()): Promise<{ sent: number }> {
    if (!this.notifications) return { sent: 0 };
    const rows: Row[] = await this.db.setting.findMany({ where: { key: CLIENT_FORMS_KEY }, select: { tenantId: true } }).catch(() => [] as Row[]);
    let sent = 0;
    for (const r of rows) {
      const tenantId: string = r.tenantId;
      try {
        const s = await this.getSettings(tenantId);
        if (!s.enabled || !s.autoSend.enabled) continue;
        const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { status: true, deletedAt: true } });
        if (!t || t.deletedAt || (t.status && t.status !== 'ACTIVE')) continue;
        const appts: Row[] = await this.db.appointment.findMany({
          where: { tenantId, startTime: { gt: now, lte: new Date(now.getTime() + s.autoSend.hoursBefore * 3600_000) }, status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'] } },
          select: { id: true },
          orderBy: { startTime: 'asc' },
          take: 100,
        });
        for (const a of appts) {
          if (sent >= 200) return { sent };
          const before = await this.db.clientFormLink.findFirst({ where: { tenantId, appointmentId: a.id, sentAt: { not: null } }, select: { id: true } });
          if (before) continue;
          const v = await this.loadVisit(tenantId, { appointmentId: a.id });
          if (!v.phone || !OK_PHONE.test(v.phone)) continue;
          const entries = await this.entriesFor(tenantId, v);
          const kinds = missingClientKinds(visitNeeds(s, { appointmentId: v.appointmentId, walkInId: v.walkInId, consentKinds: consentKindsFor(s, v.services) }, entries as EntryLite[], now));
          if (!kinds.length) continue;
          const link = await this.newLink(tenantId, { customerId: v.customerId, appointmentId: v.appointmentId, walkInId: v.walkInId, kinds });
          await this.sendSms(tenantId, link, v.phone, v.name);
          sent += 1;
        }
      } catch (e) {
        this.log.warn(`Forms texts for ${tenantId} failed: ${(e as Error).message}`);
      }
    }
    return { sent };
  }
}

export type { ConsentKind };
