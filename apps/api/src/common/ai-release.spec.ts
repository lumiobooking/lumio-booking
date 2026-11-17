import { EMPTY_RELEASE, RELEASE_FEATURES, canarySlugs, cleanRelease, featureOn, releaseView, stageOf } from './ai-release';
import { AiReleaseService } from './ai-release.service';
import { AiReleaseController } from './ai-release.controller';

const DEMO = '11111111-1111-4111-8111-111111111111';
const AMY = '22222222-2222-4222-8222-222222222222';
const tests = new Set([DEMO]);

describe('the release channel: a new AI behaviour reaches the test accounts first', () => {
  it('everything new ships to the test accounts only', () => {
    for (const f of Object.keys(RELEASE_FEATURES) as (keyof typeof RELEASE_FEATURES)[]) {
      expect(stageOf(EMPTY_RELEASE, f)).toBe('canary');
      expect(featureOn(EMPTY_RELEASE, f, DEMO, tests)).toBe(true);
      expect(featureOn(EMPTY_RELEASE, f, AMY, tests)).toBe(false);
      expect(featureOn(EMPTY_RELEASE, f, null, tests)).toBe(false);
    }
  });

  it('promoted = every salon; off = nobody, the test accounts included', () => {
    const on = cleanRelease({ stages: { smartWait: 'on' } });
    expect(featureOn(on, 'smartWait', AMY, tests)).toBe(true);
    expect(featureOn(on, 'typing', AMY, tests)).toBe(false); // the other feature did not move
    const off = cleanRelease({ stages: { typing: 'off' } });
    expect(featureOn(off, 'typing', DEMO, tests)).toBe(false);
  });

  it('an extra test account is one salon, not a wildcard', () => {
    const s = cleanRelease({ canary: [AMY.toUpperCase(), 'not-an-id', '*'] });
    expect(s.canary).toEqual([AMY]);
    expect(featureOn(s, 'typing', AMY, new Set())).toBe(true);
    expect(featureOn(s, 'typing', DEMO, new Set())).toBe(false);
  });

  it('what is stored or posted is cleaned: unknown features and stages are dropped, junk is empty', () => {
    expect(cleanRelease('{"stages":{"typing":"on","nope":"on","smartWait":"everyone"}}').stages).toEqual({ typing: 'on' });
    expect(cleanRelease('not json')).toEqual({ stages: {}, canary: [], updatedAt: null, updatedBy: null });
    expect(cleanRelease(null).stages).toEqual({});
    expect(releaseView(cleanRelease({ stages: { typing: 'on' } })).find((f) => f.feature === 'typing')?.stage).toBe('on');
  });

  it('the platform\'s own test accounts come from the environment, and can be none', () => {
    expect(canarySlugs({})).toEqual(['lumio-salon', 'lumio-agency']);
    expect(canarySlugs({ AI_RELEASE_CANARY_SLUGS: '' })).toEqual([]);
    expect(canarySlugs({ AI_RELEASE_CANARY_SLUGS: 'My-Test, bad slug!, x' })).toEqual(['my-test']);
  });
});

