/**
 * The test calls of 30 Oct 2026 (Oakville Nice One Nails, Saigon Spa &
 * Tattoo), replayed against the real service:
 *  - "Tenny's all set… confirmation on the way" with nothing booked;
 *  - a new number heard in pieces, read back only as "ending in 7, 7", and
 *    booked under digits the caller never said;
 *  - the same full set booked twice on two calls;
 *  - "I want Alex" answered with "a staff member will call you back";
 *  - "Bye bye" answered with "How else can I help you book?" and a hang-up;
 *  - a number typed on the keypad instead of spoken.
 * And none of it lets one salon's call touch another salon's data.
 */
import {
  asksForNumber, claimsDone, goodbyeLine, impossibleNanp, keypadLine, nationalDigits, readBackOk, spokenNumber,
} from './booking-guards';
import { VoiceService } from './voice.service';
import { BookingsService } from '../bookings/bookings.service';
import { RELAY_KEYPAD_PAUSE_MS, RelaySession, type RelayDeps } from './relay';
import type { TurnAction } from './voice.service';
import { AppointmentStatus } from '@prisma/client';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('booking-guards (pure)', () => {
  it('hears a claim that something is done, in English and Vietnamese', () => {
    for (const s of [
      "Tenny's all set for Thursday November 5th at 7 PM, and a text confirmation is on the way!",
      "You're all set!", 'Your appointment is booked.', "I've moved you to Friday at 2.", 'Alex is now on your booking.',
      'Dạ em đã đặt lịch cho chị rồi ạ.', 'Em đã dời lịch sang thứ Tư.',
    ]) expect(claimsDone(s)).toBe(true);
    for (const s of ['Would you like me to book that?', 'Friday at 2 is open.', 'Can I have your name?', 'Dạ chị muốn đặt mấy giờ ạ?']) expect(claimsDone(s)).toBe(false);
  });

  it('the caller ID needs its last four read back; a NEW number needs every digit', () => {
    const caller = '+16042798799';
    expect(readBackOk({ said: 'under the number ending in 8, 7, 9, 9?', phone: caller, callerPhone: caller })).toBe(true);
    // Oakville: the new number was read back only by its ending.
    expect(readBackOk({ said: 'under the number ending in 8, 7, 7, 7?', phone: '+16042798777', callerPhone: caller })).toBe(false);
    expect(readBackOk({ said: 'Just to confirm: 6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7?', phone: '+16042798777', callerPhone: caller })).toBe(true);
    // Saigon: digits never said do not count.
    expect(readBackOk({ said: 'is that 604-279-1188?', phone: '+16042798777', callerPhone: caller })).toBe(false);
  });

  it('reads a whole number in 3-3-4 groups and spots numbers that cannot exist', () => {
    expect(spokenNumber('+16042798777')).toBe('6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7');
    expect(nationalDigits('+16042798777')).toBe('6042798777');
    expect(impossibleNanp('+16042798777')).toBe(false);
    expect(impossibleNanp('+10427977000')).toBe(true); // area code starting with 0
    expect(impossibleNanp('+16041798777')).toBe(true); // exchange starting with 1
    expect(impossibleNanp('+1604279877')).toBe(true); // nine digits
    expect(impossibleNanp('+84901234567', '84')).toBe(false); // not North America: not judged
  });

  it('says goodbye — never "How else can I help you book?"', () => {
    expect(goodbyeLine('en-US', 'Tenny')).toBe('Thank you for calling, Tenny. Goodbye!');
    expect(goodbyeLine('en-US')).toBe('Thank you for calling. Goodbye!');
    expect(goodbyeLine('vi-VN')).toMatch(/cảm ơn/);
    expect(goodbyeLine('en-US')).not.toMatch(/help/i);
  });

  it('keypad digits become a caller turn; asking for a number listens longer', () => {
    expect(keypadLine('604 279 8777#')).toBe('(typed on the keypad) 6042798777');
    expect(keypadLine('')).toBe('');
    expect(asksForNumber("What's the best phone number for her?")).toBe(true);
    expect(asksForNumber('Dạ chị cho em xin số điện thoại ạ')).toBe(true);
    expect(asksForNumber('What time works for you?')).toBe(false);
  });
});

