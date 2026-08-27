'use client';

/**
 * The shared inbox: answer customers here instead of in the Meta app.
 *
 * WHY IT IS A SEPARATE PAGE FROM /salon/messenger
 *
 * Those are two different jobs done by two different people. Configuring the
 * bot — its facts, its voice, which Page it is connected to — is an owner's
 * task done once. Answering a customer is a receptionist's task done fifty
 * times a day. Putting the composer below eight settings panels means the
 * person who lives in it scrolls past the owner's controls every time, and can
 * change them by accident.
 *
 * WHAT THIS HAS THAT PANCAKE CANNOT
 *
 * The customer panel. A generic inbox shows you the words; it cannot tell you
 * this is her fourteenth visit, that she is booked for tomorrow at two, and
 * that Hà usually does her nails. Meta cannot either. That is the reason to
 * answer here rather than there — and it only appears when the link is certain
 * (stamped when a booking was made from this conversation), because showing one
 * customer another customer's history is worse than showing none.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { uiLocale } from '../../../lib/datetime';
import {
  InboxRow, channelLabel, stateLabel, stateOf, sortRows, composerNotice,
} from '../../../lib/inbox-view';

interface Turn { role: 'user' | 'assistant'; content: string; at: string | null; manual: boolean }
interface CustomerCtx {
  firstName?: string | null; lastName?: string | null; phone?: string | null;
  visits?: number; nextAt?: string | null; usualTech?: string | null;
}
interface ThreadDetail extends InboxRow {
  history: Turn[];
  customer: CustomerCtx | null;
  replyWindow?: { open: boolean; minutesLeft: number | null };
  /** Taken from the facts the salon already wrote for the bot — one source, two
   *  readers, so a receptionist can never quote a different price than the bot. */
  canned?: { label: string; text: string }[];
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #475569', color: '#cbd5e1',
  borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
};

const TONE: Record<string, { bg: string; fg: string }> = {
  bot: { bg: '#312e81', fg: '#c7d2fe' },
  wait: { bg: '#78350f', fg: '#fcd34d' },
  held: { bg: '#064e3b', fg: '#6ee7b7' },
  done: { bg: '#1e293b', fg: '#94a3b8' },
};

