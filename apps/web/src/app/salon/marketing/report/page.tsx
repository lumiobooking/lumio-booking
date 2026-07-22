'use client';

import { useCallback, useEffect, useState, CSSProperties, ReactNode } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { useLang } from '../../../../lib/i18n';

type Src = 'website' | 'lumiolink' | 'online' | 'hotline' | 'messenger' | 'walkin' | 'staff';
interface Channel { key: Src; bookings: number; showed: number; revenueCents: number }
interface Overview {
  range: { from: string; to: string };
  channels: Channel[];
  totals: { bookings: number; showed: number; revenueCents: number };
  owned: { googleReviews: number; reviewClicks: number; messengerThreads: number; voiceCalls: number; voiceBooked: number; emailsSent: number; referredNewCustomers: number };
  byCampaign?: { key: string; source: string | null; bookings: number; showed: number; revenueCents: number }[];
  hasCostData: boolean;
}

const SRC_COLOR: Record<Src, string> = { website: '#6366f1', lumiolink: '#0ea5e9', online: '#64748b', hotline: '#22c55e', messenger: '#3b82f6', walkin: '#f59e0b', staff: '#a78bfa' };
const SRC_LABEL = (s: Src, vi: boolean): string => ({
  website: vi ? 'Website tiệm' : 'Website', lumiolink: vi ? 'Link Lumio' : 'Lumio link',
  online: vi ? 'Online (chưa rõ)' : 'Online', hotline: 'Hotline', messenger: 'Messenger',
  walkin: vi ? 'Khách vãng lai' : 'Walk-in', staff: vi ? 'Nhân viên nhập' : 'Staff',
}[s]);

const isoToday = () => new Date().toISOString().slice(0, 10);

