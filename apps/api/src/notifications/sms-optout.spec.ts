import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

/**
 * The consent net under every marketing SMS (VN market only — US/CA never
 * enter the gate), and the opt-out recorder that feeds it.
 */
function makePrisma(over: Record<string, any> = {}) {
  return {
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'UTC', market: 'VN' })) },
    setting: { findFirst: jest.fn(async () => null) },
    customer: {
      findFirst: jest.fn(async () => ({ smsConsent: false })),
      updateMany: jest.fn(async () => ({ count: 2 })),
    },
    notification: {
      create: jest.fn(async ({ data }: any) => ({ id: 'n-1', ...data })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    ...over,
  };
}

describe('marketing SMS consent gate (VN)', () => {
  afterEach(() => jest.useRealTimers());

  it('holds a marketing SMS to a customer who has not consented', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);
    const notif: any = await svc.send({
      tenantId: 't-vn', channel: NotificationChannel.SMS, kind: 'marketing',
      recipient: '0901888484', body: 'Uu dai thang 9!', relatedType: 'rebooking', relatedId: 'r1',
    });
    expect(notif.status).toBe('FAILED');
    expect(notif.provider).toBe('sms-policy');
    expect(notif.error).toContain('Nghị định 91');
  });

  it('lets a consented customer through (inside the ad window)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T12:00:00Z')); // 12:00 UTC = in-window for a UTC-tz tenant
    const prisma = makePrisma({
      customer: { findFirst: jest.fn(async () => ({ smsConsent: true })), updateMany: jest.fn() },
    });
    const svc = new NotificationsService(prisma as any);
    const notif: any = await svc.send({
      tenantId: 't-vn', channel: NotificationChannel.SMS, kind: 'marketing',
      recipient: '0901888484', body: 'Uu dai thang 9!',
    });
    expect(notif.provider).not.toBe('sms-policy');
    expect(notif.status).toBe('SENT'); // mock provider outside production
  });

  it('never holds a transactional SMS, consent or not', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);
    const notif: any = await svc.send({
      tenantId: 't-vn', channel: NotificationChannel.SMS,
      recipient: '0901888484', body: 'Lich hen da xac nhan.',
    });
    expect(notif.provider).not.toBe('sms-policy');
    // The consent lookup must not even run for a receipt.
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });
});

describe('recordSmsOptOut', () => {
  it('clears smsConsent for every customer record on that number', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);
    const n = await svc.recordSmsOptOut('t-vn', '0901888484');
    expect(n).toBe(2);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't-vn', phone: '0901888484' },
      data: { smsConsent: false },
    });
  });

  it('is a safe no-op on an empty phone or a database error', async () => {
    const svc = new NotificationsService(makePrisma() as any);
    expect(await svc.recordSmsOptOut('t-vn', '')).toBe(0);
    const broken = makePrisma({ customer: { findFirst: jest.fn(), updateMany: jest.fn(async () => { throw new Error('down'); }) } });
    expect(await new NotificationsService(broken as any).recordSmsOptOut('t-vn', '090')).toBe(0);
  });
});
