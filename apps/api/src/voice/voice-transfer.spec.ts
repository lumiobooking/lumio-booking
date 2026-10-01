/**
 * "Cho tôi nói chuyện với nhân viên" — the assistant hands the caller to the
 * receptionist's phone instead of hanging up on them.
 *
 * Plays Twilio's part against the real service: a turn where the agent asks
 * to transfer, the <Dial> the caller's phone receives, then each way the
 * ringing can end (picked up / nobody), and the settings that feed it.
 */
import { BadRequestException } from '@nestjs/common';
import { VoiceService } from './voice.service';

process.env.PUBLIC_API_URL = 'https://api.test';

type Row = Record<string, unknown>;

function makeSvc(o: { line?: Row; call?: Row; adminPhone?: string } = {}) {
  const io = { updates: [] as Row[], updateMany: [] as Row[], sms: [] as Row[], lineLookups: [] as Row[], upserts: [] as Row[] };
  const call: Row = {
    id: 'c1', callSid: 'CA1', tenantId: 't1', fromNumber: '+17145550000', createdAt: new Date(Date.now() - 90_000),
    transcript: [{ role: 'user', content: 'can I talk to someone' }, { role: 'assistant', content: 'Of course, connecting you now.' }],
    outcome: 'in_progress', language: null, ...o.call,
  };
  const lines: Record<string, Row> = {
    t1: { tenantId: 't1', lumioNumber: '+14035550100', language: 'en-US', voice: null, enabled: true, mode: 'ai', forwardNumbers: null, transferNumber: '+16313203255', ringSeconds: 20, aiInstruction: '', voicemailSms: null, ...o.line },
    t2: { tenantId: 't2', lumioNumber: '+14035550200', language: 'en-US', voice: null, enabled: true, mode: 'ai', forwardNumbers: null, transferNumber: '+19995550000', ringSeconds: 20 },
  };
  const prisma = {
    voiceCall: {
      findUnique: async () => call,
      update: async (args: Row) => { io.updates.push(args); return call; },
      updateMany: async (args: Row) => { io.updateMany.push(args); return { count: 1 }; },
    },
    voiceLine: {
      findUnique: async (args: { where: { tenantId: string } }) => { io.lineLookups.push(args); return lines[args.where.tenantId] ?? null; },
      upsert: async (args: Row) => { io.upserts.push(args); return args; },
    },
    voiceCallCount: 0,
    tenant: { findUnique: async () => ({ name: 'Lumio Nails', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'NAIL_SALON' }) },
    setting: { findFirst: async () => null },
    auditLog: { create: async () => ({}) },
  };
  const settings = {
    getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }),
    getNotificationSettings: async () => ({ adminPhone: o.adminPhone ?? '+14035559999', twilio: null }),
  };
  const notifications = { send: async (args: Row) => { io.sms.push(args); return {}; } };
  const svc = new VoiceService(prisma as never, {} as never, settings as never, notifications as never);
  return { svc, io, call };
}

const stubAgent = (svc: VoiceService, impl: (...a: unknown[]) => unknown) => {
  (svc as unknown as { runAgent: unknown }).runAgent = impl;
};

