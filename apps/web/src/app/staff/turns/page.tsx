'use client';

// "Lượt" — where the technician stands in today's rotation.
//
// The question every technician asks a dozen times a day is "am I next?".
// Before this page the only way to know was to walk to the front desk and
// read the board. Here it is one big number, the queue at the desk, and the
// whole team in the order the system will hand out the next client — with
// who is busy and roughly for how long. The rule itself is printed under it,
// so nobody has to argue about it.

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveEvents } from '../../../lib/useLiveEvents';
import { IC, Icon, L, fmtTurns, st } from '../../../components/staff/kit';

interface Tech { id: string; name: string; rank: number; turns: number; busy: boolean; busyFor: number | null; me: boolean; nextUp: boolean }
interface MyDay { staffId: string | null; turns: number; busy: boolean; freeRank: number | null; nextUpStaffId: string | null; queue: number; techs: Tech[] }

export default function StaffTurnsPage() {
  const { lang } = useLang();
  return (
    <StaffShell title={L(lang === 'vi', 'Lượt hôm nay', 'Today’s turns')}>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [day, setDay] = useState<MyDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setDay(await apiFetch<MyDay>('/my-chair/today', { token })); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, 15000);
  useLiveEvents('/my-chair/events', token, () => { void load(); });

  if (!day) return error ? <div style={{ ...st.card, color: 'var(--ink-bad)' }}>{error}</div> : <p style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</p>;

  // Busy: her turns so far (her place comes back when she is free again).
  const big = day.busy ? fmtTurns(day.turns) : String(day.freeRank ?? '–');
  const title = day.busy
    ? L(vi, 'Bạn đang làm', 'You are with a client')
    : day.freeRank === 1 ? L(vi, 'Bạn là người tiếp theo', 'You are next') : L(vi, `Bạn đứng thứ ${day.freeRank ?? '–'}`, `You are #${day.freeRank ?? '–'}`);
  const line = day.busy
    ? L(vi, 'Xong khách, bạn tự vào hàng theo số lượt — không cần báo quầy.', 'When you finish you join the line by your turns — no need to tell the desk.')
    : day.freeRank === 1
      ? L(vi, 'Khách đến là hệ thống giao cho bạn ngay. Điện thoại sẽ báo.', 'The next client goes straight to you. Your phone will buzz.')
      : L(vi, `Trước bạn còn ${(day.freeRank ?? 1) - 1} người rảnh. Khách đến là hệ thống tự giao — bạn không cần canh.`, 'Clients are handed out automatically — no need to watch the desk.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...st.card, background: 'var(--c1e1b4b)', borderColor: 'var(--c3730a3)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ minWidth: 56, textAlign: 'center' }}>
          <div style={{ fontSize: 50, fontWeight: 800, color: 'var(--cc7d2fe)', lineHeight: 1 }}>{big}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cc7d2fe)', marginTop: 2 }}>{day.busy ? L(vi, 'lượt', 'turns') : L(vi, 'thứ tự', 'in line')}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cc7d2fe)' }}>{title}</div>
          <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 4, lineHeight: 1.45 }}>{line}</div>
        </div>
      </div>

      <div style={{ ...st.card, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <Icon d={IC.clock} size={22} color="var(--ink-warn)" />
        <span style={{ fontSize: 15, color: 'var(--ce2e8f0)', flex: 1 }}>
          {day.queue > 0 ? (vi ? <><b>{day.queue} khách</b> đang chờ ở quầy</> : <><b>{day.queue}</b> waiting at the desk</>) : L(vi, 'Không có khách nào đang chờ', 'Nobody waiting')}
        </span>
        <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, `Bạn: ${fmtTurns(day.turns)} lượt`, `You: ${fmtTurns(day.turns)}`)}</span>
      </div>

      <div style={{ ...st.card, padding: 0, overflow: 'hidden' }}>
        {day.techs.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 'none', background: t.me ? 'var(--row-on)' : 'transparent', minHeight: 56 }}>
            <span style={{ width: 30, height: 30, borderRadius: 999, background: t.nextUp ? '#15803d' : 'var(--c1e293b)', color: t.nextUp ? '#fff' : 'var(--ccbd5e1)', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{t.rank}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{t.name}{t.me ? L(vi, ' (bạn)', ' (you)') : ''}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: t.busy ? 'var(--ink-warn)' : t.nextUp ? 'var(--ink-good)' : 'var(--ink-good)' }}>
                {t.busy
                  ? (t.busyFor != null ? L(vi, `Đang làm · còn ~${t.busyFor}′`, `Busy · ~${t.busyFor}′ left`) : L(vi, 'Đang làm', 'Busy'))
                  : t.nextUp ? L(vi, 'Rảnh · tới lượt', 'Free · next up') : L(vi, 'Rảnh', 'Free')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{fmtTurns(t.turns)}</div>
              <div style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{L(vi, 'lượt', 'turns')}</div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.55, margin: 0 }}>
        {L(vi,
          'Cách chia: thợ đang rảnh và ít lượt nhất nhận khách trước; bằng lượt thì theo thứ tự ưu tiên của tiệm. Dịch vụ phụ nhỏ tính ½ lượt. Tay và chân có thể do 2 thợ làm cùng lúc.',
          'How it works: the free technician with the fewest turns gets the next client; ties go by the salon’s priority. Small add-ons count ½. Hands and feet can be done by two technicians at once.')}
      </p>
    </div>
  );
}
