/**
 * The light/dark choice belongs to the person: every kind of account reads
 * and writes only its own row.
 */
// The password helpers are not part of this; keep the native hashing module out of the test.
jest.mock('../auth/password.util', () => ({ hashSecret: jest.fn(), verifySecret: jest.fn() }));
import { MeController, themeOf } from './me.controller';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function build() {
  const users: Row[] = [
    { id: 'owner-a', tenantId: 'ta', theme: null },
    { id: 'tech-a', tenantId: 'ta', theme: 'light' },
    { id: 'support-1', tenantId: null, theme: null },
  ];
  const prisma = {
    user: {
      findUnique: async ({ where }: Row) => users.find((u) => u.id === where.id) ?? null,
      update: async ({ where, data }: Row) => { const u = users.find((x) => x.id === where.id)!; Object.assign(u, data); return u; },
    },
  };
  return { users, ctl: new MeController(prisma as never) };
}
const as = (userId: string, role: string, extra: Row = {}) => ({ userId, role, tenantId: null, ...extra }) as never;

describe('light / dark on the account', () => {
  it('only "light" or "dark" is a choice', () => {
    expect(themeOf('light')).toBe('light');
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf('blue')).toBeNull();
    expect(themeOf(null)).toBeNull();
  });

  it('owner, technician and support each read and write only their own choice', async () => {
    const { ctl, users } = build();
    expect(await ctl.preferences(as('owner-a', 'SALON_ADMIN', { tenantId: 'ta' }))).toEqual({ theme: null });
    expect(await ctl.preferences(as('tech-a', 'STAFF', { tenantId: 'ta' }))).toEqual({ theme: 'light' });
    await ctl.setPreferences(as('owner-a', 'SALON_ADMIN', { tenantId: 'ta' }), { theme: 'light' });
    // A support employee inside a salon session writes THEIR row, not the salon owner's.
    await ctl.setPreferences(as('support-1', 'SALON_ADMIN', { tenantId: 'ta', supportSession: true }), { theme: 'dark' });
    expect(users.map((u) => [u.id, u.theme])).toEqual([['owner-a', 'light'], ['tech-a', 'light'], ['support-1', 'dark']]);
    await expect(ctl.setPreferences(as('tech-a', 'STAFF'), { theme: 'purple' })).rejects.toThrow(/light" or "dark/);
    expect(users[1].theme).toBe('light');
  });
});
