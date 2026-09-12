// SupportService imports password hashing; this file never calls it.
jest.mock('bcrypt', () => ({ hash: async () => 'hashed', compare: async () => true }));

import { capsFor, capsForLevel, cleanCaps, isCustomScope, CAP_CATALOG, isPrivateCap, supportMayCall } from './support-scope';
import { SupportScopeGuard } from './support-scope.guard';
import { SupportService, SUPPORT_ROLE } from './support.service';
import { ALL_CAPS } from '../auth/capabilities';

/**
 * A permission system fails in one direction far worse than the other. Handing
 * somebody a screen they did not need is a mistake; locking the person covering
 * a salon out of every screen at nine on a Saturday is an outage. Both are
 * tested here, and the fallbacks all lean the same way.
 */
describe('an employee who needs a slice the three presets do not cut', () => {
  it('gives exactly the ticked screens and nothing else', () => {
    expect(capsFor('setup', ['marketing', 'calendar'])).toEqual(['calendar', 'marketing']);
  });

  it('replaces the preset rather than adding to it', () => {
    const custom = capsFor('full', ['reviews']);
    expect(custom).toEqual(['reviews']);
    expect(custom.length).toBeLessThan(capsForLevel('full').length);
  });

  it('cannot invent a capability that does not exist', () => {
    expect(capsFor('content', ['marketing', 'superuser', 'DROP TABLE'])).toEqual(['marketing']);
  });

  it('is not case- or whitespace-sensitive, because a form is not', () => {
    expect(cleanCaps([' MARKETING ', 'Reviews'])).toEqual(['reviews', 'marketing']);
  });

  it('returns them in one stable order however they were ticked', () => {
    expect(cleanCaps(['staff', 'calendar', 'pos'])).toEqual(cleanCaps(['pos', 'staff', 'calendar']));
  });

  it('never lets a duplicate widen anything', () => {
    expect(cleanCaps(['marketing', 'marketing', 'marketing'])).toEqual(['marketing']);
  });
});

describe('the fallbacks lean towards the preset, never towards everything', () => {
  it('falls back to the preset when the list is absent', () => {
    expect(capsFor('content')).toEqual(capsForLevel('content'));
    expect(capsFor('setup', null)).toEqual(capsForLevel('setup'));
  });

  it('falls back to the preset when the list is empty — not to a blank app', () => {
    // The alternative reading locks a real person out of every screen on a
    // typo, and it locks out the one covering a salon at the time.
    expect(capsFor('content', [])).toEqual(capsForLevel('content'));
  });

  it('falls back to the preset when every name in the list is junk', () => {
    expect(capsFor('setup', ['nonsense', ''])).toEqual(capsForLevel('setup'));
  });

  it('never turns garbage into full access', () => {
    for (const junk of [undefined, null, [], ['nope'], 'full', 42, {}]) {
      expect(capsFor('content', junk)).not.toEqual(capsForLevel('full'));
    }
  });

  it('knows whether a person is on a preset or a hand-picked list', () => {
    expect(isCustomScope(['marketing'])).toBe(true);
    expect(isCustomScope([])).toBe(false);
    expect(isCustomScope(['garbage'])).toBe(false);
  });
});

describe('the screen that draws the checkboxes', () => {
  it('offers every capability the system has — none missing, none invented', () => {
    expect(CAP_CATALOG.map((c) => c.id).sort()).toEqual([...ALL_CAPS].sort());
  });

  it('marks money and customer screens as private, so a tick is a decision', () => {
    for (const c of CAP_CATALOG) expect(c.private).toBe(isPrivateCap(c.id));
  });

  it('names every one of them in Vietnamese', () => {
    for (const c of CAP_CATALOG) expect(c.label.trim().length).toBeGreaterThan(2);
  });
});

/**
 * The half that means it.
 *
 * Hiding a menu item is decoration; the guard is what refuses the request. A
 * hand-picked list that narrows the nav and not the API would be a permission
 * screen that lies, which is worse than no screen at all — so every case below
 * is asked of `supportMayCall`, the function the guard calls.
 */