describe('the caller asks for a person', () => {
  it('the assistant says so and rings the receptionist — the caller stays on the line', async () => {
    const { svc, io } = makeSvc();
    let offered: unknown;
    stubAgent(svc, async (...a: unknown[]) => { offered = a[7]; return { reply: 'Of course, connecting you now.', done: true, transfer: true, booked: false, appointmentId: null }; });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'can I speak to a real person' }, '0');
    expect(offered).toBe(true); // the tool was on the table
    expect(xml).toContain('<Say');
    expect(xml).toContain('connecting you now');
    expect(xml).toContain('<Dial');
    expect(xml).toContain('<Number>+16313203255</Number>');
    expect(xml).toContain('/api/voice/after-transfer');
    expect(xml).not.toContain('<Hangup/>');
    // Only the AI's share of the call is billed as AI.
    const stamp = io.updates.find((u) => JSON.stringify(u).includes('transferring'));
    expect(stamp).toBeTruthy();
    expect((stamp!.data as Row).durationSec).toBeGreaterThan(0);
  });

  it('falls back to the ring-first numbers when no receptionist number is set', async () => {
    const { svc } = makeSvc({ line: { transferNumber: null, forwardNumbers: '+14035550111' } });
    stubAgent(svc, async () => ({ reply: 'One moment.', done: true, transfer: true, booked: false, appointmentId: null }));
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'manager please' }, '0');
    expect(xml).toContain('<Number>+14035550111</Number>');
  });

  it('with no number to hand over to, the tool is not even offered', async () => {
    const { svc } = makeSvc({ line: { transferNumber: null, forwardNumbers: null } });
    let offered: unknown;
    stubAgent(svc, async (...a: unknown[]) => { offered = a[7]; return { reply: 'A team member will call you back.', done: true, booked: false, appointmentId: null }; });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'a person please' }, '0');
    expect(offered).toBe(false);
    expect(xml).not.toContain('<Dial');
  });

  it('never rings the Lumio line itself (that would loop back into the assistant)', async () => {
    const { svc } = makeSvc({ line: { transferNumber: '+14035550100', forwardNumbers: '+14035550100' } });
    let offered: unknown;
    stubAgent(svc, async (...a: unknown[]) => { offered = a[7]; return { reply: 'ok', done: false, booked: false, appointmentId: null }; });
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'hi' }, '0');
    expect(offered).toBe(false);
  });
});

describe('when the ringing ends', () => {
  it('picked up → the call is the receptionist’s; marked transferred', async () => {
    const { svc, io } = makeSvc();
    const xml = await svc.handleAfterTransfer({ CallSid: 'CA1', DialCallStatus: 'completed' });
    expect(xml).toContain('<Hangup/>');
    expect(JSON.stringify(io.updateMany)).toContain('transferred');
  });

  it('nobody answers → the assistant comes back, apologises, keeps listening, and texts the salon', async () => {
    const { svc, io } = makeSvc();
    const xml = await svc.handleAfterTransfer({ CallSid: 'CA1', DialCallStatus: 'no-answer' });
    expect(xml).toContain('nobody could pick up');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Hangup/>');
    expect(io.sms).toHaveLength(1);
    expect(io.sms[0].recipient).toBe('+14035559999');
    expect(String(io.sms[0].body)).toContain('+17145550000');
    // remembered on the call: no second transfer offer
    expect(JSON.stringify(io.updates)).toContain('transfer_missed');
  });

  it('a Vietnamese caller hears the apology in Vietnamese', async () => {
    const { svc } = makeSvc({ line: { language: 'bilingual' } });
    const xml = await svc.handleAfterTransfer({ CallSid: 'CA1', DialCallStatus: 'busy' }, 'vi-VN');
    expect(xml).toContain('chưa bắt máy');
    expect(xml).toContain('language="vi-VN"');
  });

  it('after a missed transfer the tool is not offered again on the same call', async () => {
    const { svc } = makeSvc({ call: { transcript: [{ role: 'user', content: 'person' }, { role: 'assistant', content: 'connecting… nobody picked up', meta: 'transfer_missed' }] } });
    let offered: unknown;
    stubAgent(svc, async (...a: unknown[]) => { offered = a[7]; return { reply: 'Can I take a message?', done: false, booked: false, appointmentId: null }; });
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'try again' }, '0');
    expect(offered).toBe(false);
  });

  it('uses ONLY the calling salon’s line — never another salon’s number', async () => {
    const { svc, io } = makeSvc();
    stubAgent(svc, async () => ({ reply: 'Connecting.', done: true, transfer: true, booked: false, appointmentId: null }));
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'person' }, '0');
    expect(xml).not.toContain('+19995550000');
    expect(io.lineLookups.every((l) => (l as { where: { tenantId: string } }).where.tenantId === 't1')).toBe(true);
  });
});

describe('setting the receptionist’s number', () => {
  const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;
  it('saves it as a full number', async () => {
    const { svc, io } = makeSvc();
    (svc as unknown as { get: unknown }).get = async () => ({});
    (svc as unknown as { audit: unknown }).audit = async () => undefined;
    await svc.updateSettings(admin, { transferNumber: '(631) 320-3255' });
    expect(JSON.stringify(io.upserts[0])).toContain('+16313203255');
  });
  it('refuses the Lumio hotline number itself', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { audit: unknown }).audit = async () => undefined;
    await expect(svc.updateSettings(admin, { transferNumber: '+1 403 555 0100' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
