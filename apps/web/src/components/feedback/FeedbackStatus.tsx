'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { fmtInTz } from '../../lib/datetime';

type Req = { orderId: string; status: string; onScreen: boolean };
type Status = {
  id?: string;
  status: string; // PENDING | ANSWERED | SKIPPED | EXPIRED | COOLDOWN | NONE
  answered?: boolean;
  smsDueAt?: string | null;
  smsSentAt?: string | null;
  hasPhone?: boolean;
  hasEmail?: boolean;
  smsOn?: boolean;
  emailOn?: boolean;
  smsDelayMinutes?: number;
  cooldownDays?: number;
};

/** How long the till keeps saying "asking on the customer screen" before it
 *  assumes the customer walked away from it (the iPad gives up after ~90 s). */
const SCREEN_WINDOW_MS = 150_000;

/**
 * "CUSTOMER FEEDBACK" on the till's Paid screen. Deliberately neutral: the
 * person at the counter may be the tech who just did the set, and the customer
 * was promised their note goes to the owner — so the till only ever learns
 * WHETHER the customer answered, never what they said.
 */
export function FeedbackStatus({ token, req, lang }: { token: string; req: Req; lang: string }) {
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [st, setSt] = useState<Status>({ status: req.status });
  const [busy, setBusy] = useState<'' | 'skip' | 'send'>('');
  const [err, setErr] = useState('');
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<Status>(`/feedback/orders/${encodeURIComponent(req.orderId)}`, { token });
      setSt(d);
    } catch { /* keep the last known state */ }
  }, [req.orderId, token]);

  const final = st.answered || st.status === 'ANSWERED' || st.status === 'SKIPPED' || st.status === 'COOLDOWN' || st.status === 'EXPIRED' || st.status === 'NONE';

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (final) return;
    const asking = req.onScreen && Date.now() - startedAt.current < SCREEN_WINDOW_MS;
    const t = setInterval(() => { setNow(Date.now()); void load(); }, asking ? 4000 : 20000);
    return () => clearInterval(t);
  }, [final, load, req.onScreen, now]);

  async function act(kind: 'skip' | 'send') {
    if (!st.id || busy) return;
    setBusy(kind); setErr('');
    try {
      await apiFetch(`/feedback/requests/${encodeURIComponent(st.id)}/${kind}`, { method: 'POST', token });
      await load();
    } catch (e) {
      setErr((e as Error).message || L('Không thực hiện được', 'Could not do that'));
    } finally { setBusy(''); }
  }

  if (st.status === 'NONE' || st.status === 'EXPIRED') return null;

  const delay = st.smsDelayMinutes ?? 45;
  // Which follow-up this visit gets: a text, an email, or both.
  const sms = st.smsOn ?? !!st.hasPhone;
  const mail = !!st.emailOn;
  const via = sms && mail ? L('SMS + email', 'text + email') : mail ? 'email' : L('SMS', 'text');
  const canFollow = sms || mail;
  const time = (at?: string | null) => (at ? fmtInTz(at, { hour: 'numeric', minute: '2-digit' }) : '');
  const asking = !final && req.onScreen && now - startedAt.current < SCREEN_WINDOW_MS && !st.smsSentAt;

  let tone: 'ask' | 'good' | 'idle' | 'mute' = 'idle';
  let title = '';
  let sub = '';
  let actions: Array<{ kind: 'skip' | 'send'; label: string }> = [];

  if (st.answered || st.status === 'ANSWERED') {
    tone = 'good'; title = L('Khách đã trả lời · cảm ơn', 'The customer answered · thank you');
    sub = L('Không gửi SMS nữa.', 'No text will be sent.');
  } else if (st.status === 'COOLDOWN') {
    tone = 'mute'; title = L('Không hỏi lần này', 'Not asking this time');
    sub = L(`Khách đã được hỏi trong ${st.cooldownDays ?? 45} ngày qua.`, `This customer was asked in the last ${st.cooldownDays ?? 45} days.`);
  } else if (st.status === 'SKIPPED') {
    tone = 'mute'; title = L('Đã bỏ qua lần này', 'Skipped this time');
    sub = L('Không gửi SMS cho khách.', 'No text will be sent to the customer.');
  } else if (asking) {
    tone = 'ask'; title = L('Đang hỏi khách trên màn hình khách…', 'Asking the customer on their screen…');
    sub = canFollow && st.smsDueAt
      ? L(`Khách không trả lời ở đây thì hệ thống tự gửi ${via} sau ${delay} phút.`, `If they don't answer here, a ${via} goes out automatically in ${delay} minutes.`)
      : L('Khách chưa có số điện thoại hay email — mã QR trên hoá đơn vẫn dùng được.', 'No mobile or email on file — the QR on the receipt still works.');
    actions = [{ kind: 'skip', label: L('Bỏ qua', 'Skip') }];
  } else if (st.smsSentAt) {
    tone = 'idle'; title = L(`Đã gửi ${via} lúc ${time(st.smsSentAt)}`, `${via[0].toUpperCase()}${via.slice(1)} sent at ${time(st.smsSentAt)}`);
    sub = L('Khách chưa trả lời — kết quả về mục Feedback.', 'No answer yet — results land in Feedback.');
  } else if (canFollow && st.smsDueAt) {
    tone = 'idle'; title = L(`Sẽ gửi ${via} lúc ${time(st.smsDueAt)}`, `${via[0].toUpperCase()}${via.slice(1)} goes out at ${time(st.smsDueAt)}`);
    const onFile = sms && mail ? L('có số điện thoại + email', 'mobile + email on file') : mail ? L('có email', 'email on file') : L('có số điện thoại', 'mobile on file');
    sub = req.onScreen
      ? L(`Khách bỏ qua trên màn hình · ${onFile}.`, `Skipped on the screen · ${onFile}.`)
      : `${onFile[0].toUpperCase()}${onFile.slice(1)}.`;
    actions = [{ kind: 'send', label: L('Gửi ngay', 'Send now') }, { kind: 'skip', label: L('Bỏ qua', 'Skip') }];
  } else {
    tone = 'mute'; title = L('Chưa hỏi được khách', 'No way to ask yet');
    sub = L('Không có số điện thoại hay email · mã QR trên hoá đơn vẫn dùng được.', 'No mobile or email on file · the QR on the receipt still works.');
    actions = [{ kind: 'skip', label: L('Bỏ qua', 'Skip') }];
  }

  const dot = tone === 'ask' ? '#a5b4fc' : tone === 'good' ? 'var(--ink-good)' : tone === 'idle' ? 'var(--c94a3b8)' : 'var(--c64748b, #64748b)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-feedback-status={tone}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: 'var(--c94a3b8)' }}>{L('ĐÁNH GIÁ CỦA KHÁCH', 'CUSTOMER FEEDBACK')}</span>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderRadius: 12,
        border: `1px solid ${tone === 'ask' ? 'rgba(99,102,241,.35)' : 'var(--line)'}`,
        background: tone === 'ask' ? 'rgba(99,102,241,.08)' : 'transparent',
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: dot, boxShadow: tone === 'ask' ? '0 0 0 5px rgba(165,180,252,.18)' : 'none' }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 2 }}>{sub}</div>
          {err && <div style={{ fontSize: 13, color: 'var(--ink-bad)', marginTop: 4 }}>{err}</div>}
        </div>
        {actions.map((a) => (
          <button key={a.kind} type="button" disabled={!!busy} onClick={() => void act(a.kind)}
            style={{ height: 40, padding: '0 16px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: busy && busy !== a.kind ? 0.5 : 1 }}>
            {busy === a.kind ? '…' : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
