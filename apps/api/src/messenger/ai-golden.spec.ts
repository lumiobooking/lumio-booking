/**
 * THE GOLDEN RUN (common/ai-golden, ./ai-golden.service): the scripted
 * customers through the LIVE assistant on the platform's test accounts,
 * before a new behaviour may reach every salon.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { GOLDEN_KEY, goldenFrom, type GoldenRecord } from '../common/ai-golden';
import { GOLDEN_SCENARIOS, SCENARIOS, scenarioTurns } from '../ai-brain/simulations';
import { AiGoldenController, AiGoldenService } from './ai-golden.service';
import { WALL_PARAGRAPH_WORDS, hardFaults, isWall } from './ai-golden-checks';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('hard faults: decided by rule, not by a grader', () => {
  it('names what a customer must never be sent', () => {
    expect(hardFaults({ state: 'reply', reply: 'Dạ tiệm mở cửa 9 giờ sáng ạ. Anh/chị muốn đặt lịch hôm nào ạ?' })).toEqual([]);
    expect(hardFaults({ state: 'silent', reply: '' })).toEqual([]); // choosing to say nothing is not a fault by itself — the script's grading decides
    expect(hardFaults({ state: 'error', reply: '' })).toEqual(['error']);
    expect(hardFaults({ state: 'held', reply: '' })).toEqual(['held']);
    expect(hardFaults({ state: 'reply', reply: 'Dạ em xin lỗi, hệ thống đang hơi chậm một chút 🙏' })).toContain('apology');
    expect(hardFaults({ state: 'reply', reply: 'The customer asked three things. I must say each in full. We open at 9.' })).toContain('leak');
  });

  it('a wall of text is one long block; two short messages and a list of ▸ lines are not', () => {
    const para = Array.from({ length: WALL_PARAGRAPH_WORDS + 10 }, (_, i) => `từ${i}`).join(' ');
    expect(isWall(para)).toBe(true);
    expect(hardFaults({ state: 'reply', reply: para })).toEqual(['wall']);
    expect(isWall('Dạ bên em có các gói từ $299 đến $899/tháng ạ.\n\nAnh/chị đang muốn ưu tiên điều gì ạ?')).toBe(false);
    const list = Array.from({ length: 6 }, (_, i) => `▸ Gói ${i + 1} — $${(i + 2) * 100}/tháng · quản lý fanpage, chạy quảng cáo, báo cáo hằng tuần cho chủ tiệm`).join('\n');
    expect(isWall(`Dạ đây là các gói ạ:\n${list}\n\nAnh/chị thấy gói nào hợp ạ?`)).toBe(false);
    expect(isWall('')).toBe(false);
  });
});

describe('the scripts taken from real conversations', () => {
  it('each has both languages, a rubric, and an id of its own', () => {
    for (const s of GOLDEN_SCENARIOS) {
      expect(s.turns.vi.length).toBe(s.turns.en.length);
      expect(s.rubric.length).toBeGreaterThan(40);
      expect(SCENARIOS.some((x) => x.id === s.id)).toBe(false);
    }
    expect(new Set(GOLDEN_SCENARIOS.map((s) => s.id)).size).toBe(GOLDEN_SCENARIOS.length);
    expect(GOLDEN_SCENARIOS.some((s) => s.modes.includes('sales'))).toBe(true);
    expect(GOLDEN_SCENARIOS.some((s) => s.modes.includes('booking'))).toBe(true);
  });
  it('a business that is not a nail salon is asked about ITS service, not a gel manicure', () => {
    const s = GOLDEN_SCENARIOS.find((x) => x.id === 'price-then-book')!;
    expect(scenarioTurns(s, 'vi', { nail: true, table: false })).toEqual(s.turns.vi);
    expect(scenarioTurns(s, 'vi', { nail: false, table: false, sampleService: 'Nối mi classic' })[0]).toContain('Nối mi classic');
    expect(scenarioTurns(s, 'en', { nail: false, table: true })[1]).toContain('table');
  });
});

describe('the golden run itself', () => {
  const DEMO = 'demo-salon'; const AGENCY = 'lumio-agency'; const PAYING = 'amys-lash';
  function build(o: { replies?: (tenantId: string, last: string) => Row; grade?: (tenantId: string, id: string) => boolean; stored?: GoldenRecord | null } = {}) {
    const store: { value: string | null } = { value: o.stored ? JSON.stringify(o.stored) : null };
    const dryCalls: { tenantId: string; n: number }[] = [];
    const simCalls: Row[] = [];
    const pushes: Row[] = [];
    const tenantQueries: Row[] = [];
    const prisma = {
      platformConfig: {
        findUnique: async () => (store.value ? { value: store.value } : null),
        upsert: async ({ update }: Row) => { store.value = update.value; return {}; },
      },
      tenant: { findMany: async (q: Row) => { tenantQueries.push(q.where); return (q.where.id.in as string[]).map((id) => ({ id, name: id === DEMO ? 'Lumio Salon' : 'Lumio Agency' })); } },
      auditLog: { create: async () => ({}) },
    };
    const messenger = {
      dryRun: jest.fn(async (tenantId: string, messages: Row[]) => {
        dryCalls.push({ tenantId, n: messages.length });
        const last = String(messages[messages.length - 1].content);
        return { reply: 'Dạ em chào anh/chị ạ.', state: 'reply', tools: [], guards: [], choices: [], ms: 3000, steps: { p: 300, m: 2000, j: 700, k: 0, n: 1, r: 0 }, ...(o.replies?.(tenantId, last) ?? {}) };
      }),
    };
    // A stand-in for AiBrainService.runSimulations: three scripts, answered by whoever the caller passes.
    const brain = {
      runSimulations: jest.fn(async (actor: Row, _ui: string, opts: Row) => {
        simCalls.push({ tenantId: actor.tenantId, role: actor.role, store: opts.store, extra: (opts.extra ?? []).length });
        const scripts = [{ id: 'greeting', turns: ['Chào shop'] }, { id: 'price', turns: ['Giá bao nhiêu?'] }, { id: 'not-ready', turns: ['Mình hỏi dịch vụ', 'Để mình nghĩ thêm'] }];
        const items = [];
        for (const sc of scripts) {
          const messages: Row[] = []; let reply = '';
          for (const t of sc.turns) { messages.push({ role: 'user', content: t }); reply = (await opts.answer(messages)).reply; messages.push({ role: 'assistant', content: reply }); }
          items.push({ id: sc.id, lang: 'vi', title: sc.id, customer: sc.turns, reply, pass: o.grade ? o.grade(actor.tenantId, sc.id) : true, why: '' });
        }
        return { at: new Date().toISOString(), ms: 1, total: items.length, passed: items.filter((i) => i.pass).length, mode: actor.tenantId === AGENCY ? 'sales' : 'booking', items, regressions: [] };
      }),
    };
    const release = {
      testAccountIds: () => [DEMO, AGENCY],
      view: async () => ({ features: [{ feature: 'thinkAhead', stage: 'canary' }, { feature: 'quickRepair', stage: 'canary' }, { feature: 'typing', stage: 'off' }, { feature: 'smartWait', stage: 'on' }], testAccounts: [] }),
    };
    const push = { sendToTeam: async (p: Row) => { pushes.push(p); } };
    const svc = new AiGoldenService(prisma as never, messenger as never, brain as never, release as never, push as never);
    return { svc, store, dryCalls, simCalls, pushes, tenantQueries, messenger, brain, prisma };
  }
  const env = { ...process.env };
  beforeEach(() => { process.env.RENDER_GIT_COMMIT = 'abc1234def'; });
  afterAll(() => { process.env = env; });

  it('runs the scripted customers through the LIVE assistant of each TEST ACCOUNT — and of nobody else', async () => {
    const { svc, dryCalls, simCalls, tenantQueries, store } = build();
    const rec = await svc.run({ by: 'owner@x.test' });
    expect(rec).toMatchObject({ commit: 'abc1234', state: 'done', ok: true, why: [] });
    expect(tenantQueries).toEqual([{ id: { in: [DEMO, AGENCY] }, deletedAt: null }]);
    expect(new Set(dryCalls.map((c) => c.tenantId))).toEqual(new Set([DEMO, AGENCY]));
    expect(dryCalls.some((c) => c.tenantId === PAYING)).toBe(false);
    // The platform acts inside its own test account; the result is NOT stored as that account's own simulation; the real-conversation scripts ride along.
    expect(simCalls).toEqual([
      { tenantId: DEMO, role: UserRole.SALON_ADMIN, store: false, extra: GOLDEN_SCENARIOS.length },
      { tenantId: AGENCY, role: UserRole.SALON_ADMIN, store: false, extra: GOLDEN_SCENARIOS.length },
    ]);
    expect(rec?.accounts.map((a) => [a.name, a.mode, a.passed, a.total, a.medianMs])).toEqual([['Lumio Salon', 'booking', 3, 3, 3000], ['Lumio Agency', 'sales', 3, 3, 3000]]);
    expect(rec?.accounts[0].steps).toEqual({ prepMs: 300, modelMs: 2000, checkMs: 700 });
    // What this run is evidence for: the behaviours live on the test accounts while it ran.
    expect(rec?.live.sort()).toEqual(['quickRepair', 'smartWait', 'thinkAhead']);
    expect(goldenFrom(store.value)?.ok).toBe(true);
    // Counts and script ids only — never what a customer or the AI wrote.
    expect(store.value).not.toContain('Chào shop');
    expect(store.value).not.toContain('Dạ em chào');
  });

  it('a hard fault fails the run even when the grader was happy, and the team is told', async () => {
    const { svc, pushes } = build({ replies: (tenantId, last) => (tenantId === AGENCY && last === 'Giá bao nhiêu?' ? { reply: 'Dạ em xin lỗi, hệ thống đang hơi chậm một chút 🙏', state: 'reply' } : {}) });
    const rec = await svc.run();
    expect(rec?.ok).toBe(false);
    expect(rec?.accounts[1]).toMatchObject({ name: 'Lumio Agency', passed: 2, total: 3, failed: ['price:vi'], hard: 1 });
    expect(rec?.why.join(' ')).toContain('Lumio Agency');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toContain('chưa đạt');
  });

  it('too many scripts failing their grading fails the run; a passed run pushes nothing', async () => {
    const bad = build({ grade: (tenantId, id) => !(tenantId === DEMO && id !== 'greeting') });
    expect((await bad.svc.run())?.ok).toBe(false);
    const good = build();
    await good.svc.run();
    expect(good.pushes).toEqual([]);
  });

  it('an account that scores under the bar but no worse than its own best does not block the release; two scripts worse does', async () => {
    const acc = (passed: number, best: number | null = null) => ({ name: 'Lumio Agency', mode: 'sales' as const, passed, total: 3, failed: [], hard: 0, medianMs: 3000, p90Ms: 3000, rewriteRate: 0, steps: null, best });
    const prev = (passed: number): GoldenRecord => ({ commit: 'old9999', at: new Date(Date.now() - 86_400_000).toISOString(), state: 'done', live: [], ok: true, why: [], accounts: [acc(passed)] });
    // Last build: 2/3 on the agency page (its own notes fight each other). This build: 2/3 again.
    const same = build({ stored: prev(2), grade: (tenantId, id) => !(tenantId === AGENCY && id === 'price') });
    const r1 = await same.svc.run();
    expect(r1?.accounts[1]).toMatchObject({ passed: 2, total: 3, best: 2 });
    expect(r1?.ok).toBe(true);
    // Last build 3/3, this build 1/3: the build made it worse.
    const worse = build({ stored: prev(3), grade: (tenantId, id) => !(tenantId === AGENCY && id !== 'greeting') });
    const r2 = await worse.svc.run();
    expect(r2?.accounts[1]).toMatchObject({ passed: 1, total: 3, best: 3 });
    expect(r2?.ok).toBe(false);
    expect(r2?.why.join(' ')).toContain('3/3');
  });

  it('a slow AI fails the run: the median working time is part of the bar', async () => {
    const { svc } = build({ replies: () => ({ ms: 9500 }) });
    const rec = await svc.run();
    expect(rec?.ok).toBe(false);
    expect(rec?.why.join(' ')).toContain('soạn chậm');
  });

  it('after a deploy it runs once per build; a person can always run it again; never two at once', async () => {
    const done: GoldenRecord = { commit: 'abc1234', at: new Date().toISOString(), state: 'done', live: [], accounts: [], ok: true, why: [] };
    const again = build({ stored: done });
    expect(await again.svc.run({ auto: true })).toBeNull();
    expect(again.brain.runSimulations).not.toHaveBeenCalled();
    expect((await again.svc.run({ by: 'owner' }))?.state).toBe('done'); // asked for by a person
    const busy = build({ stored: { ...done, state: 'running' } });
    expect(await busy.svc.busy()).toBe(true);
    expect(await busy.svc.run({ by: 'owner' })).toBeNull();
    // A "running" left behind by a server that restarted mid-run does not block for ever.
    const stale = build({ stored: { ...done, state: 'running', at: new Date(Date.now() - 20 * 60_000).toISOString() } });
    expect(await stale.svc.busy()).toBe(false);
    // Another build's result does not count for this one.
    const other = build({ stored: { ...done, commit: 'old9999' } });
    expect((await other.svc.run({ auto: true }))?.commit).toBe('abc1234');
  });

  it('a run that breaks is recorded as broken — never left "running", never read as passed', async () => {
    const { svc, prisma, store } = build();
    (prisma.tenant as Row).findMany = async () => { throw new Error('db down'); };
    const rec = await svc.run();
    // No test account could be read: nothing ran, and that is not a pass.
    expect(rec?.ok).toBe(false);
    expect(goldenFrom(store.value)?.state).not.toBe('running');
  });

  it('support may read the result; only a Super Admin may start a run', async () => {
    const proto = AiGoldenController.prototype as never as Record<string, object>;
    expect((Reflect.getMetadata(ROLES_KEY, AiGoldenController) as string[]).sort()).toEqual(['SUPER_ADMIN', 'SUPPORT']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.run)).toEqual([UserRole.SUPER_ADMIN]);
    const { svc, prisma } = build();
    const audits: Row[] = [];
    (prisma.auditLog as Row).create = async (q: Row) => { audits.push(q.data); return {}; };
    const ctl = new AiGoldenController(svc, prisma as never);
    expect(await ctl.run({ userId: 'u1', email: 'owner@x.test' } as never)).toEqual({ started: true });
    expect(audits[0]).toMatchObject({ tenantId: null, userId: 'u1', action: 'platform.ai_golden_run', resourceId: GOLDEN_KEY });
    await new Promise((r) => setTimeout(r, 20));
    expect((await ctl.last()).record?.state).toBe('done');
  });
});
