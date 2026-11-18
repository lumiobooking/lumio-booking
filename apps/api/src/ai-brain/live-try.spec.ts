/**
 * Đợt 2, step 1: "Thử AI" answered by the live assistant (release channel
 * `liveTry`) instead of the reduced sandbox copy.
 */
import { AiBrainService, liveTryView, type LiveTry } from './ai-brain.service';
import { toolsFromTrace } from './simulations';
import { RELEASE_FEATURES, isUiFeature } from '../common/ai-release';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (tenantId: string) => ({ userId: 'u', tenantId, role: 'SALON_ADMIN' }) as never;
/** A database where every read fails loudly: reaching it means the OLD sandbox ran. */
const noDb = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('fell through to the sandbox'); } }) }) as never;
const live = (o: Partial<LiveTry> = {}): LiveTry => ({ reply: 'Dạ gói Starter $29/tháng ạ.', state: 'reply', tools: ['get_software_plans'], found: ['get_software_plans: Starter $29, Pro $69'], guards: [], choices: ['Xem tất cả gói'], cards: [], ms: 3200, steps: { r: 0 }, ...o });

describe('"Thử AI" on the live assistant', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
  afterEach(() => { process.env = { ...env }; });

  function build() {
    const asked: { tenantId: string; n: number }[] = [];
    const s = new AiBrainService(noDb, {} as never);
    s.useLiveAnswer(async (tenantId, messages) => { asked.push({ tenantId, n: messages.length }); return tenantId === A ? live() : null; });
    return { s, asked };
  }

  it('where the switch is on, the live assistant answers — for the caller\'s own salon', async () => {
    const { s, asked } = build();
    const r = await s.sandbox(user(A), { messages: [{ role: 'user', content: 'Phần mềm giá bao nhiêu?' }], channel: 'chat' }) as ReturnType<typeof liveTryView>;
    expect(asked).toEqual([{ tenantId: A, n: 1 }]);
    expect(r).toMatchObject({ live: true, text: 'Dạ gói Starter $29/tháng ạ.', choices: ['Xem tất cả gói'], ms: 3200, lang: 'vi' });
    expect(r.reply).toContain('▸ Xem tất cả gói');
    expect(r.trace[0]).toContain('[live]');
  });

  it('where it is off, the hook says so and the old sandbox runs (here: it reaches for the salon\'s settings)', async () => {
    const { s, asked } = build();
    await expect(s.sandbox(user(B), { messages: [{ role: 'user', content: 'hi' }], channel: 'chat' })).rejects.toThrow();
    expect(asked).toEqual([{ tenantId: B, n: 1 }]); // asked for B's own id, answered null → fell through
  });

  it('never for the phone line, a remembered customer, or the "try this instruction before saving" preview', async () => {
    const { s, asked } = build();
    await expect(s.sandbox(user(A), { messages: [{ role: 'user', content: 'hi' }], channel: 'voice' })).rejects.toThrow();
    await expect(s.sandbox(user(A), { messages: [{ role: 'user', content: 'hi' }], channel: 'chat', customerId: 'c1' })).rejects.toThrow();
    await expect(s.sandbox(user(A), { messages: [{ role: 'user', content: 'hi' }], channel: 'chat' }, { instructions: [] })).rejects.toThrow();
    expect(asked).toEqual([]);
  });

  it('a live run that failed falls back to the sandbox instead of breaking the screen', async () => {
    const s = new AiBrainService(noDb, {} as never);
    s.useLiveAnswer(async () => { throw new Error('boom'); });
    await expect(s.sandbox(user(A), { messages: [{ role: 'user', content: 'hi' }], channel: 'chat' })).rejects.not.toThrow('boom');
  });
});

describe('a live dry run, drawn the way the test screen draws', () => {
  it('shows what the real channel does when it sends nothing', () => {
    expect(liveTryView(live({ state: 'silent', reply: '' }), 'vi')).toMatchObject({ text: '(AI không trả lời: tin này không cần trả lời, hoặc khách yêu cầu dừng.)', choices: [], live: true });
    expect(liveTryView(live({ state: 'held', reply: '' }), 'en').text).toContain('Held, not sent');
    expect(liveTryView(live({ state: 'error', reply: '', error: 'timeout' }), 'vi').text).toContain('timeout');
  });

  it('cards and buttons are apart from the text; the trace names tools with what they returned', () => {
    const r = liveTryView(live({ cards: [{ name: 'Boost', price: '$179/tháng' }], guards: ['price-watch'], steps: { r: 1 } }), 'vi');
    expect(r.cards).toEqual([{ name: 'Boost', price: '$179/tháng' }]);
    expect(r.reply.startsWith('[Boost · $179/tháng]')).toBe(true);
    expect(r.trace).toEqual(expect.arrayContaining(['get_software_plans: Starter $29, Pro $69', '[check] price-watch']));
    expect(r.trace.some((l) => l.startsWith('[rewritten]'))).toBe(true);
    // Only real tools read as tools — the notes in [brackets] are not mistaken for one.
    expect(toolsFromTrace(r.trace)).toEqual(['get_software_plans']);
  });

  it('ships to the test accounts only, and is a test tool the golden run does not gate', () => {
    expect(RELEASE_FEATURES.liveTry.ships).toBe('canary');
    expect(isUiFeature('liveTry')).toBe(true);
  });
});
