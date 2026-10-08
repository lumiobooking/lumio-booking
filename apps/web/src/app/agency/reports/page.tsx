'use client';

// ---------------------------------------------------------------------------
// Every salon's monthly report on one screen. Where it stands (collecting →
// closing → draft → sent), whether its channels are being read, whether the
// AI wrote a figure that is not in the data, and whether it went out. The
// row that needs a person comes first. "Mở" drops the employee into that
// salon's report page in a salon session, exactly like the salon list does.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { enterSupportSession } from '../../../lib/support-session';

type State = 'collecting' | 'closing' | 'draft' | 'approved' | 'sent' | 'none';
type Level = 'ok' | 'warn' | 'bad' | 'off';
interface Row {
  tenantId: string; name: string; slug: string; market: string | null;
  state: State; nextAction: 'wait' | 'closing' | 'review' | 'send' | 'auto-send' | 'done' | 'generate';
  autoSend: boolean; autoSendDue: boolean;
  report: { status: string; approvedAt: string | null; sentAt: string | null; updatedAt: string } | null;
  health: { worst: Level; counts: Record<Level, number>; bad: string[] };
  posts: number; measuredAt: string | null; queued: number; guardStray: number;
}
interface Board { month: string; rows: Row[]; totals: Record<State, number> }

const STATE_LABEL: Record<State, string> = { collecting: 'Đang thu thập', closing: 'Chốt số', none: 'Chưa có nháp', draft: 'Nháp chờ duyệt', approved: 'Đã duyệt', sent: 'Đã gửi' };
const STATE_COLOR: Record<State, string> = { collecting: 'var(--c94a3b8)', closing: 'var(--ink-sky)', none: 'var(--ink-warn)', draft: 'var(--ink-warn)', approved: 'var(--ink-good)', sent: 'var(--ink-good)' };
const NEXT: Record<Row['nextAction'], string> = {
  wait: 'Tháng đang chạy', closing: 'Đang đọc lần cuối', review: 'Đọc nháp & gửi', send: 'Bấm gửi', 'auto-send': 'Tự gửi theo lịch', done: 'Xong', generate: 'Tạo báo cáo',
};

