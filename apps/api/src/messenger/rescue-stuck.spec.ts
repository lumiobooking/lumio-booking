import { mayAnswerMirrored, rescueVerdict, RESCUE_WINDOW_MS, type StuckThreadLike } from './rescue-stuck';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000);
const rules = { botOn: true, botFirst: false, graceMins: 5 };
const t = (over: Partial<StuckThreadLike> = {}): StuckThreadLike => ({
  status: 'open', handoff: false, handoffMode: 'auto', lastRole: 'user', lastCustomerAt: ago(10), channel: 'messenger', ...over,
});

describe('rescuing a customer left on "seen"', () => {
  it('answers a line nobody answered after the live path had its time', () => {
    expect(rescueVerdict(t(), rules, NOW)).toEqual({ rescue: true, release: false });
  });

  it('leaves alone what the bot could not have answered on time either', () => {
    expect(rescueVerdict(t(), { ...rules, botOn: false }, NOW)).toMatchObject({ rescue: false, why: 'bot-off' });
    expect(rescueVerdict(t({ status: 'done' }), rules, NOW)).toMatchObject({ why: 'closed' });
    expect(rescueVerdict(t({ status: 'spam' }), rules, NOW)).toMatchObject({ why: 'closed' });
    expect(rescueVerdict(t({ lastRole: 'assistant' }), rules, NOW)).toMatchObject({ why: 'answered' });
    expect(rescueVerdict(t({ channel: 'web' }), rules, NOW)).toMatchObject({ why: 'web' });
  });

  it('gives the live path its minutes, and never answers past Meta\'s 24 hours', () => {
    expect(rescueVerdict(t({ lastCustomerAt: ago(1) }), rules, NOW)).toMatchObject({ why: 'too-new' });
    expect(rescueVerdict(t({ lastCustomerAt: new Date(NOW - RESCUE_WINDOW_MS - 1) }), rules, NOW)).toMatchObject({ why: 'too-old' });
    // the May message in an inbox imported in October
    expect(rescueVerdict(t({ lastCustomerAt: '2026-05-11T17:11:00Z' }), rules, NOW)).toMatchObject({ why: 'too-old' });
  });

  it('never speaks over someone who pressed Take over', () => {
    expect(rescueVerdict(t({ handoff: true, handoffMode: 'locked', handoffAt: ago(600) }), rules, NOW)).toMatchObject({ why: 'locked' });
  });

  it('a conversation given to a person waits for them, unless the bot answers first', () => {
    expect(rescueVerdict(t({ assignedUserId: 'u1' }), rules, NOW)).toMatchObject({ why: 'assigned' });
    expect(rescueVerdict(t({ assignedUserId: 'u1' }), { ...rules, botFirst: true }, NOW)).toEqual({ rescue: true, release: false });
  });

  it('a guessed human keeps the grace, then the bot answers and takes the thread back', () => {
    // The Page answered at 11:45, the customer wrote at 11:46: the grace timer
    // died in a deploy. Ten minutes on, nobody answered.
    expect(rescueVerdict(t({ handoff: true, handoffAt: ago(11), lastCustomerAt: ago(10) }), rules, NOW)).toEqual({ rescue: true, release: true });
    // Still inside grace (+1 min margin)
    expect(rescueVerdict(t({ handoff: true, handoffAt: ago(6), lastCustomerAt: ago(5) }), rules, NOW)).toMatchObject({ why: 'human-grace' });
    // The human's line is newer than the customer's — it was answered
    expect(rescueVerdict(t({ handoff: true, handoffAt: ago(2), lastCustomerAt: ago(10) }), rules, NOW)).toMatchObject({ why: 'human-grace' });
  });

  it('the mirror answers a dropped line only inside the window', () => {
    expect(mayAnswerMirrored(60_000, 45_000)).toBe(true);
    expect(mayAnswerMirrored(30_000, 45_000)).toBe(false);
    expect(mayAnswerMirrored(RESCUE_WINDOW_MS + 1, 45_000)).toBe(false);
  });
});
