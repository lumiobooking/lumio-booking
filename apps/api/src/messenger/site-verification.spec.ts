import { SiteVerificationController } from './site-verification.controller';

/** A fake Express response that records what was sent. */
function res() {
  const r = { status: 200, type: '', body: '' };
  const api = {
    status: (c: number) => { r.status = c; return api; },
    type: (t: string) => { r.type = t; return api; },
    send: (b: string) => { r.body = b; return api; },
  };
  return { r, api: api as never };
}

describe('site verification', () => {
  const ctrl = new SiteVerificationController();
  const CODE = 'V_IO89o3B25NXxmaYeirUtQDWrwQ-ra8EJ8s';
  afterEach(() => { delete process.env.ZALO_SITE_VERIFICATION; });

  it('reads the code out of the DNS form, the meta form and the bare form alike', () => {
    for (const v of [CODE, `zalo-platform-site-verification=${CODE}`, `<meta name="zalo-platform-site-verification" content="${CODE}" />`]) {
      process.env.ZALO_SITE_VERIFICATION = v;
      const { r, api } = res();
      ctrl.root(api);
      expect(r.body).toContain(`<meta name="zalo-platform-site-verification" content="${CODE}" />`);
    }
  });

  it('serves the file method for the code it holds, and nothing else', () => {
    process.env.ZALO_SITE_VERIFICATION = `zalo-platform-site-verification=${CODE}`;
    const ok = res();
    ctrl.verifier({ path: `/zalo_verifier${CODE}.html` } as never, ok.api);
    expect(ok.r.status).toBe(200);
    expect(ok.r.body).toBe(CODE);
    const bad = res();
    ctrl.verifier({ path: '/zalo_verifierSOMEONEELSE.html' } as never, bad.api);
    expect(bad.r.status).toBe(404);
  });

  it('serves a plain root page, with no tag, when no code is set', () => {
    const { r, api } = res();
    ctrl.root(api);
    expect(r.body).toContain('Lumio Booking API');
    expect(r.body).not.toContain('zalo-platform-site-verification');
  });
});