function monthKey(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function prevMonth(m: string): string { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; }
function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AgencyReportsPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  // The month that just ended is the one the agency reports on.
  const [month, setMonth] = useState(prevMonth(monthKey()));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'bad' | 'sent'>('todo');

  useEffect(() => {
    if (!ready) return;
    if (!user || (user.role !== 'SUPPORT' && user.role !== 'SUPER_ADMIN')) router.replace('/login');
  }, [ready, user, router]);

  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    apiFetch<Board>(`/support/reports?month=${month}`, { token }).then(setBoard).catch((e) => setError(e instanceof Error ? e.message : 'error'));
  }, [token, month]);
  useEffect(() => { load(); }, [load]);

  async function open(r: Row) {
    if (!token || !user) return;
    setBusy(r.tenantId);
    try {
      const s = await apiFetch<{ accessToken: string; tenant: { id: string; name: string; slug: string }; level?: string; custom?: boolean; capabilities?: string[] }>(
        `/support/enter/${r.tenantId}`, { method: 'POST', token, body: {} },
      );
      enterSupportSession({
        accessToken: s.accessToken,
        user: {
          id: user.id, email: user.email, role: 'SALON_ADMIN' as const, tenantId: s.tenant.id,
          firstName: user.firstName || 'Lumio', lastName: 'Support', supportSession: true, tenantName: s.tenant.name,
          supportLevel: s.level, supportCustom: s.custom === true, capabilities: s.capabilities,
        },
      } as never);
      window.location.assign(`/salon/marketing/monthly?month=${month}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter this salon');
      setBusy(null);
    }
  }

  const rows = useMemo(() => {
    const all = board?.rows ?? [];
    if (filter === 'bad') return all.filter((r) => r.health.worst === 'bad' || r.guardStray > 0);
    if (filter === 'sent') return all.filter((r) => r.state === 'sent');
    if (filter === 'todo') return all.filter((r) => r.state !== 'sent' && r.state !== 'collecting');
    return all;
  }, [board, filter]);

  const dot = (l: Level) => (l === 'ok' ? 'var(--ink-good)' : l === 'warn' ? 'var(--ink-warn)' : l === 'bad' ? 'var(--ink-bad)' : 'var(--c64748b)');
  const t = board?.totals;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <a href="/agency" style={{ color: 'var(--c94a3b8)', textDecoration: 'none', fontSize: 13 }}>← Danh sách tiệm</a>
        <h1 style={{ fontSize: 20, margin: 0, color: 'var(--cf8fafc)' }}>Báo cáo tháng — mọi tiệm</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginLeft: 'auto', background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ce2e8f0)', padding: '6px 10px' }} />
        <button onClick={load} style={{ background: 'var(--c1e293b)', border: '1px solid var(--line)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Tải lại</button>
      </div>
      {error && <div style={{ color: 'var(--ink-bad)', marginBottom: 10 }}>{error}</div>}
      {t && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5 }}>
          {(['todo', 'bad', 'sent', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? '#6366f1' : 'var(--c1e293b)', color: filter === f ? '#fff' : 'var(--ce2e8f0)', border: '1px solid var(--line)', borderRadius: 999, padding: '4px 12px', cursor: 'pointer' }}>
              {f === 'todo' ? `Cần làm (${(board?.rows ?? []).filter((r) => r.state !== 'sent' && r.state !== 'collecting').length})`
                : f === 'bad' ? `Có vấn đề (${(board?.rows ?? []).filter((r) => r.health.worst === 'bad' || r.guardStray > 0).length})`
                  : f === 'sent' ? `Đã gửi (${t.sent})` : `Tất cả (${board?.rows.length ?? 0})`}
            </button>
          ))}
          <span style={{ color: 'var(--c64748b)', alignSelf: 'center' }}>
            Nháp {t.draft} · Đã duyệt {t.approved} · Đã gửi {t.sent} · Chưa có nháp {t.none} · Đang thu thập {t.collecting}
          </span>
        </div>
      )}
      {!board && !error && <p style={{ color: 'var(--c94a3b8)' }}>Đang tải…</p>}
      {board && rows.length === 0 && <p style={{ color: 'var(--c94a3b8)' }}>Không có tiệm nào trong nhóm này.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.tenantId} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 1fr 1.2fr 1fr auto', gap: 12, alignItems: 'center', background: 'var(--c111a2c)', border: `1px solid ${r.health.worst === 'bad' || r.guardStray ? 'var(--ink-bad)' : 'var(--line)'}`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--cf8fafc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>{r.slug}{r.market ? ` · ${r.market}` : ''}{r.autoSend ? ' · tự gửi' : ''}</div>
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: STATE_COLOR[r.state] }}>{STATE_LABEL[r.state]}</span>
              <div style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{NEXT[r.nextAction]}{r.autoSendDue ? ' (hôm nay)' : ''}{r.report?.sentAt ? ` · ${when(r.report.sentAt)}` : ''}</div>
            </div>
            <div style={{ fontSize: 11.5 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: dot(r.health.worst), fontSize: 10 }}>●</span>
                <span style={{ color: 'var(--ce2e8f0)' }}>
                  {r.health.counts.ok} xanh · {r.health.counts.warn} vàng · {r.health.counts.bad} đỏ{r.health.counts.ok + r.health.counts.warn + r.health.counts.bad === 0 ? ' · chưa kết nối kênh' : ''}
                </span>
              </div>
              {r.health.bad.length > 0 && <div style={{ color: 'var(--ink-bad)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.health.bad.join(' | ')}>{r.health.bad[0]}</div>}
              {r.guardStray > 0 && <div style={{ color: 'var(--ink-warn)' }}>AI viết {r.guardStray} số không có trong dữ liệu — cần sửa</div>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
              {r.posts} bài{r.measuredAt ? ` · đo ${when(r.measuredAt)}` : ''}{r.queued ? ` · ${r.queued} chờ đọc` : ''}
            </div>
            <button onClick={() => open(r)} disabled={busy === r.tenantId} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {busy === r.tenantId ? '…' : 'Mở'}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