describe('the API door, for an employee on a hand-picked list', () => {
  it('opens what was ticked', () => {
    expect(supportMayCall('content', 'GET', '/customers', ['customers', 'marketing'])).toBe(true);
    expect(supportMayCall('content', 'POST', '/customers', ['customers', 'marketing'])).toBe(true);
  });

  it('refuses money and customers that were NOT ticked, read included', () => {
    const caps = ['marketing', 'reviews', 'calendar'];
    // Real API paths, not the web routes that show them: '/stats' is the
    // revenue chart and '/staff/performance' is the commission sheet.
    for (const p of ['/stats/sources', '/overview', '/staff/performance', '/customers', '/pos', '/billing/status']) {
      expect(supportMayCall('full', 'GET', p, caps)).toBe(false);
      expect(supportMayCall('full', 'POST', p, caps)).toBe(false);
    }
  });

  it('narrows a full-level employee, because the list replaces the preset', () => {
    expect(supportMayCall('full', 'GET', '/stats/sources')).toBe(true);
    expect(supportMayCall('full', 'GET', '/stats/sources', ['marketing'])).toBe(false);
  });

  it('widens a content-level employee onto the calendar when that is the tick', () => {
    expect(supportMayCall('content', 'GET', '/bookings')).toBe(false);
    expect(supportMayCall('content', 'GET', '/bookings', ['marketing', 'bookings'])).toBe(true);
  });

  it('keeps the read-not-write rule for the non-private screens outside the list', () => {
    const caps = ['marketing'];
    // Half the marketing screens read /settings for the salon's currency: a
    // refused GET would hand the employee a broken page instead of a closed door.
    expect(supportMayCall('setup', 'GET', '/settings', caps)).toBe(true);
    expect(supportMayCall('setup', 'PATCH', '/settings', caps)).toBe(false);
    expect(supportMayCall('setup', 'GET', '/services', caps)).toBe(true);
    expect(supportMayCall('setup', 'POST', '/services', caps)).toBe(false);
  });

  it('never lets a garbage list read as "everything"', () => {
    for (const junk of [[], ['nope'], null, undefined, 'full', 42, {}] as unknown[]) {
      // Falls back to the preset — and the preset for `content` does not open
      // the takings, whatever the junk was.
      expect(supportMayCall('content', 'GET', '/stats/sources', junk)).toBe(false);
    }
  });

  it('never locks an employee out of a public endpoint', () => {
    expect(supportMayCall('content', 'GET', '/public/salon/abc', ['reviews'])).toBe(true);
  });

  it('leaves every non-support request alone — the guard is the proof', () => {
    // The guard returns before it ever asks the rule, for anything that is not
    // a support session. This is the line that makes the whole feature safe to
    // deploy while salons are open.
    const guard = new SupportScopeGuard();
    const ctx = (user: unknown, method: string, url: string) => ({
      switchToHttp: () => ({ getRequest: () => ({ user, method, originalUrl: url }) }),
    }) as never;
    expect(guard.canActivate(ctx({ role: 'SALON_ADMIN' }, 'GET', '/reports'))).toBe(true);
    expect(guard.canActivate(ctx({ role: 'STAFF', staffRole: 'RECEPTIONIST' }, 'GET', '/pos'))).toBe(true);
    expect(guard.canActivate(ctx(undefined, 'GET', '/reports'))).toBe(true);
  });

  it('refuses a support session whose ticks do not cover the path', () => {
    const guard = new SupportScopeGuard();
    const req = {
      user: { role: 'SALON_ADMIN', supportSession: true, supportLevel: 'setup', supportCaps: ['marketing'] },
      method: 'GET',
      originalUrl: '/api/stats/sources?from=2026-01-01',
    };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('lets that same session through to what it was given', () => {
    const guard = new SupportScopeGuard();
    const req = {
      user: { role: 'SALON_ADMIN', supportSession: true, supportLevel: 'setup', supportCaps: ['marketing'] },
      method: 'POST',
      originalUrl: '/api/content/week',
    };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('falls back to the preset when the token carries no list', () => {
    const guard = new SupportScopeGuard();
    const ok = { user: { supportSession: true, supportLevel: 'setup' }, method: 'POST', originalUrl: '/services' };
    const no = { user: { supportSession: true, supportLevel: 'setup' }, method: 'GET', originalUrl: '/customers' };
    expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ok }) } as never)).toBe(true);
    expect(() => guard.canActivate({ switchToHttp: () => ({ getRequest: () => no }) } as never)).toThrow();
  });
});

/**
 * Entering a salon: the one place the stored ticks turn into a session.
 *
 * Everything above is a pure function. This is the join — the row is read, the
 * list is frozen into the token, and the screen is told what to draw. Three
 * things have to agree here or the feature lies to somebody: the token, the
 * capability list sent to the browser, and the audit row.
 */
