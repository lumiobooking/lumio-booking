/**
 * Booking messages reach the people the salon asked for:
 *  - "SMS / Email the customer when they book" in Settings counts, even when
 *    the "Booking confirmed" template's own box is still at its default (off),
 *  - the owner's alert never goes to a no-reply address: the salon's contact
 *    email, then the owner's login, come before giving up,
 *  - saving either switch keeps the other in step,
 *  - all of it inside ONE salon.
 */
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_NOTIFICATION_TEMPLATES, NOTIFICATION_SETTINGS_KEY, NOTIFICATION_TEMPLATES_KEY } from '../settings/settings.constants';
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(o: { tplSms?: boolean; tplEmail?: boolean; smsCust?: boolean; emailCust?: boolean; adminEmail?: string; senderEmail?: string; contactEmail?: string | null; ownerEmail?: string | null } = {}) {
  const sent: Row[] = [];
  const userQueries: Row[] = [];
  const templates = {
    ...DEFAULT_NOTIFICATION_TEMPLATES,
    customer_booking_confirmed: { ...DEFAULT_NOTIFICATION_TEMPLATES.customer_booking_confirmed, sms: o.tplSms ?? false, email: o.tplEmail ?? true },
  };
  const n = {
    ...DEFAULT_NOTIFICATION_SETTINGS, market: 'US', emailAdminOnBooking: true, smsAdminOnBooking: false,
    smsCustomerOnBooking: o.smsCust ?? false, emailCustomerOnBooking: o.emailCust ?? true,
    adminEmail: o.adminEmail ?? '', senderEmail: o.senderEmail ?? 'noreply@lumiobooking.com',
    smtp: {}, brevo: {}, gmail: {}, twilio: {},
  };
  const svc = Object.create(BookingsService.prototype) as Row;
  Object.assign(svc, {
    settings: {
      getNotificationSettings: async () => n, getNotificationTemplates: async () => templates,
      brandingFrom: () => ({ accentColor: '#000000' }), getCompanyExtra: async () => ({ address: '' }),
    },
    prisma: {
      tenant: { findUnique: async () => ({ name: 'April’s Nail & Spa', timezone: 'America/Chicago', contactEmail: o.contactEmail ?? null }) },
      staffMember: { findMany: async () => [] },
      user: { findFirst: async (a: Row) => { userQueries.push(a); return o.ownerEmail ? { email: o.ownerEmail } : null; } },
    },
    referral: { getForTenant: async () => ({ enabled: false }) },
    notifications: { send: jest.fn(async (m: Row) => { sent.push(m); }) },
    push: { sendToTenant: jest.fn(async () => undefined) },
    customerLocale: async () => 'en-US',
    apptToken: () => 'tok',
  });
  return { svc, sent, userQueries };
}
const appt = {
  id: '3f2b8c1e-9d4a-4b7e-8a21-5c6d7e8f9a0b', startTime: new Date('2030-03-09T23:00:00Z'), endTime: new Date('2030-03-10T00:00:00Z'), priceCents: 5500, currency: 'USD', addons: [], notes: null, source: 'hosted',
  customer: { id: 'c1', firstName: 'Rhonda', lastName: null, email: 'rhonda@x.test', phone: '+12105550100' },
  service: { name: 'Gel Manicure' }, assignedStaff: null, status: 'PENDING',
};

describe('the customer confirmation honours either switch', () => {
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-booking-delivery'; });
  afterAll(() => { process.env.JWT_SECRET = prevSecret; });

  it('Settings "SMS the customer" ON sends the text, though the template box is still off', async () => {
    const { svc, sent } = make({ smsCust: true, tplSms: false });
    await svc.sendBookingConfirmation('april', appt);
    expect(sent.some((m) => m.channel === 'SMS' && m.recipient === appt.customer.phone)).toBe(true);
  });

  it('both off sends no text (nothing changes for a salon that never asked)', async () => {
    const { svc, sent } = make({ smsCust: false, tplSms: false });
    await svc.sendBookingConfirmation('april', appt);
    expect(sent.some((m) => m.channel === 'SMS')).toBe(false);
  });

  it('the template box alone still works', async () => {
    const { svc, sent } = make({ smsCust: false, tplSms: true });
    await svc.sendBookingConfirmation('april', appt);
    expect(sent.some((m) => m.channel === 'SMS' && m.recipient === appt.customer.phone)).toBe(true);
  });
});

