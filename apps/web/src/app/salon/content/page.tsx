'use client';

/**
 * "Nội dung hôm nay" — what this salon should film today.
 *
 * Read on a phone, standing up, between customers. That single fact drives
 * every layout choice here: one card per idea, the shot list before the
 * caption (you film first, you write later), a copy button instead of asking
 * anyone to retype an English caption, and buttons big enough for a thumb.
 *
 * The "vì sao gợi ý" line is never hidden behind a tap. It is the whole reason
 * an owner believes the idea is worth 15 minutes — it quotes their own numbers
 * back at them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { ItemComments, TeamChatDock, TeamChatWindow } from '../../../components/ContentChat';
import { MonthCalendar, IgGrid, PostPreview, MediaList, type MediaItem } from '../../../components/PostStudio';
import { fitForSocial } from '../../../lib/image';

interface Idea {
  id: string;
  rank: number;
  status: string;
  /** Where it went up. Empty until somebody pastes it. */
  postedUrl?: string | null;
  formatName: string | null;
  title: string;
  hook: string | null;
  shotList: string | null;
  caption: string | null;
  hashtags: string | null;
  bestTime: string | null;
  reason: string | null;
}
interface TrendNote { id: string; title: string; body: string }
interface Payload { forDate: string; ideas: Idea[]; trendNotes: TrendNote[] }
interface SeasonEvent {
  name: string; daysAway: number; note: string;
  spanDays?: number; precision?: 'exact' | 'approximate'; scope?: string; caveat?: string;
}
interface Offer { kind: string; headline: string; detail: string; discountPct: number; protect: string[]; basis: string }
interface Job { kind: string; text: string; why: string; when?: string }
interface ContentSource { label: string; when: string; why: string }
interface FeedLink { key: string; title: string; url: string; what: string; how: string; source: string }
interface Segment {
  key: string; label: string; count: number; sharePct: number;
  avgTicketCents: number; medianGapDays: number | null; favouriteTime: string | null; topService: string | null;
}
interface AudienceTarget { segment: string; label: string; why: string; action: string; prize: string }
interface AdAudience { name: string; who: string; why: string; how: string; order: number; blockedBy?: string }
interface Ads {
  ceiling: { strictCents: number | null; withRepeatCents: number | null; visitsPerYear: number | null; plain: string };
  budget: { dailyCents: number; days: number; totalCents: number; bookingsToBreakEven: number | null; openSlots: number | null; feasible: string; plain: string };
  window: { runDays: number[]; pauseDays: number[]; labels: { run: string[]; pause: string[] }; why: string };
  lead: { medianDays: number | null; sample: number; basis: string };
  channels: { reports: ChannelReport[]; coverage: { total: number; attributed: number; pct: number; unknown: number }; caveat: string | null };
  plans: PlatformPlan[];
  audiences: AdAudience[];
  money: { ceilingStrict: string | null; ceilingRepeat: string | null; daily: string; total: string };
}
interface ChannelReport {
  channel: string; label: string; platform: string;
  bookings: number; sharePct: number; revenue: string; avgTicket: string;
  acquired: number; repeatPct: number | null; visitsPerAcquired: number | null;
  valuePerAcquired: string | null;
  last90: number; prior90: number; trend: 'up' | 'flat' | 'down' | 'unknown';
  verdict: 'builds' | 'convenience' | 'fading' | 'weak' | 'unproven';
  says: string;
}
interface AdSetSpec { name: string; who: string; where: string; when: string; exclude: string | null }
interface CampaignSpec {
  name: string; objective: string;
  adSets: AdSetSpec[];
  creative: { headlines: string[]; descriptions: string[]; cta: string; landing: string; visual: string };
  budgetLine: string; before: string[]; measure: string[]; warnings: string[];
}
interface PlatformPlan {
  platform: string; label: string; rank: number;
  status: 'spend' | 'later' | 'hold' | 'unproven';
  evidence: string;
  ceiling: string | null; daily: string | null; total: string | null;
  days: number; bookingsToBreakEven: number | null;
  how: string[]; watch: string;
  /** The build sheet, only for the campaign we are telling them to run. */
  spec: CampaignSpec | null;
}
interface TargetSegment { key: string; label: string; size: number; basis: string; why: string; targeting: string[] }
interface WeekOutcome {
  plannedJobs: number; doneJobs: number; posted: number; postedWithLink: number;
  bookings: number; newCustomers: number; revenueCents: number; reviews: number;
}
interface WeekRow {
  weekKey: string; label: string; startDate: string;
  stageKey: string | null; stageStep: number | null;
  focus: string; edited: boolean; editedByName: string | null; editedAt: string | null;
  approvedAt: string | null; approvedByName: string | null;
  outcome: WeekOutcome | null; outcomeLine: string | null; deltaLine: string | null;
}
interface PlainStep { key: string; icon: string; title: string; line: string; action: string | null; why: string }
interface MarketPlan {
  adults: number | null;
  segments: TargetSegment[];
  primary: TargetSegment | null;
  affordable: { usd: number; households: number; pct: number } | null;
  capacity: number | null;
  penetrationPct: number | null;
  penetrationVerdict: string;
  maxSpend: string | null;
  steps: PlainStep[];
  reasoning: string[];
  limits: string[];
}
interface BriefStep { key: string; order: number; title: string; finding: string; basis: string; confidence: string; soWhat: string }
interface MissingLink { key: string; what: string; unlocks: string; how: string }
interface Brief { headline: string; steps: BriefStep[]; missing: MissingLink[]; complete: boolean; limits: string[] }
interface SeoCheck { key: string; title: string; state: 'pass' | 'warn' | 'fail' | 'unknown'; finding: string; action: string; why: string }
interface Seo { checks: SeoCheck[]; failing: number; headline: string; blindSpots: string[] }
interface PromoPlay { key: string; name: string; offer: string; why: string; useWhen: string; avoidWhen: string; cost: 'low' | 'medium' | 'high' }
interface Promo {
  margin: { commissionPct: number | null; grossMarginPct: number | null; source: string; note?: string };
  ceiling: number | null;
  proposed: { discountPct: number; liftNeededPct: number | null; impossible: boolean; verdict: string; plain: string } | null;
  plays: PromoPlay[];
  tryFirst: string[];
  note: string;
}
interface DayPlan { weekday: number; label: string; jobs: Job[] }
interface TrendTopic { label: string; why: string; from: 'salon' | 'region' | 'trade' }
interface TrendLink { key: string; title: string; url: string; what: string; how: string; source: string; topics?: TrendTopic[] }
interface Plan {
  region: { label: string; known: boolean; market: string; source?: string | null; fix?: string | null };
  industry: { code: string; trade: string };
  identity: {
    label: string; declared: boolean; filled: number;
    profile: { whatWeDo: string; whoWeServe: string; languages: string; serviceArea: string; edge: string; avoid: string };
    provenance: string[];
    gaps: { field: string; label: string; cost: string }[];
  };
  events: SeasonEvent[];
  week: {
    days: DayPlan[]; focus: string; basis: string; daily: Job[]; sources: ContentSource[];
    trade: string; dataThin: boolean; week: number;
    stage: { key: string; step: number; title: string; goal: string; why: string; exitWhen: string; progress: { done: number; need: number; label: string } | null } | null;
    teamNote?: string;
  };
  /** Language the AI writes the plan in. Null = decide from the market. */
  contentLang?: string | null;
  weekMeta: {
    weekKey: string; label: string; edited: boolean; editedByName: string | null; editedAt: string | null;
    canEdit: boolean; approvedAt: string | null; approvedByName: string | null;
  } | null;
  calendar: SeasonEvent[];
  videoFeeds: FeedLink[];
  productWatch: FeedLink[];
  trends: { weekly: TrendLink[]; monthly: TrendLink[]; regionKnown: boolean };
  audience: { totalCustomers: number; segments: Segment[]; targets: AudienceTarget[]; thin: boolean; basis: string };
  promo: Promo;
  area: { ok: boolean; lines: string[]; year: number | null; totalPopulation: number | null; error?: string } | null;
  market: MarketPlan | null;
  ads: Ads | null;
  brief: Brief | null;
  seo: Seo | null;
  offer: Offer;
  lapsed: { count: number; medianDaysAway: number | null };
  quietSlots: { label: string; fillIndex: number }[];
  thin: boolean;
}

/**
 * What `/content/plan` actually returns.
 *
 * The server writes every phrase it owns in both languages and renders the
 * whole plan twice: Vietnamese at the top level (the shape this page has always
 * read) and English under `en`. The EN/VI switch therefore picks a rendering
 * rather than asking the server to redo the work, which also means switching
 * language costs no round trip and cannot leave half the screen in the other
 * language while a request is in flight.
 */
type PlanEnvelope = Plan & { en?: Plan };

type TabId = 'today' | 'week' | 'trends' | 'calendar' | 'audience' | 'ads' | 'queue';

/** One post waiting to go out on the salon's own Page / Instagram. */
interface QueuedPost {
  id: string;
  ideaId: string | null;
  channels: ('facebook' | 'instagram')[];
  message: string;
  /** Photos and videos in DISPLAY ORDER. Item one is the cover. */
  media: MediaItem[];
  shape: 'text' | 'image' | 'video' | 'carousel';
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'posted' | 'failed' | 'expired' | 'cancelled';
  attempts: number;
  lastError: string | null;
  /** Meta's error turned into the one action that fixes it. */
  fix: string | null;
  /** Files removed from storage after the post had been live a while. */
  mediaPurged?: boolean;
  /** The saved error is about a permission the connection now has. */
  errorIsStale: boolean;
  results: { channel: string; id: string | null; url: string | null; error: string | null }[];
  postedAt: string | null;
  createdByName: string | null;
  /** Why it cannot go out as it stands. Empty when it is fine. */
  blockers: string[];
}
interface QueuePayload {
  connected: {
    pageName: string | null; igUsername: string | null; hasInstagram: boolean; enabled: boolean;
    /** Permissions the stored Page token does NOT carry. Null = we could not ask. */
    missingScopes: string[] | null;
  } | null;
  posts: QueuedPost[];
  /** Advice, never a refusal: where a month of posts fights itself. */
  crowding: { id: string; minutesApart: number; message: string }[];
  /** Lumio support session: may delete published rows too. */
  canDeletePosted?: boolean;
}

/** One icon per kind of job, so the week reads at a glance on a phone. */
const JOB_ICON: Record<string, string> = {
  film: '🎬', post: '📤', story: '📸', offer: '🏷️', winback: '💬', engage: '💚', rest: '·',
};


/**
 * One piece of advice, in the order a person reads it.
 *
 * What it IS, then what to DO, and the working only if they ask. The old
 * version put the derivation inside the same sentence as the finding, so every
 * line carried its own methodology — five dense paragraphs where an owner
 * wanted five short answers. They run a shop; they are not marketing people,
 * and a dashboard that has to be studied is a dashboard nobody opens twice.
 */

/**
 * One week in the archive strip.
 *
 * A horizontal scroller rather than a dropdown: on a phone a dropdown hides
 * how many weeks there are, and how many there are is the point — it is the
 * visible proof that the plan has a past.
 */
function WeekChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: '0 0 auto', fontSize: 12.5, padding: '6px 13px', borderRadius: 999,
        cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: active ? 700 : 500,
        border: `1px solid ${active ? '#6366f1' : 'var(--c334155)'}`,
        background: active ? '#6366f1' : 'transparent',
        color: active ? 'var(--cf8fafc)' : 'var(--c94a3b8)',
      }}
    >{children}</button>
  );
}


