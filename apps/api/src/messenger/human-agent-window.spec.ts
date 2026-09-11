/**
 * THE NINE CHECKS FROM THE META SUBMISSION SPEC.
 *
 * Every one of these is a sentence in the note that goes to App Review. A note
 * claiming "Lumio refuses to send after seven days" is a statement about this
 * code; if the code stops doing it, the statement becomes false and the app is
 * misrepresenting itself to Meta. That is why these are tests and not a manual
 * checklist someone ticks once before filming.
 */
import { windowState, blockMessage, RESPONSE_WINDOW_MS, HUMAN_AGENT_WINDOW_MS } from './human-agent';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 86_400_000;

describe('the four states, from one field', () => {
  // CHECK 7 — a two-hour-old conversation sends normally, with NO tag.
  it('under 24 hours: open, RESPONSE, no tag', () => {
    const w = windowState(ago(2 * H), 'bot', NOW);
    expect(w.kind).toBe('open');
    expect(w.canSend).toBe(true);
    expect(w.body).toEqual({ messaging_type: 'RESPONSE' });
    expect(JSON.stringify(w.body)).not.toContain('HUMAN_AGENT');
  });

  // CHECK 1 — three days old, bot still holding: refused, and the reason names
  // the missing thing (a human) rather than the clock.
  it('24h-7d with the bot holding: refused with take_over_required', () => {
    const w = windowState(ago(3 * D), 'bot', NOW);
    expect(w.kind).toBe('needs-takeover');
    expect(w.canSend).toBe(false);
    expect(w.code).toBe('take_over_required');
    expect(w.body).toBeNull();
    expect(w.daysLeft).toBe(4);
  });

  // CHECK 2 + 3 — the same conversation, after Take over. This pair IS the
  // permission argument: identical age, opposite outcome, and the only thing
  // that changed is that a person is now answering.
  it('24h-7d with a human holding: sends under the HUMAN_AGENT tag', () => {
    const w = windowState(ago(3 * D), 'human', NOW);
    expect(w.kind).toBe('human-agent');
    expect(w.canSend).toBe(true);
    expect(w.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    expect(w.daysLeft).toBe(4);
  });

  it('the ONLY difference between refusing and tagging is who holds the thread', () => {
    const bot = windowState(ago(3 * D), 'bot', NOW);
    const human = windowState(ago(3 * D), 'human', NOW);
    expect(bot.ageHours).toBe(human.ageHours);
    expect(bot.daysLeft).toBe(human.daysLeft);
    expect(bot.canSend).toBe(false);
    expect(human.canSend).toBe(true);
  });

  // CHECK 5 + 6 — eleven days. Nobody may send, not even a person.
  it('past 7 days: closed for everyone, human included', () => {
    for (const holder of ['bot', 'human'] as const) {
      const w = windowState(ago(11 * D), holder, NOW);
      expect(w.kind).toBe('closed');
      expect(w.canSend).toBe(false);
      expect(w.code).toBe('window_closed');
      expect(w.body).toBeNull();
    }
  });

  it('the boundaries land on the right side', () => {
    expect(windowState(ago(RESPONSE_WINDOW_MS - 1000), 'bot', NOW).kind).toBe('open');
    expect(windowState(ago(RESPONSE_WINDOW_MS + 1000), 'human', NOW).kind).toBe('human-agent');
    expect(windowState(ago(HUMAN_AGENT_WINDOW_MS - 1000), 'human', NOW).kind).toBe('human-agent');
    expect(windowState(ago(HUMAN_AGENT_WINDOW_MS + 1000), 'human', NOW).kind).toBe('closed');
  });

  it('days_left is rounded up and never says zero while the window is open', () => {
    // Six days and twenty-three hours in: minutes remain, and "0 days left"
    // on a window you can still use is a lie in the direction that loses a
    // customer. max(1, ceil(...)) is the spec, and this is why.
    const w = windowState(ago(7 * D - 1 * H), 'human', NOW);
    expect(w.kind).toBe('human-agent');
    expect(w.daysLeft).toBe(1);
  });

  it('no timestamp at all is treated as the ordinary window, not as blocked', () => {
    // Our copy of "when they last wrote" can be missing. Refusing on a missing
    // value would make a conversation unanswerable because of OUR gap; Meta is
    // the party that actually knows, and it will say so.
    const w = windowState(null, 'bot', NOW);
    expect(w.kind).toBe('unknown');
    expect(w.canSend).toBe(true);
    expect(w.body).toEqual({ messaging_type: 'RESPONSE' });
  });

  it('a garbage timestamp does not silently become 1970', () => {
    const w = windowState('not a date', 'bot', NOW);
    expect(w.kind).toBe('unknown');
    expect(w.canSend).toBe(true);
  });

  it('the bot never gets a tagged envelope, at any age', () => {
    for (const h of [1, 25, 3 * 24, 6 * 24, 20 * 24]) {
      const w = windowState(ago(h * H), 'bot', NOW);
      expect(JSON.stringify(w.body ?? {})).not.toContain('HUMAN_AGENT');
    }
  });

  // CHECK 8 — the bot is SILENT past 24h, not "sends without the tag".
  it('the bot may not send anything at all past 24 hours', () => {
    expect(windowState(ago(25 * H), 'bot', NOW).canSend).toBe(false);
    expect(windowState(ago(6 * D), 'bot', NOW).canSend).toBe(false);
  });
});

describe('what the refusal says', () => {
  it('names the seven-day window, not the 24-hour one, when it is shut', () => {
    const en = blockMessage('window_closed');
    expect(en).toContain('7 days');
    expect(en).not.toContain('24 hours');
  });

  it('tells the reader what to press when a person is missing', () => {
    expect(blockMessage('take_over_required')).toContain('Take over');
  });

  it('answers in Vietnamese when asked to', () => {
    expect(blockMessage('window_closed', true)).toContain('7 ngày');
  });
});