describe("the owner's alert reaches a real inbox", () => {
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-booking-delivery'; });
  afterAll(() => { process.env.JWT_SECRET = prevSecret; });
  const ownerMail = (sent: Row[]) => sent.find((m) => m.channel === 'EMAIL' && /New booking|Lịch đặt mới/.test(String(m.subject)) || (m.channel === 'EMAIL' && m.recipient !== appt.customer.email));

  it('never mails noreply@ — the salon contact email comes next', async () => {
    const { svc, sent } = make({ adminEmail: '', senderEmail: 'noreply@lumiobooking.com', contactEmail: 'april@salon.test' });
    await svc.sendBookingConfirmation('april', appt);
    expect(ownerMail(sent)?.recipient).toBe('april@salon.test');
    expect(sent.some((m) => /noreply@/i.test(String(m.recipient)))).toBe(false);
  });

  it("then the owner's own login — looked up inside this salon only", async () => {
    const { svc, sent, userQueries } = make({ adminEmail: '', contactEmail: null, ownerEmail: 'owner@zb.test' });
    await svc.sendBookingConfirmation('zb-salon', appt);
    expect(ownerMail(sent)?.recipient).toBe('owner@zb.test');
    expect(userQueries[0].where).toMatchObject({ tenantId: 'zb-salon', role: 'SALON_ADMIN' });
  });

  it('the Admin email always wins', async () => {
    const { svc, sent, userQueries } = make({ adminEmail: 'boss@salon.test', contactEmail: 'front@salon.test', ownerEmail: 'login@salon.test' });
    await svc.sendBookingConfirmation('april', appt);
    expect(ownerMail(sent)?.recipient).toBe('boss@salon.test');
    expect(userQueries).toHaveLength(0);
  });
});

describe('saving one switch keeps the other in step', () => {
  function settings(stored: Record<string, Row>) {
    const writes: Row[] = [];
    const prisma = {
      tenant: { findUnique: jest.fn(async () => ({ market: 'US' })) },
      setting: {
        findUnique: jest.fn(async ({ where }: Row) => (stored[`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`] ? { value: stored[`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`] } : null)),
        upsert: jest.fn(async ({ where, update }: Row) => { stored[`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`] = update.value; writes.push({ ...where.tenantId_key }); return {}; }),
        findFirst: jest.fn(async () => null),
      },
    };
    const svc = new SettingsService(prisma as never, { log: jest.fn(async () => undefined) } as never);
    (svc as unknown as { get: unknown }).get = async () => ({});
    return { svc, stored, writes };
  }
  const owner = (tenantId: string) => ({ userId: 'u1', role: 'SALON_ADMIN', tenantId }) as never;

  it('Settings → template', async () => {
    const { svc, stored } = settings({});
    await svc.updateNotifications(owner('april'), { smsCustomerOnBooking: true } as never);
    expect(stored[`april|${NOTIFICATION_TEMPLATES_KEY}`].customer_booking_confirmed.sms).toBe(true);
  });

  it('template → Settings, touching nothing else and no other salon', async () => {
    const { svc, stored, writes } = settings({ [`april|${NOTIFICATION_SETTINGS_KEY}`]: { adminEmail: 'boss@salon.test', smsCustomerOnBooking: true } });
    await svc.updateNotificationTemplates(owner('april'), { templates: { customer_booking_confirmed: { ...DEFAULT_NOTIFICATION_TEMPLATES.customer_booking_confirmed, sms: false } } });
    expect(stored[`april|${NOTIFICATION_SETTINGS_KEY}`]).toEqual({ adminEmail: 'boss@salon.test', smsCustomerOnBooking: false, emailCustomerOnBooking: true });
    expect(writes.every((w) => w.tenantId === 'april')).toBe(true);
  });
});
