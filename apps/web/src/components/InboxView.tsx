'use client';

/**
 * The shared inbox: answer customers here instead of in the Meta app.
 *
 * WHY IT IS A SEPARATE PAGE FROM /salon/messenger
 *
 * Those are two different jobs done by two different people. Configuring the
 * bot — its facts, its voice, which Page it is connected to — is an owner's
 * task done once. Answering a customer is a receptionist's task done fifty
 * times a day. Putting the composer below eight settings panels means the
 * person who lives in it scrolls past the owner's controls every time, and can
 * change them by accident.
 *
 * WHAT THIS HAS THAT PANCAKE CANNOT
 *
 * The customer panel. A generic inbox shows you the words; it cannot tell you
 * this is her fourteenth visit, that she is booked for tomorrow at two, and
 * that Hà usually does her nails. Meta cannot either. That is the reason to
 * answer here rather than there — and it only appears when the link is certain
 * (stamped when a booking was made from this conversation), because showing one
 * customer another customer's history is worse than showing none.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { fmtInTz } from '../lib/datetime';
import { useAuth } from '../lib/auth';
import { apiFetch, apiStream, apiImage } from '../lib/api';
import { wallToInstantISO, instantToWall, dayKeyInTz } from '../lib/datetime';
import { ui } from '../lib/ui';
import { useLang } from '../lib/i18n';
import { uiLocale } from '../lib/datetime';
import {
  InboxRow, InboxFilter, channelLabel, channelMark, stateLabel, stateOf,
  sortRows, filterRows, sourcesFrom, waitingCount, composerNotice, displayName, pageColor, initialsOf,
  InboxLabel, followUpState, followUpLabel, followUpCount, channelCounts, channelOf, humanAgentNotice,
  windowNotice, type WindowInfo,
} from '../lib/inbox-view';

interface Turn { role: 'user' | 'assistant'; content: string; at: string | null; manual: boolean; /** Photos the customer attached. */ images?: string[] }
interface ApptCtx {
  id: string;
  startTime: string;
  status?: string | null;
  service?: { name?: string | null } | null;
  assignedStaff?: { firstName?: string | null } | null;
}
interface CustomerCtx {
  firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null;
  visits?: number; nextAt?: string | null; usualTech?: string | null;
  /** The last five appointments, newest first — service, technician, status.
   *  The server has always sent these; the panel used to reduce them to three
   *  numbers and throw the rest away, then leave half a column empty. */
  appointments?: ApptCtx[] | null;
}
interface ThreadDetail extends InboxRow {
  history: Turn[];
  /** 'meta' = full transcript · 'local' = Meta refused, 12-turn buffer only ·
   *  'partial' = the fast first paint, full answer still on its way. */
  historySource?: 'partial' | 'meta' | 'local';
  customer: CustomerCtx | null;
  replyWindow?: { open: boolean; minutesLeft: number | null };
  /** Which of Meta's three windows this conversation is in. See api human-agent.ts. */
  humanAgent?: { kind: 'open' | 'human-agent' | 'closed' | 'unknown'; hoursLeft: number | null };
  /** The four states of Meta's reply window, decided by the server and
   *  enforced by the same function on the send route. See api human-agent.ts. */
  window?: WindowInfo;
  /** Taken from the facts the salon already wrote for the bot — one source, two
   *  readers, so a receptionist can never quote a different price than the bot. */
  canned?: { label: string; text: string }[];
  /** Which Page this arrived on. A salon with two Pages needs to know which one
   *  it is about to answer as — the customer sees the Page's name, not theirs. */
  pageName?: string | null;
  /** Internal notes. Never sent to the customer — different table, different
   *  endpoint, different colour. Three walls, because this is the one mistake
   *  in an inbox nobody can take back. */
  notes?: { id: string; text: string; authorName: string; createdAt: string }[];
}

/** The badge colours for a follow-up. Overdue is the only red on this screen —
 *  a colour that means everything means nothing. */
const FOLLOWUP_TONE: Record<string, { bg: string; fg: string }> = {
  overdue: { bg: 'var(--c7f1d1d)', fg: 'var(--cfecaca)' },
  today: { bg: 'var(--c78350f)', fg: 'var(--cfde68a)' },
  upcoming: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)' },
};

/** Colours offered when making a label. Six is enough to tell stages apart and
 *  few enough that nobody spends a morning in a colour picker. */
const LABEL_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

/**
 * The four sentences a front desk types all day.
 *
 * Deliberately not salon-specific: prices, hours and address come from the
 * salon's own facts (see ThreadDetail.canned) and must have exactly one
 * source. These are the mechanics of turning a conversation into a booking —
 * a name, a number, a time, a thank-you — and they are the same in every
 * salon. Written the way a Vietnamese-owned shop in the US actually speaks to
 * a customer, not translated from a template.
 */
/**
 * Is this the salon's own dashboard, or the staff portal?
 *
 * The same inbox serves both, and /salon/bookings exists only in one of them.
 * A button that 404s for a technician is worse than a button they never had.
 */
function inSalonPortal(): boolean {
  try { return window.location.pathname.startsWith('/salon'); } catch { return false; }
}

const ASKS: { k: string; icon: string; viLabel: string; enLabel: string; vi: string; en: string }[] = [
  {
    k: 'name', icon: '👤', viLabel: 'Xin tên', enLabel: 'Ask name',
    vi: 'Dạ cho em xin tên của mình để em ghi lịch nhé ạ.',
    en: 'Could I get your name for the appointment?',
  },
  {
    k: 'phone', icon: '☎', viLabel: 'Xin số', enLabel: 'Ask phone',
    vi: 'Mình cho em xin số điện thoại để em giữ chỗ và nhắn nhắc trước giờ hẹn nha.',
    en: 'What is the best number to reach you? We will text a reminder before your appointment.',
  },
  {
    k: 'when', icon: '🕐', viLabel: 'Hỏi giờ', enLabel: 'Ask time',
    vi: 'Mình muốn ghé ngày nào và khoảng mấy giờ ạ? Để em xem chỗ trống cho mình.',
    en: 'What day and roughly what time works for you? Let me check what is open.',
  },
  {
    k: 'thanks', icon: '🙏', viLabel: 'Cảm ơn', enLabel: 'Thanks',
    vi: 'Dạ em cảm ơn mình nhiều ạ. Hẹn gặp mình nha!',
    en: 'Thank you so much — see you then!',
  },
];

/** <input type="datetime-local"> wants SALON wall-clock, not an ISO Z string. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return instantToWall(iso);
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)',
  borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
};

const TONE: Record<string, { bg: string; fg: string }> = {
  bot: { bg: 'var(--c312e81)', fg: 'var(--cc7d2fe)' },
  wait: { bg: 'var(--c78350f)', fg: 'var(--cfcd34d)' },
  held: { bg: 'var(--c064e3b)', fg: 'var(--c6ee7b7)' },
  done: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)' },
};

/**
 * The unified inbox, with no shell around it.
 *
 * Lives in components/ rather than in one route because two very different
 * people open the same screen: the owner from the salon dashboard, and a
 * technician from the staff portal. Copying it would have been quicker today
 * and would have guaranteed that within a month the technicians were looking at
 * a version missing whatever was added last — which, for the screen customers
 * are answered on, is not a cosmetic difference.
 */
