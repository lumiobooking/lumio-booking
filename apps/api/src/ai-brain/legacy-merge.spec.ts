/**
 * The notes typed on the old Messenger / Hotline screens are moved into the
 * brain once — the caller's salon only, never overwriting, with an Undo.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' },
    StaffRole: actual.StaffRole ?? { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
  };
});
import { AiBrainService, salonToday } from './ai-brain.service';
import { brainPromptBlocks, defaultBrain, legacyNotes, mergeLegacy, sanitizeBrain } from './brain-settings';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function table(rows: Row[]) {
  const hit = (where: Row) => (r: Row) => (where.tenantId_key
    ? r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key
    : Object.entries(where).every(([k, v]) => r[k] === v));
  return {
    rows,
    findUnique: async ({ where }: Row) => rows.find(hit(where)) ?? null,
    findFirst: async ({ where }: Row) => rows.find(hit(where)) ?? null,
    update: async ({ where, data }: Row) => { const r = rows.find(hit(where)); if (r) Object.assign(r, data); return r; },
    updateMany: async ({ where, data }: Row) => { let n = 0; for (const r of rows) if (hit(where)(r)) { Object.assign(r, data); n += 1; } return { count: n }; },
    upsert: async ({ where, create, update }: Row) => { const r = rows.find(hit(where)); if (r) Object.assign(r, update); else rows.push({ ...create }); return {}; },
  };
}

const owner = (tenantId: string) => ({ userId: `owner-${tenantId}`, email: `o@${tenantId}`, role: 'SALON_ADMIN', tenantId }) as never;
const desk = (tenantId: string) => ({ userId: 'desk', email: 'd@x', role: 'STAFF', staffRole: 'RECEPTIONIST', tenantId }) as never;

function build() {
  const db: Row = {
    setting: table([
      { tenantId: 'ta', key: 'ai_brain', value: { persona: { agentName: 'Linh' }, knowledge: { rules: 'Saved rule' }, version: 2 } },
      { tenantId: 'tb', key: 'ai_brain', value: { persona: { agentName: 'Mai' }, knowledge: { rules: 'B rule' }, version: 1 } },
    ]),
    tenant: table([{ id: 'ta', name: 'Lux', market: 'US', timezone: 'America/Chicago' }, { id: 'tb', name: 'Other', market: 'VN', timezone: 'Asia/Ho_Chi_Minh' }]),
    messengerConnection: table([
      { tenantId: 'ta', greeting: 'Hi from A', aiInstruction: 'A: answer in 3 lines', botFacts: [{ label: 'Parking', value: 'Behind', on: true, until: '2026-12-31' }], humanActiveMins: 20, graceMins: 4 },
      { tenantId: 'tb', greeting: 'Xin chào', aiInstruction: 'B: never quote', botFacts: [], humanActiveMins: 15, graceMins: 5 },
    ]),
    voiceLine: table([{ tenantId: 'ta', aiInstruction: 'A: read the phone back', greeting: 'Thanks for calling A', transferNumber: '+15125550147' }]),
  };
  const notes: Record<string, string> = { ta: 'A: shared note', tb: 'B: shared note' };
  const audits: Row[] = [];
  const svc = new AiBrainService(db as never, { log: async (r: Row) => { audits.push(r); } } as never, { getAiNotes: async (t: string) => ({ text: notes[t] ?? '' }) } as never);
  return { svc, db, audits };
}

describe('moving the old notes into the brain', () => {
  it('lists only the caller salon\'s old notes, with where each one goes', async () => {
    const { svc } = build();
    const v = await svc.legacyView('ta');
    const texts = v.notes.map((n) => n.text).join(' | ');
    expect(texts).toMatch(/A: shared note/);
    expect(texts).toMatch(/A: answer in 3 lines/);
    expect(texts).toMatch(/A: read the phone back/);
    expect(texts).toMatch(/Parking: Behind/);
    expect(texts).not.toMatch(/B:/);
  });

  it('moves them in for salon A only, appended, and Undo puts A back', async () => {
    const { svc, db, audits } = build();
    const r = await svc.mergeLegacyNotes(owner('ta'));
    expect(r.moved).toBe(4);
    const a = (await svc.getBrainFor('ta')).brain;
    expect(a.knowledge.rules).toBe('Saved rule\nA: shared note');
    expect(a.channels.chat.extra).toBe('A: answer in 3 lines');
    expect(a.channels.voice.extra).toBe('A: read the phone back');
    expect(a.knowledge.facts).toEqual([{ label: 'Parking', value: 'Behind', on: true, until: '2026-12-31' }]);
    // B is untouched.
    const b = db.setting.rows.find((x: Row) => x.tenantId === 'tb' && x.key === 'ai_brain').value;
    expect(b.knowledge.rules).toBe('B rule');
    expect(audits.every((x) => x.tenantId === 'ta')).toBe(true);
    // Nothing left to move; a second run moves nothing.
    expect((await svc.legacyView('ta')).notes).toEqual([]);
    expect((await svc.mergeLegacyNotes(owner('ta'))).moved).toBe(0);
    await svc.undoLegacyMerge(owner('ta'));
    expect((await svc.getBrainFor('ta')).brain.knowledge.rules).toBe('Saved rule');
  });

  it('a receptionist cannot move or undo', async () => {
    const { svc } = build();
    await expect(svc.mergeLegacyNotes(desk('ta'))).rejects.toThrow(/owner or a manager/);
    await expect(svc.undoLegacyMerge(desk('ta'))).rejects.toThrow(/owner or a manager/);
  });

  it('shows the channel\'s own values: chat greeting and yield from Messenger, transfer number and phone greeting from the line', async () => {
    const { svc } = build();
    const a = (await svc.getBrainFor('ta')).brain;
    expect(a.channels.chat.greeting).toBe('Hi from A');
    expect(a.channels.chat.yieldMins).toBe(4);
    expect(a.handoff.staffQuietMins).toBe(20);
    expect(a.handoff.transferNumber).toBe('+15125550147');
    expect(a.channels.voice.greeting).toBe('Thanks for calling A');
  });

  it('saving the phone greeting writes it to the line too (the keypad menu reads it there), for that salon only', async () => {
    const { svc, db } = build();
    await svc.updateBrain(owner('ta'), { channels: { voice: { greeting: 'New hello' }, chat: { yieldMins: 9 } } });
    expect(db.voiceLine.rows[0].greeting).toBe('New hello');
    expect(db.messengerConnection.rows.find((r: Row) => r.tenantId === 'ta').graceMins).toBe(9);
    expect(db.messengerConnection.rows.find((r: Row) => r.tenantId === 'tb').graceMins).toBe(5);
  });
});

describe('dated facts', () => {
  const brain = sanitizeBrain({ knowledge: { facts: [
    { label: 'Halloween', value: 'Open 10–4', on: true, from: '2026-10-30', until: '2026-10-31' },
    { label: 'Parking', value: 'Behind', on: true },
    { label: 'Bad date', value: 'x', on: true, from: 'soon' },
  ] } }, defaultBrain('US'));
  it('keeps valid dates, drops junk ones, and a fact is told only inside its days', () => {
    expect(brain.knowledge.facts[2]).toEqual({ label: 'Bad date', value: 'x', on: true });
    const ctx = { channel: 'chat' as const, salonName: 'Lux', venueNoun: 'salon', lang: 'en' as const };
    expect(brainPromptBlocks(brain, { ...ctx, today: '2026-10-31' }).facts).toMatch(/Halloween/);
    expect(brainPromptBlocks(brain, { ...ctx, today: '2026-11-01' }).facts).not.toMatch(/Halloween/);
    expect(brainPromptBlocks(brain, { ...ctx, today: '2026-11-01' }).facts).toMatch(/Parking/);
  });
  it('the salon\'s today is its own calendar day', () => {
    const t = new Date('2026-10-27T03:30:00Z');
    expect(salonToday('America/Chicago', t)).toBe('2026-10-26');
    expect(salonToday('Asia/Ho_Chi_Minh', t)).toBe('2026-10-27');
  });
  it('pure merge never overwrites what the owner already set', () => {
    const b = sanitizeBrain({ persona: { agentName: 'Linh', intro: 'Ours' } }, defaultBrain('US'));
    const src = { messenger: { agentName: 'Old name', bizIntro: 'Old intro' } };
    expect(legacyNotes(b, src).map((n) => n.source)).toEqual(['messenger_intro']);
    const m = mergeLegacy(b, src);
    expect(m.persona.agentName).toBe('Linh');
    expect(m.persona.intro).toBe('Ours');
    expect(m.knowledge.rules).toBe('Old intro');
  });
});
