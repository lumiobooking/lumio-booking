'use client';

/**
 * "Gửi link cho khách xem" — the team's side of the client plan link
 * (12/11/2026). One press makes (or reuses) the salon's /plan/{token} link
 * and shows it with what the client can and cannot do, so the person pasting
 * it into Zalo knows what they are handing over. Lumio team only; the server
 * refuses everyone else (api post-review.service ensureLink).
 */

import { useState } from 'react';
import { apiFetch } from '../lib/api';

interface PlanLink { url: string; expiresAt: string }

export function PlanLinkButton({ token, vi, salonName, label }: { token: string | null; vi: boolean; salonName?: string; label?: string }) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<PlanLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  async function make() {
    if (!token) return;
    setBusy(true); setMsg(null); setArmed(false);
    try { setLink(await apiFetch<PlanLink>('/content/review-link', { method: 'POST', token })); }
    catch (e) { setLink(null); setMsg(e instanceof Error ? e.message : T('Không tạo được link', 'Could not make the link')); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setMsg(T('Đã sao chép. Dán vào Zalo / Messenger / SMS của khách.', 'Copied. Paste it into the client chat.')); }
    catch { setMsg(T('Không sao chép được — bôi đen link rồi copy tay.', 'Could not copy — select the link and copy it by hand.')); }
  }
  async function revoke() {
    if (!token) return;
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      await apiFetch('/content/review-link', { method: 'DELETE', token });
      setLink(null); setArmed(false);
      setMsg(T('Đã huỷ. Link cũ không mở được nữa.', 'Revoked. The old link no longer opens.'));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  }
  const until = link ? new Date(link.expiresAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next && !link) void make(); }}
        style={{ fontFamily: 'inherit', minHeight: 36, padding: '0 13px', borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
        🔗 {label ?? T('Gửi link cho khách xem', 'Send the client a link')}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
          <div role="dialog" aria-label={T('Link xem và duyệt plan', 'Plan link')} style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 81, width: 'min(460px, calc(100vw - 32px))',
            background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 14px 36px rgba(0,0,0,.4)', textAlign: 'left',
          }}>
            <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{T('Link xem và duyệt plan', 'Plan link')}{salonName ? ` — ${salonName}` : ''}</b>
            {link ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={link.url} aria-label="Link" onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, minHeight: 40, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', padding: '0 10px' }} />
                <button type="button" onClick={() => void copy()} style={{ fontFamily: 'inherit', minHeight: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{T('Sao chép', 'Copy')}</button>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => void make()} style={{ fontFamily: 'inherit', minHeight: 40, borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {busy ? T('Đang tạo…', 'Making…') : T('Tạo link mới', 'Make a new link')}
              </button>
            )}
            {msg && <div role="status" style={{ fontSize: 12.5, color: 'var(--ink-good)' }}>{msg}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
              {T('Khách mở là thấy lịch tháng của riêng tiệm này, không cần tài khoản.', "The client opens it and sees this salon's month only — no account needed.")}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
              <span>✓ {T('Xem: một lịch tháng gồm ý tưởng trong Plan và các bài đã lên lịch / đã đăng.', 'Sees: one month — the ideas in the Plan and the scheduled / posted posts.')}</span>
              <span>✓ {T('Làm được: duyệt ý tưởng, duyệt bài, hoặc bấm Cần sửa và ghi góp ý.', 'Can: approve an idea, approve a post, or ask for a change with a note.')}</span>
              <span>✕ {T('Không sửa, không xoá, không dời bài, không thấy tiệm khác.', 'Cannot edit, delete or move a post, or see another salon.')}</span>
            </div>
            {link && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--c1f2937)', paddingTop: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{T(`Hiệu lực 30 ngày · hết hạn ${until}`, `Valid 30 days · expires ${until}`)}</span>
                <button type="button" disabled={busy} onClick={() => void revoke()} style={{ marginLeft: 'auto', fontFamily: 'inherit', background: 'none', border: 'none', padding: '6px 0', minHeight: 32, color: 'var(--ink-bad)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  {armed ? T('Bấm lần nữa để huỷ', 'Tap again to revoke') : T('Huỷ link này', 'Revoke this link')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}
