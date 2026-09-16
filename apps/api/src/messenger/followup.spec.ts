import {
  cleanFollowUp, decideFollowUp, DEFAULT_FOLLOWUP, nudgeText, saysStop, WINDOW_MS,
  type FollowUpSettings, type ThreadState,
} from './followup';

const NOW = new Date('2026-09-16T14:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const on: FollowUpSettings = { ...DEFAULT_FOLLOWUP, enabled: true };

/** A customer who asked at 13:00, was answered at 13:05, and went quiet. */
const quiet = (over: Partial<ThreadState> = {}): ThreadState => ({
  lastCustomerAt: ago(60),
  lastOutboundAt: ago(55),
  nudges: 0,
  lastNudgeAt: null,
  booked: false,
  botMaySpeak: true,
  optedOut: false,
  ...over,
});

describe('the one nudge that is worth sending', () => {
  it('sends it: asked, answered, an hour of silence, still inside the window', () => {
    expect(decideFollowUp(quiet(), on, NOW, 14)).toEqual({ send: true, nth: 1 });
  });

  it('sends nothing at all until the salon turns it on', () => {
    expect(decideFollowUp(quiet(), DEFAULT_FOLLOWUP, NOW, 14)).toEqual({ send: false, why: 'off' });
    expect(cleanFollowUp({}).enabled).toBe(false);
    expect(cleanFollowUp({ enabled: 'yes' }).enabled).toBe(false);
  });
});

describe('the rules that keep the Page alive', () => {
  it('never writes once Meta’s 24 hours are up', () => {
    const old = quiet({ lastCustomerAt: new Date(NOW.getTime() - WINDOW_MS - 60_000).toISOString() });
    expect(decideFollowUp(old, on, NOW, 14)).toEqual({ send: false, why: 'window-closed' });
  });

  it('stops an hour EARLY, so a send in flight cannot land after the door shuts', () => {
    const at23h = quiet({ lastCustomerAt: new Date(NOW.getTime() - 23.5 * 3_600_000).toISOString(), lastOutboundAt: ago(60) });
    expect(decideFollowUp(at23h, on, NOW, 14)).toEqual({ send: false, why: 'window-closed' });
    const at22h = quiet({ lastCustomerAt: new Date(NOW.getTime() - 22 * 3_600_000).toISOString(), lastOutboundAt: ago(60) });
    expect(decideFollowUp(at22h, on, NOW, 14).send).toBe(true);
  });

  it('obeys "stop" for ever, whatever else is true', () => {
    expect(decideFollowUp(quiet({ optedOut: true }), on, NOW, 14)).toEqual({ send: false, why: 'opted-out' });
    for (const s of ['stop', 'STOP', 'huỷ', 'đừng nhắn nữa', 'Không nhắn nữa!', 'unsubscribe', 'ngừng nhắn tin cho tôi', 'please stop messaging me']) {
      expect(saysStop(s)).toBe(true);
    }
    // and does NOT fire on ordinary sentences that merely contain the words —
    // reading one of these as "never contact me" loses a customer silently
    for (const s of ['cho em hỏi giá', 'stopover in Austin next week', 'bàn dừng lại ở đó', 'em muốn hủy lịch thứ Ba', 'chỗ đó dừng bán rồi hả chị']) {
      expect(saysStop(s)).toBe(false);
    }
  });

  it('never talks over a person who has taken the thread', () => {
    expect(decideFollowUp(quiet({ botMaySpeak: false }), on, NOW, 14)).toEqual({ send: false, why: 'human' });
  });

  it('never nudges somebody who already booked', () => {
    expect(decideFollowUp(quiet({ booked: true }), on, NOW, 14)).toEqual({ send: false, why: 'booked' });
  });

  it('holds until the salon is open, then sends — a 2am nudge is how a Page gets reported', () => {
    expect(decideFollowUp(quiet(), on, NOW, 2)).toEqual({ send: false, why: 'quiet-hours' });
    expect(decideFollowUp(quiet(), on, NOW, 21)).toEqual({ send: false, why: 'quiet-hours' });
    expect(decideFollowUp(quiet(), on, NOW, 9).send).toBe(true);
    expect(decideFollowUp(quiet(), on, NOW, 19).send).toBe(true);
  });
});

describe('the rules that keep it from being annoying', () => {
  it('waits the configured quiet time before the first one', () => {
    expect(decideFollowUp(quiet({ lastOutboundAt: ago(20) }), on, NOW, 14)).toEqual({ send: false, why: 'too-soon' });
    expect(decideFollowUp(quiet({ lastOutboundAt: ago(46) }), on, NOW, 14).send).toBe(true);
  });

  it('measures the silence from OUR last message, not from the customer’s', () => {
    // a long conversation: they wrote at 13:00, we were still answering at 13:58
    const justAnswered = quiet({ lastCustomerAt: ago(60), lastOutboundAt: ago(2) });
    expect(decideFollowUp(justAnswered, on, NOW, 14)).toEqual({ send: false, why: 'too-soon' });
  });

  it('owes a REPLY, not a nudge, when the customer spoke last', () => {
    const waiting = quiet({ lastCustomerAt: ago(50), lastOutboundAt: ago(70) });
    expect(decideFollowUp(waiting, on, NOW, 14)).toEqual({ send: false, why: 'customer-spoke-last' });
  });

  it('sends one and only one by default', () => {
    expect(decideFollowUp(quiet({ nudges: 1, lastNudgeAt: ago(120) }), on, NOW, 14)).toEqual({ send: false, why: 'enough' });
  });

  it('sends a second only when the salon asked for one, and after its own wait', () => {
    const two = { ...on, maxPerWindow: 2, secondAfterMin: 180 };
    const once = quiet({ nudges: 1, lastNudgeAt: ago(60), lastCustomerAt: ago(300), lastOutboundAt: ago(290) });
    expect(decideFollowUp(once, two, NOW, 14)).toEqual({ send: false, why: 'too-soon' });
    expect(decideFollowUp({ ...once, lastNudgeAt: ago(200) }, two, NOW, 14)).toEqual({ send: true, nth: 2 });
  });

  it('a second wait of zero means "never send a second", not "send it immediately"', () => {
    const two = { ...on, maxPerWindow: 2, secondAfterMin: 0 };
    expect(decideFollowUp(quiet({ nudges: 1, lastNudgeAt: ago(999) }), two, NOW, 14)).toEqual({ send: false, why: 'enough' });
  });

  it('says nothing when it does not know when the customer wrote', () => {
    expect(decideFollowUp(quiet({ lastCustomerAt: null }), on, NOW, 14)).toEqual({ send: false, why: 'no-inbound' });
    expect(decideFollowUp(quiet({ lastCustomerAt: 'not a date' }), on, NOW, 14)).toEqual({ send: false, why: 'no-inbound' });
  });
});

describe('settings that cannot be set to something harmful', () => {
  it('refuses a wait short enough to interrupt somebody mid-read', () => {
    expect(cleanFollowUp({ enabled: true, firstAfterMin: 1 }).firstAfterMin).toBe(10);
    expect(cleanFollowUp({ enabled: true, firstAfterMin: 99999 }).firstAfterMin).toBe(720);
  });
  it('caps the number of nudges however hard somebody leans on the field', () => {
    expect(cleanFollowUp({ maxPerWindow: 50 }).maxPerWindow).toBe(2);
    expect(cleanFollowUp({ maxPerWindow: -3 }).maxPerWindow).toBe(0);
  });
  it('reads an inverted or empty hour range as the default evening, not as "never"', () => {
    expect(cleanFollowUp({ hourFrom: 20, hourTo: 9 })).toMatchObject({ hourFrom: 20, hourTo: 20 });
    expect(cleanFollowUp({ hourFrom: 9, hourTo: 22 })).toMatchObject({ hourFrom: 9, hourTo: 22 });
  });
  it('reads junk as the defaults', () => {
    expect(cleanFollowUp('nonsense')).toEqual(DEFAULT_FOLLOWUP);
  });
});

describe('what the nudge says when no model writes it', () => {
  it('is one short line that asks something answerable, and differs the second time', () => {
    expect(nudgeText(1, true)).toContain('?');
    expect(nudgeText(2, true)).not.toBe(nudgeText(1, true));
    expect(nudgeText(1, false)).toContain('?');
    // out-of-range indexes must not crash a sweep
    expect(nudgeText(0, true)).toBe(nudgeText(1, true));
    expect(nudgeText(9, true)).toBe(nudgeText(2, true));
  });
});
