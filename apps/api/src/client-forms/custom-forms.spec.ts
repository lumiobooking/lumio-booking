/**
 * A salon's own forms: built from a starter or blank, in the salon's own
 * language, versioned when the questions change, and never reachable from
 * another salon.
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
import { ClientFormsService } from './client-forms.service';
import { redFlags, validateAnswers, type ResolvedTemplate } from './form-templates';
import { CUSTOM_LIMITS, STARTERS, customApplies, customTemplate, sanitizeCustomForm, starterForm, starterList, type CustomForm } from './custom-forms';
import { defaultFormSettings, visitNeeds } from './form-settings';

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


const yesAll = (cf: CustomForm) => {
  const a: Row = {};
  for (const f of cf.fields) {
    if (f.type === 'yesno') a[f.id] = false;
    else if (f.type === 'ack') a[f.id] = true;
    else if (f.type === 'choice') a[f.id] = f.options![0].id;
    else if (f.type === 'multi') a[f.id] = [f.options![0].id];
    else if (f.type === 'text') a[f.id] = 'x';
    else if (f.type === 'scale') a[f.id] = f.min ?? 0;
  }
  return a;
};

describe('the starters', () => {
  it.each(STARTERS.map((s) => s.key))('%s is complete in both languages', (key) => {
    for (const lang of ['vi', 'en'] as const) {
      const f = starterForm(key, 'c_test0001', lang);
      expect(f.starter).toBe(key);
      expect(f.lang).toBe(lang);
      expect(f.fields.length).toBe(STARTERS.find((s) => s.key === key)!.fields.length); // nothing dropped
      for (const x of f.fields) {
        expect(x.label.trim()).not.toBe('');
        if (x.type === 'choice' || x.type === 'multi') expect(x.options!.length).toBeGreaterThan(0);
      }
      expect(new Set(f.fields.map((x) => x.id)).size).toBe(f.fields.length);
    }
  });

  it('a technician\'s record lasts one visit; a client form a year', () => {
    expect(starterForm('lash_record', 'c_test0001', 'en')).toEqual(expect.objectContaining({ signer: 'staff', validMonths: 0 }));
    expect(starterForm('lash_consent', 'c_test0001', 'en')).toEqual(expect.objectContaining({ signer: 'client', validMonths: 12 }));
  });

  it('the trade\'s own starters come first, in the salon\'s language', () => {
    const lash = starterList('vi', 'LASH');
    expect(lash[0].suggested).toBe(true);
    expect(lash.filter((s) => s.suggested).map((s) => s.key)).toEqual(expect.arrayContaining(['lash_consent', 'lash_record']));
    expect(lash.find((s) => s.key === 'lash_consent')!.name).toMatch(/nối mi/);
  });
});

describe('cleaning what the owner sends', () => {
  const base = starterForm(null, 'c_test0001', 'en');

  it('drops unusable questions and gives every question its own id', () => {
    const f = sanitizeCustomForm({
      name: 'Mine',
      fields: [
        { id: 'a', type: 'text', label: 'One' },
        { id: 'a', type: 'text', label: 'Two' },             // duplicate id → renamed
        { id: 'b__note', type: 'yesno', label: 'Three' },    // reserved suffix → renamed
        { type: 'choice', label: 'No options', options: [] }, // dropped
        { type: 'evil', label: 'Bad type' },                 // dropped
        { type: 'text', label: '   ' },                      // dropped
        { type: 'scale', label: 'Pain', min: 9, max: 3 },     // min < max enforced
      ],
    }, base, base.kind, 'en');
    expect(f.fields.map((x) => x.label)).toEqual(['One', 'Two', 'Three', 'Pain']);
    expect(new Set(f.fields.map((x) => x.id)).size).toBe(4);
    expect(f.fields.some((x) => x.id.endsWith('__note'))).toBe(false);
    const pain = f.fields.find((x) => x.type === 'scale')!;
    expect(pain.min!).toBeLessThan(pain.max!);
  });

  it('caps the size of a form', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ type: 'text', label: `Q${i}` }));
    expect(sanitizeCustomForm({ fields: many }, base, base.kind, 'en').fields).toHaveLength(CUSTOM_LIMITS.fields);
  });

  it('keeps its language and kind, and bumps the version only when the questions change', () => {
    const v1 = starterForm('waxing', 'c_test0002', 'vi');
    const moved = sanitizeCustomForm({ ...v1, appliesTo: { all: false, serviceIds: ['sv1'], categoryIds: [] }, lang: 'en', kind: 'c_other00' }, v1, v1.kind, 'en');
    expect(moved.version).toBe(1);
    expect(moved.lang).toBe('vi');
    expect(moved.kind).toBe('c_test0002');
    const edited = sanitizeCustomForm({ ...moved, fields: [...moved.fields, { type: 'yesno', label: 'Mới tẩy da chết?', flag: true }] }, moved, moved.kind, 'vi');
    expect(edited.version).toBe(2);
  });
});

describe('how a form of the salon\'s own behaves', () => {
  const lash = starterForm('lash_consent', 'c_lash0001', 'en');
  const map = starterForm('lash_record', 'c_lmap0001', 'en');

  it('signs and validates like a built-in form', () => {
    const tpl = customTemplate(lash);
    expect(validateAnswers(tpl, {}).missing.length).toBeGreaterThan(0);
    expect(validateAnswers(tpl, yesAll(lash)).missing).toEqual([]);
  });

  it('a flagged "yes" is a caution before the visit; a technician\'s record never is', () => {
    const tpl = customTemplate(lash);
    const snap = { ...tpl, lang: 'en', title: lash.name, fields: tpl.fields.map((f) => ({ ...f, label: f.label.en, options: f.options?.map((o) => ({ id: o.id, label: o.label.en })) })), areas: [] } as unknown as ResolvedTemplate;
    const answers = { ...yesAll(lash), glue_allergy: true, contacts: true };
    const flags = redFlags([{ kind: lash.kind, answers, snapshot: snap }], [], 'en');
    expect(flags.map((f) => f.fieldId)).toEqual(['glue_allergy']); // contacts is not flagged
    const staffSnap = { ...snap, signer: 'staff' } as ResolvedTemplate;
    expect(redFlags([{ kind: map.kind, answers: { reaction: true }, snapshot: staffSnap }], [], 'en')).toEqual([]);
  });

  it('applies to every visit, or only to the services it is tied to', () => {
    const tied = { ...lash, appliesTo: { all: false, serviceIds: ['sv-lash'], categoryIds: ['cat-brow'] } };
    expect(customApplies(lash, [])).toBe(true);
    expect(customApplies(tied, [{ id: 'sv-nail' }])).toBe(false);
    expect(customApplies(tied, [{ id: 'sv-lash' }])).toBe(true);
    expect(customApplies(tied, [{ id: 'x', categoryId: 'cat-brow' }])).toBe(true);
    expect(customApplies({ ...lash, active: false }, [])).toBe(false);
  });

  it('a visit asks for the client form before and the technician\'s record after', () => {
    const s = { ...defaultFormSettings('LASH'), enabled: true, intakeRequired: false, customForms: [lash, map] };
    const needs = visitNeeds(s, { consentKinds: [], services: [] }, [], new Date());
    expect(needs.map((n) => `${n.kind}:${n.when}:${n.title}`)).toEqual([`c_lash0001:before:${lash.name}`, `c_lmap0001:after:${map.name}`]);
    expect(visitNeeds(s, { consentKinds: [], staffNotes: false }, [], new Date()).map((n) => n.kind)).toEqual(['c_lash0001']);
  });
});

describe('through the service', () => {
  function lashSalon() {
    const b = build();
    b.db.setting.rows[0].value = 'LASH';
    b.db.setting.rows.push({ tenantId: 'ta', key: 'client_forms', value: { enabled: true, intakeRequired: false } });
    return b;
  }

  it('the owner makes forms in the salon\'s own language; staff cannot', async () => {
    const { svc, db, audits } = lashSalon();
    db.tenant.rows[0].market = 'VN';
    const f = await svc.createCustomForm(owner('ta'), { starter: 'lash_consent' });
    expect(f.lang).toBe('vi');
    expect(f.name).toMatch(/nối mi/);
    await expect(svc.createCustomForm(tech('u-tech-1'), {})).rejects.toThrow(/owner or a manager/);
    await expect(svc.createCustomForm(desk('ta'), {})).rejects.toThrow(/owner or a manager/);
    expect(audits.some((a) => a.action === 'client_forms.custom_created' && a.tenantId === 'ta')).toBe(true);
    const view = await svc.customFormsView(owner('ta'));
    expect(view.forms.map((x) => x.kind)).toEqual([f.kind]);
  });

  it('another salon can neither see, edit nor delete it', async () => {
    const { svc } = lashSalon();
    const f = await svc.createCustomForm(owner('ta'), { starter: 'lash_consent' });
    expect((await svc.customFormsView(owner('tb'))).forms).toEqual([]);
    await expect(svc.updateCustomForm(owner('tb'), f.kind, { name: 'Hijack' })).rejects.toThrow(/not found/i);
    await expect(svc.deleteCustomForm(owner('tb'), f.kind)).rejects.toThrow(/not found/i);
    // …nor ask for it in a signing link of its own.
    const link = await svc.createLink(owner('tb'), { appointmentId: 'ap-b', kinds: [f.kind] });
    expect(link.kinds).not.toContain(f.kind);
  });

  it('a settings save cannot rewrite the forms behind their version', async () => {
    const { svc } = lashSalon();
    const f = await svc.createCustomForm(owner('ta'), { starter: 'lash_consent' });
    await svc.updateSettings(owner('ta'), { customForms: [{ ...f, name: 'Changed quietly', version: 1 }] });
    expect((await svc.customFormsView(owner('ta'))).forms[0].name).toBe(f.name);
  });

  it('a client signs it by link and it is filed with its own snapshot', async () => {
    const { svc, db } = lashSalon();
    const f = await svc.createCustomForm(owner('ta'), { starter: 'lash_consent' });
    const v = await svc.visitStatus(owner('ta'), { appointmentId: 'ap-a' }) as Row;
    expect(v.needs.map((n: Row) => n.kind)).toContain(f.kind);
    const link = await svc.createLink(owner('ta'), { appointmentId: 'ap-a' });
    expect(link.kinds).toContain(f.kind);
    const ctx = await svc.publicContext(link.token);
    const pair = ctx.forms.find((x) => x.kind === f.kind)!;
    expect(pair.single).toBe(true);
    const r = await svc.publicSubmit(link.token, { kind: f.kind, answers: { ...yesAll(f), glue_allergy: true }, signatureData: SIG, signedName: 'Anna', lang: 'vi' }, {});
    const e = db.clientFormEntry.rows.find((x: Row) => x.id === r.id);
    expect(e).toEqual(expect.objectContaining({ tenantId: 'ta', kind: f.kind, lang: 'en', templateVersion: 1 }));
    expect(e.snapshot.title).toBe(f.name);
    const after = await svc.visitStatus(tech('u-tech-1'), { appointmentId: 'ap-a' }) as Row;
    expect(after.flags.map((x: Row) => x.fieldId)).toContain('glue_allergy');
    // Editing the form afterwards does not touch what was signed.
    await svc.updateCustomForm(owner('ta'), f.kind, { ...f, fields: f.fields.slice(0, 3) });
    expect(db.clientFormEntry.rows.find((x: Row) => x.id === r.id).snapshot.fields.length).toBe(f.fields.length);
  });

  it('the technician writes the salon\'s own record for their own visit only', async () => {
    const { svc, db } = lashSalon();
    const f = await svc.createCustomForm(owner('ta'), { starter: 'lash_record' });
    const answers = yesAll(f);
    const v = await svc.visitStatus(tech('u-tech-1'), { appointmentId: 'ap-a' }) as Row;
    expect(v.staffForms).toEqual([{ kind: f.kind, title: f.name, entryId: null, canWrite: true }]);
    await expect(svc.createStaffNote(tech('u-tech-2'), f.kind, { appointmentId: 'ap-a', answers, signatureData: SIG })).rejects.toThrow(/Not your client/);
    await expect(svc.createStaffNote(desk('ta'), f.kind, { appointmentId: 'ap-a', answers, signatureData: SIG })).rejects.toThrow(/therapist/);
    await expect(svc.createStaffNote(owner('tb'), f.kind, { appointmentId: 'ap-b', answers, signatureData: SIG })).rejects.toThrow(/not found/i);
    const n = await svc.createStaffNote(tech('u-tech-1'), f.kind, { appointmentId: 'ap-a', answers, signatureData: SIG });
    expect(db.clientFormEntry.rows.find((x: Row) => x.id === n.id)).toEqual(expect.objectContaining({ tenantId: 'ta', kind: f.kind, signerRole: 'staff', staffId: 'sa1' }));
    const last = await svc.lastSoap(tech('u-tech-1'), 'ca', f.kind) as Row;
    expect(last.answers.set).toBe(answers.set);
  });
});
