/**
 * The customer display's welcome screen is branded from the salon's own
 * settings — not only from whatever the register last pushed. A display
 * paired while no register was open used to show a blank generic "Welcome"
 * with no logo, no name and no Google review QR.
 */
import { DisplayService, withBrand, type DisplayBrand } from './display.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TENANTS: Row[] = [
  { id: 'tenant-a', name: 'An Sen Spa', slug: 'an-sen', branding: { logoUrl: 'https://cdn.test/a.png', accentColor: '#a8292d', welcomeImageUrl: '' } },
  { id: 'tenant-b', name: 'Other Nails', slug: 'other', branding: { logoUrl: 'https://cdn.test/b.png' } },
];

function build(sessions: Row[], review: Record<string, { enabled: boolean; google: string | null }>) {
  const prisma = {
    displaySession: { findUnique: jest.fn(async ({ where }: Row) => sessions.find((s) => s.token === where.token) ?? null) },
    tenant: { findUnique: jest.fn(async ({ where }: Row) => TENANTS.find((t) => t.id === where.id) ?? null) },
  };
  const settings = {
    getReviewSettings: jest.fn(async (tenantId: string) => ({ enabled: review[tenantId]?.enabled ?? false })),
    effectiveGoogleReviewUrl: jest.fn(async (tenantId: string) => review[tenantId]?.google ?? null),
  };
  const svc = new DisplayService(prisma as never, {} as never, undefined, undefined, settings as never);
  return { svc, prisma, settings };
}

describe('customer display branding', () => {
  const OLD = process.env.PUBLIC_WEB_URL;
  beforeAll(() => { process.env.PUBLIC_WEB_URL = 'https://lumiobooking.com'; });
  afterAll(() => { if (OLD === undefined) delete process.env.PUBLIC_WEB_URL; else process.env.PUBLIC_WEB_URL = OLD; });

  it('nothing pushed yet: the idle welcome comes with the salon name, logo, accent and Google QR', async () => {
    const { svc } = build([{ token: 'TOK-A', tenantId: 'tenant-a', state: null }], { 'tenant-a': { enabled: false, google: 'https://search.google.com/local/writereview?placeid=PA' } });
    const { state } = await svc.stateByToken('TOK-A');
    expect(state).toMatchObject({
      status: 'idle', lines: [],
      salonName: 'An Sen Spa', salonLogo: 'https://cdn.test/a.png', salonAccent: '#a8292d',
      // Review program off, Google connected → straight to Google's review page.
      reviewUrl: 'https://search.google.com/local/writereview?placeid=PA',
    });
    expect(state).not.toHaveProperty('salonWelcome'); // blank in settings → not invented
  });

  it('review program on: the QR opens the salon\'s own review page', async () => {
    const { svc } = build([{ token: 'TOK-A', tenantId: 'tenant-a', state: null }], { 'tenant-a': { enabled: true, google: 'https://g.page/r/x/review' } });
    const { state } = await svc.stateByToken('TOK-A');
    expect((state as Row).reviewUrl).toMatch(/\/review\/an-sen\/salon$/);
  });

  it('no Google link anywhere: no review QR', async () => {
    const { svc } = build([{ token: 'TOK-A', tenantId: 'tenant-a', state: null }], { 'tenant-a': { enabled: true, google: null } });
    const { state } = await svc.stateByToken('TOK-A');
    expect((state as Row).reviewUrl).toBeUndefined();
  });

  it('a register that pushed an old catalog (no logo, no QR) is corrected; its sale stays as it is', async () => {
    const pushed = { status: 'active', lines: [{ name: 'Gel', qty: 1, lineCents: 4000 }], dueCents: 4000, salonName: 'An Sen Spa', salonLogo: '', reviewUrl: null };
    const { svc } = build([{ token: 'TOK-A', tenantId: 'tenant-a', state: pushed }], { 'tenant-a': { enabled: false, google: 'https://g.test/a' } });
    const { state } = await svc.stateByToken('TOK-A');
    expect(state).toMatchObject({ status: 'active', dueCents: 4000, lines: pushed.lines, salonLogo: 'https://cdn.test/a.png', reviewUrl: 'https://g.test/a' });
  });

  it('each screen gets ITS salon\'s branding only (cross-tenant)', async () => {
    const { svc, prisma, settings } = build(
      [{ token: 'TOK-A', tenantId: 'tenant-a', state: null }, { token: 'TOK-B', tenantId: 'tenant-b', state: null }],
      { 'tenant-a': { enabled: false, google: 'https://g.test/a' }, 'tenant-b': { enabled: false, google: null } },
    );
    const b = (await svc.stateByToken('TOK-B')).state as Row;
    expect(b).toMatchObject({ salonName: 'Other Nails', salonLogo: 'https://cdn.test/b.png' });
    expect(b.reviewUrl).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('An Sen');
    const a = (await svc.stateByToken('TOK-A')).state as Row;
    expect(a).toMatchObject({ salonName: 'An Sen Spa', reviewUrl: 'https://g.test/a' });
    for (const c of prisma.tenant.findUnique.mock.calls) expect(['tenant-a', 'tenant-b']).toContain(c[0].where.id);
    expect(settings.effectiveGoogleReviewUrl.mock.calls.map((c) => c[0]).sort()).toEqual(['tenant-a', 'tenant-b']);
  });

  it('polled every second: the salon\'s settings are read at most once per short window', async () => {
    const { svc, prisma } = build([{ token: 'TOK-A', tenantId: 'tenant-a', state: null }], {});
    await svc.stateByToken('TOK-A'); await svc.stateByToken('TOK-A'); await svc.stateByToken('TOK-A');
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it('withBrand: settings win, blanks keep what the register sent, no brand → unchanged', () => {
    const brand: DisplayBrand = { salonName: 'S', salonLogo: '', salonAccent: '#111', salonWelcome: '', reviewUrl: null };
    expect(withBrand({ status: 'paid', salonLogo: 'reg.png', salonName: 'old' }, brand)).toEqual({ status: 'paid', salonLogo: 'reg.png', salonName: 'S', salonAccent: '#111' });
    expect(withBrand({ status: 'idle' }, null)).toEqual({ status: 'idle' });
    expect(withBrand(null, null)).toBeNull();
  });
});