describe('the release service and its endpoint', () => {
  function build(stored: string | null = null, failing = false) {
    const rows: { value: string | null } = { value: stored };
    const audit: Record<string, unknown>[] = [];
    const prisma = {
      platformConfig: {
        findUnique: async () => { if (failing) throw new Error('db down'); return rows.value ? { value: rows.value } : null; },
        upsert: async ({ update }: { update: { value: string } }) => { rows.value = update.value; return {}; },
      },
      tenant: { findMany: async ({ where }: { where: { slug?: { in: string[] }; id?: { in: string[] } } }) => (where.slug ? [{ id: DEMO }] : (where.id?.in ?? []).map((id) => ({ id, name: `salon ${id.slice(0, 2)}`, slug: 's' }))) },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audit.push(data); return {}; } },
    };
    const svc = new AiReleaseService(prisma as never);
    return { svc, ctl: new AiReleaseController(svc, prisma as never), rows, audit };
  }

  it('reads the stored stage; a salon that is not a test account stays on the old behaviour until promotion', async () => {
    const { svc, ctl, audit } = build();
    await svc.view();
    expect(svc.isOn('smartWait', DEMO)).toBe(true);
    expect(svc.isOn('smartWait', AMY)).toBe(false);
    const out = await ctl.change({ userId: 'u1', email: 'owner@x.test', role: 'SUPER_ADMIN', tenantId: null } as never, { stages: { smartWait: 'on' } });
    expect(out.features.find((f) => f.feature === 'smartWait')?.stage).toBe('on');
    expect(svc.isOn('smartWait', AMY)).toBe(true);
    expect(svc.isOn('typing', AMY)).toBe(false);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('platform.ai_release_changed');
  });

  it('"seen" and the dots are two switches: one can be taken away and the other stays', async () => {
    const { svc, ctl } = build();
    await svc.view();
    expect(svc.isOn('seen', DEMO)).toBe(true);
    expect(svc.isOn('typing', DEMO)).toBe(true);
    await ctl.change({ userId: 'u1', email: 'owner@x.test', role: 'SUPER_ADMIN', tenantId: null } as never, { stages: { seen: 'off' } });
    expect(svc.isOn('seen', DEMO)).toBe(false);
    expect(svc.isOn('typing', DEMO)).toBe(true);
    expect(svc.isOn('typing', AMY)).toBe(false);
  });

  it('knows which salons are test accounts — the platform\'s own and the extra ones — and a paying salon is never one', async () => {
    const EXTRA = '33333333-3333-4333-8333-333333333333';
    const { svc } = build(JSON.stringify({ stages: { typing: 'on' }, canary: [EXTRA] }));
    await svc.view();
    expect(svc.isTestAccount(DEMO)).toBe(true);
    expect(svc.isTestAccount(EXTRA.toUpperCase())).toBe(true);
    expect(svc.isTestAccount(AMY)).toBe(false); // even with the behaviour promoted to every salon
    expect(svc.isTestAccount(null)).toBe(false);
    expect(svc.testAccountIds().sort()).toEqual([DEMO, EXTRA]);
  });

  it('a database failure never breaks a reply: features stay at the stage they ship in', async () => {
    const { svc } = build(null, true);
    await svc.view().catch(() => undefined);
    expect(svc.isOn('typing', AMY)).toBe(false);
    expect(() => svc.isOn('typing', DEMO)).not.toThrow();
  });

  describe('the gate: "every salon" needs a passed golden run of the running build (./ai-golden)', () => {
    const env = { ...process.env };
    afterEach(() => { process.env = { ...env }; });
    const GOLDEN = (o: Record<string, unknown> = {}) => JSON.stringify({ commit: 'abc1234', at: new Date().toISOString(), state: 'done', live: ['smartWait', 'thinkAhead'], accounts: [], ok: true, why: [], ...o });
    function gated(golden: string | null) {
      const store: Record<string, string | null> = { ai_release: null, ai_golden: golden };
      const prisma = {
        platformConfig: {
          findUnique: async ({ where }: { where: { key: string } }) => (store[where.key] ? { value: store[where.key] } : null),
          upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => { store[where.key] = update.value; return {}; },
        },
        tenant: { findMany: async ({ where }: { where: { slug?: unknown; id?: { in: string[] } } }) => (where.slug ? [{ id: DEMO }] : (where.id?.in ?? []).map((id) => ({ id, name: 'x', slug: 's' }))) },
      };
      return new AiReleaseService(prisma as never);
    }

    it('in production, with no golden run: refused, in words the operator can act on — and nothing changes', async () => {
      process.env.RENDER_GIT_COMMIT = 'abc1234ffff';
      const svc = gated(null);
      await expect(svc.change('owner', { stages: { smartWait: 'on' } })).rejects.toMatchObject({ response: { code: 'GOLDEN_GATE', feature: 'smartWait', why: 'never-run' } });
      expect(svc.isOn('smartWait', AMY)).toBe(false);
      expect((await svc.view()).gate.smartWait).toContain('Chưa chạy bộ kiểm tra');
    });

    it('a passed run of THIS build opens it; a failed one, or one of another build, does not', async () => {
      process.env.RENDER_GIT_COMMIT = 'abc1234ffff';
      const ok = gated(GOLDEN());
      expect((await ok.view()).gate.smartWait).toBeNull();
      await ok.change('owner', { stages: { smartWait: 'on' } });
      expect(ok.isOn('smartWait', AMY)).toBe(true);
      await expect(gated(GOLDEN({ ok: false, why: ['Lumio Agency: chỉ 12/20 kịch bản đạt.'] })).change('owner', { stages: { smartWait: 'on' } })).rejects.toMatchObject({ response: { why: 'failed' } });
      await expect(gated(GOLDEN({ commit: 'old9999' })).change('owner', { stages: { smartWait: 'on' } })).rejects.toMatchObject({ response: { why: 'other-build' } });
    });

    it('a behaviour that was not live on the test accounts during the run is not covered by it', async () => {
      process.env.RENDER_GIT_COMMIT = 'abc1234ffff';
      await expect(gated(GOLDEN()).change('owner', { stages: { quickRepair: 'on' } })).rejects.toMatchObject({ response: { why: 'not-live' } });
    });

    it('taking a behaviour AWAY is never held up — off and "test accounts only" need no run at all', async () => {
      process.env.RENDER_GIT_COMMIT = 'abc1234ffff';
      const svc = gated(null);
      await svc.change('owner', { stages: { typing: 'off', smartWait: 'canary' } });
      expect(svc.isOn('typing', DEMO)).toBe(false);
      expect(svc.isOn('smartWait', DEMO)).toBe(true);
    });

    it('one refused behaviour refuses the whole change: nothing is half-applied', async () => {
      process.env.RENDER_GIT_COMMIT = 'abc1234ffff';
      const svc = gated(GOLDEN());
      await expect(svc.change('owner', { stages: { smartWait: 'on', quickRepair: 'on' } })).rejects.toMatchObject({ response: { feature: 'quickRepair' } });
      expect(svc.isOn('smartWait', AMY)).toBe(false);
    });
  });

  it('only a Super Admin may move a behaviour; support may only look', () => {
    const roles = (m: string) => Reflect.getMetadata('roles', (AiReleaseController.prototype as unknown as Record<string, object>)[m]) as string[];
    expect(roles('change')).toEqual(['SUPER_ADMIN']);
    expect(roles('view').sort()).toEqual(['SUPER_ADMIN', 'SUPPORT']);
  });
});
