import { mergeHistory, sortByTime, type HistoryTurn } from './history-merge';
import { lastInboundAt, customerLastWroteAt, outboundEnvelope } from './human-agent';

/**
 * The five faults found in the inbox on 11 September, each pinned here.
 *
 * L1 and L2 are one fault wearing two coats. The visible half was a header
 * saying "wrote 1h ago" over a thread whose customer wrote the night before.
 * The dangerous half is that the SAME reading drives Meta's HUMAN_AGENT tag:
 * conclude the 24-hour window is shut when it is open, and the app attaches a
 * tag it is not entitled to. That is a policy violation, not a display bug,
 * and it is what these tests exist to stop.
 */

const t = (role: 'user' | 'assistant', content: string, at?: string, extra: Partial<HistoryTurn> = {}): HistoryTurn =>
  ({ role, content, ...(at ? { at } : {}), ...extra });

// ---------------------------------------------------------------- L2
describe('L2 · the transcript is in clock order, whatever order it arrived in', () => {
  it('a staff reply Meta has not returned lands by its time, not at the bottom', () => {
    const meta = [
      t('user', 'hi', '2026-09-01T07:00:00Z'),
      t('user', 'still there?', '2026-09-10T23:38:00Z'),
    ];
    const ours = [t('assistant', 'on my way', '2026-09-01T07:02:00Z', { manual: true })];
    const out = mergeHistory(meta, ours);
    expect(out.map((x) => x.content)).toEqual(['hi', 'on my way', 'still there?']);
  });

  it('the exact shape reported: Sep 1 07:02 must not sit under last night', () => {
    const out = sortByTime([
      t('user', 'last night', '2026-09-10T23:38:00Z'),
      t('assistant', 'Sep 1 07:12', '2026-09-01T07:12:00Z'),
      t('assistant', 'Sep 1 07:02', '2026-09-01T07:02:00Z'),
    ]);
    expect(out.map((x) => x.content)).toEqual(['Sep 1 07:02', 'Sep 1 07:12', 'last night']);
  });

  it('turns with no clock keep the order they came in rather than being invented', () => {
    const out = sortByTime([t('user', 'a'), t('user', 'b'), t('user', 'c')]);
    expect(out.map((x) => x.content)).toEqual(['a', 'b', 'c']);
  });

  it('still shows our buffer when Meta could not be reached', () => {
    const ours = [t('user', 'hi', '2026-09-01T07:00:00Z')];
    expect(mergeHistory(null, ours)).toEqual(ours);
  });
});

// ---------------------------------------------------------------- L1
describe('L1 · when the customer last wrote', () => {
  it('takes the NEWEST customer turn, not the last one in the array', () => {
    // Exactly what mergeHistory used to produce: an old turn appended last.
    const history = [
      t('user', 'newest', '2026-09-10T23:38:00Z'),
      t('assistant', 'bot', '2026-09-11T06:00:00Z'),
      t('user', 'old, appended late', '2026-09-01T07:00:00Z'),
    ];
    expect(lastInboundAt(history)).toBe('2026-09-10T23:38:00Z');
  });

  it('THE POLICY CASE: an out-of-order buffer must not open the human-agent tag', () => {
    // Customer wrote 2 hours ago — the window is OPEN, so a reply is a plain
    // RESPONSE and the tag must NOT be attached.
    const now = new Date('2026-09-11T08:00:00Z');
    const history = [
      t('user', 'two hours ago', '2026-09-11T06:00:00Z'),
      t('user', 'ten days ago, appended last', '2026-09-01T07:00:00Z'),
    ];
    const env = outboundEnvelope({ lastInbound: lastInboundAt(history), byHuman: true }, now);
    expect(env.body).toEqual({ messaging_type: 'RESPONSE' });
    expect(JSON.stringify(env.body)).not.toContain('HUMAN_AGENT');
  });

  it('the column beats the buffer — it is the one only an inbound moves', () => {
    const history = [t('user', 'stale buffer', '2026-09-01T07:00:00Z')];
    // Compared as instants: the column is a Date, so it comes back with
    // milliseconds — same moment, different spelling.
    expect(Date.parse(customerLastWroteAt(new Date('2026-09-10T23:38:00Z'), history) as string))
      .toBe(Date.parse('2026-09-10T23:38:00Z'));
  });

  it('falls back to the buffer for rows written before the column existed', () => {
    const history = [t('user', 'only record', '2026-09-01T07:00:00Z')];
    expect(customerLastWroteAt(null, history)).toBe('2026-09-01T07:00:00Z');
  });

  it('a rubbish column value does not win over a real buffer', () => {
    const history = [t('user', 'real', '2026-09-01T07:00:00Z')];
    expect(customerLastWroteAt('not a date', history)).toBe('2026-09-01T07:00:00Z');
  });
});

// ---------------------------------------------------------------- L4
describe('L4 · the 7-day door is shut by the server, not by hiding a button', () => {
  const now = new Date('2026-09-11T08:00:00Z');

  it('refuses a send 21 days after the customer wrote', () => {
    const env = outboundEnvelope({ lastInbound: '2026-08-21T07:00:00Z', byHuman: true }, now);
    expect(env.body).toBeNull();
    expect(env.refusal).toBeTruthy();
  });

  it('inside 7 days a human may still answer, under the tag', () => {
    const env = outboundEnvelope({ lastInbound: '2026-09-08T07:00:00Z', byHuman: true }, now);
    expect(env.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });

  it('the bot never gets the tag, however old the conversation', () => {
    const env = outboundEnvelope({ lastInbound: '2026-09-08T07:00:00Z', byHuman: false }, now);
    expect(JSON.stringify(env.body ?? {})).not.toContain('HUMAN_AGENT');
  });
});

// ---------------------------------------------------------------- L5
describe('L5 · bot and staff are told apart by id, not by wording', () => {
  it('a receptionist typing "Thank you" does not turn the bot into staff', () => {
    const meta = [
      t('assistant', 'Thank you', '2026-09-01T07:00:00Z', { messageId: 'm-bot' }),
      t('assistant', 'Thank you', '2026-09-01T07:12:00Z', { messageId: 'm-staff' }),
    ];
    const ours = [t('assistant', 'Thank you', '2026-09-01T07:12:00Z', { manual: true, messageId: 'm-staff' })];
    const out = mergeHistory(meta, ours);
    expect(out.map((x) => Boolean(x.manual))).toEqual([false, true]);
  });

  it('without ids it marks ONE message, not every one with that text', () => {
    const meta = [
      t('assistant', 'Thank you', '2026-09-01T07:00:00Z'),
      t('assistant', 'Thank you', '2026-09-01T07:12:00Z'),
    ];
    const ours = [t('assistant', 'Thank you', '2026-09-01T07:12:00Z', { manual: true })];
    const out = mergeHistory(meta, ours);
    expect(out.filter((x) => x.manual)).toHaveLength(1);
  });

  it('a customer message is never marked as staff', () => {
    const meta = [t('user', 'Thank you', '2026-09-01T07:00:00Z')];
    const ours = [t('assistant', 'Thank you', '2026-09-01T07:12:00Z', { manual: true })];
    expect(mergeHistory(meta, ours).find((x) => x.role === 'user')?.manual).toBeFalsy();
  });
});
