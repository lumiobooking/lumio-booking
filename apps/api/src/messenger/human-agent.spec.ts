import {
  lastInboundAt, outboundEnvelope, replyWindowState,
  RESPONSE_WINDOW_MS, HUMAN_AGENT_WINDOW_MS,
} from './human-agent';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('the window a reply is allowed to go out in', () => {
  it('measures from the customer’s last line, not from ours', () => {
    const history = [
      { role: 'user', content: 'hi', at: ago(3 * 3_600_000) },
      { role: 'assistant', content: 'hello', at: ago(1000) },
    ];
    expect(lastInboundAt(history)).toBe(ago(3 * 3_600_000));
  });

  it('returns null when no customer turn carries a timestamp — and null is not "long ago"', () => {
    expect(lastInboundAt([{ role: 'assistant', content: 'hi', at: ago(1000) }])).toBeNull();
    expect(lastInboundAt([])).toBeNull();
    expect(lastInboundAt(null)).toBeNull();
    // An unknown time attempts the send rather than refusing it: Meta knows the
    // real answer, we only have a copy that can be missing.
    expect(outboundEnvelope({ lastInbound: null, byHuman: false }, NOW).body).toEqual({ messaging_type: 'RESPONSE' });
  });

  it('sends plainly inside 24 hours, for bot and human alike', () => {
    const fresh = ago(RESPONSE_WINDOW_MS - 60_000);
    for (const byHuman of [true, false]) {
      const e = outboundEnvelope({ lastInbound: fresh, byHuman }, NOW);
      expect(e.body).toEqual({ messaging_type: 'RESPONSE' });
      expect(e.humanAgent).toBe(false);
    }
  });

  it('tags a HUMAN’s reply after 24 hours, which is what the feature is for', () => {
    const e = outboundEnvelope({ lastInbound: ago(3 * 24 * 3_600_000), byHuman: true }, NOW);
    expect(e.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    expect(e.humanAgent).toBe(true);
    expect(e.refusal).toBeNull();
  });

  it('never lends the tag to the bot — that is the abuse the rule exists to stop', () => {
    const e = outboundEnvelope({ lastInbound: ago(3 * 24 * 3_600_000), byHuman: false }, NOW);
    expect(e.body).toBeNull();
    expect(e.humanAgent).toBe(false);
    expect(e.refusal).toMatch(/24 giờ/);
  });

  it('will not be talked into the tag by a truthy non-true value', () => {
    const sneaky = { lastInbound: ago(3 * 24 * 3_600_000), byHuman: 1 as unknown as boolean };
    expect(outboundEnvelope(sneaky, NOW).body).toBeNull();
  });

  it('stops at seven days even for a human — Meta shuts the door for good', () => {
    const e = outboundEnvelope({ lastInbound: ago(HUMAN_AGENT_WINDOW_MS + 60_000), byHuman: true }, NOW);
    expect(e.body).toBeNull();
    expect(e.refusal).toMatch(/7 ngày/);
  });

  it('names the three states the inbox has to show', () => {
    expect(replyWindowState(ago(2 * 3_600_000), NOW).kind).toBe('open');
    expect(replyWindowState(ago(30 * 3_600_000), NOW).kind).toBe('human-agent');
    expect(replyWindowState(ago(9 * 24 * 3_600_000), NOW).kind).toBe('closed');
    expect(replyWindowState(null, NOW).kind).toBe('unknown');
  });

  it('counts the hours left in whichever window applies', () => {
    expect(replyWindowState(ago(2 * 3_600_000), NOW).hoursLeft).toBe(22);
    // 30 hours in: five days and eighteen hours of the seven remain.
    expect(replyWindowState(ago(30 * 3_600_000), NOW).hoursLeft).toBe(138);
  });
});
