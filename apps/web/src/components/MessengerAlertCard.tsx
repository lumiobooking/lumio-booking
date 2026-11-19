'use client';

/**
 * "Nhận báo khách qua Messenger" — a team member's own Messenger as their turn
 * alert (api messenger/staff-alerts). Link once with a code sent to the salon's
 * Page; then "vào ca" each shift opens Meta's 24-hour window for alerts with
 * "Nhận khách" / "Bỏ qua" buttons. Each person sees and changes only their own.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Mine { linked: boolean; on: boolean; windowOpen: boolean; windowEndsAt: string | null; page: { name: string | null; link: string } | null }

export function MessengerAlertCard({ token, vi }: { token: string | null; vi: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [mine, setMine] = useState<Mine | null>(null);
  const [code, setCode] = useState<{ text: string; page: Mine['page'] } | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    try { setMine(await apiFetch<Mine>('/messenger/turns/messenger', { token })); } catch { setMine(null); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  // While a code is waiting to be sent, look for the link every few seconds.
  useEffect(() => {
    if (!code || mine?.linked) return;
    const id = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [code, mine?.linked, load]);
  useEffect(() => { if (mine?.linked) setCode(null); }, [mine?.linked]);

  if (!mine || !mine.page) return null;
  const box = { padding: '9px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0b1220)', fontSize: 12.5, color: 'var(--ccbd5e1)', display: 'flex', flexDirection: 'column' as const, gap: 6 };
  const link = { color: 'var(--ink-link)', fontWeight: 700, textDecoration: 'none' };

  const getCode = async () => {
    if (!token) return;
    try { const r = await apiFetch<{ text: string; page: Mine['page'] }>('/messenger/turns/messenger/code', { method: 'POST', token }); setCode(r); setCopied(false); } catch { /* shown as nothing */ }
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(true); } catch { setCopied(false); } };
  const unlink = async () => { if (!token) return; try { await apiFetch('/messenger/turns/messenger/unlink', { method: 'POST', token }); await load(); } catch { /* ignore */ } };

  if (!mine.linked) {
    return (
      <div style={box}>
        <b style={{ color: 'var(--ce2e8f0)' }}>{L('Nhận báo khách qua Messenger', 'Get turn alerts on Messenger')}</b>
        {!code ? (
          <>
            <span>{L('Liên kết Messenger của bạn một lần, rồi mỗi đầu ca nhắn “vào ca” cho Fanpage.', 'Link your Messenger once, then send “vào ca” to the Page at the start of each shift.')}</span>
            <button type="button" onClick={() => void getCode()} style={{ height: 32, borderRadius: 9, border: 0, background: '#0866ff', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{L('Lấy mã liên kết', 'Get a link code')}</button>
          </>
        ) : (
          <>
            <span>{L('Nhắn đúng dòng này cho Fanpage', 'Send exactly this to the Page')} <b>{code.page?.name ?? ''}</b> {L('(trong 15 phút):', '(within 15 minutes):')}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: '1 1 auto', padding: '6px 8px', borderRadius: 8, background: 'var(--c0f172a)', border: '1px solid var(--line)', fontSize: 13, fontWeight: 800, color: 'var(--ce2e8f0)', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{code.text}</code>
              <button type="button" onClick={() => void copy(code.text)} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{copied ? L('Đã chép', 'Copied') : L('Chép', 'Copy')}</button>
            </span>
            {code.page && <a href={code.page.link} target="_blank" rel="noreferrer" style={link}>{L('Mở Messenger của Fanpage →', 'Open the Page in Messenger →')}</a>}
            <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{L('Đang chờ bạn nhắn…', 'Waiting for your message…')}</span>
          </>
        )}
      </div>
    );
  }
  const until = mine.windowEndsAt ? new Date(mine.windowEndsAt).toLocaleString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div style={box}>
      {mine.windowOpen ? (
        <span><span style={{ color: 'var(--ink-good)', fontWeight: 700 }}>● {L('Đang nhận báo qua Messenger', 'Alerts on Messenger')}</span>{until ? ` · ${L('tới', 'until')} ${until}` : ''}</span>
      ) : (
        <span>{L('Messenger đã liên kết. Nhắn', 'Messenger linked. Send')} <b>“vào ca”</b> {L('cho Fanpage để nhận báo khách.', 'to the Page to get alerts.')}</span>
      )}
      <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a href={mine.page!.link} target="_blank" rel="noreferrer" style={link}>{L('Mở Messenger', 'Open Messenger')}</a>
        <button type="button" onClick={() => void unlink()} style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--c94a3b8)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{L('Bỏ liên kết', 'Unlink')}</button>
      </span>
    </div>
  );
}