// ---- the booking tool -------------------------------------------------------

const TZ = 'America/Chicago';
const DAY = '2030-03-09';
const menu = [{ id: 'uv', name: 'UV Full Set', minutes: 60 }];

function bookingSvc(o: { earlier?: Row[]; existing?: Row[] } = {}) {
  const calls: { model: string; where: Row }[] = [];
  const created: Row[] = [];
  const staff = [
    { id: 'alex', tenantId: 't1', firstName: 'Alex' },
    { id: 'zoe', tenantId: 't2', firstName: 'Zoe' },
  ];
  const log = (model: string) => (a: { where: Row }) => calls.push({ model, where: a.where });
  const prisma = {
    tenant: { findUnique: async () => ({ timezone: TZ }) },
    setting: { findFirst: async (a: { where: Row }) => { log('setting')(a); return null; } },
    staffMember: { findMany: async (a: { where: Row }) => { log('staffMember')(a); return staff.filter((s) => s.tenantId === a.where.tenantId).map((s) => ({ ...s, staffServices: [], workingHours: [] })); } },
    voiceCall: { findMany: async (a: { where: Row }) => { log('voiceCall')(a); return (o.earlier ?? []).filter((c) => c.tenantId === a.where.tenantId && c.fromNumber === a.where.fromNumber); } },
    appointment: {
      findMany: async (a: { where: Row }) => { log('appointment')(a); return []; },
      findFirst: async (a: { where: Row }) => {
        log('appointment.findFirst')(a);
        if (a.where.id?.in) {
          return (o.existing ?? []).find((x) => x.tenantId === a.where.tenantId && a.where.id.in.includes(x.id) && x.startTime.getTime() === a.where.startTime.getTime()) ?? null;
        }
        return null;
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const bookings = {
    createForTenant: async (tenantId: string, dto: Row) => { const row = { tenantId, dto, id: `ap${created.length + 1}` }; created.push(row); return { id: row.id }; },
  };
  const settings = {
    getBookingRules: async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 19 * 60 }), daysOff: [], minLeadHours: 0, maxAdvanceDays: 0, slotStepMinutes: 30 }),
  };
  const svc = new VoiceService(prisma as never, bookings as never, settings as never, {} as never);
  const acc = { wantEnd: false, booked: false, appointmentId: null as string | null, callSid: 'CA-NOW' };
  const tool = (input: Row, lastSaid?: string, caller = '+16042798799') =>
    (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> }).runTool(
      't1', TZ, caller, 'create_booking', { phoneConfirmed: true, ...input },
      acc, { menu, staff: [{ id: 'alex', firstName: 'Alex', lastName: null }], groupMode: true, lastSaid, lang: 'en-US' },
    );
  return { tool, calls, created };
}

const uvAt3 = { localDateTime: `${DAY}T15:00`, people: [{ firstName: 'Tenny', services: ['S1'] }] };

describe('a new number is read back in full before anything is booked', () => {
  it('"ending in 8, 7, 7, 7" is not enough for a number that is not the caller ID', async () => {
    const { tool, created } = bookingSvc();
    const out = await tool({ ...uvAt3, customerPhone: '604 279 8777' }, 'UV full set Saturday at 3 for Tenny, under the number ending in 8, 7, 7, 7?');
    expect(out).toMatch(/^NOT BOOKED YET: this is a NEW number/);
    expect(out).toContain('6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7');
    expect(out).toMatch(/keypad/);
    expect(created).toHaveLength(0);
  });

  it('read back digit by digit and confirmed: booked under exactly that number', async () => {
    const { tool, created } = bookingSvc();
    const out = await tool({ ...uvAt3, customerPhone: '604 279 8777' }, 'UV full set Saturday at 3 for Tenny, at 6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7. Is that right?');
    expect(out).toMatch(/^SUCCESS/);
    expect(created.map((c) => c.dto.customerPhone)).toEqual(['+16042798777']);
  });

  it('the caller\'s own number still only needs its last four', async () => {
    const { tool, created } = bookingSvc();
    const out = await tool(uvAt3, 'UV full set Saturday at 3 for Tenny, under the number ending in 8, 7, 9, 9?');
    expect(out).toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
  });

  it('a number that cannot exist is asked for again, never booked', async () => {
    const { tool, created } = bookingSvc();
    const out = await tool({ ...uvAt3, customerPhone: '486 042 7977' }, 'at 4, 8, 6 — 0, 4, 2 — 7, 9, 7, 7?');
    expect(out).toMatch(/^NOT BOOKED: .* cannot be a real phone number/);
    expect(created).toHaveLength(0);
  });
});

