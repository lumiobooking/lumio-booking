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

describe('the reminder tag — the one door open to an automation past 24 hours', () => {
  const NOW = new Date('2026-09-16T14:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

  it('sends a booking reminder three days later, with no phone number needed', () => {
    const e = outboundEnvelope(
      { lastInbound: daysAgo(3), byHuman: false, purpose: 'appointment-reminder', text: 'Dạ mai 2 giờ chiều chị có hẹn làm móng bên em nhé.' },
      NOW,
    );
    expect(e.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' });
    expect(e.refusal).toBeNull();
    expect(e.humanAgent).toBe(false);
  });

  it('works even past seven days — a booking made a fortnight ahead is still a booking', () => {
    const e = outboundEnvelope(
      { lastInbound: daysAgo(14), byHuman: false, purpose: 'appointment-reminder', text: 'Nhắc chị: 10h sáng thứ Bảy này ạ.' },
      NOW,
    );
    expect(e.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' });
  });

  it('REFUSES a reminder with a price or an offer bolted on — that is what costs the Page', () => {
    for (const text of [
      'Mai 2h chị có hẹn nhé — hôm nay giảm 20% cho bộ gel ạ!',
      'Reminder: 2pm tomorrow. Also $40 off a full set this week!',
      'Nhắc lịch 10h ạ. Tặng kèm vẽ móng miễn phí nha chị',
      'See you at 3 — special offer on lashes today',
    ]) {
      const e = outboundEnvelope({ lastInbound: daysAgo(3), byHuman: false, purpose: 'appointment-reminder', text }, NOW);
      expect(e.body).toBeNull();
      expect(e.refusal).toMatch(/khuyến mãi|promotional/i);
    }
  });

  it('refuses the promotional reminder even INSIDE 24h, where it would have been legal', () => {
    // legal as a plain RESPONSE, but it is being sent as a reminder, and a
    // reminder that sells is mislabelled whatever the window says
    const e = outboundEnvelope(
      { lastInbound: new Date(NOW.getTime() - 3_600_000).toISOString(), byHuman: false, purpose: 'appointment-reminder', text: 'Nhắc lịch 2h ạ, giảm 10% nhé' },
      NOW,
    );
    expect(e.body).toBeNull();
  });

  it('lets an ordinary reminder through that merely mentions a number', () => {
    const e = outboundEnvelope(
      { lastInbound: daysAgo(2), byHuman: false, purpose: 'appointment-reminder', text: 'Dạ 2 giờ chiều mai chị nhé, thợ Anna làm cho chị ạ.' },
      NOW,
    );
    expect(e.body).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' });
  });

  it('changes nothing about ordinary chat: the bot is still shut out past 24h', () => {
    const e = outboundEnvelope({ lastInbound: daysAgo(2), byHuman: false }, NOW);
    expect(e.body).toBeNull();
    expect(e.refusal).toMatch(/24 giờ/);
  });
});
