/**
 * Why salons and their customers stopped getting texts and emails (Oct 2026),
 * each case pinned:
 *  - a salon's settings holding a COPY of the platform Twilio account used
 *    the copy's stale token (Twilio 20003 for a day and a half),
 *  - Australian salons turned the US toll-free "(833) 719-5153" into
 *    "+8337195153" (Twilio 21212 on every owner alert),
 *  - emails with no mail service anywhere were logged SENT through the mock.
 */
import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { normalizeFrom } from './providers/twilio.provider';

describe('normalizeFrom — the sender in E.164', () => {
  it('reads a North-American number as +1, whatever the salon country', () => {
    expect(normalizeFrom('(833) 719-5153', '61')).toBe('+18337195153');
    expect(normalizeFrom('  (833) 719-5153', '1')).toBe('+18337195153');
    expect(normalizeFrom('8337195153', '61')).toBe('+18337195153');
    expect(normalizeFrom('1-833-719-5153', '61')).toBe('+18337195153');
  });
  it("puts a local number in the salon's own country", () => {
    expect(normalizeFrom('0485 085 339', '61')).toBe('+61485085339');
    expect(normalizeFrom('+61 485 085 339', '61')).toBe('+61485085339');
  });
  it('leaves a Messaging Service SID alone', () => {
    expect(normalizeFrom('MG0123456789abcdef0123456789abcdef', '1')).toBe('MG0123456789abcdef0123456789abcdef');
  });
});

describe('texts on the platform account', () => {
  const ENV = { TWILIO_ACCOUNT_SID: 'ACplatform', TWILIO_AUTH_TOKEN: 'live-token', TWILIO_FROM_NUMBER: '+18337195153', TWILIO_FROM_NUMBER_AU: '+61485085339', SMS_PROVIDER: '' };
  const saved: Record<string, string | undefined> = {};
  let fetchSpy: jest.SpyInstance;
  const calls: { from: string; to: string; auth: string; url: string }[] = [];
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    calls.length = 0;
    fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((async (url: string, init: RequestInit) => {
      const p = new URLSearchParams(String(init.body));
      calls.push({ from: String(p.get('From') ?? p.get('MessagingServiceSid')), to: String(p.get('To')), auth: Buffer.from(String((init.headers as Record<string, string>).Authorization).replace('Basic ', ''), 'base64').toString(), url });
      return { ok: true, json: async () => ({ sid: 'SM1' }) } as Response;
    }) as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  function svcFor(market: string, timezone: string) {
    const prisma = {
      notification: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data), findMany: jest.fn(async () => []) },
      tenant: { findUnique: jest.fn(async () => ({ market, timezone })) },
      setting: { findFirst: jest.fn(async () => (market === 'AU' ? { value: { country: 'AU' } } : null)) },
      voiceLine: { findUnique: jest.fn(async () => null) },
    };
    const svc = new NotificationsService(prisma as never);
    (svc as unknown as { esmsForTenant: unknown }).esmsForTenant = async () => null;
    return svc;
  }

  it("an Australian salon's owner alert goes out from the +61 number, on the live token — not the stale copy", async () => {
    const svc = svcFor('AU', 'Australia/Perth');
    const n = await svc.send({
      tenantId: 'fremantle', channel: NotificationChannel.SMS, recipient: '+61457678899', body: 'New booking 633C3D',
      twilio: { accountSid: 'ACplatform', authToken: 'stale-copy', fromNumber: '(833) 719-5153' },
    }) as unknown as Record<string, unknown>;
    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe('+61485085339');
    expect(calls[0].auth).toBe('ACplatform:live-token');
    expect(n.status).toBe('SENT');
  });

  it('a US salon holding a stale copy still sends — on the live token', async () => {
    const svc = svcFor('US', 'America/Chicago');
    await svc.send({
      tenantId: 'amy', channel: NotificationChannel.SMS, recipient: '+12105550123', body: 'Hi',
      twilio: { accountSid: 'ACplatform', authToken: 'stale-copy', fromNumber: '(833) 719-5153' },
    });
    expect(calls[0].auth).toBe('ACplatform:live-token');
    expect(calls[0].from).toBe('+18337195153');
  });

  it("a salon's own line on our account keeps sending from it in North America", async () => {
    const svc = svcFor('US', 'America/Chicago');
    await svc.send({
      tenantId: 'x', channel: NotificationChannel.SMS, recipient: '+12105550123', body: 'Hi',
      twilio: { accountSid: 'ACplatform', authToken: 'stale', fromNumber: '(831) 250-9737' },
    });
    expect(calls[0].from).toBe('+18312509737');
    expect(calls[0].auth).toBe('ACplatform:live-token');
  });

  it("a salon's genuinely own Twilio account is used as it is, with its sender normalised", async () => {
    const svc = svcFor('AU', 'Australia/Perth');
    await svc.send({
      tenantId: 'own', channel: NotificationChannel.SMS, recipient: '+61457678899', body: 'Hi',
      twilio: { accountSid: 'ACtheirs', authToken: 'their-token', fromNumber: '0485 111 222' },
    });
    expect(calls[0].auth).toBe('ACtheirs:their-token');
    expect(calls[0].from).toBe('+61485111222');
  });
});

describe('an email with nowhere to go is not logged as sent', () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = prevEnv; });

  function svc() {
    const prisma = { notification: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data) } };
    return new NotificationsService(prisma as never);
  }

  it('fails with a reason the salon can act on (production)', async () => {
    process.env.NODE_ENV = 'production';
    const n = await svc().send({ tenantId: 'zb', channel: NotificationChannel.EMAIL, recipient: 'owner@zb.test', subject: 'New booking', body: 'x' }) as unknown as Record<string, unknown>;
    expect(n.status).toBe('FAILED');
    expect(n.provider).toBe('mock');
    expect(String(n.error)).toMatch(/no email service is connected/);
  });

  it('says so when the salon switched email off', async () => {
    process.env.NODE_ENV = 'production';
    const n = await svc().send({ tenantId: 'zb', channel: NotificationChannel.EMAIL, recipient: 'owner@zb.test', subject: 's', body: 'x', mailService: 'off' }) as unknown as Record<string, unknown>;
    expect(String(n.error)).toMatch(/turned off/);
  });

  it('keeps the mock working outside production (development and tests)', async () => {
    process.env.NODE_ENV = 'test';
    const n = await svc().send({ tenantId: 'zb', channel: NotificationChannel.EMAIL, recipient: 'owner@zb.test', subject: 's', body: 'x' }) as unknown as Record<string, unknown>;
    expect(n.status).toBe('SENT');
  });
});
