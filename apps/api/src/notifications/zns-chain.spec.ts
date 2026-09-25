import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

/**
 * The ZNS-first chain: Zalo when configured, SMS as the net, and nothing at
 * all changed for anyone who is not a VN salon with a ZNS template.
 */
const ZNS_URL = 'https://rest.esms.vn/MainService.svc/json/SendZaloMessage_V6/';
const SMS_URL = 'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/';

const FULL_ESMS = {
  apiKey: 'k', secretKey: 's', brandname: 'LUMIO',
  oaid: 'oa-1', znsBookingTempId: 'temp-9', znsReminderTempId: '',
};

function makePrisma(market = 'VN', esms: Record<string, string> | null = FULL_ESMS) {
  return {
    tenant: { findUnique: jest.fn(async () => ({ market, timezone: market === 'VN' ? 'Asia/Ho_Chi_Minh' : 'America/New_York' })) },
    setting: {
      findFirst: jest.fn(async ({ where }: any) =>
        where?.key === 'notifications' && esms ? { value: { esms } } : null),
    },
    customer: { findFirst: jest.fn(async () => null) },
    notification: { create: jest.fn(async ({ data }: any) => ({ ...data })), findMany: jest.fn(async () => []) },
  };
}

function mockFetch(answers: Record<string, unknown>[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
    const data = answers[calls.length - 1] ?? { CodeResult: '99' };
    return { json: async () => data } as any;
  });
  return calls;
}

const INPUT = {
  tenantId: 't-vn',
  channel: NotificationChannel.SMS,
  recipient: '0901888484',
  body: 'LUMIO: Lich hen Gel-X ngay 05/09 luc 14:00 da duoc xac nhan. Hen gap ban!',
  zns: {
    kind: 'booking_confirmed' as const,
    params: { customer_name: 'Lan', salon_name: 'LUMIO', service_name: 'Gel-X', appointment_date: '05/09', appointment_time: '14:00' },
  },
};

describe('ZNS-first delivery chain', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  it('sends through Zalo ZNS when the salon configured it', async () => {
    const calls = mockFetch([{ CodeResult: '100', SMSID: 'zid-1' }]);
    const svc = new NotificationsService(makePrisma() as any);
    const notif: any = await svc.send({ ...INPUT });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ZNS_URL);
    expect(calls[0].body.OAID).toBe('oa-1');
    expect(calls[0].body.TempID).toBe('temp-9');
    expect(calls[0].body.TempData).toEqual(INPUT.zns.params);
    expect(String(calls[0].body.CallbackUrl)).toContain('/api/public/esms/callback');
    expect(notif.provider).toBe('zalo-zns');
    expect(notif.status).toBe('SENT');
    expect(notif.providerMessageId).toBe('zid-1');
  });

  it('falls back to brandname SMS when ZNS refuses, with a fresh RequestId', async () => {
    const calls = mockFetch([
      { CodeResult: '789', ErrorMessage: 'TemplateId is not config' },
      { CodeResult: '100', SMSID: 'sid-2' },
    ]);
    const svc = new NotificationsService(makePrisma() as any);
    const notif: any = await svc.send({ ...INPUT });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(SMS_URL);
    // The failed ZNS try must not poison the SMS fallback as a 24h duplicate.
    expect(calls[0].body.RequestId).not.toBe(calls[1].body.RequestId);
    expect(notif.provider).toBe('esms');
    expect(notif.status).toBe('SENT');
    expect(notif.providerMessageId).toBe('sid-2');
  });

  it('goes straight to SMS when no template id is configured for that kind', async () => {
    const calls = mockFetch([{ CodeResult: '100', SMSID: 'sid-3' }]);
    const svc = new NotificationsService(makePrisma() as any);
    const notif: any = await svc.send({ ...INPUT, zns: { kind: 'reminder', params: {} } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SMS_URL);
    expect(notif.provider).toBe('esms');
  });

  it('never even tries ZNS for a non-VN salon', async () => {
    const calls = mockFetch([]);
    const svc = new NotificationsService(makePrisma('US', null) as any);
    const notif: any = await svc.send({ ...INPUT, tenantId: 't-us', recipient: '+15550001111' });

    expect(calls).toHaveLength(0); // mock SMS provider, no eSMS traffic at all
    expect(notif.provider).toBe('mock');
  });
});

