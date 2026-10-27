/**
 * The interceptor masks a technician's response with HER salon's setting only,
 * and never touches anyone else's response.
 */
import { lastValueFrom, of } from 'rxjs';
import { ContactPrivacyInterceptor } from './contact-privacy.interceptor';
import { STAFF_PRIVACY_KEY } from './contact-privacy';

const settings: Record<string, unknown> = {
  [`A:${STAFF_PRIVACY_KEY}`]: { contact: 'full' },
  [`B:${STAFF_PRIVACY_KEY}`]: { contact: 'hidden' },
};
const prisma = {
  setting: {
    findUnique: async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
      const v = settings[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`];
      return v === undefined ? null : { value: v };
    },
  },
};
const icpt = new ContactPrivacyInterceptor(prisma as never);
const body = () => ({ customer: { firstName: 'Karen', phone: '+1 714 555 2832', email: 'k@x.com' }, notes: 'text me 714-555-2832' });
const run = async (user: Record<string, unknown>) => {
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never;
  return lastValueFrom(icpt.intercept(ctx, { handle: () => of(body()) }) as never) as Promise<ReturnType<typeof body>>;
};

describe('ContactPrivacyInterceptor', () => {
  it('a technician of a salon with no setting gets the last 4 digits', async () => {
    const r = await run({ role: 'STAFF', staffRole: 'TECHNICIAN', tenantId: 'C' });
    expect(r.customer.phone).toBe('••• 2832');
    expect(r.customer.email).toBeNull();
    expect(r.notes).not.toContain('714');
  });
  it('each salon\'s choice applies to its own technicians only', async () => {
    expect((await run({ role: 'STAFF', staffRole: null, tenantId: 'A' })).customer.phone).toBe('+1 714 555 2832');
    expect((await run({ role: 'STAFF', staffRole: null, tenantId: 'B' })).customer.phone).toBeNull();
  });
  it('owners, receptionists and managers are never masked', async () => {
    for (const u of [{ role: 'SALON_ADMIN', tenantId: 'B' }, { role: 'STAFF', staffRole: 'RECEPTIONIST', tenantId: 'B' }, { role: 'STAFF', staffRole: 'MANAGER', tenantId: 'B' }]) {
      expect((await run(u)).customer.phone).toBe('+1 714 555 2832');
    }
  });
});
