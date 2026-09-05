import { supportMaySee, supportCapFor, SUPPORT_HREF_CAP } from './support-scope';

const CONTENT = ['marketing', 'reviews'];
const SETUP = ['services', 'products', 'staff', 'reviews', 'marketing', 'notifications', 'integrations', 'settings'];
const FULL = Object.values(SUPPORT_HREF_CAP);

describe('what a Lumio setup employee finds in the salon menu', () => {
  it('hides the money from a setup account — the point of the whole change', () => {
    for (const href of [
      '/salon', '/salon/reports', '/salon/pos', '/salon/pos/report', '/salon/orders',
      '/salon/payments', '/salon/card-transactions', '/salon/payment-terminals',
      '/salon/payroll', '/salon/billing', '/salon/inventory', '/salon/chain',
    ]) {
      expect(supportMaySee(href, SETUP)).toBe(false);
    }
  });

  it('hides the salon’s customers from a setup account', () => {
    for (const href of ['/salon/customers', '/salon/calendar', '/salon/bookings', '/salon/walkins', '/salon/waitlist', '/salon/activity']) {
      expect(supportMaySee(href, SETUP)).toBe(false);
    }
  });

  it('still lets the setup account set the salon up', () => {
    for (const href of ['/salon/services', '/salon/staff', '/salon/stations', '/salon/settings', '/salon/integrations', '/salon/connections', '/salon/notifications']) {
      expect(supportMaySee(href, SETUP)).toBe(true);
    }
  });

  it('leaves a content account with the marketing and nothing else', () => {
    for (const href of ['/salon/content', '/salon/approve-posts', '/salon/marketing', '/salon/email', '/salon/messenger', '/salon/voice', '/salon/reviews', '/salon/reviews-replies']) {
      expect(supportMaySee(href, CONTENT)).toBe(true);
    }
    for (const href of ['/salon/settings', '/salon/staff', '/salon/services', '/salon/integrations', '/salon/connections']) {
      expect(supportMaySee(href, CONTENT)).toBe(false);
    }
  });

  it('narrows nobody who holds everything', () => {
    for (const href of Object.keys(SUPPORT_HREF_CAP)) expect(supportMaySee(href, FULL)).toBe(true);
  });

  it('never locks anyone out of their own account or the way back', () => {
    // A menu that can strand an employee in a salon with no exit is worse than
    // one that shows a screen too many.
    expect(supportMaySee('/salon/account', [])).toBe(true);
    expect(supportMaySee('/agency', [])).toBe(true);
  });

  it('covers the screens that carry no capability in the salon’s own menu', () => {
    // These four are uncapped in SalonShell on purpose — a receptionist has to
    // reach the inbox — which is exactly why they need an entry here.
    for (const href of ['/salon/activity', '/salon/connections', '/salon/card-transactions', '/salon/inbox']) {
      expect(supportCapFor(href)).not.toBeNull();
    }
  });

  it('does not let one spelling claim another screen', () => {
    expect(supportCapFor('/salon/reviews-replies')).toBe('reviews');
    expect(supportCapFor('/salon/pos/report')).toBe('reports');
    expect(supportCapFor('/salon/pos')).toBe('pos');
    expect(supportCapFor('/salon/marketing/monthly')).toBe('marketing');
  });
});
