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

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';

interface Idea {
  id: string;
  rank: number;
  status: string;
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
  platform: { first: string; label: string; why: string; setup: string[]; notYet: string };
  audiences: AdAudience[];
  money: { ceilingStrict: string | null; ceilingRepeat: string | null; daily: string; total: string };
}
interface SeoCheck { key: string; title: string; state: 'pass' | 'warn' | 'fail' | 'unknown'; finding: string; action: string; why: string }
interface Seo { checks: SeoCheck[]; failing: number; headline: string; blindSpots: string[] }
interface PromoPlay { key: string; name: string; offer: string; why: string; useWhen: string; avoidWhen: string; cost: 'low' | 'medium' | 'high' }
interface Promo {
  margin: { commissionPct: number | null; grossMarginPct: number | null; source: string };
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
  region: { label: string; known: boolean; market: string };
  industry: { code: string; trade: string };
  identity: {
    label: string; declared: boolean; filled: number;
    profile: { whatWeDo: string; whoWeServe: string; languages: string; serviceArea: string; edge: string; avoid: string };
    provenance: string[];
    gaps: { field: string; label: string; cost: string }[];
  };
  events: SeasonEvent[];
  week: { days: DayPlan[]; focus: string; basis: string; daily: Job[]; sources: ContentSource[]; trade: string; dataThin: boolean };
  calendar: SeasonEvent[];
  videoFeeds: FeedLink[];
  productWatch: FeedLink[];
  trends: { weekly: TrendLink[]; monthly: TrendLink[]; regionKnown: boolean };
  audience: { totalCustomers: number; segments: Segment[]; targets: AudienceTarget[]; thin: boolean; basis: string };
  promo: Promo;
  area: { ok: boolean; lines: string[]; year: number | null; totalPopulation: number | null; error?: string } | null;
  ads: Ads | null;
  seo: Seo | null;
  offer: Offer;
  lapsed: { count: number; medianDaysAway: number | null };
  quietSlots: { label: string; fillIndex: number }[];
  thin: boolean;
}

type TabId = 'today' | 'week' | 'trends' | 'calendar' | 'audience' | 'ads';

/** One icon per kind of job, so the week reads at a glance on a phone. */
const JOB_ICON: Record<string, string> = {
  film: '🎬', post: '📤', story: '📸', offer: '🏷️', winback: '💬', engage: '💚', rest: '·',
};