export function InboxView() {
  const { token } = useAuth();
  const { lang } = useLang();
  const me = useAuth().user?.id ?? null;
  const vi = lang === 'vi';
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Has the conversation list come back from the server even once?
   *
   * Before this flag, an empty `rows` meant two completely different things and
   * the screen said the alarming one out loud: opening the inbox showed "No
   * channel connected — open Channels to connect a Page" and "No conversations
   * yet" for the second or two before the first response landed, on a salon
   * whose Page was connected and whose inbox was full. A warning that cries
   * wolf on every single page load is a warning nobody reads on the day it is
   * true.
   */
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [source, setSource] = useState<string>('any');
  /** Shows '✓ Đã chép' for a moment, so the press has an answer. */
  const [copied, setCopied] = useState(false);
  /** Which KIND of channel, as opposed to which account. See FilterState.channel. */
  const [chan, setChan] = useState<string>('any');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [labels, setLabels] = useState<InboxLabel[]>([]);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]);
  const [showLabelForm, setShowLabelForm] = useState(false);
  /** Phone-sized screen. Staff answer customers standing up, on a phone, far
   *  more often than at a desk — four columns on a 390px screen is four
   *  columns nobody can read. */
  const [narrow, setNarrow] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** On a phone the inbox owns everything below the shell header. Measured,
   *  not guessed: the salon shell and the staff shell put different chrome
   *  above this component, and a hardcoded offset would be wrong in one of
   *  them forever. 100dvh (not vh) tracks the mobile browser bar as it hides. */
  const [cardH, setCardH] = useState<string | null>(null);

  useEffect(() => {
    // matchMedia rather than a resize listener: it fires on rotation and on a
    // window being dragged between monitors, and it does not run on every pixel.
    const mq = window.matchMedia('(max-width: 860px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const loadList = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<InboxRow[]>('/messenger/threads', { token });
      setRows(Array.isArray(r) ? r : []);
      setListErr(null);
      setLoaded(true);
    } catch (e) {
      // A failed refresh must not blank the list someone is reading — but it
      // must SAY SO. This used to swallow the error entirely, and the screen
      // then showed "no conversations match these filters", which is a
      // different sentence with a different meaning: it says the inbox is fine
      // and empty. An inbox that reports "empty" when it actually means
      // "I could not ask" is the worst failure this screen has, because
      // nobody goes looking for messages they have been told do not exist.
      setListErr(String(e));
      setLoaded(true);
    }
  }, [token]);

  const loadThread = useCallback(async (id: string, markRead = true) => {
    if (!token) return;
    // Being called IS the declaration that this conversation is now open.
    // Waiting for React to re-render and refresh the ref instead leaves a gap:
    // an answer served from the 15-second cache arrives before that render,
    // finds the ref still holding the previous id, and gets discarded.
    openRef.current = id;
    try {
      // Two asks. The first never touches Meta and answers in one database
      // hop — the conversation paints at the speed of a click. The second
      // brings the full Meta transcript and the name backfill; by the time a
      // person has read the first two bubbles it has quietly replaced the rest.
      //
      // The gate for BOTH is "is this still the conversation on screen?" —
      // checked against openRef, the id of the row the person clicked last.
      // The first version of this guard compared against the PREVIOUS detail
      // instead, which reads as sensible and is exactly backwards: with A on
      // screen, B's answer arrived, "B ≠ A" → keep A — every click after the
      // first was silently discarded, the bug reported as "nhấn vào tin khác
      // không được".
      const quick = await apiFetch<ThreadDetail>(`/messenger/threads/${id}?full=0`, { token });
      if (openRef.current === id) setDetail(quick);
      // Reading is a person's act, not the page's.
      //
      // The inbox opens the top conversation by itself so three columns are not
      // blank — but spending its unread mark for it would be the page claiming
      // somebody looked. `markRead: false` on that one path keeps the blue mark
      // until a human clicks the row.
      if (markRead) void apiFetch(`/messenger/threads/${id}/read`, { method: 'POST', token }).catch(() => undefined);
      const fullD = await apiFetch<ThreadDetail>(`/messenger/threads/${id}`, { token });
      if (openRef.current === id) setDetail(fullD);
    } catch (e) { setErr(String(e)); }
  }, [token]);

  const loadLabels = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<InboxLabel[]>('/messenger/labels', { token });
      setLabels(Array.isArray(r) ? r : []);
    } catch { /* the inbox works without labels; it must not fail to draw */ }
  }, [token]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadLabels(); }, [loadLabels]);

  // Live, not polled. Meta delivers a webhook to the server the moment a
  // customer writes; the server pushes a nudge down this stream and the page
  // refetches immediately. The eight-second poll this replaces meant a
  // receptionist could sit looking at a screen that already knew nothing new.
  //
  // The stream carries no message content — see the comment on the endpoint.
  const openRef = useRef<string | null>(null);
  /** A conversation the person put BACK on the unread pile while it is open.
   *  Held in a ref, not state: the poll closure reads it, and re-creating that
   *  closure on every change would tear down the event stream. */
  const keepUnreadRef = useRef<string | null>(null);
  openRef.current = openId;

  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let gone = false;

    const refresh = () => {
      void loadList();
      // A poll is not a person. Refreshing the open thread re-reads it only
      // when the person has not deliberately parked it as unread — otherwise
      // the next tick would quietly undo the press.
      if (openRef.current) void loadThread(openRef.current, keepUnreadRef.current !== openRef.current);
    };

    const connect = () => {
      if (gone) return;
      stop = apiStream('/messenger/stream', token, refresh, () => {
        // Dropped — a proxy timeout, a laptop lid, a deploy. Reconnect after a
        // pause rather than hammering, and keep the slow safety poll running in
        // the meantime so the page is never fully frozen.
        if (gone) return;
        retry = setTimeout(connect, 5000);
      });
    };
    connect();

    // Safety net. A stream that dies quietly is worse than no stream, because
    // the page LOOKS live while being frozen. Half a minute is slow enough not
    // to matter when the stream works and fast enough to notice when it does not.
    const poll = setInterval(refresh, 30_000);

    return () => {
      gone = true;
      stop?.();
      if (retry) clearTimeout(retry);
      clearInterval(poll);
    };
  }, [token, loadList, loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [detail?.history?.length]);

  // The inbox is floor-to-ceiling, on every screen.
  //
  // It used to be measured on the phone only; on a desktop the card had no
  // height at all and the panes inside were capped at 58vh / 46vh / 78vh. On a
  // 1080p screen that produced a ~560px card floating in 340px of empty dark —
  // the single loudest thing wrong with this screen. Measuring the card's own
  // top is what makes a fixed height safe: whatever the shell puts above it
  // (support banner, heading, an error) is already subtracted, so the bottom
  // edge lands on the bottom of the window instead of somewhere past it.
  useEffect(() => {
    const measure = () => {
      if (narrow) window.scrollTo(0, 0);
      const top = cardRef.current?.getBoundingClientRect().top ?? 0;
      const gap = narrow ? 8 : 16;
      setCardH(`calc(100dvh - ${Math.max(0, Math.round(top))}px - ${gap}px)`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // `err` is in here because the error banner renders ABOVE the card: showing
    // or clearing one moves the card's top, and a height measured against the
    // old top is a card that overshoots the window by the height of a banner.
  }, [narrow, openId, showInfo, err]);


  async function act(path: string, body?: Record<string, unknown>) {
    if (!openId || !token) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/messenger/threads/${openId}/${path}`, { method: 'POST', token, body });
      await Promise.all([loadList(), loadThread(openId)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function renameThread() {
    if (!detail || !token) return;
    const next = window.prompt(vi ? 'Tên khách hàng' : 'Customer name', detail.senderName ?? '');
    if (next === null) return;
    setBusy(true);
    try {
      await apiFetch(`/messenger/threads/${detail.id}/rename`, { method: 'POST', token, body: { name: next.trim() } });
      await Promise.all([loadList(), loadThread(detail.id)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function addNote() {
    const text = note.trim();
    if (!text || !detail || !token) return;
    setBusy(true);
    try {
      await apiFetch(`/messenger/threads/${detail.id}/notes`, { method: 'POST', token, body: { text } });
      setNote('');
      await loadThread(detail.id);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function createLabel() {
    const name = newLabel.trim();
    if (!name || !token) return;
    setBusy(true);
    try {
      const r = await apiFetch<InboxLabel[]>('/messenger/labels', { method: 'POST', token, body: { name, color: newColor } });
      setLabels(Array.isArray(r) ? r : []);
      setNewLabel('');
      setShowLabelForm(false);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function toggleLabel(id: string, on: boolean) {
    if (!detail || !token) return;
    setBusy(true);
    try {
      await apiFetch(`/messenger/threads/${detail.id}/labels`, { method: 'POST', token, body: { labelId: id, on } });
      await Promise.all([loadList(), loadThread(detail.id)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  /** An empty value clears the follow-up. The service treats an unparseable
   *  date as a clear too, so there is no way to store one that never comes due. */
  async function setFollowUp(local: string) {
    if (!detail || !token) return;
    setBusy(true);
    try {
      const at = local ? wallToInstantISO(local) : null; // "10:00" means 10:00 at the salon
      await apiFetch(`/messenger/threads/${detail.id}/followup`, { method: 'POST', token, body: { at, note: detail.followUpNote ?? null } });
      await Promise.all([loadList(), loadThread(detail.id)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !detail || !token) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/messenger/send', { method: 'POST', token, body: { threadId: detail.id, text } });
      setDraft('');
      await Promise.all([loadList(), loadThread(detail.id)]);
    } catch (e) {
      setErr(String(e));
      // The server refused. Whatever it knows about the window, the screen
      // should now be showing — a locked box the staff can see beats an error
      // string they have to read twice.
      await loadThread(detail.id, false).catch(() => undefined);
    } finally { setBusy(false); }
  }

  const sources = sourcesFrom(rows);
  // Whether the Page chip on each row is worth its width.
  //
  // Counting SOURCES answers a different question: one Facebook Page plus the
  // Instagram account linked to it is TWO sources carrying ONE name, so a salon
  // with a single Page still got "Lumio Booking" stamped on every row — the
  // same eleven characters repeated down the list, pushing the customer's own
  // labels onto a second line. Distinct names is the question that matters.
  const showPageChip = new Set(rows.map((r) => String(r.pageName ?? '').trim()).filter(Boolean)).size > 1;
  const sorted = sortRows(filterRows(rows, { filter, source, channel: chan, query, meId: me, labelId }));
  const unreadCount = rows.filter((r) => r.unread).length;

  /** Clear every unread mark in the shop, then repaint from the server. */
  async function markAllRead() {
    if (!token) return;
    setBusy(true);
    try {
      await apiFetch('/messenger/threads/read-all', { method: 'POST', token });
      await loadList();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  /**
   * Put this conversation back on the pile.
   *
   * Stays on screen — the row simply turns blue again. What makes that hold is
   * keepUnreadRef: without it the 30-second poll re-reads the open thread and
   * undoes the press, which is the kind of button that makes people stop
   * trusting the screen.
   */
  async function markUnread(id: string) {
    if (!token) return;
    setBusy(true);
    keepUnreadRef.current = id;
    try {
      await apiFetch(`/messenger/threads/${id}/unread`, { method: 'POST', token });
      await loadList();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  const firstId = sorted[0]?.id ?? null;

  // Open the top conversation by itself.
  //
  // Three columns of "pick a conversation" while three conversations sit in
  // the list is an empty screen the person has to click to fill. Every inbox
  // worth copying opens on a thread. Only on a desktop: on a phone the list
  // IS the screen, and auto-opening would hide it behind a chat nobody asked
  // for. Re-fires whenever nothing is open, so changing a filter lands on the
  // first row of the new filter rather than on nothing.
  useEffect(() => {
    if (narrow || openId || !firstId) return;
    setOpenId(firstId);
    void loadThread(firstId, false);
    // Not `sorted` — it is rebuilt on every render, which would re-run this
    // effect on every render to do nothing. The id is the only part that matters.
  }, [narrow, openId, firstId, loadThread]);
  const chans = channelCounts(rows);
  const waiting = waitingCount(rows);
  const dueCount = followUpCount(rows);
  /**
   * The name and number as one line, on the clipboard.
   *
   * Reading a phone number off one panel and typing it into another is where
   * a digit gets lost, and a booking with one wrong digit is a no-show nobody
   * can explain afterwards.
   */
  async function copyContact(d: ThreadDetail | null) {
    if (!d) return;
    const name = [d.customer?.firstName, d.customer?.lastName].filter(Boolean).join(' ').trim() || displayName(d, vi);
    const line = [name, d.customer?.phone].filter(Boolean).join(' · ');
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard refused (an insecure origin, or the browser said no). Saying
      // nothing would look like a dead button.
      window.prompt(vi ? 'Chép dòng này:' : 'Copy this:', line);
    }
  }

  /**
   * Open the booking screen for this customer.
   *
   * The clipboard is loaded first and the query string carries the same two
   * facts: whichever the booking screen is ready to read, the person has them.
   * A new tab rather than a navigation — losing a half-typed reply to open a
   * booking form is not a trade anybody would make on purpose.
   */
  async function bookFor(d: ThreadDetail | null) {
    if (!d) return;
    await copyContact(d);
    const name = [d.customer?.firstName, d.customer?.lastName].filter(Boolean).join(' ').trim() || displayName(d, vi);
    const q = new URLSearchParams();
    if (name) q.set('name', name);
    if (d.customer?.phone) q.set('phone', String(d.customer.phone));
    window.open(`/salon/bookings${q.toString() ? `?${q.toString()}` : ''}`, '_blank', 'noopener');
  }

  // The human-agent state is the more precise answer when the server sent
  // one; the older notice stays as the fallback for rows it cannot judge.
  // The server's four-state window is the one the send route will actually
  // enforce, so it wins. The two older notices stay as the fallback for a
  // server that has not deployed yet — an inbox must never be blank because
  // one field is missing.
  const w4 = windowNotice(detail?.window, vi, detail ? displayName(detail, vi) : undefined);
  const wnotice = w4 ? { ...w4, kind: detail?.window?.kind } : null;
  const legacy = humanAgentNotice(detail?.humanAgent, vi) ?? composerNotice(detail?.replyWindow, vi);
  const notice: { blocked: boolean; text: string | null; tone?: 'amber' | 'red' | null } = wnotice
    ? { blocked: wnotice.blocked, text: wnotice.banner, tone: wnotice.tone }
    : legacy;
  const composerPlaceholder = wnotice
    ? wnotice.placeholder
    : notice.blocked
      ? (vi ? 'Khong gui duoc' : 'Cannot send')
      : (vi && detail ? `Nhan cho ${displayName(detail, vi)}...` : 'Message the customer...');
  const state = detail ? stateOf(detail) : 'bot';

  /**
   * Avatar with the channel mark tucked into its corner, coloured by PAGE.
   *
   * This is the piece that answers "which page is this from" at a glance. The
   * channel mark alone cannot: two Fanpages are both Messenger and draw the
   * same envelope. The colour separates them, and it is derived from the page
   * id so it never changes between refreshes or between two people looking at
   * the same inbox.
   */
  const Avatar = ({ row, size = 34 }: { row: InboxRow; size?: number }) => {
    const c = pageColor(row.pageId);
    const [pic, setPic] = useState<string | null>(null);

    useEffect(() => {
      if (!token) return;
      let gone = false;
      // The real Facebook picture, through our own endpoint so the Page token
      // stays on the server. Null is a normal answer — Meta withholds profiles
      // for a great many people — and then the initials stand.
      void apiImage(`/messenger/threads/${row.id}/avatar`, token).then((u) => { if (!gone) setPic(u); });
      return () => { gone = true; };
    }, [row.id]);

    return (
      <span style={{ position: 'relative', flexShrink: 0, width: size, height: size, display: 'inline-block' }}>
        {pic ? (
          <img
            src={pic}
            alt=""
            style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
            // If the blob ever fails to decode, fall back rather than showing a
            // broken-image icon in a list of customers.
            onError={() => setPic(null)}
          />
        ) : (
          <span style={{
            width: size, height: size, borderRadius: '50%', background: c.bg, color: c.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.round(size * 0.36), fontWeight: 700,
          }}>{initialsOf(displayName(row, vi))}</span>
        )}
        <span
          title={row.pageName ?? undefined}
          style={{
            position: 'absolute', right: -2, bottom: -2,
            width: Math.round(size * 0.46), height: Math.round(size * 0.46), borderRadius: '50%',
            // Ringed in the PAGE colour, so a real photograph still says which
            // Fanpage it came in on — the thing initials were carrying before.
            background: 'var(--c0b1220)', border: `2px solid ${c.bg}`,
            color: channelLabel(row.channel).fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.round(size * 0.28), lineHeight: 1,
          }}
        >{channelMark(row.channel)}</span>
      </span>
    );
  };

  const pill = (tone: string, text: string) => (
    <span style={{ background: TONE[tone].bg, color: TONE[tone].fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
  );

  return (
    <>
      {!narrow && (
        // The band above the inbox used to hold one word and a lot of dark.
        // It now carries what a person standing at the desk wants before they
        // read anything: how many are unanswered, how many unread, and WHICH
        // accounts this inbox is actually watching — the last one is the fact
        // that decides whether a silent inbox means "quiet day" or "the Page
        // fell off two weeks ago and nobody noticed".
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{vi ? 'Hộp thư' : 'Inbox'}</h1>
          {waiting > 0 && pill('wait', vi ? `${waiting} khách đang chờ` : `${waiting} waiting`)}
          {unreadCount > 0 && (
            <span style={{ background: 'var(--c172554)', color: 'var(--c93c5fd)', border: '1px solid #3b82f6', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              ● {unreadCount} {vi ? 'chưa đọc' : 'unread'}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            {!loaded ? (
              <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{vi ? 'Đang tải…' : 'Loading…'}</span>
            ) : sources.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--cfcd34d)' }}>
                {vi ? 'Chưa nối kênh nào — vào Kênh kết nối để nối Trang.' : 'No channel connected — open Channels to connect a Page.'}
              </span>
            ) : sources.map((src) => (
              <span key={src.key} title={src.label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 220,
                  background: pageColor(src.key.split('|')[0]).bg, color: pageColor(src.key.split('|')[0]).fg,
                  borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 600,
                }}>
                {channelMark(src.channel)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.label}</span>
                {src.waiting > 0 && (
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{src.waiting}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {err && <div style={{ ...ui.card, borderColor: 'var(--c7f1d1d)', color: 'var(--cfca5a5)', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div ref={cardRef} style={{ ...ui.card, padding: 0, overflow: 'hidden', display: 'grid',
        // Desktop: exactly as tall as the window allows, so every pane below
        // fills its column and scrolls inside itself.
        ...(narrow ? {} : { height: cardH ?? undefined }),
        // One column on a phone. The list and the conversation then take turns
        // filling the screen, the way every messaging app on a phone works.
        gridTemplateColumns: narrow ? '1fr' : '52px minmax(0,290px) minmax(0,1fr) minmax(0,270px)',
        // Full-bleed and exactly viewport-tall on the phone. The width trick
        // escapes whatever padding the shell wrapped us in without knowing it;
        // the fixed height pins the composer on screen and moves ALL scrolling
        // inside — a page that scrolls under a chat is two scrollbars fighting.
        ...(narrow ? {
          width: '100vw', marginLeft: 'calc(50% - 50vw)',
          border: 'none', borderRadius: 0,
          height: cardH ?? undefined,
          // Flex, not grid, on the phone. The grid version declared ONE
          // flexible row — which the browser handed to the first child, the
          // source strip, squashing it to a clipped sliver while the list
          // took leftovers. In a column of [strip, one visible pane], flex
          // says it directly: strip keeps its size, the pane gets the rest.
          display: 'flex', flexDirection: 'column' as const,
        } : {}) }}>
        {/* No fixed height on the card. It used to be 74vh, but the card's TOP
            already sits well down the page — support banner, heading, whatever
            else the shell puts above it — so 74vh from there ran off the bottom
            of the screen and took the composer with it. The message box was
            rendered and simply unreachable, which reads as "there is no way to
            reply". Capping the SCROLLING areas instead keeps every control that
            follows them on screen regardless of what is above. */}

        {/* Source rail: one entry per connected Page or Instagram account, by
            NAME. Listing channel types instead collapsed two Pages into one
            button, and a salon running two of them could not answer as just one.
            The customer sees the Page's name, so the person replying sees it too.
            Counts are people WAITING, not conversations that exist. */}
        <div style={{
          background: 'var(--c0b1220)', gap: 6, display: (narrow && openId) ? 'none' : 'flex',
          ...(narrow
            ? { flexDirection: 'row', padding: '10px 12px', borderBottom: '1px solid var(--c1e293b)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' as const, flexShrink: 0, minHeight: 54, alignItems: 'center' }
            : { flexDirection: 'column', padding: '10px 0', borderRight: '1px solid var(--c1e293b)', alignItems: 'center', minHeight: 0, overflowY: 'auto' as const }),
        }}>
          <button onClick={() => setSource('any')} title={vi ? 'Tất cả nguồn' : 'All sources'} aria-label={vi ? 'Tất cả nguồn' : 'All sources'}
            style={{
              position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
              background: source === 'any' ? 'var(--c312e81)' : 'transparent',
              border: `1px solid ${source === 'any' ? '#6366f1' : 'transparent'}`,
              color: source === 'any' ? 'var(--cc7d2fe)' : 'var(--c64748b)', fontSize: 16, lineHeight: 1,
            }}>
            ▤
            {waiting > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -5, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '0 4px', minWidth: 15 }}>{waiting}</span>
            )}
          </button>

          {sources.map((src) => {
            const on = source === src.key;
            return (
              <button key={src.key} onClick={() => setSource(src.key)} title={src.label} aria-label={src.label}
                style={{
                  position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
                  background: on ? 'var(--c312e81)' : 'transparent',
                  border: `1px solid ${on ? '#6366f1' : 'transparent'}`,
                  color: on ? 'var(--cc7d2fe)' : 'var(--c64748b)', fontSize: 16, lineHeight: 1,
                }}>
                <span style={{ position: 'absolute', left: 3, top: 7, bottom: 7, width: 3, borderRadius: 2, background: pageColor(src.key.split('|')[0]).bg }} />
                {channelMark(src.channel)}
                {src.waiting > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -5, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '0 4px', minWidth: 15 }}>{src.waiting}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Conversation list */}
        <div style={{
          borderRight: narrow ? 'none' : '1px solid var(--c1e293b)', flexDirection: 'column', minWidth: 0, minHeight: 0,
          // On a phone, picking a customer replaces the list with the chat.
          display: (narrow && openId) ? 'none' : 'flex',
          ...(narrow ? { flex: '1 1 0%' } : {}),
        }}>
          <div style={{ padding: '9px 10px', borderBottom: '1px solid var(--c1e293b)', display: 'flex', gap: 7, alignItems: 'center' }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={vi ? 'Tìm khách…' : 'Search…'}
              // 16px on the phone is not a taste choice: anything smaller and
              // iOS zooms the page the moment the field is tapped.
              style={{ ...ui.input, flex: 1, minWidth: 0, fontSize: narrow ? 16 : 12, padding: narrow ? '10px 13px' : '6px 9px', borderRadius: narrow ? 12 : 8 }} />
            {/* Clears the whole blue pile. Only offered when there IS one —
                a button that does nothing is a button people learn to ignore. */}
            {unreadCount > 0 && (
              <button onClick={() => void markAllRead()} disabled={busy}
                title={vi ? `Đánh dấu đã đọc tất cả (${unreadCount})` : `Mark all read (${unreadCount})`}
                aria-label={vi ? 'Đánh dấu đã đọc tất cả' : 'Mark all read'}
                style={{ ...ghostBtn, flexShrink: 0, padding: narrow ? '9px 11px' : '6px 9px', fontSize: narrow ? 14 : 13, lineHeight: 1 }}>
                ✓✓
              </button>
            )}
          </div>

          {/* Which channel.
              The rail on the left answers "which of my accounts"; this answers
              "which kind of place is this coming from". A salon that has just
              switched the website widget on wants to watch those without first
              learning which internal id it hides behind — and the number of
              people WAITING on each is the reason to look at all. Drawn only
              when more than one kind has ever been used. */}
          {chans.length > 1 && (
            <div style={{ display: 'flex', gap: narrow ? 8 : 5, padding: narrow ? '8px 12px' : '7px 8px', borderBottom: '1px solid var(--c1e293b)', alignItems: 'center',
              ...(narrow ? { flexWrap: 'nowrap' as const, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, scrollbarWidth: 'none' as const } : { flexWrap: 'wrap' as const }) }}>
              <button onClick={() => setChan('any')}
                style={{ ...ghostBtn, fontSize: narrow ? 13 : 11, padding: narrow ? '7px 12px' : '3px 9px', borderRadius: 999, flexShrink: 0, fontWeight: chan === 'any' ? 700 : 500,
                  borderColor: chan === 'any' ? '#6366f1' : 'var(--c334155)',
                  background: chan === 'any' ? 'var(--c312e81)' : 'transparent',
                  color: chan === 'any' ? 'var(--cc7d2fe)' : 'var(--c94a3b8)' }}>
                {vi ? 'Tất cả kênh' : 'All channels'} <span style={{ opacity: .7 }}>{rows.length}</span>
              </button>
              {chans.map((c) => {
                const look = channelLabel(c.key);
                const on = chan === c.key;
                return (
                  <button key={c.key} onClick={() => setChan(on ? 'any' : c.key)}
                    title={c.waiting > 0 ? (vi ? `${c.waiting} khách đang chờ` : `${c.waiting} waiting`) : undefined}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer',
                      borderRadius: 999, padding: narrow ? '7px 12px' : '3px 9px',
                      fontSize: narrow ? 13 : 11, fontWeight: on ? 700 : 500, fontFamily: 'inherit',
                      border: `1px solid ${on ? look.border : 'var(--c334155)'}`,
                      background: on ? look.bg : 'transparent',
                      color: on ? look.fg : 'var(--c94a3b8)',
                    }}>
                    {look.text}
                    <span style={{ opacity: .7 }}>{c.total}</span>
                    {/* Waiting is the only number that earns a colour here. */}
                    {c.waiting > 0 && (
                      <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{c.waiting}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: narrow ? 8 : 4, padding: narrow ? '8px 12px' : '7px 8px', borderBottom: '1px solid var(--c1e293b)',
            // One row that scrolls sideways. Wrapping onto a second line — the
            // desktop behaviour — costs a whole conversation of height on a
            // phone, and every chat app solved it the same way: swipe the chips.
            ...(narrow ? { flexWrap: 'nowrap' as const, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, scrollbarWidth: 'none' as const } : { flexWrap: 'wrap' as const }) }}>
            {([
              ['all', vi ? 'Tất cả' : 'All'],
              ['waiting', vi ? 'Đang chờ' : 'Waiting'],
              ['unread', vi ? 'Chưa đọc' : 'Unread'],
              ['mine', vi ? 'Của tôi' : 'Mine'],
              ['followup', vi ? 'Cần theo dõi' : 'Follow-up'],
            ] as [InboxFilter, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{ ...ghostBtn, fontSize: narrow ? 13.5 : 11, padding: narrow ? '8px 14px' : '2px 8px', borderRadius: 999, flexShrink: 0,
                  borderColor: filter === key ? '#6366f1' : 'var(--c334155)',
                  background: filter === key ? 'var(--c312e81)' : 'transparent',
                  color: filter === key ? 'var(--cc7d2fe)' : 'var(--c94a3b8)', fontWeight: filter === key ? 700 : 400 }}>
                {label}
                {/* The number is on this chip and nowhere else. A follow-up
                    nobody can see the count of is a diary left in a drawer. */}
                {key === 'followup' && dueCount > 0 && (
                  <span style={{ marginLeft: 5, background: '#ef4444', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{dueCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Label filter. Only drawn once the salon has made a label — an
              empty row of nothing is worse than no row. */}
          {labels.length > 0 && (
            <div style={{ display: 'flex', gap: narrow ? 8 : 4, padding: narrow ? '8px 12px' : '0 8px 7px', borderBottom: '1px solid var(--c1e293b)', alignItems: 'center',
              ...(narrow ? { flexWrap: 'nowrap' as const, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const } : { flexWrap: 'wrap' as const }) }}>
              <button onClick={() => setLabelId(null)}
                style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px',
                  borderColor: labelId === null ? '#6366f1' : 'var(--c334155)',
                  color: labelId === null ? 'var(--cc7d2fe)' : 'var(--c64748b)' }}>{vi ? 'Mọi nhãn' : 'Any label'}</button>
              {labels.map((l) => (
                <button key={l.id} onClick={() => setLabelId(labelId === l.id ? null : l.id)}
                  style={{
                    border: `1px solid ${labelId === l.id ? l.color : 'var(--c334155)'}`,
                    background: labelId === l.id ? l.color : 'transparent',
                    color: labelId === l.id ? '#fff' : 'var(--c94a3b8)',
                    borderRadius: 999, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                  }}>{l.name}</button>
              ))}
            </div>
          )}

          <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch',
            // The card is window-tall on both screens now, so the list simply
            // takes the room the search box and the filter chips left over.
            flex: '1 1 0%', minHeight: 0 }}>
            {listErr && (
              <div style={{ margin: 10, padding: '9px 11px', borderRadius: 8, background: 'var(--c450a0a)', border: '1px solid var(--c7f1d1d)' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--cfecaca)', fontWeight: 700 }}>
                  {vi ? 'Không tải được danh sách hội thoại' : 'Could not load conversations'}
                </p>
                <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--cfca5a5)', wordBreak: 'break-word' }}>{listErr}</p>
                <button onClick={() => void loadList()} style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px' }}>
                  {vi ? 'Thử lại' : 'Retry'}
                </button>
              </div>
            )}
            {!loaded && !listErr && (
              // Three grey rows in the shape of real ones. A person reads the
              // shape as "coming" and waits; a sentence saying the inbox is
              // empty reads as an answer and they act on it.
              <div aria-busy="true" aria-label={vi ? 'Đang tải hội thoại' : 'Loading conversations'}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, padding: narrow ? '13px 14px' : '9px 11px', borderBottom: '1px solid var(--c1e293b)', opacity: 1 - i * 0.25 }}>
                    <div style={{ width: narrow ? 48 : 34, height: narrow ? 48 : 34, borderRadius: '50%', background: 'var(--c1e293b)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 3 }}>
                      <div style={{ height: 9, width: '55%', borderRadius: 4, background: 'var(--c1e293b)' }} />
                      <div style={{ height: 8, width: '80%', borderRadius: 4, background: 'var(--c1e293b)' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {loaded && !sorted.length && !listErr && (
              <p style={{ color: 'var(--c64748b)', fontSize: 13, padding: 16, margin: 0 }}>
                {filter === 'waiting'
                  ? (vi ? 'Không ai đang chờ. Tốt.' : 'Nobody is waiting. Good.')
                  : rows.length === 0
                    ? (vi ? 'Chưa có hội thoại nào. Khi khách nhắn vào Page, hội thoại sẽ hiện ở đây.' : 'No conversations yet. They appear here when a customer writes to the Page.')
                    : (vi ? 'Không có hội thoại nào khớp bộ lọc.' : 'No conversations match these filters.')}
              </p>
            )}
            {sorted.map((r) => {
              const ch = channelLabel(r.channel);
              const st = stateLabel(r, vi);
              const on = r.id === openId;
              return (
                <button key={r.id} onClick={() => { keepUnreadRef.current = null; setOpenId(r.id); void loadThread(r.id); }}
                  // Unread has to be readable from across the room.
                  //
                  // It used to be a 7px dot and a slightly bolder name — on a
                  // dark list of dark rows, invisible. Three signals now carry
                  // it together, so no single one has to win on its own: a solid
                  // blue rail down the left edge, a lifted row background, and
                  // the text at full strength while read rows sit back.
                  style={{ width: '100%', textAlign: 'left', display: 'block', cursor: 'pointer',
                    background: on ? 'var(--c1e293b)' : r.unread ? 'var(--c172554)' : 'transparent',
                    border: 'none',
                    borderLeft: `3px solid ${on ? '#6366f1' : r.unread ? '#3b82f6' : 'transparent'}`,
                    borderBottom: '1px solid var(--c1e293b)', padding: narrow ? '13px 14px' : '9px 11px' }}>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <Avatar row={r} size={narrow ? 48 : 34} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ color: r.unread ? 'var(--cf8fafc)' : 'var(--c94a3b8)', fontSize: narrow ? 15.5 : 13, fontWeight: r.unread ? 800 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName(r, vi)}
                        </span>
                        <span title={fmtInTz(r.lastMessageAt || r.updatedAt, { dateStyle: 'full', timeStyle: 'short' })}
                          style={{ marginLeft: 'auto', fontSize: 11, color: r.unread ? 'var(--c93c5fd)' : 'var(--c64748b)', fontWeight: r.unread ? 700 : 400, flexShrink: 0 }}>
                          {listStampLabel(r.lastMessageAt || r.updatedAt, vi)}
                        </span>
                        {r.unread && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} aria-label={vi ? 'Chưa đọc' : 'Unread'} />}
                      </div>
                      <p style={{ margin: '0 0 5px', fontSize: narrow ? 13.5 : 12, color: r.unread ? 'var(--ce2e8f0)' : 'var(--c64748b)', fontWeight: r.unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastText || '—'}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        {pill(st.tone, st.text)}
                        {/* The Page, named and in its own colour — but only
                            when there are two of them to tell apart. A salon
                            with ONE Page got its own name stamped on every row
                            of the list, which says nothing and costs the width
                            that the customer's labels needed. */}
                        {source === 'any' && showPageChip && r.pageName && (
                          <span style={{
                            background: pageColor(r.pageId).bg, color: pageColor(r.pageId).fg,
                            borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600,
                            maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{r.pageName}</span>
                        )}
                        {/* Follow-up first, labels after: a date that has come
                            due is the only thing on this row that is asking
                            for something today. */}
                        {followUpState(r.followUpAt) !== 'none' && (
                          <span style={{
                            ...FOLLOWUP_TONE[followUpState(r.followUpAt)],
                            background: FOLLOWUP_TONE[followUpState(r.followUpAt)].bg,
                            color: FOLLOWUP_TONE[followUpState(r.followUpAt)].fg,
                            borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700,
                          }}>⏰ {followUpLabel(r.followUpAt, new Date())}</span>
                        )}
                        {(r.labels ?? []).slice(0, 3).map((l) => (
                          <span key={l.id} style={{
                            background: l.color, color: '#fff', borderRadius: 999,
                            padding: '1px 8px', fontSize: 10, fontWeight: 600,
                            maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{l.name}</span>
                        ))}
                        {(r.labels?.length ?? 0) > 3 && (
                          <span style={{ fontSize: 10, color: 'var(--c64748b)' }}>+{(r.labels?.length ?? 0) - 3}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* The three numbers a person opens an inbox to check.
              They used to live in the middle panel's empty state, which means
              they were visible exactly when there was nothing to look at and
              hidden the moment a conversation was open — backwards. Pinned to
              the foot of the list they are always on screen, and they fill the
              column below a short list instead of leaving it blank. */}
          {!narrow && rows.length > 0 && (
            <div style={{
              flexShrink: 0, borderTop: '1px solid var(--c1e293b)', background: 'var(--c0b1220)',
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            }}>
              {([
                { n: waiting, label: vi ? 'đang chờ' : 'waiting', tone: waiting > 0 ? '#fcd34d' : 'var(--c64748b)', f: 'waiting' as InboxFilter },
                { n: dueCount, label: vi ? 'cần theo dõi' : 'follow-up', tone: dueCount > 0 ? '#fdba74' : 'var(--c64748b)', f: 'followup' as InboxFilter },
                { n: rows.filter((r) => r.unread).length, label: vi ? 'chưa đọc' : 'unread', tone: rows.some((r) => r.unread) ? '#f87171' : 'var(--c64748b)', f: 'unread' as InboxFilter },
              ]).map((b) => (
                <button key={b.label} onClick={() => setFilter(b.f)}
                  title={vi ? 'Lọc theo mục này' : 'Filter by this'}
                  style={{
                    border: 'none', background: filter === b.f ? 'var(--c1e293b)' : 'transparent',
                    cursor: 'pointer', padding: '8px 4px', fontFamily: 'inherit', textAlign: 'center',
                  }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: b.tone, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>{b.n}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{b.label}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation */}
        <div style={{
          flexDirection: 'column', minWidth: 0, minHeight: 0,
          // On a phone this IS the screen once a customer is picked, and it is
          // hidden until then — never a half-width chat beside a half-width list.
          display: (narrow && (!openId || showInfo)) ? 'none' : 'flex',
          ...(narrow ? { flex: '1 1 0%' } : {}),
        }}>
          {/* Nothing picked yet.
              A sentence telling somebody to pick a conversation is a sentence
              they have already obeyed or ignored; either way the largest panel
              on the screen spends most of the day saying nothing. The same
              space can answer the question a person actually opens an inbox
              with — is anyone waiting, and for how long. */}
          {!detail && !loaded && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c64748b)', fontSize: 13 }}>
              {vi ? 'Đang tải hộp thư…' : 'Loading the inbox…'}
            </div>
          )}
          {!detail && loaded && (() => {
            const oldest = rows
              .filter((r) => stateOf(r) === 'unclaimed')
              .reduce((m, r) => Math.max(m, r.waitingMinutes ?? 0), 0);
            const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}p` : ''}` : `${n} ${vi ? 'phút' : 'min'}`);
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, minHeight: 0 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Box
                    n={waiting}
                    label={vi ? 'khách đang chờ' : 'waiting for a reply'}
                    tone={waiting > 0 ? 'alarm' : 'calm'}
                    sub={waiting > 0 ? (vi ? `lâu nhất ${mins(oldest)}` : `longest ${mins(oldest)}`) : (vi ? 'không ai phải đợi' : 'nobody is waiting')}
                  />
                  <Box
                    n={dueCount}
                    label={vi ? 'cần theo dõi hôm nay' : 'follow-ups due'}
                    tone={dueCount > 0 ? 'warn' : 'calm'}
                    sub={vi ? 'đã hẹn quay lại' : 'you said you would come back'}
                  />
                  <Box
                    n={rows.filter((r) => r.unread).length}
                    label={vi ? 'chưa đọc' : 'unread'}
                    tone="calm"
                    sub={vi ? 'trong toàn bộ hộp thư' : 'across the inbox'}
                  />
                </div>

                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c64748b)', textAlign: 'center', lineHeight: 1.6, maxWidth: 380 }}>
                  {waiting > 0
                    ? (vi ? 'Bấm "Đang chờ" bên trái để xem đúng những người này trước.' : 'Tap “Waiting” on the left to see exactly those first.')
                    : rows.length === 0
                      ? (vi ? 'Chưa có hội thoại nào. Khi khách nhắn vào Page hoặc Instagram, hội thoại sẽ mở sẵn ở đây.' : 'No conversations yet. When a customer writes to the Page or Instagram, the conversation opens right here.')
                      : (vi ? 'Không có hội thoại nào khớp bộ lọc bên trái.' : 'Nothing matches the filters on the left.')}
                </p>
              </div>
            );
          })()}

          {detail && (<>
            <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--c1e293b)', display: 'flex', alignItems: 'center', gap: 9 }}>
              {narrow && (
                <button onClick={() => { setOpenId(null); setDetail(null); setShowInfo(false); }}
                  aria-label={vi ? 'Quay lại danh sách' : 'Back to list'}
                  style={{ ...ghostBtn, padding: '10px 15px', fontSize: 19, lineHeight: 1, borderRadius: 12 }}>‹</button>
              )}
              <Avatar row={detail} size={34} />
              <div style={{ minWidth: 0 }}>
                {/* Click the name to set it. Meta withholds the profile for
                    plenty of people — accounts made with a phone number, anyone
                    who never opted in — and their own docs return an empty
                    object rather than an error, so there is no version of this
                    that always works through the API. Typing it once always
                    works, and the salon usually knows who this is. */}
                <p
                  onClick={() => void renameThread()}
                  title={vi ? 'Bấm để đặt tên khách' : 'Click to set the name'}
                  style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
                >
                  {displayName(detail, vi)}
                  {!detail.senderName && <span style={{ color: 'var(--c64748b)', fontWeight: 400, fontSize: 12 }}> ✎</span>}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--c64748b)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span>{channelLabel(detail.channel).text.replace(/^\S+\s/, '')}</span>
                  {detail.pageName && (
                    <span style={{ background: pageColor(detail.pageId).bg, color: pageColor(detail.pageId).fg, borderRadius: 5, padding: '1px 6px', fontWeight: 600 }}>{detail.pageName}</span>
                  )}
                  {/* How long ago they wrote. Meta's 24-hour and 7-day windows
                      are the rules this screen lives under, and the warning bar
                      above the composer only says WHICH side of them we are on.
                      This says by how much — the difference between "answer now"
                      and "that ship sailed on Tuesday". */}
                  {/* "wrote N ago" means the CUSTOMER. It read lastMessageAt,
                      which the bot and the staff also move — so a thread whose
                      customer last wrote last night announced "wrote 1h ago"
                      because the bot had answered an hour ago. Same field the
                      24-hour and 7-day windows are measured from, so the header
                      and the composer's warning can never disagree again. */}
                  {(detail.lastCustomerAt ?? null) && (
                    <span title={fmtInTz(detail.lastCustomerAt as string, { dateStyle: 'medium', timeStyle: 'short' })}>
                      · {vi ? 'khách nhắn' : 'customer wrote'} {sinceLabel(detail.lastCustomerAt as string, vi)}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* The phone header keeps ONE action. The state pill repeats
                    what the list already showed, and "Done" lives on in the ⓘ
                    panel — on a 390px screen every extra button here is paid
                    for with letters of the customer's name. */}
                {/* The status stays on the phone too — the owner asked for it
                    by name. Who holds this conversation is the one fact a
                    person needs before typing. */}
                {pill(stateLabel(detail, vi).tone, stateLabel(detail, vi).text)}
                {(state === 'human' || state === 'unclaimed')
                  ? <button disabled={busy} onClick={() => void act('handoff', { handoff: false })} style={{ ...ghostBtn, ...(narrow ? { padding: '9px 13px', fontSize: 13.5, borderRadius: 10 } : {}) }}>{vi ? 'Trả bot' : 'To bot'}</button>
                  : <button disabled={busy} onClick={() => void act('handoff', { handoff: true })}
                      style={{
                        ...ghostBtn,
                        ...(narrow ? { padding: '9px 13px', fontSize: 13.5, borderRadius: 10, borderColor: '#6366f1', color: 'var(--cc7d2fe)' } : {}),
                        // Past 24 hours this button is the ONLY way to answer
                        // at all, so it stops being one control among several
                        // and becomes the thing to press.
                        ...(wnotice?.kind === 'needs-takeover'
                          ? { background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 700 }
                          : {}),
                      }}>{vi ? 'Tôi nhận' : 'Take over'}</button>}
                {/* Read, but not dealt with. The one action every mail client
                    has and every chat inbox forgets. */}
                {!narrow && (
                  <button disabled={busy} onClick={() => void markUnread(detail.id)}
                    title={vi ? 'Để lại dấu chưa đọc' : 'Leave it marked unread'}
                    style={ghostBtn}>● {vi ? 'Chưa đọc' : 'Unread'}</button>
                )}
                {!narrow && (state !== 'done'
                  ? <button disabled={busy} onClick={() => void act('status', { status: 'done' })} style={ghostBtn}>{vi ? 'Xong' : 'Done'}</button>
                  : <button disabled={busy} onClick={() => void act('status', { status: 'open' })} style={ghostBtn}>{vi ? 'Mở lại' : 'Reopen'}</button>)}
                {narrow && (
                  // Labels, follow-up and notes are a column on a desktop and a
                  // panel behind this button on a phone. Same content either way.
                  <button onClick={() => setShowInfo(true)} style={{ ...ghostBtn, padding: '9px 13px', fontSize: 15, borderRadius: 10 }}
                    title={vi ? 'Nhãn · hẹn · ghi chú' : 'Labels · follow-up · notes'}>ⓘ {vi ? 'Ghi chú' : 'Notes'}</button>
                )}
              </div>
            </div>

            <div style={{ flex: '1 1 0%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0, padding: narrow ? 12 : 14, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--c0b1220)' }}>
              {/* Messages sit on the floor, not the ceiling.
                  A four-message conversation in a window-tall column used to
                  cluster at the top with a field of empty dark between the last
                  message and the box you answer in. `margin-top: auto` on a
                  zero-height first child pushes the stack down when it is short
                  and does nothing once it overflows — which is why it is this
                  rather than justify-content, whose overflow clips the oldest
                  messages out of reach. */}
              <div style={{ marginTop: 'auto' }} aria-hidden="true" />
              {/* Twelve messages must never pretend to be the whole story.
                  When Meta refused the transcript, say so and offer the retry
                  — silence here is how somebody re-asks a question the
                  customer answered last week. */}
              {detail.historySource === 'local' && (
                <div style={{ alignSelf: 'center', textAlign: 'center', fontSize: 11.5, color: 'var(--c94a3b8)', background: 'var(--c1e293b)', borderRadius: 8, padding: '6px 12px' }}>
                  {vi ? 'Chỉ đang hiện các tin gần nhất — chưa tải được toàn bộ lịch sử từ Meta.' : 'Showing recent messages only — Meta did not return the full history.'}
                  <button onClick={() => void loadThread(detail.id)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--c818cf8)', fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>{vi ? 'Thử lại' : 'Retry'}</button>
                </div>
              )}
              {detail.history.map((t, i) => {
                const mine = t.role === 'assistant';
                // A divider whenever the calendar day changes — and before the
                // first message, so a transcript never opens without saying
                // which day it starts on.
                const prev = i > 0 ? detail.history[i - 1] : null;
                const newDay = Boolean(t.at) && (!prev?.at || dayKeyInTz(t.at as string) !== dayKeyInTz(prev.at as string));
                return (
                  <Fragment key={i}>
                  {newDay && (
                    <div style={{ alignSelf: 'center', margin: '6px 0 2px' }}>
                      <span style={{
                        background: 'var(--c1e293b)', color: 'var(--c94a3b8)', borderRadius: 999,
                        padding: '3px 12px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                      }}>{dayDividerLabel(t.at as string, vi)}</span>
                    </div>
                  )}
                  <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                    {/* The customer's photos, as they sent them. The links
                        are the platform's own and expire after a while; an
                        expired one shows as a broken tile, which is still
                        more honest than pretending no photo was sent. */}
                    {!!t.images?.length && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        {t.images.map((u, j) => (
                          <a key={j} href={u} target="_blank" rel="noreferrer" title={vi ? 'Mở ảnh gốc' : 'Open the photo'}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" loading="lazy" style={{ width: narrow ? 160 : 140, height: narrow ? 160 : 140, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', display: 'block' }} />
                          </a>
                        ))}
                      </div>
                    )}
                    {(!t.images?.length || !/^\[Khách gửi/.test(t.content)) && (
                      <div style={{ background: mine ? (t.manual ? '#1d4ed8' : 'var(--c3730a3)') : 'var(--c1e293b)', color: 'var(--ce2e8f0)', borderRadius: 16, padding: narrow ? '9px 13px' : '7px 11px', fontSize: narrow ? 15 : 13, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{t.content}</div>
                    )}
                    <p style={{ margin: '3px 2px 0', fontSize: 11, color: 'var(--c64748b)', textAlign: mine ? 'right' : 'left' }}>
                      {/* Who said it. A staff reply and a bot reply looking
                          identical is how nobody could tell what the bot had
                          already promised a customer. */}
                      {mine ? (t.manual ? (vi ? 'Nhân viên' : 'Staff') : 'Bot') : (vi ? 'Khách' : 'Customer')}
                      {t.at ? (
                        <span title={fmtInTz(t.at, { dateStyle: 'full', timeStyle: 'short' })}>
                          {` · ${bubbleStampLabel(t.at, vi)}`}
                        </span>
                      ) : ''}
                    </p>
                  </div>
                  </Fragment>
                );
              })}
              <div ref={endRef} />
            </div>

            {/* One strip, two kinds of button.
                The first are the salon's OWN facts — prices, hours, address —
                read from what they wrote for the bot, so a receptionist can
                never quote a figure the bot would contradict.
                After the divider are the four things every conversation needs
                and no salon should have to type again: a name, a number, a
                time, a thank-you. Those are the ones that turn a chat into a
                booking, and typing them thirty times a day is how a busy front
                desk ends up answering in one word. */}
            {!notice.blocked && (
              <div style={{ borderTop: '1px solid var(--c1e293b)', padding: narrow ? '8px 12px' : '8px 10px', display: 'flex', gap: narrow ? 8 : 6, alignItems: 'center',
                ...(narrow ? { flexWrap: 'nowrap' as const, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const } : { flexWrap: 'wrap' as const }) }}>
                {(detail.canned ?? []).map((q) => (
                  <button key={q.label} title={q.text}
                    onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${q.text}` : q.text))}
                    style={{ ...ghostBtn, fontSize: narrow ? 13 : 11, padding: narrow ? '8px 13px' : '3px 9px', borderRadius: 999, flexShrink: 0,
                      borderColor: '#6366f1', color: 'var(--cc7d2fe)' }}>{q.label}</button>
                ))}
                {!!detail.canned?.length && (
                  <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--c334155)', flexShrink: 0, margin: '0 2px' }} />
                )}
                {ASKS.map((a) => (
                  <button key={a.k} title={vi ? a.vi : a.en}
                    onClick={() => setDraft((d) => { const t = vi ? a.vi : a.en; return d.trim() ? `${d.trim()} ${t}` : t; })}
                    style={{ ...ghostBtn, fontSize: narrow ? 13 : 11, padding: narrow ? '8px 13px' : '3px 9px', borderRadius: 999, flexShrink: 0 }}>
                    {a.icon} {vi ? a.viLabel : a.enLabel}
                  </button>
                ))}
              </div>
            )}

            {notice.text && (
              <div style={{ borderTop: '1px solid var(--c1e293b)', padding: '7px 13px', fontSize: 12,
                // Amber is "a rule applies here"; red is "nothing can be sent".
                // The take-over state locks the box but is NOT red: the reply
                // is one click away, and red would read as a dead end.
                color: (notice.tone ?? (notice.blocked ? 'red' : 'amber')) === 'red' ? 'var(--cfca5a5)' : 'var(--cfcd34d)',
                background: (notice.tone ?? (notice.blocked ? 'red' : 'amber')) === 'red' ? 'rgba(127,29,29,0.25)' : 'rgba(120,53,15,0.25)' }}>{notice.text}</div>
            )}

            <div style={{ borderTop: '1px solid var(--c1e293b)', padding: narrow ? '8px 10px' : 10, display: 'flex', gap: 8, alignItems: 'flex-end',
              // The iPhone home bar floats over anything that ignores the safe
              // area; a send button under it is a send button nobody can press.
              paddingBottom: narrow ? 'calc(8px + env(safe-area-inset-bottom))' : 10 }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={composerPlaceholder}
                disabled={notice.blocked || busy} rows={narrow ? 1 : 2}
                style={{ ...ui.input, flex: 1, resize: narrow ? 'none' : 'vertical', minHeight: 44,
                  fontSize: narrow ? 16 : 14, borderRadius: narrow ? 22 : 8, padding: narrow ? '11px 16px' : '9px 11px' }} />
              {narrow ? (
                <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()}
                  aria-label={vi ? 'Gửi' : 'Send'}
                  style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', flexShrink: 0, cursor: 'pointer',
                    background: (notice.blocked || !draft.trim()) ? 'var(--c334155)' : '#6366f1', color: '#fff', fontSize: 19, lineHeight: 1 }}>➤</button>
              ) : (
                <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()} style={ui.primaryBtn}>{vi ? 'Gửi' : 'Send'}</button>
              )}
            </div>

          </>)}
        </div>

        {/* Info column. Customer facts on top, internal notes below — the
            layout Pancake uses, and the right one: both are reference material
            you glance at while typing, not things that belong in the flow of
            the conversation. */}
        <div style={{
          borderLeft: narrow ? 'none' : '1px solid var(--c1e293b)', flexDirection: 'column', minWidth: 0,
          background: 'var(--c0f172a)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0,
          // On a phone the notes, labels and follow-up live behind the ⓘ button
          // in the conversation header rather than in a fourth column.
          display: narrow ? (showInfo && !!openId ? 'flex' : 'none') : 'flex',
          ...(narrow ? { flex: '1 1 0%' } : {}),
        }}>
          {narrow && (
            <button onClick={() => setShowInfo(false)}
              style={{ ...ghostBtn, margin: 10, alignSelf: 'flex-start', fontSize: 12 }}>
              ‹ {vi ? 'Về hội thoại' : 'Back to chat'}
            </button>
          )}
          {!detail ? (
            <p style={{ color: 'var(--c64748b)', fontSize: 12, padding: 14, margin: 0 }}>
              {vi
                ? 'Chọn một hội thoại để xem: tên và số điện thoại, số lần đã ghé, lịch hẹn sắp tới, thợ quen, nhãn, lời nhắc theo dõi và ghi chú nội bộ của team.'
                : 'Pick a conversation to see: name and phone, visits so far, the next appointment, their usual tech, labels, the follow-up reminder and the team’s private notes.'}
            </p>
          ) : (<>
            <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--c1e293b)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--c64748b)' }}>{vi ? 'Khách này ở Lumio' : 'This customer, in Lumio'}</p>
              {detail.customer ? (() => {
                // Four facts stacked two lines each used a third of the column
                // to say very little, and the appointments the server had
                // already sent were thrown away. They are the reason somebody
                // opens this panel mid-conversation: is this person booked,
                // for what, with whom.
                const appts = [...(detail.customer.appointments ?? [])]
                  .filter((a) => a && a.startTime)
                  .sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
                const now = Date.now();
                const upcoming = [...appts].reverse().find((a) => +new Date(a.startTime) > now) ?? null;
                const past = appts.filter((a) => +new Date(a.startTime) <= now).slice(0, 3);
                const who = (a: ApptCtx) => a.assignedStaff?.firstName ?? null;
                const what = (a: ApptCtx) => a.service?.name ?? null;
                return (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* The facts, two to a row. Same information, a third of the height. */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
                      <Stat label={vi ? 'Đã đến' : 'Visits'} value={vi ? `${detail.customer.visits ?? 0} lần` : String(detail.customer.visits ?? 0)} />
                      {detail.customer.usualTech && <Stat label={vi ? 'Thợ quen' : 'Usual tech'} value={detail.customer.usualTech} />}
                      {detail.customer.phone && <Stat label={vi ? 'Điện thoại' : 'Phone'} value={detail.customer.phone} />}
                      {detail.customer.email && <Stat label="Email" value={detail.customer.email} />}
                    </div>

                    {/* The next appointment, given the weight it has in the
                        conversation. Not a stat line — the thing itself. */}
                    {upcoming ? (
                      <div style={{ border: '1px solid var(--c334155)', borderRadius: 9, padding: '9px 11px', background: 'var(--c0b1220)' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c64748b)' }}>{vi ? 'Lịch tới' : 'Next visit'}</span>
                          {upcoming.status && pill(apptTone(upcoming.status), apptStatusLabel(upcoming.status, vi))}
                        </div>
                        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                          {fmtInTz(upcoming.startTime, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                          {[what(upcoming), who(upcoming) && `${vi ? 'thợ' : 'with'} ${who(upcoming)}`].filter(Boolean).join(' · ') || (vi ? 'chưa rõ dịch vụ' : 'service not set')}
                        </p>
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)' }}>
                        {vi ? 'Chưa có lịch hẹn sắp tới.' : 'No upcoming appointment.'}
                      </p>
                    )}

                    {/* What they actually came in for. Three lines of history
                        answer "have we done this before, and who did it" without
                        leaving the conversation. */}
                    {past.length > 0 && (
                      <div>
                        <p style={{ margin: '0 0 5px', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c64748b)' }}>
                          {vi ? 'Đã làm gần đây' : 'Recent visits'}
                        </p>
                        <div style={{ display: 'grid', gap: 4 }}>
                          {past.map((a) => (
                            <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45 }}>
                              <span style={{ color: 'var(--c64748b)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                {fmtInTz(a.startTime, { day: '2-digit', month: '2-digit' })}
                              </span>
                              <span style={{ color: 'var(--c94a3b8)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {[what(a), who(a)].filter(Boolean).join(' · ') || (vi ? 'lịch hẹn' : 'appointment')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5 }}>
                  {/* Deliberately empty rather than guessed. Matching on a name
                      would show one customer another customer's spending. */}
                  {vi
                    ? 'Chưa nối được với hồ sơ khách. Sẽ tự nối khi khách đặt lịch từ hội thoại này.'
                    : 'Not linked to a customer record yet. It links itself when they book from this conversation.'}
                </p>
              )}

              {/* From a conversation to a booking, in one press.
                  This is the shortest path in the product between a message
                  and money, and until now it was: read the number, remember
                  it, open another tab, find the booking screen, type it back.
                  Four chances to transpose two digits.

                  The name and number are put on the clipboard FIRST and the
                  query string carries them too — whichever the booking screen
                  is ready for, the receptionist has them. */}
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
                {detail.customer?.phone && (
                  <a href={`tel:${String(detail.customer.phone).replace(/[^+\d]/g, '')}`}
                    style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: narrow ? '9px 13px' : '5px 10px', fontSize: narrow ? 13.5 : 12 }}>
                    ☎ {vi ? 'Gọi' : 'Call'}
                  </a>
                )}
                {detail.customer?.phone && (
                  <button
                    onClick={() => { void copyContact(detail); }}
                    style={{ ...ghostBtn, padding: narrow ? '9px 13px' : '5px 10px', fontSize: narrow ? 13.5 : 12 }}>
                    {copied ? `✓ ${vi ? 'Đã chép' : 'Copied'}` : `⧉ ${vi ? 'Chép tên + số' : 'Copy name + number'}`}
                  </button>
                )}
                {inSalonPortal() && (
                  <button
                    onClick={() => { void bookFor(detail); }}
                    style={{
                      padding: narrow ? '9px 14px' : '5px 11px', fontSize: narrow ? 13.5 : 12, fontWeight: 700,
                      borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: '#6366f1', color: 'var(--cf8fafc)',
                    }}>
                    📅 {vi ? 'Đặt lịch cho khách này' : 'Book this customer'}
                  </button>
                )}
              </div>
            </div>

            {/* The phone header gave this button's seat to the customer's
                name; the action itself moves here rather than disappearing. */}
            {narrow && (
              <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--c1e293b)', display: 'flex', gap: 8 }}>
                {stateOf(detail) !== 'done'
                  ? <button disabled={busy} onClick={() => void act('status', { status: 'done' })} style={{ ...ghostBtn, flex: 1, padding: '11px 0', fontSize: 14, borderRadius: 10 }}>✓ {vi ? 'Xong hội thoại' : 'Mark done'}</button>
                  : <button disabled={busy} onClick={() => void act('status', { status: 'open' })} style={{ ...ghostBtn, flex: 1, padding: '11px 0', fontSize: 14, borderRadius: 10 }}>{vi ? 'Mở lại hội thoại' : 'Reopen'}</button>}
              </div>
            )}

            {/* Labels: where this conversation stands. */}
            <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--c1e293b)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--c64748b)', fontWeight: 700 }}>{vi ? 'NHÃN' : 'LABELS'}</span>
                <button onClick={() => setShowLabelForm((v) => !v)}
                  style={{ ...ghostBtn, marginLeft: 'auto', fontSize: 11, padding: '1px 7px' }}>
                  {showLabelForm ? (vi ? 'Đóng' : 'Close') : (vi ? '+ Nhãn mới' : '+ New')}
                </button>
              </div>

              {showLabelForm && (
                <div style={{ marginBottom: 9 }}>
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createLabel(); } }}
                    placeholder={vi ? 'Tên nhãn, ví dụ "Đã báo giá"' : 'Label name'}
                    maxLength={40}
                    style={{ ...ui.input, fontSize: 12, padding: '5px 8px' }} />
                  <div style={{ display: 'flex', gap: 5, margin: '7px 0' }}>
                    {LABEL_COLORS.map((c) => (
                      <button key={c} onClick={() => setNewColor(c)} aria-label={c}
                        style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: newColor === c ? '2px solid var(--ce2e8f0)' : '2px solid transparent' }} />
                    ))}
                  </div>
                  <button onClick={() => void createLabel()} disabled={busy || !newLabel.trim()}
                    style={{ ...ui.primaryBtn, fontSize: 12, padding: "4px 11px" }}>{vi ? "Tạo" : "Create"}</button>
                </div>
              )}

              {!labels.length && !showLabelForm && (
                // Nothing is seeded on purpose — the stages of a sale differ in
                // every salon, and an invented default would sit unused forever.
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5 }}>
                  {vi ? 'Chưa có nhãn nào. Tạo nhãn theo cách tiệm bạn bán hàng: "Đã báo giá", "Chờ chốt", "Không quan tâm".'
                      : 'No labels yet. Create the stages your salon actually uses.'}
                </p>
              )}

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {labels.map((l) => {
                  const on = (detail.labels ?? []).some((x) => x.id === l.id);
                  return (
                    <button key={l.id} onClick={() => void toggleLabel(l.id, !on)} disabled={busy}
                      title={on ? (vi ? 'Bỏ nhãn' : 'Remove') : (vi ? 'Gắn nhãn' : 'Apply')}
                      style={{
                        border: `1px solid ${on ? l.color : 'var(--c334155)'}`,
                        background: on ? l.color : 'transparent',
                        color: on ? '#fff' : 'var(--c94a3b8)',
                        borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                      }}>{on ? '✓ ' : ''}{l.name}</button>
                  );
                })}
              </div>
            </div>

            {/* Follow-up: WHEN to come back. Deliberately not a label — a label
                is true forever and so cannot remind anybody of anything. */}
            <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--c1e293b)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--c64748b)', fontWeight: 700 }}>{vi ? 'HẸN THEO DÕI' : 'FOLLOW-UP'}</span>
                {followUpState(detail.followUpAt) !== 'none' && (
                  <span style={{
                    background: FOLLOWUP_TONE[followUpState(detail.followUpAt)].bg,
                    color: FOLLOWUP_TONE[followUpState(detail.followUpAt)].fg,
                    borderRadius: 6, padding: '1px 7px', fontSize: 10.5, fontWeight: 700,
                  }}>{followUpLabel(detail.followUpAt, new Date())}</span>
                )}
              </div>

              <input type="datetime-local"
                value={toLocalInput(detail.followUpAt)}
                onChange={(e) => void setFollowUp(e.target.value)}
                disabled={busy}
                style={{ ...ui.input, fontSize: 12, padding: '5px 8px'}} />

              <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                {/* The three answers a receptionist actually gives. Typing a
                    date by hand for every "để em gọi lại sau" is the reason
                    follow-up systems go unused. */}
                {([
                  [1, vi ? 'Mai' : 'Tomorrow'],
                  [3, vi ? '3 ngày' : '3 days'],
                  [7, vi ? '1 tuần' : '1 week'],
                ] as [number, string][]).map(([days, label]) => (
                  <button key={days} disabled={busy}
                    onClick={() => {
                      // "+N days at 10:00" counts salon days and a salon hour.
                      const day = dayKeyInTz(new Date(Date.now() + days * 86_400_000));
                      void setFollowUp(`${day}T10:00`);
                    }}
                    style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px' }}>{label}</button>
                ))}
                {detail.followUpAt && (
                  <button onClick={() => void setFollowUp('')} disabled={busy}
                    style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px', color: 'var(--cf87171)', borderColor: 'var(--c7f1d1d)' }}>
                    {vi ? 'Xoá hẹn' : 'Clear'}
                  </button>
                )}
              </div>
            </div>

            <div style={{ padding: '11px 13px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--cfcd34d)', fontWeight: 700 }}>{vi ? 'GHI CHÚ NỘI BỘ' : 'INTERNAL NOTES'}</span>
              <span style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{vi ? '· khách không thấy' : '· customer cannot see these'}</span>
            </div>

            <div style={{ padding: '0 13px 10px' }}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); } }}
                placeholder={vi ? 'Nhập ghi chú (Enter để lưu)' : 'Add a note (Enter to save)'}
                rows={2}
                style={{ ...ui.input, width: '100%', fontSize: 12, resize: 'vertical', minHeight: 38, borderColor: 'var(--c78350f)', background: 'rgba(120,53,15,0.12)' }}
              />
            </div>

            <div style={{ flex: '1 1 0%', overflowY: 'auto', minHeight: narrow ? undefined : 120, padding: '0 13px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {!detail.notes?.length && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)' }}>{vi ? 'Chưa có ghi chú nào.' : 'No notes yet.'}</p>
              )}
              {detail.notes?.map((n) => (
                <div key={n.id} style={{ background: 'rgba(120,53,15,0.18)', border: '1px solid var(--c78350f)', borderRadius: 8, padding: '7px 9px' }}>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--cfde68a)', whiteSpace: 'pre-wrap' }}>{n.text}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#a16207', display: 'flex', gap: 6 }}>
                    <span>{n.authorName}</span>
                    <span>·</span>
                    <span>{fmtInTz(n.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                    <button
                      onClick={() => void apiFetch(`/messenger/threads/${detail.id}/notes/${n.id}/delete`, { method: 'POST', token: token! }).then(() => loadThread(detail.id))}
                      title={vi ? 'Xoá ghi chú' : 'Delete note'}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#a16207', cursor: 'pointer', fontSize: 11, padding: 0 }}
                    >×</button>
                  </p>
                </div>
              ))}
            </div>
          </>)}
        </div>
      </div>
    </>
  );
}

