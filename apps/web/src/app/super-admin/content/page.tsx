'use client';

/**
 * The Lumio team's content console.
 *
 * Two jobs, one screen, in the order the week actually happens:
 *   1. the WEEK'S TREND NOTE and the FORMAT LIBRARY — half an hour on Monday,
 *      and every salon in the trade inherits it the next morning;
 *   2. the REVIEW QUEUE — sweep the drafts, fix what is off, publish.
 *
 * The queue is built for speed, not for admiration. Publishing a whole salon
 * in one press is the default path, because a reviewer who must click three
 * times per idea will stop reviewing by Thursday and start rubber-stamping —
 * which is worse than no review at all, since it looks like oversight.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Fmt {
  id: string; industry: string; name: string; summary: string;
  hookGuide: string | null; lengthSec: number | null; audience: string | null;
  heat: string; active: boolean;
}
interface Note { id: string; industry: string; title: string; body: string; expiresAt: string | null; active: boolean }
interface Idea {
  id: string; rank: number; title: string; hook: string | null; shotList: string | null;
  caption: string | null; hashtags: string | null; bestTime: string | null;
  reason: string | null; formatName: string | null;
}
interface Group { tenantId: string; tenantName: string; forDate: string; ideas: Idea[] }

const HEAT_LABEL: Record<string, string> = { hot: '🔥 Đang nóng', steady: 'Ổn định', cold: 'Tạm nghỉ' };

export default function ContentConsolePage() {
  const { token, user, ready } = useAuth();
  const [formats, setFormats] = useState<Fmt[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [nf, setNf] = useState({ name: '', summary: '', hookGuide: '', lengthSec: '', audience: '', heat: 'steady' });
  const [nn, setNn] = useState({ title: '', body: '', days: '14' });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [f, n, q] = await Promise.all([
        apiFetch<Fmt[]>('/admin/content/formats?industry=SALON', { token }),
        apiFetch<Note[]>('/admin/content/notes?industry=SALON', { token }),
        apiFetch<{ groups: Group[] }>('/admin/content/queue', { token }),
      ]);
      setFormats(f); setNotes(n); setGroups(q.groups ?? []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  if (!ready) return <main style={wrap}><p style={{ color: 'var(--c94a3b8)' }}>Loading…</p></main>;
  if (!user) return <main style={wrap}><p style={{ color: 'var(--cfca5a5)' }}>Cần đăng nhập Super Admin.</p></main>;

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Nội dung &amp; xu hướng</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 20px', fontSize: 14 }}>
        Cập nhật thư viện 30 phút mỗi tuần — mọi tiệm cùng ngành nhận ngay sáng hôm sau.
      </p>

      {msg && <div style={{ ...banner, borderColor: '#22c55e', color: '#22c55e' }}>{msg}</div>}
      {err && <div style={{ ...banner, borderColor: '#ef4444', color: 'var(--cfca5a5)' }}>{err}</div>}

      {/* ---- the week's hot note: fastest lane to every salon ---- */}
      <section style={card}>
        <h2 style={h2}>🔥 Đang nóng tuần này</h2>
        <p style={hint}>Tiệm thấy khối này ngay đầu trang. Tự hết hạn sau số ngày bên dưới, để trend cũ không nằm lại trông như còn mới.</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginBottom: 10 }}>
          <input style={inp} placeholder="Tiêu đề — vd: Chrome powder đang lên ở Little Saigon"
            value={nn.title} onChange={(e) => setNn({ ...nn, title: e.target.value })} />
          <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="Mô tả ngắn: định dạng nào, nhạc nào, làm sao bắt trend này"
            value={nn.body} onChange={(e) => setNn({ ...nn, body: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>Hết hạn sau</span>
            <input style={{ ...inp, width: 70 }} value={nn.days} onChange={(e) => setNn({ ...nn, days: e.target.value })} />
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>ngày</span>
            <button style={primary} disabled={busy === 'note' || !nn.title.trim()}
              onClick={() => run('note', () => apiFetch('/admin/content/notes', { method: 'POST', token, body: { industry: 'SALON', title: nn.title, body: nn.body, days: Number(nn.days) || 14 } }).then(() => setNn({ title: '', body: '', days: '14' })), 'Đã đăng ghi chú xu hướng')}>
              Đăng cho mọi tiệm nail
            </button>
          </div>
        </div>
        {notes.filter((n) => n.active).map((n) => (
          <div key={n.id} style={{ borderTop: '1px solid var(--c1e293b)', padding: '9px 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{n.title}</div>
              <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{n.body}</div>
              {n.expiresAt && <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 3 }}>Hết hạn {new Date(n.expiresAt).toLocaleDateString('vi-VN')}</div>}
            </div>
            <button style={ghost} onClick={() => run(`dn${n.id}`, () => apiFetch(`/admin/content/notes/${n.id}`, { method: 'DELETE', token }), 'Đã gỡ')}>Gỡ</button>
          </div>
        ))}
      </section>

      {/* ---- format library ---- */}
      <section style={card}>
        <h2 style={h2}>Thư viện định dạng · ngành nail</h2>
        <p style={hint}>AI chỉ được chọn định dạng từ đây. Đánh dấu &quot;đang nóng&quot; cho cái muốn đẩy tuần này.</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: 10 }}>
          <input style={inp} placeholder="Tên định dạng — vd: Before / after" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          <input style={inp} placeholder="Mô tả một dòng cho AI hiểu" value={nf.summary} onChange={(e) => setNf({ ...nf, summary: e.target.value })} />
          <input style={inp} placeholder="Hook 3 giây đầu nên làm gì" value={nf.hookGuide} onChange={(e) => setNf({ ...nf, hookGuide: e.target.value })} />
          <input style={inp} placeholder="Hợp tệp nào — vd: nữ 25-34" value={nf.audience} onChange={(e) => setNf({ ...nf, audience: e.target.value })} />
          <input style={inp} placeholder="Độ dài (giây)" value={nf.lengthSec} onChange={(e) => setNf({ ...nf, lengthSec: e.target.value })} />
          <select style={inp} value={nf.heat} onChange={(e) => setNf({ ...nf, heat: e.target.value })}>
            <option value="hot">🔥 Đang nóng</option>
            <option value="steady">Ổn định</option>
            <option value="cold">Tạm nghỉ</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={primary} disabled={busy === 'fmt' || !nf.name.trim() || !nf.summary.trim()}
          onClick={() => run('fmt', () => apiFetch('/admin/content/formats', { method: 'POST', token, body: { industry: 'SALON', name: nf.name, summary: nf.summary, hookGuide: nf.hookGuide || null, audience: nf.audience || null, lengthSec: nf.lengthSec ? Number(nf.lengthSec) : null, heat: nf.heat } }).then(() => setNf({ name: '', summary: '', hookGuide: '', lengthSec: '', audience: '', heat: 'steady' })), 'Đã thêm định dạng')}>
          Thêm định dạng
        </button>
        <button style={ghost} disabled={busy === 'seed'}
          onClick={() => run('seed', () => apiFetch('/admin/content/formats/seed', { method: 'POST', token, body: { industry: 'SALON' } }), 'Đã nạp bộ định dạng mẫu')}>
          Nạp 10 định dạng mẫu ngành nail
        </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {formats.filter((f) => f.active).map((f) => (
            <div key={f.id} style={{ borderTop: '1px solid var(--c1e293b)', padding: '9px 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>
                  <b>{f.name}</b>
                  <span style={{ marginLeft: 8, fontSize: 11.5, color: f.heat === 'hot' ? '#f59e0b' : 'var(--c64748b)' }}>{HEAT_LABEL[f.heat] ?? f.heat}</span>
                  {f.lengthSec ? <span style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--c64748b)' }}>~{f.lengthSec}s</span> : null}
                </div>
                <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{f.summary}</div>
                {f.hookGuide && <div style={{ fontSize: 12.5, color: 'var(--c64748b)', marginTop: 2 }}>Hook: {f.hookGuide}</div>}
              </div>
              <button style={ghost} onClick={() => run(`df${f.id}`, () => apiFetch(`/admin/content/formats/${f.id}`, { method: 'DELETE', token }), 'Đã ẩn định dạng')}>Ẩn</button>
            </div>
          ))}
          {!formats.filter((f) => f.active).length && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>Chưa có định dạng nào — thêm vài cái để AI có nguyên liệu.</p>}
        </div>
      </section>

      {/* ---- review queue ---- */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ ...h2, margin: 0 }}>Chờ duyệt</h2>
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{groups.length} tiệm</span>
          <button style={{ ...ghost, marginLeft: 'auto' }} disabled={busy === 'gen'}
            onClick={() => run('gen', () => apiFetch('/admin/content/generate', { method: 'POST', token, body: { industry: 'SALON' } }), 'Đã sinh bản nháp')}>
            Sinh nháp ngay
          </button>
        </div>
        <p style={hint}>Bản nháp không tới tiệm cho tới khi bấm phát hành. Sửa được từng ý trước khi gửi.</p>

        {!groups.length && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>Không có bản nháp nào đang chờ.</p>}

        {groups.map((g) => (
          <div key={`${g.tenantId}|${g.forDate}`} style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{g.tenantName}</b>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{g.forDate}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button style={ghost} disabled={busy === `d${g.tenantId}`}
                  onClick={() => run(`d${g.tenantId}`, () => apiFetch('/admin/content/discard', { method: 'POST', token, body: { ids: g.ideas.map((i) => i.id) } }), 'Đã bỏ bản nháp')}>
                  Bỏ
                </button>
                <button style={primary} disabled={busy === `p${g.tenantId}`}
                  onClick={() => run(`p${g.tenantId}`, () => apiFetch('/admin/content/publish', { method: 'POST', token, body: { ids: g.ideas.map((i) => i.id) } }), `Đã phát hành cho ${g.tenantName}`)}>
                  Phát hành cả 3 ý
                </button>
              </div>
            </div>
            {g.ideas.map((i) => (
              <div key={i.id} style={{ borderTop: '1px solid var(--c1e293b)', padding: '9px 0' }}>
                <div style={{ fontSize: 12, color: 'var(--c64748b)', marginBottom: 2 }}>
                  #{i.rank}{i.formatName ? ` · ${i.formatName}` : ''}{i.bestTime ? ` · ${i.bestTime}` : ''}
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{i.title}</div>
                {i.hook && <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 3 }}>Hook: {i.hook}</div>}
                {i.shotList && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 2 }}>Quay: {i.shotList}</div>}
                {i.caption && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{i.caption}{i.hashtags ? `\n${i.hashtags}` : ''}</div>}
                {i.reason && <div style={{ fontSize: 12, color: 'var(--c93c5fd)', marginTop: 4 }}>Vì sao: {i.reason}</div>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}

const wrap: React.CSSProperties = { maxWidth: 940, margin: '0 auto', padding: '28px 20px 60px', color: 'var(--ce2e8f0)' };
const card: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 18, marginBottom: 18 };
const h2: React.CSSProperties = { fontSize: 17, margin: '0 0 4px' };
const hint: React.CSSProperties = { fontSize: 12.5, color: 'var(--c64748b)', margin: '0 0 12px', lineHeight: 1.55 };
const inp: React.CSSProperties = { padding: '8px 11px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 13.5, width: '100%' };
const primary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer' };
const banner: React.CSSProperties = { border: '1px solid', borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 13.5 };
