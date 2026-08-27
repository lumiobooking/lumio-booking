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
import { apiFetch, apiStream } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { uiLocale } from '../../../lib/datetime';
import {
  InboxRow, InboxFilter, channelLabel, channelMark, stateLabel, stateOf,
  sortRows, filterRows, sourcesFrom, sourceKey, waitingCount, composerNotice, displayName,
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
  /** Which Page this arrived on. A salon with two Pages needs to know which one
   *  it is about to answer as — the customer sees the Page's name, not theirs. */
  pageName?: string | null;
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
  const me = useAuth().user?.id ?? null;
  const vi = lang === 'vi';
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [source, setSource] = useState<string>('any');
  const [query, setQuery] = useState('');
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

  // Live, not polled. Meta delivers a webhook to the server the moment a
  // customer writes; the server pushes a nudge down this stream and the page
  // refetches immediately. The eight-second poll this replaces meant a
  // receptionist could sit looking at a screen that already knew nothing new.
  //
  // The stream carries no message content — see the comment on the endpoint.
  const openRef = useRef<string | null>(null);
  openRef.current = openId;

  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let gone = false;

    const refresh = () => {
      void loadList();
      if (openRef.current) void loadThread(openRef.current);
    };

    const connect = () => {
      if (gone) return;
      stop = apiStream('/messenger/stream', token, refresh, () => {
        // Dropped — a proxy timeout, a laptop lid, a deploy. Reconnect after a
        // pause rather than hammering, and keep the slow safety poll running in
        // the meantime so the page is never fully frozen.
        if (gone) return;
        retry = setTimeout(connect, 5000);
      });
    };
    connect();

    // Safety net. A stream that dies quietly is worse than no stream, because
    // the page LOOKS live while being frozen. Half a minute is slow enough not
    // to matter when the stream works and fast enough to notice when it does not.
    const poll = setInterval(refresh, 30_000);

    return () => {
      gone = true;
      stop?.();
      if (retry) clearTimeout(retry);
      clearInterval(poll);
    };
  }, [token, loadList, loadThread]);

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

  async function renameThread() {
    if (!detail || !token) return;
    const next = window.prompt(vi ? 'Tên khách hàng' : 'Customer name', detail.senderName ?? '');
    if (next === null) return;
    setBusy(true);
    try {
      await apiFetch(`/messenger/threads/${detail.id}/rename`, { method: 'POST', token, body: { name: next.trim() } });
      await Promise.all([loadList(), loadThread(detail.id)]);
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

  const sources = sourcesFrom(rows);
  const sorted = sortRows(filterRows(rows, { filter, source, query, meId: me }));
  const waiting = waitingCount(rows);
  const notice = composerNotice(detail?.replyWindow, vi);
  const state = detail ? stateOf(detail) : 'bot';

  const initials = (n?: string | null) => String(n || '?').trim().split(/\s+/).slice(-2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
  const pill = (tone: string, text: string) => (
    <span style={{ background: TONE[tone].bg, color: TONE[tone].fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
  );

  return (
    <SalonShell>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{vi ? 'Hộp thư' : 'Inbox'}</h1>
        {waiting > 0 && pill('wait', vi ? `${waiting} khách đang chờ` : `${waiting} waiting`)}
      </div>

      {err && <div style={{ ...ui.card, borderColor: '#7f1d1d', color: '#fca5a5', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div style={{ ...ui.card, padding: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: '52px minmax(0,300px) minmax(0,1fr)' }}>
        {/* No fixed height on the card. It used to be 74vh, but the card's TOP
            already sits well down the page — support banner, heading, whatever
            else the shell puts above it — so 74vh from there ran off the bottom
            of the screen and took the composer with it. The message box was
            rendered and simply unreachable, which reads as "there is no way to
            reply". Capping the SCROLLING areas instead keeps every control that
            follows them on screen regardless of what is above. */}

        {/* Source rail: one entry per connected Page or Instagram account, by
            NAME. Listing channel types instead collapsed two Pages into one
            button, and a salon running two of them could not answer as just one.
            The customer sees the Page's name, so the person replying sees it too.
            Counts are people WAITING, not conversations that exist. */}
        <div style={{ background: '#0b1220', borderRight: '1px solid #1e293b', padding: '10px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setSource('any')} title={vi ? 'Tất cả nguồn' : 'All sources'} aria-label={vi ? 'Tất cả nguồn' : 'All sources'}
            style={{
              position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
              background: source === 'any' ? '#312e81' : 'transparent',
              border: `1px solid ${source === 'any' ? '#6366f1' : 'transparent'}`,
              color: source === 'any' ? '#c7d2fe' : '#64748b', fontSize: 16, lineHeight: 1,
            }}>
            ▤
            {waiting > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -5, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '0 4px', minWidth: 15 }}>{waiting}</span>
            )}
          </button>

          {sources.map((src) => {
            const on = source === src.key;
            return (
              <button key={src.key} onClick={() => setSource(src.key)} title={src.label} aria-label={src.label}
                style={{
                  position: 'relative', width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
                  background: on ? '#312e81' : 'transparent',
                  border: `1px solid ${on ? '#6366f1' : 'transparent'}`,
                  color: on ? '#c7d2fe' : '#64748b', fontSize: 16, lineHeight: 1,
                }}>
                {channelMark(src.channel)}
                {src.waiting > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -5, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '0 4px', minWidth: 15 }}>{src.waiting}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Conversation list */}
        <div style={{ borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '9px 10px', borderBottom: '1px solid #1e293b' }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={vi ? 'Tìm khách…' : 'Search…'}
              style={{ ...ui.input, fontSize: 12, padding: '6px 9px' }} />
          </div>

          <div style={{ display: 'flex', gap: 4, padding: '7px 8px', borderBottom: '1px solid #1e293b', flexWrap: 'wrap' }}>
            {([
              ['all', vi ? 'Tất cả' : 'All'],
              ['waiting', vi ? 'Đang chờ' : 'Waiting'],
              ['unread', vi ? 'Chưa đọc' : 'Unread'],
              ['mine', vi ? 'Của tôi' : 'Mine'],
            ] as [InboxFilter, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px',
                  borderColor: filter === key ? '#6366f1' : '#334155',
                  color: filter === key ? '#c7d2fe' : '#94a3b8' }}>{label}</button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 'min(58vh, 520px)' }}>
            {!sorted.length && (
              <p style={{ color: '#64748b', fontSize: 13, padding: 16, margin: 0 }}>
                {filter === 'waiting'
                  ? (vi ? 'Không ai đang chờ. Tốt.' : 'Nobody is waiting. Good.')
                  : (vi ? 'Không có hội thoại nào khớp bộ lọc.' : 'No conversations match these filters.')}
              </p>
            )}
            {sorted.map((r) => {
              const ch = channelLabel(r.channel);
              const st = stateLabel(r, vi);
              const on = r.id === openId;
              return (
                <button key={r.id} onClick={() => { setOpenId(r.id); void loadThread(r.id); }}
                  style={{ width: '100%', textAlign: 'left', display: 'block', cursor: 'pointer',
                    background: on ? '#1e293b' : 'transparent', border: 'none',
                    borderLeft: `2px solid ${on ? '#6366f1' : 'transparent'}`,
                    borderBottom: '1px solid #1e293b', padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ color: ch.fg, fontSize: 13, flexShrink: 0 }}>{channelMark(r.channel)}</span>
                    <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: r.unread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayName(r, vi)}
                    </span>
                    {r.unread && <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />}
                  </div>
                  <p style={{ margin: '0 0 5px', fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastText || '—'}</p>
                  {/* Which Page this came in on. Without it a mixed list gives
                      no way to tell one salon's inbox from another's. */}
                  {source === 'any' && r.pageName && (
                    <p style={{ margin: '0 0 4px', fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pageName}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {pill(st.tone, st.text)}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', flexShrink: 0 }}>{new Date(r.updatedAt).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!detail && (
            <p style={{ color: '#64748b', fontSize: 13, padding: 20, margin: 0 }}>
              {vi ? 'Chọn một hội thoại bên trái để trả lời.' : 'Pick a conversation on the left.'}
            </p>
          )}

          {detail && (<>
            <div style={{ padding: '9px 13px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#312e81', color: '#c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {initials(detail.senderName || displayName(detail, vi))}
              </div>
              <div style={{ minWidth: 0 }}>
                {/* Click the name to set it. Meta withholds the profile for
                    plenty of people — accounts made with a phone number, anyone
                    who never opted in — and their own docs return an empty
                    object rather than an error, so there is no version of this
                    that always works through the API. Typing it once always
                    works, and the salon usually knows who this is. */}
                <p
                  onClick={() => void renameThread()}
                  title={vi ? 'Bấm để đặt tên khách' : 'Click to set the name'}
                  style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
                >
                  {displayName(detail, vi)}
                  {!detail.senderName && <span style={{ color: '#64748b', fontWeight: 400, fontSize: 12 }}> ✎</span>}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                  {channelLabel(detail.channel).text.replace(/^\S+\s/, '')}{detail.pageName ? ` · ${detail.pageName}` : ''}
                </p>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                {pill(stateLabel(detail, vi).tone, stateLabel(detail, vi).text)}
                {(state === 'human' || state === 'unclaimed')
                  ? <button disabled={busy} onClick={() => void act('handoff', { handoff: false })} style={ghostBtn}>{vi ? 'Trả bot' : 'To bot'}</button>
                  : <button disabled={busy} onClick={() => void act('handoff', { handoff: true })} style={ghostBtn}>{vi ? 'Tôi nhận' : 'Take over'}</button>}
                {state !== 'done'
                  ? <button disabled={busy} onClick={() => void act('status', { status: 'done' })} style={ghostBtn}>{vi ? 'Xong' : 'Done'}</button>
                  : <button disabled={busy} onClick={() => void act('status', { status: 'open' })} style={ghostBtn}>{vi ? 'Mở lại' : 'Reopen'}</button>}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 180, maxHeight: 'min(46vh, 420px)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#0b1220' }}>
              {detail.history.map((t, i) => {
                const mine = t.role === 'assistant';
                return (
                  <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                    <div style={{ background: mine ? (t.manual ? '#1d4ed8' : '#3730a3') : '#1e293b', color: '#e2e8f0', borderRadius: 12, padding: '7px 11px', fontSize: 13, whiteSpace: 'pre-wrap' }}>{t.content}</div>
                    <p style={{ margin: '3px 2px 0', fontSize: 11, color: '#64748b', textAlign: mine ? 'right' : 'left' }}>
                      {/* Who said it. A staff reply and a bot reply looking
                          identical is how nobody could tell what the bot had
                          already promised a customer. */}
                      {mine ? (t.manual ? (vi ? 'Nhân viên' : 'Staff') : 'Bot') : (vi ? 'Khách' : 'Customer')}
                      {t.at ? ` · ${new Date(t.at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {!!detail.canned?.length && !notice.blocked && (
              <div style={{ borderTop: '1px solid #1e293b', padding: '8px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {detail.canned.map((q) => (
                  <button key={q.label} title={q.text}
                    onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${q.text}` : q.text))}
                    style={{ ...ghostBtn, fontSize: 11, padding: '3px 9px' }}>{q.label}</button>
                ))}
              </div>
            )}

            {notice.text && (
              <div style={{ borderTop: '1px solid #1e293b', padding: '7px 13px', fontSize: 12,
                color: notice.blocked ? '#fca5a5' : '#fcd34d',
                background: notice.blocked ? 'rgba(127,29,29,0.25)' : 'rgba(120,53,15,0.25)' }}>{notice.text}</div>
            )}

            <div style={{ borderTop: '1px solid #1e293b', padding: 10, display: 'flex', gap: 8 }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={notice.blocked ? (vi ? 'Không gửi được — quá 24 giờ' : 'Cannot send — past 24 hours') : (vi ? `Nhắn cho ${displayName(detail, vi)}…` : 'Message the customer…')}
                disabled={notice.blocked || busy} rows={2}
                style={{ ...ui.input, flex: 1, resize: 'vertical', minHeight: 44 }} />
              <button disabled={notice.blocked || busy || !draft.trim()} onClick={() => void send()} style={ui.primaryBtn}>{vi ? 'Gửi' : 'Send'}</button>
            </div>

            {/* Below the composer, as designed: it is reference while you type,
                not something to read before you start. */}
            {detail.customer && (
              <div style={{ borderTop: '1px solid #1e293b', padding: '9px 13px', display: 'flex', gap: 20, flexWrap: 'wrap', background: '#0f172a' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b', width: '100%' }}>{vi ? 'Khách này ở Lumio' : 'This customer, in Lumio'}</p>
                {detail.customer.nextAt && <Stat label={vi ? 'Lần tới' : 'Next'} value={new Date(detail.customer.nextAt).toLocaleString(uiLocale())} />}
                <Stat label={vi ? 'Đã đến' : 'Visits'} value={vi ? `${detail.customer.visits ?? 0} lần` : String(detail.customer.visits ?? 0)} />
                {detail.customer.usualTech && <Stat label={vi ? 'Thợ quen' : 'Usual tech'} value={detail.customer.usualTech} />}
                {detail.customer.phone && <Stat label={vi ? 'Điện thoại' : 'Phone'} value={detail.customer.phone} />}
              </div>
            )}
          </>)}
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
