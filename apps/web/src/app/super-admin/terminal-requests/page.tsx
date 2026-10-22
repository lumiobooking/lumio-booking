'use client';

/**
 * /super-admin/terminal-requests — the salons' "connect my card machine"
 * requests, newest first, and the answer the team sends back (the salon sees
 * it under its own request on the Card terminals page).
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminBack } from '../../../components/AdminBack';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { guideFor, type TerminalBrand } from '../../../lib/terminal-guides';

interface Row {
  id: string; tenantId: string; salon: string; slug: string; brand: string; brandKey: TerminalBrand; model: string; serial: string;
  note: string; phone: string; status: 'open' | 'sent' | 'done'; reply: string; createdAt: string; byName: string | null;
}

export default function TerminalRequestsPage() {
  const { token, user, ready } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<Row[]>('/admin/terminal-requests', { token }).then((r) => { setRows(r); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : 'Error'));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const save = async (r: Row, status: Row['status']) => {
    try {
      await apiFetch(`/admin/terminal-requests/${encodeURIComponent(r.tenantId)}/${encodeURIComponent(r.id)}`, { method: 'PATCH', token, body: { status, reply: draft[r.id] ?? r.reply } });
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
  };

  if (!ready) return <main style={wrap}><p style={{ color: 'var(--c94a3b8)' }}>Đang tải…</p></main>;
  if (!user) return <main style={wrap}><p style={{ color: 'var(--ink-bad)' }}>Cần đăng nhập Super Admin.</p></main>;
  const list = show === 'open' ? rows.filter((r) => r.status !== 'done') : rows;

  return (
    <main style={wrap}>
      <AdminBack />
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Yêu cầu kết nối máy quẹt thẻ</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 16px', fontSize: 14, lineHeight: 1.6 }}>
        Tiệm gửi tên máy + mã máy ở trang Máy quẹt thẻ và đã thấy ngay hướng dẫn tự kết nối. Trả lời ở đây — tiệm đọc được ngay dưới yêu cầu của mình.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => setShow('open')} style={show === 'open' ? tabOn : tabOff}>Đang mở ({rows.filter((r) => r.status !== 'done').length})</button>
        <button onClick={() => setShow('all')} style={show === 'all' ? tabOn : tabOff}>Tất cả ({rows.length})</button>
      </div>
      {err && <div style={{ color: 'var(--ink-bad)', marginBottom: 10 }}>{err}</div>}
      {list.length === 0 && <div style={{ color: 'var(--c64748b)', padding: 24, textAlign: 'center' }}>Không có yêu cầu nào.</div>}
      {list.map((r) => {
        const g = guideFor(r.brandKey, true);
        return (
          <div key={`${r.tenantId}:${r.id}`} style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{r.salon || r.tenantId}</b>
              <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{new Date(r.createdAt).toLocaleString('vi-VN')}{r.byName ? ` · ${r.byName}` : ''}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: r.status === 'done' ? 'var(--ink-good)' : r.status === 'sent' ? 'var(--ink-sky)' : 'var(--ink-warn)' }}>
                {r.status === 'done' ? 'Đã xong' : r.status === 'sent' ? 'Đã trả lời' : 'Đang mở'}
              </span>
            </div>
            <div style={{ fontSize: 14, marginTop: 6 }}>
              <b>{r.brand}</b>{r.model ? ` · ${r.model}` : ''}{r.serial ? ` · mã ${r.serial}` : ''}
              <span style={{ marginLeft: 8, fontSize: 12, color: g.driven ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{g.driven ? 'Lumio đã nối được' : 'Chưa nối thẳng — ghi nhận tay'}</span>
            </div>
            {r.note && <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 4 }}>📝 {r.note}</div>}
            <textarea
              value={draft[r.id] ?? r.reply}
              onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
              placeholder="Trả lời cho tiệm (hướng dẫn thêm, lịch hẹn hỗ trợ…)"
              rows={2}
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', padding: 8, fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => save(r, 'sent')} style={tabOff}>Gửi trả lời</button>
              <button onClick={() => save(r, 'done')} style={tabOn}>✓ Đánh dấu xong</button>
              {r.status === 'done' && <button onClick={() => save(r, 'open')} style={tabOff}>Mở lại</button>}
            </div>
          </div>
        );
      })}
    </main>
  );
}

const wrap: React.CSSProperties = { maxWidth: 1040, margin: '0 auto', padding: '28px 20px 60px', color: 'var(--ce2e8f0)' };
const TAB: React.CSSProperties = { minHeight: 36, padding: '0 14px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const tabOff: React.CSSProperties = { ...TAB, border: '1px solid var(--c475569)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)' };
const tabOn: React.CSSProperties = { ...TAB, border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff' };