describe('the same booking is not made twice on two calls', () => {
  const at3 = new Date('2030-03-09T21:00:00.000Z'); // 3 PM Chicago
  const earlier = [{ tenantId: 't1', fromNumber: '+16042798799', appointmentId: 'ap-old' }];
  const existing = [{ tenantId: 't1', id: 'ap-old', startTime: at3, service: { name: 'UV Full Set' }, customer: { firstName: 'Tenny', phone: '+16042798777' }, status: AppointmentStatus.CONFIRMED }];
  const said = 'UV full set Saturday at 3 for Tenny, under the number ending in 8, 7, 9, 9?';

  it('an earlier call from this phone already booked that exact time: ask, do not book', async () => {
    const { tool, created, calls } = bookingSvc({ earlier, existing });
    const out = await tool(uvAt3, said);
    expect(out).toMatch(/^NOT BOOKED: a booking already exists at that exact time/);
    expect(out).toContain('ending in 8, 7, 7, 7');
    expect(created).toHaveLength(0);
    const lookup = calls.find((c) => c.model === 'voiceCall')!;
    expect(lookup.where.NOT).toEqual({ callSid: 'CA-NOW' }); // this call's own retries are the other guard's job
  });

  it('the caller really wants a second one: booked', async () => {
    const { tool, created } = bookingSvc({ earlier, existing });
    expect(await tool({ ...uvAt3, secondBooking: true }, said)).toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
  });

  it('another salon\'s calls and bookings are never looked at', async () => {
    const other = [{ tenantId: 't2', fromNumber: '+16042798799', appointmentId: 'ap-old' }];
    const otherAppt = [{ ...existing[0], tenantId: 't2' }];
    const { tool, created, calls } = bookingSvc({ earlier: other, existing: otherAppt });
    expect(await tool(uvAt3, said)).toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
    for (const c of calls) expect(c.where.tenantId).toBe('t1');
  });
});

// ---- changing the technician of a booking already made ---------------------

function techSvc(o: { mine?: Row[]; result?: Row } = {}) {
  const asked: Row[] = [];
  const reads: Row[] = [];
  const prisma = {
    tenant: { findUnique: async () => ({ timezone: TZ }) },
    setting: { findFirst: async () => null },
    voiceCall: { findMany: async (a: { where: Row }) => { reads.push({ model: 'voiceCall', ...a.where }); return []; } },
    appointment: {
      findMany: async (a: { where: Row }) => {
        reads.push({ model: 'appointment', ...a.where });
        return (o.mine ?? []).filter((x) => x.tenantId === a.where.tenantId);
      },
    },
  };
  const bookings = {
    upcomingForPhone: async (tenantId: string) => { reads.push({ model: 'upcoming', tenantId }); return (o.mine ?? []).filter((x) => x.tenantId === tenantId).map((x) => ({ id: x.id })); },
    selfChangeTech: async (a: Row) => { asked.push(a); return o.result ?? { ok: true, code: 'changed', say: 'ok', staffName: 'Alex' }; },
  };
  const svc = new VoiceService(prisma as never, bookings as never, {} as never, {} as never);
  const acc: Row = { wantEnd: false, booked: false, appointmentId: null };
  const tool = (input: Row) => (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> }).runTool(
    't1', TZ, '+16042798799', 'change_technician', input, acc,
    { menu, staff: [{ id: 'alex', firstName: 'Alex', lastName: null }, { id: 'kim', firstName: 'Kim', lastName: null }], groupMode: true },
  );
  return { tool, asked, acc, reads };
}

const mineRow = { tenantId: 't1', id: 'ap-1', groupId: null, startTime: new Date('2030-03-09T21:00:00Z'), service: { name: 'UV Full Set' }, customer: { firstName: 'Tenny', phone: '+16042798777' }, assignedStaff: { firstName: 'Kim' } };

