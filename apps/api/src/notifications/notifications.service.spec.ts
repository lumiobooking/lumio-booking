import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function makePrisma() {
  return {
    notification: {
      create: jest.fn(async ({ data }: any) => ({ id: 'notif-1', ...data })),
    },
  };
}

describe('NotificationsService', () => {
  it('sends via the mock provider and records the notification as SENT', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);

    const notif: any = await svc.send({
      tenantId: 'tenant-a',
      channel: NotificationChannel.EMAIL,
      recipient: 'jane@example.com',
      subject: 'Hello',
      body: 'Your booking is received',
      relatedType: 'appointment',
      relatedId: 'appt-1',
    });

    expect(notif.status).toBe('SENT');
    expect(notif.tenantId).toBe('tenant-a');
    expect(notif.channel).toBe('EMAIL');
    expect(notif.provider).toBe('mock');
    expect(notif.sentAt).not.toBeNull();
  });

  it('records an SMS notification scoped to the tenant', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);

    const notif: any = await svc.send({
      tenantId: 'tenant-b',
      channel: NotificationChannel.SMS,
      recipient: '+1-555-0000',
      body: 'Reminder',
    });

    expect(notif.status).toBe('SENT');
    expect(notif.tenantId).toBe('tenant-b');
    expect(notif.channel).toBe('SMS');
  });
});

describe('a customer texts STOP to an Australian number', () => {
  function inbound(opts: { line?: { tenantId: string } | null; market?: string; customers?: { tenantId: string }[] }) {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma: any = {
      notification: { create: jest.fn() },
      voiceLine: { findFirst: jest.fn(async () => opts.line ?? null) },
      tenant: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, market: opts.market ?? 'AU' })) },
      customer: { findMany: jest.fn(async () => opts.customers ?? []), updateMany },
    };
    return { svc: new NotificationsService(prisma), updateMany, prisma };
  }

  it('opts that customer out at the salon whose hotline number was texted', async () => {
    const { svc, updateMany } = inbound({ line: { tenantId: 't-syd' } });
    const r = await svc.handleInboundSms({ From: '+61412345678', To: '+61298765432', Body: 'Stop' });
    expect(r.optedOut).toBe(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((updateMany.mock.calls as any)[0][0])).toContain('t-syd');
  });

  it('ignores anything that is not an opt-out word', async () => {
    const { svc, updateMany } = inbound({ line: { tenantId: 't-syd' } });
    expect((await svc.handleInboundSms({ From: '+61412345678', To: '+61298765432', Body: 'can I move my booking?' })).optedOut).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('on the shared Australian number, opts out at every Australian salon that has the customer', async () => {
    process.env.TWILIO_FROM_NUMBER_AU = '+61400000000';
    const { svc, updateMany } = inbound({ line: null, customers: [{ tenantId: 'a' }, { tenantId: 'b' }, { tenantId: 'a' }] });
    const r = await svc.handleInboundSms({ From: '+61412345678', To: '+61400000000', Body: 'UNSUBSCRIBE' });
    expect(r.optedOut).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    delete process.env.TWILIO_FROM_NUMBER_AU;
  });

  it('when the shared number is ALSO a demo hotline, STOP still reaches every Australian salon', async () => {
    process.env.TWILIO_FROM_NUMBER_AU = '+61400000000';
    const { svc, updateMany } = inbound({ line: { tenantId: 'demo' }, customers: [{ tenantId: 'real-salon' }, { tenantId: 'demo' }] });
    const r = await svc.handleInboundSms({ From: '+61412345678', To: '+61400000000', Body: 'stop' });
    delete process.env.TWILIO_FROM_NUMBER_AU;
    expect(r.optedOut).toBe(2);
    expect(JSON.stringify(updateMany.mock.calls)).toContain('real-salon');
  });

  it('an unknown number does nothing', async () => {
    const { svc, updateMany } = inbound({ line: null });
    expect((await svc.handleInboundSms({ From: '+61412345678', To: '+61499999999', Body: 'STOP' })).optedOut).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('which number a live Twilio SMS leaves from', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });

  function live(market: string, lumioNumber: string | null) {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    const sent: string[] = [];
    global.fetch = jest.fn(async (_url: any, init: any) => {
      sent.push(String(init?.body ?? ''));
      return { ok: true, status: 201, json: async () => ({ sid: 'SM1' }), text: async () => '{"sid":"SM1"}' } as any;
    }) as any;
    const platform = { name: 'twilio', sendSms: jest.fn(async () => ({ success: true, providerMessageId: 'US1' })) };
    const prisma: any = {
      notification: { create: jest.fn(async ({ data }: any) => ({ id: 'n', ...data })) },
      tenant: { findUnique: jest.fn(async () => ({ market })) },
      setting: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
      voiceLine: { findUnique: jest.fn(async () => (lumioNumber ? { lumioNumber } : null)) },
    };
    const svc = new NotificationsService(prisma);
    (svc as any).sms = platform;
    return { svc, platform, sent };
  }
  const send = (svc: NotificationsService) => svc.send({ tenantId: 't', channel: NotificationChannel.SMS, recipient: '+61412345678', body: 'Reminder' }) as any;

  it('a US salon still uses the platform sender, untouched', async () => {
    const { svc, platform } = live('US', null);
    expect((await send(svc)).status).toBe('SENT');
    expect(platform.sendSms).toHaveBeenCalled();
  });

  it("with no shared number, an Australian salon falls back to its own +61 hotline number, never the US one", async () => {
    const { svc, platform, sent } = live('AU', '+61298765432');
    await send(svc);
    expect(platform.sendSms).not.toHaveBeenCalled();
    expect(decodeURIComponent(sent[0] ?? '')).toContain('From=+61298765432');
  });

  it('with the shared Australian number set, every Australian salon texts from it', async () => {
    process.env.TWILIO_FROM_NUMBER_AU = '+61400000000';
    const { svc, platform, sent } = live('AU', '+61298765432');
    await send(svc);
    delete process.env.TWILIO_FROM_NUMBER_AU;
    expect(platform.sendSms).not.toHaveBeenCalled();
    expect(decodeURIComponent(sent[0] ?? '')).toContain('From=+61400000000');
  });

  it('an Australian salon with no +61 number is refused with a reason, never sent from +1', async () => {
    const { svc, platform } = live('AU', null);
    const n = await send(svc);
    expect(platform.sendSms).not.toHaveBeenCalled();
    expect(n.status).toBe('FAILED');
    expect(n.error).toMatch(/\+61/);
  });

  it('a Vietnamese salon without eSMS is refused, not sent into a carrier block', async () => {
    const { svc, platform } = live('VN', null);
    const n = await send(svc);
    expect(platform.sendSms).not.toHaveBeenCalled();
    expect(n.error).toMatch(/eSMS/);
  });
});
