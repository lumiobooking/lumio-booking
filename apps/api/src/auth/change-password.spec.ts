// bcrypt's native binary is per-OS; the rule under test is the service's, so hashing is a stand-in here.
jest.mock('./password.util', () => ({ hashSecret: async (p: string) => `h:${p}`, verifySecret: async (p: string, h: string) => h === `h:${p}` }));
import { AuthService } from './auth.service';
import { hashSecret } from './password.util';

describe('changing my own password', () => {
  async function make() {
    const users: Record<string, { id: string; passwordHash: string; isActive: boolean }> = { u1: { id: 'u1', passwordHash: await hashSecret('old-password-1'), isActive: true } };
    const prisma = {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
        update: async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => { users[where.id].passwordHash = data.passwordHash; return users[where.id]; },
      },
    };
    return { svc: new AuthService(prisma as never, {} as never, {} as never), users };
  }
  it('needs the current password, 8+ characters, and a different one', async () => {
    const { svc, users } = await make();
    const before = users.u1.passwordHash;
    await expect(svc.changeOwnPassword({ userId: 'u1' }, 'wrong', 'new-password-2')).rejects.toThrow(/current password/);
    await expect(svc.changeOwnPassword({ userId: 'u1' }, 'old-password-1', 'short')).rejects.toThrow(/8/);
    expect(users.u1.passwordHash).toBe(before);
    await expect(svc.changeOwnPassword({ userId: 'u1' }, 'old-password-1', 'new-password-2')).resolves.toEqual({ ok: true });
    expect(users.u1.passwordHash).not.toBe(before);
  });
  it('a support session cannot', async () => {
    const { svc } = await make();
    await expect(svc.changeOwnPassword({ userId: 'u1', supportSession: true }, 'old-password-1', 'new-password-2')).rejects.toThrow();
  });
});
