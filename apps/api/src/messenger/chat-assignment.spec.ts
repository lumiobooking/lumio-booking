import { pickAgent, isOnShift, DEFAULT_CHAT_RULES, ChatAgent } from './chat-assignment';

const agent = (userId: string, openThreads = 0, onShift = true): ChatAgent => ({ userId, onShift, openThreads });
const ON = { mode: 'round-robin' as const, maxOpenPerAgent: 5, preferUsualTech: true };

describe('a salon that has not asked for this keeps the bot', () => {
  // Turning auto-distribution on changes who answers customers. That is the
  // salon's decision, not something acquired by taking an update.
  it('is off by default', () => {
    expect(DEFAULT_CHAT_RULES.mode).toBe('off');
  });

  it('picks nobody when the rules are off, however many staff are free', () => {
    const p = pickAgent({ agents: [agent('a'), agent('b')], rules: { mode: 'off' } });
    expect(p).toEqual({ userId: null, reason: 'rules-off' });
  });

  it.each([null, undefined, {}])('treats %s rules as off', (rules) => {
    expect(pickAgent({ agents: [agent('a')], rules: rules as never }).userId).toBeNull();
  });
});

describe('nobody is picked when nobody can answer', () => {
  // Returning null is a real answer: the bot keeps it. Routing a customer to
  // someone who is not working is worse than a bot reply that arrives now.
  it('skips staff who are off shift', () => {
    const p = pickAgent({ agents: [agent('a', 0, false), agent('b', 0, false)], rules: ON });
    expect(p).toEqual({ userId: null, reason: 'nobody-on-shift' });
  });

  it('hands back to the bot when everyone is at their limit', () => {
    const p = pickAgent({ agents: [agent('a', 5), agent('b', 5)], rules: ON });
    expect(p).toEqual({ userId: null, reason: 'everyone-at-capacity' });
  });

  it('treats 0 as no limit rather than as a limit of zero', () => {
    // A cap of zero read literally would block every assignment forever, and
    // "unlimited" is the natural meaning of leaving the box empty.
    const p = pickAgent({ agents: [agent('a', 99)], rules: { ...ON, maxOpenPerAgent: 0 } });
    expect(p.userId).toBe('a');
  });

  it('copes with an empty team', () => {
    expect(pickAgent({ agents: [], rules: ON }).reason).toBe('nobody-on-shift');
  });
});

describe('a returning customer goes back to her own technician', () => {
  // The rule a generic inbox cannot have: Hà already knows the shape of her
  // nails and what was said last time.
  it('picks the usual technician over an idle stranger', () => {
    const p = pickAgent({
      agents: [agent('ha', 3), agent('stranger', 0)],
      usualUserId: 'ha',
      rules: ON,
    });
    expect(p).toEqual({ userId: 'ha', reason: 'usual-technician' });
  });

  // Routing to someone who cannot answer is worse than any stranger who can.
  it('falls back when the usual technician is not working today', () => {
    const p = pickAgent({
      agents: [agent('ha', 0, false), agent('mai', 1)],
      usualUserId: 'ha',
      rules: ON,
    });
    expect(p).toEqual({ userId: 'mai', reason: 'round-robin' });
  });

  it('falls back when the usual technician is already full', () => {
    const p = pickAgent({
      agents: [agent('ha', 5), agent('mai', 4)],
      usualUserId: 'ha',
      rules: ON,
    });
    expect(p).toEqual({ userId: 'mai', reason: 'round-robin' });
  });

  it('ignores a usual technician who no longer works here', () => {
    const p = pickAgent({ agents: [agent('mai', 2)], usualUserId: 'someone-who-left', rules: ON });
    expect(p).toEqual({ userId: 'mai', reason: 'round-robin' });
  });

  it('can be switched off by a salon that shares customers', () => {
    const p = pickAgent({
      agents: [agent('ha', 3), agent('mai', 0)],
      usualUserId: 'ha',
      rules: { ...ON, preferUsualTech: false },
    });
    expect(p).toEqual({ userId: 'mai', reason: 'round-robin' });
  });
});

