'use client';

/**
 * KHÁCH KHÔNG ĐẾN — the owner's no-show policy (API: /bookings/no-show-policy).
 * Warn the desk from N no-shows; optionally refuse online / chat / phone-bot
 * bookings from that number from M no-shows (the desk can always book them).
 * Lumio never charges a fee — a deposit is the salon's own setting above.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { ui } from '../lib/ui';

interface Policy { warnAt: number; blockOnlineAt: number | null; months: number }

export function NoShowPolicyCard() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [p, setP] = useState<Policy | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<Policy>('/bookings/no-show-policy', { token }).then(setP).catch(() => setP(null));
  }, [token]);

  async function save() {
    if (!p || busy) return;
    setBusy(true); setMsg(null);
    try {
      setP(await apiFetch<Policy>('/bookings/no-show-policy', { method: 'PATCH', token, body: p }));
      setMsg(vi ? 'Đã lưu' : 'Saved');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  if (!p) return null;
  const blockOn = p.blockOnlineAt !== null;
  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{vi ? 'Khách không đến (no-show)' : 'No-show policy'}</h3>
      <p style={{ margin: '0 0 12px', color: 'var(--c94a3b8)', fontSize: 13 }}>
        {vi ? 'Lịch quá giờ mà khách không đến được tự đánh dấu "Không đến". Chọn cách tiệm xử lý khách hay bỏ hẹn.'
          : 'Bookings nobody showed up for are marked "No-show" automatically. Choose what happens with repeat no-shows.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{vi ? 'Cảnh báo lễ tân từ (lần)' : 'Warn the desk from (times)'}</span>
          <input style={ui.input} type="number" min={0} max={20} value={p.warnAt} onChange={(e) => setP({ ...p, warnAt: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></label>
        <label><span style={ui.label}>{vi ? 'Tính trong (tháng gần nhất)' : 'Counted over (last months)'}</span>
          <input style={ui.input} type="number" min={1} max={36} value={p.months} onChange={(e) => setP({ ...p, months: Math.min(36, Math.max(1, parseInt(e.target.value, 10) || 1)) })} /></label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={blockOn} onChange={(e) => setP({ ...p, blockOnlineAt: e.target.checked ? Math.max(p.warnAt || 3, 1) : null })} />
        {vi ? 'Không nhận đặt online (web, chat, tổng đài AI) từ số khách đã không đến' : 'Refuse online bookings (web, chat, AI phone) from a number with'}
        {blockOn && <input style={{ ...ui.input, width: 70 }} type="number" min={1} max={20} value={p.blockOnlineAt ?? 3}
          onChange={(e) => setP({ ...p, blockOnlineAt: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)) })} />}
        {blockOn && (vi ? 'lần' : 'no-shows')}
      </label>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
        {vi ? 'Khách bị từ chối chỉ thấy "Vui lòng gọi tiệm để đặt lịch" — không nêu lý do. Lễ tân vẫn đặt được cho khách bình thường. Lumio không tự thu phí; muốn giữ chỗ bằng tiền, dùng mục Đặt cọc.'
          : 'A refused client only sees "Please call the salon to book" — no reason given. The desk can still book them. Lumio charges no fee; to hold slots with money use Deposit.'}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button style={ui.primaryBtn} onClick={save} disabled={busy}>{vi ? 'Lưu' : 'Save'}</button>
        {msg && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{msg}</span>}
      </div>
    </div>
  );
}
