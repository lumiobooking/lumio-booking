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
  senderId?: string | null;
  senderName?: string | null;
  lastText?: string | null;
  channel?: string | null;
  state?: ThreadState;
  handoff?: boolean;
  assignedName?: string | null;
  assignedUserId?: string | null;
  /** Which connected Page or Instagram account this arrived on. */
  pageId?: string | null;
  pageName?: string | null;
  waitingMinutes?: number | null;
  unread?: boolean;
  updatedAt: string;
}

/** Unknown channels read as Messenger — the one every salon has. */
export function channelOf(raw: unknown): ChannelKind {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'instagram' || v === 'zalo' ? v : 'messenger';
}

/**
 * A single compact mark for the channel rail.
 *
 * Separate from channelLabel because the rail has 48px and the list row has a
 * pill: the same string cannot serve both without one of them looking wrong.
 * Still no flag emoji — Windows has no glyph for a regional-indicator pair and
 * Chrome there draws the raw letters.
 */
export function channelMark(raw: unknown): string {
  switch (channelOf(raw)) {
    case 'instagram': return '◎';
    case 'zalo': return '✆';
    default: return '✉';
  }
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

/**
 * What to call a customer whose name we do not have.
 *
 * Meta's profile lookup is permission-gated and often fails, so senderName is
 * null on plenty of conversations. Falling back to one generic word gave a list
 * of eight rows ALL called "Customer" — visually identical, impossible to tell
 * apart, and impossible to search. A list you cannot distinguish rows in is not
 * a list.
 *
 * The last few characters of the page-scoped id are stable, unique per person,
 * and mean nothing to anyone — which is exactly right for a placeholder: it
 * separates the rows without pretending to be a name.
 */
export function displayName(row: Pick<InboxRow, 'senderName' | 'senderId'> | null | undefined, vi: boolean): string {
  const n = String(row?.senderName ?? '').trim();
  if (n) return n;
  const id = String(row?.senderId ?? '').trim();
  const tail = id.slice(-6);
  const word = vi ? 'Khách' : 'Customer';
  return tail ? `${word} ${tail}` : word;
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

/** Newest first — see the note inside. */
export function sortRows(rows: InboxRow[]): InboxRow[] {
  // Newest first, full stop.
  //
  // An earlier version floated waiting customers to the top and sorted them by
  // how long they had been ignored. The reasoning was sound and the result was
  // not what an operator wants: a list that reorders itself under your hand is
  // hard to work down, and everybody already knows a chat inbox reads newest
  // first. The waiting count still has its own filter and its own badge, so
  // nothing is lost — it just no longer rearranges the list.
  return [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * One entry per connected Page or Instagram account.
 *
 * The rail used to list channel TYPES — "Messenger", "Instagram" — which is
 * useless to a salon running two Pages: both their inboxes collapse into one
 * button and there is no way to see only the one you are answering as. The
 * customer sees the Page's name, so the person replying should too.
 */
export interface InboxSource {
  key: string;
  label: string;
  channel: ChannelKind;
  waiting: number;
}

/** Stable key for "this Page, on this channel". One Page can carry both. */
export function sourceKey(row: Pick<InboxRow, 'pageId' | 'channel'> | null | undefined): string {
  return `${String(row?.pageId ?? '')}|${channelOf(row?.channel)}`;
}

export function sourcesFrom(rows: InboxRow[]): InboxSource[] {
  const map = new Map<string, InboxSource>();
  for (const r of rows) {
    const key = sourceKey(r);
    const channel = channelOf(r.channel);
    const cur = map.get(key);
    const waiting = stateOf(r) === 'unclaimed' ? 1 : 0;
    if (cur) {
      cur.waiting += waiting;
      // A row that knows the name wins over one that does not, so a single
      // un-named thread cannot leave the whole source labelled by its channel.
      if (!cur.label && r.pageName) cur.label = r.pageName;
    } else {
      map.set(key, { key, label: String(r.pageName ?? '').trim(), channel, waiting });
    }
  }
  // Named sources first and alphabetical, so the rail does not reshuffle every
  // time a conversation arrives.
  return [...map.values()]
    .map((s) => ({ ...s, label: s.label || channelLabel(s.channel).text.replace(/^\S+\s/, '') }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The state filters above the list.
 *
 * 'all' is first and is the default: the first thing you see is everything,
 * newest first, the way every other chat inbox in the world opens. 'waiting'
 * is one click away for when you want to sweep the ones nobody answered.
 */
export type InboxFilter = 'all' | 'waiting' | 'unread' | 'mine';

export interface FilterState {
  filter?: InboxFilter;
  /** A key from sourcesFrom(), or 'any'. Replaces the old channel-type filter:
   *  a salon with two Pages needs to see one Page at a time. */
  source?: string;
  query?: string;
  /** Whose "mine" this is — the user id, not a display name. Two members of
   *  staff can be called Mai; they cannot share an id. Null disables the filter
   *  rather than showing an empty list. */
  meId?: string | null;
}

/** How many customers are sitting unanswered, across every source. */
export function waitingCount(rows: InboxRow[]): number {
  return rows.reduce((n, r) => n + (stateOf(r) === 'unclaimed' ? 1 : 0), 0);
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
  const wantSource = f.source && f.source !== 'any' ? f.source : null;
  const filter = f.filter ?? 'all';

  return rows.filter((r) => {
    if (wantSource && sourceKey(r) !== wantSource) return false;

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
  win: { open: boolean; minutesLeft: number | null; unknown?: boolean } | null | undefined,
  vi: boolean,
): { blocked: boolean; text: string | null } {
  // Nothing known → say nothing and get out of the way. This used to return
  // blocked:true and disabled the message box on every conversation we had no
  // timestamp for, telling people it had been over 24 hours about someone who
  // had written minutes earlier.
  if (!win || win.unknown) return { blocked: false, text: null };

  if (!win.open) {
    // Warn loudly, but DO NOT disable the box.
    //
    // Our copy of "when they last wrote" can be wrong — backfilled, missed, or
    // never stamped — and Meta is the only party that actually knows. Blocking
    // on our guess makes a bad guess unrecoverable; warning on it and letting
    // the send happen means a wrong guess costs one error message instead of a
    // conversation nobody could reply to.
    return {
      blocked: false,
      text: vi
        ? 'Có thể đã quá 24 giờ kể từ tin cuối của khách — Meta có thể từ chối. Cứ thử gửi; nếu hỏng thì gọi hoặc nhắn SMS.'
        : 'It may be more than 24 hours since they wrote — Meta may refuse. Try anyway; if it fails, call or text them.',
    };
  }

  const left = win.minutesLeft ?? 0;
  // Under two hours is when it is worth interrupting someone about.
  if (left <= 120) {
    const h = Math.floor(left / 60);
    const m = left % 60;
    const when = h > 0 ? `${h}h${m ? ` ${m}\u2032` : ''}` : `${m}\u2032`;
    return {
      blocked: false,
      text: vi ? `Còn ${when} trước khi Meta đóng cửa sổ trả lời` : `${when} left before Meta closes the reply window`,
    };
  }
  return { blocked: false, text: null };
}
