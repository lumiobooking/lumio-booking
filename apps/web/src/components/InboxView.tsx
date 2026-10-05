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

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtInTz } from '../lib/datetime';
import { useAuth } from '../lib/auth';
import { apiFetch, apiStream, apiImage, apiImageCached } from '../lib/api';
import { wallToInstantISO, instantToWall, dayKeyInTz } from '../lib/datetime';
import { ui } from '../lib/ui';
import { Linkified } from './Linkified';
import { PushSetup } from './PushSetup';
import type { TurnsView } from './ChatTurnsPanel';
import { useLang } from '../lib/i18n';
import { setOpenConversation } from '../lib/inbox-sound';
import { uiLocale } from '../lib/datetime';
import {
  InboxRow, InboxFilter, channelBrand, channelLabel, channelMark, stateLabel, stateOf,
  sortRows, filterRows, sourcesFrom, waitingCount, composerNotice, displayName, pageColor, initialsOf,
  InboxLabel, followUpState, followUpLabel, followUpCount, channelCounts, channelOf, humanAgentNotice,
  windowNotice, type WindowInfo, spamCount, isSpamRow,
} from '../lib/inbox-view';

/**
 * Avatar with the channel mark tucked into its corner, coloured by PAGE.
 *
 * This is the piece that answers "which page is this from" at a glance. The
 * channel mark alone cannot: two Fanpages are both Messenger and draw the same
 * envelope. The colour separates them, and it is derived from the page id so it
 * never changes between refreshes or between two people looking at the inbox.
 *
 * WHY THIS LIVES AT MODULE SCOPE AND NOT INSIDE THE INBOX
 *
 * It used to be declared inside the component body. That makes a NEW function
 * on every render, and React compares component types by identity: a new type
 * is a different component, so every avatar was unmounted and remounted on
 * every render - every thirty-second poll, every push from the stream, every
 * keystroke in the search box. Each remount reset `pic` to null, so each one
 * flashed its initials and then the photograph again.
 *
 * That is the blink the shop sees - "lâu lâu chớp một cái giống như load".
 * Nothing was loading. The list was being thrown away and rebuilt.
 *
 * Declared once, wrapped in memo, and seeded from the picture cache on the
 * first frame, an avatar now renders exactly once per conversation and then
 * holds still.
 */
/**
 * Did the server actually send us anything new?
 *
 * A live inbox asks again every time a webhook fires and every thirty seconds
 * regardless. Almost every one of those answers is identical to the one on
 * screen. Writing it into state anyway re-renders the whole inbox for nothing,
 * and a re-render of a list is never free: scroll position, text selection and
 * every image in it pay for it.
 *
 * So: compare first, write only on a difference. This is what turns a polled
 * screen into one that feels like Messenger - the screen stops moving unless
 * something moved.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * Keep the row objects we already have wherever the row has not changed.
 *
 * Same idea one level down: even when ONE conversation moves, the other forty
 * arrive as brand-new objects, and anything memoised on a row identity repaints
 * for all of them. Handing back the previous object for every unchanged row
 * means only the row that actually changed is new.
 */
function keepRows(prev: InboxRow[], next: InboxRow[]): InboxRow[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  let moved = prev.length !== next.length;
  const out = next.map((r, i) => {
    const old = byId.get(r.id);
    if (old && same(old, r)) { if (prev[i] !== old) moved = true; return old; }
    moved = true;
    return r;
  });
  return moved ? out : prev;
}

/**
 * SOLID SHAPES, NOT OUTLINES.
 *
 * At seventeen pixels a 2px stroke is most of the shape: the outlined speech
 * bubble came out as a ring with a dot in it. Filled silhouettes survive the
 * size, which is the only size this is ever drawn at.
 *
 * The shapes stay generic — a speech bubble, a camera, a letter, a globe.
 * Drawing Meta's or Zalo's actual marks would be putting somebody else's
 * trademark in our product; the colour is what does the recognising anyway,
 * and the name is on the tooltip and the aria-label for anyone who needs it.
 */
function channelGlyph(raw: unknown, px: number) {
  const ch = String(raw ?? '').trim().toLowerCase();
  const box = { width: px, height: px, viewBox: '0 0 24 24', fill: '#ffffff' };
  if (ch === 'instagram') {
    return (
      <svg {...box}>
        {/* body and lens in one path, evenodd knocking the lens out, so the
            white never doubles up into a grey edge at this size */}
        <path fillRule="evenodd" clipRule="evenodd" d="M9.4 3h5.2l1.1 2H19a2.6 2.6 0 0 1 2.6 2.6v10.8A2.6 2.6 0 0 1 19 21H5a2.6 2.6 0 0 1-2.6-2.6V7.6A2.6 2.6 0 0 1 5 5h3.3l1.1-2zM12 8.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zm0 2.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z" />
      </svg>
    );
  }
  if (ch === 'zalo') {
    return (
      <svg width={px} height={px} viewBox="0 0 24 24">
        <text x="12" y="17.5" textAnchor="middle" fontSize="16" fontWeight="800" fill="#ffffff" fontFamily="system-ui, sans-serif">Z</text>
      </svg>
    );
  }
  if (ch === 'web') {
    return (
      <svg {...box}>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.3c.9 1 1.7 2.5 2.1 4.4H9.9c.4-1.9 1.2-3.4 2.1-4.4zM7.7 8.7c.4-1.8 1-3.3 1.9-4.4a7.8 7.8 0 0 0-4.2 4.4h2.3zm-.4 2.2H4.4a7.8 7.8 0 0 0 0 2.2h2.9a18 18 0 0 1 0-2.2zm2.2 0h5a16 16 0 0 1 0 2.2h-5a16 16 0 0 1 0-2.2zm7.2 0h2.9a7.8 7.8 0 0 1 0 2.2h-2.9a18 18 0 0 0 0-2.2zm-.8-2.2h2.3a7.8 7.8 0 0 0-4.2-4.4c.9 1.1 1.5 2.6 1.9 4.4zM9.9 15.1h4.2c-.4 1.9-1.2 3.4-2.1 4.4-.9-1-1.7-2.5-2.1-4.4zm-2.2 0H5.4a7.8 7.8 0 0 0 4.2 4.4c-.9-1.1-1.5-2.6-1.9-4.4zm8.6 0h2.3a7.8 7.8 0 0 1-4.2 4.4c.9-1.1 1.5-2.6 1.9-4.4z" />
      </svg>
    );
  }
  return (
    <svg {...box}>
      <path d="M12 2.6c-5.3 0-9.4 3.9-9.4 8.8 0 2.7 1.3 5.2 3.4 6.8v3.6l3.2-1.8c.9.2 1.8.4 2.8.4 5.3 0 9.4-3.9 9.4-8.8S17.3 2.6 12 2.6z" />
    </svg>
  );
}

/**
 * The OFFICIAL channel icon, when the shop's owner has put one in the app.
 *
 * We do not draw Meta's or Zalo's marks ourselves (see channelGlyph). The
 * owner may drop the icon files the platforms publish for exactly this use —
 * "this conversation came from Messenger" — into
 * public/icons/channels/{messenger,instagram,zalo}.png. When the file is
 * there it is used; when it is not, the first 404 is remembered for the whole
 * session and every badge falls back to the generic glyph without asking again.
 */
const missingOfficialIcon = new Set<string>();
function OfficialChannelIcon({ raw, size, fallback }: { raw: unknown; size: number; fallback: React.ReactNode }) {
  const key = channelOf(raw);
  const [failed, setFailed] = useState(() => key === 'web' || missingOfficialIcon.has(key));
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={`/icons/channels/${key}.png`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', flexShrink: 0 }}
      onError={() => { missingOfficialIcon.add(key); setFailed(true); }}
    />
  );
}

/** The channel's icon for chips, the rail and headers — the official file when
 *  present, the typographic mark when not. */
function ChannelIcon({ raw, size }: { raw: unknown; size: number }) {
  return <OfficialChannelIcon raw={raw} size={size} fallback={<span aria-hidden>{channelMark(raw)}</span>} />;
}