describe('fair distribution', () => {
  it('gives it to whoever is holding the fewest', () => {
    const p = pickAgent({ agents: [agent('a', 4), agent('b', 1), agent('c', 3)], rules: ON });
    expect(p.userId).toBe('b');
  });

  // A strict rotation hands work to someone already buried; load first, then
  // rotate only between people who are equally busy.
  it('prefers load over rotation', () => {
    const p = pickAgent({ agents: [agent('a', 0), agent('b', 4)], lastAssignedUserId: 'a', rules: ON });
    expect(p.userId).toBe('a');
  });

  it('rotates between people who are equally idle', () => {
    const team = [agent('ha'), agent('mai'), agent('nga')];
    expect(pickAgent({ agents: team, lastAssignedUserId: 'ha', rules: ON }).userId).toBe('mai');
    expect(pickAgent({ agents: team, lastAssignedUserId: 'mai', rules: ON }).userId).toBe('nga');
    expect(pickAgent({ agents: team, lastAssignedUserId: 'nga', rules: ON }).userId).toBe('ha');
  });

  it('starts somewhere sensible when nobody has had one yet', () => {
    expect(pickAgent({ agents: [agent('ha'), agent('mai')], rules: ON }).userId).toBe('ha');
  });

  // An assignment that jitters cannot be tested, and cannot be explained to a
  // member of staff who asks why she got a conversation.
  it('gives the same answer every time for the same inputs', () => {
    const args = { agents: [agent('a'), agent('b'), agent('c')], lastAssignedUserId: 'b', rules: ON };
    const first = pickAgent(args).userId;
    for (let i = 0; i < 20; i++) expect(pickAgent(args).userId).toBe(first);
  });

  it('does not depend on the order the team came out of the database', () => {
    const a = pickAgent({ agents: [agent('ha'), agent('mai'), agent('nga')], lastAssignedUserId: 'ha', rules: ON });
    const b = pickAgent({ agents: [agent('nga'), agent('ha'), agent('mai')], lastAssignedUserId: 'ha', rules: ON });
    expect(a.userId).toBe(b.userId);
  });
});

describe('who is working right now', () => {
  const nine_to_five = [{ dayOfWeek: 4, startTime: '09:00', endTime: '17:00' }];

  it('is working mid-shift', () => {
    expect(isOnShift(nine_to_five, 4, 13 * 60)).toBe(true);
  });

  it('is working at the exact start, and not at the exact end', () => {
    expect(isOnShift(nine_to_five, 4, 9 * 60)).toBe(true);
    expect(isOnShift(nine_to_five, 4, 17 * 60)).toBe(false);
  });

  it('is not working before or after', () => {
    expect(isOnShift(nine_to_five, 4, 8 * 60 + 59)).toBe(false);
    expect(isOnShift(nine_to_five, 4, 18 * 60)).toBe(false);
  });

  it('is not working on another day', () => {
    expect(isOnShift(nine_to_five, 5, 13 * 60)).toBe(false);
  });

  it('handles a split shift', () => {
    const split = [
      { dayOfWeek: 4, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: 4, startTime: '14:00', endTime: '20:00' },
    ];
    expect(isOnShift(split, 4, 10 * 60)).toBe(true);
    expect(isOnShift(split, 4, 13 * 60)).toBe(false);
    expect(isOnShift(split, 4, 15 * 60)).toBe(true);
  });

  it('ignores a row that has been switched off', () => {
    expect(isOnShift([{ ...nine_to_five[0], isActive: false }], 4, 13 * 60)).toBe(false);
  });

  // Bad data must not read as an all-day shift — that would silently route
  // customers to someone who is not there.
  it.each([
    ['backwards', '18:00', '09:00'],
    ['unparseable', 'nine', 'five'],
    ['out of range', '25:00', '26:00'],
    ['empty', '', ''],
  ])('refuses %s hours rather than treating them as always open', (_n, startTime, endTime) => {
    expect(isOnShift([{ dayOfWeek: 4, startTime, endTime }], 4, 13 * 60)).toBe(false);
  });

  it.each([null, undefined, []])('says not working for %s', (hours) => {
    expect(isOnShift(hours as never, 4, 13 * 60)).toBe(false);
  });
});

import { isOnDuty, reassignDue } from './chat-assignment';

