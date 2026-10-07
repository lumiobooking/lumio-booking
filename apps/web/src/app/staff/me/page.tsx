'use client';

// "Tôi" — the technician's own numbers and settings.
//
// What she made today (her services, her tips — on the bill and straight to
// her), the week as seven bars, her rating, and every personal page one tap
// away: profile, tip QR, reviews, messages, language, light/dark, log out.
// Only HER money: the salon's totals are not hers to see.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StaffShell } from '../../../components/StaffShell';
import { ThemeToggle } from '../../../components/ThemeToggle';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { IC, Icon, L, fmtTurns, st } from '../../../components/staff/kit';
import { PushSetup } from '../../../components/PushSetup';
import { ChangePassword } from '../../../components/staff/ChangePassword';
import { GoalsCard } from '../../../components/staff/GoalsCard';

interface DayMoney { day: number; serviceCents: number; services: number; tipsCents: number; directTipsCents: number }
interface MyDay { currency: string; turns: number; today: Omit<DayMoney, 'day'>; week: DayMoney[]; todayIndex: number }
interface Reviews { recent: { id: string; rating: number; comment: string | null; createdAt: string }[] }
interface Profile { firstName: string; lastName: string | null; avatarUrl: string | null }

export default function StaffMePage() {
  const { lang } = useLang();
  return (
    <StaffShell title={L(lang === 'vi', 'Tôi', 'Me')}>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token, logout } = useAuth();
  const { lang, setLang } = useLang();
  const vi = lang === 'vi';
  const [day, setDay] = useState<MyDay | null>(null);
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [period, setPeriod] = useState<'today' | 'week'>('today');

  const load = useCallback(async () => {
    if (!token) return;
    const [d, r, p] = await Promise.all([
      apiFetch<MyDay>('/my-chair/today', { token }).catch(() => null),
      apiFetch<Reviews>('/reviews/me', { token }).catch(() => null),
      apiFetch<Profile>('/staff/me', { token }).catch(() => null),
    ]);
    setDay(d); setReviews(r); setMe(p);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const cur = day?.currency ?? 'USD';
  const sum = (rows: DayMoney[]) => rows.reduce((a, r) => ({
    serviceCents: a.serviceCents + r.serviceCents, services: a.services + r.services,
    tipsCents: a.tipsCents + r.tipsCents, directTipsCents: a.directTipsCents + r.directTipsCents,
  }), { serviceCents: 0, services: 0, tipsCents: 0, directTipsCents: 0 });
  const shown = period === 'today' ? (day?.today ?? sum([])) : sum(day?.week ?? []);
  const tips = shown.tipsCents + shown.directTipsCents;
  const max = Math.max(1, ...(day?.week ?? []).map((w) => w.serviceCents + w.tipsCents + w.directTipsCents));
  const dows = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const ratings = (reviews?.recent ?? []).filter((r) => typeof r.rating === 'number');
  const avg = ratings.length ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length : null;
  const latest = (reviews?.recent ?? []).find((r) => r.comment?.trim());
  const name = me ? `${me.firstName}${me.lastName ? ' ' + me.lastName : ''}` : '';

  const seg = (k: 'today' | 'week', label: string) => (
    <button type="button" onClick={() => setPeriod(k)} aria-pressed={period === k}
      style={{ flex: 1, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
        background: period === k ? '#4f46e5' : 'transparent', color: period === k ? '#fff' : 'var(--ccbd5e1)' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {me?.avatarUrl
            ? <img src={me.avatarUrl} alt="" width={52} height={52} style={{ borderRadius: 999, objectFit: 'cover' }} />
            : <div style={{ width: 52, height: 52, borderRadius: 999, background: 'var(--c312e81)', color: 'var(--ce0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800 }}>{name.slice(0, 1).toUpperCase()}</div>}
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{name}</div>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, `${fmtTurns(day?.turns ?? 0)} lượt hôm nay`, `${fmtTurns(day?.turns ?? 0)} turns today`)}</div>
          </div>
        </div>
      )}

      <div style={st.card}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--c0f172a)', marginBottom: 14 }}>
          {seg('today', L(vi, 'Hôm nay', 'Today'))}
          {seg('week', L(vi, 'Tuần này', 'This week'))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Dịch vụ bạn làm', 'Your services')}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ce2e8f0)', marginTop: 2 }}>{formatPrice(shown.serviceCents, cur)}</div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{shown.services} {L(vi, 'dịch vụ', 'services')}</div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>Tips</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-good)', marginTop: 2 }}>{formatPrice(tips, cur)}</div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
              {L(vi, `Trên bill ${formatPrice(shown.tipsCents, cur)} · trực tiếp ${formatPrice(shown.directTipsCents, cur)}`, `On bill ${formatPrice(shown.tipsCents, cur)} · direct ${formatPrice(shown.directTipsCents, cur)}`)}
            </div>
          </div>
        </div>
        {day && day.week.length === 7 && (
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96, marginTop: 18 }}>
            {day.week.map((w, i) => {
              const v = w.serviceCents + w.tipsCents + w.directTipsCents;
              const h = v ? Math.max(6, Math.round((v / max) * 72)) : 4;
              const on = i === day.todayIndex;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: h, borderRadius: 6, background: on ? '#6366f1' : v ? 'var(--c475569)' : 'var(--c1e293b)' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>{dows[i]}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <GoalsCard token={token} vi={vi} />

      <Link href="/staff/pay" style={{ ...st.card, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon d={IC.money} size={22} color="var(--ink-good)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L(vi, 'Thu nhập & bảng lương', 'Pay & payslips')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Hoa hồng, tip, thưởng — kỳ này và các kỳ đã chốt', 'Commission, tips, bonuses — this period and closed ones')}</div>
        </div>
        <Icon d={IC.chevron} size={18} color="var(--c94a3b8)" />
      </Link>

      <Link href="/staff/reviews" style={{ ...st.card, textDecoration: 'none', display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{avg != null ? avg.toFixed(1) : '–'}</span>
          <Icon d={IC.star} size={22} color="#f59e0b" fill="#f59e0b" stroke={1} />
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)', marginLeft: 'auto' }}>{ratings.length} {L(vi, 'đánh giá gần đây', 'recent reviews')}</span>
          <Icon d={IC.chevron} size={18} color="var(--c94a3b8)" />
        </div>
        {latest && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 10, lineHeight: 1.5 }}>“{latest.comment}”</div>}
      </Link>

      <div style={st.label}>{L(vi, 'Tài khoản', 'Account')}</div>
      <PushSetup compact />
      <ChangePassword vi={vi} />

      <div style={{ ...st.card, padding: 0, overflow: 'hidden' }}>
        {[
          { href: '/staff/profile', label: L(vi, 'Hồ sơ & ảnh', 'Profile & photo') },
          { href: '/staff/timeoff', label: L(vi, 'Xin nghỉ / ngày nghỉ', 'Time off') },
          { href: '/staff/tips', label: L(vi, 'Mã QR nhận tip', 'Tip QR code') },
          { href: '/staff/reviews', label: L(vi, 'Đánh giá của tôi', 'My reviews') },
          { href: '/staff/inbox', label: L(vi, 'Tin nhắn', 'Messages') },
        ].map((r) => (
          <Link key={r.href} href={r.href} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '0 16px', borderBottom: '1px solid var(--line)', color: 'var(--ce2e8f0)', textDecoration: 'none', fontSize: 15 }}>
            <span style={{ flex: 1 }}>{r.label}</span>
            <Icon d={IC.chevron} size={18} color="var(--c94a3b8)" />
          </Link>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '0 16px', borderBottom: '1px solid var(--line)', fontSize: 15, color: 'var(--ce2e8f0)' }}>
          <span style={{ flex: 1 }}>{L(vi, 'Ngôn ngữ', 'Language')}</span>
          {(['vi', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
              style={{ height: 40, minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: lang === l ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: lang === l ? '#4f46e5' : 'transparent', color: lang === l ? '#fff' : 'var(--ccbd5e1)' }}>
              {l === 'vi' ? 'VI' : 'EN'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '0 16px', borderBottom: '1px solid var(--line)', fontSize: 15, color: 'var(--ce2e8f0)' }}>
          <span style={{ flex: 1 }}>{L(vi, 'Giao diện sáng / tối', 'Light / dark')}</span>
          <ThemeToggle />
        </div>
        <button type="button" onClick={logout}
          style={{ width: '100%', minHeight: 56, padding: '0 16px', background: 'transparent', border: 'none', textAlign: 'left', fontSize: 15, color: 'var(--ink-bad)', cursor: 'pointer' }}>
          {L(vi, 'Đăng xuất', 'Log out')}
        </button>
      </div>
    </div>
  );
}
