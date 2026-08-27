import {
  ownershipOf, handoffModeOf, waitingMinutes, replyWindow, DEFAULT_ACTIVE_MINS,
} from './thread-ownership';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('pressing "Take over" means taking over', () => {
  // The bug this whole file exists for. A locked thread has no timer: the bot
  // cannot decide on its own that the person has had long enough.
  const locked = { handoff: true, handoffMode: 'locked', handoffAt: minsAgo(1) };

  it('gives the human the floor', () => {
    const v = ownershipOf(locked, { now: NOW });
    expect(v.state).toBe('human');
    expect(v.botMaySpeak).toBe(false);
    expect(v.reason).toBe('human-holding');
  });

  it.each([16, 60, 60 * 24, 60 * 24 * 30])('still holds after %i minutes of silence', (mins) => {
    const v = ownershipOf({ ...locked, handoffAt: minsAgo(mins) }, { now: NOW });
    expect(v.state).toBe('human');
    expect(v.botMaySpeak).toBe(false);
  });

  it('holds even with no timestamp at all', () => {
    expect(ownershipOf({ handoff: true, handoffMode: 'locked' }, { now: NOW }).botMaySpeak).toBe(false);
  });
});

describe('a GUESSED human still expires — that part was right', () => {
  // Someone typed in the Meta inbox. They may have answered once and left, so
  // the bot takes the thread back rather than leaving the customer unanswered.
  const guessed = (mins: number) => ({ handoff: true, handoffMode: 'auto', handoffAt: minsAgo(mins) });

  it('holds while they are recently active', () => {
    const v = ownershipOf(guessed(5), { now: NOW });
    expect(v.state).toBe('human');
    expect(v.reason).toBe('human-recently-active');
  });

  it('holds right up to the boundary', () => {
    expect(ownershipOf(guessed(DEFAULT_ACTIVE_MINS - 1), { now: NOW }).state).toBe('human');
  });

  it('hands back once they go quiet', () => {
    const v = ownershipOf(guessed(DEFAULT_ACTIVE_MINS + 1), { now: NOW });
    expect(v.state).toBe('bot');
    expect(v.botMaySpeak).toBe(true);
    expect(v.reason).toBe('human-went-quiet');
  });

  it('respects a salon that set its own window', () => {
    expect(ownershipOf(guessed(20), { now: NOW, activeMins: 30 }).state).toBe('human');
    expect(ownershipOf(guessed(20), { now: NOW, activeMins: 10 }).state).toBe('bot');
  });

  // Not knowing WHEN is not the same as knowing they left. Yielding too long
  // costs minutes; talking over a colleague mid-sentence cannot be undone.
  it('does not claim they left when there is no timestamp', () => {
    expect(ownershipOf({ handoff: true, handoffMode: 'auto' }, { now: NOW }).botMaySpeak).toBe(false);
  });

  it.each([null, undefined, '', 'LOCKED_BUT_TYPO', 'permanent', 0, false])(
    'treats an unrecognised mode (%s) as the expiring kind, never as a permanent lock',
    (mode) => {
      expect(handoffModeOf(mode)).toBe('auto');
    },
  );

  it('recognises the two real modes however they are cased', () => {
    expect(handoffModeOf('locked')).toBe('locked');
    expect(handoffModeOf(' Locked ')).toBe('locked');
    expect(handoffModeOf('auto')).toBe('auto');
  });
});

describe('"unclaimed" — the state that did not exist', () => {
  // Routed to someone who has not opened it. The old badge called this "human
  // handling" and showed it for threads whose last human message was nine
  // hours old, which is how three conversations sat unanswered overnight.
  const routed = { assignedUserId: 'staff-ha', lastCustomerAt: minsAgo(6) };

  it('is not the same as a human handling it', () => {
    const v = ownershipOf(routed, { now: NOW });
    expect(v.state).toBe('unclaimed');
    expect(v.reason).toBe('waiting-for-assignee');
  });

  it('keeps the bot quiet — the thread belongs to a person', () => {
    expect(ownershipOf(routed, { now: NOW }).botMaySpeak).toBe(false);
  });

  it('names who owes the answer', () => {
    expect(ownershipOf(routed, { now: NOW }).assignedUserId).toBe('staff-ha');
  });

  it('becomes human once that person actually replies', () => {
    const v = ownershipOf({ ...routed, handoff: true, handoffMode: 'locked' }, { now: NOW });
    expect(v.state).toBe('human');
    expect(v.assignedUserId).toBe('staff-ha');
  });
});

