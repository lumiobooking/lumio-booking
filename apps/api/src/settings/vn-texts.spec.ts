import { SettingsService } from './settings.service';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_TEMPLATES,
  VN_NOTIFICATION_TEXTS,
  VN_TEMPLATE_TEXTS,
} from './settings.constants';

/**
 * The Vietnamese copy overlay. The rule under test: market VN + untouched
 * field → Vietnamese; any customised field → the salon's own words; any other
 * market → byte-for-byte the English defaults, because 25 live US salons are
 * not part of this launch.
 */
function makeService(market: string, storedNotifications?: Record<string, unknown>) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ market })) },
    setting: {
      findUnique: jest.fn(async ({ where }: any) =>
        where?.tenantId_key?.key === 'notifications' && storedNotifications
          ? { value: storedNotifications }
          : null),
    },
  };
  return new SettingsService(prisma as any, { log: jest.fn() } as any);
}

describe('Vietnamese notification copy overlay', () => {
  it('serves Vietnamese defaults to a VN salon that customised nothing', async () => {
    const svc = makeService('VN');
    const n = await svc.getNotificationSettings('t-vn');
    expect(n.market).toBe('VN');
    expect(n.smsCustomer).toBe(VN_NOTIFICATION_TEXTS.smsCustomer);
    expect(n.emailSubjectCustomer).toBe(VN_NOTIFICATION_TEXTS.emailSubjectCustomer);
  });

  it('never overwrites a field the salon edited', async () => {
    const svc = makeService('VN', { smsCustomer: 'Tiem em cam on quy khach!' });
    const n = await svc.getNotificationSettings('t-vn');
    expect(n.smsCustomer).toBe('Tiem em cam on quy khach!');
    // The untouched fields still translate.
    expect(n.smsAdmin).toBe(VN_NOTIFICATION_TEXTS.smsAdmin);
  });

  it('leaves a US salon exactly on the English defaults', async () => {
    const svc = makeService('US');
    const n = await svc.getNotificationSettings('t-us');
    expect(n.market).toBe('US');
    expect(n.smsCustomer).toBe(DEFAULT_NOTIFICATION_SETTINGS.smsCustomer);
    expect(n.emailFooter).toBe(DEFAULT_NOTIFICATION_SETTINGS.emailFooter);
  });

  it('falls back to US behaviour when the tenant cannot be read', async () => {
    const prisma = {
      tenant: { findUnique: jest.fn(async () => { throw new Error('down'); }) },
      setting: { findUnique: jest.fn(async () => null) },
    };
    const svc = new SettingsService(prisma as any, { log: jest.fn() } as any);
    const n = await svc.getNotificationSettings('t-x');
    expect(n.market).toBe('US');
    expect(n.smsCustomer).toBe(DEFAULT_NOTIFICATION_SETTINGS.smsCustomer);
  });

  it('translates the template catalog for VN and keeps salon edits + staff alerts', async () => {
    const svc = makeService('VN');
    const tpls = await svc.getNotificationTemplates('t-vn');
    expect(tpls.customer_booking_confirmed.smsBody).toBe(VN_TEMPLATE_TEXTS.customer_booking_confirmed.smsBody);
    expect(tpls.customer_reminder.subject).toBe(VN_TEMPLATE_TEXTS.customer_reminder.subject);
    // Staff alerts are deliberately not in the VN catalog.
    expect(tpls.staff_new_booking.smsBody).toBe(DEFAULT_NOTIFICATION_TEMPLATES.staff_new_booking.smsBody);
  });

  it('every VN SMS default is unaccented and fits one 160-char segment before fill', () => {
    const bodies = [
      VN_NOTIFICATION_TEXTS.smsCustomer as string,
      VN_NOTIFICATION_TEXTS.smsAdmin as string,
      ...Object.values(VN_TEMPLATE_TEXTS).map((t) => t.smsBody).filter((x): x is string => !!x),
    ];
    for (const b of bodies) {
      expect(b.split('').every((c) => c.charCodeAt(0) <= 127)).toBe(true);
      expect(b.length).toBeLessThanOrEqual(160);
    }
  });
});
