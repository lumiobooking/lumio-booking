import { SettingsService } from './settings.service';

/**
 * "Set up once for all of Vietnam": with Lumio's shared Zalo/SMS channel
 * live, VN salons confirm bookings by default — without any setting — while
 * an explicit "off" and every non-VN salon stay exactly as they were.
 */
function makeService(market: string, stored: Record<string, unknown> = {}) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ market })) },
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const v = stored[where?.tenantId_key?.key];
        return v ? { value: v } : null;
      }),
    },
  };
  return new SettingsService(prisma as any, { log: jest.fn() } as any);
}

const KEYS = ['ESMS_API_KEY', 'ESMS_SECRET_KEY', 'ESMS_BRANDNAME', 'ESMS_ZNS_OAID', 'ESMS_ZNS_BOOKING_TEMP_ID', 'ESMS_ZNS_REMINDER_TEMP_ID'];
function sharedOn() {
  process.env.ESMS_API_KEY = 'k'; process.env.ESMS_SECRET_KEY = 's';
  process.env.ESMS_ZNS_OAID = 'oa'; process.env.ESMS_ZNS_BOOKING_TEMP_ID = 'b';
}

describe("Lumio's shared Vietnamese Zalo/SMS channel", () => {
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });

  it('a VN salon that never touched the switch confirms bookings by default', async () => {
    sharedOn();
    const svc = makeService('VN');
    expect((await svc.getNotificationSettings('t')).smsCustomerOnBooking).toBe(true);
    expect((await svc.getNotificationTemplates('t'))['customer_booking_confirmed'].sms).toBe(true);
  });

  it("a VN salon's explicit off is kept", async () => {
    sharedOn();
    const svc = makeService('VN', {
      notifications: { smsCustomerOnBooking: false },
      notification_templates: { customer_booking_confirmed: { sms: false } },
    });
    expect((await svc.getNotificationSettings('t')).smsCustomerOnBooking).toBe(false);
    expect((await svc.getNotificationTemplates('t'))['customer_booking_confirmed'].sms).toBe(false);
  });

  it('nothing changes while the shared channel is not configured', async () => {
    const svc = makeService('VN');
    expect((await svc.getNotificationSettings('t')).smsCustomerOnBooking).toBe(false);
  });

  it('US salons are untouched even with the shared channel live', async () => {
    sharedOn();
    const svc = makeService('US');
    expect((await svc.getNotificationSettings('t')).smsCustomerOnBooking).toBe(false);
    expect((await svc.getNotificationTemplates('t'))['customer_booking_confirmed'].sms).toBe(false);
  });
});
