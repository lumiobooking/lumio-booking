'use client';

/**
 * rt204 — "Lịch sử lưu trữ": the permanent record of one conversation, for the
 * owner. Every message Lumio ever saw (kept even when deleted or hidden on
 * Meta) and every action — who sent, who took the customer, notes, status.
 * Read-only: there is no delete anywhere on this screen or behind it.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Msg = { role: 'customer' | 'ai' | 'staff' | 'page'; byName: string | null; content: string; images?: string[] | null; failed: boolean; at: string };
type Act = { at: string; kind: string; who: string | null; detail: Record<string, unknown> | null };

const ROLE: Record<Msg['role'], [string, string]> = { customer: ['Khách', 'Customer'], ai: ['AI', 'AI'], staff: ['Nhân viên', 'Staff'], page: ['Từ Meta / công cụ khác', 'From Meta / another tool'] };

function actText(a: Act, vi: boolean): string {
  const d = a.detail ?? {};
  const L = (v: string, e: string) => (vi ? v : e);
  const map: Record<string, string> = {
    'messenger.manual_send': L('gửi tin cho khách', 'sent a message'),
    'messenger.manual_photo': L('gửi ảnh cho khách', 'sent a photo'),
    'messenger.note_added': L('thêm ghi chú', 'added a note'),
    'messenger.note_deleted': L(`xoá ghi chú: “${String(d.text ?? '').slice(0, 120)}”`, `deleted a note: “${String(d.text ?? '').slice(0, 120)}”`),
    'messenger.thread_status': L(`đổi trạng thái → ${String(d.status ?? '')}`, `status → ${String(d.status ?? '')}`),
    'messenger.thread_spam': L('chuyển vào Spam', 'moved to Spam'),
    'messenger.thread_renamed': L(`đặt tên khách “${String(d.name ?? '')}”`, `renamed the customer “${String(d.name ?? '')}”`),
    'messenger.turn_escalated': L('báo khẩn: khách chờ quá lâu', 'alert: customer waited too long'),
    'messenger.record_viewed': L('mở lịch sử lưu trữ', 'opened this record'),
  };
  if (a.kind.startsWith('turn.')) {
    const r = a.kind.slice(5);
    const to = String(d.to ?? '—'); const from = d.from ? String(d.from) : null;
    if (r === 'first-reply') return L(`${to} trả lời lần đầu`, `${to} answered first`);
    if (r === 'unassign') return L(`bỏ giao${from ? ` (từ ${from})` : ''}`, `unassigned${from ? ` (from ${from})` : ''}`);
    if (r === 'reassign-unread' || r === 'reassign-unreplied' || r === 'skip') return L(`chuyển turn ${from ? `từ ${from} ` : ''}sang ${to} (${r === 'reassign-unread' ? 'chưa mở' : r === 'skip' ? 'bấm bỏ qua' : 'chưa trả lời'})`, `turn passed ${from ? `from ${from} ` : ''}to ${to}`);
    if (r === 'manual') return L(`giao tay cho ${to}${from ? ` (từ ${from})` : ''}`, `moved to ${to}${from ? ` (from ${from})` : ''}`);
    return L(`chia turn cho ${to}`, `turn to ${to}`);
  }
  return map[a.kind] ?? a.kind;
}

export function ThreadRecord({ token, threadId, vi, onClose }: { token: string | null; threadId: string; vi: boolean; onClose: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [data, setData] = useState<{ customer: string | null; messages: Msg[]; actions: Act[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'msgs' | 'acts'>('msgs');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!token) return;
    apiFetch<{ customer: string | null; messages: Msg[]; actions: Act[] }>(`/messenger/threads/${encodeURIComponent(threadId)}/record`, { token })
      .then(setData).catch((e) => setErr(String((e as Error)?.message ?? e)));
  }, [token, threadId]);
  const fmt = (s: string) => new Date(s).toLocaleString(vi ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ql = q.trim().toLowerCase();
  const msgs = (data?.messages ?? []).filter((m) => !ql || m.content.toLowerCase().includes(ql) || (m.byName ?? '').toLowerCase().includes(ql));
  const acts = (data?.actions ?? []).filter((a) => !ql || actText(a, vi).toLowerCase().includes(ql) || (a.who ?? '').toLowerCase().includes(ql));
  const tabBtn = (k: 'msgs' | 'acts', label: string) => (
    <button type="button" onClick={() => setTab(k)} style={{ height: 34, padding: '0 12px', borderRadius: 9, border: `1px solid ${tab === k ? 'var(--ink-link)' : 'var(--line)'}`, background: 'transparent', color: tab === k ? 'var(--ink-link)' : 'var(--ccbd5e1)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
  );
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2,6,23,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 15.5, color: 'var(--ce2e8f0)', flex: 1 }}>🗂 {L('Lịch sử lưu trữ', 'Permanent record')}{data?.customer ? ` · ${data.customer}` : ''}</b>
            <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ border: 0, background: 'transparent', color: 'var(--c94a3b8)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>{L('Lumio giữ lại mọi tin nhắn và thao tác — kể cả khi tin bị xoá hoặc ẩn trên Messenger. Không ai xoá được mục này. Chỉ chủ tiệm xem được.', 'Lumio keeps every message and action — even when deleted or hidden on Messenger. Nobody can delete this. Owner only.')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {tabBtn('msgs', `${L('Tin nhắn', 'Messages')} · ${data?.messages.length ?? 0}`)}
            {tabBtn('acts', `${L('Thao tác nhân viên', 'Staff actions')} · ${data?.actions.length ?? 0}`)}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Tìm chữ hoặc tên nhân viên…', 'Search text or staff name…')} style={{ flex: '1 1 180px', height: 34, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!data && !err && <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Đang tải…', 'Loading…')}</span>}
          {err && <span style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{err}</span>}
          {data && tab === 'msgs' && msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: m.role === 'customer' ? 'transparent' : 'var(--wash-blue)' }}>
              <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
                <b style={{ color: m.role === 'staff' ? 'var(--ink-link)' : 'var(--ccbd5e1)' }}>{vi ? ROLE[m.role][0] : ROLE[m.role][1]}{m.byName ? ` · ${m.byName}` : ''}</b> · {fmt(m.at)}{m.failed ? <b style={{ color: 'var(--ink-bad)' }}> · {L('không gửi được', 'not delivered')}</b> : null}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content || (m.images?.length ? L(`[${m.images.length} ảnh]`, `[${m.images.length} photo(s)]`) : '')}</span>
            </div>
          ))}
          {data && tab === 'acts' && acts.map((a, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--ccbd5e1)', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--c94a3b8)' }}>{fmt(a.at)}</span> · <b style={{ color: 'var(--ce2e8f0)' }}>{a.who ?? L('Hệ thống', 'System')}</b> {actText(a, vi)}
            </div>
          ))}
          {data && tab === 'msgs' && !msgs.length && <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Chưa có tin nào được lưu (tin cũ sẽ được lưu khi mở cuộc trò chuyện).', 'Nothing kept yet (older messages are kept when the conversation is opened).')}</span>}
        </div>
      </div>
    </div>
  );
}
