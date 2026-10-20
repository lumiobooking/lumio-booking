/**
 * One brain, one memory, one log per salon — never another salon's.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' },
    StaffRole: actual.StaffRole ?? { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
  };
});
import { AiBrainService } from './ai-brain.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond === null) return v == null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('not' in cond) return v !== cond.not;
      if ('gte' in cond) return new Date(v) >= cond.gte;
      if ('gt' in cond) return Number(v) > cond.gt;
      if ('contains' in cond) return String(v ?? '').includes(cond.contains);
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
    count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: Row) => { const r = { id: `id${rows.length + 1}`, createdAt: new Date(), startedAt: new Date(), ...data }; rows.push(r); return r; },
    updateMany: async ({ where, data }: Row) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n += 1; } return { count: n }; },
    deleteMany: async ({ where }: Row) => { const keep = rows.filter((r) => !matches(r, where)); const n = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count: n }; },
    upsert: async ({ where, create, update }: Row) => {
      const r = rows.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key);
      if (r) Object.assign(r, update); else rows.push({ ...create });
      return {};
    },
  };
}

const owner = (tenantId: string) => ({ userId: `owner-${tenantId}`, email: `o@${tenantId}`, role: 'SALON_ADMIN', tenantId }) as never;
const desk = (tenantId: string) => ({ userId: 'desk', email: 'd@x', role: 'STAFF', staffRole: 'RECEPTIONIST', tenantId }) as never;

function build() {
  const db: Row = {
    setting: table([{ tenantId: 'ta', key: 'ai_brain', value: { persona: { agentName: 'Linh' }, knowledge: { facts: [{ label: 'Parking', value: 'Behind', on: true }] }, version: 3 } }]),
    tenant: table([{ id: 'ta', name: 'Lux', market: 'US', businessType: 'SALON', timezone: 'America/Chicago' }, { id: 'tb', name: 'Other', market: 'VN', businessType: 'SALON', timezone: 'Asia/Ho_Chi_Minh' }]),
    messengerConnection: table([{ tenantId: 'tb', greeting: 'Xin chào', agentName: 'Mai', botFacts: [{ label: 'Đậu xe', value: 'Sau tiệm', on: true }] }]),
    voiceLine: table([{ tenantId: 'tb', language: 'vi-VN', greeting: null, aiInstruction: 'phone rule' }]),
    customer: table([{ id: 'ca', tenantId: 'ta', firstName: 'Anna', lastName: 'Lee', phone: '+15125550101', createdAt: new Date() }, { id: 'cb', tenantId: 'tb', firstName: 'Bao', lastName: null, phone: '+15125550101', createdAt: new Date() }]),
    customerMemory: table([]),
    aiSession: table([]),
    aiCallbackTask: table([]),
    appointment: table([]),
    voiceCall: table([]),
    messengerThread: table([]),
  };
  const pushes: Row[] = [];
  const svc = new AiBrainService(db as never, { log: async () => undefined } as never, { getAiNotes: async () => ({ text: 'shared' }) } as never, { sendToTenant: async (t: string, p: Row) => { pushes.push({ t, ...p }); } } as never);
  return { svc, db, pushes };
}

describe('the brain belongs to one salon', () => {
  it('reads the saved brain for A and assembles the old screens for B', async () => {
    const { svc } = build();
    const a = await svc.getBrainFor('ta');
    expect(a.legacy).toBe(false);
    expect(a.brain.persona.agentName).toBe('Linh');
    expect(a.brain.version).toBe(3);
    const b = await svc.getBrainFor('tb');
    expect(b.legacy).toBe(true);
    expect(b.brain.persona.agentName).toBe('Mai');
    expect(b.brain.languages.primary).toBe('vi');
    expect(b.brain.knowledge.rules).toBe('shared');
    expect(b.brain.knowledge.facts[0].label).toBe('Đậu xe');
    // A's facts never show in B's prompt and the other way round.
    const pa = await svc.promptBlocks('ta', 'voice', 'en');
    const pb = await svc.promptBlocks('tb', 'voice', 'vi');
    expect(pa.blocks.facts).toMatch(/Parking/);
    expect(pa.blocks.facts).not.toMatch(/Đậu xe/);
    expect(pb.blocks.facts).toMatch(/Đậu xe/);
    expect(pb.blocks.facts).not.toMatch(/Parking/);
  });

  it('saving bumps the version, writes under the caller\'s salon only, and the desk may not', async () => {
    const { svc, db } = build();
    const next = await svc.updateBrain(owner('ta'), { persona: { agentName: 'Hoa' } });
    expect(next.version).toBe(4);
    expect(next.persona.agentName).toBe('Hoa');
    expect(db.setting.rows.filter((r: Row) => r.key === 'ai_brain').map((r: Row) => r.tenantId)).toEqual(['ta']);
    await expect(svc.updateBrain(desk('ta'), { persona: { agentName: 'X' } })).rejects.toThrow(/owner or a manager/);
    const b = await svc.updateBrain(owner('tb'), { persona: { agentName: 'Mai 2' } });
    expect(b.version).toBe(1);
    expect((await svc.getBrain('ta')).persona.agentName).toBe('Hoa');
  });
});

describe('a customer\'s memory across channels', () => {
  it('finds the caller by phone inside this salon only', async () => {
    const { svc } = build();
    expect((await svc.customerByPhone('ta', '512-555-0101'))?.id).toBe('ca');
    expect((await svc.customerByPhone('tb', '+15125550101'))?.id).toBe('cb');
    expect(await svc.customerByPhone('ta', '000')).toBeNull();
  });

  it('remembers language, channel and the unfinished business, and tells the prompt', async () => {
    const { svc } = build();
    await svc.touchMemory('ta', 'ca', { channel: 'messenger', lang: 'en', openIntent: 'gel pedicure Saturday, choosing 2:00 or 3:15' });
    const m = await svc.getMemory('ta', 'ca');
    expect(m?.preferredLang).toBe('en');
    expect(m?.openIntent?.text).toMatch(/gel pedicure/);
    const block = svc.memoryBlock(m, new Date(Date.now() + 3 * 86_400_000));
    expect(block).toMatch(/UNFINISHED from 3 day\(s\) ago \(messenger\)/);
    expect(block).toMatch(/RETURNING CUSTOMER/);
    // B cannot see it.
    expect(await svc.getMemory('tb', 'ca')).toBeNull();
    expect(svc.memoryBlock(null)).toBe('');
  });

  it('banks a conversation raw when there is no model key', async () => {
    const { svc } = build();
    const was = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await svc.distillMemory('ta', 'ca', [{ role: 'user', content: 'I am allergic to acetone' }, { role: 'assistant', content: 'Noted' }], 'en');
      expect((await svc.getMemory('ta', 'ca'))?.profile).toMatch(/allergic to acetone/);
    } finally { if (was) process.env.ANTHROPIC_API_KEY = was; }
  });

  it('the owner edits and erases a memory of their own salon only', async () => {
    const { svc } = build();
    await svc.touchMemory('ta', 'ca', { channel: 'voice' });
    await svc.noteMemory(owner('ta'), 'ca', { salonNote: 'VIP' });
    expect((await svc.getMemory('ta', 'ca'))?.salonNote).toBe('VIP');
    await expect(svc.noteMemory(owner('tb'), 'ca', { salonNote: 'x' })).rejects.toThrow(/not found/i);
    await expect(svc.noteMemory(desk('ta'), 'ca', { salonNote: 'x' })).rejects.toThrow(/owner or a manager/);
    await svc.deleteMemory(owner('ta'), 'ca');
    expect(await svc.getMemory('ta', 'ca')).toBeNull();
  });
});

describe('callback tasks and the log of why it ended', () => {
  it('leaves the desk one task per caller and pushes the salon once', async () => {
    const { svc, db, pushes } = build();
    const a = await svc.createCallback({ tenantId: 'ta', channel: 'voice', reason: 'silence', summary: 'Two pedicures tomorrow 4pm', phone: '+15125550147' });
    const b = await svc.createCallback({ tenantId: 'ta', channel: 'voice', reason: 'silence', summary: 'Two pedicures tomorrow 4pm (again)', phone: '+15125550147' });
    expect(a?.id).toBe(b?.id);
    expect(db.aiCallbackTask.rows).toHaveLength(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].t).toBe('ta');
    expect(await svc.listCallbacks(owner('tb'))).toEqual([]);
    await expect(svc.doneCallback(owner('tb'), a!.id)).rejects.toThrow(/not found/i);
    await svc.doneCallback(owner('ta'), a!.id);
    expect(await svc.listCallbacks(owner('ta'))).toEqual([]);
  });

  it('counts the end reasons for this salon\'s health screen', async () => {
    const { svc } = build();
    await svc.startSession({ tenantId: 'ta', channel: 'voice', externalId: 'CA1', phone: '+1' });
    await svc.noteTurn('ta', 'CA1', { ms: 9000, toolCalls: 2, bookedId: 'ap1' });
    await svc.endSession('ta', 'CA1', 'goodbye');
    await svc.startSession({ tenantId: 'ta', channel: 'voice', externalId: 'CA2' });
    await svc.noteTurn('ta', 'CA2', { ms: 1200, failure: 'NOT BOOKED — outside hours' });
    await svc.endSession('ta', 'CA2', 'silence');
    await svc.startSession({ tenantId: 'tb', channel: 'voice', externalId: 'CB1' });
    await svc.endSession('tb', 'CB1', 'error');
    const h = await svc.health(owner('ta'));
    expect(h.total).toBe(2);
    expect(h.booked).toBe(1);
    expect(h.endReasons).toEqual({ goodbye: 1, silence: 1 });
    expect(h.slowTurns).toBe(1);
    expect(h.refusedBookings).toBe(1);
    expect((await svc.health(owner('tb'))).endReasons).toEqual({ error: 1 });
    await expect(svc.sessionDetail(owner('tb'), (await svc.listSessions(owner('ta'), {}))[0].id)).rejects.toThrow(/not found/i);
  });
});