describe('minting a session for an employee with hand-picked ticks', () => {
  const enter = async (row: unknown, role = SUPPORT_ROLE) => {
    const signed: unknown[] = [];
    const audited: unknown[] = [];
    const prisma = {
      tenant: { findFirst: async () => ({ id: 't1', name: 'Nails 1', slug: 'nails-1', status: 'ACTIVE' }) },
      user: { findFirst: async () => row },
    };
    const jwt = { signAsync: async (p: unknown) => { signed.push(p); return 'tok'; } };
    const config = { get: () => 'secret' };
    const audit = { log: async (a: unknown) => { audited.push(a); } };
    const svc = new SupportService(prisma as never, jwt as never, config as never, audit as never);
    const r = await svc.enterSalon({ userId: 'u1', email: 'a@lumioagency.com', role, tenantId: null } as never, 't1');
    return { r, payload: signed[0] as Record<string, unknown>, audit: audited[0] as Record<string, unknown> };
  };

  it('freezes the ticks into the token, so the API door sees the same list', async () => {
    const { r, payload } = await enter({ supportLevel: 'content', supportCaps: ['marketing', 'calendar'] });
    expect(payload.supportCaps).toEqual(['calendar', 'marketing']);
    expect(r.capabilities).toEqual(['calendar', 'marketing']);
    expect(r.custom).toBe(true);
    // The preset it replaced is still on the token, because seniority is a
    // rank and the ticks are a list of screens.
    expect(payload.supportLevel).toBe('content');
  });

  it('leaves the token alone for an employee on a plain preset', async () => {
    const { r, payload } = await enter({ supportLevel: 'content', supportCaps: [] });
    expect('supportCaps' in payload).toBe(false);
    expect(r.custom).toBe(false);
    expect(r.capabilities).toEqual(capsForLevel('content'));
  });

  it('does the same for a row written before the column existed', async () => {
    const { r, payload } = await enter({ supportLevel: 'setup' });
    expect('supportCaps' in payload).toBe(false);
    expect(r.capabilities).toEqual(capsForLevel('setup'));
  });

  it('never narrows the owner', async () => {
    const { r, payload } = await enter(null, 'SUPER_ADMIN' as never);
    expect(r.level).toBe('full');
    expect(r.custom).toBe(false);
    expect('supportCaps' in payload).toBe(false);
    expect(r.capabilities).toEqual(capsForLevel('full'));
  });

  it('writes the actual scope into the audit row, not just the preset', async () => {
    const { audit } = await enter({ supportLevel: 'setup', supportCaps: ['marketing'] });
    expect((audit.metadata as Record<string, unknown>).caps).toEqual(['marketing']);
    expect(audit.action).toBe('support.entered_salon');
  });

  it('falls back to the preset when the stored list is junk, never to a blank app', async () => {
    for (const junk of ['full', 42, {}, ['nope'], null] as unknown[]) {
      const { r } = await enter({ supportLevel: 'content', supportCaps: junk });
      expect(r.capabilities).toEqual(capsForLevel('content'));
      expect(r.capabilities.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The window between the code going live and the column existing.
 *
 * It has been a real window twice on this project: a migration that failed at
 * parse time left the new code running against the old database. The failure
 * that matters is not losing the ticks — it is reading "the select threw" as
 * "there is no such employee", because the level for no-such-employee is
 * `setup`, and every full-level employee would silently lose the screens they
 * were using.
 */
describe('when the supportCaps column is not there yet', () => {
  const enterWithBrokenColumn = async (row: { supportLevel?: string | null }) => {
    let asked = 0;
    const prisma = {
      tenant: { findFirst: async () => ({ id: 't1', name: 'N', slug: 'n', status: 'ACTIVE' }) },
      user: {
        findFirst: async ({ select }: { select: Record<string, boolean> }) => {
          asked += 1;
          // Exactly what Prisma does when a selected column does not exist.
          if (select.supportCaps) throw new Error('column "supportCaps" does not exist');
          return row;
        },
      },
    };
    const svc = new SupportService(
      prisma as never,
      { signAsync: async () => 'tok' } as never,
      { get: () => 's' } as never,
      { log: async () => undefined } as never,
    );
    const r = await svc.enterSalon({ userId: 'u1', email: 'a@b.c', role: SUPPORT_ROLE, tenantId: null } as never, 't1');
    return { r, asked };
  };

  it('DOES NOT demote a full-level employee to setup', async () => {
    const { r, asked } = await enterWithBrokenColumn({ supportLevel: 'full' });
    expect(r.level).toBe('full');
    expect(r.capabilities).toEqual(capsForLevel('full'));
    expect(asked).toBe(2); // asked with the ticks, then again without
  });

  it('still gives a content-level employee their own preset, not a blank app', async () => {
    const { r } = await enterWithBrokenColumn({ supportLevel: 'content' });
    expect(r.capabilities).toEqual(capsForLevel('content'));
    expect(r.custom).toBe(false);
  });

  it('falls back to setup only when there really is no row', async () => {
    const { r } = await enterWithBrokenColumn(null as never);
    expect(r.level).toBe('setup');
  });
});