function StepCard({ step, T }: { step: PlainStep; T: (vi: string, en: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      padding: '11px 13px', marginBottom: 8, borderRadius: 10,
      background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
    }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
        <span style={{ fontSize: 15 }}>{step.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {step.title}
          </div>
          <div style={{ fontSize: 14.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 2 }}>
            {step.line}
          </div>
          {step.action && (
            <div style={{
              fontSize: 13, color: 'var(--cbbf7d0)', lineHeight: 1.55, marginTop: 7,
              padding: '7px 10px', borderRadius: 8, background: 'var(--c14532d)',
            }}>
              <b>{T('Làm gì', 'Do this')}:</b> {step.action}
            </div>
          )}
          {step.why && (
            <>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{
                  marginTop: 6, padding: 0, border: 'none', background: 'transparent',
                  color: 'var(--c64748b)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                {open ? T('Ẩn cách tính', 'Hide the working') : T('Vì sao?', 'Why?')}
              </button>
              {open && (
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginTop: 5 }}>
                  {step.why}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



/** One link of the strategy chain: the finding, what follows, working on demand. */
function BriefStepRow({ step: st, index: i, T }: {
  step: BriefStep; index: number; T: (vi: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 11, padding: '10px 0', borderTop: i ? '1px solid var(--c1e293b)' : 'none' }}>
      <div style={{
        flex: '0 0 26px', height: 26, borderRadius: '50%', background: 'var(--c1e293b)',
        color: 'var(--ca5b4fc)', fontSize: 13, fontWeight: 700, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>{i + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{st.title}</span>
          {st.confidence === 'assumed' && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'var(--c451a03)', color: 'var(--cfde68a)' }}>
              {T('ước tính', 'estimate')}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 2 }}>{st.finding}</div>
        <div style={{ fontSize: 12.5, color: '#22c55e', lineHeight: 1.55, marginTop: 4 }}>→ {st.soWhat}</div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            marginTop: 5, padding: 0, border: 'none', background: 'transparent',
            color: 'var(--c64748b)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          {open ? T('Ẩn cách tính', 'Hide the working') : T('Vì sao?', 'Why?')}
        </button>
        {open && (
          <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginTop: 4 }}>
            {T('Căn cứ', 'Basis')}: {st.basis}
          </div>
        )}
      </div>
    </div>
  );
}


export default function ContentTodayPage() {
  return <SalonShell><Inner /></SalonShell>;
}

/**
 * One labelled line of the campaign build sheet.
 *
 * A build sheet is read while looking at another screen — Ads Manager on one
 * side, this on the other — so the label has to be findable at a glance rather
 * than buried in a paragraph.
 */
function SpecRow({ k, vi, children }: { k: string; vi: boolean; children: React.ReactNode }) {
  void vi;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 3 }}>{k}</div>
      <div>{children}</div>
    </div>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [data, setData] = useState<Payload | null>(null);
  // Both renderings are held; `plan` below is whichever one the language switch
  // is pointing at right now.
  const [planRaw, setPlanRaw] = useState<PlanEnvelope | null>(null);
  // The rendering on screen. `en` is missing only when the server is older than
  // this page, in which case the Vietnamese one is still better than nothing.
  const plan: Plan | null = useMemo(
    () => (planRaw ? (vi ? planRaw : (planRaw.en ?? planRaw)) : null),
    [planRaw, vi],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('today');
  // A notification that says "your post failed" has to LAND on the queue. Read
  // once on mount, not on every render: after that the tabs are the user's.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab');
    const known: TabId[] = ['today', 'week', 'trends', 'calendar', 'audience', 'ads', 'queue'];
    if (want && (known as string[]).includes(want)) setTab(want as TabId);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [pf, setPf] = useState({ whatWeDo: '', whoWeServe: '', languages: '', serviceArea: '', edge: '', avoid: '' });
  const [savingPf, setSavingPf] = useState(false);
  const [scanningPf, setScanningPf] = useState(false);
  const [pfScan, setPfScan] = useState<{ sources: string[]; warnings: string[]; saved?: boolean; locationSaved?: string | null } | null>(null);
  const [pfNote, setPfNote] = useState('');
  // The archive, and which week is on screen. Null = this week (live).
  const [weeksRaw, setWeeksRaw] = useState<(WeekRow & { en?: WeekRow })[]>([]);
  // The archive strip, in the language on screen — same envelope as the plan.
  const weeks: WeekRow[] = useMemo(
    () => weeksRaw.map((w) => (vi ? w : (w.en ?? w))),
    [weeksRaw, vi],
  );
  const [viewWeek, setViewWeek] = useState<string | null>(null);
  const [past, setPast] = useState<{ label: string; week: Plan['week']; editedByName: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftFocus, setDraftFocus] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [savingWeek, setSavingWeek] = useState(false);
  const [approving, setApproving] = useState(false);
  // The publishing queue. Loaded on demand: most visits never open this tab,
  // and it is one more round trip on a phone that is already waiting.
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [postDraft, setPostDraft] = useState<{
    id?: string; channels: ('facebook' | 'instagram')[]; message: string; media: MediaItem[]; at: string;
  } | null>(null);
  const [mediaInput, setMediaInput] = useState('');
  const [uploading, setUploading] = useState(false);
  /** What the fitter did to the last upload — crop, padding, or nothing. */
  const [fitNote, setFitNote] = useState<string | null>(null);
  /**
   * Post now, or put it on the calendar.
   *
   * Scheduling was the only way in: write the post, pick a date, save, find the
   * row, press "Post now". Five steps for the commonest thing a salon does —
   * something happened in the shop and they want it up.
   */
  const [postWhen, setPostWhen] = useState<'now' | 'later'>('later');
  // Three views over one queue: a list reads, a calendar plans, a grid judges.
  const [view, setView] = useState<'calendar' | 'grid' | 'list'>('calendar');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showPosted, setShowPosted] = useState(true);
  const [postErr, setPostErr] = useState<string | null>(null);
  /**
   * How many queued posts need a human.
   *
   * A post that failed to publish is otherwise invisible: nobody opens this tab
   * to check on something they believe is handled. It is loaded on EVERY visit
   * to the page, not only when the tab is open, because the whole point of the
   * number is to be seen by someone who was not going to look.
   */
  const [postAlerts, setPostAlerts] = useState(0);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [unread, setUnread] = useState<{ total: number; bySubject: Record<string, number> }>({ total: 0, bySubject: {} });
  const isMobile = useIsMobile(900);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // The plan is computed live and can be slower than the ideas; letting it
      // fail on its own means a slow booking query never blanks the whole page.
      const [today, p] = await Promise.all([
        apiFetch<Payload>('/content/today', { token }),
        apiFetch<PlanEnvelope>('/content/plan', { token }).catch(() => null),
      ]);
      setData(today); setPlanRaw(p);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // The archive list, loaded once. Cheap, and it is what turns "this week" into
  // a plan with a past rather than a screen that forgets every Monday.
  useEffect(() => {
    if (!token) return;
    apiFetch<(WeekRow & { en?: WeekRow })[]>('/content/weeks', { token })
      .then(setWeeksRaw).catch(() => setWeeksRaw([]));
    apiFetch<{ total: number; bySubject: Record<string, number> }>('/content/chat/unread', { token })
      .then(setUnread).catch(() => undefined);
  }, [token]);

  // Opening an older week fetches it as the team left it.
  useEffect(() => {
    if (!token || !viewWeek) { setPast(null); return; }
    type PastWeek = { label: string; week: Plan['week']; editedByName: string | null };
    apiFetch<PastWeek & { en?: PastWeek }>(
      `/content/weeks/${encodeURIComponent(viewWeek)}`, { token },
    ).then((r) => setPast(vi ? r : (r.en ?? r))).catch(() => setPast(null));
  }, [token, viewWeek, vi]);
  useEffect(() => {
    if (plan?.identity?.profile) setPf({ ...plan.identity.profile });
  }, [plan?.identity?.profile]);

  const loadQueue = useCallback(async () => {
    if (!token) return;
    try {
      setQueue(await apiFetch<QueuePayload>('/content/posts', { token }));
    } catch { setQueue({ connected: null, posts: [], crowding: [] }); }
  }, [token]);
  useEffect(() => { if (tab === 'queue') loadQueue(); }, [tab, loadQueue]);

  // Counted from the same payload the tab renders, so the badge and the list can
  // never disagree about how many things are wrong.
  useEffect(() => {
    if (!token) return;
    apiFetch<QueuePayload>('/content/posts', { token })
      .then((q) => setPostAlerts(q.posts.filter(
        (p) => p.status === 'failed' || p.status === 'expired' || p.blockers.length > 0,
      ).length))
      .catch(() => setPostAlerts(0));
  }, [token, queue]);

  /**
   * Save the open draft. `status` decides whether it joins the queue or waits.
   *
   * `now` saves and publishes in one press. If the publish call fails the row is
   * still saved and scheduled for this minute, so the sweeper picks it up within
   * sixty seconds — a half-finished press leaves work queued, never lost.
   */
  async function savePost(status: 'draft' | 'scheduled', now = false) {
    if (!postDraft || queueBusy) return;
    setQueueBusy(true); setPostErr(null);
    try {
      const r = await apiFetch<{ id: string }>('/content/posts', {
        method: 'POST', token,
        body: {
          id: postDraft.id,
          channels: postDraft.channels,
          message: postDraft.message,
          media: postDraft.media,
          // The picker gives a local wall-clock string; the server stores an
          // instant. Converting here means "9:00" means 9:00 where the salon is.
          scheduledAt: now ? new Date().toISOString() : new Date(postDraft.at).toISOString(),
          status,
        },
      });
      if (now && r?.id) {
        await apiFetch(`/content/posts/${r.id}/publish`, { method: 'POST', token });
      }
      setPostDraft(null);
      await loadQueue();
    } catch (e) { setPostErr(e instanceof Error ? e.message : 'error'); }
    finally { setQueueBusy(false); }
  }

  /** Add one pasted link to the draft, guessing photo vs video from the URL. */
  /**
   * Upload a picture and use the URL we get back.
   *
   * Videos are not offered here: the existing upload path takes a compressed
   * base64 image, and a phone video is tens of megabytes. Pretending otherwise
   * would fail at a size limit after the salon had waited for it.
   */
  async function uploadMedia(file: File) {
    if (!postDraft || uploading) return;
    setUploading(true); setPostErr(null);
    try {
      // ---- fit the SHAPE, not just the size ----
      //
      // Instagram takes 4:5 to 1.91:1. A photo taken holding a phone upright is
      // 3:4 — already outside — so this is not an edge case, it is most of what
      // a salon shoots. Left alone, the Graph API answers "Media ID is not
      // available", which names a container id and says nothing about the
      // picture.
      //
      // maxChars 1.6M ≈ 1.2MB decoded. The server refuses over 3MB, and a feed
      // picture needs nothing like that: past this the upload is slower and
      // nothing on screen looks better.
      const { dataUrl, note } = await fitForSocial(file, { maxChars: 1_600_000 });
      const { url } = await apiFetch<{ url: string }>('/uploads/service-photo', {
        method: 'POST', token, body: { dataUrl },
      });
      setPostDraft((d) => (d ? { ...d, media: [...d.media, { url, kind: 'image' }] } : d));
      // A tool that silently reshapes somebody's photograph and posts the result
      // is one they stop trusting the first time they notice. Say it, and let
      // the preview below show the picture that will actually go out.
      setFitNote(note);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      // The server answers with a code here, not a sentence. Passing that
      // through would tell a salon owner "STORAGE_NOT_CONFIGURED", which is a
      // message for whoever set up the platform, not for them.
      setPostErr(/STORAGE_NOT_CONFIGURED/i.test(raw)
        ? T('Chưa bật kho lưu ảnh trên hệ thống. Báo Lumio bật giúp, hoặc tạm thời dán link ảnh từ website của tiệm.',
            'Image storage is not switched on yet. Ask Lumio to enable it, or paste a link from your own website for now.')
        : `${T('Tải ảnh lên không được', 'Upload failed')}${raw ? `: ${raw}` : ''}`);
    } finally { setUploading(false); }
  }

  function addMedia() {
    const url = mediaInput.trim();
    if (!postDraft || !url || postDraft.media.length >= 10) return;
    // A guess from the extension, not a decision: a signed CDN path has no
    // extension, so the row carries a picker the salon can correct.
    const kind: MediaItem['kind'] = /\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i.test(url) ? 'video' : 'image';
    setPostDraft({ ...postDraft, media: [...postDraft.media, { url, kind }] });
    setMediaInput('');
  }

  /** Drop a post on another day. Keeps the hour it already had. */
  async function movePost(id: string, day: Date) {
    const p = queue?.posts.find((x) => x.id === id);
    if (!p) return;
    const old = new Date(p.scheduledAt);
    const when = new Date(day);
    when.setHours(old.getHours(), old.getMinutes(), 0, 0);
    setQueueBusy(true); setPostErr(null);
    try {
      await apiFetch(`/content/posts/${id}/when`, { method: 'PATCH', token, body: { scheduledAt: when.toISOString() } });
      await loadQueue();
    } catch (e) { setPostErr(e instanceof Error ? e.message : 'error'); }
    finally { setQueueBusy(false); }
  }

  /** Open one queued post in the composer. */
  function editPost(id: string) {
    // Opening a row that already has a slot is a scheduling act, whatever the
    // toggle was left on last time. Inheriting 'now' from a previous composer
    // would publish a queued post the moment somebody pressed save.
    setPostWhen('later');
    // The note describes ONE upload. Carried into the next post it would claim
    // a crop that never happened.
    setFitNote(null);
    const p = queue?.posts.find((x) => x.id === id);
    // A published post opens too. The fields cannot be saved — the server
    // refuses that — but the person clicking it wants to see where it went,
    // and a click that does nothing at all reads as a broken calendar.
    if (!p) return;
    setPostDraft({
      id: p.id, channels: p.channels, message: p.message, media: p.media,
      at: new Date(new Date(p.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    });
  }

  async function postAction(id: string, action: 'publish' | 'cancel') {
    if (queueBusy) return;
    setQueueBusy(true); setPostErr(null);
    try {
      if (action === 'publish') await apiFetch(`/content/posts/${id}/publish`, { method: 'POST', token });
      else await apiFetch(`/content/posts/${id}`, { method: 'DELETE', token });
      await loadQueue();
    } catch (e) { setPostErr(e instanceof Error ? e.message : 'error'); }
    finally { setQueueBusy(false); }
  }

  /**
   * Take a post off the calendar for good.
   *
   * The confirmation for an ALREADY PUBLISHED post says the one thing that is
   * easy to get wrong: this removes Lumio's record, not the post on Facebook.
   * A salon that thinks "delete" pulled an offer down will not go and pull it
   * down, and the offer keeps running.
   */
  async function removePost(id: string) {
    if (queueBusy) return;
    const p = queue?.posts.find((x) => x.id === id);
    // The server refuses this for a salon too. Stopping here keeps them from
    // meeting an error message for something the screen should never offer.
    if (p?.status === 'posted' && !queue?.canDeletePosted) return;
    const msg = p?.status === 'posted'
      ? T('Xoá bản ghi này khỏi lịch Lumio?\n\nBài trên Facebook/Instagram VẪN CÒN — muốn gỡ hẳn phải xoá trực tiếp trên trang đó.\nTiệm sẽ mất dấu vết bài này trong kết quả tuần.',
          'Delete this record from Lumio’s calendar?\n\nThe post STAYS UP on Facebook/Instagram.\nThe salon loses this post from its weekly results.')
      : T('Xoá hẳn bài này khỏi lịch? Không khôi phục lại được.',
          'Delete this post from the calendar? This cannot be undone.');
    if (!window.confirm(msg)) return;
    setQueueBusy(true); setPostErr(null);
    try {
      await apiFetch(`/content/posts/${id}/remove`, { method: 'DELETE', token });
      setPostDraft((d) => (d?.id === id ? null : d));
      await loadQueue();
    } catch (e) { setPostErr(e instanceof Error ? e.message : 'error'); }
    finally { setQueueBusy(false); }
  }

  /** Open the composer prefilled from a drafted idea — the whole point of the plan. */
  function scheduleFromIdea(idea: Idea) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    setPostWhen('later');
    setPostDraft({
      channels: ['facebook'],
      message: [idea.caption, idea.hashtags].filter(Boolean).join('\n\n'),
      media: [],
      at: local,
    });
    setTab('queue');
  }

  async function mark(id: string, status: string, postedUrl?: string) {
    setBusy(id);
    try {
      await apiFetch(`/content/ideas/${id}/status`, {
        method: 'POST', token, body: postedUrl === undefined ? { status } : { status, postedUrl },
      });
      // Update in place: a full reload would scroll a phone back to the top,
      // losing the card the person was standing in front of.
      setData((d) => (d ? {
        ...d,
        ideas: d.ideas.map((i) => (i.id === id
          ? { ...i, status, ...(postedUrl === undefined ? {} : { postedUrl }) }
          : i)),
      } : d));
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  /**
   * The salon says "yes, run this week".
   *
   * Written on the week row, not sent as a chat message: an approval that lives
   * in a thread is an approval nobody can find on the Friday somebody asks
   * whether the budget was agreed.
   */
  async function approveWeek() {
    const key = plan?.weekMeta?.weekKey;
    if (!key || approving) return;
    setApproving(true);
    try {
      const r = await apiFetch<{ approvedAt: string }>(
        `/content/weeks/${encodeURIComponent(key)}/approve`, { method: 'POST', token },
      );
      // Both renderings carry the same weekMeta, so the approval is written to
      // each — otherwise switching language would un-approve the week on screen.
      setPlanRaw((p) => (p && p.weekMeta
        ? {
          ...p,
          weekMeta: { ...p.weekMeta, approvedAt: r.approvedAt, approvedByName: T('Tiệm', 'Salon') },
          ...(p.en?.weekMeta
            ? { en: { ...p.en, weekMeta: { ...p.en.weekMeta, approvedAt: r.approvedAt, approvedByName: T('Tiệm', 'Salon') } } }
            : {}),
        }
        : p));
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setApproving(false); }
  }

  /**
   * Redraft on demand instead of waiting for the 6am run.
   *
   * Capped server-side at five a day per salon — every press is a real API call
   * — and the remaining count comes back with the response so the button can
   * say how many are left rather than failing silently on the sixth press.
   */
  async function refreshIdeas() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await apiFetch<{ created: number; left: number; skipped?: string }>(
        '/content/refresh', { method: 'POST', token },
      );
      await load();
      setTab('today');
      setRefreshMsg(r.created
        ? T(`Đã tạo ${r.created} ý tưởng mới · còn ${r.left} lượt hôm nay`, `${r.created} new ideas · ${r.left} refreshes left today`)
        : T('Chưa tạo được ý tưởng mới — thử lại sau ít phút', 'Could not draft new ideas — try again shortly'));
      setTimeout(() => setRefreshMsg(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally { setRefreshing(false); }
  }

  /**
   * Save what the business says it is.
   *
   * This is the field that decides everything else on the page. A four-value
   * industry code cannot describe a marketing agency serving Vietnamese
   * families, and while that code was the only input the advice came out
   * fluent and wrong.
   */
  async function saveProfile() {
    if (savingPf) return;
    setSavingPf(true);
    try {
      await apiFetch('/settings/business-profile', { method: 'PATCH', token, body: pf });
      setEditProfile(false);
      await load();
      setRefreshMsg(T('Đã lưu mô tả doanh nghiệp. Bấm "Cập nhật ngay" để gợi ý viết lại theo mô tả mới.',
                      'Saved. Press "Refresh now" to redraft against it.'));
      setTimeout(() => setRefreshMsg(null), 8000);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setSavingPf(false); }
  }

  /**
   * Read the business's own website and Facebook Page instead of asking.
   *
   * The six-field form was the wrong answer to a real problem: the business had
   * already published all of this, and both sources were already connected to
   * this platform. The result lands in the form as a DRAFT — a model's reading
   * of a marketing page is a proposal to correct, not a fact to save silently,
   * because everything downstream is derived from these sentences.
   */
  async function scanProfile() {
    if (scanningPf) return;
    setScanningPf(true); setPfScan(null); setError(null);
    try {
      type Scan = {
        draft: Record<string, string>; sources: string[]; warnings: string[];
        saved: boolean; locationSaved: string | null;
      };
      // Same envelope as the plan: Vietnamese in place, English under `en`.
      // Note that `draft` is NOT part of that — it is the AI's description of
      // the business, and which language the AI writes in is its own setting.
      const raw = await apiFetch<Scan & { en?: Scan }>(
        '/content/profile/scan', { method: 'POST', token, body: { note: pfNote } },
      );
      const r = vi ? raw : (raw.en ?? raw);
      setPfScan({ sources: r.sources ?? [], warnings: r.warnings ?? [], saved: r.saved, locationSaved: r.locationSaved });
      if (r.saved) {
        setPfNote('');
        setEditProfile(false);
      } else {
        // Nothing was saved, so the fields are the only way forward — open them
        // with whatever was read, rather than leaving a dead end.
        setPf((cur) => {
          const next = { ...cur };
          for (const k of Object.keys(next) as (keyof typeof next)[]) {
            if (!next[k] && r.draft?.[k]) next[k] = r.draft[k];
          }
          return next;
        });
        setEditProfile(true);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setScanningPf(false); }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch { /* clipboard blocked — the text is on screen to select by hand */ }
  }

  const rankLabel = (r: number) => (r === 1 ? T('Bài chính hôm nay', "Today's main post")
    : r === 2 ? T('Quay nhanh 2 phút', 'Quick 2-minute clip')
    : T('Đăng bù khi bận', 'Fallback if busy'));
  const rankColor = (r: number) => (r === 1 ? '#6366f1' : r === 2 ? '#8b5cf6' : '#22c55e');

  /**
   * Where we think the salon is.
   *
   * A wrong guess about the neighbourhood quietly skews every suggestion on
   * this page, and the person reading it is the one who can correct it in a
   * sentence. Defined once and placed twice: in the sidebar on a desktop,
   * above the tabs on a phone. An earlier draft of this layout put it in the
   * sidebar only, which dropped the "we do not know your city" warning on
   * exactly the device most people read this on.
   */
  const regionCard = plan?.region ? (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
      fontSize: 12.5, marginBottom: 14, padding: '10px 12px', borderRadius: 9,
      background: plan.region.known ? 'var(--c1e293b)' : 'var(--c451a03)',
      border: `1px solid ${plan.region.known ? 'var(--c334155)' : 'var(--c92400e)'}`,
      color: plan.region.known ? 'var(--c94a3b8)' : 'var(--cfde68a)',
      lineHeight: 1.5,
    }}>
      <span>📍</span>
      {/* The trade is shown even when the region is not, because a business set
          to the wrong industry gets nail advice forever and nothing on screen
          would have said so. */}
      {/* The business's OWN sentence, not the four-value enum.
          An enum printed as a heading is what let "ngành nail" sit on top of a
          marketing agency's screen while every suggestion below it came out
          wrong and nothing on the page showed why. */}
      {plan.identity?.declared ? (
        <span style={{
          fontSize: 11.5, padding: '2px 8px', borderRadius: 20,
          background: 'var(--c1e293b)', color: 'var(--ca5b4fc)', border: '1px solid var(--c334155)',
        }}>
          {plan.identity.label}
        </span>
      ) : (
        <span style={{
          fontSize: 11.5, padding: '2px 8px', borderRadius: 20,
          background: 'var(--c451a03)', color: 'var(--cfde68a)', border: '1px solid var(--c92400e)',
        }}>
          {T('Chưa khai báo ngành nghề', 'Business not described yet')}
        </span>
      )}
      {plan.region.known ? (
        <span>
          {T('Gợi ý theo khu vực', 'Tailored for')} <strong style={{ color: 'var(--ce2e8f0)' }}>{plan.region.label}</strong>
          {/* Where it came from. A location the shop can see the source of is
              one the shop can correct; an unattributed one is one nobody can
              argue with. */}
          {plan.region.source ? (
            <span style={{ color: 'var(--c64748b)' }}> · {T('lấy từ', 'from')} {plan.region.source}</span>
          ) : null}
        </span>
      ) : (
        <span style={{ flex: 1, minWidth: 0 }}>
          {T('Chưa xác định được tiệm ở đâu nên lịch sự kiện chỉ có các dịp chung. ',
             'We cannot place this business yet, so only nationwide dates are shown. ')}
          {plan.region.fix ?? T('Thêm địa chỉ ở Cài đặt tiệm → Thông tin công ty.',
                                'Add the address in Salon settings → Company info.')}
        </span>
      )}
    </div>
  ) : null;

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'today', label: T('Hôm nay', 'Today'), icon: '✍️' },
    { id: 'week', label: T('Tuần này', 'This week'), icon: '🗓️' },
    { id: 'trends', label: T('Xu hướng', 'Trends'), icon: '📈' },
    { id: 'calendar', label: T('Lịch lễ', 'Calendar'), icon: '📆' },
    { id: 'audience', label: T('Khách & ưu đãi', 'Customers & offers'), icon: '🎯' },
    { id: 'ads', label: T('Quảng cáo & SEO', 'Ads & SEO'), icon: '📣' },
    { id: 'queue', label: T('Lịch đăng bài', 'Post schedule'), icon: '🚀' },
  ];

  /**
   * Where each roadmap stage's work is done.
   *
   * The stage card used to end with a sentence like "mở tab Quảng cáo & SEO" —
   * an instruction to navigate, printed on a screen that could simply navigate.
   */
  const STAGE_TAB: Record<string, { tab: TabId; label: string }> = {
    foundation: { tab: 'today', label: T('Làm nội dung hôm nay', 'Today’s content') },
    reactivate: { tab: 'audience', label: T('Xem khách lâu chưa quay lại', 'See the customers to win back') },
    'fill-gap': { tab: 'audience', label: T('Xem khung trống & ưu đãi', 'Quiet slots and offers') },
    acquire: { tab: 'ads', label: T('Xem kế hoạch quảng cáo', 'Open the ads plan') },
    keep: { tab: 'audience', label: T('Xem cách giữ khách', 'How to keep them coming back') },
  };

  const STATE_STYLE: Record<string, { bg: string; fg: string; text: string }> = {
    pass: { bg: 'var(--c14532d)', fg: 'var(--cbbf7d0)', text: T('Đạt', 'Pass') },
    warn: { bg: 'var(--c451a03)', fg: 'var(--cfde68a)', text: T('Cần siết', 'Tighten') },
    fail: { bg: 'var(--c450a0a)', fg: 'var(--cfca5a5)', text: T('Đang chặn', 'Blocking') },
    unknown: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)', text: T('Chưa đo được', 'No data') },
  };

  const money = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
  const COST_LABEL: Record<string, { text: string; color: string }> = {
    low: { text: T('rẻ', 'cheap'), color: '#22c55e' },
    medium: { text: T('vừa', 'medium'), color: '#f59e0b' },
    high: { text: T('đắt', 'expensive'), color: '#ef4444' },
  };

  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {/* On a phone there is no sidebar to dock into, so the shared thread is
          a button that opens full screen. On a desktop it lives in the sidebar
          instead — see the aside below. */}
      {isMobile && <TeamChatWindow token={token} unread={unread.total} vi={vi} />}

      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          {/* "Nội dung hôm nay" named ONE of seven tabs. The date belongs with
              it — on the Today tab — not in a heading that also covers the week
              plan, the ads budget and the publishing queue. */}
          <h1 style={{ fontSize: isMobile ? 20 : 23, margin: '0 0 3px', color: 'var(--ce2e8f0)' }}>
            {T('Kế hoạch & bài đăng', 'Marketing plan & posts')}
          </h1>
          <p style={{ color: 'var(--c94a3b8)', margin: 0, fontSize: 13 }}>
            {tab === 'today' && data?.forDate
              ? `${new Date(`${data.forDate}T00:00:00`).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}${plan?.region?.known ? ` · ${plan.region.label}` : ''}`
              : plan?.region?.known ? plan.region.label : ''}
          </p>
        </div>
        <button
          onClick={refreshIdeas}
          disabled={refreshing}
          style={{
            ...ui.primaryBtn, padding: '10px 16px', fontSize: 13.5,
            opacity: refreshing ? 0.6 : 1, cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? T('Đang tạo lại…', 'Drafting…') : `↻ ${T('Cập nhật ngay', 'Refresh now')}`}
        </button>
      </div>

      {refreshMsg && (
        <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '9px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {refreshMsg}
        </div>
      )}

      {error && <div style={{ ...ui.banner, marginBottom: 12 }}>{error}</div>}

      {isMobile && regionCard}

      {/* This screen outgrew a single scroll: on a phone the holiday calendar
          sat six swipes below the ideas, so nobody ever reached it. Four tabs,
          and the one that matters most opens first. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 2 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: isMobile ? '1 0 auto' : '0 0 auto',
              padding: isMobile ? '9px 12px' : '9px 16px',
              borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 13.5, fontWeight: tab === t.id ? 700 : 500,
              border: `1px solid ${tab === t.id ? '#6366f1' : 'var(--c334155)'}`,
              background: tab === t.id ? '#6366f1' : 'var(--c1e293b)',
              color: tab === t.id ? '#fff' : 'var(--c94a3b8)',
            }}
          >
            <span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}
            {/* The red count is the whole reason the queue can stay a tab
                rather than a menu item: a broken post finds the person instead
                of waiting to be found. */}
            {t.id === 'queue' && postAlerts > 0 && (
              <span style={{
                marginLeft: 6, minWidth: 19, height: 19, padding: '0 5px',
                borderRadius: 20, background: '#ef4444', color: '#fff',
                fontSize: 11, fontWeight: 800, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
              }}>{postAlerts > 9 ? '9+' : postAlerts}</span>
            )}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--c94a3b8)', fontSize: 14 }}>{T('Đang tải…', 'Loading…')}</p>}

      {/* Desktop keeps a standing summary beside the work, so the region, the
          week's aim and the discount verdict never scroll out of sight. A phone
          has no room for two columns, so that summary folds back into the tabs
          it was drawn from. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 300px',
        gap: 16, alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>
          {tab === 'today' && (
            <>
              {/* ---- what this business is ----
                  Shown first and loudly while it is missing, because every
                  other suggestion on this screen is derived from it. The system
                  used to fall back to a four-value industry code, which cannot
                  express "marketing for Vietnamese-owned businesses in the US"
                  — so it silently produced nail-salon advice instead. */}
              {/* ---- learn the business, without asking it to type ----
                  Everything here already exists in the shop's own setup: the
                  website, the connected Page, 36 services with descriptions. A
                  six-field form is asking someone to re-enter data we hold. So
                  the default is one button and one optional note; the fields
                  stay available behind "Sửa" for the corrections a machine
                  cannot make. */}
              {!plan?.identity?.declared && !editProfile && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16, borderColor: '#f59e0b' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
                    🏷️ {T('Học về doanh nghiệp này', 'Learn this business')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginBottom: 10 }}>
                    {T('Hệ thống đọc website, trang Facebook đã kết nối và toàn bộ dịch vụ đã khai trong tiệm, rồi tự học. Anh không cần nhập lại gì.',
                       'Reads the website, the connected Facebook Page and every service already in the system, then learns from them. Nothing to re-enter.')}
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>
                    {T('Lưu ý thêm trước khi quét (tuỳ chọn)', 'Anything to note first (optional)')}
                  </div>
                  <textarea
                    value={pfNote}
                    rows={2}
                    placeholder={T('VD: đây KHÔNG phải tiệm nail, chúng tôi làm marketing cho các tiệm nail',
                                   'e.g. this is NOT a nail salon — we do marketing FOR nail salons')}
                    onChange={(e) => setPfNote(e.target.value)}
                    style={{ ...ui.input, resize: 'vertical', fontFamily: 'inherit', marginBottom: 10 }}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5, marginBottom: 10 }}>
                    {T('Đây là điều máy không tự biết được: thứ website không nói ra, hoặc điều website khiến người ta hiểu nhầm. Nó được giữ lại qua mọi lần quét sau.',
                       'The one thing a machine cannot produce: what the website does not say, or what it wrongly implies. Kept across every future scan.')}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={scanProfile} disabled={scanningPf} style={{ ...ui.primaryBtn, opacity: scanningPf ? 0.6 : 1 }}>
                      {scanningPf ? T('Đang đọc & học…', 'Reading & learning…') : `↻ ${T('Quét & học tự động', 'Scan & learn')}`}
                    </button>
                    <button onClick={() => setEditProfile(true)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}>
                      {T('Nhập tay', 'Type it instead')}
                    </button>
                  </div>

                  {pfScan && (
                    <div style={{ marginTop: 12 }}>
                      {!!pfScan.sources.length && (
                        <div style={{ fontSize: 12, color: 'var(--cbbf7d0)', lineHeight: 1.5 }}>
                          {T('Đã đọc', 'Read from')}: {pfScan.sources.join(' · ')}
                        </div>
                      )}
                      {pfScan.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.5, marginTop: 2 }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {editProfile && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16, borderColor: 'var(--c334155)' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
                    🏷️ {T('Sửa mô tả doanh nghiệp', 'Edit the description')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginBottom: 10 }}>
                    {T('Mọi gợi ý bên dưới đều dựa vào phần này. Chưa điền thì hệ thống chỉ còn một mã ngành bốn giá trị để đoán — và gợi ý sẽ nghe hợp lý nhưng sai nghề.',
                       'Everything below is derived from this. Without it the system has only a four-value industry code to reason from, and the advice comes out fluent and wrong.')}
                  </div>

                  {/* Read what the business already published, rather than
                      asking it to type what it already said. */}
                  <div style={{ marginBottom: 12 }}>
                    <button onClick={scanProfile} disabled={scanningPf} style={{ ...ui.primaryBtn, opacity: scanningPf ? 0.6 : 1 }}>
                      {scanningPf
                        ? T('Đang đọc website & fanpage…', 'Reading website & page…')
                        : `↻ ${T('Tự điền từ website & fanpage', 'Fill from website & page')}`}
                    </button>
                    <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 5, lineHeight: 1.5 }}>
                      {T('Đọc website trong cài đặt tiệm và trang Facebook đã kết nối. Kết quả điền vào ô bên dưới dạng NHÁP — anh đọc lại rồi mới lưu.',
                         'Reads the website in your settings and the connected Facebook Page. The result lands below as a draft to review before saving.')}
                    </div>
                  </div>

                  {pfScan && (
                    <div style={{ marginBottom: 12 }}>
                      {!!pfScan.sources.length && (
                        <div style={{ fontSize: 12, color: 'var(--cbbf7d0)', lineHeight: 1.5, marginBottom: 3 }}>
                          {T('Đã đọc', 'Read from')}: {pfScan.sources.join(' · ')}
                        </div>
                      )}
                      {pfScan.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.5 }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}

                  {([
                    ['whatWeDo', T('Doanh nghiệp làm gì', 'What you do'), T('VD: Dịch vụ marketing cho doanh nghiệp của người Việt tại Mỹ', 'e.g. Marketing services for Vietnamese-owned businesses in the US')],
                    ['whoWeServe', T('Phục vụ ai', 'Who you serve'), T('VD: Chủ tiệm nail, nhà hàng người Việt ở Texas và California', 'e.g. Vietnamese salon and restaurant owners in TX and CA')],
                    ['languages', T('Ngôn ngữ', 'Languages'), T('VD: Tiếng Việt, English', 'e.g. Vietnamese, English')],
                    ['serviceArea', T('Khu vực phục vụ', 'Service area'), T('VD: Toàn nước Mỹ, làm từ xa — hoặc: bán kính 5 dặm quanh tiệm', 'e.g. Nationwide, remote — or: 5-mile radius')],
                    ['edge', T('Điểm khác biệt', 'What sets you apart'), T('Vì sao khách chọn mình thay vì chỗ khác', 'Why customers choose you')],
                    ['avoid', T('KHÔNG được giả định điều gì', 'Never assume'), T('VD: Đây KHÔNG phải tiệm nail — đừng gợi ý nội dung ngành nail', 'e.g. This is NOT a nail salon')],
                  ] as const).map(([k, label, ph]) => (
                    <div key={k} style={{ marginBottom: 9 }}>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 3 }}>{label}</div>
                      <textarea
                        value={pf[k]}
                        placeholder={ph}
                        rows={k === 'whatWeDo' || k === 'whoWeServe' ? 2 : 1}
                        onChange={(e) => setPf({ ...pf, [k]: e.target.value })}
                        style={{ ...ui.input, resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                  ))}

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={saveProfile} disabled={savingPf} style={{ ...ui.primaryBtn, opacity: savingPf ? 0.6 : 1 }}>
                      {savingPf ? T('Đang lưu…', 'Saving…') : T('Lưu mô tả', 'Save')}
                    </button>
                    {plan?.identity?.declared && (
                      <button onClick={() => setEditProfile(false)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}>
                        {T('Đóng', 'Close')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Declared: a quiet summary with the provenance, and a way back in. */}
              {plan?.identity?.declared && !editProfile && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 14 }}>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--c64748b)', marginBottom: 3 }}>
                        {T('Hệ thống đang hiểu doanh nghiệp này là', 'The system understands this business as')}
                      </div>
                      <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.55 }}>{plan.identity.profile.whatWeDo}</div>
                      {plan.identity.profile.whoWeServe && (
                        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>
                          {T('Phục vụ', 'Serving')}: {plan.identity.profile.whoWeServe}
                        </div>
                      )}
                      {pfScan?.locationSaved && (
                        <div style={{ fontSize: 12, color: 'var(--cbbf7d0)', marginTop: 4 }}>
                          {T('Đã tự điền vị trí tiệm', 'Location filled in')}: {pfScan.locationSaved}
                        </div>
                      )}
                      {!!plan.identity.provenance.length && (
                        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 4 }}>
                          {T('Nguồn', 'From')}: {plan.identity.provenance.join(' · ')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={scanProfile} disabled={scanningPf} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', whiteSpace: 'nowrap', opacity: scanningPf ? 0.6 : 1 }}>
                        {scanningPf ? T('Đang đọc…', 'Reading…') : T('Quét lại', 'Rescan')}
                      </button>
                      <button onClick={() => setEditProfile(true)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>
                        {T('Sửa', 'Edit')}
                      </button>
                    </div>
                  </div>

                  {/* ---- which language the PLAN is written in ----
                       Deliberately separate from the EN/VI switch at the top of
                       the app. A Vietnamese owner running a salon in Texas wants
                       the plan explained in Vietnamese and the captions written
                       in English, because her customers are American. One toggle
                       cannot serve both, so there are two. */}
                  <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--c1e293b)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
                      {T('AI viết kế hoạch bằng', 'The AI writes the plan in')}
                    </span>
                    {([
                      [null, T('Tiếng Việt · caption tiếng Anh', 'Vietnamese · English captions')],
                      ['en', T('Tất cả tiếng Anh', 'All English')],
                    ] as const).map(([code, label]) => {
                      const on = (plan.contentLang ?? null) === code;
                      return (
                        <button
                          key={String(code)}
                          onClick={async () => {
                            try {
                              await apiFetch('/content/language', { method: 'PATCH', token, body: { lang: code ?? 'auto' } });
                              await load();
                            } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
                          }}
                          style={{
                            fontSize: 11.5, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                            border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`,
                            background: on ? '#6366f1' : 'transparent',
                            color: on ? '#fff' : 'var(--c94a3b8)', fontWeight: on ? 700 : 500,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    <span style={{ fontSize: 11, color: 'var(--c64748b)', width: '100%', lineHeight: 1.5 }}>
                      {T('Đổi xong bấm "Cập nhật ngay" để soạn lại bài của hôm nay.',
                         'After changing this, press “Refresh now” to redraft today’s ideas.')}
                    </span>
                  </div>

                  {!!plan.identity.gaps.length && (
                    <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--c1e293b)' }}>
                      {plan.identity.gaps.slice(0, 2).map((g) => (
                        <div key={g.field} style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.5, marginBottom: 2 }}>
                          {T('Còn thiếu', 'Missing')} — {g.label}: {g.cost}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {data?.trendNotes?.map((n) => (
                <div key={n.id} style={{ background: 'var(--c451a03)', border: '1px solid var(--c92400e)', borderRadius: 10, padding: '11px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cfcd34d)', marginBottom: 3 }}>🔥 {n.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--cfde68a)', lineHeight: 1.55 }}>{n.body}</div>
                </div>
              ))}
              {!loading && !data?.ideas?.length && (
                <div style={{ ...ui.card, textAlign: 'center', padding: '28px 20px' }}>
                  <div style={{ fontSize: 15, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    {T('Hôm nay chưa có gợi ý', 'No plan for today yet')}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
                    {T('Đội Lumio đang chuẩn bị kế hoạch nội dung cho tiệm. Kiểm tra lại sau nhé.',
                       'The Lumio team is preparing your plan. Check back shortly.')}
                  </div>
                </div>
              )}
              {data?.ideas?.map((idea) => {
                const done = idea.status === 'filmed' || idea.status === 'posted';
                const skipped = idea.status === 'skipped';
                return (
                  <div key={idea.id} style={{
                    ...ui.card, marginBottom: 14, padding: 16,
                    opacity: skipped ? 0.55 : 1,
                    borderColor: done ? '#22c55e' : 'var(--c334155)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
                      <span style={{ background: rankColor(idea.rank), color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6 }}>
                        {rankLabel(idea.rank)}
                      </span>
                      {idea.formatName && (
                        <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{idea.formatName}</span>
                      )}
                      {idea.bestTime && (
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c94a3b8)' }}>
                          🕐 {idea.bestTime}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.4, marginBottom: 8 }}>
                      {idea.title}
                    </div>

                    {idea.hook && (
                      <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginBottom: 10 }}>
                        <b style={{ color: 'var(--ca5b4fc)' }}>{T('Mở đầu 3 giây', 'First 3 seconds')}:</b> {idea.hook}
                      </div>
                    )}

                    {idea.shotList && (
                      <div style={{ background: 'var(--c1e293b)', borderRadius: 8, padding: '9px 12px', marginBottom: 10 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          {T('Cần quay', 'Shots')}
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.6 }}>{idea.shotList}</div>
                      </div>
                    )}

                    {idea.caption && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Caption</span>
                          <button
                            onClick={() => copy(idea.id, `${idea.caption}${idea.hashtags ? `\n\n${idea.hashtags}` : ''}`)}
                            style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c334155)', background: 'transparent', color: copied === idea.id ? '#22c55e' : 'var(--ca5b4fc)', fontSize: 12, cursor: 'pointer' }}
                          >
                            {copied === idea.id ? T('✓ Đã chép', '✓ Copied') : T('Chép', 'Copy')}
                          </button>
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{idea.caption}</div>
                        {idea.hashtags && (
                          <div style={{ fontSize: 12.5, color: 'var(--c60a5fa)', marginTop: 5, lineHeight: 1.5 }}>{idea.hashtags}</div>
                        )}
                      </div>
                    )}

                    {idea.reason && (
                      <div style={{ background: 'var(--c172554)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: 'var(--c93c5fd)', fontWeight: 700 }}>{T('Vì sao gợi ý', 'Why this')}: </span>
                        <span style={{ fontSize: 12.5, color: 'var(--cbfdbfe)', lineHeight: 1.6 }}>{idea.reason}</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => mark(idea.id, done ? 'published' : 'posted')}
                        disabled={busy === idea.id}
                        style={{
                          flex: '1 1 auto', minHeight: 42, padding: '10px 14px', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                          border: done ? '1px solid #22c55e' : 'none',
                          background: done ? 'transparent' : '#6366f1',
                          color: done ? '#22c55e' : '#fff',
                        }}
                      >
                        {done ? T('✓ Đã đăng', '✓ Posted') : T('Đánh dấu đã đăng', 'Mark as posted')}
                      </button>
                      {/* The step the plan used to stop short of. Copying text
                          into Facebook is what a technician with both hands wet
                          does not do — so the schedule is the product, not the
                          text. */}
                      <button
                        onClick={() => scheduleFromIdea(idea)}
                        style={{
                          minHeight: 42, padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                          border: '1px solid #6366f1', background: 'transparent', color: 'var(--ca5b4fc)',
                          fontSize: 13.5, fontWeight: 600,
                        }}
                      >
                        🚀 {T('Hẹn giờ đăng', 'Schedule it')}
                      </button>
                      {!done && (
                        <button
                          onClick={() => mark(idea.id, skipped ? 'published' : 'skipped')}
                          disabled={busy === idea.id}
                          style={{ minHeight: 42, padding: '10px 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13.5, cursor: 'pointer' }}
                        >
                          {skipped ? T('Bỏ qua ✓', 'Skipped ✓') : T('Bỏ qua', 'Skip')}
                        </button>
                      )}
                    </div>

                    {/* ---- where it went up ----
                        A post nobody can open is a post nobody can check. The
                        link is what turns "we posted 8 things" into 8 things a
                        client can click, and it is the only field in the weekly
                        record that is verifiable from outside this system. */}
                    {done && (
                      <div style={{ marginTop: 9 }}>
                        {idea.postedUrl && linkFor !== idea.id ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <a
                              href={idea.postedUrl} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 12.5, color: 'var(--c60a5fa)', wordBreak: 'break-all' }}
                            >
                              🔗 {T('Xem bài đã đăng', 'Open the post')}
                            </a>
                            <button
                              onClick={() => { setLinkFor(idea.id); setLinkDraft(idea.postedUrl ?? ''); }}
                              style={{ fontSize: 11.5, background: 'transparent', border: 'none', color: 'var(--c64748b)', cursor: 'pointer', padding: 0 }}
                            >
                              {T('sửa', 'edit')}
                            </button>
                          </div>
                        ) : linkFor === idea.id ? (
                          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                            <input
                              value={linkDraft}
                              onChange={(e) => setLinkDraft(e.target.value)}
                              placeholder="https://facebook.com/..."
                              autoFocus
                              style={{
                                flex: '1 1 200px', minHeight: 40, padding: '9px 11px', borderRadius: 8, fontSize: 13,
                                border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)',
                              }}
                            />
                            <button
                              onClick={async () => {
                                await mark(idea.id, 'posted', linkDraft.trim());
                                setLinkFor(null);
                              }}
                              disabled={busy === idea.id || !/^https:\/\//i.test(linkDraft.trim())}
                              style={{
                                minHeight: 40, padding: '9px 15px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                border: 'none', cursor: 'pointer',
                                background: /^https:\/\//i.test(linkDraft.trim()) ? '#6366f1' : 'var(--c334155)',
                                color: /^https:\/\//i.test(linkDraft.trim()) ? '#fff' : 'var(--c64748b)',
                              }}
                            >
                              {T('Lưu link', 'Save link')}
                            </button>
                            <button
                              onClick={() => setLinkFor(null)}
                              style={{ minHeight: 40, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer' }}
                            >
                              {T('Huỷ', 'Cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setLinkFor(idea.id); setLinkDraft(''); }}
                            style={{
                              fontSize: 12.5, padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                              border: '1px dashed var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)',
                            }}
                          >
                            🔗 {T('Dán link bài đã đăng', 'Paste the link to the post')}
                          </button>
                        )}
                      </div>
                    )}

                    <ItemComments
                      token={token}
                      subject={`idea:${idea.id}`}
                      unread={unread.bySubject[`idea:${idea.id}`] ?? 0}
                      vi={vi}
                    />
                  </div>
                );
              })}
            </>
          )}
          {tab === 'week' && (
            <>
              {/* ---- the week as work, not as advice ----
                   Days come from this salon's own book: it films on its quietest open
                   day and posts the offer two days before its emptiest block. When the
                   book is too thin to say that, the card says so instead of dressing a
                   default up as analysis. */}
              {/* ---- the archive ----
                   The plan used to be recomputed on every read and kept
                   nowhere, so last week's plan ceased to exist on Monday. Now
                   every week is frozen and reachable, and the salon and the
                   team can point at what was actually agreed. */}
              {weeks.length > 1 && (
                <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
                  <WeekChip active={!viewWeek} onClick={() => { setViewWeek(null); setEditing(false); }}>
                    {T('Tuần này', 'This week')}
                  </WeekChip>
                  {weeks.filter((w) => w.weekKey !== plan?.weekMeta?.weekKey).map((w) => (
                    <WeekChip key={w.weekKey} active={viewWeek === w.weekKey} onClick={() => { setViewWeek(w.weekKey); setEditing(false); }}>
                      {w.label}{w.edited ? ' ✎' : ''}
                    </WeekChip>
                  ))}
                </div>
              )}

              {/* ---- what the last weeks produced ----
                   The archive used to hold intentions and nothing else: open
                   week 35 and you saw what was meant to happen, never what did.
                   The work and the numbers sit side by side with no arrow drawn
                   between them — nothing in this data can prove the post caused
                   the booking, and a figure that looks like proof and is not is
                   the one a client spends money on. */}
              {weeks.some((w) => w.outcome) && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    📊 {T('Các tuần đã qua làm được gì', 'What the past weeks produced')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, lineHeight: 1.5 }}>
                    {T('Việc đã làm và số liệu của tiệm đặt cạnh nhau. Hệ thống KHÔNG kết luận bài đăng tạo ra booking — không dữ liệu nào chứng minh được điều đó.',
                       'Work done and the salon’s numbers, side by side. The system does not claim the posts caused the bookings — nothing here can prove that.')}
                  </div>
                  {weeks.filter((w) => w.outcome).slice(0, 6).map((w) => (
                    <div key={w.weekKey} style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap',
                      padding: '10px 12px', marginBottom: 7, borderRadius: 9,
                      background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
                    }}>
                      <button
                        onClick={() => { setViewWeek(w.weekKey); setEditing(false); }}
                        style={{
                          fontSize: 12.5, fontWeight: 700, color: 'var(--ca5b4fc)', cursor: 'pointer',
                          background: 'transparent', border: 'none', padding: 0, flex: '0 0 92px', textAlign: 'left',
                        }}
                      >{w.label}</button>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5 }}>{w.outcomeLine}</div>
                        {w.deltaLine && (
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{w.deltaLine}</div>
                        )}
                        {w.focus && (
                          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 3, lineHeight: 1.45 }}>
                            {T('Trọng tâm', 'Focus')}: {w.focus}
                          </div>
                        )}
                      </div>
                      {w.outcome && w.outcome.plannedJobs > 0 && (
                        <div style={{ flex: '0 0 74px' }}>
                          <div style={{ height: 6, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, Math.round((w.outcome.doneJobs / w.outcome.plannedJobs) * 100))}%`,
                              height: '100%',
                              background: w.outcome.doneJobs >= w.outcome.plannedJobs * 0.7 ? '#22c55e' : '#f59e0b',
                            }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--c64748b)', marginTop: 3 }}>
                            {w.outcome.doneJobs}/{w.outcome.plannedJobs} {T('việc', 'jobs')}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {viewWeek && !past && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16, color: 'var(--c94a3b8)', fontSize: 13 }}>
                  {T('Đang mở tuần cũ…', 'Opening that week…')}
                </div>
              )}

              {(() => {
                const shown = viewWeek ? past?.week : plan?.week;
                const isPast = Boolean(viewWeek);
                if (!shown?.days?.length) return null;
                return (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                      🗓️ {viewWeek ? past?.label : T('Tuần này làm gì', 'This week')}
                    </div>
                    {/* Editing is the team's, not the salon's. The salon reads
                        the plan and marks work done; one plan two people can
                        rewrite from opposite ends is a plan neither trusts. */}
                    {!isPast && plan?.weekMeta?.canEdit && (
                      <button
                        onClick={() => {
                          setDraftFocus(shown.focus);
                          setDraftNote(shown.teamNote ?? '');
                          setEditing((e) => !e);
                        }}
                        style={{
                          fontSize: 12.5, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                          border: '1px solid #6366f1', background: editing ? '#6366f1' : 'transparent',
                          color: editing ? 'var(--cf8fafc)' : 'var(--ca5b4fc)', fontWeight: 600,
                        }}
                      >
                        {editing ? T('Đóng', 'Close') : T('✎ Sửa kế hoạch', '✎ Edit plan')}
                      </button>
                    )}
                    {/* The salon's half of the same bar: it cannot rewrite the
                        plan, but it can say yes to it. Approval written on the
                        week row, not into the chat — an approval buried in a
                        thread is one nobody can find on the Friday somebody
                        asks whether the budget was agreed. */}
                    {!isPast && plan?.weekMeta && !plan.weekMeta.canEdit && !plan.weekMeta.approvedAt && (
                      <button
                        onClick={approveWeek}
                        disabled={approving}
                        style={{
                          fontSize: 12.5, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                          border: 'none', background: '#22c55e', color: '#052e16', fontWeight: 700,
                        }}
                      >
                        {approving ? T('Đang lưu…', 'Saving…') : T('✓ Duyệt kế hoạch tuần', '✓ Approve this week')}
                      </button>
                    )}
                    {!isPast && plan?.weekMeta?.approvedAt && (
                      <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                        ✓ {T('Tiệm đã duyệt', 'Approved by the salon')}
                        {plan.weekMeta.approvedByName ? ` — ${plan.weekMeta.approvedByName}` : ''}
                      </span>
                    )}
                  </div>
                  {plan?.weekMeta?.edited && !isPast && (
                    <div style={{ fontSize: 11.5, color: 'var(--ca5b4fc)', marginBottom: 4 }}>
                      ✎ {T('Đã được team chỉnh', 'Edited by the team')}
                      {plan.weekMeta.editedByName ? ` — ${plan.weekMeta.editedByName}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--ca5b4fc)', marginBottom: 4 }}>{shown.focus}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, fontStyle: 'italic' }}>{shown.basis}</div>

                  {/* A note from the team to the salon, above everything else —
                      the human sentence the numbers cannot write. */}
                  {shown.teamNote && !editing && (
                    <div style={{
                      fontSize: 13, lineHeight: 1.6, marginBottom: 12, padding: '10px 12px',
                      borderRadius: 9, background: 'var(--c1e1b4b)', color: 'var(--ce2e8f0)',
                      border: '1px solid #6366f1',
                    }}>
                      <b style={{ color: 'var(--ca5b4fc)' }}>{T('Lumio nhắn', 'From Lumio')}:</b> {shown.teamNote}
                    </div>
                  )}

                  {editing && !isPast && (
                    <div style={{
                      padding: 12, marginBottom: 12, borderRadius: 10,
                      background: 'var(--c1e293b)', border: '1px solid #6366f1',
                    }}>
                      <label style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'block', marginBottom: 4 }}>
                        {T('Trọng tâm tuần này', 'This week’s focus')}
                      </label>
                      <input
                        value={draftFocus}
                        onChange={(e) => setDraftFocus(e.target.value)}
                        style={{ ...ui.input, width: '100%', marginBottom: 10, boxSizing: 'border-box' }}
                      />
                      <label style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'block', marginBottom: 4 }}>
                        {T('Lời nhắn cho tiệm (hiện phía trên kế hoạch)', 'Note to the salon')}
                      </label>
                      <textarea
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        rows={3}
                        style={{ ...ui.input, width: '100%', resize: 'vertical', marginBottom: 10, boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          disabled={savingWeek}
                          onClick={async () => {
                            if (!plan?.weekMeta) return;
                            setSavingWeek(true);
                            try {
                              await apiFetch(`/content/weeks/${encodeURIComponent(plan.weekMeta.weekKey)}`, {
                                method: 'PATCH', token, body: { focus: draftFocus, note: draftNote },
                              });
                              setEditing(false);
                              await load();
                              apiFetch<(WeekRow & { en?: WeekRow })[]>('/content/weeks', { token }).then(setWeeksRaw).catch(() => undefined);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Không lưu được');
                            } finally { setSavingWeek(false); }
                          }}
                          style={{ ...ui.primaryBtn, opacity: savingWeek ? 0.6 : 1 }}
                        >
                          {savingWeek ? T('Đang lưu…', 'Saving…') : T('Lưu cho tiệm', 'Save for the salon')}
                        </button>
                        <button
                          onClick={() => setEditing(false)}
                          style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)' }}
                        >
                          {T('Huỷ', 'Cancel')}
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 8, lineHeight: 1.5 }}>
                        {T('Bản hệ thống tự viết vẫn được giữ nguyên bên dưới — để sau này so được sửa gì và có tốt hơn không.',
                           'The system’s own version is kept underneath, so what changed stays answerable.')}
                      </div>
                    </div>
                  )}

                  {/* The path, and where this shop stands on it.
                      The stage moves when its exit condition is MET, never
                      because a week went by — telling a shop to buy ads because
                      three weeks passed is how money goes into a Google profile
                      with two photos on it. */}
                  {shown.stage && (
                    <div style={{
                      padding: '11px 13px', marginBottom: 12, borderRadius: 10,
                      background: 'var(--c1e293b)', border: '1px solid #6366f1',
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                          background: 'var(--c0f172a)', color: 'var(--ca5b4fc)',
                        }}>
                          {T('Giai đoạn', 'Stage')} {shown.stage.step}/5
                        </span>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{shown.stage.title}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 'auto' }}>
                          {T('Tuần', 'Week')} {shown.week + 1}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>{shown.stage.goal}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 4 }}>{shown.stage.why}</div>

                      {shown.stage.progress && shown.stage.progress.need > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ height: 7, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, Math.round((shown.stage.progress.done / shown.stage.progress.need) * 100))}%`,
                              height: '100%', background: '#6366f1',
                            }} />
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 4 }}>
                            {shown.stage.progress.done}/{shown.stage.progress.need} {shown.stage.progress.label}
                          </div>
                        </div>
                      )}

                      <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5, marginTop: 7 }}>
                        <b>{T('Xong giai đoạn này khi', 'Done when')}:</b> {shown.stage.exitWhen}
                      </div>

                      {/* The stage said what to do and then left the reader to
                          find the screen that does it. Every stage now carries
                          the door: one press, no hunting through six tabs. */}
                      {(() => {
                        const go = STAGE_TAB[shown.stage.key];
                        if (!go) return null;
                        return (
                          <button
                            onClick={() => setTab(go.tab)}
                            style={{
                              marginTop: 9, width: '100%', minHeight: 40, borderRadius: 9, cursor: 'pointer',
                              border: '1px solid #6366f1', background: 'transparent',
                              color: 'var(--ca5b4fc)', fontSize: 13, fontWeight: 600,
                            }}
                          >
                            {go.label} →
                          </button>
                        );
                      })()}
                    </div>
                  )}

                  {shown.days.map((d, i) => {
                    const empty = d.jobs.every((j) => j.kind === 'rest');
                    return (
                      <div key={d.weekday} style={{
                        padding: '9px 0', borderTop: '1px solid var(--c1e293b)',
                        opacity: empty ? 0.55 : 1,
                      }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                          <div style={{ flex: '0 0 76px', fontSize: 13, fontWeight: 700, color: i === 0 ? '#f59e0b' : 'var(--c94a3b8)' }}>
                            {i === 0 ? T('Hôm nay', 'Today') : d.label}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {d.jobs.map((j, k) => (
                              <div key={k} style={{ marginBottom: k < d.jobs.length - 1 ? 8 : 0 }}>
                                <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5 }}>
                                  <span style={{ marginRight: 6 }}>{JOB_ICON[j.kind] ?? '•'}</span>{j.text}
                                  {j.when && <span style={{ color: 'var(--c64748b)', fontSize: 12 }}> · {j.when}</span>}
                                </div>
                                {j.kind !== 'rest' && (
                                  <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 1 }}>{j.why}</div>
                                )}
                              </div>
                            ))}
                            {/* Today's row is the one the salon is standing in
                                front of. It links to the actual drafted post,
                                so the week stops being a list of instructions
                                with no way to act on them. */}
                            {i === 0 && !empty && !isPast && !!data?.ideas?.length && (
                              <button
                                onClick={() => setTab('today')}
                                style={{
                                  marginTop: 7, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                                  border: '1px solid var(--c475569)', background: 'transparent',
                                  color: 'var(--ca5b4fc)', fontSize: 12.5, fontWeight: 600,
                                }}
                              >
                                {T('Mở bài viết đã soạn cho hôm nay', 'Open today’s drafted post')} →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Where today's clip comes FROM. The most common reason a content
                      plan dies is not laziness — it is standing in the salon at 6pm
                      with nothing filmed and no idea what to point the phone at. */}
                  {!!shown.sources?.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                        {T('Quay từ đâu', 'What to film')}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 6 }}>
                        {T(`Nguồn có sẵn của ${shown.trade} — không cần dựng cảnh`, 'Already in front of you — nothing to stage')}
                      </div>
                      {shown.sources.map((s, k) => (
                        <div key={k} style={{ padding: '5px 0' }}>
                          <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                            • {s.label} <span style={{ color: '#f59e0b', fontSize: 12 }}>· {s.when}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45, paddingLeft: 11 }}>{s.why}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!shown.daily?.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                        {T('Mỗi ngày, dù bận cỡ nào', 'Every day, however busy')}
                      </div>
                      {shown.daily.map((j, k) => (
                        <div key={k} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
                          <span style={{ flex: '0 0 auto' }}>{JOB_ICON[j.kind] ?? '•'}</span>
                          <div>
                            <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                              {j.text}{j.when && <span style={{ color: 'var(--c64748b)' }}> · {j.when}</span>}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45 }}>{j.why}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Trao đổi về đúng tuần này. The address carries the week,
                      so a comment written in September is still attached to
                      September when it is read in October. */}
                  {plan?.weekMeta?.weekKey && (
                    <ItemComments
                      token={token}
                      subject={`week:${viewWeek ?? plan.weekMeta.weekKey}`}
                      unread={unread.bySubject[`week:${viewWeek ?? plan.weekMeta.weekKey}`] ?? 0}
                      labelVi={vi ? 'Trao đổi về tuần này' : 'Discuss this week'}
                      vi={vi}
                    />
                  )}
                </div>
                );
              })()}

              {/* ---- the discount decision, straight from the booking book ---- */}
              {plan?.offer && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: 16,
                  borderColor: plan.offer.kind === 'raise-price' ? '#22c55e' : plan.offer.kind === 'hold' ? 'var(--c334155)' : '#6366f1',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    💰 {T('Kéo khách & doanh thu', 'Fill the book')}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: plan.offer.kind === 'raise-price' ? '#22c55e' : 'var(--ca5b4fc)', marginBottom: 5, lineHeight: 1.45 }}>
                    {plan.offer.headline}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{plan.offer.detail}</div>

                  {!!plan.offer.protect?.length && (
                    <div style={{ background: 'var(--c450a0a)', border: '1px solid var(--c991b1b)', borderRadius: 8, padding: '8px 11px', marginTop: 9 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--cfca5a5)' }}>
                        <b>{T('Không giảm giá', 'Do not discount')}:</b> {plan.offer.protect.join(' · ')} — {T('đang gần kín, giảm là mất lãi', 'nearly full; discounting here just costs margin')}
                      </span>
                    </div>
                  )}

                  {!!plan.quietSlots?.length && (
                    <div style={{ marginTop: 9 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        {T('Khung trống nhất', 'Quietest slots')}
                      </div>
                      {plan.quietSlots.map((q) => (
                        <div key={q.label} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                          <span style={{ fontSize: 13, color: 'var(--ccbd5e1)', flex: '0 0 128px' }}>{q.label}</span>
                          <span style={{ flex: 1, height: 7, background: 'var(--c1e293b)', borderRadius: 4, overflow: 'hidden' }}>
                            <span style={{ display: 'block', height: '100%', width: `${Math.max(3, q.fillIndex)}%`, background: q.fillIndex <= 30 ? '#f59e0b' : '#6366f1' }} />
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--c94a3b8)', flex: '0 0 34px', textAlign: 'right' }}>{q.fillIndex}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!plan.lapsed?.count && (
                    <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--c1e293b)' }}>
                      {T(`${plan.lapsed.count} khách lâu chưa quay lại`, `${plan.lapsed.count} customers overdue`)}
                      {plan.lapsed.medianDaysAway ? ` · ${T('trung bình', 'median')} ${plan.lapsed.medianDaysAway} ${T('ngày', 'days')}` : ''}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {tab === 'trends' && (
            <>
              {/* ---- trend sources ----
                   Deep links into the real tools, filtered to this salon's country,
                   state and trade. Never a link to an individual clip: a fabricated
                   video URL costs the salon a click and costs this screen its
                   credibility. Human-picked clips arrive as trend notes above. */}
              {!!plan?.trends?.weekly?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    📈 {T('Xu hướng đang chạy', 'What is trending')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c64748b)', marginBottom: 10, lineHeight: 1.5 }}>
                    {plan.trends.regionKnown
                      ? T('Đã lọc sẵn theo ngành và khu vực của tiệm. Mở ra là thấy số liệu hôm nay.',
                          'Pre-filtered to your trade and area. Live data, not a snapshot.')
                      : T('Đang lọc theo cả nước vì chưa biết tiệm ở bang nào.',
                          'Filtered nationwide — we do not know the state yet.')}
                  </div>

                  {([['weekly', T('Tuần này', 'This week')], ['monthly', T('Tháng này', 'This month')]] as const).map(([bucket, label]) => (
                    <div key={bucket} style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 6 }}>{label}</div>
                      {plan.trends[bucket].map((l) => (
                        <a
                          key={l.key}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block', textDecoration: 'none', padding: '9px 11px', marginBottom: 7,
                            borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c1e293b)',
                          }}
                        >
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ca5b4fc)' }}>{l.title} ↗</div>
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{l.what}</div>
                          <div style={{ fontSize: 12, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 4 }}>
                            <strong style={{ color: '#22c55e' }}>{T('Làm gì', 'Do this')}:</strong> {l.how}
                          </div>

                          {/* Concrete things to search for on that page. Note the
                              wording: these are instructions, never claims that a
                              thing IS trending — the tool on the other end of the link
                              is what decides that, not us. The badge says where each
                              one came from, so nobody mistakes a trade default for a
                              reading of this salon's own numbers. */}
                          {!!l.topics?.length && (
                            <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px dashed var(--c334155)' }}>
                              <div style={{ fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 4 }}>
                                {T('Tìm những chủ đề này', 'Search for these')}
                              </div>
                              {l.topics.map((t, i) => (
                                <div key={i} style={{ marginBottom: i < l.topics!.length - 1 ? 5 : 0 }}>
                                  <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                                    <span>• {t.label}</span>
                                    <span style={{
                                      fontSize: 10, padding: '1px 6px', borderRadius: 20,
                                      background: t.from === 'salon' ? 'var(--c14532d)' : t.from === 'region' ? 'var(--c451a03)' : 'var(--c1e293b)',
                                      color: t.from === 'salon' ? 'var(--cbbf7d0)' : t.from === 'region' ? 'var(--cfde68a)' : 'var(--c94a3b8)',
                                    }}>
                                      {t.from === 'salon' ? T('số của tiệm', 'your data')
                                        : t.from === 'region' ? T('khu vực', 'local')
                                        : T('kinh nghiệm ngành', 'trade')}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.45, paddingLeft: 11 }}>{t.why}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* ---- clip and product feeds ----
                   Hashtag pages and sales rankings, never a link to one specific clip:
                   a specific clip would have to be invented, and would be dead within a
                   week even if it were not. These pages compute the answer themselves,
                   every time they are opened. */}
              {(!!plan?.videoFeeds?.length || !!plan?.productWatch?.length) && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 10 }}>
                    🎥 {T('Clip & sản phẩm đang chạy trong ngành', 'Clips & products in your trade')}
                  </div>
                  {[
                    [T('Xem clip đang lên', 'Trending clips'), plan?.videoFeeds ?? []] as const,
                    [T('Sản phẩm đang bán chạy', 'Products selling now'), plan?.productWatch ?? []] as const,
                  ].filter(([, rows]) => rows.length).map(([label, rows]) => (
                    <div key={label} style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 6 }}>{label}</div>
                      {rows.map((l) => (
                        <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" style={{
                          display: 'block', textDecoration: 'none', padding: '9px 11px', marginBottom: 7,
                          borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c1e293b)',
                        }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ca5b4fc)' }}>{l.title} ↗</div>
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{l.what}</div>
                          <div style={{ fontSize: 12, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 4 }}>
                            <strong style={{ color: '#22c55e' }}>{T('Nên làm theo', 'Copy this')}:</strong> {l.how}
                          </div>
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === 'audience' && (
            <>
              {/* ---- who the customers actually are ----
                  Read from the salon's own book, because the people in it are
                  the ones who live within the catchment and chose this shop.
                  Nothing here describes a person the platform has not seen. */}
              {plan?.audience && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    🎯 {T('Tệp khách của tiệm', 'Your customer base')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, fontStyle: 'italic' }}>{plan.audience.basis}</div>

                  {plan.audience.segments.map((sg) => (
                    <div key={sg.key} style={{ padding: '8px 0', borderTop: '1px solid var(--c1e293b)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{sg.label}</span>
                        <span style={{ fontSize: 13, color: 'var(--ca5b4fc)' }}>{sg.count} {T('người', 'people')} · {sg.sharePct}%</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
                        {T('Trung bình', 'Avg')} {money(sg.avgTicketCents)}/{T('lần', 'visit')}
                        {sg.medianGapDays ? ` · ${T('quay lại mỗi', 'returns every')} ~${sg.medianGapDays} ${T('ngày', 'days')}` : ''}
                        {sg.favouriteTime ? ` · ${T('hay đi', 'usually')} ${sg.favouriteTime}` : ''}
                        {sg.topService ? ` · ${sg.topService}` : ''}
                      </div>
                    </div>
                  ))}

                  {!!plan.audience.targets.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                        {T('Nên nhắm vào ai trước', 'Aim here first')}
                      </div>
                      {plan.audience.targets.map((t, i) => (
                        <div key={t.segment} style={{
                          padding: '9px 11px', marginBottom: 7, borderRadius: 9,
                          background: 'var(--c1e293b)', border: `1px solid ${i === 0 ? '#6366f1' : 'var(--c334155)'}`,
                        }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: i === 0 ? '#a5b4fc' : 'var(--ce2e8f0)' }}>
                            {i + 1}. {t.label}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 3 }}>
                            <strong style={{ color: '#22c55e' }}>{T('Làm', 'Do')}:</strong> {t.action}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{t.why}</div>
                          <div style={{ fontSize: 12, color: 'var(--cfde68a)', marginTop: 3 }}>{t.prize}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ---- the arithmetic that decides a discount ----
                  A break-even is one line of maths nobody does, so the screen
                  does it. Without the commission rate it says so instead of
                  guessing: an assumed margin makes a fake break-even, and a
                  fake break-even looks exactly like a real one. */}
              {plan?.promo && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: 16,
                  borderColor: plan.promo.proposed?.impossible ? '#ef4444' : 'var(--c334155)',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    🧮 {T('Giảm bao nhiêu thì còn lãi', 'What a discount really costs')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginBottom: 8 }}>{plan.promo.note}</div>

                  {plan.promo.margin.grossMarginPct !== null && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--c64748b)', textTransform: 'uppercase' }}>{T('Biên lãi gộp', 'Gross margin')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: plan.promo.margin.source === 'assumed' ? '#f59e0b' : '#22c55e' }}>
                          {plan.promo.margin.grossMarginPct}%
                          {plan.promo.margin.source === 'assumed' && (
                            <span style={{ fontSize: 10, marginLeft: 5, padding: '1px 6px', borderRadius: 20, background: 'var(--c451a03)', color: 'var(--cfde68a)', verticalAlign: 'middle' }}>
                              {T('ước tính', 'estimate')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--c64748b)', textTransform: 'uppercase' }}>{T('Giảm tối đa nên dùng', 'Safe ceiling')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ca5b4fc)' }}>{plan.promo.ceiling}%</div>
                      </div>
                    </div>
                  )}

                  {plan.promo.proposed && (
                    <div style={{
                      padding: '9px 11px', borderRadius: 8, marginBottom: 8,
                      background: plan.promo.proposed.impossible ? 'var(--c450a0a)' : 'var(--c1e293b)',
                      border: `1px solid ${plan.promo.proposed.impossible ? 'var(--c991b1b)' : 'var(--c334155)'}`,
                      color: plan.promo.proposed.impossible ? 'var(--cfca5a5)' : 'var(--ccbd5e1)',
                      fontSize: 12.5, lineHeight: 1.55,
                    }}>
                      {plan.promo.proposed.plain}
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: 'var(--c64748b)', marginBottom: 8 }}>
                    {T('Thử theo thứ tự rẻ nhất trước', 'Cheapest tools first')}: {plan.promo.tryFirst.join(' → ')}
                  </div>

                  {plan.promo.plays.map((pl) => (
                    <div key={pl.key} style={{ padding: '8px 0', borderTop: '1px solid var(--c1e293b)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{pl.name}</span>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'var(--c1e293b)', color: COST_LABEL[pl.cost]?.color }}>
                          {T('chi phí', 'cost')} {COST_LABEL[pl.cost]?.text}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5, marginTop: 2 }}>{pl.offer}</div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{pl.why}</div>
                      <div style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.45, marginTop: 2 }}>
                        {T('Tránh khi', 'Avoid when')}: {pl.avoidWhen}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- the neighbourhood ----
                  Census figures per ZIP. Labelled as ZIPs, never as a radius:
                  ZIP boundaries follow postal routes, and calling them a
                  five-mile circle would be a claim nothing here measured. */}
              <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                  🗺️ {T('Khu vực quanh tiệm', 'Around the shop')}
                </div>
                {plan?.area?.ok ? (
                  <>
                    {plan.area.lines.map((l, i) => (
                      <div key={i} style={{
                        fontSize: 13, color: i === plan.area!.lines.length - 1 ? 'var(--c64748b)' : 'var(--ccbd5e1)',
                        lineHeight: 1.6, marginBottom: 5, fontStyle: i === plan.area!.lines.length - 1 ? 'italic' : 'normal',
                      }}>{l}</div>
                    ))}
                    <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 6 }}>
                      {T('Nguồn: Cục Thống kê Mỹ, khảo sát ACS 5 năm', 'Source: US Census ACS 5-year')} {plan.area.year ?? ''}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--cfde68a)', lineHeight: 1.6 }}>
                    {plan?.area?.error
                      ?? T('Chưa có số liệu khu vực — hệ thống tự lấy theo ZIP của tiệm, chạy nền mỗi giờ.',
                           'No area data yet — the system pulls it from the shop’s ZIP hourly.')}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---- the publishing queue ----
               The plan drafted a week of posts and then asked the owner to open
               Facebook and paste them, which is the step that does not happen.
               This is where a post stops being advice and becomes something
               that goes out on a Tuesday morning while she is doing a fill. */}
          {tab === 'queue' && (
            <>
              <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                    🚀 {T('Lịch đăng bài tự động', 'Scheduled posts')}
                  </div>
                  <button
                    onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
                      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
                      setPostDraft({ channels: ['facebook'], message: '', media: [], at: local });
                    }}
                    style={{
                      marginLeft: 'auto', minHeight: 38, padding: '8px 14px', borderRadius: 9,
                      border: 'none', background: '#6366f1', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    + {T('Bài mới', 'New post')}
                  </button>
                </div>

                {queue?.connected ? (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>
                      {T('Đăng lên', 'Publishing to')}{' '}
                      <b style={{ color: 'var(--ce2e8f0)' }}>{queue.connected.pageName ?? T('Trang Facebook của tiệm', 'your Page')}</b>
                      {queue.connected.hasInstagram
                        ? <> {T('và Instagram', 'and Instagram')} <b style={{ color: 'var(--ce2e8f0)' }}>@{queue.connected.igUsername}</b></>
                        : <> · {T('Trang này chưa liên kết Instagram', 'no Instagram linked to this Page')}</>}
                    </div>

                    {/* ---- can this connection publish at all? ----
                        Asked of Meta before anything is attempted. Without it
                        the only way to find out whether a reconnect worked is to
                        publish and read a Graph error about Facebook Groups. */}
                    {queue.connected.missingScopes === null ? null
                      : queue.connected.missingScopes.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#22c55e', marginTop: 6 }}>
                          ✓ {T('Kết nối có đủ quyền đăng bài.', 'This connection can publish.')}
                        </div>
                      ) : (
                        <div style={{
                          marginTop: 9, padding: '10px 12px', borderRadius: 9,
                          background: 'var(--c451a03)', border: '1px solid #f59e0b',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cfde68a)', marginBottom: 4 }}>
                            {T('Kết nối hiện tại chưa có quyền đăng bài', 'This connection cannot publish yet')}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--cfde68a)', lineHeight: 1.6 }}>
                            {T('Thiếu', 'Missing')}: <code>{queue.connected.missingScopes.join(', ')}</code>.{' '}
                            {T('Token của Trang chỉ mang những quyền được cấp đúng lúc kết nối. Kết nối lại Trang và tick tất cả các ô Facebook hỏi.',
                               'A Page token only carries the permissions granted when it was issued. Reconnect the Page and tick every box Facebook asks about.')}
                          </div>
                          <a
                            href="/salon/messenger"
                            style={{
                              display: 'inline-block', marginTop: 9, padding: '9px 15px', borderRadius: 9,
                              background: '#f59e0b', color: '#451a03', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                            }}
                          >
                            {T('Kết nối lại Trang Facebook →', 'Reconnect the Page →')}
                          </a>
                        </div>
                      )}
                  </>
                ) : (
                  <div style={{
                    fontSize: 12.5, lineHeight: 1.55, padding: '9px 11px', borderRadius: 8,
                    background: 'var(--c451a03)', border: '1px solid #f59e0b', color: 'var(--cfde68a)',
                  }}>
                    {T('Tiệm chưa kết nối Trang Facebook. Vào Cài đặt → Messenger để kết nối, rồi quay lại đây.',
                       'No Facebook Page connected yet. Connect one in Settings → Messenger, then come back.')}
                  </div>
                )}
              </div>

              {postErr && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: '11px 14px', borderColor: '#ef4444',
                  fontSize: 13, color: 'var(--cfca5a5)', lineHeight: 1.55,
                }}>{postErr}</div>
              )}

              {/* ---- the composer ---- */}
              {postDraft && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16, borderColor: '#6366f1' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 10 }}>
                    {postDraft.id ? T('Sửa bài', 'Edit post') : T('Bài mới', 'New post')}
                  </div>

                  <textarea
                    value={postDraft.message}
                    onChange={(e) => setPostDraft({ ...postDraft, message: e.target.value })}
                    rows={6}
                    placeholder={T('Nội dung bài đăng…', 'What the post says…')}
                    style={{
                      width: '100%', padding: '11px 12px', borderRadius: 9, fontSize: 14, lineHeight: 1.6,
                      border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)',
                      resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 3 }}>
                    {postDraft.message.length} {T('ký tự', 'characters')}
                    {postDraft.channels.includes('instagram') && ` · ${T('Instagram tối đa 2.200', 'Instagram max 2,200')}`}
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 11 }}>
                    {(['facebook', 'instagram'] as const).map((c) => {
                      const on = postDraft.channels.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => setPostDraft({
                            ...postDraft,
                            channels: on ? postDraft.channels.filter((x) => x !== c) : [...postDraft.channels, c],
                          })}
                          style={{
                            minHeight: 40, padding: '9px 15px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
                            border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`,
                            background: on ? '#6366f1' : 'transparent',
                            color: on ? '#fff' : 'var(--c94a3b8)',
                          }}
                        >
                          {c === 'facebook' ? 'Facebook' : 'Instagram'}
                        </button>
                      );
                    })}
                  </div>

                  {/* ---- media, in the order they will appear ----
                       Order is the whole feature for a carousel: item one is
                       the thumbnail in the feed AND the square on the profile
                       grid, and it is the only one most people ever see. */}
                  <div style={{ marginTop: 13 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 5 }}>
                      {T('Ảnh & video (link https công khai)', 'Photos & video (public https links)')}
                      {postDraft.channels.includes('instagram') && ` — ${T('Instagram bắt buộc có ít nhất 1', 'Instagram needs at least one')}`}
                    </div>

                    <MediaList
                      media={postDraft.media}
                      onChange={(m) => setPostDraft({ ...postDraft, media: m })}
                      vi={vi}
                    />

                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: postDraft.media.length ? 4 : 0 }}>
                      <input
                        value={mediaInput}
                        onChange={(e) => setMediaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          addMedia();
                        }}
                        placeholder="https://…"
                        style={{
                          flex: '1 1 200px', minHeight: 42, padding: '10px 12px', borderRadius: 9, fontSize: 13.5,
                          border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)',
                        }}
                      />
                      <button
                        onClick={addMedia}
                        disabled={postDraft.media.length >= 10}
                        style={{
                          minHeight: 42, padding: '0 16px', borderRadius: 9, fontSize: 13.5, fontWeight: 600,
                          cursor: postDraft.media.length >= 10 ? 'not-allowed' : 'pointer', border: '1px solid var(--c475569)',
                          background: 'transparent', color: postDraft.media.length >= 10 ? 'var(--c64748b)' : 'var(--ca5b4fc)',
                        }}
                      >
                        + {T('Thêm link', 'Add link')}
                      </button>
                      {/* The way out of the link problem entirely.
                          Asking a salon for a "public https link to the file"
                          is asking them to understand hosting; the answer they
                          reach for is a Google Drive share link, which is a web
                          page and can never work. Uploading is the path that
                          does not require them to know any of that. */}
                      <label style={{
                        minHeight: 42, padding: '0 16px', borderRadius: 9, fontSize: 13.5, fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', cursor: uploading ? 'wait' : 'pointer',
                        border: 'none', background: '#6366f1', color: '#fff',
                      }}>
                        {uploading ? T('Đang tải…', 'Uploading…') : `📷 ${T('Tải ảnh lên', 'Upload a photo')}`}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploading || postDraft.media.length >= 10}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadMedia(f); }}
                          style={{ display: 'none' }}
                        />
                      </label>
                    </div>
                    {fitNote && (
                      <div style={{
                        marginTop: 7, padding: '8px 11px', borderRadius: 8,
                        background: 'var(--c1e293b)', border: '1px solid var(--c475569)',
                        fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.55,
                      }}>
                        ✂︎ {fitNote}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 4, lineHeight: 1.5 }}>
                      {postDraft.media.length >= 2
                        ? T(`Bài nhiều ảnh (${postDraft.media.length}/10) — vuốt ngang trên Instagram.`, `Carousel (${postDraft.media.length}/10) — swipeable on Instagram.`)
                        : postDraft.media.some((m) => m.kind === 'video')
                          ? T('Video — Instagram đăng dạng Reels, Facebook đăng video thường.', 'Video — published as a Reel on Instagram, a video post on Facebook.')
                          : T('Ảnh: bấm "Tải ảnh lên". Video: phải dán link trỏ THẲNG tới file .mp4 — link Google Drive/Photos không dùng được.',
                              'Photos: use Upload. Video: paste a link pointing straight at the .mp4 file — Google Drive/Photos links do not work.')}
                    </div>
                  </div>

                  {/* ---- what the follower will actually meet ---- */}
                  {(postDraft.message.trim() || postDraft.media.length > 0) && (
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
                      {postDraft.channels.map((c) => (
                        <div key={c}>
                          <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 5 }}>
                            {T('Xem trước', 'Preview')} · {c === 'facebook' ? 'Facebook' : 'Instagram'}
                          </div>
                          <PostPreview
                            channel={c}
                            message={postDraft.message}
                            media={postDraft.media}
                            pageName={queue?.connected?.pageName ?? null}
                            igUsername={queue?.connected?.igUsername ?? null}
                            vi={vi}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ---- what this post will and will NOT do ----
                       The channel buttons show their own state, but a salon that
                       meant to reach Instagram and left it untoggled published to
                       Facebook believing otherwise, and nothing on the screen
                       contradicted them until afterwards. The absence has to be
                       stated, not merely not-stated. */}
                  {(() => {
                    const on = postDraft.channels;
                    const igReady = queue?.connected?.hasInstagram;
                    const missingIg = igReady && !on.includes('instagram');
                    const missingFb = !on.includes('facebook');
                    if (!missingIg && !missingFb) return null;
                    return (
                      <div style={{
                        marginTop: 9, padding: '9px 11px', borderRadius: 8,
                        background: 'var(--c1e293b)', border: '1px dashed var(--c475569)',
                        fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55,
                      }}>
                        {on.length === 0
                          ? T('Chưa chọn nơi đăng — bài này sẽ không đi đâu cả.', 'No channel picked — this post goes nowhere.')
                          : <>
                            {T('Chỉ đăng lên', 'Publishing to')} <b style={{ color: 'var(--ce2e8f0)' }}>{on.includes('facebook') ? 'Facebook' : 'Instagram'}</b>.{' '}
                            {missingIg && (
                              <>
                                {T('KHÔNG lên Instagram', 'NOT to Instagram')} (@{queue?.connected?.igUsername}).{' '}
                                <button
                                  onClick={() => setPostDraft({ ...postDraft, channels: [...on, 'instagram'] })}
                                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ca5b4fc)', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline' }}
                                >
                                  {T('Thêm Instagram', 'Add Instagram')}
                                </button>
                                {postDraft.media.length === 0 && (
                                  <span> — {T('nhớ thêm ảnh, Instagram không nhận bài chỉ có chữ.', 'you will need a photo; Instagram takes no text-only post.')}</span>
                                )}
                              </>
                            )}
                            {missingFb && !missingIg && T('KHÔNG lên Facebook.', 'NOT to Facebook.')}
                          </>}
                      </div>
                    );
                  })()}

                  {/* ---- now, or on the calendar ----
                       Scheduling used to be the only way in: write it, pick a
                       date, save, find the row, press Post now. Five steps for
                       the commonest thing a salon does — something happened in
                       the shop and they want it up. */}
                  <div style={{ marginTop: 13 }}>
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
                      {([
                        ['now', `🚀 ${T('Đăng ngay', 'Post now')}`],
                        ['later', `🗓️ ${T('Hẹn giờ', 'Schedule')}`],
                      ] as const).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setPostWhen(k)}
                          style={{
                            minHeight: 40, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
                            fontSize: 13.5, fontWeight: postWhen === k ? 700 : 500,
                            border: `1px solid ${postWhen === k ? '#6366f1' : 'var(--c334155)'}`,
                            background: postWhen === k ? '#6366f1' : 'transparent',
                            color: postWhen === k ? '#fff' : 'var(--c94a3b8)',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {postWhen === 'later' ? (
                      <input
                        type="datetime-local"
                        value={postDraft.at}
                        onChange={(e) => setPostDraft({ ...postDraft, at: e.target.value })}
                        style={{
                          minHeight: 42, padding: '10px 12px', borderRadius: 9, fontSize: 13.5,
                          border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)',
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55 }}>
                        {T('Bài sẽ lên trang ngay khi bấm. Vẫn được lưu vào lịch để xem lại sau.',
                           'Goes up the moment you press. Still recorded on the calendar afterwards.')}
                      </div>
                    )}
                  </div>

                  {/* Hidden once it has published: the server refuses the save,
                      and a button whose only outcome is an error message is a
                      button that should not be there. */}
                  <div style={{
                    display: postDraft.id && queue?.posts.find((x) => x.id === postDraft.id)?.status === 'posted' ? 'none' : 'flex',
                    gap: 9, flexWrap: 'wrap', marginTop: 14,
                  }}>
                    <button
                      onClick={() => savePost('scheduled', postWhen === 'now')}
                      disabled={queueBusy || (!postDraft.message.trim() && !postDraft.media.length)}
                      style={{
                        flex: '1 1 160px', minHeight: 44, borderRadius: 9, border: 'none', cursor: 'pointer',
                        background: (postDraft.message.trim() || postDraft.media.length) ? '#22c55e' : 'var(--c334155)',
                        color: (postDraft.message.trim() || postDraft.media.length) ? '#052e16' : 'var(--c64748b)',
                        fontSize: 14, fontWeight: 700,
                      }}
                    >
                      {queueBusy
                        ? (postWhen === 'now' ? T('Đang đăng…', 'Publishing…') : T('Đang lưu…', 'Saving…'))
                        : postWhen === 'now' ? T('🚀 Đăng lên ngay', '🚀 Publish now') : T('✓ Đặt lịch đăng', '✓ Schedule it')}
                    </button>
                    <button
                      onClick={() => savePost('draft')}
                      disabled={queueBusy}
                      style={{
                        minHeight: 44, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
                        border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13.5,
                      }}
                    >
                      {T('Lưu nháp', 'Save draft')}
                    </button>
                    <button
                      onClick={() => { setPostDraft(null); setPostErr(null); }}
                      style={{
                        minHeight: 44, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
                        border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)', fontSize: 13.5,
                      }}
                    >
                      {T('Đóng', 'Close')}
                    </button>
                  </div>

                  {/* ---- an existing post: its state, and what can be done to it ----
                       "Post now" and "Cancel" used to live ONLY in the list view,
                       so opening a post from the calendar or the grid gave you a
                       composer with no way to send it. The composer is the one
                       place every view leads to, so the actions belong here. */}
                  {(() => {
                    const live = postDraft.id ? queue?.posts.find((x) => x.id === postDraft.id) : null;
                    if (!live) return null;
                    const S: Record<string, { fg: string; text: string }> = {
                      draft: { fg: 'var(--c94a3b8)', text: T('Nháp', 'Draft') },
                      scheduled: { fg: '#6366f1', text: T('Đã đặt lịch', 'Scheduled') },
                      publishing: { fg: '#f59e0b', text: T('Đang đăng', 'Publishing') },
                      posted: { fg: '#22c55e', text: T('Đã đăng', 'Posted') },
                      failed: { fg: '#ef4444', text: T('Lỗi', 'Failed') },
                      expired: { fg: '#f59e0b', text: T('Quá hạn', 'Missed') },
                      cancelled: { fg: 'var(--c64748b)', text: T('Đã huỷ', 'Cancelled') },
                    };
                    const st = S[live.status] ?? S.draft;
                    return (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c334155)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                          <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{T('Trạng thái', 'Status')}</span>
                          <span style={{ fontSize: 11.5, padding: '2px 9px', borderRadius: 20, border: `1px solid ${st.fg}`, color: st.fg, fontWeight: 600 }}>
                            {st.text}
                          </span>
                          {live.attempts > 0 && (
                            <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
                              {T('đã thử', 'tried')} {live.attempts}×
                            </span>
                          )}
                        </div>

                        {/* The reason, verbatim from Meta. Paraphrasing it would
                            hide the one string that says what to fix. */}
                        {!!live.blockers.length && (
                          <div style={{ padding: '9px 11px', borderRadius: 8, marginBottom: 9, background: 'var(--c451a03)', border: '1px solid #f59e0b' }}>
                            {live.blockers.map((b) => (
                              <div key={b} style={{ fontSize: 12.5, color: 'var(--cfde68a)', lineHeight: 1.55 }}>⚠︎ {b}</div>
                            ))}
                          </div>
                        )}
                        {live.lastError && !live.blockers.length && (
                          <div style={{
                            padding: '10px 12px', borderRadius: 8, marginBottom: 9,
                            background: live.errorIsStale ? 'var(--c1e293b)' : 'var(--c450a0a)',
                            border: `1px solid ${live.errorIsStale ? 'var(--c334155)' : 'var(--c991b1b)'}`,
                          }}>
                            {/* The permission has since been granted, so this is
                                history rather than an instruction. Telling
                                somebody to reconnect a Page they just
                                reconnected is how a fix message stops being
                                believed. */}
                            {live.errorIsStale && (
                              <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600, lineHeight: 1.55, marginBottom: 6 }}>
                                ✓ {T('Quyền đã được cấp rồi — lỗi bên dưới là của lần thử trước. Bấm "Đăng ngay" để thử lại.',
                                     'The permission is granted now — the error below is from the earlier attempt. Press “Post now” to try again.')}
                              </div>
                            )}
                            {live.fix && (
                              <div style={{ fontSize: 13, color: 'var(--cfecaca)', fontWeight: 600, lineHeight: 1.55, marginBottom: 6 }}>
                                → {live.fix}
                              </div>
                            )}
                            {/* Meta's own words, kept whole. It is the only
                                precise string anybody can search for later. */}
                            <details>
                              <summary style={{ fontSize: 11.5, color: 'var(--cfca5a5)', cursor: 'pointer' }}>
                                {T('Nguyên văn lỗi từ Facebook', 'Facebook’s exact error')}
                              </summary>
                              <div style={{ fontSize: 11.5, color: 'var(--cfca5a5)', lineHeight: 1.5, marginTop: 5, wordBreak: 'break-word' }}>
                                {live.lastError}
                              </div>
                            </details>
                          </div>
                        )}

                        {/* Every channel the post ASKED for, with what became of
                            it — not only the ones that worked. A list of
                            successes reads as a complete list, which is how a
                            Facebook-only post gets mistaken for one that also
                            reached Instagram. */}
                        {live.status === 'posted' && (
                          <div style={{ marginBottom: 9 }}>
                            {(['facebook', 'instagram'] as const).map((c) => {
                              const asked = live.channels.includes(c);
                              const r = live.results.find((x) => x.channel === c);
                              const name = c === 'facebook' ? 'Facebook' : 'Instagram';
                              const connected = c === 'facebook' || queue?.connected?.hasInstagram;
                              if (!asked && !connected) return null;
                              return (
                                <div key={c} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                                  {!asked
                                    ? <span style={{ color: 'var(--c64748b)' }}>○ {name} — {T('không chọn đăng', 'not selected')}</span>
                                    : r?.url
                                      ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c60a5fa)' }}>
                                        ✓ {name} — {T('xem bài', 'view the post')}
                                      </a>
                                      : <span style={{ color: '#22c55e' }}>✓ {name}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {live.status !== 'posted' && live.results.filter((r) => r.url).map((r) => (
                          <a
                            key={r.channel} href={r.url!} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-block', marginRight: 12, marginBottom: 8, fontSize: 12.5, color: 'var(--c60a5fa)' }}
                          >
                            🔗 {T('Xem trên', 'View on')} {r.channel === 'facebook' ? 'Facebook' : 'Instagram'}
                          </a>
                        ))}

                        {/* A published row is the record of what really went up:
                            it carries the publish time and the links, and the
                            weekly results count it. It is not deletable, so no
                            button pretends otherwise. */}
                        {live.status === 'posted' ? (
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.6 }}>
                              {T('Bài đã đăng được giữ lại làm sổ ghi. Muốn gỡ bài thì xoá trực tiếp trên Facebook/Instagram; muốn lịch gọn hơn thì bỏ tick "Hiện bài đã đăng".',
                                 'Published posts are kept as the record. To take one down, delete it on Facebook/Instagram; to tidy the calendar, untick “Show published posts”.')}
                            </div>
                            {queue?.canDeletePosted && (
                              <button
                                onClick={() => removePost(live.id)}
                                disabled={queueBusy}
                                style={{
                                  marginTop: 9, minHeight: 38, padding: '0 14px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5,
                                  border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontWeight: 600,
                                }}
                              >
                                🗑 {T('Xoá khỏi lịch (Lumio)', 'Remove from calendar (Lumio)')}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              onClick={() => removePost(live.id)}
                              disabled={queueBusy}
                              style={{
                                minHeight: 42, padding: '0 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5,
                                border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontWeight: 600,
                              }}
                            >
                              🗑 {T('Xoá bài', 'Delete')}
                            </button>
                          </div>
                        )}
                        {live.status !== 'posted' && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            <button
                              onClick={() => postAction(live.id, 'publish')}
                              disabled={queueBusy || live.blockers.length > 0}
                              style={{
                                minHeight: 42, padding: '0 18px', borderRadius: 9, fontSize: 13.5, fontWeight: 700,
                                cursor: live.blockers.length ? 'not-allowed' : 'pointer', border: 'none',
                                background: live.blockers.length ? 'var(--c334155)' : '#6366f1',
                                color: live.blockers.length ? 'var(--c64748b)' : '#fff',
                              }}
                            >
                              🚀 {queueBusy ? T('Đang đăng…', 'Publishing…') : T('Đăng ngay', 'Post now')}
                            </button>
                            <button
                              onClick={() => { postAction(live.id, 'cancel'); setPostDraft(null); }}
                              disabled={queueBusy}
                              title={T('Giữ lại bài nhưng không đăng nữa', 'Keeps the post but stops it going out')}
                              style={{
                                minHeight: 42, padding: '0 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5,
                                border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)',
                              }}
                            >
                              {T('Tạm dừng', 'Pause it')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ---- three views over one queue ----
                   A list is fine for three posts and useless for thirty.
                   Laying out a month needs to see which days are EMPTY, and
                   what the profile will look like when it is all up. */}
              {!!queue?.posts.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 14 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                    {([
                      ['calendar', '🗓️', T('Lịch tháng', 'Calendar')],
                      ['grid', '▦', T('Lưới Instagram', 'IG grid')],
                      ['list', '☰', T('Danh sách', 'List')],
                    ] as const).map(([k, icon, label]) => (
                      <button
                        key={k}
                        onClick={() => setView(k)}
                        style={{
                          padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                          fontWeight: view === k ? 700 : 500,
                          border: `1px solid ${view === k ? '#6366f1' : 'var(--c334155)'}`,
                          background: view === k ? '#6366f1' : 'transparent',
                          color: view === k ? '#fff' : 'var(--c94a3b8)',
                        }}
                      >
                        <span style={{ marginRight: 5 }}>{icon}</span>{label}
                      </button>
                    ))}
                  </div>

                  {view === 'calendar' && (
                    <>
                      {/* Published posts are a record, not a queue item — they
                          cannot be deleted, so the only way to keep a busy month
                          readable is to stop drawing them. */}
                      <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 10,
                        fontSize: 12.5, color: 'var(--c94a3b8)', cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={showPosted}
                          onChange={(e) => setShowPosted(e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: '#6366f1' }}
                        />
                        {T('Hiện bài đã đăng', 'Show published posts')}
                        <span style={{ color: 'var(--c64748b)' }}>
                          ({queue.posts.filter((p) => p.status === 'posted').length})
                        </span>
                      </label>
                      <MonthCalendar
                        posts={showPosted ? queue.posts : queue.posts.filter((p) => p.status !== 'posted')}
                        month={month}
                        onMonth={setMonth}
                        onPick={editPost}
                        onDrop={movePost}
                        onDelete={removePost}
                        vi={vi}
                      />
                    </>
                  )}
                  {view === 'grid' && (
                    <IgGrid
                      posts={queue.posts
                        .filter((p) => p.channels.includes('instagram') && p.media.length > 0)
                        .filter((p) => p.status !== 'cancelled' && p.status !== 'expired')
                        .sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1))}
                      onPick={editPost}
                      vi={vi}
                    />
                  )}
                </div>
              )}

              {/* Crowding is advice, kept away from the blockers that really
                  stop a post — mixing them trains the salon to ignore both. */}
              {!!queue?.crowding?.length && view !== 'grid' && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: '11px 14px',
                  borderColor: '#f59e0b', background: 'var(--c451a03)',
                }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--cfde68a)', marginBottom: 3 }}>
                    {T('Vài bài đăng quá sát nhau', 'Some posts are bunched together')}
                  </div>
                  {queue.crowding.slice(0, 4).map((c) => (
                    <div key={`${c.id}-${c.minutesApart}`} style={{ fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.55 }}>
                      · {c.message}
                    </div>
                  ))}
                </div>
              )}

              {/* ---- the queue ---- */}
              {queue && !queue.posts.length && !postDraft && (
                <div style={{ ...ui.card, padding: 20, textAlign: 'center' }}>
                  <div style={{ fontSize: 14, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
                    {T('Chưa có bài nào trong hàng đợi. Vào tab Hôm nay, bấm "Hẹn giờ đăng" trên một ý tưởng là xong.',
                       'Nothing queued yet. Open the Today tab and press “Schedule it” on an idea.')}
                  </div>
                </div>
              )}

              {view === 'list' && queue?.posts.map((p) => {
                const S: Record<string, { fg: string; text: string }> = {
                  draft: { fg: 'var(--c94a3b8)', text: T('Nháp', 'Draft') },
                  scheduled: { fg: '#6366f1', text: T('Đã đặt lịch', 'Scheduled') },
                  publishing: { fg: '#f59e0b', text: T('Đang đăng', 'Publishing') },
                  posted: { fg: '#22c55e', text: T('Đã đăng', 'Posted') },
                  failed: { fg: '#ef4444', text: T('Lỗi', 'Failed') },
                  expired: { fg: '#f59e0b', text: T('Quá hạn', 'Missed') },
                  cancelled: { fg: 'var(--c64748b)', text: T('Đã huỷ', 'Cancelled') },
                };
                const st = S[p.status] ?? S.draft;
                const when = new Date(p.scheduledAt);
                const open = p.status === 'draft' || p.status === 'scheduled' || p.status === 'failed' || p.status === 'expired';
                return (
                  <div key={p.id} style={{ ...ui.card, marginBottom: 10, padding: 14, borderColor: p.blockers.length ? '#f59e0b' : 'var(--c334155)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                        {when.toLocaleString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, border: `1px solid ${st.fg}`, color: st.fg }}>{st.text}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
                        {p.channels.map((c) => (c === 'facebook' ? 'Facebook' : 'Instagram')).join(' + ')}
                        {p.shape === 'carousel' && ` · ${p.media.length} ${T('ảnh/video', 'items')}`}
                        {p.shape === 'video' && ' · video'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* The files were cleaned up after the post had been live
                          a while. Facebook and Instagram kept their own copy, so
                          the post is untouched — but drawing the old URL here
                          would show a broken image and read as a fault. */}
                      {p.mediaPurged && !!p.media.length && (
                        <div style={{
                          width: 46, height: 46, borderRadius: 6, flex: '0 0 46px',
                          background: 'var(--c1e293b)', border: '1px dashed var(--c475569)',
                          display: 'grid', placeItems: 'center', fontSize: 16, color: 'var(--c64748b)',
                        }} title={T('Ảnh đã dọn khỏi kho — bài trên trang vẫn còn', 'Files cleaned from storage — the post itself is unaffected')}>
                          🗄
                        </div>
                      )}
                      {!p.mediaPurged && !!p.media.length && (
                        <div style={{ display: 'flex', gap: 3, flex: '0 0 auto' }}>
                          {p.media.slice(0, 3).map((m, i) => (
                            <span key={`${m.url}-${i}`} style={{
                              width: 46, height: 46, borderRadius: 6, overflow: 'hidden',
                              background: 'var(--c1e293b)', display: 'grid', placeItems: 'center', position: 'relative',
                            }}>
                              {m.kind === 'video'
                                ? <span style={{ fontSize: 15 }}>▶</span>
                                /* eslint-disable-next-line @next/next/no-img-element */
                                : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              {i === 2 && p.media.length > 3 && (
                                <span style={{
                                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)', color: '#fff',
                                  fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center',
                                }}>+{p.media.length - 2}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', minWidth: 0 }}>
                        {p.message.length > 220 ? `${p.message.slice(0, 220)}…` : p.message}
                      </div>
                    </div>

                    {!!p.blockers.length && (
                      <div style={{ marginTop: 8, padding: '8px 11px', borderRadius: 8, background: 'var(--c451a03)', border: '1px solid #f59e0b' }}>
                        {p.blockers.map((b) => (
                          <div key={b} style={{ fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.55 }}>⚠︎ {b}</div>
                        ))}
                      </div>
                    )}

                    {p.lastError && !p.blockers.length && (
                      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55 }}>
                        {p.errorIsStale
                          ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ {T('Quyền đã có — bấm "Đăng ngay" để thử lại', 'Permission granted — press “Post now” to retry')}</span>
                          : p.fix
                            ? <span style={{ color: 'var(--cfecaca)', fontWeight: 600 }}>→ {p.fix}</span>
                            : <span style={{ color: 'var(--cfca5a5)' }}>{T('Lỗi', 'Error')}: {p.lastError}</span>}
                        {p.attempts > 0 && (
                          <span style={{ color: 'var(--c94a3b8)' }}> ({T('đã thử', 'tried')} {p.attempts}×)</span>
                        )}
                      </div>
                    )}

                    {/* Where it actually landed — the verifiable half. */}
                    {p.results.filter((r) => r.url).map((r) => (
                      <a
                        key={r.channel} href={r.url!} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-block', marginTop: 7, marginRight: 12, fontSize: 12.5, color: 'var(--c60a5fa)' }}
                      >
                        🔗 {T('Xem trên', 'View on')} {r.channel === 'facebook' ? 'Facebook' : 'Instagram'}
                      </a>
                    ))}

                    {p.status === 'posted' && (
                      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 8, lineHeight: 1.5 }}>
                        {T('Giữ lại làm sổ ghi — bài đã đăng không xoá được ở đây.',
                           'Kept as the record — a published post cannot be deleted here.')}
                      </div>
                    )}
                    {open && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button
                          onClick={() => editPost(p.id)}
                          style={{ minHeight: 38, padding: '8px 13px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13 }}
                        >
                          ✎ {T('Sửa', 'Edit')}
                        </button>
                        <button
                          onClick={() => postAction(p.id, 'publish')}
                          disabled={queueBusy || p.blockers.length > 0}
                          style={{
                            minHeight: 38, padding: '8px 13px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            cursor: p.blockers.length ? 'not-allowed' : 'pointer', border: 'none',
                            background: p.blockers.length ? 'var(--c334155)' : '#6366f1',
                            color: p.blockers.length ? 'var(--c64748b)' : '#fff',
                          }}
                        >
                          {T('Đăng ngay', 'Post now')}
                        </button>
                        <button
                          onClick={() => postAction(p.id, 'cancel')}
                          disabled={queueBusy}
                          style={{ minHeight: 38, padding: '8px 13px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)', fontSize: 13 }}
                        >
                          {T('Tạm dừng', 'Pause')}
                        </button>
                        <button
                          onClick={() => removePost(p.id)}
                          disabled={queueBusy}
                          style={{ minHeight: 38, padding: '8px 13px', borderRadius: 8, cursor: 'pointer', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 13 }}
                        >
                          🗑 {T('Xoá', 'Delete')}
                        </button>
                      </div>
                    )}

                    <ItemComments token={token} subject={`post:${p.id}`} unread={unread.bySubject[`post:${p.id}`] ?? 0} vi={vi} />
                  </div>
                );
              })}
            </>
          )}
          {tab === 'ads' && (
            <>
              {/* ---- the market, first ----
                  Before anything derived from the booking book. "Who should I
                  target?" is a question about the tens of thousands of people
                  who have never been in the book — and a shop with twenty-two
                  bookings has almost no history to reason from anyway. Sizes
                  here come from the US Census, not from this shop. */}
              {plan?.market && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16, borderColor: '#6366f1' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
                    🎯 {T('Tệp khách mục tiêu trong khu vực', 'Who to target in this area')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 12, lineHeight: 1.5 }}>
                    {T('Đo từ dân cư thật quanh tiệm (Cục Thống kê Mỹ), không phải từ lịch sử booking của tiệm.',
                       'Sized from the real population around the shop (US Census), not from this shop’s booking history.')}
                  </div>

                  {plan.market.primary && (
                    <div style={{
                      padding: '12px 14px', borderRadius: 10, marginBottom: 12,
                      background: 'var(--c1e293b)', border: '1px solid #6366f1',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--c64748b)', marginBottom: 2 }}>
                        {T('NHẮM VÀO', 'PRIMARY TARGET')}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ca5b4fc)' }}>{plan.market.primary.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ce2e8f0)', margin: '2px 0' }}>
                        {plan.market.primary.size.toLocaleString('en-US')} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c94a3b8)' }}>{T('người', 'people')}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 4 }}>{plan.market.primary.basis}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 6 }}>{plan.market.primary.why}</div>
                      <div style={{ marginTop: 8 }}>
                        {plan.market.primary.targeting.map((t2, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, padding: '2px 0' }}>▸ {t2}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.market.steps.map((st) => <StepCard key={st.key} step={st} T={T} />)}

                  {plan.market.maxSpend && (
                    <div style={{
                      display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10,
                      padding: '10px 12px', borderRadius: 9, background: 'var(--c0f172a)',
                    }}>
                      <div>
                        <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{T('Trần chi cả đợt', 'Spend ceiling')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>{plan.market.maxSpend}</div>
                      </div>
                      {plan.market.penetrationPct !== null && (
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{T('Cần chiếm', 'Share needed')}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{plan.market.penetrationPct}%</div>
                        </div>
                      )}
                      {plan.market.capacity !== null && (
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{T('Chỗ trống lấp được', 'Seats to fill')}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{plan.market.capacity}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {plan.market.segments.length > 1 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--c64748b)', marginBottom: 6 }}>
                        {T('Tệp cân nhắc khác', 'Other segments considered')}
                      </div>
                      {plan.market.segments.slice(1).map((s2) => (
                        <div key={s2.key} style={{
                          padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                          background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)' }}>
                            {s2.label} — {s2.size.toLocaleString('en-US')}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{s2.why}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                    {plan.market.limits.map((l, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5, marginBottom: 3 }}>• {l}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- the brief ----
                  First, and above the modules, because the modules were the
                  problem: each correct on its own and together not an argument.
                  A consultant delivers a chain — this many people, this many
                  are yours, they behave like this, they arrive through that
                  door, therefore spend this on those days. Break it anywhere
                  and the number at the end is just an assertion. */}
              {plan?.brief && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: 16,
                  borderColor: plan.brief.complete ? '#6366f1' : '#f59e0b',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
                    🧭 {T('Phân tích chiến lược', 'The strategy')}
                  </div>
                  <div style={{
                    fontSize: 13, lineHeight: 1.6, marginBottom: 12,
                    color: plan.brief.complete ? '#a5b4fc' : 'var(--cfde68a)',
                  }}>{plan.brief.headline}</div>

                  {/* The finding and what follows from it stay visible; the
                      derivation moves behind "Vì sao?". Three lines per item on
                      a phone is a wall, and the middle one — what to DO — was
                      the line getting lost in it. */}
                  {plan.brief.steps.map((st, i) => (
                    <BriefStepRow key={st.key} step={st} index={i} T={T} />
                  ))}

                  {!!plan.brief.missing.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                        {T('Còn thiếu để hoàn chỉnh phân tích', 'Missing links in the chain')}
                      </div>
                      {plan.brief.missing.map((m) => (
                        <div key={m.key} style={{ padding: '7px 10px', marginBottom: 6, borderRadius: 8, background: 'var(--c451a03)' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cfde68a)' }}>{m.what}</div>
                          <div style={{ fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.5, marginTop: 2, opacity: 0.85 }}>{m.unlocks}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 3 }}>
                            <strong style={{ color: '#22c55e' }}>{T('Cách lấy', 'How')}:</strong> {m.how}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Stated, not buried. A brief that quietly slides from what
                      a household earns to who lives there reads authoritative
                      and is the reason nobody should trust the rest of it. */}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                    <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--c64748b)', marginBottom: 5 }}>
                      {T('Phân tích này KHÔNG bao gồm', 'Out of scope')}
                    </div>
                    {plan.brief.limits.map((l, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 3 }}>• {l}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- the ceiling, first ----
                  Everything else on this tab is worthless without it: the one
                  number that says when to stop. Deliberately above the budget,
                  because a budget read before a ceiling becomes a target. */}
              {plan?.ads && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    🎚️ {T('Một khách mới đáng chi tối đa bao nhiêu', 'The most a booking may cost')}
                  </div>
                  {plan.ads.money.ceilingStrict ? (
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Ngưỡng an toàn', 'Hard ceiling')}</div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: '#22c55e' }}>{plan.ads.money.ceilingStrict}</div>
                        <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>{T('mỗi booking', 'per booking')}</div>
                      </div>
                      {plan.ads.money.ceilingRepeat && (
                        <div>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Nếu khách quay lại đều', 'If they return')}</div>
                          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--c94a3b8)' }}>{plan.ads.money.ceilingRepeat}</div>
                          <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>~{plan.ads.ceiling.visitsPerYear} {T('lần/năm', 'visits/yr')}</div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{plan.ads.ceiling.plain}</div>
                  <div style={{ background: 'var(--c1e293b)', borderRadius: 8, padding: '8px 11px', marginTop: 9, fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55 }}>
                    <b>{T('Luật dừng', 'Stop rule')}:</b>{' '}
                    {T('Ngày thứ 3, lấy tiền đã chi chia cho số booking thu được. Vượt ngưỡng trên thì TẮT — đừng chờ hết tháng.',
                       'On day 3, divide spend by bookings. Above the ceiling, switch it off — do not wait for the month to end.')}
                  </div>
                </div>
              )}

              {/* ---- budget as a test ---- */}
              {plan?.ads?.budget && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: 16,
                  borderColor: plan.ads.budget.feasible === 'no' ? '#ef4444' : plan.ads.budget.feasible === 'tight' ? '#f59e0b' : 'var(--c334155)',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    💵 {T('Ngân sách thử', 'The test budget')}
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Mỗi ngày', 'Daily')}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{plan.ads.money.daily}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Trong', 'For')}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{plan.ads.budget.days} {T('ngày', 'days')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Tổng', 'Total')}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ca5b4fc)' }}>{plan.ads.money.total}</div>
                    </div>
                    {plan.ads.budget.bookingsToBreakEven !== null && (
                      <div>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Cần để hoà vốn', 'Break-even')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>{plan.ads.budget.bookingsToBreakEven} {T('booking', 'bookings')}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{plan.ads.budget.plain}</div>
                </div>
              )}

              {/* ---- run days ---- */}
              {plan?.ads?.window && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                    📅 {T('Ngày nào bật, ngày nào tắt', 'Days on, days off')}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 4 }}>{T('BẬT', 'ON')}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {plan.ads.window.labels.run.map((d) => (
                        <span key={d} style={{ fontSize: 13, padding: '4px 10px', borderRadius: 20, background: 'var(--c14532d)', color: 'var(--cbbf7d0)' }}>{d}</span>
                      ))}
                    </div>
                  </div>
                  {!!plan.ads.window.labels.pause.length && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 4 }}>{T('TẮT', 'OFF')}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {plan.ads.window.labels.pause.map((d) => (
                          <span key={d} style={{ fontSize: 13, padding: '4px 10px', borderRadius: 20, background: 'var(--c450a0a)', color: 'var(--cfca5a5)' }}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>{plan.ads.window.why}</div>
                  <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.5, marginTop: 4 }}>{plan.ads.lead.basis}</div>
                </div>
              )}

              {/* ---- how each channel is actually performing ----
                  Judged on who a channel BRINGS, not on how busy it is. Two
                  channels with the same booking count can be opposite things,
                  and the count alone hides which. */}
              {!!plan?.ads?.channels?.reports?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    📊 {T('Từng kênh đang hiệu quả tới đâu', 'How each channel is performing')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, lineHeight: 1.5 }}>
                    {T('Đo bằng số khách MỚI kênh đó mang về và tỷ lệ họ quay lại — không phải bằng số booking. Một kênh đông khách cũ đặt lại thì không phải kênh đáng chạy quảng cáo.',
                       'Measured by the new customers a channel brings and how many return — not by booking count.')}
                  </div>
                  {plan.ads.channels.caveat && (
                    <div style={{
                      fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.55, marginBottom: 10,
                      padding: '8px 10px', borderRadius: 8, background: 'var(--c451a03)', border: '1px solid var(--c92400e)',
                    }}>⚠ {plan.ads.channels.caveat}</div>
                  )}
                  {plan.ads.channels.reports.map((c) => {
                    const V: Record<string, { bg: string; fg: string; text: string }> = {
                      builds: { bg: 'var(--c14532d)', fg: 'var(--cbbf7d0)', text: T('Mang khách mới', 'Brings new') },
                      convenience: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)', text: T('Khách cũ đặt lại', 'Rebooking') },
                      fading: { bg: 'var(--c451a03)', fg: 'var(--cfde68a)', text: T('Đang giảm', 'Declining') },
                      weak: { bg: 'var(--c451a03)', fg: 'var(--cfde68a)', text: T('Giữ khách kém', 'Poor retention') },
                      unproven: { bg: 'var(--c1e293b)', fg: 'var(--c64748b)', text: T('Chưa đủ số liệu', 'Not enough data') },
                    };
                    const v = V[c.verdict] ?? V.unproven;
                    return (
                      <div key={c.channel} style={{
                        padding: '10px 12px', marginBottom: 8, borderRadius: 9,
                        background: 'var(--c1e293b)',
                        border: `1px solid ${c.verdict === 'builds' ? '#22c55e' : 'var(--c334155)'}`,
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{c.label}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: v.bg, color: v.fg }}>{v.text}</span>
                          {c.trend !== 'unknown' && (
                            <span style={{ fontSize: 11.5, color: c.trend === 'up' ? '#22c55e' : c.trend === 'down' ? 'var(--cfca5a5)' : 'var(--c64748b)' }}>
                              {c.trend === 'up' ? '↑' : c.trend === 'down' ? '↓' : '→'} {c.last90} {T('vs', 'vs')} {c.prior90} {T('(90 ngày)', '(90d)')}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
                          {[
                            { k: T('Booking', 'Bookings'), v: `${c.bookings} (${c.sharePct}%)` },
                            { k: T('Khách lần đầu', 'New customers'), v: String(c.acquired) },
                            { k: T('Quay lại', 'Return rate'), v: c.repeatPct !== null ? `${c.repeatPct}%` : '—' },
                            { k: T('Hoá đơn TB', 'Avg ticket'), v: c.avgTicket },
                            { k: T('Giá trị mỗi khách', 'Value per customer'), v: c.valuePerAcquired ?? '—' },
                          ].map((m) => (
                            <div key={m.k}>
                              <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{m.k}</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{m.v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>{c.says}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---- what to do on each platform ---- */}
              {!!plan?.ads?.plans?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    💸 {T('Chạy gì, bao nhiêu, trên từng nền tảng', 'What to run on each platform')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, lineHeight: 1.5 }}>
                    {T('Ngân sách tính từ ngưỡng chi mỗi booking của chính kênh đó — không phải một con số chung. Chỉ nền tảng số 1 có ngân sách: mở hai kênh cùng lúc thì không biết kênh nào tạo ra kết quả.',
                       'Budget derived from each platform’s own break-even, not a flat number. Only rank 1 gets a budget.')}
                  </div>
                  <ItemComments
                    token={token}
                    subject="ads"
                    unread={unread.bySubject.ads ?? 0}
                    labelVi={vi ? 'Trao đổi về quảng cáo' : 'Discuss the ads plan'}
                    vi={vi}
                  />
                  {plan.ads.plans.map((p) => {
                    const S: Record<string, { fg: string; text: string }> = {
                      spend: { fg: '#22c55e', text: T('Chạy ngay', 'Run now') },
                      later: { fg: '#a5b4fc', text: T('Chạy sau', 'Later') },
                      hold: { fg: '#f59e0b', text: T('Chưa nên chạy', 'Hold') },
                      unproven: { fg: 'var(--c94a3b8)', text: T('Chưa có số liệu', 'Unproven') },
                    };
                    const s2 = S[p.status] ?? S.unproven;
                    return (
                      <div key={p.platform} style={{
                        padding: '11px 13px', marginBottom: 9, borderRadius: 9,
                        background: 'var(--c1e293b)',
                        border: `1px solid ${p.status === 'spend' ? '#22c55e' : 'var(--c334155)'}`,
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>#{p.rank}</span>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{p.label}</span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--c0f172a)', color: s2.fg, border: `1px solid ${s2.fg}` }}>{s2.text}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginBottom: 7 }}>{p.evidence}</div>
                        {p.total && (
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                            {[
                              { k: T('Mỗi ngày', 'Per day'), v: p.daily, c: 'var(--ce2e8f0)' },
                              { k: T('Trong', 'For'), v: `${p.days} ${T('ngày', 'days')}`, c: 'var(--ce2e8f0)' },
                              { k: T('Tổng', 'Total'), v: p.total, c: '#a5b4fc' },
                              { k: T('Ngưỡng/booking', 'Ceiling per booking'), v: p.ceiling, c: '#22c55e' },
                              { k: T('Hoà vốn ở', 'Break-even at'), v: p.bookingsToBreakEven !== null ? `${p.bookingsToBreakEven} booking` : null, c: '#f59e0b' },
                            ].filter((m) => m.v).map((m) => (
                              <div key={m.k}>
                                <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{m.k}</div>
                                <div style={{ fontSize: 17, fontWeight: 800, color: m.c }}>{m.v}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {p.how.map((h, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, padding: '3px 0' }}>• {h}</div>
                        ))}
                        <div style={{
                          fontSize: 12, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 8,
                          padding: '7px 9px', borderRadius: 8, background: 'var(--c0f172a)',
                        }}>
                          <b style={{ color: '#f59e0b' }}>{T('Đo thế nào', 'How to check')}:</b> {p.watch}
                        </div>

                        {/* ---- the form, filled in ----
                            The plan above says where to spend, how much, and
                            when to stop. This is what a person types into Ads
                            Manager: the campaign name, the objective, who goes
                            in each ad set, the words in the ad. Only rendered
                            for the campaign we are telling them to run — a
                            build sheet under a "hold" is how a hold gets built
                            by mistake. */}
                        {p.spec && (
                          <details style={{ marginTop: 9 }}>
                            <summary style={{
                              cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--ca5b4fc)',
                              padding: '8px 10px', borderRadius: 8, background: 'var(--c0f172a)',
                              border: '1px solid #6366f1', listStyle: 'none',
                            }}>
                              🛠️ {T('Dựng chiến dịch này — từng bước', 'Build this campaign — step by step')}
                            </summary>
                            <div style={{ padding: '10px 2px 2px' }}>
                              <SpecRow k={T('Tên chiến dịch', 'Campaign name')} vi={vi}>
                                <code style={{
                                  fontSize: 12.5, color: '#22c55e', background: 'var(--c0f172a)',
                                  padding: '4px 8px', borderRadius: 6, wordBreak: 'break-all',
                                }}>{p.spec.name}</code>
                                <button
                                  onClick={() => { navigator.clipboard?.writeText(p.spec!.name); setCopied(p.spec!.name); setTimeout(() => setCopied(null), 1500); }}
                                  style={{ marginLeft: 8, fontSize: 11.5, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer' }}
                                >
                                  {copied === p.spec.name ? T('Đã chép', 'Copied') : T('Chép', 'Copy')}
                                </button>
                              </SpecRow>

                              <SpecRow k={T('Mục tiêu chiến dịch', 'Objective')} vi={vi}>
                                <span style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55 }}>{p.spec.objective}</span>
                              </SpecRow>

                              <SpecRow k={T('Ngân sách', 'Budget')} vi={vi}>
                                <span style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55 }}>{p.spec.budgetLine}</span>
                              </SpecRow>

                              {p.spec.adSets.map((a, ai) => (
                                <div key={a.name} style={{
                                  marginTop: 8, padding: '9px 11px', borderRadius: 8,
                                  background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
                                }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#a5b4fc' }}>
                                    {T('Nhóm quảng cáo', 'Ad set')} {ai + 1}: <code style={{ color: '#22c55e' }}>{a.name}</code>
                                  </div>
                                  {[[T('Ai', 'Who'), a.who], [T('Ở đâu', 'Where'), a.where], [T('Khi nào', 'When'), a.when], [T('Loại trừ', 'Exclude'), a.exclude]]
                                    .filter(([, v]) => v)
                                    .map(([k, v]) => (
                                      <div key={k as string} style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 3 }}>
                                        <b style={{ color: 'var(--c94a3b8)' }}>{k}:</b> {v}
                                      </div>
                                    ))}
                                </div>
                              ))}

                              <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 8, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#a5b4fc', marginBottom: 4 }}>
                                  {T('Nội dung quảng cáo', 'The ad itself')}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 6, lineHeight: 1.5 }}>
                                  {T('Chỉ dùng những gì tiệm khai và sổ ghi được. Không có câu "tốt nhất", "uy tín nhất" — mình bịa ra thì tiệm là người chịu trách nhiệm.',
                                     'Built only from what the salon declared and the book recorded. No “best in town” — an invented claim becomes the salon’s claim.')}
                                </div>
                                {p.spec.creative.headlines.map((h) => (
                                  <div key={h} style={{ fontSize: 13, color: 'var(--ce2e8f0)', padding: '2px 0' }}>
                                    ▸ {h} <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>({h.length})</span>
                                  </div>
                                ))}
                                {p.spec.creative.descriptions.map((d) => (
                                  <div key={d} style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', padding: '2px 0', lineHeight: 1.5 }}>
                                    · {d} <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>({d.length})</span>
                                  </div>
                                ))}
                                <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', marginTop: 5, lineHeight: 1.55 }}>
                                  <b style={{ color: 'var(--c94a3b8)' }}>{T('Nút', 'CTA')}:</b> {p.spec.creative.cta}
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>
                                  <b style={{ color: 'var(--c94a3b8)' }}>{T('Bấm vào đi đâu', 'Landing')}:</b> {p.spec.creative.landing}
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>
                                  <b style={{ color: 'var(--c94a3b8)' }}>{T('Hình/clip', 'Visual')}:</b> {p.spec.creative.visual}
                                </div>
                              </div>

                              <SpecRow k={T('Làm trước khi bật', 'Before you turn it on')} vi={vi}>
                                <div>
                                  {p.spec.before.map((b) => (
                                    <div key={b} style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, padding: '2px 0' }}>☐ {b}</div>
                                  ))}
                                </div>
                              </SpecRow>

                              <SpecRow k={T('Đo vào ngày nào', 'When to check')} vi={vi}>
                                <div>
                                  {p.spec.measure.map((m) => (
                                    <div key={m} style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, padding: '2px 0' }}>• {m}</div>
                                  ))}
                                </div>
                              </SpecRow>

                              {!!p.spec.warnings.length && (
                                <div style={{ marginTop: 8, padding: '8px 11px', borderRadius: 8, background: 'var(--c451a03)', border: '1px solid #f59e0b' }}>
                                  {p.spec.warnings.map((w) => (
                                    <div key={w} style={{ fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.55 }}>⚠︎ {w}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---- audiences ---- */}
              {!!plan?.ads?.audiences?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    👥 {T('Nhắm vào ai', 'Who to target')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10 }}>
                    {T('Xếp từ rẻ nhất tới đắt nhất. Tệp mà nền tảng nào cũng gợi ý đầu tiên nằm ở CUỐI.',
                       'Cheapest first. The one every platform suggests first is last here.')}
                  </div>
                  {plan.ads.audiences.map((a) => (
                    <div key={a.name} style={{
                      padding: '9px 11px', marginBottom: 7, borderRadius: 9,
                      background: 'var(--c1e293b)',
                      border: `1px solid ${a.name.includes('LOẠI TRỪ') ? '#ef4444' : a.blockedBy ? 'var(--c334155)' : '#6366f1'}`,
                      opacity: a.blockedBy ? 0.75 : 1,
                    }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: a.name.includes('LOẠI TRỪ') ? 'var(--cfca5a5)' : 'var(--ce2e8f0)' }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 1 }}>{a.who}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 4 }}>
                        <strong style={{ color: '#22c55e' }}>{T('Cách nhắm', 'Targeting')}:</strong> {a.how}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{a.why}</div>
                      {a.blockedBy && (
                        <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 3 }}>⚠ {a.blockedBy}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ---- local SEO ---- */}
              {plan?.seo && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    🔍 {T('SEO địa phương', 'Local SEO')}
                  </div>
                  <div style={{ fontSize: 13, color: plan.seo.failing ? 'var(--cfca5a5)' : '#22c55e', marginBottom: 10 }}>{plan.seo.headline}</div>

                  {plan.seo.checks.map((c) => {
                    const st = STATE_STYLE[c.state];
                    return (
                      <div key={c.key} style={{ padding: '9px 0', borderTop: '1px solid var(--c1e293b)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{c.title}</span>
                          <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.text}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5, marginTop: 2 }}>{c.finding}</div>
                        {c.action && (
                          <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 3 }}>
                            <strong style={{ color: '#22c55e' }}>{T('Làm', 'Do')}:</strong> {c.action}
                          </div>
                        )}
                        {c.why && <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45, marginTop: 2 }}>{c.why}</div>}
                      </div>
                    );
                  })}

                  {/* Said out loud rather than quietly folded into a score. */}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                    <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--c64748b)', marginBottom: 5 }}>
                      {T('Phần này KHÔNG đo được', 'What this cannot see')}
                    </div>
                    {plan.seo.blindSpots.map((b, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 3, fontStyle: 'italic' }}>{b}</div>
                    ))}
                  </div>
                </div>
              )}

              {!plan?.ads && !plan?.seo && (
                <div style={{ ...ui.card, textAlign: 'center', padding: '26px 20px', color: 'var(--c94a3b8)', fontSize: 13.5, lineHeight: 1.6 }}>
                  {T('Chưa tính được kế hoạch quảng cáo. Cần tỷ lệ ăn chia thợ và ít nhất vài chục lịch hẹn.',
                     'No ad plan yet — needs the commission rate and a few dozen bookings.')}
                </div>
              )}
            </>
          )}

          {tab === 'calendar' && (
            <>
              {/* ---- what is coming, and what to prepare ---- */}
              {!!plan?.events?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 10 }}>
                    📅 {T('Sắp tới', 'Coming up')}
                  </div>
                  {plan.events.slice(0, 4).map((e) => (
                    <div key={e.name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--c1e293b)' }}>
                      <div style={{ flex: '0 0 66px' }}>
                        <div style={{ fontSize: e.daysAway < 0 ? 13 : 17, fontWeight: 800, color: e.daysAway <= 14 ? '#f59e0b' : 'var(--ca5b4fc)', lineHeight: 1.1 }}>
                          {e.daysAway < 0 ? T('Đang diễn ra', 'On now') : e.daysAway}
                        </div>
                        {e.daysAway >= 0 && <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>{T('ngày nữa', 'days')}</div>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{e.name}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{e.note}</div>
                        {e.daysAway <= 21 && e.daysAway >= 0 && (
                          <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
                            {T('Nên bắt đầu đăng bài từ bây giờ', 'Start posting about this now')}
                          </div>
                        )}
                        {/* An approximate date must never be read as a fact — school
                            start weeks differ by district, not just by state. */}
                        {e.precision === 'approximate' && e.caveat && (
                          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 3, fontStyle: 'italic' }}>
                            {T('Ngày ước lượng', 'Approximate')} — {e.caveat}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* ---- the six-month calendar ----
                   Separate from "Sắp tới" on purpose: that card is what to act on this
                   month, this one is what to order stock and book staff for. */}
              {!!plan?.calendar?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    📆 {T('Lịch ngày lễ 6 tháng tới', 'Next six months')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 8, lineHeight: 1.5 }}>
                    {plan.region?.known
                      ? T(`Đã lọc theo ${plan.region.label} — ngày lễ riêng của bang cũng nằm trong này`, `Filtered for ${plan.region.label}`)
                      : T('Chỉ gồm dịp áp dụng ở mọi nơi, vì chưa biết tiệm ở bang nào', 'Nationwide dates only — state unknown')}
                  </div>
                  {plan.calendar.map((e) => (
                    <div key={`${e.name}-${e.daysAway}`} style={{
                      display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0',
                      borderTop: '1px solid var(--c1e293b)',
                    }}>
                      <div style={{ flex: '0 0 92px', fontSize: 12, color: e.daysAway <= 30 ? '#f59e0b' : 'var(--c64748b)' }}>
                        {e.daysAway < 0 ? T('đang diễn ra', 'on now') : `${e.daysAway} ${T('ngày', 'days')}`}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
                          {e.name}
                          {e.scope === 'regional' && (
                            <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 20, background: 'var(--c451a03)', color: 'var(--cfde68a)' }}>
                              {T('riêng khu vực', 'local')}
                            </span>
                          )}
                          {e.scope === 'cultural' && (
                            <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 20, background: 'var(--c1e293b)', color: 'var(--c94a3b8)' }}>
                              {T('tuỳ tệp khách', 'if it fits')}
                            </span>
                          )}
                          {e.precision === 'approximate' && (
                            <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--c64748b)' }}>{T('· ngày ước lượng', '· approx')}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>{e.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {!isMobile && (
          <aside style={{
            position: 'sticky', top: 8, display: 'flex', flexDirection: 'column', gap: 12,
            // Bounded to the viewport so the column cannot outgrow the screen —
            // a sticky element taller than the window scrolls away, taking the
            // chat with it, which is the one thing a docked chat must not do.
            // The summary cards scroll inside their own strip; the thread keeps
            // its height, because reading three messages at a time is what made
            // the first version useless.
            height: 'calc(100vh - 16px)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 12,
              overflowY: 'auto', flex: '0 1 auto', minHeight: 0,
            }}>
            {regionCard}
            {plan?.week && (
              <div style={{ ...ui.card, padding: 14 }}>
                <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 5 }}>
                  {T('Trọng tâm tuần', 'This week’s aim')}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ca5b4fc)', lineHeight: 1.5 }}>{plan.week.focus}</div>
                <button
                  onClick={() => setTab('week')}
                  style={{ ...ui.primaryBtn, marginTop: 10, width: '100%', background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}
                >
                  {T('Xem kế hoạch tuần', 'Open the week')}
                </button>
              </div>
            )}
            {!!plan?.events?.length && (
              <div style={{ ...ui.card, padding: 14 }}>
                <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 6 }}>
                  {T('Sắp tới', 'Coming up')}
                </div>
                {plan.events.slice(0, 3).map((e) => (
                  <div key={e.name} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13 }}>
                    <span style={{ flex: '0 0 60px', color: e.daysAway <= 14 ? '#f59e0b' : 'var(--c64748b)', fontSize: 12 }}>
                      {e.daysAway < 0 ? T('đang có', 'on now') : `${e.daysAway} ${T('ngày', 'd')}`}
                    </span>
                    <span style={{ color: 'var(--ce2e8f0)', minWidth: 0 }}>{e.name}</span>
                  </div>
                ))}
                <button
                  onClick={() => setTab('calendar')}
                  style={{ ...ui.primaryBtn, marginTop: 8, width: '100%', background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}
                >
                  {T('Xem lịch 6 tháng', 'Six-month calendar')}
                </button>
              </div>
            )}
            {/* The same discount headline used to sit here AND on Today AND
                above the break-even sums — three copies of one sentence, which
                reads as three separate recommendations. It stays where the work
                is, and this rail only carries it on the tabs that do not. */}
            {plan?.offer && tab !== 'today' && tab !== 'audience' && (
              <div style={{ ...ui.card, padding: 14, borderColor: plan.offer.kind === 'raise-price' ? '#22c55e' : 'var(--c334155)' }}>
                <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 5 }}>
                  {T('Khuyến mãi', 'Discount call')}
                </div>
                <div style={{ fontSize: 13.5, color: plan.offer.kind === 'raise-price' ? '#22c55e' : 'var(--ca5b4fc)', lineHeight: 1.5 }}>
                  {plan.offer.headline}
                </div>
                <button
                  onClick={() => setTab('audience')}
                  style={{ ...ui.primaryBtn, marginTop: 10, width: '100%', background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}
                >
                  {T('Xem tính lãi & cách làm', 'See the maths and the plays')}
                </button>
              </div>
            )}

            </div>

            {/* The shared thread, docked. Last in the column so the plan's own
                cards stay at the top where the eye starts, and it takes the rest
                of the height — which on this screen was empty anyway. */}
            <TeamChatDock token={token} unread={unread.total} vi={vi} salonName={plan?.identity?.label} />
          </aside>
        )}
      </div>
    </section>
  );
}
