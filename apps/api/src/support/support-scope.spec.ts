import {
  capsForLevel, levelOf, capForApiPath, supportMayCall, normalizePath, isPrivateCap,
  SUPPORT_LEVELS, type SupportLevel,
} from './support-scope';
import { ALL_CAPS } from '../auth/capabilities';

describe('what each level of setup employee is allowed to see', () => {
  it('full is the salon owner, unchanged', () => {
    expect(capsForLevel('full').sort()).toEqual([...ALL_CAPS].sort());
  });

  it.each(['content', 'setup'] as SupportLevel[])(
    '%s sees no money: no dashboard, no POS, no payments, no payroll, no reports, no billing',
    (level) => {
      const caps = capsForLevel(level);
      for (const money of ['dashboard', 'pos', 'orders', 'payments', 'payroll', 'reports', 'billing', 'inventory']) {
        expect(caps).not.toContain(money);
      }
    },
  );

  it.each(['content', 'setup'] as SupportLevel[])(
    '%s sees no client data: no customer list, no appointments, no walk-ins, no waitlist',
    (level) => {
      const caps = capsForLevel(level);
      for (const priv of ['customers', 'calendar', 'bookings', 'walkins', 'waitlist']) {
        expect(caps).not.toContain(priv);
      }
    },
  );

  it('setup can still do the setup: services, staff, channels, settings', () => {
    const caps = capsForLevel('setup');
    expect(caps).toEqual(expect.arrayContaining(['services', 'staff', 'integrations', 'settings', 'notifications']));
  });

  it('content is marketing and reviews, and nothing else', () => {
    expect(capsForLevel('content').sort()).toEqual(['marketing', 'reviews']);
  });

  it('an unknown or missing level reads as setup, never as full', () => {
    // The rows that existed before this column did were made when a setup
    // account saw everything. Reading them as "full" would keep exactly the
    // problem this was written to end.
    expect(levelOf(null)).toBe('setup');
    expect(levelOf(undefined)).toBe('setup');
    expect(levelOf('')).toBe('setup');
    expect(levelOf('admin')).toBe('setup');
    expect(levelOf('FULL')).toBe('full');
    expect(levelOf(' content ')).toBe('content');
  });

  it('every level offered on screen is one the code understands', () => {
    for (const l of SUPPORT_LEVELS) expect(levelOf(l.id)).toBe(l.id);
  });
});

describe('which capability owns an API path', () => {
  it('strips the prefix, the query and the leading slash', () => {
    expect(normalizePath('/api/customers?page=2')).toBe('customers');
    expect(normalizePath('https://api.lumio.app/payments/123')).toBe('payments/123');
    expect(normalizePath('/bookings/')).toBe('bookings');
  });

  it('gives the longest match, so pos/report is a report and not the till', () => {
    expect(capForApiPath('/pos/report/day')).toBe('reports');
    expect(capForApiPath('/pos/sale')).toBe('pos');
  });

  it('leaves sign-in, uploads and the employee’s own account alone', () => {
    for (const p of ['/auth/login', '/me', '/uploads/service-photo', '/health', '/feature-policy', '/support/tenants']) {
      expect(capForApiPath(p)).toBeNull();
    }
  });

  it('does not let one prefix swallow a different screen', () => {
    expect(capForApiPath('/reviews/sends')).toBe('reviews');
    expect(capForApiPath('/google-reviews/sync')).toBe('reviews');
    expect(capForApiPath('/services')).toBe('services');
  });
});

describe('the door itself', () => {
  it('refuses money and client data to a content account, read AND write', () => {
    for (const p of ['/customers', '/bookings', '/payments', '/pos/report', '/billing/status', '/stats/sources', '/overview', '/activity']) {
      expect(supportMayCall('content', 'GET', p)).toBe(false);
      expect(supportMayCall('content', 'POST', p)).toBe(false);
    }
  });

  it('refuses the same to a setup account — this is the point of the whole change', () => {
    for (const p of [
      '/customers/abc', '/payments', '/payments-hub/intents', '/billing/subscribe',
      '/overview/dashboard', '/stats/sources', '/pos/report', '/supplies',
      // Per-technician takings: money wearing a staff URL. `setup` has the
      // staff capability and must still be refused this one.
      '/staff/performance',
    ]) {
      expect(supportMayCall('setup', 'GET', p)).toBe(false);
    }
  });

  it('lets a content account READ the salon settings every screen needs', () => {
    // Half the screens fetch /settings for the currency symbol. Refusing this
    // read would hand the employee a broken page instead of a closed door.
    expect(supportMayCall('content', 'GET', '/settings')).toBe(true);
    expect(supportMayCall('content', 'GET', '/services')).toBe(true);
    expect(supportMayCall('content', 'GET', '/staff')).toBe(true);
  });

  it('but not change them', () => {
    expect(supportMayCall('content', 'PATCH', '/settings')).toBe(false);
    expect(supportMayCall('content', 'POST', '/services')).toBe(false);
    expect(supportMayCall('content', 'POST', '/staff/abc/password')).toBe(false);
  });

  it('lets a content account save the two settings its own screens own', () => {
    // The marketing screen plans from the business profile and saves it; the
    // review screen saves its own rules. A page you can open and cannot save
    // is worse than one you cannot open.
    expect(supportMayCall('content', 'PATCH', '/settings/business-profile')).toBe(true);
    expect(supportMayCall('content', 'PATCH', '/settings/review')).toBe(true);
    // …and still not the salon's own configuration.
    expect(supportMayCall('content', 'PATCH', '/settings/weekday-discounts')).toBe(false);
  });

  it('lets a content account do the marketing it exists to do', () => {
    for (const p of ['/content/posts', '/marketing/report', '/messenger/settings', '/voice/settings', '/google-reviews/sync', '/email-campaigns']) {
      expect(supportMayCall('content', 'POST', p)).toBe(true);
    }
  });

  it('lets a setup account set the salon up', () => {
    for (const p of ['/services', '/staff', '/settings', '/integrations', '/notifications', '/api-keys']) {
      expect(supportMayCall('setup', 'POST', p)).toBe(true);
    }
    // …and the staff list is still the staff list.
    expect(supportMayCall('setup', 'GET', '/staff')).toBe(true);
  });

  it('leaves a full account exactly where it was', () => {
    for (const p of ['/customers', '/payments', '/billing/subscribe', '/pos/report', '/settings']) {
      expect(supportMayCall('full', 'POST', p)).toBe(true);
    }
  });

  it('never treats a support session worse than an anonymous visitor', () => {
    // These endpoints answer the salon's own customers with no token at all.
    for (const p of ['/public/salons/lux-nails', '/public/review', '/public/appt/abc']) {
      expect(supportMayCall('content', 'POST', p)).toBe(true);
    }
  });

  it('money and client data are the private ones; the rest are merely out of scope', () => {
    expect(isPrivateCap('customers')).toBe(true);
    expect(isPrivateCap('payroll')).toBe(true);
    expect(isPrivateCap('settings')).toBe(false);
    expect(isPrivateCap('services')).toBe(false);
  });
});
