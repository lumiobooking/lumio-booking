'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

/**
 * "Đồng bộ với Square POS" — under the Square connection on the Payment
 * terminals page. The salon keeps checking out on Square; Lumio reads each
 * bill (api: square-pos/square-pos.logic.ts).
 */
interface Status {
  connected: boolean;
  enabled: boolean;
  since: string | null;
  pushCustomers: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  last: { imported: number; matched: number; skipped: number; refunds: number; customers: number } | null;
  importedTickets: number;
  teamMembers: { id: string; name: string; staffId: string | null }[];
  squareError: string | null;
  staff: { id: string; name: string }[];
}

const PATH = '/payments-hub/square-pos';

function when(iso: string | null, vi: boolean): string {
  if (!iso) return vi ? 'chưa có' : 'never';
  const d = new Date(iso);
  return d.toLocaleString(vi ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SquarePosSync({ token, vi }: { token: string | null; vi: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [since, setSince] = useState('');
  const t = (a: string, b: string) => (vi ? a : b);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<Status>(PATH, { token });
      setS(r);
      setMap(Object.fromEntries(r.teamMembers.map((m) => [m.id, m.staffId ?? ''])));
      setSince(r.since ? r.since.slice(0, 10) : '');
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  const patch = (body: Record<string, unknown>) => act('save', async () => { setS(await apiFetch<Status>(PATH, { method: 'PATCH', token, body })); setMsg(t('Đã lưu.', 'Saved.')); });
  const syncNow = () => act('sync', async () => {
    const r = await apiFetch<{ imported: number; matched: number; skipped: number; refunds: number; customers: number }>(`${PATH}/sync`, { method: 'POST', token });
    setMsg(t(`Đã đồng bộ: ${r.imported} hoá đơn mới (${r.matched} khớp lịch hẹn), ${r.refunds} hoàn tiền, ${r.customers} khách gửi sang Square.`,
      `Synced: ${r.imported} new bills (${r.matched} matched to bookings), ${r.refunds} refunds, ${r.customers} clients sent to Square.`));
    await load();
  });
  const pushMenu = () => act('menu', async () => {
    const r = await apiFetch<{ added: number; alreadyThere: number }>(`${PATH}/push-menu`, { method: 'POST', token });
    setMsg(t(`Đã thêm ${r.added} dịch vụ vào Square (${r.alreadyThere} đã có sẵn).`, `Added ${r.added} services to Square (${r.alreadyThere} were already there).`));
  });

  if (!s) return err ? <div style={{ marginTop: 14, color: 'var(--cfca5a5)', fontSize: 13 }}>{err}</div> : null;

  const box: CSSProperties = { marginTop: 16, padding: 16, borderRadius: 12, border: '1.5px solid #6366f1', background: 'var(--c1e1b4b)' };
  const small: CSSProperties = { fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 };

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{t('Đồng bộ với Square POS', 'Sync with Square POS')}</strong>
          <div style={small}>{t('Tiệm vẫn tính tiền trên Square như cũ. Mỗi hoá đơn trả trên Square tự vào Lumio (doanh thu, tip, lương thợ) và lịch hẹn của khách được đánh dấu xong.',
            'Keep checking out on Square. Every bill paid there comes into Lumio (sales, tips, payroll) and the client’s booking is marked done.')}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)', cursor: 'pointer' }}>
          <input type="checkbox" checked={s.enabled} disabled={busy !== null} onChange={(e) => patch({ enabled: e.target.checked })} style={{ width: 18, height: 18 }} />
          {s.enabled ? t('Đang bật', 'On') : t('Đang tắt', 'Off')}
        </label>
      </div>

      {err && <div style={{ marginTop: 10, color: 'var(--cfca5a5)', fontSize: 13 }}>{err}</div>}
      {msg && <div style={{ marginTop: 10, color: 'var(--c86efac)', fontSize: 13 }}>{msg}</div>}
      {s.squareError && <div style={{ marginTop: 10, color: 'var(--cfca5a5)', fontSize: 13 }}>Square: {s.squareError}</div>}

      {s.enabled && (
        <>
          <div style={{ ...small, marginTop: 12 }}>
            {t('Lần đồng bộ gần nhất', 'Last sync')}: <strong>{when(s.lastRunAt, vi)}</strong>
            {s.last && <> · {t(`${s.last.imported} hoá đơn mới, ${s.last.matched} khớp lịch hẹn`, `${s.last.imported} new bills, ${s.last.matched} matched to bookings`)}</>}
            {' · '}{t(`Tổng ${s.importedTickets} hoá đơn từ Square`, `${s.importedTickets} Square bills in total`)}
            {s.lastError && <div style={{ color: 'var(--cfca5a5)' }}>{t('Lỗi lần trước', 'Last error')}: {s.lastError}</div>}
            <div>{t('Tự đồng bộ mỗi 5 phút.', 'Syncs by itself every 5 minutes.')}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={syncNow} disabled={busy !== null} style={{ ...ui.primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy === 'sync' ? '…' : t('Đồng bộ ngay', 'Sync now')}</button>
            <button onClick={pushMenu} disabled={busy !== null} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)', opacity: busy ? 0.6 : 1 }}>{busy === 'menu' ? '…' : t('Gửi menu dịch vụ sang Square', 'Send the service menu to Square')}</button>
          </div>

          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>{t('Nhân viên Square là thợ nào?', 'Which technician is each Square team member?')}</strong>
            <div style={small}>{t('Để doanh thu và tip vào đúng thợ khi hoá đơn không khớp được lịch hẹn nào.', 'So sales and tips go to the right technician when a bill matches no booking.')}</div>
            {s.teamMembers.length === 0 ? <div style={small}>{t('Không đọc được danh sách nhân viên từ Square.', 'Could not read the team list from Square.')}</div> : (
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {s.teamMembers.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 160, fontSize: 13, color: 'var(--ce2e8f0)' }}>{m.name}</span>
                    <span style={{ color: 'var(--c94a3b8)' }}>→</span>
                    <select value={map[m.id] ?? ''} onChange={(e) => setMap({ ...map, [m.id]: e.target.value })} style={{ ...ui.input, width: 200 }}>
                      <option value="">{t('— Không gán thợ —', '— No technician —')}</option>
                      {s.staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>
                ))}
                <div><button onClick={() => patch({ staffMap: map })} disabled={busy !== null} style={{ ...ui.primaryBtn, marginTop: 4 }}>{t('Lưu', 'Save')}</button></div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--ce2e8f0)' }}>
              <input type="checkbox" checked={s.pushCustomers} onChange={(e) => patch({ pushCustomers: e.target.checked })} style={{ marginTop: 2 }} />
              <span>{t('Gửi khách có hẹn hôm nay sang danh sách khách của Square', 'Add today’s booked clients to Square’s customer list')}
                <span style={{ ...small, display: 'block' }}>{t('Ở quầy, chọn đúng khách trên Square khi tính tiền thì Lumio khớp hoá đơn với lịch hẹn chắc chắn nhất.', 'At checkout, picking the client on Square is what lets Lumio match the bill to the booking for sure.')}</span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--ce2e8f0)' }}>
              {t('Lấy hoá đơn Square từ ngày', 'Read Square bills from')}
              <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ ...ui.input, width: 170 }} />
              <button onClick={() => since && patch({ since: new Date(`${since}T00:00:00`).toISOString() })} disabled={busy !== null || !since} style={{ ...ui.primaryBtn, opacity: since ? 1 : 0.6 }}>{t('Áp dụng', 'Apply')}</button>
              <span style={small}>{t('(tối đa 31 ngày trước; hoá đơn đã lấy không bị lấy lại)', '(up to 31 days back; bills already read are not read again)')}</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