describe("Lumio's shared Zalo OA for every Vietnamese salon", () => {
  const realFetch = global.fetch;
  const KEYS = ['ESMS_API_KEY', 'ESMS_SECRET_KEY', 'ESMS_BRANDNAME', 'ESMS_ZNS_OAID', 'ESMS_ZNS_BOOKING_TEMP_ID', 'ESMS_ZNS_REMINDER_TEMP_ID'];
  beforeEach(() => {
    process.env.ESMS_API_KEY = 'pk'; process.env.ESMS_SECRET_KEY = 'ps';
    process.env.ESMS_ZNS_OAID = 'oa-lumio'; process.env.ESMS_ZNS_BOOKING_TEMP_ID = 'tpl-book';
  });
  afterEach(() => { (global as any).fetch = realFetch; for (const k of KEYS) delete process.env[k]; });

  it('a VN salon with no eSMS setup of its own confirms through the shared OA', async () => {
    const calls = mockFetch([{ CodeResult: '100', SMSID: 'z-shared' }]);
    const svc = new NotificationsService(makePrisma('VN', null) as any);
    const notif: any = await svc.send({ ...INPUT });
    expect(calls[0].url).toBe(ZNS_URL);
    expect(calls[0].body.OAID).toBe('oa-lumio');
    expect(calls[0].body.TempID).toBe('tpl-book');
    expect(calls[0].body.ApiKey).toBe('pk');
    expect(notif.provider).toBe('zalo-zns');
    expect(notif.status).toBe('SENT');
  });

  it('a salon with its own eSMS keeps its own OA', async () => {
    const calls = mockFetch([{ CodeResult: '100', SMSID: 'z-own' }]);
    const svc = new NotificationsService(makePrisma('VN', FULL_ESMS) as any);
    await svc.send({ ...INPUT });
    expect(calls[0].body.OAID).toBe('oa-1');
  });

  it('Zalo-only (no shared brandname): a failed ZNS is recorded as failed, no SMS attempted', async () => {
    const calls = mockFetch([{ CodeResult: '146', ErrorMessage: 'user not on Zalo' }]);
    const svc = new NotificationsService(makePrisma('VN', null) as any);
    const notif: any = await svc.send({ ...INPUT });
    expect(calls).toHaveLength(1);
    expect(notif.status).toBe('FAILED');
    expect(String(notif.error)).toContain('ESMS_BRANDNAME');
  });

  it('with a shared brandname set, a failed ZNS falls back to SMS', async () => {
    process.env.ESMS_BRANDNAME = 'LUMIO';
    const calls = mockFetch([{ CodeResult: '146' }, { CodeResult: '100', SMSID: 's-shared' }]);
    const svc = new NotificationsService(makePrisma('VN', null) as any);
    const notif: any = await svc.send({ ...INPUT });
    expect(calls[1].url).toBe(SMS_URL);
    expect(calls[1].body.Brandname).toBe('LUMIO');
    expect(notif.status).toBe('SENT');
  });

  it('US salons never touch the shared VN account', async () => {
    const calls = mockFetch([]);
    const svc = new NotificationsService(makePrisma('US', null) as any);
    const notif: any = await svc.send({ ...INPUT, tenantId: 't-us', recipient: '+15550001111' });
    expect(calls).toHaveLength(0);
    expect(notif.provider).toBe('mock');
  });
});

describe('Vietnamese adverts never ride the customer-care brandname', () => {
  const realFetch = global.fetch;
  // Midday in Hanoi, so the 07:00–22:00 advertising window is not what holds it.
  beforeEach(() => { jest.useFakeTimers({ now: new Date('2026-09-25T05:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] }); });
  afterEach(() => { jest.useRealTimers(); (global as any).fetch = realFetch; delete process.env.ESMS_API_KEY; delete process.env.ESMS_SECRET_KEY; delete process.env.ESMS_BRANDNAME; });

  it('a remarketing SMS is held with a reason, and nothing reaches eSMS', async () => {
    process.env.ESMS_API_KEY = 'k'; process.env.ESMS_SECRET_KEY = 's'; process.env.ESMS_BRANDNAME = 'LUMIO';
    const calls = mockFetch([]);
    const prisma: any = makePrisma('VN', null);
    prisma.customer.findFirst = jest.fn(async () => null);
    const svc = new NotificationsService(prisma);
    const notif: any = await svc.send({ tenantId: 't-vn', channel: NotificationChannel.SMS, kind: 'marketing', recipient: '0901888484', body: 'Uu dai 20%' } as any);
    expect(calls).toHaveLength(0);
    expect(notif.status).toBe('FAILED');
    expect(notif.provider).toBe('sms-policy');
    expect(String(notif.error)).toContain('QC');
  });
});
