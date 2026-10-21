/**
 * "I typed it right and it says invalid credentials" — the cases that were
 * the system's fault, not the person's.
 */
jest.mock('./password.util', () => ({ hashSecret: async (p: string) => `h:${p}`, verifySecret: async (p: string, h: string) => h === `h:${p}` }));
import { AuthService, maskEmail } from './auth.service';

type U = { id: string; email: string; passwordHash: string; isActive: boolean; role: string; tenantId: string | null; tenant: null; firstName: string; lastName: string };

function make(users: U[]) {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => users.find((u) => (where.email !== undefined ? u.email === where.email : u.id === where.id)) ?? null,
      update: async () => ({}),
    },
    // lower(trim(email)) = $1
    $queryRaw: async (_s: TemplateStringsArray, wanted: string) => users.filter((u) => u.email.trim().toLowerCase() === wanted).slice(0, 2).map((u) => ({ id: u.id })),
    staffMember: { findFirst: async () => null },
  };
  const jwt = { signAsync: async () => 'token' };
  const config = { get: () => undefined };
  return new AuthService(prisma as never, jwt as never, config as never);
}
const user = (over: Partial<U>): U => ({ id: 'u1', email: 'anna@salon.com', passwordHash: 'h:Secret123', isActive: true, role: 'SUPER_ADMIN', tenantId: null, tenant: null, firstName: 'A', lastName: 'B', ...over });

describe('signing in', () => {
  it('the address is matched however it was typed or stored', async () => {
    await expect(make([user({})]).login('  Anna@Salon.COM ', 'Secret123')).resolves.toMatchObject({ accessToken: 'token' });
    // Stored before the forms cleaned it.
    await expect(make([user({ email: 'Anna@Salon.com ' })]).login('anna@salon.com', 'Secret123')).resolves.toMatchObject({ accessToken: 'token' });
  });
  it('two old accounts that clean up to the same address are not guessed between', async () => {
    const svc = make([user({ id: 'a', email: 'Anna@salon.com' }), user({ id: 'b', email: 'anna@salon.com ' })]);
    await expect(svc.login('ANNA@salon.com', 'Secret123')).rejects.toThrow('Invalid credentials');
  });
  it('spaces around a pasted password are forgiven; a wrong password is not', async () => {
    const svc = make([user({})]);
    await expect(svc.login('anna@salon.com', ' Secret123 ')).resolves.toMatchObject({ accessToken: 'token' });
    await expect(svc.login('anna@salon.com', 'secret123')).rejects.toThrow('Invalid credentials');
  });
  it('a turned-off login says so — but only to someone who knows the password', async () => {
    const svc = make([user({ isActive: false })]);
    await expect(svc.login('anna@salon.com', 'Secret123')).rejects.toThrow(/turned off/);
    await expect(svc.login('anna@salon.com', 'nope')).rejects.toThrow('Invalid credentials');
  });
  it('logs a masked address only', () => {
    expect(maskEmail('anna@salon.com')).toBe('an***@salon.com');
  });
});
