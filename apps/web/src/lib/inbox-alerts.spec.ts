import { nextAlerts, emptyMemory, unreadCount, tabTitle, alertHeadline, AlertRow, AlertMemory } from './inbox-alerts';

const row = (over: Partial<AlertRow> = {}): AlertRow => ({
  id: 'a', updatedAt: '2026-08-27T12:00:00.000Z', lastMessageAt: '2026-08-27T12:00:00.000Z',
  senderName: 'Diana Huynh', lastText: 'giá bao nhiêu', unread: true, ...over,
});

/** Run one refresh and hand back both halves, the way the page does. */
const tick = (mem: AlertMemory, rows: AlertRow[], openId: string | null = null) =>
  nextAlerts(mem, rows, { openId });

describe('the first time the inbox loads', () => {
  it('MAKES NO NOISE, however many conversations are waiting', () => {
    // The failure that makes people switch the sound off on day one: logging
    // in and being shouted at about twenty conversations from yesterday.
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const { alerts, memory } = tick(emptyMemory(), rows);
    expect(alerts).toEqual([]);
    expect(memory.primed).toBe(true);
  });

  it('still remembers what it saw, so nothing arrives twice', () => {
    const rows = [row({ id: 'a' })];
    const first = tick(emptyMemory(), rows);
    const second = tick(first.memory, rows);
    expect(second.alerts).toEqual([]);
  });
});

describe('a customer writes', () => {
  it('alerts once', () => {
    const before = tick(emptyMemory(), [row({ id: 'a', lastMessageAt: '2026-08-27T12:00:00.000Z' })]);
    const after = tick(before.memory, [row({ id: 'a', lastMessageAt: '2026-08-27T12:05:00.000Z' })]);
    expect(after.alerts).toHaveLength(1);
    expect(after.alerts[0].name).toBe('Diana Huynh');
  });

  it('does not alert again on the next refresh', () => {
    const t0 = tick(emptyMemory(), [row({ lastMessageAt: '2026-08-27T12:00:00.000Z' })]);
    const t1 = tick(t0.memory, [row({ lastMessageAt: '2026-08-27T12:05:00.000Z' })]);
    const t2 = tick(t1.memory, [row({ lastMessageAt: '2026-08-27T12:05:00.000Z' })]);
    expect(t1.alerts).toHaveLength(1);
    expect(t2.alerts).toHaveLength(0);
  });

  it('alerts about a conversation that did not exist before', () => {
    const t0 = tick(emptyMemory(), [row({ id: 'a' })]);
    const t1 = tick(t0.memory, [row({ id: 'a' }), row({ id: 'b', senderName: 'Mai' })]);
    expect(t1.alerts.map((x) => x.id)).toEqual(['b']);
  });

  it('alerts about several at once when several wrote', () => {
    const t0 = tick(emptyMemory(), [row({ id: 'a' }), row({ id: 'b' })]);
    const t1 = tick(t0.memory, [
      row({ id: 'a', lastMessageAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'b', lastMessageAt: '2026-08-27T13:00:00.000Z' }),
    ]);
    expect(t1.alerts).toHaveLength(2);
  });
});

describe('when it must stay quiet', () => {
  it('says nothing about the conversation being read right now', () => {
    // The person is looking straight at it. A noise here is pure irritation.
    const t0 = tick(emptyMemory(), [row({ id: 'a' })]);
    const t1 = tick(t0.memory, [row({ id: 'a', lastMessageAt: '2026-08-27T12:05:00.000Z' })], 'a');
    expect(t1.alerts).toEqual([]);
  });

  it('still records the open conversation, so it never fires late', () => {
    // Silent must mean "handled", not "postponed". Otherwise closing the
    // conversation would set off an alarm about a message already read.
    const t0 = tick(emptyMemory(), [row({ id: 'a' })]);
    const t1 = tick(t0.memory, [row({ id: 'a', lastMessageAt: '2026-08-27T12:05:00.000Z' })], 'a');
    const t2 = tick(t1.memory, [row({ id: 'a', lastMessageAt: '2026-08-27T12:05:00.000Z' })], null);
    expect(t2.alerts).toEqual([]);
  });

  it('says nothing about a conversation that is already read', () => {
    // Our own reply moves the row's timestamp. It must not ring at the person
    // who just typed it.
    const t0 = tick(emptyMemory(), [row({ id: 'a' })]);
    const t1 = tick(t0.memory, [row({ id: 'a', lastMessageAt: '2026-08-27T12:05:00.000Z', unread: false })]);
    expect(t1.alerts).toEqual([]);
  });

  it('says nothing when a row is written without a new message', () => {
    // Putting a label on a conversation writes the row. It is not a message.
    const same = { id: 'a', lastMessageAt: '2026-08-27T12:00:00.000Z' };
    const t0 = tick(emptyMemory(), [row(same)]);
    const t1 = tick(t0.memory, [row({ ...same, updatedAt: '2026-08-27T12:09:00.000Z' })]);
    expect(t1.alerts).toEqual([]);
  });
});

describe('housekeeping', () => {
  it('forgets conversations that have left the list', () => {
    const t0 = tick(emptyMemory(), [row({ id: 'a' }), row({ id: 'b' })]);
    const t1 = tick(t0.memory, [row({ id: 'a' })]);
    expect(Object.keys(t1.memory.seen)).toEqual(['a']);
  });

  it('survives an empty list and rubbish rows', () => {
    expect(tick(emptyMemory(), []).alerts).toEqual([]);
    const t = tick({ seen: {}, primed: true }, [null as never, { id: '' } as never, row()]);
    expect(t.alerts).toHaveLength(1);
  });

  it('falls back to a polite name when Meta gave us none', () => {
    const t0 = tick(emptyMemory(), [row({ id: 'a', senderName: null })]);
    const t1 = tick(t0.memory, [row({ id: 'a', senderName: null, lastMessageAt: '2026-08-27T12:05:00.000Z' })]);
    expect(t1.alerts[0].name).toBe('Khách');
  });
});

describe('the red number and the tab', () => {
  it('counts the unread ones only', () => {
    expect(unreadCount([row({ unread: true }), row({ unread: false }), row({ unread: true })])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it('puts the count first, where a narrow tab still shows it', () => {
    expect(tabTitle('Lumio — Inbox', 3)).toBe('(3) Lumio — Inbox');
  });

  it('leaves the title alone when there is nothing waiting', () => {
    expect(tabTitle('Lumio — Inbox', 0)).toBe('Lumio — Inbox');
  });
});

describe('what the system notification says', () => {
  it('names one customer', () => {
    expect(alertHeadline([{ id: 'a', name: 'Diana Huynh', text: 'hi', pageName: null }], true))
      .toBe('Diana Huynh vừa nhắn tin');
  });

  it('counts several rather than listing them', () => {
    const many = [1, 2, 3].map((n) => ({ id: String(n), name: `K${n}`, text: '', pageName: null }));
    expect(alertHeadline(many, true)).toBe('3 khách vừa nhắn tin');
  });

  it('is empty when there is nothing to say', () => {
    expect(alertHeadline([], true)).toBe('');
  });
});