describe('"I want Alex" on a booking already made', () => {
  it('is done on the call — no "someone will call you back"', async () => {
    const { tool, asked, acc } = techSvc({ mine: [mineRow] });
    const out = await tool({ appointmentId: 'ap-1', technician: 'alex' });
    expect(out).toMatch(/^SUCCESS. Alex is now the technician for Tenny's UV Full Set/);
    expect(asked).toEqual([{ tenantId: 't1', appointmentId: 'ap-1', staffId: 'alex', by: 'hotline' }]);
    expect(acc.changed).toBe(true);
  });

  it('a technician who is busy or off: NOT CHANGED, and no callback promised', async () => {
    const { tool, acc } = techSvc({ mine: [mineRow], result: { ok: false, code: 'busy', say: 'Alex is off at that time.' } });
    const out = await tool({ appointmentId: 'ap-1', technician: 'Alex' });
    expect(out).toMatch(/^NOT CHANGED \(busy\): Alex is off at that time/);
    expect(out).toMatch(/do not promise a call back/);
    expect(acc.changed).toBeUndefined();
  });

  it("a booking that is not this caller's — or another salon's — is never touched", async () => {
    const { tool, asked, reads } = techSvc({ mine: [{ ...mineRow, tenantId: 't2' }] });
    const out = await tool({ appointmentId: 'ap-1', technician: 'Alex' });
    expect(out).toMatch(/not one of this caller's/);
    expect(asked).toHaveLength(0);
    for (const r of reads) expect(r.tenantId).toBe('t1');
  });

  it('a name that is not on the team gets the list, not a guess', async () => {
    const { tool, asked } = techSvc({ mine: [mineRow] });
    expect(await tool({ appointmentId: 'ap-1', technician: 'Zoe' })).toMatch(/No technician called "Zoe". The technicians are: Alex, Kim/);
    expect(asked).toHaveLength(0);
  });
});

describe('BookingsService.selfChangeTech', () => {
  function make(o: { appt?: Row | null; staff?: Row | null; overlap?: Error } = {}) {
    const where: Row[] = [];
    const updates: Row[] = [];
    const audits: Row[] = [];
    const tx = { appointment: { updateMany: async (a: Row) => { updates.push(a); return { count: 1 }; } } };
    const prisma = {
      appointment: { findFirst: async (a: Row) => { where.push({ m: 'appt', ...a.where }); return o.appt === undefined ? { id: 'ap-1', tenantId: 't1', startTime: new Date(), endTime: new Date(), status: AppointmentStatus.CONFIRMED, assignedStaffId: 'kim', serviceId: 'uv' } : o.appt; } },
      staffMember: { findFirst: async (a: Row) => { where.push({ m: 'staff', ...a.where }); return o.staff === undefined ? { id: 'alex', firstName: 'Alex', takesAppointments: true, staffServices: [{ serviceId: 'uv' }] } : o.staff; } },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    };
    const svc = new BookingsService(prisma as never, { log: async (a: Row) => { audits.push(a); } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const s = svc as unknown as Row;
    s.lockStaffSlot = async () => undefined;
    s.assertNoOverlap = async () => { if (o.overlap) throw o.overlap; };
    s.followOnFloor = async () => undefined;
    s.sendStaffAssignmentEmail = async () => undefined;
    return { svc, where, updates, audits };
  }

  it('moves the booking to the technician, keeps it confirmed, audits it — scoped to the salon', async () => {
    const { svc, where, updates, audits } = make();
    const r = await svc.selfChangeTech({ tenantId: 't1', appointmentId: 'ap-1', staffId: 'alex', by: 'hotline' });
    expect(r).toMatchObject({ ok: true, code: 'changed', staffName: 'Alex' });
    for (const w of where) expect(w.tenantId).toBe('t1');
    expect(updates[0].where).toEqual({ id: 'ap-1', tenantId: 't1' });
    expect(updates[0].data).toMatchObject({ assignedStaffId: 'alex', preferredStaffId: 'alex' });
    expect(updates[0].data.status).toBeUndefined();
    expect(audits[0]).toMatchObject({ tenantId: 't1', action: 'booking.tech_changed_by_customer', resourceId: 'ap-1' });
  });

  it('time off or a block at that time: refused, nothing written', async () => {
    const { svc, updates } = make({ overlap: new Error('TIME_OFF: staff is off') });
    expect(await svc.selfChangeTech({ tenantId: 't1', appointmentId: 'ap-1', staffId: 'alex', by: 'hotline' })).toMatchObject({ ok: false, code: 'busy', say: 'Alex is off at that time.' });
    expect(updates).toHaveLength(0);
  });

  it("another salon's booking or technician is simply not found", async () => {
    expect(await make({ appt: null }).svc.selfChangeTech({ tenantId: 't2', appointmentId: 'ap-1', staffId: 'alex', by: 'hotline' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await make({ staff: null }).svc.selfChangeTech({ tenantId: 't1', appointmentId: 'ap-1', staffId: 'zoe', by: 'hotline' })).toMatchObject({ ok: false, code: 'no-tech' });
  });

  it('a technician who does not do the service is refused', async () => {
    const { svc, updates } = make({ staff: { id: 'alex', firstName: 'Alex', takesAppointments: true, staffServices: [{ serviceId: 'pedi' }] } });
    expect(await svc.selfChangeTech({ tenantId: 't1', appointmentId: 'ap-1', staffId: 'alex', by: 'hotline' })).toMatchObject({ ok: false, code: 'not-skilled' });
    expect(updates).toHaveLength(0);
  });
});

// ---- what the caller hears --------------------------------------------------

function agentSvc() {
  const prisma = {
    voiceCall: { findUnique: async () => null, update: async () => ({}), updateMany: async () => ({ count: 1 }), findMany: async () => [] },
    voiceLine: { findUnique: async () => null },
    tenant: { findUnique: async () => ({ name: 'Salon', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'SALON' }) },
    service: { findMany: async () => [{ id: 'uv', name: 'UV Full Set', priceCents: 6000, durationMinutes: 60, currency: 'USD' }] },
    serviceAddon: { findMany: async () => [] },
    staffMember: { findMany: async () => [] },
    messengerConnection: { findUnique: async () => null },
    setting: { findFirst: async () => null },
  };
  const settings = { getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }), getAiNotes: async () => ({ text: '' }) };
  const svc = new VoiceService(prisma as never, {} as never, settings as never, {} as never);
  return svc as unknown as { runAgent: (...a: unknown[]) => Promise<{ reply: string; done?: boolean; failure?: string | null }> };
}

describe('the caller only hears what the book says', () => {
  let fetchSpy: jest.SpyInstance;
  const text = (t: string) => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: t ? [{ type: 'text', text: t }] : [] }) }) as Response;
  const toolUse = (name: string, input: Row = {}) => ({ ok: true, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name, input }] }) }) as Response;
  const bodies = () => fetchSpy.mock.calls.map((c) => String((c[1] as RequestInit).body));
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; fetchSpy = jest.spyOn(globalThis, 'fetch' as never); });
  afterEach(() => { fetchSpy.mockRestore(); delete process.env.ANTHROPIC_API_KEY; });

  it('"all set" with nothing booked: the model is told, and the caller hears the truth', async () => {
    fetchSpy.mockResolvedValueOnce(text("Tenny's all set for Thursday at 7 PM, and a text confirmation is on the way!") as never)
      .mockResolvedValueOnce(text("Perfect — you're all set!") as never);
    const r = await agentSvc().runAgent('t1', '+16042798799', '', [], 'yes that is right', 'en-US', false, false, null, 'CA-1');
    expect(bodies()[1]).toContain('SYSTEM CHECK');
    expect(r.reply).toMatch(/not been able to save that booking yet/);
    expect(r.reply).not.toMatch(/all set/);
    expect(r.failure).toMatch(/claimed without booking/);
  });

  it('after the check the model asks for what is missing instead: that is what is said', async () => {
    fetchSpy.mockResolvedValueOnce(text("You're all set!") as never)
      .mockResolvedValueOnce(text('Before I book it, what is the best phone number for Tenny?') as never);
    const r = await agentSvc().runAgent('t1', '+16042798799', '', [], 'yes', 'en-US', false, false, null, 'CA-2');
    expect(r.reply).toBe('Before I book it, what is the best phone number for Tenny?');
  });

  it('a booking already made on this call may be confirmed without a check', async () => {
    fetchSpy.mockResolvedValue(text("You're all set for Saturday at 3!") as never);
    const r = await agentSvc().runAgent('t1', '+16042798799', '', [], 'thanks', 'en-US', false, false, 'ap-1', 'CA-3');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe("You're all set for Saturday at 3!");
  });

  it('"Bye bye": a thank-you and the call ends — never "How else can I help you book?"', async () => {
    fetchSpy.mockResolvedValueOnce(toolUse('end_call') as never).mockResolvedValueOnce(text('') as never);
    const r = await agentSvc().runAgent('t1', '+16042798799', '', [], "It's okay. Bye. Bye.", 'en-US', false, false, null, 'CA-4');
    expect(r.done).toBe(true);
    expect(r.reply).toBe('Thank you for calling. Goodbye!');
    expect(r.reply).not.toMatch(/help you book/i);
  });
});