export default function InboxPage() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<InboxRow[]>('/messenger/threads', { token });
      setRows(Array.isArray(r) ? r : []);
    } catch { /* a failed refresh must not blank the list someone is reading */ }
  }, [token]);

  const loadThread = useCallback(async (id: string) => {
    if (!token) return;
    try {
      const d = await apiFetch<ThreadDetail>(`/messenger/threads/${id}`, { token });
      setDetail(d);
      await apiFetch(`/messenger/threads/${id}/read`, { method: 'POST', token }).catch(() => undefined);
    } catch (e) { setErr(String(e)); }
  }, [token]);

  useEffect(() => { void loadList(); }, [loadList]);

  // Meta delivers webhooks to the server; nothing pushes them to this browser.
  // Polling is the honest simple answer — a websocket is a lot of machinery for
  // a page a receptionist keeps open on one screen.
  useEffect(() => {
    const t = setInterval(() => {
      void loadList();
      if (openId) void loadThread(openId);
    }, 8000);
    return () => clearInterval(t);
  }, [loadList, loadThread, openId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [detail?.history?.length]);

  async function act(path: string, body?: Record<string, unknown>) {
    if (!openId || !token) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/messenger/threads/${openId}/${path}`, { method: 'POST', token, body });
      await Promise.all([loadList(), loadThread(openId)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !detail || !token) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/messenger/send', { method: 'POST', token, body: { threadId: detail.id, text } });
      setDraft('');
      await Promise.all([loadList(), loadThread(detail.id)]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  const sorted = sortRows(rows);
  const waiting = sorted.filter((r) => stateOf(r) === 'unclaimed').length;
  const notice = composerNotice(detail?.replyWindow, vi);
  const state = detail ? stateOf(detail) : 'bot';

  return (
    <SalonShell>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{vi ? 'Hộp thư' : 'Inbox'}</h1>
        {waiting > 0 && (
          <span style={{ background: TONE.wait.bg, color: TONE.wait.fg, borderRadius: 6, padding: '2px 9px', fontSize: 12, fontWeight: 700 }}>
            {vi ? `${waiting} khách đang chờ` : `${waiting} waiting`}
          </span>
        )}
      </div>

      {err && <div style={{ ...ui.card, borderColor: '#7f1d1d', color: '#fca5a5', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>

        <div style={{ ...ui.card, padding: 0, overflow: 'hidden', maxHeight: '72vh', overflowY: 'auto' }}>
          {!sorted.length && (
            <p style={{ color: '#64748b', fontSize: 13, padding: 16, margin: 0 }}>
              {vi ? 'Chưa có hội thoại nào.' : 'No conversations yet.'}
            </p>
          )}
          {sorted.map((r) => {
            const ch = channelLabel(r.channel);
            const st = stateLabel(r, vi);
            const on = r.id === openId;
            return (
              <button
                key={r.id}
                onClick={() => { setOpenId(r.id); void loadThread(r.id); }}
                style={{
                  width: '100%', textAlign: 'left', display: 'block', cursor: 'pointer',
                  background: on ? '#1e293b' : 'transparent', border: 'none',
                  borderBottom: '1px solid #1e293b', padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: ch.fg, background: ch.bg, border: `1px solid ${ch.border}`, borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>{ch.text}</span>
                  <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: r.unread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.senderName || (vi ? 'Khách' : 'Customer')}
                  </span>
                  {r.unread && <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />}
                </div>
                <p style={{ margin: '0 0 5px', fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.lastText || '—'}
                </p>
                <span style={{ fontSize: 11, fontWeight: 600, background: TONE[st.tone].bg, color: TONE[st.tone].fg, borderRadius: 6, padding: '1px 7px' }}>{st.text}</span>
              </button>
            );
          })}
        </div>

        <div style={{ ...ui.card, padding: 0, display: 'flex', flexDirection: 'column', minHeight: 380, maxHeight: '72vh' }}>
          {!detail && (
            <p style={{ color: '#64748b', fontSize: 13, padding: 20, margin: 0 }}>
              {vi ? 'Chọn một hội thoại bên trái để trả lời.' : 'Pick a conversation on the left.'}
            </p>
          )}

          {detail && (
            <>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: '#e2e8f0', fontSize: 14 }}>{detail.senderName || (vi ? 'Khách' : 'Customer')}</strong>
                <span style={{ fontSize: 11, fontWeight: 600, background: TONE[stateLabel(detail, vi).tone].bg, color: TONE[stateLabel(detail, vi).tone].fg, borderRadius: 6, padding: '1px 7px' }}>
                  {stateLabel(detail, vi).text}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {/* The button matches the badge. Before, a thread whose human
                      had left hours ago still offered "give back to bot" — an
                      action for a situation that had already ended by itself. */}
                  {(state === 'human' || state === 'unclaimed')
                    ? <button disabled={busy} onClick={() => void act('handoff', { handoff: false })} style={ghostBtn}>{vi ? 'Trả cho bot' : 'Give to bot'}</button>
                    : <button disabled={busy} onClick={() => void act('handoff', { handoff: true })} style={ghostBtn}>{vi ? 'Tôi nhận' : 'Take over'}</button>}
                  {state !== 'done'
                    ? <button disabled={busy} onClick={() => void act('status', { status: 'done' })} style={ghostBtn}>{vi ? 'Xong' : 'Done'}</button>
                    : <button disabled={busy} onClick={() => void act('status', { status: 'open' })} style={ghostBtn}>{vi ? 'Mở lại' : 'Reopen'}</button>}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#0b1220' }}>
                {detail.history.map((t, i) => {
                  const mine = t.role === 'assistant';
                  return (
                    <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                      <div style={{
                        background: mine ? (t.manual ? '#1d4ed8' : '#3730a3') : '#1e293b',
                        color: '#e2e8f0', borderRadius: 12, padding: '7px 11px', fontSize: 13, whiteSpace: 'pre-wrap',
                      }}>{t.content}</div>
                      <p style={{ margin: '3px 2px 0', fontSize: 11, color: '#64748b', textAlign: mine ? 'right' : 'left' }}>
                        {/* Who said it. A staff reply and a bot reply looking
                            identical is how nobody could tell what the bot had
                            already promised a customer. */}
                        {mine ? (t.manual ? (vi ? 'Nhân viên' : 'Staff') : 'Bot') : (vi ? 'Khách' : 'Customer')}
                        {t.at ? ` · ${new Date(t.at).toLocaleString(uiLocale())}` : ''}
                      </p>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              {detail.customer && (
                <div style={{ borderTop: '1px solid #1e293b', padding: '9px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', background: '#0f172a' }}>
                  {detail.customer.nextAt && (
                    <Stat label={vi ? 'Lịch tới' : 'Next'} value={new Date(detail.customer.nextAt).toLocaleString(uiLocale())} />
                  )}
                  <Stat label={vi ? 'Đã đến' : 'Visits'} value={String(detail.customer.visits ?? 0)} />
                  {detail.customer.usualTech && <Stat label={vi ? 'Thợ quen' : 'Usual tech'} value={detail.customer.usualTech} />}
                  {detail.customer.phone && <Stat label={vi ? 'Điện thoại' : 'Phone'} value={detail.customer.phone} />}
                </div>
              )}

              {notice.text && (
                <div style={{
                  borderTop: '1px solid #1e293b', padding: '7px 14px', fontSize: 12,
                  color: notice.blocked ? '#fca5a5' : '#fcd34d',
                  background: notice.blocked ? 'rgba(127,29,29,0.25)' : 'rgba(120,53,15,0.25)',
                }}>{notice.text}</div>
              )}

              {!!detail.canned?.length && !notice.blocked && (
                <div style={{ borderTop: '1px solid #1e293b', padding: '8px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {detail.canned.map((q) => (
                    <button
                      key={q.label}
                      title={q.text}
                      onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${q.text}` : q.text))}
                      style={{ ...ghostBtn, fontSize: 11, padding: '3px 9px' }}
                    >{q.label}</button>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid #1e293b', padding: 10, display: 'flex', gap: 8 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={notice.blocked ? (vi ? 'Không gửi được — quá 24 giờ' : 'Cannot send — past 24 hours') : (vi ? 'Nhắn cho khách…' : 'Message the customer…')}
                  disabled={notice.blocked || busy}
                  rows={2}
                  style={{ ...ui.input, flex: 1, resize: 'vertical', minHeight: 44 }}
                />
                <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()} style={ui.primaryBtn}>
                  {vi ? 'Gửi' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </SalonShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{value}</p>
    </div>
  );
}
