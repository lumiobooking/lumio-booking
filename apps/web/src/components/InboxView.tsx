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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch, apiStream, apiImage } from '../lib/api';
import { ui } from '../lib/ui';
import { useLang } from '../lib/i18n';
import { uiLocale } from '../lib/datetime';
import {
  InboxRow, InboxFilter, channelLabel, channelMark, stateLabel, stateOf,
  sortRows, filterRows, sourcesFrom, waitingCount, composerNotice, displayName, pageColor, initialsOf,
  InboxLabel, followUpState, followUpLabel, followUpCount,
} from '../lib/inbox-view';

interface Turn { role: 'user' | 'assistant'; content: string; at: string | null; manual: boolean }
interface CustomerCtx {
  firstName?: string | null; lastName?: string | null; phone?: string | null;
  visits?: number; nextAt?: string | null; usualTech?: string | null;
}
interface ThreadDetail extends InboxRow {
  history: Turn[];
  /** 'meta' = full transcript · 'local' = Meta refused, 12-turn buffer only ·
   *  'partial' = the fast first paint, full answer still on its way. */
  historySource?: 'partial' | 'meta' | 'local';
  customer: CustomerCtx | null;
  replyWindow?: { open: boolean; minutesLeft: number | null };
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

/** <input type="datetime-local"> wants local wall-clock, not an ISO Z string. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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
  const [err, setErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [source, setSource] = useState<string>('any');
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
    } catch (e) {
      // A failed refresh must not blank the list someone is reading — but it
      // must SAY SO. This used to swallow the error entirely, and the screen
      // then showed "no conversations match these filters", which is a
      // different sentence with a different meaning: it says the inbox is fine
      // and empty. An inbox that reports "empty" when it actually means
      // "I could not ask" is the worst failure this screen has, because
      // nobody goes looking for messages they have been told do not exist.
      setListErr(String(e));
    }
  }, [token]);

  const loadThread = useCallback(async (id: string) => {
    if (!token) return;
    try {
      // Two asks. The first never touches Meta and answers in one database
      // hop — the conversation paints at the speed of a click. The second
      // brings the full Meta transcript and the name backfill; by the time a
      // person has read the first two bubbles it has quietly replaced the rest.
      const quick = await apiFetch<ThreadDetail>(`/messenger/threads/${id}?full=0`, { token });
      setDetail((cur) => (cur && cur.id !== quick.id ? cur : quick));
      void apiFetch(`/messenger/threads/${id}/read`, { method: 'POST', token }).catch(() => undefined);
      const fullD = await apiFetch<ThreadDetail>(`/messenger/threads/${id}`, { token });
      // The person may have clicked another conversation while Meta answered —
      // a late reply must never overwrite the thread they are LOOKING at now.
      setDetail((cur) => (cur && cur.id === fullD.id ? fullD : cur));
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
  openRef.current = openId;

  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let gone = false;

    const refresh = () => {
      void loadList();
      if (openRef.current) void loadThread(openRef.current);
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

  useEffect(() => {
    if (!narrow) { setCardH(null); return; }
    const measure = () => {
      window.scrollTo(0, 0);
      const top = cardRef.current?.getBoundingClientRect().top ?? 0;
      setCardH(`calc(100dvh - ${Math.max(0, Math.round(top))}px - 8px)`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [narrow, openId, showInfo]);

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
      const at = local ? new Date(local).toISOString() : null;
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
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  const sources = sourcesFrom(rows);
  const sorted = sortRows(filterRows(rows, { filter, source, query, meId: me, labelId }));
  const waiting = waitingCount(rows);
  const dueCount = followUpCount(rows);
  const notice = composerNotice(detail?.replyWindow, vi);
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{vi ? 'Hộp thư' : 'Inbox'}</h1>
          {waiting > 0 && pill('wait', vi ? `${waiting} khách đang chờ` : `${waiting} waiting`)}
        </div>
      )}

      {err && <div style={{ ...ui.card, borderColor: 'var(--c7f1d1d)', color: 'var(--cfca5a5)', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div ref={cardRef} style={{ ...ui.card, padding: 0, overflow: 'hidden', display: 'grid',
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
            : { flexDirection: 'column', padding: '10px 0', borderRight: '1px solid var(--c1e293b)', alignItems: 'center' }),
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
          borderRight: narrow ? 'none' : '1px solid var(--c1e293b)', flexDirection: 'column', minWidth: 0,
          // On a phone, picking a customer replaces the list with the chat.
          display: (narrow && openId) ? 'none' : 'flex',
          ...(narrow ? { flex: '1 1 0%', minHeight: 0 } : {}),
        }}>
          <div style={{ padding: '9px 10px', borderBottom: '1px solid var(--c1e293b)' }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={vi ? 'Tìm khách…' : 'Search…'}
              // 16px on the phone is not a taste choice: anything smaller and
              // iOS zooms the page the moment the field is tapped.
              style={{ ...ui.input, fontSize: narrow ? 16 : 12, padding: narrow ? '10px 13px' : '6px 9px', borderRadius: narrow ? 12 : 8 }} />
          </div>

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

          <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch',
            // Desktop caps the list so the panels after it stay reachable; the
            // phone is a fixed-height screen where flex:1 IS the cap.
            maxHeight: narrow ? undefined : 'min(58vh, 520px)', minHeight: 0 }}>
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
            {!sorted.length && !listErr && (
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
                <button key={r.id} onClick={() => { setOpenId(r.id); void loadThread(r.id); }}
                  style={{ width: '100%', textAlign: 'left', display: 'block', cursor: 'pointer',
                    background: on ? 'var(--c1e293b)' : 'transparent', border: 'none',
                    borderLeft: `2px solid ${on ? '#6366f1' : 'transparent'}`,
                    borderBottom: '1px solid var(--c1e293b)', padding: narrow ? '13px 14px' : '9px 11px' }}>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <Avatar row={r} size={narrow ? 48 : 34} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ color: 'var(--ce2e8f0)', fontSize: narrow ? 15.5 : 13, fontWeight: r.unread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName(r, vi)}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c64748b)', flexShrink: 0 }}>
                          {new Date(r.lastMessageAt || r.updatedAt).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {r.unread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />}
                      </div>
                      <p style={{ margin: '0 0 5px', fontSize: narrow ? 13.5 : 12, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastText || '—'}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        {pill(st.tone, st.text)}
                        {/* The Page, named and in its own colour. Only while
                            looking at everything — inside one source it would be
                            the same chip on every row, which is noise. */}
                        {source === 'any' && r.pageName && (
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
        </div>

        {/* Conversation */}
        <div style={{
          flexDirection: 'column', minWidth: 0,
          // On a phone this IS the screen once a customer is picked, and it is
          // hidden until then — never a half-width chat beside a half-width list.
          display: (narrow && (!openId || showInfo)) ? 'none' : 'flex',
          ...(narrow ? { flex: '1 1 0%', minHeight: 0 } : {}),
        }}>
          {!detail && (
            <p style={{ color: 'var(--c64748b)', fontSize: 13, padding: 20, margin: 0 }}>
              {vi ? 'Chọn một hội thoại bên trái để trả lời.' : 'Pick a conversation on the left.'}
            </p>
          )}

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
                <p style={{ margin: 0, fontSize: 11, color: 'var(--c64748b)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>{channelLabel(detail.channel).text.replace(/^\S+\s/, '')}</span>
                  {detail.pageName && (
                    <span style={{ background: pageColor(detail.pageId).bg, color: pageColor(detail.pageId).fg, borderRadius: 5, padding: '1px 6px', fontWeight: 600 }}>{detail.pageName}</span>
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
                  : <button disabled={busy} onClick={() => void act('handoff', { handoff: true })} style={{ ...ghostBtn, ...(narrow ? { padding: '9px 13px', fontSize: 13.5, borderRadius: 10, borderColor: '#6366f1', color: 'var(--cc7d2fe)' } : {}) }}>{vi ? 'Tôi nhận' : 'Take over'}</button>}
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

            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: narrow ? 0 : 180, maxHeight: narrow ? undefined : 'min(46vh, 420px)', padding: narrow ? 12 : 14, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--c0b1220)' }}>
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
                return (
                  <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                    <div style={{ background: mine ? (t.manual ? '#1d4ed8' : 'var(--c3730a3)') : 'var(--c1e293b)', color: 'var(--ce2e8f0)', borderRadius: 16, padding: narrow ? '9px 13px' : '7px 11px', fontSize: narrow ? 15 : 13, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{t.content}</div>
                    <p style={{ margin: '3px 2px 0', fontSize: 11, color: 'var(--c64748b)', textAlign: mine ? 'right' : 'left' }}>
                      {/* Who said it. A staff reply and a bot reply looking
                          identical is how nobody could tell what the bot had
                          already promised a customer. */}
                      {mine ? (t.manual ? (vi ? 'Nhân viên' : 'Staff') : 'Bot') : (vi ? 'Khách' : 'Customer')}
                      {t.at ? ` · ${new Date(t.at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {!!detail.canned?.length && !notice.blocked && (
              <div style={{ borderTop: '1px solid var(--c1e293b)', padding: narrow ? '8px 12px' : '8px 10px', display: 'flex', gap: narrow ? 8 : 6,
                ...(narrow ? { flexWrap: 'nowrap' as const, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const } : { flexWrap: 'wrap' as const }) }}>
                {detail.canned.map((q) => (
                  <button key={q.label} title={q.text}
                    onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${q.text}` : q.text))}
                    style={{ ...ghostBtn, fontSize: narrow ? 13 : 11, padding: narrow ? '8px 13px' : '3px 9px', borderRadius: 999, flexShrink: 0 }}>{q.label}</button>
                ))}
              </div>
            )}

            {notice.text && (
              <div style={{ borderTop: '1px solid var(--c1e293b)', padding: '7px 13px', fontSize: 12,
                color: notice.blocked ? 'var(--cfca5a5)' : 'var(--cfcd34d)',
                background: notice.blocked ? 'rgba(127,29,29,0.25)' : 'rgba(120,53,15,0.25)' }}>{notice.text}</div>
            )}

            <div style={{ borderTop: '1px solid var(--c1e293b)', padding: narrow ? '8px 10px' : 10, display: 'flex', gap: 8, alignItems: 'flex-end',
              // The iPhone home bar floats over anything that ignores the safe
              // area; a send button under it is a send button nobody can press.
              paddingBottom: narrow ? 'calc(8px + env(safe-area-inset-bottom))' : 10 }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={notice.blocked ? (vi ? 'Không gửi được — quá 24 giờ' : 'Cannot send — past 24 hours') : (vi ? `Nhắn cho ${displayName(detail, vi)}…` : 'Message the customer…')}
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
          background: 'var(--c0f172a)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', maxHeight: narrow ? undefined : 'min(78vh, 700px)', minHeight: 0,
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
              {vi ? 'Thông tin khách hiện ở đây.' : 'Customer details appear here.'}
            </p>
          ) : (<>
            <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--c1e293b)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--c64748b)' }}>{vi ? 'Khách này ở Lumio' : 'This customer, in Lumio'}</p>
              {detail.customer ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {detail.customer.nextAt && <Stat label={vi ? 'Lần tới' : 'Next'} value={new Date(detail.customer.nextAt).toLocaleString(uiLocale())} />}
                  <Stat label={vi ? 'Đã đến' : 'Visits'} value={vi ? `${detail.customer.visits ?? 0} lần` : String(detail.customer.visits ?? 0)} />
                  {detail.customer.usualTech && <Stat label={vi ? 'Thợ quen' : 'Usual tech'} value={detail.customer.usualTech} />}
                  {detail.customer.phone && <Stat label={vi ? 'Điện thoại' : 'Phone'} value={detail.customer.phone} />}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5 }}>
                  {/* Deliberately empty rather than guessed. Matching on a name
                      would show one customer another customer's spending. */}
                  {vi
                    ? 'Chưa nối được với hồ sơ khách. Sẽ tự nối khi khách đặt lịch từ hội thoại này.'
                    : 'Not linked to a customer record yet. It links itself when they book from this conversation.'}
                </p>
              )}
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
                      const d = new Date();
                      d.setDate(d.getDate() + days);
                      d.setHours(10, 0, 0, 0); // a working hour, not this minute
                      void setFollowUp(toLocalInput(d.toISOString()));
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

            <div style={{ flex: 1, overflowY: 'auto', maxHeight: narrow ? undefined : 'min(40vh, 340px)', padding: '0 13px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {!detail.notes?.length && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)' }}>{vi ? 'Chưa có ghi chú nào.' : 'No notes yet.'}</p>
              )}
              {detail.notes?.map((n) => (
                <div key={n.id} style={{ background: 'rgba(120,53,15,0.18)', border: '1px solid var(--c78350f)', borderRadius: 8, padding: '7px 9px' }}>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--cfde68a)', whiteSpace: 'pre-wrap' }}>{n.text}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#a16207', display: 'flex', gap: 6 }}>
                    <span>{n.authorName}</span>
                    <span>·</span>
                    <span>{new Date(n.createdAt).toLocaleString(uiLocale())}</span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--c64748b)' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{value}</p>
    </div>
  );
}