describe('a number typed on the keypad', () => {
  it('the classic line hands the digits to the assistant as the caller\'s words', async () => {
    const call = { id: 'c1', callSid: 'CA1', tenantId: 't1', fromNumber: '+16042798799', createdAt: new Date(), transcript: [], outcome: 'in_progress', language: null };
    const prisma = {
      voiceCall: { findUnique: async () => call, update: async () => call, updateMany: async () => ({ count: 1 }) },
      voiceLine: { findUnique: async () => ({ tenantId: 't1', lumioNumber: '+14035550100', language: 'en-US', enabled: true, mode: 'ai', aiInstruction: '' }) },
      tenant: { findUnique: async () => ({ name: 'Salon', timezone: 'America/Los_Angeles', businessType: 'SALON' }) },
      setting: { findFirst: async () => null },
      auditLog: { create: async () => ({}) },
    };
    const svc = new VoiceService(prisma as never, {} as never, { getBookingRules: async () => ({ businessHours: [] }), getNotificationSettings: async () => ({}) } as never, {} as never);
    let heard: unknown;
    (svc as unknown as { runAgent: unknown }).runAgent = async (...a: unknown[]) => { heard = a[4]; return { reply: 'Is that 6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7?', done: false, booked: false, appointmentId: null }; };
    const xml = await svc.handleTurn({ CallSid: 'CA1', Digits: '6042798777' }, '0');
    expect(heard).toBe('(typed on the keypad) 6042798777');
    expect(xml).toContain('input="dtmf speech"');
    expect(xml).toContain('finishOnKey="#"');
  });

  describe('the fast line (ConversationRelay)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    const harness = () => {
      const turns: string[] = [];
      const deps: RelayDeps = {
        send: () => undefined, close: () => undefined,
        setup: async () => ({ ok: true, lang: 'en-US', maxSilence: 2 }),
        turn: async (_c, s) => { turns.push(s); return { kind: 'say', text: 'ok', lang: 'en-US', lgFlag: null } as TurnAction; },
        silence: async () => ({ text: '', end: false, lang: 'en-US' }),
        interrupted: async () => undefined, filler: () => '', log: () => undefined,
      };
      const s = new RelaySession(deps);
      return { s, turns };
    };
    const key = (s: RelaySession, digit: string) => s.onMessage(JSON.stringify({ type: 'dtmf', digit }));
    const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

    it('digits up to # are one turn', async () => {
      const { s, turns } = harness();
      await s.onMessage(JSON.stringify({ type: 'setup', callSid: 'CA1', accountSid: 'AC1', customParameters: {} }));
      for (const d of '6042798777') await key(s, d);
      expect(turns).toHaveLength(0);
      await key(s, '#');
      await flush();
      expect(turns).toEqual(['(typed on the keypad) 6042798777']);
    });

    it('without #, a short pause ends the number', async () => {
      const { s, turns } = harness();
      await s.onMessage(JSON.stringify({ type: 'setup', callSid: 'CA1', accountSid: 'AC1', customParameters: {} }));
      for (const d of '604279') await key(s, d);
      jest.advanceTimersByTime(RELAY_KEYPAD_PAUSE_MS + 1);
      await flush();
      expect(turns).toEqual(['(typed on the keypad) 604279']);
    });
  });
});
