/**
 * Massage paperwork: one salon never reads, signs into or texts from another
 * salon's forms, and inside a salon each role sees only its share.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' },
    StaffRole: actual.StaffRole ?? { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
    NotificationChannel: actual.NotificationChannel ?? { SMS: 'SMS', EMAIL: 'EMAIL' },
  };
});
import { ClientFormsService, accessOf } from './client-forms.service';
import { TEMPLATES } from './form-templates';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
      if ('gt' in cond || 'lte' in cond) return (!cond.gt || new Date(v) > cond.gt) && (!cond.lte || new Date(v) <= cond.lte);
      return false;
    }
    return v === cond;
  });
}

function table(rows: Row[]) {
  return {
    rows,
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row) => {
      if (where.tenantId_key) return rows.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key) ?? null;
      return rows.find((r) => matches(r, where)) ?? null;
    },
    findMany: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: Row) => { const r = { id: `id${rows.length + 1}-${Math.random().toString(36).slice(2, 6)}`, signedAt: new Date(), createdAt: new Date(), addenda: [], ...data }; rows.push(r); return r; },
    updateMany: async ({ where, data }: Row) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n += 1; } return { count: n }; },
    upsert: async ({ where, create, update }: Row) => {
      const r = rows.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key);
      if (r) Object.assign(r, update); else rows.push({ ...create });
      return {};
    },
  };
}

const owner = (tenantId: string) => ({ userId: `u-owner-${tenantId}`, email: 'o@x', role: 'SALON_ADMIN', tenantId }) as never;
const desk = (tenantId: string) => ({ userId: 'u-desk', email: 'd@x', role: 'STAFF', staffRole: 'RECEPTIONIST', tenantId }) as never;
const tech = (userId: string, tenantId = 'ta') => ({ userId, email: 't@x', role: 'STAFF', staffRole: 'TECHNICIAN', tenantId }) as never;

const SIG = `data:image/png;base64,${'A'.repeat(400)}`;
const consentAnswers = () => {
  const a: Row = {};
  for (const f of TEMPLATES.cupping.fields) if (f.type === 'yesno') a[f.id] = f.id === 'c_thinners'; else if (f.type === 'ack') a[f.id] = true;
  return a;
};

function build() {
  const db: Row = {
    tenant: table([
      { id: 'ta', name: 'Zen Massage', market: 'US', businessType: 'SALON', branding: {}, status: 'ACTIVE', deletedAt: null },
      { id: 'tb', name: 'Other Spa', market: 'US', businessType: 'SALON', branding: {}, status: 'ACTIVE', deletedAt: null },
    ]),
    setting: table([
      { tenantId: 'ta', key: 'industry', value: 'MASSAGE' },
      { tenantId: 'tb', key: 'industry', value: 'MASSAGE' },
    ]),
    customer: table([
      { id: 'ca', tenantId: 'ta', firstName: 'Anna', lastName: 'Lee', phone: '+15125550101', email: null, birthDate: null },
      { id: 'cb', tenantId: 'tb', firstName: 'Bob', lastName: null, phone: '+15125550202', email: null, birthDate: null },
    ]),
    staffMember: table([
      { id: 'sa1', tenantId: 'ta', userId: 'u-tech-1', firstName: 'Mai', lastName: null },
      { id: 'sa2', tenantId: 'ta', userId: 'u-tech-2', firstName: 'Linh', lastName: null },
    ]),
    service: table([
      { id: 'sv-cup', tenantId: 'ta', name: '60 min Cupping', categoryId: null, isActive: true },
      { id: 'sv-b', tenantId: 'tb', name: 'Cupping', categoryId: null, isActive: true },
    ]),
    appointment: table([
      { id: 'ap-a', tenantId: 'ta', customerId: 'ca', assignedStaffId: 'sa1', serviceId: 'sv-cup', addons: [], status: 'CONFIRMED', startTime: new Date(Date.now() + 3 * 3600_000), customer: null },
      { id: 'ap-b', tenantId: 'tb', customerId: 'cb', assignedStaffId: null, serviceId: 'sv-b', addons: [], status: 'CONFIRMED', startTime: new Date(Date.now() + 3 * 3600_000), customer: null },
    ]),
    walkIn: table([]),
    clientFormEntry: table([]),
    clientFormLink: table([]),
  };
  // The fake has no joins: hand the customer to the booking the way prisma's select would.
  for (const a of db.appointment.rows) a.customer = db.customer.rows.find((c: Row) => c.id === a.customerId) ?? null;
  const audits: Row[] = [];
  const texts: Row[] = [];
  const svc = new ClientFormsService(
    db as never,
    { log: async (x: Row) => { audits.push(x); } } as never,
    { brandingFrom: () => ({}), getNotificationSettings: async () => ({}) } as never,
    { send: async (x: Row) => { texts.push(x); return {}; } } as never,
  );
  return { svc, db, audits, texts };
}

describe('who is who', () => {
  it('owner and manager read everything, a technician their clients, the desk only the status', () => {
    expect(accessOf(owner('ta'))).toBe('full');
    expect(accessOf({ ...(tech('x') as Row), staffRole: 'MANAGER' } as never)).toBe('full');
    expect(accessOf(tech('x'))).toBe('tech');
    expect(accessOf(desk('ta'))).toBe('desk');
  });
});

describe('a booked cupping visit', () => {
  it('needs the intake and the cupping consent before, the SOAP note after', async () => {
    const { svc } = build();
    const v = await svc.visitStatus(owner('ta'), { appointmentId: 'ap-a' }) as Row;
    expect(v.enabled).toBe(true);
    expect(v.consentKinds).toEqual(['cupping']);
    expect(v.needs.map((n: Row) => `${n.kind}:${n.status}`)).toEqual(['intake:missing', 'cupping:missing', 'soap:missing']);
  });

  it('another salon\'s booking is not found — never read', async () => {
    const { svc } = build();
    await expect(svc.visitStatus(owner('ta'), { appointmentId: 'ap-b' })).rejects.toThrow(/not found/i);
    await expect(svc.createLink(owner('ta'), { appointmentId: 'ap-b' })).rejects.toThrow(/not found/i);
    await expect(svc.customerForms(owner('ta'), 'cb')).rejects.toThrow(/not found/i);
  });

  it('a technician sees the cautions only on their own client', async () => {
    const { svc } = build();
    await expect(svc.visitStatus(tech('u-tech-2'), { appointmentId: 'ap-a' })).rejects.toThrow(/Not your client/);
    const mine = await svc.visitStatus(tech('u-tech-1'), { appointmentId: 'ap-a' }) as Row;
    expect(mine.canSoap).toBe(true);
  });
});

describe('signing through a link', () => {
  async function signed() {
    const b = build();
    const link = await b.svc.createLink(owner('ta'), { appointmentId: 'ap-a' });
    expect(link.kinds).toEqual(['intake', 'cupping']);
    const r = await b.svc.publicSubmit(link.token, { kind: 'cupping', answers: consentAnswers(), signatureData: SIG, signedName: 'Anna Lee', lang: 'en' }, { ip: '1.2.3.4', userAgent: 'ipad' });
    return { ...b, link, r };
  }

  it('files the signature under the link\'s own salon, client and visit', async () => {
    const { db, r, audits } = await signed();
    const e = db.clientFormEntry.rows.find((x: Row) => x.id === r.id);
    expect(e).toEqual(expect.objectContaining({ tenantId: 'ta', customerId: 'ca', appointmentId: 'ap-a', kind: 'cupping', signerRole: 'client', signedName: 'Anna Lee' }));
    expect(e.snapshot.title).toBe('Cupping consent & release');
    expect(audits.some((a) => a.action === 'client_form.signed' && a.tenantId === 'ta')).toBe(true);
  });

  it('the therapist now sees the client\'s "yes" before starting; the desk does not', async () => {
    const { svc } = await signed();
    const t = await svc.visitStatus(tech('u-tech-1'), { appointmentId: 'ap-a' }) as Row;
    expect(t.flags.map((f: Row) => f.fieldId)).toEqual(['c_thinners']);
    expect(t.needs.find((n: Row) => n.kind === 'cupping').status).toBe('signed');
    const d = await svc.visitStatus(desk('ta'), { appointmentId: 'ap-a' }) as Row;
    expect(d.needs.find((n: Row) => n.kind === 'cupping').status).toBe('signed');
    expect(d.flags).toEqual([]);
    expect(d.notes).toEqual([]);
  });

  it('refuses an unanswered form, a form the link did not ask for, and a second signature', async () => {
    const { svc, link } = await signed();
    await expect(svc.publicSubmit(link.token, { kind: 'intake', answers: {}, signatureData: SIG, signedName: 'A' }, {})).rejects.toThrow();
    await expect(svc.publicSubmit(link.token, { kind: 'hot_stone', answers: {}, signatureData: SIG }, {})).rejects.toThrow(/not part of the link/);
    const again = await svc.publicSubmit(link.token, { kind: 'cupping', answers: consentAnswers(), signatureData: SIG, signedName: 'Anna' }, {});
    expect(again.already).toBe(true);
    await expect(svc.publicContext('not-a-real-token-at-all')).rejects.toThrow(/not valid/);
  });

  it('only owner, manager and the client\'s technician open a signed form; the desk never does', async () => {
    const { svc, r, audits } = await signed();
    await expect(svc.entry(desk('ta'), r.id)).rejects.toThrow(/front desk/);
    await expect(svc.entry(tech('u-tech-2'), r.id)).rejects.toThrow(/Not your client/);
    await expect(svc.entry(owner('tb'), r.id)).rejects.toThrow(/not found/i);
    const e = await svc.entry(tech('u-tech-1'), r.id);
    expect(e.signatureData).toBe(SIG);
    expect(audits.some((a) => a.action === 'client_form.viewed' && a.resourceId === r.id)).toBe(true);
  });

  it('a correction is added underneath, never written over the signed answers', async () => {
    const { svc, db, r } = await signed();
    const before = JSON.stringify(db.clientFormEntry.rows[0].answers);
    await expect(svc.addendum(tech('u-tech-1'), r.id, 'x')).rejects.toThrow(/author/);
    const out = await svc.addendum(owner('ta'), r.id, 'Client now off blood thinners');
    expect(out.addenda).toHaveLength(1);
    expect(JSON.stringify(db.clientFormEntry.rows[0].answers)).toBe(before);
  });
});

describe('the SOAP note', () => {
  it('is written by the client\'s own technician and kept under this salon', async () => {
    const { svc, db } = build();
    const answers = { techniques: ['cupping', 'swedish'], s_pain: 6, a_pain: 2, note: 'tight traps' };
    await expect(svc.createSoap(tech('u-tech-2'), { appointmentId: 'ap-a', answers, signatureData: SIG })).rejects.toThrow(/Not your client/);
    await expect(svc.createSoap(desk('ta'), { appointmentId: 'ap-a', answers, signatureData: SIG })).rejects.toThrow(/therapist/);
    await expect(svc.createSoap(tech('u-tech-1'), { appointmentId: 'ap-a', answers: {}, signatureData: SIG })).rejects.toThrow(/Missing/);
    const n = await svc.createSoap(tech('u-tech-1'), { appointmentId: 'ap-a', answers, signatureData: SIG });
    const row = db.clientFormEntry.rows.find((x: Row) => x.id === n.id);
    expect(row).toEqual(expect.objectContaining({ tenantId: 'ta', kind: 'soap', staffId: 'sa1', signerRole: 'staff', signedName: 'Mai' }));
    const last = await svc.lastSoap(tech('u-tech-1'), 'ca') as Row;
    expect(last.answers.techniques).toEqual(['cupping', 'swedish']);
    expect(last.answers.note).toBeUndefined();
  });
});

describe('texting the link before a visit', () => {
  it('only salons that turned it on, once per booking, each from its own salon', async () => {
    const { svc, db, texts } = build();
    db.setting.rows.push({ tenantId: 'ta', key: 'client_forms', value: { autoSend: { enabled: true, hoursBefore: 24 } } });
    db.setting.rows.push({ tenantId: 'tb', key: 'client_forms', value: { autoSend: { enabled: false } } });
    expect((await svc.processDue()).sent).toBe(1);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toEqual(expect.objectContaining({ tenantId: 'ta', recipient: '+15125550101' }));
    expect(texts[0].body).toMatch(/\/sign\//);
    expect((await svc.processDue()).sent).toBe(0);
  });

  it('a nail salon never gets the forms at all', async () => {
    const { svc, db } = build();
    db.setting.rows[0].value = 'NAIL';
    expect(await svc.visitStatus(owner('ta'), { appointmentId: 'ap-a' })).toEqual({ enabled: false });
  });
});
