import { MeController } from './me.controller';
import { hashSecret } from '../auth/password.util';

/** Staff change their own password (rt205): e-mail, phone and Facebook logins. */
async function setup(user: { email: string; password?: string; changed?: Date | null; social?: boolean }) {
  const row = { id: 'u1', tenantId: 'A', email: user.email, passwordHash: await hashSecret(user.password ?? 'random-unknown-xyz'), passwordChangedAt: user.changed ?? null };
  const audit: string[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return row; }),
    },
    socialLogin: { count: jest.fn(async () => (user.social ? 1 : 0)) },
    auditLog: { create: jest.fn(async ({ data }: { data: { action: string } }) => { audit.push(data.action); return {}; }) },
  };
  return { ctl: new MeController(prisma as never), row, audit };
}
const me = { userId: 'u1', role: 'STAFF', tenantId: 'A' } as never;

describe('rt205 — a team member changes their own password', () => {
  it('a phone login: shown as the phone, changes with the current password, logged', async () => {
    const { ctl, row, audit } = await setup({ email: 'tel-0913456142@staff.lumiobooking.invalid', password: 'old-pass-1' });
    expect(await ctl.loginInfo(me)).toMatchObject({ kind: 'phone', login: '0913456142', needsCurrent: true, canChangeEmail: false });
    await expect(ctl.updateAccount(me, { newPassword: 'new-pass-1' })).rejects.toThrow();
    const r = await ctl.updateAccount(me, { currentPassword: 'old-pass-1', newPassword: 'new-pass-1', newEmail: 'hack@x.com' });
    expect(r.passwordChanged).toBe(true);
    expect(row.email).toBe('tel-0913456142@staff.lumiobooking.invalid'); // the hidden login is not an e-mail to edit
    expect(audit).toContain('auth.password_changed');
  });

  it('a Facebook login sets its first password (and a phone) without a current one — once', async () => {
    const { ctl, row } = await setup({ email: 'fb-1001-abc@staff.lumiobooking.invalid', social: true });
    expect(await ctl.loginInfo(me)).toMatchObject({ kind: 'facebook', needsCurrent: false });
    await expect(ctl.updateAccount(me, { newPhone: '0988000111' })).rejects.toThrow();
    await ctl.updateAccount(me, { newPassword: 'first-pass-1', newPhone: '+84 988 000 111' });
    expect(row.email).toBe('tel-0988000111@staff.lumiobooking.invalid');
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    // From now on the current password is asked.
    await expect(ctl.updateAccount(me, { newPassword: 'another-pass-1' })).rejects.toThrow();
  });
});
