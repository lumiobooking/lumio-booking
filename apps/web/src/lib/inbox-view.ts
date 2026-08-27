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
  assignedUserId?: string | null;
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
 * The filters down the left edge.
 *
 * 'waiting' is first and is the one that earns the page: it is the list of
 * customers nobody has answered. Everything else is browsing.
 */
export type InboxFilter = 'waiting' | 'unread' | 'mine' | 'all';

export interface FilterState {
  filter?: InboxFilter;
  channel?: ChannelKind | 'any';
  query?: string;
  /** Whose "mine" this is — the user id, not a display name. Two members of
   *  staff can be called Mai; they cannot share an id. Null disables the filter
   *  rather than showing an empty list. */
  meId?: string | null;
}

/**
 * Counts for the rail badges.
 *
 * Deliberately counts WAITING conversations, not total ones. A badge showing
 * "48" next to Messenger tells nobody anything — every salon has hundreds of
 * old threads. A badge showing "3" next to a channel means three people are
 * sitting there unanswered, which is worth walking across the room for.
 */
export function waitingByChannel(rows: InboxRow[]): Record<ChannelKind | 'any', number> {
  const out: Record<ChannelKind | 'any', number> = { any: 0, messenger: 0, instagram: 0, zalo: 0 };
  for (const r of rows) {
    if (stateOf(r) !== 'unclaimed') continue;
    out.any += 1;
    out[channelOf(r.channel)] += 1;
  }
  return out;
}

/**
 * Apply the filters.
 *
 * Search looks at the customer's name AND the last message, because a
 * receptionist remembers one or the other and never knows which. Matching is
 * accent-insensitive: someone typing "hang" must find "Hằng", or the search box
 * is useless to the people it was built for.
 */
export function filterRows(rows: InboxRow[], f: FilterState): InboxRow[] {
  const fold = (s: unknown) => String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks, then the Vietnamese đ, which is a distinct letter
    // rather than a d with an accent and so survives NFD untouched.
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

  const q = fold(f.query).trim();
  const wantChannel = f.channel && f.channel !== 'any' ? f.channel : null;
  const filter = f.filter ?? 'waiting';

  return rows.filter((r) => {
    if (wantChannel && channelOf(r.channel) !== wantChannel) return false;

    const state = stateOf(r);
    if (filter === 'waiting' && state !== 'unclaimed') return false;
    if (filter === 'unread' && !r.unread) return false;
    // With no name to compare against, "mine" would silently show an empty
    // list. Showing everything is the honest failure.
    if (filter === 'mine' && f.meId && r.assignedUserId !== f.meId) return false;

    if (q && !(fold(r.senderName).includes(q) || fold(r.lastText).includes(q))) return false;
    return true;
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