describe('nobody involved, and closed', () => {
  it('is the bot when no human has touched it', () => {
    const v = ownershipOf({ handoff: false }, { now: NOW });
    expect(v.state).toBe('bot');
    expect(v.botMaySpeak).toBe(true);
  });

  it('is the bot for a thread that does not exist yet', () => {
    expect(ownershipOf(null).state).toBe('bot');
    expect(ownershipOf(undefined).botMaySpeak).toBe(true);
  });

  it('says done, and the bot does not reopen it by talking', () => {
    const v = ownershipOf({ status: 'done', handoff: false }, { now: NOW });
    expect(v.state).toBe('done');
    expect(v.botMaySpeak).toBe(false);
  });

  it('done outranks everything else on the row', () => {
    expect(ownershipOf({ status: 'DONE', handoff: true, handoffMode: 'locked' }, { now: NOW }).state).toBe('done');
  });
});

describe('how long the customer has been waiting', () => {
  it('counts from their last message', () => {
    expect(waitingMinutes({ assignedUserId: 'x', lastCustomerAt: minsAgo(7) }, NOW)).toBe(7);
  });

  // A number next to a bot-handled thread reads as a problem when the bot has
  // already answered.
  it('says nothing when the bot has it', () => {
    expect(waitingMinutes({ handoff: false, lastCustomerAt: minsAgo(90) }, NOW)).toBeNull();
  });

  it('says nothing when the thread is closed', () => {
    expect(waitingMinutes({ status: 'done', lastCustomerAt: minsAgo(90) }, NOW)).toBeNull();
  });

  it('never shows a negative wait from a clock that ran ahead', () => {
    expect(waitingMinutes({ assignedUserId: 'x', lastCustomerAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(0);
  });

  it('says nothing when we never heard from them', () => {
    expect(waitingMinutes({ assignedUserId: 'x' }, NOW)).toBeNull();
  });
});

describe('Meta closes the door 24 hours after the customer last wrote', () => {
  // The composer has to say this BEFORE someone types a long answer. Finding
  // out after pressing send is how a reply is lost and the customer hears
  // nothing at all.
  it('is open shortly after they wrote', () => {
    const w = replyWindow({ lastCustomerAt: hoursAgo(1) }, NOW);
    expect(w.open).toBe(true);
    expect(w.minutesLeft).toBe(23 * 60);
  });

  it('is open with minutes to spare', () => {
    const w = replyWindow({ lastCustomerAt: hoursAgo(23.5) }, NOW);
    expect(w.open).toBe(true);
    expect(w.minutesLeft).toBe(30);
  });

  it('is shut a minute after the deadline', () => {
    const w = replyWindow({ lastCustomerAt: new Date(NOW.getTime() - 24 * 3_600_000 - 60_000) }, NOW);
    expect(w.open).toBe(false);
    expect(w.minutesLeft).toBe(0);
  });

  // "We do not know" is NOT "it is shut". Returning shut here disabled the
  // message box on every conversation whose lastCustomerAt was never stamped —
  // including people who had written minutes earlier — and told them it had
  // been more than 24 hours. A value we do not have must never disable the main
  // action of a screen.
  it('does NOT claim the window is shut when we never stamped a time', () => {
    expect(replyWindow({}, NOW)).toEqual({ open: true, minutesLeft: null, unknown: true });
    expect(replyWindow(null, NOW).open).toBe(true);
    expect(replyWindow(null, NOW).unknown).toBe(true);
  });

  it('treats an unparseable timestamp as unknown, not as shut', () => {
    const w = replyWindow({ lastCustomerAt: 'not a date' as never }, NOW);
    expect(w.open).toBe(true);
    expect(w.unknown).toBe(true);
  });

  it('marks a real answer as known, so the UI can tell them apart', () => {
    expect(replyWindow({ lastCustomerAt: hoursAgo(1) }, NOW).unknown).toBe(false);
    expect(replyWindow({ lastCustomerAt: hoursAgo(30) }, NOW).unknown).toBe(false);
  });
});
