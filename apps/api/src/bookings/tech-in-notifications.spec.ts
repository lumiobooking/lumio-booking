/**
 * Friendly nails: the owner wants the technician in every booking message.
 *  - Messages saved verbatim from an OLDER default (which had no technician)
 *    follow today's default, which names the technician — any market.
 *  - A booking confirmed as "to be assigned" that later gets a technician
 *    tells the customer who (customer_staff_assigned), on the channels the
 *    confirmation uses, and nobody else.
 *  - The owner's push names who, what, when and the technician.
 */
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_NOTIFICATION_TEMPLATES, LEGACY_NOTIFICATION_DEFAULTS, LEGACY_TEMPLATE_DEFAULTS, NOTIFICATION_SETTINGS_KEY, NOTIFICATION_TEMPLATES_KEY } from '../settings/settings.constants';
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function settingsWith(market: string, stored: Record<string, unknown>) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ market })) },
    setting: { findUnique: jest.fn(async ({ where }: Row) => (stored[where.tenantId_key.key] ? { value: stored[where.tenantId_key.key] } : null)) },
  };
  return new SettingsService(prisma as never, { log: jest.fn() } as never);
}

describe('older default text follows today\'s (which names the technician)', () => {
  it('a US salon carrying the old SMS verbatim gets the technician', async () => {
    const svc = settingsWith('US', { [NOTIFICATION_SETTINGS_KEY]: { smsCustomer: LEGACY_NOTIFICATION_DEFAULTS.smsCustomer![0], smsAdmin: LEGACY_NOTIFICATION_DEFAULTS.smsAdmin![0] } });
    const n = await svc.getNotificationSettings('t1');
    expect(n.smsCustomer).toBe(DEFAULT_NOTIFICATION_SETTINGS.smsCustomer);
    expect(n.smsCustomer).toContain('{technician}');
    expect(n.smsAdmin).toContain('{technician}');
  });
  it('the old confirmation template too; an edited one is kept', async () => {
    const old = LEGACY_TEMPLATE_DEFAULTS.customer_booking_confirmed.smsBody![0];
    const t1 = await settingsWith('CA', { [NOTIFICATION_TEMPLATES_KEY]: { customer_booking_confirmed: { smsBody: old } } }).getNotificationTemplates('t1');
    expect(t1.customer_booking_confirmed.smsBody).toBe(DEFAULT_NOTIFICATION_TEMPLATES.customer_booking_confirmed.smsBody);
    expect(t1.customer_booking_confirmed.smsBody).toContain('%staff_name%');
    const t2 = await settingsWith('US', { [NOTIFICATION_TEMPLATES_KEY]: { customer_booking_confirmed: { smsBody: 'Our own words' } } }).getNotificationTemplates('t1');
    expect(t2.customer_booking_confirmed.smsBody).toBe('Our own words');
  });
});

describe('sending', () => {
  function make(o: { confirmSms?: boolean; staffTplEnabled?: boolean; market?: string } = {}) {
    const sent: Row[] = [];
    const pushed: Row[] = [];
    const templates = {
      ...DEFAULT_NOTIFICATION_TEMPLATES,
      customer_booking_confirmed: { ...DEFAULT_NOTIFICATION_TEMPLATES.customer_booking_confirmed, sms: o.confirmSms ?? true },
      customer_staff_assigned: { ...DEFAULT_NOTIFICATION_TEMPLATES.customer_staff_assigned, enabled: o.staffTplEnabled ?? true },
    };
    const n = {
      ...DEFAULT_NOTIFICATION_SETTINGS, market: o.market ?? 'CA', emailAdminOnBooking: true, smsAdminOnBooking: true, adminEmail: 'owner@x.test', adminPhone: '+15555550000',
      smtp: {}, brevo: {}, gmail: {}, twilio: {},
    };
    const svc = Object.create(BookingsService.prototype) as Row;
    Object.assign(svc, {
      settings: {
        getNotificationSettings: async () => n, getNotificationTemplates: async () => templates,
        brandingFrom: () => ({ accentColor: '#000000' }), getCompanyExtra: async () => ({ address: '' }),
      },
      prisma: { tenant: { findUnique: async () => ({ name: 'Friendly nails', timezone: 'America/Edmonton' }) }, staffMember: { findMany: async () => [] } },
      referral: { getForTenant: async () => ({ enabled: false }) },
      notifications: { send: jest.fn(async (m: Row) => { sent.push(m); }) },
      push: { sendToTenant: jest.fn(async (_t: string, p: Row) => { pushed.push(p); }) },
      customerLocale: async () => 'en-US',
      apptToken: () => 'tok',
    });
    return { svc, sent, pushed };
  }
  const appt = {
    id: 'appt-123456', startTime: new Date('2030-03-09T23:00:00Z'), endTime: new Date('2030-03-10T00:00:00Z'), priceCents: 5500, currency: 'CAD', addons: [], notes: null, source: 'hosted',
    customer: { id: 'c1', firstName: 'Sarina', lastName: null, email: 'sarina@x.test', phone: '+14035550100' },
    service: { name: 'Solar Fill In' }, assignedStaff: { firstName: 'Lisa', lastName: null }, status: 'ASSIGNED',
  };

  it('the confirmation names the technician to the customer, the owner, and the owner\'s push', async () => {
    const { svc, sent, pushed } = make();
    await svc.sendBookingConfirmation('t1', appt);
    const sms = sent.filter((m) => m.channel === 'SMS');
    expect(sms.find((m) => m.recipient === appt.customer.phone)!.body).toContain('Tech: Lisa');
    expect(sms.find((m) => m.recipient === '+15555550000')!.body).toContain('tech Lisa');
    expect(pushed[0].body).toContain('Sarina');
    expect(pushed[0].body).toContain('👤 Lisa');
  });

  it('technician given later: the customer alone hears who, by email and SMS', async () => {
    const { svc, sent, pushed } = make();
    await svc.sendBookingConfirmation('t1', appt, { techUpdate: true });
    expect(sent.map((m) => m.recipient).sort()).toEqual([appt.customer.phone, appt.customer.email].sort());
    expect(sent.find((m) => m.channel === 'SMS')!.body).toContain('is Lisa');
    expect(pushed).toHaveLength(0);
  });

  it('no SMS update when the salon sends confirmations without SMS; nothing when the event is off', async () => {
    const a = make({ confirmSms: false });
    await a.svc.sendBookingConfirmation('t1', appt, { techUpdate: true });
    expect(a.sent.map((m) => m.channel)).toEqual(['EMAIL']);
    const b = make({ staffTplEnabled: false });
    await b.svc.sendBookingConfirmation('t1', appt, { techUpdate: true });
    expect(b.sent).toHaveLength(0);
  });

  it('never an update without a technician', async () => {
    const { svc, sent } = make();
    await svc.sendBookingConfirmation('t1', { ...appt, assignedStaff: null }, { techUpdate: true });
    expect(sent).toHaveLength(0);
  });
});