/**
 * One number, large, with what it counts under it.
 *
 * Alarm is the only saturated colour: a screen where three tiles shout is a
 * screen where none of them do.
 */
function Box({ n, label, sub, tone }: { n: number; label: string; sub?: string; tone: 'alarm' | 'warn' | 'calm' }) {
  const edge = tone === 'alarm' && n > 0 ? '#ef4444' : tone === 'warn' && n > 0 ? '#f59e0b' : 'var(--c334155)';
  const num = tone === 'alarm' && n > 0 ? '#ef4444' : tone === 'warn' && n > 0 ? '#f59e0b' : 'var(--ce2e8f0)';
  return (
    <div style={{
      minWidth: 132, padding: '13px 16px', borderRadius: 12, textAlign: 'center',
      background: 'var(--c0f172a)', border: `1px solid ${edge}`,
    }}>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, color: num }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/**
 * How a booking status reads and looks in the customer panel.
 *
 * Green is "this is on", amber is "not settled yet", grey is "off". Raw enum
 * names are not words: a receptionist reading "ASSIGNED" has to translate it
 * before it means anything, and CANCELLED in green means the opposite of what
 * the colour says.
 */
/**
 * The day a message belongs to, written the way a person says it.
 *
 * WHY THIS EXISTS
 *
 * Every bubble used to be stamped with the clock alone — "02:00 AM" — so a
 * conversation from eleven days ago read as if it had happened at two o'clock
 * THIS morning. The thread header says "wrote 11d ago" and the bubbles said
 * 2 AM, and the bubbles win, because they sit next to the words.
 *
 * The fix is the one every chat app uses: a day divider between days, and the
 * clock alone inside a day. Compared with dayKeyInTz so the boundary is the
 * salon's midnight, not UTC's — a 10 PM message in Texas is not "tomorrow".
 */
function dayDividerLabel(at: string, vi: boolean): string {
  const today = dayKeyInTz(new Date());
  const key = dayKeyInTz(at);
  if (key === today) return vi ? 'Hôm nay' : 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dayKeyInTz(y)) return vi ? 'Hôm qua' : 'Yesterday';
  // One way of writing a day per transcript, not two.
  //
  // The divider said "Yesterday" in one place and "Tuesday, September 1" in
  // another, so a reader had to hold two mental formats at once to work out
  // which group was older. Every divider past yesterday is now the same
  // absolute shape, and the two relative words stay only for the two days
  // where "yesterday" is genuinely clearer than a date.
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fmtInTz(at, sameYear
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The stamp under a message bubble.
 *
 * WHY THE DIVIDER WAS NOT ENOUGH
 *
 * A day divider only helps at the boundary between two days. A ten-day-old
 * conversation that all happened inside one morning has exactly ONE divider —
 * at the very top, above the first bubble, scrolled out of sight the moment
 * the transcript jumps to the newest message. What the reader actually sees is
 * ten bubbles stamped "07:11 AM", and reads them as this morning.
 *
 * So the date goes on the bubble itself whenever the message is not from
 * today. Today keeps the bare clock, because that is the only day where
 * printing the date on every line is noise.
 */
function bubbleStampLabel(at: string, vi: boolean): string {
  const today = dayKeyInTz(new Date());
  const key = dayKeyInTz(at);
  if (key === today) return fmtInTz(at, { hour: '2-digit', minute: '2-digit' });
  // Bubbles never say "Yesterday": the divider above them already does, and a
  // stack where one line reads "Yesterday 11:38 PM" and the next reads
  // "01 Sep, 07:12 AM" is two formats asking the reader to compare them.
  // Outside today, a bubble always carries a date.
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fmtInTz(at, sameYear
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * The stamp on a row in the conversation list, in 290px of width.
 *
 * Same trap as the bubbles: three rows reading 07:12 AM, 02:04 AM, 09:33 PM
 * look like one busy morning when they are three different days. Today keeps
 * the clock, because that is the one day where the hour is the useful part;
 * every other day is named instead.
 */
function listStampLabel(at: string, vi: boolean): string {
  const today = dayKeyInTz(new Date());
  const key = dayKeyInTz(at);
  if (key === today) return fmtInTz(at, { hour: '2-digit', minute: '2-digit' });
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dayKeyInTz(y)) return vi ? 'Hôm qua' : 'Yesterday';
  const days = Math.round((Date.parse(today) - Date.parse(key)) / 86_400_000);
  if (days > 1 && days < 7) return fmtInTz(at, { weekday: 'short' });
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fmtInTz(at, sameYear ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** "3 min", "9 days" — how long ago, in the one unit that reads cleanly. */
function sinceLabel(at: string, vi: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return vi ? 'vừa xong' : 'just now';
  if (mins < 60) return vi ? `${mins} phút trước` : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return vi ? `${hrs} giờ trước` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return vi ? `${days} ngày trước` : `${days}d ago`;
}

function apptTone(status: string): string {
  const s = String(status).toUpperCase();
  if (s === 'CANCELLED' || s === 'NO_SHOW' || s === 'COMPLETED') return 'done';
  if (s === 'PENDING') return 'wait';
  return 'held';
}

function apptStatusLabel(status: string, vi: boolean): string {
  const s = String(status).toUpperCase();
  const en: Record<string, string> = {
    PENDING: 'pending', ASSIGNED: 'assigned', ACCEPTED: 'accepted', CONFIRMED: 'confirmed',
    COMPLETED: 'done', CANCELLED: 'cancelled', NO_SHOW: 'no-show',
  };
  const vn: Record<string, string> = {
    PENDING: 'chờ xếp', ASSIGNED: 'đã xếp thợ', ACCEPTED: 'thợ nhận', CONFIRMED: 'đã xác nhận',
    COMPLETED: 'đã xong', CANCELLED: 'đã huỷ', NO_SHOW: 'không đến',
  };
  return (vi ? vn : en)[s] ?? s.toLowerCase().replace(/_/g, ' ');
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--c64748b)' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{value}</p>
    </div>
  );
}
