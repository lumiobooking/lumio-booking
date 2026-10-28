/**
 * ONE list of facts. A sales page (Lumio's own agency page) used to answer
 * from the Messenger connection's older copy while the owner was fixing the
 * facts in the AI brain — the fix ("Social Care: no Shorts, no Yelp") never
 * reached the chat. Once the brain is saved with facts, every reader uses it.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService, type BotFact } from './messenger.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OLD: BotFact[] = [{ label: 'Gói Social Care $45/th', value: 'Đăng đều FB, IG, TikTok, Shorts, Yelp', on: true }];
const FIXED = [{ label: 'Gói Social Care $45/th', value: 'Đăng đều Facebook, Instagram, TikTok', on: true }];

function build(brains: Record<string, { brain: Row; legacy: boolean }>) {
  const brain = { getBrainFor: jest.fn(async (t: string) => brains[t] ?? { brain: { version: 0, knowledge: { facts: [], rules: '' } }, legacy: true }) };
  const s = new MessengerService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, brain as never, undefined);
  return { s: s as unknown as { factsOf: (t: string, c: unknown) => Promise<BotFact[]>; brainRules: (t: string) => Promise<string> }, brain };
}

describe('the facts a chat answers from', () => {
  it('a saved brain with facts wins over the connection\'s old copy — the fixed fact is what the chat says', async () => {
    const { s } = build({ ta: { brain: { version: 4, knowledge: { facts: FIXED, rules: 'Không xưng "mình".' } }, legacy: false } });
    const facts = await s.factsOf('ta', { botFacts: OLD });
    expect(facts).toEqual([{ label: 'Gói Social Care $45/th', value: 'Đăng đều Facebook, Instagram, TikTok', on: true, from: null, until: null }]);
    expect(JSON.stringify(facts)).not.toMatch(/Shorts|Yelp/);
    expect(await s.brainRules('ta')).toContain('Không xưng "mình".');
  });

  it('never saved, or saved without facts: the connection\'s list as before', async () => {
    const { s } = build({ tb: { brain: { version: 2, knowledge: { facts: [], rules: '' } }, legacy: false } });
    expect(await s.factsOf('tc', { botFacts: OLD })).toEqual(OLD); // legacy brain
    expect(await s.factsOf('tb', { botFacts: OLD })).toEqual(OLD); // saved, no facts
    expect(await s.brainRules('tc')).toBe('');
  });

  it('each salon reads its own brain only (cross-tenant)', async () => {
    const { s, brain } = build({ ta: { brain: { version: 4, knowledge: { facts: FIXED, rules: '' } }, legacy: false } });
    expect(await s.factsOf('tb', { botFacts: [] })).toEqual([]);
    expect(brain.getBrainFor).toHaveBeenLastCalledWith('tb');
  });
});