const Avatar = memo(function Avatar(
  { row, size = 34, token, vi, mark = true }: { row: InboxRow; size?: number; token: string | null; vi: boolean; mark?: boolean },
) {
  const c = pageColor(row.pageId);
  const src = `/messenger/threads/${row.id}/avatar`;
  // Already fetched? Then paint it on frame one. This is what removes the
  // flash; memo above is what removes the remount that caused it.
  const [pic, setPic] = useState<string | null>(() => apiImageCached(src) ?? null);

  useEffect(() => {
    if (!token) return;
    const cached = apiImageCached(src);
    if (cached !== undefined) { setPic(cached); return; }
    let gone = false;
    // The real Facebook picture, through our own endpoint so the Page token
    // stays on the server. Null is a normal answer - Meta withholds profiles
    // for a great many people - and then the initials stand.
    void apiImage(src, token).then((u) => { if (!gone) setPic(u); });
    return () => { gone = true; };
  }, [src, token]);

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
          fontSize: Math.round(size * 0.36), fontWeight: 600,
        }}>{initialsOf(displayName(row, vi))}</span>
      )}
      {/* THE MARK IS ONLY WORTH ITS INK WHEN IT DISTINGUISHES SOMETHING.
          A salon on one Page, with one channel, got this same little circle
          stamped on all thirteen rows - a second vertical stripe of identical
          dots running down a list, saying nothing that the channel filter
          above did not already say. It appears when the list actually mixes
          channels or Pages, and otherwise it does not. */}
      {mark && (() => {
        const brand = channelBrand(row.channel);
        const d = Math.round(size * 0.4);
        return (
          <span
            title={[brand.name, row.pageName].filter(Boolean).join(' · ')}
            aria-label={brand.name}
            style={{
              position: 'absolute', right: -2, bottom: -2,
              width: d, height: d, borderRadius: '50%',
              // The CHANNEL's colour fills it and the PAGE's colour rings it,
              // so one glance answers both "which app" and "which Page" —
              // neither of which the old grey ✉ answered.
              background: brand.bg,
              // ONE ring, in the colour behind the row. The badge used to carry
              // a second, wider ring in the Page's colour so it could answer
              // "which Page" too — two haloes round an 18px dot, on every row,
              // and the result read as clutter rather than as an answer. The
              // Page has a chip of its own when there is more than one; the
              // badge does one job.
              boxShadow: '0 0 0 2px var(--c0f172a)',
              // Clips a square official icon (Instagram) to the round badge.
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <OfficialChannelIcon
              raw={row.channel}
              size={d}
              fallback={<span style={{ fontSize: Math.max(7, Math.round(d * 0.5)), fontWeight: 700, lineHeight: 1, color: '#fff', letterSpacing: -0.2 }}>{channelLetter(row.channel)}</span>}
            />
          </span>
        );
      })()}
    </span>
  );
});

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
  // A LABEL NEVER BREAKS MID-WORD.
  //
  // These sit in flex rows, and a flex child shrinks by default. Add one more
  // button to a row and every label starts wrapping INSIDE the word - "Xon/g",
  // "Spa/m", "Take/over" - which reads as a broken screen rather than a full
  // one. nowrap says the text is indivisible; flexShrink:0 says so is the
  // button. What has to give instead is the row, and that is handled where
  // each row is laid out.
  whiteSpace: 'nowrap',
  flexShrink: 0,
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
  const [topRows, setRows] = useState<InboxRow[]>([]);
  /** Pages of older conversations the person asked for with "load more". The
   *  live list (first page, refreshed by the stream) sits on top; these follow.
   *  A conversation that wakes up moves into the live page and is dropped
   *  from here, so nothing is ever listed twice. */
  const [older, setOlder] = useState<InboxRow[]>([]);
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'end'>('idle');
  const rows = useMemo(() => {
    const ids = new Set(topRows.map((r) => r.id));
    return older.length ? [...topRows, ...older.filter((r) => !ids.has(r.id))] : topRows;
  }, [topRows, older]);
  /** Reply / internal note: two tabs of the one composer. */
  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply');
  const [allCanned, setAllCanned] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** The card's own width — the shell's sidebar takes 230px of the window,
   *  so the window's width says nothing about the room the four columns
   *  actually have. Three tiers: the mockup's widths, a tighter four-column
   *  set, and two columns (rail folded into the list, customer panel behind
   *  the ⓘ button) for an iPad or a half-screen window. */
  const [cardW, setCardW] = useState(1400);
  const wide = cardW >= 1200;
  const compact = cardW < 1040;
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Chat turns: the team, my own Available/Away, and whether turns are on. */
  const [turns, setTurns] = useState<TurnsView | null>(null);
  const loadTurns = useCallback(async () => {
    if (!token) return;
    try { setTurns(await apiFetch<TurnsView>('/messenger/turns', { token })); } catch { /* the inbox works without it */ }
  }, [token]);
  useEffect(() => {
    void loadTurns();
    const id = window.setInterval(() => { void loadTurns(); }, 60_000);
    return () => window.clearInterval(id);
  }, [loadTurns]);
  const turnsOn = turns?.settings.mode === 'round-robin';
  const myStatus = turns?.me?.status ?? 'available';
  async function toggleMyStatus() {
    if (!token) return;
    const next = myStatus === 'available' ? 'away' : 'available';
    try {
      await apiFetch('/messenger/turns/status', { method: 'POST', token, body: { status: next } });
      await loadTurns();
    } catch (e) { setErr(String(e)); }
  }
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
  /** The scrolling message pane itself, so we can ask where the reader is. */
  const paneRef = useRef<HTMLDivElement | null>(null);
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
      const next = Array.isArray(r) ? r : [];
      // Nothing new -> nothing repaints. See `same` and `keepRows` above: this
      // is the difference between a list that sits still and one that blinks
      // twice a minute for no reason anybody can see.
      setRows((cur) => keepRows(cur, next));
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

  /**
   * Every conversation already seen, kept for the session.
   *
   * Switching rows used to wait for a server round trip before the pane
   * changed at all — the old customer stayed on screen for most of a second
   * after the click, which reads as "slow". Now a conversation seen before
   * paints from memory on the click and is refreshed underneath; one never
   * seen paints its header from the list row at once, with the messages
   * following. Hovering a row fetches it ahead of the click.
   */
  const threadCache = useRef(new Map<string, ThreadDetail>());
  const prefetching = useRef(new Set<string>());
  const remember = useCallback((d: ThreadDetail) => {
    const m = threadCache.current;
    m.delete(d.id);
    m.set(d.id, d);
    // Newest last; forty conversations is plenty and bounds the memory.
    while (m.size > 40) { const k = m.keys().next().value; if (k === undefined) break; m.delete(k); }
  }, []);
  const rowsRef = useRef<InboxRow[]>([]);
  rowsRef.current = rows;
  const prefetchThread = useCallback((id: string) => {
    if (!token || threadCache.current.has(id) || prefetching.current.has(id)) return;
    prefetching.current.add(id);
    void apiFetch<ThreadDetail>(`/messenger/threads/${id}?full=0`, { token })
      .then((d) => { if (!threadCache.current.has(id)) remember(d); })
      .catch(() => undefined)
      .finally(() => prefetching.current.delete(id));
  }, [token, remember]);

  const loadThread = useCallback(async (id: string, markRead = true, background = false) => {
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
      //
      // THE FAST PASS IS FOR A CLICK, NOT FOR A REFRESH.
      //
      // `?full=0` answers from our own database with a twelve-turn buffer. That
      // is exactly right when somebody has just clicked a row and there is
      // nothing on screen yet. It is exactly wrong on a background refresh of a
      // conversation already open: the full Meta transcript on screen would be
      // REPLACED by the short buffer for a moment and then grow back - messages
      // visibly vanishing and returning. That is the other half of the blink,
      // and the half that happens in the middle of reading a customer.
      if (!background) {
        const cached = threadCache.current.get(id);
        if (cached) {
          // Seen before: the pane changes on the click.
          setDetail((cur) => (cur && cur.id === id ? cur : cached));
        } else {
          // Never seen: switch the header now from the list row, so the old
          // customer is not left on screen while the messages load.
          const row = rowsRef.current.find((r) => r.id === id);
          if (row) setDetail((cur) => (cur && cur.id === id ? cur : { ...row, history: [], historySource: 'partial', customer: null }));
          const quick = await apiFetch<ThreadDetail>(`/messenger/threads/${id}?full=0`, { token });
          remember(quick);
          // Same rule as the list: only write when it differs.
          if (openRef.current === id) setDetail((cur) => (cur && same(cur, quick) ? cur : quick));
        }
      }
      // Reading is a person's act, not the page's.
      //
      // The inbox opens the top conversation by itself so three columns are not
      // blank — but spending its unread mark for it would be the page claiming
      // somebody looked. `markRead: false` on that one path keeps the blue mark
      // until a human clicks the row.
      if (markRead) void apiFetch(`/messenger/threads/${id}/read`, { method: 'POST', token }).catch(() => undefined);
      const fullD = await apiFetch<ThreadDetail>(`/messenger/threads/${id}`, { token });
      remember(fullD);
      if (openRef.current === id) setDetail((cur) => (cur && same(cur, fullD) ? cur : fullD));
    } catch (e) { setErr(String(e)); }
  }, [token, remember]);

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

  // Tell the shell's alert engine which conversation is on screen, so it does
  // not chime for the message the person is reading as it arrives.
  useEffect(() => {
    setOpenConversation(openId);
    return () => setOpenConversation(null);
  }, [openId]);

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
      if (openRef.current) void loadThread(openRef.current, keepUnreadRef.current !== openRef.current, true);
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

  /**
   * Follow the conversation down - unless the reader has gone up.
   *
   * It used to jump to the newest message every time the history length
   * changed. Open a conversation, scroll up to check what was quoted last
   * week, and the next arriving message throws you back to the bottom
   * mid-sentence. Messenger does not do that, and neither should this.
   *
   * Opening a DIFFERENT conversation always lands at the bottom, because that
   * is where a conversation starts being read.
   */
  const atBottomRef = useRef(true);
  useEffect(() => {
    const pane = paneRef.current;
    const stick = !pane || atBottomRef.current;
    if (stick) endRef.current?.scrollIntoView({ block: 'end' });
  }, [detail?.history?.length]);
  useEffect(() => {
    // A new conversation: forget where the reader was in the last one.
    atBottomRef.current = true;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [detail?.id]);

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
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => { const w = entries[0]?.contentRect.width; if (w) setCardW(Math.round(w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const measure = () => {
      if (narrow) window.scrollTo(0, 0);
      const top = cardRef.current?.getBoundingClientRect().top ?? 0;
      // The phone shell pins a tab bar to the bottom of the window. A card
      // that reaches the bottom edge puts its composer UNDER that bar — the
      // send button rendered and unreachable. Whatever fixed bar sits at the
      // bottom is measured and subtracted; the staff portal has none.
      const bar = narrow
        ? Array.from(document.querySelectorAll('nav')).find((n) => { const cs = getComputedStyle(n); return cs.position === 'fixed' && cs.bottom === '0px'; })
        : null;
      const gap = (narrow ? 8 : 16) + (bar ? bar.getBoundingClientRect().height : 0);
      setCardH(`calc(100dvh - ${Math.max(0, Math.round(top))}px - ${Math.round(gap)}px)`);
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

  /** Give the open conversation to someone (or to nobody). */
  async function assignTo(userId: string) {
    if (!openId || !token) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/messenger/threads/${openId}/assign`, { method: 'POST', token, body: { userId: userId || null } });
      await Promise.all([loadList(), loadThread(openId), loadTurns()]);
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
  // THE BADGE IS NOT CONDITIONAL ANY MORE, AND THE OLD REASONING WAS WRONG.
  //
  // It used to appear only when the list actually mixed channels, on the
  // argument that thirteen identical marks say nothing. That is true of a
  // LABEL, which costs a row its width. It is not true of a badge on a picture
  // that is already there: it costs nothing, and its absence is not "no news",
  // it is a blank where a person expected an answer. Somebody scanning an
  // inbox does not first work out whether this inbox happens to mix channels;
  // they look at the row and expect it to say where the message came from.
  // Messenger, Instagram, Zalo and the website all land in one list, and which
  // one decides the rules — a 24-hour window, a 7-day window, or none at all.
  const sorted = sortRows(filterRows(rows, { filter, source, channel: 'any', query, meId: me, labelId }));
  const unreadCount = rows.filter((r) => r.unread && !isSpamRow(r)).length;
  /** How many conversations are in the bin. Drives whether the chip exists. */
  const junkCount = spamCount(rows);

  /** The next hundred conversations older than the oldest one on screen. */
  async function loadMore() {
    if (!token || moreState === 'loading') return;
    const oldest = rows.reduce<string | null>((m, r) => (!m || r.updatedAt < m ? r.updatedAt : m), null);
    if (!oldest) return;
    setMoreState('loading');
    try {
      const r = await apiFetch<InboxRow[]>(`/messenger/threads?before=${encodeURIComponent(oldest)}&take=100`, { token });
      const page = Array.isArray(r) ? r : [];
      setOlder((cur) => { const seen = new Set(cur.map((x) => x.id)); return [...cur, ...page.filter((x) => !seen.has(x.id))]; });
      setMoreState(page.length < 100 ? 'end' : 'idle');
    } catch (e) { setErr(String(e)); setMoreState('idle'); }
  }

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

  const pill = (tone: string, text: string) => (
    <span style={{ background: TONE[tone].bg, color: TONE[tone].fg, borderRadius: 999, padding: '2px 8px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
  );

  // ─── The list, in the order the mockup draws it ──────────────────────────
  // "Đang chờ người thật" first, longest wait on top; everything else after,
  // newest first. Sorting by WORK, not by channel — the channel is a filter on
  // the left, never the order of the queue.
  const waitingRows = sorted.filter((r) => stateOf(r) === 'unclaimed').sort((a, b) => (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0));
  const restRows = sorted.filter((r) => stateOf(r) !== 'unclaimed');
  const pageNames = new Set(rows.map((r) => String(r.pageName ?? '').trim()).filter(Boolean));
  const activeSource = sources.find((s) => s.key === source) ?? null;
  const filterName = (f: InboxFilter) => ({
    all: vi ? 'Tất cả' : 'All', waiting: wide ? (vi ? 'Đang chờ người thật' : 'Waiting for a person') : (vi ? 'Đang chờ' : 'Waiting'), unread: vi ? 'Chưa đọc' : 'Unread',
    mine: vi ? 'Giao cho tôi' : 'Assigned to me', followup: vi ? 'Cần theo dõi' : 'Follow-up', spam: 'Spam',
  })[f];
  /** The ONE chip a row carries. Waiting › follow-up › held › done — never two. */
  const rowChip = (r: InboxRow) => {
    const st = stateOf(r);
    if (st === 'unclaimed') {
      const w = r.waitingMinutes ?? 0;
      const long = w >= 60;
      const txt = w >= 60 ? (vi ? `chờ ${Math.floor(w / 60)} giờ${w % 60 ? ` ${w % 60} phút` : ''}` : `waiting ${Math.floor(w / 60)}h${w % 60 ? ` ${w % 60}m` : ''}`) : (vi ? `chờ ${w} phút` : `waiting ${w} min`);
      return <span style={{ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', background: long ? 'var(--wash-red)' : 'var(--wash-amber-3)', color: long ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>{txt}</span>;
    }
    const fu = followUpState(r.followUpAt);
    if (fu !== 'none') {
      return <span style={{ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', background: fu === 'overdue' ? 'var(--wash-red)' : 'var(--c1e1b4b)', color: fu === 'overdue' ? 'var(--ink-bad)' : 'var(--ca5b4fc)' }}>⏰ {followUpLabel(r.followUpAt, new Date())}</span>;
    }
    if (st === 'human') return <span style={{ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', background: 'var(--c14532d)', color: 'var(--c86efac)' }}>{r.assignedName ? (vi ? `${r.assignedName} giữ` : `${r.assignedName} holding`) : (vi ? 'người thật giữ' : 'a person holds it')}</span>;
    if (st === 'done') return <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>✓ {vi ? 'đã xong' : 'done'}</span>;
    return <span style={{ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', background: 'var(--c14532d)', color: 'var(--c86efac)' }}>{vi ? 'bot đang xử lý' : 'bot handling'}</span>;
  };

  const rowView = (r: InboxRow) => {
    const on = r.id === openId;
    return (
      <button key={r.id} onClick={() => { keepUnreadRef.current = null; setOpenId(r.id); void loadThread(r.id); }}
        onMouseEnter={() => prefetchThread(r.id)} onTouchStart={() => prefetchThread(r.id)}
        aria-current={on ? 'true' : undefined}
        style={{ boxSizing: 'border-box', width: narrow ? '100%' : 'calc(100% - 12px)', margin: narrow ? '0 0 6px' : '0 6px 2px', textAlign: 'left', display: 'flex', gap: 10, cursor: 'pointer', flexShrink: 0,
          background: on ? 'var(--row-on)' : (narrow ? 'var(--c0f172a)' : 'transparent'),
          boxShadow: on ? 'inset 0 0 0 1.5px #6366f1' : (narrow ? 'inset 0 0 0 1px var(--line)' : 'none'),
          border: 'none', borderRadius: narrow ? 14 : 12, padding: narrow ? '12px' : '10px 12px 10px 10px', fontFamily: 'inherit', color: 'var(--cf1f5f9)' }}>
        <Avatar row={r} size={44} token={token} vi={vi} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 14.5, fontWeight: r.unread ? 700 : 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>{displayName(r, vi)}</span>
            <span title={fmtInTz(r.lastMessageAt || r.updatedAt, { dateStyle: 'full', timeStyle: 'short' })} style={{ fontSize: 11.5, color: 'var(--c64748b)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{listStampLabel(r.lastMessageAt || r.updatedAt, vi)}</span>
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.4, color: r.unread ? 'var(--ccbd5e1)' : 'var(--c94a3b8)', fontWeight: r.unread ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.lastText || (vi ? '(chưa có tin nhắn)' : '(no message yet)')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, minWidth: 0 }}>
            <span style={{ color: 'var(--c64748b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {pageNames.size > 1 && r.pageName ? r.pageName : channelBrand(r.channel).name}
              {(r.labels ?? []).slice(0, 2).map((l) => <span key={l.id} style={{ marginLeft: 6, color: l.color, fontWeight: 600 }}>● {l.name}</span>)}
            </span>
            <span style={{ flex: 1 }} />
            {rowChip(r)}
            {r.unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4f46e5', flexShrink: 0 }} aria-label={vi ? 'Chưa đọc' : 'Unread'} />}
          </span>
        </span>
      </button>
    );
  };

  const sectionHead = (text: string, tone: 'warn' | 'muted' = 'muted') => (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: tone === 'warn' ? 'var(--ink-warn)' : 'var(--c64748b)', padding: narrow ? '6px 4px 4px' : '10px 14px 4px', textTransform: 'uppercase', flexShrink: 0 }}>{text}</span>
  );

  const railItem = (key: InboxFilter, icon: React.ReactNode, count: React.ReactNode) => {
    const on = filter === key;
    return (
      <button key={key} onClick={() => setFilter(key)} style={{ height: 36, boxSizing: 'border-box', padding: '0 10px', borderRadius: 9, border: 'none', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        background: on ? 'var(--c1e1b4b)' : 'transparent', color: on ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)', fontSize: 13.5, fontWeight: on ? 700 : 500 }}>
        <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', color: on ? 'var(--ca5b4fc)' : 'var(--c94a3b8)' }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filterName(key)}</span>
        {count}
      </button>
    );
  };
  const railCount = (n: number) => <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{n}</span>;
  const hotCount = (n: number) => <span style={{ minWidth: 22, height: 20, padding: '0 6px', borderRadius: 999, background: '#d97706', color: '#fff', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>;
  const svg = (d: React.ReactNode, w = 2) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

  // ─── The views + channels column (desktop) ────────────────────────────────
  const rail = (
    <div style={{ boxSizing: 'border-box', padding: '12px 8px', borderRight: '1px solid var(--line)', background: 'var(--c0b1220)', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0 }}>
      {sectionHead(vi ? 'Hộp thư' : 'Inbox')}
      {railItem('all', svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-7A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1z" /></>), railCount(rows.filter((r) => !isSpamRow(r)).length))}
      {railItem('waiting', svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, 2.2), waiting > 0 ? hotCount(waiting) : railCount(0))}
      {railItem('unread', svg(<circle cx="12" cy="12" r="4" />), railCount(unreadCount))}
      {railItem('mine', svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>), railCount(rows.filter((r) => r.assignedUserId && r.assignedUserId === me && !isSpamRow(r)).length))}
      {railItem('followup', svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>), (
        <span style={{ fontSize: 12, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{rows.filter((r) => followUpState(r.followUpAt) !== 'none' && !isSpamRow(r)).length}{dueCount > 0 && <> · <span style={{ color: 'var(--ink-bad)', fontWeight: 700 }}>{dueCount} {vi ? 'tới hạn' : 'due'}</span></>}</span>
      ))}
      {(junkCount > 0 || filter === 'spam') && railItem('spam', svg(<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>), railCount(junkCount))}

      {sectionHead(vi ? 'Kênh · tài khoản' : 'Channel · account')}
      <button onClick={() => setSource('any')} style={{ height: 34, boxSizing: 'border-box', padding: '0 10px', borderRadius: 9, border: 'none', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        background: source === 'any' ? 'var(--c1e1b4b)' : 'transparent', color: source === 'any' ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)', fontSize: 13, fontWeight: source === 'any' ? 700 : 500 }}>
        <span style={{ display: 'flex', width: 24, justifyContent: 'center' }}>{svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>)}</span>
        <span style={{ flex: 1 }}>{vi ? 'Tất cả kênh' : 'All channels'}</span>
      </button>
      {sources.map((src) => {
        const on = source === src.key;
        const brand = channelBrand(src.channel);
        const total = rows.filter((r) => `${r.pageId ?? ''}|${channelOf(r.channel)}` === src.key && !isSpamRow(r)).length;
        return (
          <button key={src.key} onClick={() => setSource(on ? 'any' : src.key)} title={src.label} style={{ height: 44, boxSizing: 'border-box', padding: '0 10px', borderRadius: 9, border: 'none', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            background: on ? 'var(--c1e1b4b)' : 'transparent', color: 'var(--ce2e8f0)' }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, ...onHue(brand.bg) }}>{channelLetter(src.channel)}</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: on ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>{src.label}</span>
              <span style={{ fontSize: 11, color: 'var(--c64748b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand.name}{channelOf(src.channel) === 'messenger' ? ' · Fanpage' : channelOf(src.channel) === 'zalo' ? ' · Official Account' : ''}</span>
            </span>
            {src.waiting > 0 ? hotCount(src.waiting) : <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{total}</span>}
          </button>
        );
      })}
      {inSalonPortal() && (
        <a href="/salon/channels" style={{ height: 38, marginTop: 6, boxSizing: 'border-box', padding: '0 10px', borderRadius: 9, border: '1px dashed var(--c334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none', color: 'var(--ca5b4fc)', fontSize: 13, fontWeight: 600 }}>＋ {vi ? 'Kết nối kênh mới' : 'Connect a channel'}</a>
      )}

      <span style={{ flex: 1 }} />
      <div style={{ marginBottom: 8 }}><PushSetup compact /></div>
      {turns && (
        <div style={{ boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: turns.settings.botFirst ? '#16a34a' : 'var(--c64748b)', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{turns.settings.botFirst ? (vi ? 'Bot trả lời trước' : 'Bot answers first') : (vi ? 'Người thật trả lời trước' : 'People answer first')}</span>
              <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>{turns.settings.botFirst ? (vi ? 'bàn giao khi khách cần người thật' : 'hands over when a person is needed') : (vi ? 'bot chỉ phụ' : 'the bot only assists')}</span>
            </span>
          </div>
          {turnsOn && turns.me && (
            <button onClick={() => void toggleMyStatus()} style={{ height: 32, borderRadius: 9, border: `1px solid ${myStatus === 'available' ? '#22c55e' : 'var(--c334155)'}`, background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: myStatus === 'available' ? '#22c55e' : 'var(--c64748b)' }} />
              {myStatus === 'available' ? (vi ? 'Đang nhận khách · tạm vắng' : 'Taking turns · go away') : (vi ? 'Đang vắng · nhận lại' : 'Away · take turns')}
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ─── The queue ─────────────────────────────────────────────────────────────
  const list = (
    <div style={{ borderRight: narrow ? 'none' : '1px solid var(--line)', flexDirection: 'column', minWidth: 0, minHeight: 0, background: narrow ? 'var(--c0b1120)' : 'var(--c0f172a)',
      display: (narrow && openId) ? 'none' : 'flex', ...(narrow ? { flex: '1 1 0%' } : {}) }}>
      <div style={{ boxSizing: 'border-box', padding: narrow ? '12px 16px 10px' : '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
        {narrow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, flex: 1, letterSpacing: -0.2, color: 'var(--cf1f5f9)' }}>{vi ? 'Hộp thư' : 'Inbox'}</span>
            {waiting > 0 && <span style={{ height: 26, padding: '0 9px', borderRadius: 999, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{waiting} {vi ? 'đang chờ' : 'waiting'}</span>}
            {unreadCount > 0 && (
              <button onClick={() => void markAllRead()} disabled={busy} aria-label={vi ? 'Đánh dấu đã đọc tất cả' : 'Mark all read'} title={vi ? `Đánh dấu đã đọc tất cả (${unreadCount})` : `Mark all read (${unreadCount})`}
                style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 14, cursor: 'pointer' }}>✓✓</button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1, minWidth: 0, height: narrow ? 42 : 38, boxSizing: 'border-box', padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: narrow ? 'var(--c0f172a)' : 'var(--c0b1220)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c64748b)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={vi ? 'Tìm khách' : 'Search'}
              placeholder={vi ? 'Tìm tên, số điện thoại, nội dung…' : 'Search name, phone, message…'}
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: narrow ? 16 : 13.5, color: 'var(--ce2e8f0)', fontFamily: 'inherit' }} />
          </label>
          {!narrow && unreadCount > 0 && (
            <button onClick={() => void markAllRead()} disabled={busy} aria-label={vi ? 'Đánh dấu đã đọc tất cả' : 'Mark all read'} title={vi ? `Đánh dấu đã đọc tất cả (${unreadCount})` : `Mark all read (${unreadCount})`}
              style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>✓✓</button>
          )}
        </div>
        {(narrow || compact) ? (
          <div className="no-bar" style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {(['waiting', 'all', 'unread', 'mine', 'followup', ...((junkCount > 0 || filter === 'spam') ? ['spam'] : [])] as InboxFilter[]).map((f) => {
              const on = filter === f;
              const n = f === 'waiting' ? waiting : f === 'all' ? rows.filter((r) => !isSpamRow(r)).length : f === 'unread' ? unreadCount : f === 'mine' ? rows.filter((r) => r.assignedUserId === me).length : f === 'followup' ? dueCount : junkCount;
              return (
                <button key={f} onClick={() => setFilter(f)} style={on
                  ? { flexShrink: 0, height: 34, padding: '0 12px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#4f46e5', color: '#fff' }
                  : { flexShrink: 0, height: 34, padding: '0 12px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {f === 'waiting' ? (vi ? 'Đang chờ' : 'Waiting') : f === 'followup' ? (vi ? 'Theo dõi' : 'Follow-up') : f === 'mine' ? (vi ? 'Của tôi' : 'Mine') : filterName(f)} · {n}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c94a3b8)', minWidth: 0 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vi ? 'Đang xem:' : 'Viewing:'} <strong style={{ color: 'var(--ca5b4fc)' }}>{filterName(filter)}</strong> · {activeSource ? activeSource.label : (vi ? 'tất cả kênh' : 'all channels')}</span>
          </div>
        )}
        {(narrow || compact) && sources.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c94a3b8)' }}>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={vi ? 'Kênh' : 'Channel'} style={{ ...ui.input, width: 'auto', maxWidth: 220, padding: '6px 8px', fontSize: 12.5, borderRadius: 999 }}>
              <option value="any">{vi ? `Tất cả kênh · ${sources.length} tài khoản` : `All channels · ${sources.length} accounts`}</option>
              {sources.map((s) => <option key={s.key} value={s.key}>{channelBrand(s.channel).name} · {s.label}{s.waiting ? ` · ${s.waiting} ${vi ? 'chờ' : 'waiting'}` : ''}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            {turns && <span style={{ color: turns.settings.botFirst ? 'var(--ink-good)' : 'var(--c64748b)', fontWeight: 600, whiteSpace: 'nowrap' }}>● {turns.settings.botFirst ? (vi ? 'Bot đang bật' : 'Bot on') : (vi ? 'Bot chỉ phụ' : 'Bot assists')}</span>}
          </div>
        )}
        {(narrow || compact) && <PushSetup compact />}
        {labels.length > 0 && !narrow && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {labels.map((l) => (
              <button key={l.id} onClick={() => setLabelId(labelId === l.id ? null : l.id)}
                style={{ border: `1px solid ${labelId === l.id ? l.color : 'var(--c334155)'}`, background: labelId === l.id ? l.color : 'transparent', color: labelId === l.id ? '#fff' : 'var(--c94a3b8)', borderRadius: 999, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>{l.name}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: narrow ? '6px 10px' : '0 0 8px' }}>
        {listErr && (
          <div style={{ margin: 10, padding: '9px 11px', borderRadius: 8, background: 'var(--wash-red)', border: '1px solid var(--c7f1d1d)' }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--ink-bad)', fontWeight: 600 }}>{vi ? 'Không tải được danh sách hội thoại' : 'Could not load conversations'}</p>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--ink-bad)', wordBreak: 'break-word' }}>{listErr}</p>
            <button onClick={() => void loadList()} style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px' }}>{vi ? 'Thử lại' : 'Retry'}</button>
          </div>
        )}
        {!loaded && !listErr && (
          <div aria-busy="true" aria-label={vi ? 'Đang tải hội thoại' : 'Loading conversations'}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 12px', margin: '0 8px 2px', opacity: 1 - i * 0.25 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--c1e293b)', flexShrink: 0 }} />
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
        {waitingRows.length > 0 && sectionHead(vi ? `Đang chờ người thật · ${waitingRows.length}` : `Waiting for a person · ${waitingRows.length}`, 'warn')}
        {waitingRows.map(rowView)}
        {restRows.length > 0 && filter !== 'waiting' && sectionHead(waitingRows.length ? (vi ? `Còn lại · ${restRows.length}` : `Everything else · ${restRows.length}`) : (vi ? `${restRows.length} hội thoại` : `${restRows.length} conversations`))}
        {filter !== 'waiting' && restRows.map(rowView)}
        {loaded && rows.length >= 100 && moreState !== 'end' && (
          <button onClick={() => void loadMore()} disabled={moreState === 'loading'} style={{ margin: narrow ? '6px 0 12px' : '8px 12px 4px', height: 38, flexShrink: 0, borderRadius: 10, border: '1px dashed var(--c334155)', background: 'transparent', color: 'var(--ca5b4fc)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {moreState === 'loading' ? (vi ? 'Đang tải…' : 'Loading…') : (vi ? 'Tải thêm hội thoại cũ hơn' : 'Load older conversations')}
          </button>
        )}
        {moreState === 'end' && rows.length > 0 && <span style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--c64748b)', padding: '8px 0 12px' }}>{vi ? 'Đã hiện toàn bộ hội thoại.' : 'That is every conversation.'}</span>}
      </div>
    </div>
  );

  // ─── The conversation ──────────────────────────────────────────────────────
  const noticeTone = notice.tone ?? (notice.blocked ? 'red' : 'amber');
  const suggestions = (detail?.canned ?? []).slice(0, 3);
  const thread = (
    <div style={{ flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--c0b1120)',
      display: (narrow && (!openId || showInfo)) ? 'none' : 'flex', ...(narrow ? { flex: '1 1 0%' } : {}) }}>
      {!detail && !openId && !loaded && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c64748b)', fontSize: 13 }}>{vi ? 'Đang tải hộp thư…' : 'Loading the inbox…'}</div>
      )}
      {!detail && openId && (
        <div aria-busy="true" aria-label={vi ? 'Đang mở hội thoại' : 'Opening the conversation'} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--c1e293b)', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 10, width: '35%', borderRadius: 4, background: 'var(--c1e293b)' }} />
              <div style={{ height: 8, width: '55%', borderRadius: 4, background: 'var(--c1e293b)' }} />
            </div>
          </div>
          <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'flex-end' }}>
            {[{ w: '62%', mine: false }, { w: '48%', mine: true }, { w: '70%', mine: false }].map((b, i) => (
              <div key={i} style={{ alignSelf: b.mine ? 'flex-end' : 'flex-start', width: b.w, height: 40, borderRadius: 16, background: 'var(--c1e293b)', opacity: 0.85 - i * 0.18 }} />
            ))}
          </div>
        </div>
      )}
      {!detail && !openId && loaded && (() => {
        const oldest = rows.filter((r) => stateOf(r) === 'unclaimed').reduce((m, r) => Math.max(m, r.waitingMinutes ?? 0), 0);
        const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}p` : ''}` : `${n} ${vi ? 'phút' : 'min'}`);
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Box n={waiting} label={vi ? 'khách đang chờ' : 'waiting for a reply'} tone={waiting > 0 ? 'alarm' : 'calm'} sub={waiting > 0 ? (vi ? `lâu nhất ${mins(oldest)}` : `longest ${mins(oldest)}`) : (vi ? 'không ai phải đợi' : 'nobody is waiting')} />
              <Box n={dueCount} label={vi ? 'cần theo dõi hôm nay' : 'follow-ups due'} tone={dueCount > 0 ? 'warn' : 'calm'} sub={vi ? 'đã hẹn quay lại' : 'you said you would come back'} />
              <Box n={unreadCount} label={vi ? 'chưa đọc' : 'unread'} tone="calm" sub={vi ? 'trong toàn bộ hộp thư' : 'across the inbox'} />
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c64748b)', textAlign: 'center', lineHeight: 1.6, maxWidth: 380 }}>
              {waiting > 0 ? (vi ? 'Bấm "Đang chờ người thật" bên trái để xem đúng những người này trước.' : 'Tap “Waiting for a person” on the left to see exactly those first.')
                : rows.length === 0 ? (vi ? 'Chưa có hội thoại nào. Khi khách nhắn vào Page hoặc Instagram, hội thoại sẽ mở sẵn ở đây.' : 'No conversations yet. When a customer writes to the Page or Instagram, the conversation opens here.')
                : (vi ? 'Không có hội thoại nào khớp bộ lọc bên trái.' : 'Nothing matches the filters on the left.')}
            </p>
          </div>
        );
      })()}

      {detail && (() => {
        const since = detail.lastCustomerAt ? sinceLabel(detail.lastCustomerAt as string, vi) : null;
        const stateText = state === 'unclaimed' ? (vi ? 'đang chờ người thật' : 'waiting for a person') : state === 'human' ? (detail.assignedName ? (vi ? `${detail.assignedName} đang giữ` : `${detail.assignedName} is holding`) : (vi ? 'người thật giữ' : 'a person holds it')) : state === 'done' ? (vi ? 'đã xong' : 'done') : (vi ? 'bot đang trả lời' : 'bot is replying');
        const mineTurn = detail.assignedUserId === turns?.me?.userId;
        const mayAssign = !!turns && (turns.canEdit || !detail.assignedUserId || mineTurn);
        const assigned = turns?.agents.find((a) => a.userId === detail.assignedUserId)?.name ?? detail.assignedName ?? null;
        const botButton = (
          (state === 'human' || state === 'unclaimed')
              ? <button disabled={busy} onClick={() => void act('handoff', { handoff: false })} title={vi ? 'Để bot trả lời lại' : 'Let the bot reply again'}
                  style={{ height: narrow ? 30 : 36, padding: narrow ? '0 10px' : '0 12px', borderRadius: narrow ? 999 : 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: narrow ? 12 : 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c64748b)' }} />{(narrow || !wide) ? (vi ? 'Trả bot' : 'To bot') : (vi ? 'Bot: tắt · trả bot' : 'Bot: off · hand back')}
                </button>
              : <button disabled={busy} onClick={() => void act('handoff', { handoff: true })} title={vi ? 'Tôi nhận — bot ngừng trả lời' : 'Take over — the bot stops replying'}
                  style={wnotice?.kind === 'needs-takeover'
                    ? { height: narrow ? 30 : 36, padding: '0 12px', borderRadius: narrow ? 999 : 10, border: 'none', fontSize: narrow ? 12 : 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', flexShrink: 0, background: '#4f46e5', color: '#fff' }
                    : { height: narrow ? 30 : 36, padding: narrow ? '0 10px' : '0 12px', borderRadius: narrow ? 999 : 10, border: '1px solid #16a34a', background: 'var(--c14532d)', color: 'var(--c86efac)', fontSize: narrow ? 12 : 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {wnotice?.kind !== 'needs-takeover' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a' }} />}
                  {wnotice?.kind === 'needs-takeover' ? (vi ? 'Tôi nhận' : 'Take over') : (narrow || !wide) ? (vi ? 'Bot: bật' : 'Bot: on') : (vi ? 'Bot: đang bật · tôi nhận' : 'Bot: on · take over')}
                </button>
        );
        return (<>
          <div style={{ flexShrink: 0, boxSizing: 'border-box', padding: narrow ? '10px 12px 10px 6px' : '0 18px', minHeight: narrow ? 60 : 64, display: 'flex', alignItems: 'center', gap: narrow ? 8 : 12, background: 'var(--c0f172a)', borderBottom: '1px solid var(--line)' }}>
            {narrow && (
              <button onClick={() => { setOpenId(null); setDetail(null); setShowInfo(false); }} aria-label={vi ? 'Quay lại danh sách' : 'Back to list'}
                style={{ width: 40, height: 40, borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
            )}
            <Avatar row={detail} size={40} token={token} vi={vi} />
            <div onClick={() => (narrow ? setShowInfo(true) : void renameThread())} title={narrow ? (vi ? 'Thông tin khách' : 'Customer info') : (vi ? 'Bấm để đặt tên khách' : 'Click to set the name')}
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25, cursor: 'pointer' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName(detail, vi)}{!detail.senderName && !narrow && <span style={{ color: 'var(--c64748b)', fontWeight: 400, fontSize: 12 }}> ✎</span>}{narrow && <span style={{ color: 'var(--c64748b)', fontWeight: 500 }}> ›</span>}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {channelBrand(detail.channel).name}{detail.pageName ? <> · <strong style={{ color: 'var(--ccbd5e1)', fontWeight: 600 }}>{detail.pageName}</strong></> : null}
                {since && <> · {vi ? 'khách nhắn' : 'wrote'} <strong style={{ color: state === 'unclaimed' ? 'var(--ink-warn)' : 'var(--ccbd5e1)', fontWeight: 600 }}>{since}</strong></>}
                {!narrow && <> · {stateText}</>}
              </span>
            </div>
            {!narrow && wide && turns && turns.agents.length > 0 && (
              <select value={detail.assignedUserId ?? ''} disabled={busy || !mayAssign} onChange={(e) => void assignTo(e.target.value)} aria-label={vi ? 'Giao cho' : 'Assign to'} title={vi ? 'Người phụ trách hội thoại này' : 'Who follows up this conversation'}
                style={{ ...ui.input, width: 'auto', maxWidth: 170, height: 36, padding: '0 10px', fontSize: 13, fontWeight: 600, borderRadius: 10 }}>
                <option value="">{vi ? 'Chưa giao' : 'Unassigned'}</option>
                {turns.agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}{a.userId === turns.me?.userId ? (vi ? ' (tôi)' : ' (me)') : ''}{turnsOn && !a.onDuty ? (vi ? ' · vắng' : ' · away') : ''}</option>)}
              </select>
            )}
            {!narrow && botButton}
            {!isSpamRow(detail) && (state !== 'done'
              ? <button disabled={busy} onClick={() => void act('status', { status: 'done' })} style={{ height: 36, padding: '0 14px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, background: '#4f46e5', color: '#fff' }}>✓ {vi ? 'Xong' : 'Done'}</button>
              : <button disabled={busy} onClick={() => void act('status', { status: 'open' })} style={{ height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>{vi ? 'Mở lại' : 'Reopen'}</button>)}
            {compact && !narrow && (
              <button onClick={() => setShowInfo((v) => !v)} aria-label={vi ? 'Thông tin khách' : 'Customer info'} aria-pressed={showInfo}
                style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${showInfo ? '#6366f1' : 'var(--c334155)'}`, background: showInfo ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: showInfo ? 'var(--ca5b4fc)' : 'var(--ccbd5e1)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>ⓘ</button>
            )}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button onClick={() => setMoreOpen((o) => !o)} aria-label={vi ? 'Thêm' : 'More'} aria-expanded={moreOpen}
                style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>
              {moreOpen && (
                <div style={{ position: 'absolute', right: 0, top: 40, zIndex: 20, minWidth: 200, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, boxShadow: '0 12px 30px -12px rgba(15,42,82,.45)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[
                    { k: 'unread', label: `● ${vi ? 'Để lại chưa đọc' : 'Mark unread'}`, run: () => markUnread(detail.id) },
                    { k: 'rename', label: `✎ ${vi ? 'Đặt tên khách' : 'Set customer name'}`, run: () => renameThread() },
                    ...(isSpamRow(detail)
                      ? [{ k: 'unspam', label: vi ? 'Không phải spam' : 'Not spam', run: () => act('status', { status: 'open' }) }]
                      : [{ k: 'spam', label: `⊘ ${vi ? 'Chuyển vào Spam' : 'Move to Spam'}`, run: () => act('status', { status: 'spam' }) }]),
                  ].map((m) => (
                    <button key={m.k} disabled={busy} onClick={() => { setMoreOpen(false); void m.run(); }}
                      style={{ height: 36, padding: '0 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{m.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {narrow && (
            <div className="no-bar" style={{ flexShrink: 0, boxSizing: 'border-box', padding: '8px 12px 0', display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {botButton}
              {turns && turns.agents.length > 0 && (
                <select value={detail.assignedUserId ?? ''} disabled={busy || !mayAssign} onChange={(e) => void assignTo(e.target.value)} aria-label={vi ? 'Giao cho' : 'Assign to'}
                  style={{ ...ui.input, width: 'auto', maxWidth: 160, height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 999, flexShrink: 0 }}>
                  <option value="">{vi ? 'Chưa giao' : 'Unassigned'}</option>
                  {turns.agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
                </select>
              )}
              {notice.text && !notice.blocked && (
                <span style={{ flexShrink: 0, height: 30, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', background: noticeTone === 'red' ? 'var(--wash-red)' : 'var(--wash-amber-3)', color: noticeTone === 'red' ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>{notice.text.length > 48 ? `${notice.text.slice(0, 46)}…` : notice.text}</span>
              )}
            </div>
          )}

          {!narrow && notice.text && (
            <div style={{ flexShrink: 0, boxSizing: 'border-box', margin: '10px 18px 0', padding: '8px 12px', borderRadius: 10, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4,
              background: notice.blocked || noticeTone === 'red' ? 'var(--wash-red)' : 'var(--wash-amber-3)', color: notice.blocked || noticeTone === 'red' ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              <span>{notice.text}</span>
            </div>
          )}

          <div ref={paneRef} onScroll={(e) => { const el = e.currentTarget; atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
            style={{ flex: '1 1 0%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0, padding: narrow ? '10px 12px' : '14px 18px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ marginTop: 'auto' }} aria-hidden="true" />
            {isSpamRow(detail) && (
              <div style={{ alignSelf: 'center', textAlign: 'center', fontSize: 11.5, color: 'var(--c94a3b8)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px' }}>
                {vi ? 'Hội thoại này đang ở Spam — bot không trả lời. Không có gì bị xoá.' : 'This conversation is in Spam — the bot does not reply. Nothing was deleted.'}
              </div>
            )}
            {detail.historySource === 'local' && (
              <div style={{ alignSelf: 'center', textAlign: 'center', fontSize: 11.5, color: 'var(--c94a3b8)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px' }}>
                {vi ? 'Chỉ đang hiện các tin gần nhất — chưa tải được toàn bộ lịch sử từ Meta.' : 'Showing recent messages only — Meta did not return the full history.'}
                <button onClick={() => void loadThread(detail.id)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--ca5b4fc)', fontWeight: 600, cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>{vi ? 'Thử lại' : 'Retry'}</button>
              </div>
            )}
            {detail.historySource === 'partial' && detail.history.length === 0 && (
              <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--c94a3b8)', padding: '18px 0' }}>{vi ? 'Đang tải tin nhắn…' : 'Loading messages…'}</div>
            )}
            {detail.history.map((t, i) => {
              const mine = t.role === 'assistant';
              const prev = i > 0 ? detail.history[i - 1] : null;
              const newDay = Boolean(t.at) && (!prev?.at || dayKeyInTz(t.at as string) !== dayKeyInTz(prev.at as string));
              const who = mine ? (t.manual ? (vi ? 'Nhân viên' : 'Staff') : 'Bot') : (vi ? 'Khách' : 'Customer');
              return (
                <Fragment key={i}>
                  {newDay && (
                    <span style={{ alignSelf: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--c64748b)', padding: '2px 10px', borderRadius: 999, background: 'var(--raised)', border: '1px solid var(--line)', whiteSpace: 'nowrap', margin: '4px 0' }}>{dayDividerLabel(t.at as string, vi)}</span>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: narrow ? '84%' : '72%', flexDirection: mine ? 'row-reverse' : 'row' }}>
                    {!mine && <Avatar row={detail} size={24} token={token} vi={vi} mark={false} />}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: mine ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                      {!!t.images?.length && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {t.images.map((u, j) => (
                            <a key={j} href={u} target="_blank" rel="noreferrer" title={vi ? 'Mở ảnh gốc' : 'Open the photo'}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt="" loading="lazy" style={{ width: narrow ? 160 : 140, height: narrow ? 160 : 140, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--raised)', display: 'block' }} />
                            </a>
                          ))}
                        </div>
                      )}
                      {(!t.images?.length || !/^\[Khách gửi/.test(t.content)) && (
                        <div style={{
                          padding: narrow ? '10px 13px' : '10px 14px',
                          borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          background: mine ? (t.manual ? '#1d4ed8' : 'var(--bubble-bot)') : 'var(--raised)',
                          // The salon's replies sit on a saturated indigo/blue in both
                          // themes, so their text stays white; the customer's bubble
                          // follows the surface.
                          color: mine ? '#f8fafc' : 'var(--ce2e8f0)',
                          border: mine ? '1px solid transparent' : '1px solid var(--line)',
                          fontSize: narrow ? 14.5 : 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        }}><Linkified text={t.content} /></div>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--c64748b)', display: 'flex', alignItems: 'center', gap: 5, padding: '0 4px' }}>
                        {mine && !t.manual && <span style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>AI</span>}
                        {who}{t.at ? <span title={fmtInTz(t.at, { dateStyle: 'full', timeStyle: 'short' })}> · {bubbleStampLabel(t.at, vi)}</span> : null}
                      </span>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {state === 'unclaimed' && !isSpamRow(detail) && (
              <div style={{ alignSelf: 'center', textAlign: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
                {vi ? 'Bot đã bàn giao — khách đang chờ người thật' : 'The bot handed over — the customer is waiting for a person'}{typeof detail.waitingMinutes === 'number' ? ` · ${detail.waitingMinutes} ${vi ? 'phút' : 'min'}` : ''}
              </div>
            )}
            {(detail.notes ?? []).slice(-1).map((n) => (
              <div key={n.id} style={{ alignSelf: 'flex-start', display: 'flex', gap: 8, alignItems: 'flex-start', maxWidth: narrow ? '88%' : '72%' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--wash-amber-2)', border: '1px solid var(--c78350f)', color: 'var(--cfde68a)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initialsOf(n.authorName).slice(0, 1)}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ padding: '9px 12px', borderRadius: 12, background: 'var(--wash-amber)', border: '1px dashed var(--c78350f)', fontSize: 13, lineHeight: 1.5, color: 'var(--cfde68a)', whiteSpace: 'pre-wrap' }}><strong>{vi ? 'Ghi chú nội bộ' : 'Internal note'}</strong> · {n.authorName}: {n.text}</span>
                  <span style={{ fontSize: 11, color: 'var(--c64748b)', paddingLeft: 4 }}>{vi ? 'Chỉ tiệm thấy' : 'Only the salon sees this'} · {fmtInTz(n.createdAt, { timeStyle: 'short' })}</span>
                </span>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* COMPOSER — reply and internal note are two tabs of one box. */}
          <div style={{ flexShrink: 0, boxSizing: 'border-box', margin: narrow ? 0 : '0 18px 14px', borderRadius: narrow ? 0 : 14, background: 'var(--c0f172a)', border: narrow ? 'none' : '1px solid var(--c334155)', borderTop: '1px solid var(--c334155)', boxShadow: narrow ? 'none' : '0 6px 18px -12px rgba(15,42,82,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            paddingBottom: narrow ? 'calc(8px + env(safe-area-inset-bottom))' : 0 }}>
            {narrow ? (
              <div style={{ display: 'flex', background: 'var(--c0b1220)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 3, margin: '8px 12px 0' }}>
                <button onClick={() => setComposerMode('reply')} style={composerMode === 'reply' ? { flex: 1, height: 32, border: 'none', borderRadius: 9, background: 'var(--c0f172a)', color: 'var(--ca5b4fc)', fontSize: 13, fontWeight: 700, boxShadow: '0 1px 2px rgba(15,42,82,.12)', cursor: 'pointer', fontFamily: 'inherit' } : { flex: 1, height: 32, border: 'none', borderRadius: 9, background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{vi ? 'Trả lời khách' : 'Reply to customer'}</button>
                <button onClick={() => setComposerMode('note')} style={composerMode === 'note' ? { flex: 1, height: 32, border: 'none', borderRadius: 9, background: 'var(--c0f172a)', color: 'var(--ink-warn)', fontSize: 13, fontWeight: 700, boxShadow: '0 1px 2px rgba(15,42,82,.12)', cursor: 'pointer', fontFamily: 'inherit' } : { flex: 1, height: 32, border: 'none', borderRadius: 9, background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{vi ? 'Ghi chú nội bộ' : 'Internal note'}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px 0', borderBottom: '1px solid var(--line)' }}>
                <button onClick={() => setComposerMode('reply')} style={{ height: 34, padding: '0 12px', border: 'none', borderBottom: `2px solid ${composerMode === 'reply' ? '#4f46e5' : 'transparent'}`, background: 'transparent', color: composerMode === 'reply' ? 'var(--ca5b4fc)' : 'var(--c94a3b8)', fontSize: 13, fontWeight: composerMode === 'reply' ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>{vi ? 'Trả lời khách' : 'Reply to customer'}</button>
                <button onClick={() => setComposerMode('note')} style={{ height: 34, padding: '0 12px', border: 'none', borderBottom: `2px solid ${composerMode === 'note' ? '#d97706' : 'transparent'}`, background: 'transparent', color: composerMode === 'note' ? 'var(--ink-warn)' : 'var(--c94a3b8)', fontSize: 13, fontWeight: composerMode === 'note' ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>{vi ? 'Ghi chú nội bộ' : 'Internal note'}</button>
                <span style={{ flex: 1 }} />
                {composerMode === 'reply' && detail.pageName && wide && <span style={{ fontSize: 12, color: 'var(--c64748b)', paddingRight: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vi ? 'Gửi với tư cách' : 'Sending as'} <strong style={{ color: 'var(--ccbd5e1)' }}>{detail.pageName}</strong></span>}
                {composerMode === 'note' && <span style={{ fontSize: 12, color: 'var(--ink-warn)', paddingRight: 6, whiteSpace: 'nowrap' }}>{vi ? 'Khách không thấy ghi chú này' : 'The customer never sees this'}</span>}
              </div>
            )}

            {composerMode === 'reply' && !notice.blocked && (suggestions.length > 0 || ASKS.length > 0) && (
              <div className="no-bar" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: narrow ? '8px 12px 0' : '8px 10px 0', fontSize: 12.5, ...(narrow ? { overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, flexWrap: 'nowrap' as const } : { flexWrap: 'wrap' as const }) }}>
                <span style={{ color: 'var(--c64748b)', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>⚡{!narrow && ` ${vi ? 'Gợi ý:' : 'Suggested:'}`}</span>
                {(allCanned ? (detail.canned ?? []) : suggestions).map((q, qi) => (
                  <button key={q.label} title={q.text} onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${q.text}` : q.text))}
                    style={qi === 0 && !allCanned
                      ? { height: 28, padding: '0 10px', borderRadius: 999, border: '1px solid #6366f1', background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }
                      : { height: 28, padding: '0 10px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.label}</button>
                ))}
                {allCanned && ASKS.map((a) => (
                  <button key={a.k} title={vi ? a.vi : a.en} onClick={() => setDraft((d) => { const t = vi ? a.vi : a.en; return d.trim() ? `${d.trim()} ${t}` : t; })}
                    style={{ height: 28, padding: '0 10px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>{a.icon} {vi ? a.viLabel : a.enLabel}</button>
                ))}
                <button onClick={() => setAllCanned((v) => !v)} style={{ height: 28, padding: '0 10px', borderRadius: 999, border: '1px dashed var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit' }}>
                  {allCanned ? (vi ? 'Thu gọn ▴' : 'Fewer ▴') : `${vi ? 'Tất cả mẫu' : 'All templates'} (${(detail.canned?.length ?? 0) + ASKS.length}) ▾`}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: narrow ? '8px 12px 0' : '8px 10px 8px' }}>
              {composerMode === 'reply' ? (
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={composerPlaceholder} disabled={notice.blocked || busy} rows={narrow ? 1 : 2} aria-label={vi ? 'Nội dung trả lời' : 'Reply'}
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', minHeight: narrow ? 40 : 52, padding: narrow ? '10px 12px' : '8px 6px', borderRadius: narrow ? 12 : 8, border: narrow ? '1px solid var(--c334155)' : 'none', background: narrow ? 'var(--c0b1220)' : 'transparent', resize: 'none', fontSize: narrow ? 16 : 14, lineHeight: 1.5, color: 'var(--ce2e8f0)', outline: 'none', fontFamily: 'inherit' }} />
              ) : (
                <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); } }}
                  placeholder={vi ? 'Ghi chú cho team — khách không thấy (Enter để lưu)' : 'Note for the team — the customer never sees it (Enter to save)'} disabled={busy} rows={narrow ? 1 : 2} aria-label={vi ? 'Ghi chú nội bộ' : 'Internal note'}
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', minHeight: narrow ? 40 : 52, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--c78350f)', background: 'var(--wash-amber)', resize: 'none', fontSize: narrow ? 16 : 14, lineHeight: 1.5, color: 'var(--ce2e8f0)', outline: 'none', fontFamily: 'inherit' }} />
              )}
              {narrow && (composerMode === 'reply'
                ? <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()} aria-label={vi ? 'Gửi' : 'Send'}
                    style={{ width: 40, height: 40, borderRadius: 10, border: 'none', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: (notice.blocked || !draft.trim()) ? 'var(--c334155)' : '#4f46e5', color: (notice.blocked || !draft.trim()) ? 'var(--c94a3b8)' : 'var(--cf8fafc)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
                  </button>
                : <button disabled={busy || !note.trim()} onClick={() => void addNote()} aria-label={vi ? 'Lưu ghi chú' : 'Save note'}
                    style={{ height: 40, padding: '0 14px', borderRadius: 10, border: 'none', flexShrink: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', background: !note.trim() ? 'var(--c334155)' : '#d97706', color: !note.trim() ? 'var(--c94a3b8)' : 'var(--cf8fafc)' }}>{vi ? 'Lưu' : 'Save'}</button>)}
            </div>
            {!narrow && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 8px' }}>
                {composerMode === 'reply' && inSalonPortal() && (
                  <button onClick={() => { void bookFor(detail); }} style={{ height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>{vi ? 'Đặt lịch cho khách' : 'Book this customer'}
                  </button>
                )}
                {composerMode === 'reply' && wide && <span style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{vi ? 'Enter gửi · Shift+Enter xuống dòng' : 'Enter sends · Shift+Enter for a new line'}</span>}
                <span style={{ flex: 1 }} />
                {composerMode === 'reply'
                  ? <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()} style={{ height: 36, padding: '0 18px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#4f46e5', color: '#fff', opacity: (notice.blocked || !draft.trim()) ? 0.5 : 1 }}>{vi ? 'Gửi' : 'Send'}</button>
                  : <button disabled={busy || !note.trim()} onClick={() => void addNote()} style={{ height: 36, padding: '0 18px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#d97706', color: '#fff', opacity: !note.trim() ? 0.5 : 1 }}>{vi ? 'Lưu ghi chú' : 'Save note'}</button>}
              </div>
            )}
          </div>
        </>);
      })()}
    </div>
  );

  // ─── Who this is, in Lumio terms ──────────────────────────────────────────
  const infoHead = (text: string, right?: React.ReactNode) => (
    <span style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'var(--c64748b)', textTransform: 'uppercase' }}>{text}<span style={{ flex: 1 }} />{right}</span>
  );
  const softBtn: React.CSSProperties = { height: narrow ? 40 : 32, padding: '0 10px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: narrow ? 13 : 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
  const info = (
    <div style={{ borderLeft: narrow ? 'none' : '1px solid var(--line)', flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--c0f172a)', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      display: narrow ? (showInfo && !!openId ? 'flex' : 'none') : compact ? (showInfo ? 'flex' : 'none') : 'flex', ...(narrow ? { flex: '1 1 0%' } : {}), boxSizing: 'border-box', padding: narrow ? '8px 16px 24px' : 14, gap: 14 }}>
      {(narrow || compact) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowInfo(false)} style={{ ...softBtn, height: 36, display: 'flex', alignItems: 'center', gap: 6 }}>‹ {vi ? 'Về hội thoại' : 'Back to chat'}</button>
        </div>
      )}
      {!detail ? (
        <p style={{ color: 'var(--c64748b)', fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          {vi ? 'Chọn một hội thoại để xem khách là ai với tiệm: lịch hẹn, thợ quen, nhãn, hẹn theo dõi và ghi chú nội bộ.' : 'Pick a conversation to see who this is to the salon: appointments, usual tech, labels, follow-up and the team’s notes.'}
        </p>
      ) : (() => {
        const cust = detail.customer;
        const appts = [...(cust?.appointments ?? [])].filter((a) => a && a.startTime).sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
        const now = Date.now();
        const upcoming = [...appts].reverse().find((a) => +new Date(a.startTime) > now) ?? null;
        const past = appts.filter((a) => +new Date(a.startTime) <= now).slice(0, 3);
        const fullName = [cust?.firstName, cust?.lastName].filter(Boolean).join(' ').trim();
        const mineTurn = detail.assignedUserId === turns?.me?.userId;
        const mayAssign = !!turns && (turns.canEdit || !detail.assignedUserId || mineTurn);
        const assigned = turns?.agents.find((a) => a.userId === detail.assignedUserId)?.name ?? detail.assignedName ?? null;
        return (<>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {infoHead(vi ? 'Khách hàng' : 'Customer')}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Avatar row={detail} size={44} token={token} vi={vi} />
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, minWidth: 0 }}>
                <span onClick={() => void renameThread()} title={vi ? 'Bấm để đặt tên' : 'Click to set the name'} style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName || displayName(detail, vi)}</span>
                <span style={{ fontSize: 12.5, color: cust ? 'var(--ink-good)' : 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust ? (vi ? `Đã nối hồ sơ Lumio · đến ${cust.visits ?? 0} lần` : `Linked in Lumio · ${cust.visits ?? 0} visits`) : (vi ? 'Chưa nối với hồ sơ khách ở Lumio' : 'Not linked to a customer record yet')}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {inSalonPortal() && <button onClick={() => { void bookFor(detail); }} style={{ flex: 1, height: narrow ? 44 : 38, borderRadius: 10, border: 'none', fontSize: narrow ? 14 : 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#4f46e5', color: '#fff' }}>📅 {vi ? 'Đặt lịch cho khách' : 'Book for this customer'}</button>}
              {cust?.phone && <a href={`tel:${String(cust.phone).replace(/[^+\d]/g, '')}`} style={{ ...softBtn, height: narrow ? 44 : 38, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>☎ {vi ? 'Gọi' : 'Call'}</a>}
              {cust?.phone && <button onClick={() => { void copyContact(detail); }} style={{ ...softBtn, height: narrow ? 44 : 38 }}>{copied ? `✓ ${vi ? 'Đã chép' : 'Copied'}` : `⧉ ${vi ? 'Chép' : 'Copy'}`}</button>}
            </div>
            {cust && (cust.phone || cust.usualTech || cust.email) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                {cust.phone && <Stat label={vi ? 'Điện thoại' : 'Phone'} value={String(cust.phone)} />}
                {cust.usualTech && <Stat label={vi ? 'Thợ quen' : 'Usual tech'} value={cust.usualTech} />}
                {cust.email && <Stat label="Email" value={cust.email} />}
              </div>
            )}
            {cust && (upcoming ? (
              <div style={{ boxSizing: 'border-box', padding: '9px 11px', borderRadius: 12, background: 'var(--c0b1220)', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c64748b)', fontWeight: 700 }}>{vi ? 'Lịch tới' : 'Next visit'}</span>
                  {upcoming.status && pill(apptTone(upcoming.status), apptStatusLabel(upcoming.status, vi))}
                </div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{fmtInTz(upcoming.startTime, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{[upcoming.service?.name, upcoming.assignedStaff?.firstName && `${vi ? 'thợ' : 'with'} ${upcoming.assignedStaff.firstName}`].filter(Boolean).join(' · ') || (vi ? 'chưa rõ dịch vụ' : 'service not set')}</p>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c64748b)' }}>{vi ? 'Chưa có lịch hẹn sắp tới.' : 'No upcoming appointment.'}</p>
            ))}
            {past.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c64748b)', fontWeight: 700 }}>{vi ? 'Đã làm gần đây' : 'Recent visits'}</span>
                {past.map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45 }}>
                    <span style={{ color: 'var(--c64748b)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtInTz(a.startTime, { day: '2-digit', month: '2-digit' })}</span>
                    <span style={{ color: 'var(--c94a3b8)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[a.service?.name, a.assignedStaff?.firstName].filter(Boolean).join(' · ') || (vi ? 'lịch hẹn' : 'appointment')}</span>
                  </div>
                ))}
              </div>
            )}
            {!cust && <p style={{ margin: 0, fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5 }}>{vi ? 'Sẽ tự nối khi khách đặt lịch từ hội thoại này.' : 'It links itself when they book from this conversation.'}</p>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {infoHead(vi ? 'Nhãn' : 'Labels', (
              <button onClick={() => setShowLabelForm((v) => !v)} style={{ height: 24, padding: '0 8px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ca5b4fc)', fontSize: 11.5, fontWeight: 600, letterSpacing: 0, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'none' }}>{showLabelForm ? (vi ? 'Đóng' : 'Close') : `＋ ${vi ? 'Nhãn' : 'Label'}`}</button>
            ))}
            {showLabelForm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createLabel(); } }}
                  placeholder={vi ? 'Tên nhãn, ví dụ "Đã báo giá"' : 'Label name'} maxLength={40} style={{ ...ui.input, fontSize: 13, padding: '7px 10px' }} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {LABEL_COLORS.map((c) => <button key={c} onClick={() => setNewColor(c)} aria-label={c} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: newColor === c ? '2px solid var(--ce2e8f0)' : '2px solid transparent' }} />)}
                  <span style={{ flex: 1 }} />
                  <button onClick={() => void createLabel()} disabled={busy || !newLabel.trim()} style={{ ...ui.primaryBtn, fontSize: 12.5, padding: '6px 12px' }}>{vi ? 'Tạo' : 'Create'}</button>
                </div>
              </div>
            )}
            {!labels.length && !showLabelForm && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{vi ? 'Chưa có nhãn. Tạo theo cách tiệm bán hàng: "Đã báo giá", "Chờ chốt", "Không quan tâm".' : 'No labels yet. Create the stages your salon actually uses.'}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {labels.map((l) => {
                const on = (detail.labels ?? []).some((x) => x.id === l.id);
                return (
                  <button key={l.id} onClick={() => void toggleLabel(l.id, !on)} disabled={busy} title={on ? (vi ? 'Bỏ nhãn' : 'Remove') : (vi ? 'Gắn nhãn' : 'Apply')}
                    style={{ height: narrow ? 30 : 26, padding: '0 10px', borderRadius: 999, border: `1px solid ${on ? l.color : 'var(--c334155)'}`, background: on ? l.color : 'transparent', color: on ? '#fff' : 'var(--c94a3b8)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{l.name}{on && <span style={{ opacity: .8 }}>✕</span>}</button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {infoHead(vi ? 'Hẹn theo dõi' : 'Follow-up', followUpState(detail.followUpAt) !== 'none' ? (
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: followUpState(detail.followUpAt) === 'overdue' ? 'var(--ink-bad)' : 'var(--ca5b4fc)' }}>⏰ {followUpLabel(detail.followUpAt, new Date())}</span>
            ) : undefined)}
            <div style={{ display: 'flex', gap: 6 }}>
              {([[1, vi ? 'Mai 10:00' : 'Tomorrow'], [3, vi ? '3 ngày' : '3 days'], [7, vi ? '1 tuần' : '1 week']] as [number, string][]).map(([days, label]) => (
                <button key={days} disabled={busy} onClick={() => { const day = dayKeyInTz(new Date(Date.now() + days * 86_400_000)); void setFollowUp(`${day}T10:00`); }} style={{ ...softBtn, flex: 1, padding: 0 }}>{label}</button>
              ))}
              {detail.followUpAt && <button onClick={() => void setFollowUp('')} disabled={busy} title={vi ? 'Xoá hẹn' : 'Clear'} style={{ ...softBtn, width: narrow ? 40 : 32, padding: 0, color: 'var(--ink-bad)' }}>✕</button>}
            </div>
            <input type="datetime-local" value={toLocalInput(detail.followUpAt)} onChange={(e) => void setFollowUp(e.target.value)} disabled={busy} aria-label={vi ? 'Ngày giờ theo dõi' : 'Follow-up date and time'} style={{ ...ui.input, fontSize: 12.5, padding: '6px 10px' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {infoHead(vi ? 'Ghi chú nội bộ' : 'Internal notes', <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-warn)' }}>{vi ? 'khách không thấy' : 'customer never sees'}</span>)}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); } }}
              placeholder={vi ? 'Nhập ghi chú (Enter để lưu)' : 'Add a note (Enter to save)'} rows={2} aria-label={vi ? 'Ghi chú nội bộ' : 'Internal note'}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--c78350f)', background: 'var(--wash-amber)', fontSize: narrow ? 16 : 13, color: 'var(--ce2e8f0)', resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
            {!detail.notes?.length && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c64748b)' }}>{vi ? 'Chưa có ghi chú nào.' : 'No notes yet.'}</p>}
            {detail.notes?.map((n) => (
              <div key={n.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 10, background: 'var(--c0b1220)', border: '1px solid var(--line)', fontSize: 12.5, lineHeight: 1.45 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--c64748b)' }}>
                  <strong style={{ color: 'var(--ccbd5e1)' }}>{n.authorName}</strong><span>·</span><span>{fmtInTz(n.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <button onClick={() => void apiFetch(`/messenger/threads/${detail.id}/notes/${n.id}/delete`, { method: 'POST', token: token! }).then(() => loadThread(detail.id))} title={vi ? 'Xoá ghi chú' : 'Delete note'} aria-label={vi ? 'Xoá ghi chú' : 'Delete note'}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--c64748b)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>×</button>
                </span>
                <span style={{ color: 'var(--ce2e8f0)', whiteSpace: 'pre-wrap' }}>{n.text}</span>
              </div>
            ))}
          </div>

          {turns && turns.agents.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {infoHead(vi ? 'Giao cho' : 'Assigned to')}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {turns.agents.map((a) => {
                  const on = a.userId === detail.assignedUserId;
                  return (
                    <button key={a.userId} disabled={busy || !mayAssign} onClick={() => void assignTo(on ? '' : a.userId)} title={on ? (vi ? 'Bỏ giao' : 'Unassign') : (vi ? 'Giao cho người này' : 'Assign to this person')}
                      style={{ height: narrow ? 36 : 32, padding: '0 10px 0 4px', borderRadius: 999, border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...onHue(on ? '#4f46e5' : '#0f766e') }}>{initialsOf(a.name).slice(0, 1)}</span>{a.name}{a.userId === turns.me?.userId ? (vi ? ' (tôi)' : ' (me)') : ''}
                    </button>
                  );
                })}
              </div>
              {assigned && !turns.agents.some((a) => a.userId === detail.assignedUserId) && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Đang giao cho' : 'Held by'} {assigned}</span>}
            </div>
          )}
        </>);
      })()}
    </div>
  );

  return (
    <>
      {!narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--cf1f5f9)', letterSpacing: -0.2 }}>{vi ? 'Hộp thư' : 'Inbox'}</h1>
          {unreadCount > 0 && <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4f46e5' }} />{unreadCount} {vi ? 'chưa đọc' : 'unread'}</span>}
          {waiting > 0 && <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706' }} />{waiting} {vi ? 'khách đang chờ người thật' : 'waiting for a person'}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {!loaded ? (
              <span style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>{vi ? 'Đang tải…' : 'Loading…'}</span>
            ) : sources.length === 0 ? (
              <span style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>{vi ? 'Chưa nối kênh nào — vào Kênh kết nối để nối Trang.' : 'No channel connected — open Channels to connect a Page.'}</span>
            ) : (<>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {sources.slice(0, 6).map((src, i) => (
                  <span key={src.key} title={src.label} style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--c0b1120)', marginLeft: i ? -8 : 0, ...onHue(channelBrand(src.channel).bg) }}>{channelLetter(src.channel)}</span>
                ))}
              </span>
              <span style={{ fontSize: 13, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{new Set(sources.map((s) => channelOf(s.channel))).size} {vi ? 'kênh' : 'channels'} · {sources.length} {vi ? 'tài khoản' : 'accounts'}</span>
            </>)}
            {inSalonPortal() && <a href="/salon/channels" style={{ height: 36, padding: '0 14px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}>＋ {vi ? 'Kết nối kênh' : 'Connect a channel'}</a>}
          </div>
        </div>
      )}

      {err && <div style={{ ...ui.card, borderColor: 'var(--c7f1d1d)', color: 'var(--ink-bad)', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div ref={cardRef} onClick={() => { if (moreOpen) setMoreOpen(false); }} style={{ ...ui.card, padding: 0, overflow: 'hidden', display: narrow ? 'flex' : 'grid',
        ...(narrow ? {} : { height: cardH ?? undefined }),
        gridTemplateColumns: narrow ? undefined
          : compact ? (showInfo ? 'minmax(0,280px) minmax(0,1fr) minmax(0,272px)' : 'minmax(0,300px) minmax(0,1fr)')
          : wide ? '232px minmax(0,344px) minmax(0,1fr) minmax(0,312px)' : '196px minmax(0,272px) minmax(0,1fr) minmax(0,256px)',
        ...(narrow ? { width: '100vw', marginLeft: 'calc(50% - 50vw)', border: 'none', borderRadius: 0, height: cardH ?? undefined, flexDirection: 'column' as const } : {}) }}>
        {!narrow && !compact && rail}
        {list}
        {thread}
        {info}
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
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: num }}>{n}</div>
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

/** The letter on a channel badge — colour does the recognising, the letter confirms it. */
function channelLetter(raw: unknown): string {
  switch (channelOf(raw)) {
    case 'instagram': return 'IG';
    case 'zalo': return 'Z';
    case 'web': return 'W';
    default: return 'M';
  }
}

// White text on a coloured (never themed) ground: the ground is a channel's
// brand hue or the accent, so light mode does not flip it.
const onHue = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff' });