describe('strict turns: A → B → C → A', () => {
  const STRICT = { mode: 'round-robin' as const, rotation: 'strict' as const, maxOpenPerAgent: 0, preferUsualTech: false };
  const team = [agent('a', 3), agent('b', 0), agent('c', 9)];

  it('goes to the person after the last one served, whatever their load', () => {
    expect(pickAgent({ rules: STRICT, agents: team, lastAssignedUserId: 'a' }).userId).toBe('b');
    expect(pickAgent({ rules: STRICT, agents: team, lastAssignedUserId: 'b' }).userId).toBe('c');
    expect(pickAgent({ rules: STRICT, agents: team, lastAssignedUserId: 'c' }).userId).toBe('a');
  });

  it('starts at the top of the list when nobody has had a turn yet', () => {
    expect(pickAgent({ rules: STRICT, agents: team }).userId).toBe('a');
  });

  it('skips someone who is away and keeps the order for the rest', () => {
    const t = [agent('a'), agent('b', 0, false), agent('c')];
    expect(pickAgent({ rules: STRICT, agents: t, lastAssignedUserId: 'a' }).userId).toBe('c');
  });

  it('skips someone who is full', () => {
    const t = [agent('a'), agent('b', 5), agent('c')];
    expect(pickAgent({ rules: { ...STRICT, maxOpenPerAgent: 5 }, agents: t, lastAssignedUserId: 'a' }).userId).toBe('c');
  });

  it('never passes a conversation back to the person it is being taken from', () => {
    expect(pickAgent({ rules: STRICT, agents: [agent('a'), agent('b')], lastAssignedUserId: 'a', excludeUserId: 'b' }).userId).toBe('a');
    expect(pickAgent({ rules: STRICT, agents: [agent('a')], excludeUserId: 'a' }).userId).toBeNull();
  });

  it('still sends a returning customer to her own technician first', () => {
    expect(pickAgent({ rules: { ...STRICT, preferUsualTech: true }, agents: team, lastAssignedUserId: 'a', usualUserId: 'c' })).toEqual({ userId: 'c', reason: 'usual-technician' });
  });
});

describe('who is taking turns right now', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  const seen = new Date('2026-09-25T09:55:00Z');
  const ALL = { needStatus: true, needShift: true, needOnline: true, onlineMins: 10 };

  it('needs every test the salon switched on', () => {
    expect(isOnDuty({ status: 'available', onShift: true, lastSeenAt: seen }, ALL, now)).toBe(true);
    expect(isOnDuty({ status: 'away', onShift: true, lastSeenAt: seen }, ALL, now)).toBe(false);
    expect(isOnDuty({ status: 'available', onShift: false, lastSeenAt: seen }, ALL, now)).toBe(false);
    expect(isOnDuty({ status: 'available', onShift: true, lastSeenAt: new Date('2026-09-25T09:40:00Z') }, ALL, now)).toBe(false);
    expect(isOnDuty({ status: 'available', onShift: true, lastSeenAt: null }, ALL, now)).toBe(false);
  });

  it('ignores a test that is switched off', () => {
    expect(isOnDuty({ status: 'away', onShift: false, lastSeenAt: null }, { needStatus: false, needShift: false, needOnline: false, onlineMins: 10 }, now)).toBe(true);
  });

  it('does not fail someone with no schedule on the shift test', () => {
    expect(isOnDuty({ status: 'available', onShift: null, lastSeenAt: seen }, ALL, now)).toBe(true);
  });
});

describe('passing a conversation on', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  const given = new Date('2026-09-25T09:50:00Z');
  const base = { status: 'open', assignedUserId: 'a', assignedAt: given, readAt: null, handoffAt: null, handoffMode: 'auto', assignHops: 0 };
  const R = { unreadMins: 5, unrepliedMins: 8, maxHops: 3 };

  it('passes it on when nobody opened it in time', () => {
    expect(reassignDue(base, R, now)).toBe('reassign-unread');
  });

  it('passes it on when it was opened but nobody answered in time', () => {
    expect(reassignDue({ ...base, readAt: new Date('2026-09-25T09:51:00Z') }, R, now)).toBe('reassign-unreplied');
  });

  it('leaves it once somebody answered', () => {
    expect(reassignDue({ ...base, readAt: new Date('2026-09-25T09:51:00Z'), handoffAt: new Date('2026-09-25T09:52:00Z') }, R, now)).toBeNull();
  });

  it('waits until the time is up', () => {
    expect(reassignDue({ ...base, assignedAt: new Date('2026-09-25T09:57:00Z') }, R, now)).toBeNull();
  });

  it('never moves a conversation someone took over, a closed one, or one passed on enough', () => {
    expect(reassignDue({ ...base, handoffMode: 'locked' }, R, now)).toBeNull();
    expect(reassignDue({ ...base, status: 'done' }, R, now)).toBeNull();
    expect(reassignDue({ ...base, assignHops: 3 }, R, now)).toBeNull();
  });

  it('does nothing when the salon set no time (0 = never)', () => {
    expect(reassignDue(base, { unreadMins: 0, unrepliedMins: 0, maxHops: 3 }, now)).toBeNull();
  });
});