export default function ContentTodayPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [data, setData] = useState<Payload | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('today');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [pf, setPf] = useState({ whatWeDo: '', whoWeServe: '', languages: '', serviceArea: '', edge: '', avoid: '' });
  const [savingPf, setSavingPf] = useState(false);
  const isMobile = useIsMobile(900);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // The plan is computed live and can be slower than the ideas; letting it
      // fail on its own means a slow booking query never blanks the whole page.
      const [today, p] = await Promise.all([
        apiFetch<Payload>('/content/today', { token }),
        apiFetch<Plan>('/content/plan', { token }).catch(() => null),
      ]);
      setData(today); setPlan(p);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (plan?.identity?.profile) setPf({ ...plan.identity.profile });
  }, [plan?.identity?.profile]);

  async function mark(id: string, status: string) {
    setBusy(id);
    try {
      await apiFetch(`/content/ideas/${id}/status`, { method: 'POST', token, body: { status } });
      // Update in place: a full reload would scroll a phone back to the top,
      // losing the card the person was standing in front of.
      setData((d) => (d ? { ...d, ideas: d.ideas.map((i) => (i.id === id ? { ...i, status } : i)) } : d));
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
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
          background: 'var(--c1e293b)', color: '#a5b4fc', border: '1px solid var(--c334155)',
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
        <span>{T('Gợi ý theo khu vực', 'Tailored for')} <strong style={{ color: 'var(--ce2e8f0)' }}>{plan.region.label}</strong></span>
      ) : (
        <span style={{ flex: 1, minWidth: 0 }}>
          {T('Chưa biết tiệm ở thành phố nào, nên lịch sự kiện chỉ có các dịp chung. Điền thành phố và bang trong Super Admin để nhận gợi ý sát khu vực.',
             'We do not know this salon’s city yet, so only nationwide dates are shown. Fill in the city and state in Super Admin.')}
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
  ];

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
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 23, margin: '0 0 3px', color: 'var(--ce2e8f0)' }}>
            {T('Nội dung hôm nay', "Today's content")}
          </h1>
          <p style={{ color: 'var(--c94a3b8)', margin: 0, fontSize: 13 }}>
            {data?.forDate ? new Date(`${data.forDate}T00:00:00`).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
            {plan?.region?.known ? ` · ${plan.region.label}` : ''}
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
              {(!plan?.identity?.declared || editProfile) && (
                <div style={{
                  ...ui.card, marginBottom: 14, padding: 16,
                  borderColor: plan?.identity?.declared ? 'var(--c334155)' : '#f59e0b',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
                    🏷️ {T('Doanh nghiệp này làm gì?', 'What is this business?')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginBottom: 10 }}>
                    {T('Mọi gợi ý bên dưới đều dựa vào phần này. Chưa điền thì hệ thống chỉ còn một mã ngành bốn giá trị để đoán — và gợi ý sẽ nghe hợp lý nhưng sai nghề.',
                       'Everything below is derived from this. Without it the system has only a four-value industry code to reason from, and the advice comes out fluent and wrong.')}
                  </div>

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
                      {!!plan.identity.provenance.length && (
                        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 4 }}>
                          {T('Nguồn', 'From')}: {plan.identity.provenance.join(' · ')}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setEditProfile(true)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>
                      {T('Sửa', 'Edit')}
                    </button>
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
              {!!plan?.week?.days?.length && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    🗓️ {T('Tuần này làm gì', 'This week')}
                  </div>
                  <div style={{ fontSize: 13, color: '#a5b4fc', marginBottom: 4 }}>{plan.week.focus}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10, fontStyle: 'italic' }}>{plan.week.basis}</div>

                  {plan.week.days.map((d, i) => {
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
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Where today's clip comes FROM. The most common reason a content
                      plan dies is not laziness — it is standing in the salon at 6pm
                      with nothing filmed and no idea what to point the phone at. */}
                  {!!plan.week.sources?.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                        {T('Quay từ đâu', 'What to film')}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 6 }}>
                        {T(`Nguồn có sẵn của ${plan.week.trade} — không cần dựng cảnh`, 'Already in front of you — nothing to stage')}
                      </div>
                      {plan.week.sources.map((s, k) => (
                        <div key={k} style={{ padding: '5px 0' }}>
                          <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                            • {s.label} <span style={{ color: '#f59e0b', fontSize: 12 }}>· {s.when}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45, paddingLeft: 11 }}>{s.why}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!plan.week.daily?.length && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
                        {T('Mỗi ngày, dù bận cỡ nào', 'Every day, however busy')}
                      </div>
                      {plan.week.daily.map((j, k) => (
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
                </div>
              )}
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
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#a5b4fc' }}>{l.title} ↗</div>
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
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#a5b4fc' }}>{l.title} ↗</div>
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
                        <span style={{ fontSize: 13, color: '#a5b4fc' }}>{sg.count} {T('người', 'people')} · {sg.sharePct}%</span>
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
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{plan.promo.margin.grossMarginPct}%</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--c64748b)', textTransform: 'uppercase' }}>{T('Giảm tối đa nên dùng', 'Safe ceiling')}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#a5b4fc' }}>{plan.promo.ceiling}%</div>
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
                      ?? T('Chưa có số liệu khu vực. Điền ZIP của tiệm ở Super Admin.', 'No area data yet — add the ZIP in Super Admin.')}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'ads' && (
            <>
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
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#a5b4fc' }}>{plan.ads.money.total}</div>
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

              {/* ---- platform ---- */}
              {plan?.ads?.platform && (
                <div style={{ ...ui.card, marginBottom: 14, padding: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 2 }}>
                    🧭 {T('Chạy ở đâu trước', 'Where to start')}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#a5b4fc', marginBottom: 5 }}>{plan.ads.platform.label}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginBottom: 8 }}>{plan.ads.platform.why}</div>
                  {plan.ads.platform.setup.map((s2, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, padding: '3px 0' }}>• {s2}</div>
                  ))}
                  <div style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.5, marginTop: 7 }}>
                    <b>{T('Chưa làm', 'Not yet')}:</b> {plan.ads.platform.notYet}
                  </div>
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
          <aside style={{ position: 'sticky', top: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {regionCard}
            {plan?.week && (
              <div style={{ ...ui.card, padding: 14 }}>
                <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 5 }}>
                  {T('Trọng tâm tuần', 'This week’s aim')}
                </div>
                <div style={{ fontSize: 13.5, color: '#a5b4fc', lineHeight: 1.5 }}>{plan.week.focus}</div>
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
            {plan?.offer && (
              <div style={{ ...ui.card, padding: 14, borderColor: plan.offer.kind === 'raise-price' ? '#22c55e' : 'var(--c334155)' }}>
                <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 5 }}>
                  {T('Khuyến mãi', 'Discount call')}
                </div>
                <div style={{ fontSize: 13.5, color: plan.offer.kind === 'raise-price' ? '#22c55e' : 'var(--ca5b4fc)', lineHeight: 1.5 }}>
                  {plan.offer.headline}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
