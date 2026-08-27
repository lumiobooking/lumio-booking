/**
 * The decisions the inbox makes about a conversation, kept out of the page.
 *
 * WHY SEPARATE
 *
 * A .tsx file with JSX in it cannot be imported by a plain test, which is how
 * every "obviously right" rule in this project has shipped untested and been
 * wrong. The badge that said "human handling" about a nine-hour-old thread was
 * exactly that shape: a one-line ternary in a render function that nobody could
 * assert against.
 *
 * Everything here is a pure function of a row, so the wording, the ordering and
 * the composer's warning can all be pinned.
 */

export type ThreadState = 'bot' | 'unclaimed' | 'human' | 'done';
export type ChannelKind = 'messenger' | 'instagram' | 'zalo';

export interface InboxRow {
  id: string;
  senderName?: string | null;
  lastText?: string | null;
  channel?: string | null;
  state?: ThreadState;
  handoff?: boolean;
  assignedName?: string | null;
  waitingMinutes?: number | null;
  unread?: boolean;
  updatedAt: string;
}

/** Unknown channels read as Messenger — the one every salon has. */
export function channelOf(raw: unknown): ChannelKind {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'instagram' || v === 'zalo' ? v : 'messenger';
}

/** Two words and a mark that Windows can actually draw. No flag emoji: those
 *  are regional-indicator pairs with no glyph on Windows, and Chrome there
 *  renders them as raw letters — which is how a market column once read "us US". */
export function channelLabel(raw: unknown): { text: string; fg: string; bg: string; border: string } {
  switch (channelOf(raw)) {
    case 'instagram':
      return { text: '◎ Instagram', fg: '#f9a8d4', bg: 'rgba(219,39,119,0.16)', border: 'rgba(219,39,119,0.45)' };
    case 'zalo':
      return { text: '✆ Zalo', fg: '#7dd3fc', bg: 'rgba(14,165,233,0.16)', border: 'rgba(14,165,233,0.45)' };
    default:
      return { text: '✉ Messenger', fg: '#93c5fd', bg: 'rgba(59,130,246,0.16)', border: 'rgba(59,130,246,0.45)' };
  }
}

/** An older API build does not send `state`; fall back to the flag it does send. */
export function stateOf(row: Pick<InboxRow, 'state' | 'handoff'> | null | undefined): ThreadState {
  if (row?.state) return row.state;
  return row?.handoff ? 'human' : 'bot';
}

/**
 * What the badge says, in the salon's language.
 *
 * `unclaimed` carries the waiting time because that is the number that decides
 * whether someone should drop what they are doing. A state without it reads as
 * ordinary, and three conversations sat unanswered overnight behind exactly
 * that.
 */
export function stateLabel(row: InboxRow, vi: boolean): { text: string; tone: 'bot' | 'wait' | 'held' | 'done' } {
  const state = stateOf(row);
  if (state === 'done') return { text: vi ? 'Xong' : 'Done', tone: 'done' };
  if (state === 'human') {
    const who = row.assignedName;
    return {
      text: who ? (vi ? `${who} giữ` : `${who} holding`) : (vi ? 'Người thật giữ' : 'Human holding'),
      tone: 'held',
    };
  }
  if (state === 'unclaimed') {
    const base = vi ? 'Chưa ai nhận' : 'Nobody has this';
    const w = typeof row.waitingMinutes === 'number' ? row.waitingMinutes : null;
    return { text: w === null ? base : `${base} · ${w}′`, tone: 'wait' };
  }
  return { text: 'Bot', tone: 'bot' };
}

/**
 * Order for the list.
 *
 * Waiting customers first, longest wait at the top — the opposite of a plain
 * newest-first list, which buries the person who has been ignored longest under
 * everyone who just said hello. Then unread, then everything else by recency,
 * with closed conversations last.
 */
export function sortRows(rows: InboxRow[]): InboxRow[] {
  const rank = (r: InboxRow): number => {
    const s = stateOf(r);
    if (s === 'unclaimed') return 0;
    if (s === 'done') return 3;
    return r.unread ? 1 : 2;
  };
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      // Longest wait first. This is the whole point of the group.
      const wa = a.waitingMinutes ?? 0;
      const wb = b.waitingMinutes ?? 0;
      if (wa !== wb) return wb - wa;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

/**
 * What the composer is allowed to say about sending.
 *
 * Meta refuses a normal reply more than 24 hours after the customer last wrote.
 * Telling someone that AFTER they have typed a long answer is how a reply is
 * lost and the customer hears nothing, so the warning has to be on screen while
 * they are still typing.
 */
export function composerNotice(
  win: { open: boolean; minutesLeft: number | null } | null | undefined,
  vi: boolean,
): { blocked: boolean; text: string | null } {
  if (!win) return { blocked: false, text: null };
  if (!win.open) {
    return {
      blocked: true,
      text: vi
        ? 'Quá 24 giờ kể từ tin cuối của khách — Meta không cho gửi tin thường nữa. Gọi điện hoặc nhắn SMS cho khách.'
        : 'More than 24 hours since they last wrote — Meta will not deliver a normal reply. Call or text them instead.',
    };
  }
  const left = win.minutesLeft ?? 0;
  // Under two hours is when it is worth interrupting someone about.
  if (left <= 120) {
    const h = Math.floor(left / 60);
    const m = left % 60;
    const when = h > 0 ? `${h}h${m ? ` ${m}′` : ''}` : `${m}′`;
    return {
      blocked: false,
      text: vi ? `Còn ${when} trước khi Meta đóng cửa sổ trả lời` : `${when} left before Meta closes the reply window`,
    };
  }
  return { blocked: false, text: null };
}
