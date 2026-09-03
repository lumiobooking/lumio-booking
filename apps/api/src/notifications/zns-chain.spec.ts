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