export default function MarketingReportPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(isoToday());
  const [data, setData] = useState<Overview | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [ov, settings] = await Promise.all([
        apiFetch<Overview>(`/marketing/overview?from=${from}&to=${to}`, { token }),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setData(ov);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  function preset(kind: 'thisMonth' | 'lastMonth' | 'thisYear' | 'last7') {
    const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (kind === 'thisMonth') { setFrom(iso(new Date(y, m, 1))); setTo(isoToday()); }
    else if (kind === 'lastMonth') { setFrom(iso(new Date(y, m - 1, 1))); setTo(iso(new Date(y, m, 0))); }
    else if (kind === 'thisYear') { setFrom(iso(new Date(y, 0, 1))); setTo(isoToday()); }
    else { setFrom(iso(new Date(Date.now() - 6 * 86400000))); setTo(isoToday()); }
  }
  const activePreset = (() => {
    const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (from === iso(new Date(Date.now() - 6 * 86400000)) && to === isoToday()) return 'last7';
    if (from === iso(new Date(y, m, 1)) && to === isoToday()) return 'thisMonth';
    if (from === iso(new Date(y, m - 1, 1)) && to === iso(new Date(y, m, 0))) return 'lastMonth';
    if (from === iso(new Date(y, 0, 1)) && to === isoToday()) return 'thisYear';
    return 'custom';
  })();

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const money = (c: number) => formatPrice(c, currency);

  if (loading && !data) return <section><h2 style={{ fontSize: 18 }}>{T('Báo cáo marketing', 'Marketing report')}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  const tot = data?.totals;
  const channels = (data?.channels ?? []).filter((c) => c.bookings > 0 || c.revenueCents > 0);
  const maxRev = Math.max(1, ...channels.map((c) => c.revenueCents));

  return (
    <section>
      <MktTabs vi={vi} active="live" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>{T('Tổng quan trực tiếp', 'Live overview')}</h2>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 13 }}>{T('Marketing mang lại bao nhiêu booking, bao nhiêu khách đến, doanh thu bao nhiêu — từ dữ liệu thật của tiệm.', 'How many bookings, showed-up customers and revenue marketing brought — from the salon’s real data.')}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{T('Từ', 'From')}</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{T('đến', 'to')}</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={dateInput} />
        <span style={{ width: 1, height: 20, background: '#334155', margin: '0 2px' }} />
        <button onClick={() => preset('last7')} style={chip(activePreset === 'last7')}>{T('7 ngày', 'Last 7d')}</button>
        <button onClick={() => preset('thisMonth')} style={chip(activePreset === 'thisMonth')}>{T('Tháng này', 'This month')}</button>
        <button onClick={() => preset('lastMonth')} style={chip(activePreset === 'lastMonth')}>{T('Tháng trước', 'Last month')}</button>
        <button onClick={() => preset('thisYear')} style={chip(activePreset === 'thisYear')}>{T('Năm nay', 'This year')}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {/* Headline funnel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label={T('Booking từ đặt lịch', 'Bookings')} value={String(tot?.bookings ?? 0)} />
        <Kpi label={T('Khách đã đến', 'Showed up')} value={String(tot?.showed ?? 0)} hint={`${pct(tot?.showed ?? 0, tot?.bookings ?? 0)}% ${T('đến', 'showed')}`} accent="#22c55e" />
        <Kpi label={T('Doanh thu (từ lịch)', 'Revenue (booked)')} value={money(tot?.revenueCents ?? 0)} accent="#22c55e" />
        <Kpi label={T('Đánh giá Google mới', 'New Google reviews')} value={String(data?.owned.googleReviews ?? 0)} />
        <Kpi label={T('Khách từ giới thiệu', 'Referred customers')} value={String(data?.owned.referredNewCustomers ?? 0)} />
      </div>

      {/* Per-channel funnel */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('Từng kênh: đặt lịch → đến → doanh thu', 'Per channel: booked → showed → revenue')}</div>
        {channels.length === 0 ? <Empty vi={vi} /> : (
          <div>
            <div style={{ display: 'none' }} />
            {channels.map((c) => (
              <div key={c.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: SRC_COLOR[c.key] }} />{SRC_LABEL(c.key, vi)}
                  </span>
                  <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
                    {c.bookings} {T('đặt', 'booked')} → <span style={{ color: '#22c55e' }}>{c.showed} {T('đến', 'showed')}</span> → <span style={{ color: '#22c55e', fontWeight: 700 }}>{money(c.revenueCents)}</span>
                  </span>
                </div>
                <div style={{ height: 8, background: '#0f172a', borderRadius: 999 }}>
                  <div style={{ height: '100%', width: `${Math.max(3, (c.revenueCents / maxRev) * 100)}%`, background: SRC_COLOR[c.key], borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-campaign attribution (UTM) */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('Theo chiến dịch / nội dung (UTM)', 'By campaign / content (UTM)')}</div>
        {(data?.byCampaign ?? []).length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            {vi ? 'Chưa có booking nào gắn UTM trong kỳ này. Gắn utm_campaign vào link đặt lịch trên từng bài/quảng cáo để đo bài nào ra khách.'
                : 'No UTM-tagged bookings in this period. Add utm_campaign to the booking link on each post/ad to see which one converts.'}
          </p>
        ) : (() => {
          const maxRev = Math.max(1, ...(data!.byCampaign!).map((c) => c.revenueCents));
          return data!.byCampaign!.map((c) => (
            <div key={c.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, fontSize: 13 }}>
                <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                  {c.key}{c.source ? <span style={{ color: '#64748b' }}> · {c.source}</span> : null}
                </span>
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>{c.bookings} {T('đặt', 'booked')} → <span style={{ color: '#22c55e' }}>{c.showed} {T('đến', 'showed')}</span> → <span style={{ color: '#22c55e', fontWeight: 700 }}>{money(c.revenueCents)}</span></span>
              </div>
              <div style={{ height: 6, background: '#0f172a', borderRadius: 999 }}><div style={{ height: '100%', width: `${Math.max(3, (c.revenueCents / maxRev) * 100)}%`, background: '#0ea5e9', borderRadius: 999 }} /></div>
            </div>
          ));
        })()}
      </div>

      {/* Owned-channel activity */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('Hoạt động các kênh sở hữu', 'Owned-channel activity')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <Mini label={T('Bấm nút đánh giá', 'Review clicks')} value={data?.owned.reviewClicks ?? 0} />
          <Mini label={T('Tin nhắn Messenger', 'Messenger chats')} value={data?.owned.messengerThreads ?? 0} />
          <Mini label={T('Cuộc gọi Hotline', 'Hotline calls')} value={data?.owned.voiceCalls ?? 0} hint={`${data?.owned.voiceBooked ?? 0} ${T('ra booking', 'booked')}`} />
          <Mini label={T('Email đã gửi', 'Emails sent')} value={data?.owned.emailsSent ?? 0} />
        </div>
      </div>

      {/* Phase-1 note (honest: no fabricated cost/ROI yet) */}
      <div style={{ border: '1px solid #334155', background: '#1e293b', borderRadius: 10, padding: 12, fontSize: 12.5, color: '#a5b4fc', lineHeight: 1.6 }}>
        {T('Chi phí quảng cáo, lượt tiếp cận và chỉ số ROI/CPL sẽ xuất hiện ở bước tiếp theo khi nhập chi phí từng kênh (Giai đoạn 1). Hệ thống không hiển thị con số ước đoán — chỉ số liệu thật.',
           'Ad spend, reach and ROI/CPL appear in the next step once per-channel cost is entered (Phase 1). The system shows no estimated numbers — only real data.')}
      </div>
    </section>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? '#fff' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
function Mini({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{value}{hint && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}> · {hint}</span>}</div>
    </div>
  );
}
function Empty({ vi }: { vi: boolean }) {
  return <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>{vi ? 'Chưa có dữ liệu trong kỳ này.' : 'No data in this period.'}</p>;
}

function MktTabs({ vi, active }: { vi: boolean; active: 'monthly' | 'live' }) {
  const tab = (on: boolean): CSSProperties => ({ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: on ? 700 : 500, textDecoration: 'none', color: on ? '#fff' : '#94a3b8', background: on ? '#6366f1' : 'transparent', border: on ? 'none' : '1px solid #334155' });
  return (
    <div style={{ display: 'inline-flex', gap: 6, marginBottom: 14 }}>
      <a href="/salon/marketing/monthly" style={tab(active === 'monthly')}>{vi ? 'Báo cáo tháng' : 'Monthly report'}</a>
      <a href="/salon/marketing/report" style={tab(active === 'live')}>{vi ? 'Tổng quan trực tiếp' : 'Live overview'}</a>
    </div>
  );
}
const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 12 };
const dateInput: CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const chip = (on: boolean): CSSProperties => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? '#6366f1' : '#334155'}`, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#cbd5e1', fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer' });
