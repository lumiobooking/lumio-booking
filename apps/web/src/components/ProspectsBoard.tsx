'use client';

/**
 * rt218 — "mục thống kê khách tiềm năng và khách hàng có để lại thông tin phone
 * và email để nhân viên follow up". One place with the numbers and the list:
 * every customer who left a phone number or an email and never booked, who
 * holds them, and a button to give the unheld ones to the team. The owner sees
 * the whole salon; a team member sees their own and the unheld ones (the
 * server decides, per salon).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fmtInTz } from '../lib/datetime';

type Row = { threadId: string; name: string; phone: string | null; email: string | null; page: string | null; channel: string; lastAt: string; lastText: string; heldBy: string | null; mine: boolean; stage: string | null };
type Board = { days: number; canGiveOut: boolean; totals: { all: number; phone: number; email: number; both: number; unheld: number; mine: number }; perPerson: { name: string; n: number }[]; rows: Row[] };
type Show = 'all' | 'unheld' | 'mine' | 'phone' | 'email';

const cell: React.CSSProperties = { padding: '8px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };

export function ProspectsBoard({ token, vi, inboxHref = '/salon/inbox' }: { token: string | null; vi: boolean; inboxHref?: string }) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    if (!token) return;
    try { setBoard(await apiFetch<Board>(`/messenger/prospects?days=${days}`, { token })); setErr(null); } catch (e) { setErr(String(e).replace(/^Error:\s*/, '')); }
  }, [token, days]);
  useEffect(() => { setBoard(null); void load(); }, [load]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); window.setTimeout(() => setCopied(null), 1500); } catch { /* the text is selectable */ }
  };
  const giveOut = async () => {
    if (!token) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ total: number; per: { name: string; n: number }[] }>('/messenger/prospects/give-out', { method: 'POST', token, body: { days } });
      setMsg(r.total ? T(`Đã chia ${r.total} khách: ${r.per.filter((p) => p.n).map((p) => `${p.name} ${p.n}`).join(' · ')}`, `Gave out ${r.total}`) : T('Không còn khách nào chưa có người giữ.', 'Nobody left unheld.'));
      await load();
    } catch (e) { setMsg(String(e).replace(/^Error:\s*/, '')); } finally { setBusy(false); }
  };

  const rows = (board?.rows ?? []).filter((r) => show === 'all' || (show === 'unheld' ? !r.heldBy : show === 'mine' ? r.mine : show === 'phone' ? !!r.phone : !!r.email));
  const tile = (label: string, n: number | undefined, key: Show, tone?: 'warn' | 'good') => (
    <button type="button" onClick={() => { setShow(key); setLimit(100); }} aria-pressed={show === key}
      style={{ flex: '1 1 130px', minWidth: 0, textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${show === key ? '#4f46e5' : 'var(--line)'}`, background: show === key ? 'var(--c1e1b4b)' : 'var(--c0f172a)' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone === 'warn' ? 'var(--ink-warn)' : tone === 'good' ? 'var(--ink-good)' : 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{n == null ? '…' : n.toLocaleString('vi-VN')}</div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{label}</div>
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5, maxWidth: 620 }}>
          {T('Khách đã nhắn vào và để lại số điện thoại hoặc email nhưng chưa đặt lịch / chưa đăng ký. Số do chính khách gõ hoặc đã lưu vào hồ sơ — không lấy số của tiệm trong câu trả lời.', 'Customers who left a phone or email and never booked.')}
        </p>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {([30, 90, 365] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
              style={{ height: 30, padding: '0 11px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, border: `1px solid ${days === d ? '#4f46e5' : 'var(--line-strong)'}`, background: days === d ? 'var(--c1e1b4b)' : 'transparent', color: days === d ? 'var(--ca5b4fc)' : 'var(--ccbd5e1)' }}>
              {d === 365 ? T('1 năm', '1 year') : T(`${d} ngày`, `${d} days`)}
            </button>
          ))}
        </span>
      </div>

      {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{err}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tile(T('Khách tiềm năng', 'Prospects'), board?.totals.all, 'all')}
        {tile(T('Có số điện thoại', 'With phone'), board?.totals.phone, 'phone')}
        {tile(T('Có email', 'With email'), board?.totals.email, 'email')}
        {tile(T('Chưa ai giữ', 'Unheld'), board?.totals.unheld, 'unheld', 'warn')}
        {tile(T('Của tôi', 'Mine'), board?.totals.mine, 'mine', 'good')}
      </div>

      {board && (board.perPerson.length > 0 || (board.canGiveOut && board.totals.unheld > 0)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {board.perPerson.map((p) => <span key={p.name} style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--line)', fontSize: 12.5, color: 'var(--ccbd5e1)' }}><b style={{ color: 'var(--ce2e8f0)' }}>{p.name}</b> {T(`đang giữ ${p.n}`, `holds ${p.n}`)}</span>)}
          {board.canGiveOut && board.totals.unheld > 0 && (
            <button type="button" onClick={() => void giveOut()} disabled={busy}
              style={{ height: 32, padding: '0 12px', borderRadius: 9, border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: '#2563eb', color: '#ffffff', opacity: busy ? 0.6 : 1 }}>
              {T(`Chia ${board.totals.unheld} khách chưa ai giữ cho nhân viên`, `Give ${board.totals.unheld} unheld to the team`)}
            </button>
          )}
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: 'var(--ink-good)', fontWeight: 600 }}>{msg}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 13 }}>
          <thead><tr style={{ color: 'var(--c94a3b8)', textAlign: 'left', fontSize: 12 }}>
            {[T('Khách', 'Customer'), T('Điện thoại', 'Phone'), 'Email', T('Nhắn gần nhất', 'Last message'), T('Người giữ', 'Held by'), ''].map((h, i) => <th key={i} style={{ ...cell, fontWeight: 700 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.threadId} style={{ color: 'var(--ccbd5e1)' }}>
                <td style={cell}>
                  <b style={{ color: 'var(--ce2e8f0)' }}>{r.name}</b>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c64748b)' }}>{[r.page, r.channel === 'instagram' ? 'Instagram' : r.channel === 'web' ? 'Website' : 'Messenger'].filter(Boolean).join(' · ')}{r.stage ? ` · ${r.stage}` : ''}</span>
                </td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  {r.phone ? (<><span style={{ userSelect: 'all', fontWeight: 700, color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{r.phone}</span>
                    <button type="button" onClick={() => void copy(r.phone!)} style={{ marginLeft: 6, height: 24, padding: '0 7px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === r.phone ? T('Đã chép', 'Copied') : T('Chép', 'Copy')}</button></>) : <span style={{ color: 'var(--c64748b)' }}>—</span>}
                </td>
                <td style={{ ...cell, maxWidth: 220, wordBreak: 'break-all' }}>
                  {r.email ? (<><span style={{ userSelect: 'all' }}>{r.email}</span>
                    <button type="button" onClick={() => void copy(r.email!)} style={{ marginLeft: 6, height: 24, padding: '0 7px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === r.email ? T('Đã chép', 'Copied') : T('Chép', 'Copy')}</button></>) : <span style={{ color: 'var(--c64748b)' }}>—</span>}
                </td>
                <td style={{ ...cell, maxWidth: 260 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{fmtInTz(r.lastAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{r.lastText || '—'}</span>
                </td>
                <td style={cell}>{r.heldBy ? <b style={{ color: r.mine ? 'var(--ink-good)' : 'var(--ce2e8f0)' }}>{r.mine ? T('Bạn', 'You') : r.heldBy}</b> : <span style={{ color: 'var(--ink-warn)', fontWeight: 700 }}>{T('Chưa ai giữ', 'Unheld')}</span>}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <a href={`${inboxHref}?thread=${r.threadId}`} style={{ display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 12px', borderRadius: 8, background: '#2563eb', color: '#ffffff', fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>{T('Mở chat', 'Open')}</a>
                </td>
              </tr>
            ))}
            {board && !rows.length && <tr><td colSpan={6} style={{ ...cell, color: 'var(--c94a3b8)' }}>{T('Không có khách nào trong mục này.', 'Nobody here.')}</td></tr>}
            {!board && !err && <tr><td colSpan={6} style={{ ...cell, color: 'var(--c94a3b8)' }}>{T('Đang lọc khách…', 'Filtering…')}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 200)} style={{ justifySelf: 'start', height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          {T(`Xem thêm (${rows.length - limit} khách)`, `Show more (${rows.length - limit})`)}
        </button>
      )}
    </div>
  );
}
