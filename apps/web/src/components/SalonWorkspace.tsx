'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, apiUpload } from '../lib/api';

/**
 * The salon's whole screen: what to film, what Lumio asked for, what is waiting
 * to be approved. One page, one column, made for a phone held in one hand
 * between customers.
 *
 * WHY IT IS SEPARATE FROM THE TEAM'S SCREENS RATHER THAN A NARROWER VIEW OF THEM
 *
 * The team's content page is nine tabs of method: which hashtag feeds get read
 * every morning, that the filming day is the quietest day on this shop's own
 * booking book, the five-stage path and its exit conditions. A salon owner
 * hands their login to a cousin who "does marketing", or to a consultant, or
 * one day to the shop opening across the road. Whatever they see, that person
 * sees. So this screen is built from a payload that never contained any of it
 * (see the API's client-view), rather than from the team's payload with parts
 * hidden — because a part hidden on a screen is still on the wire.
 *
 * THREE THINGS, IN THE ORDER SOMEBODY STANDING IN A SHOP CARES
 *
 *   1. What Lumio asked for today. One or two, never a list.
 *   2. What the shop itself has to do this week — film, photograph, ask.
 *   3. What is written and waiting for a yes.
 *
 * Nothing here takes more than one tap to act on. The suggestion card has a
 * file picker and a "does not fit" button and nothing else; the week is a list
 * with no controls at all; approving is the existing one-tap review screen. A
 * shop owner between two customers does not read a second screen to find the
 * button.
 */

interface Suggestion {
  id: string;
  title: string;
  note: string | null;
  createdAt: string;
  status: 'sent' | 'done' | 'skipped';
  media: { url: string; kind: 'image' | 'video' }[];
}
interface SuggestionFeed { open: Suggestion[]; past: Suggestion[]; waiting: number }
interface ClientJob { dayIndex: number; day: string; kind: string; text: string }
interface ClientWeek { focus: string; jobs: ClientJob[]; prep: { label: string; detail: string }[] }

const ICON: Record<string, string> = { film: '🎬', photo: '📷', engage: '💚' };

export function SalonWorkspace({ token, vi, onCount }: {
  token: string | null;
  vi: boolean;
  /** How many suggestions are still waiting on the shop, for the tab badge. */
  onCount?: (waiting: number) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [sugg, setSugg] = useState<SuggestionFeed | null>(null);
  const [week, setWeek] = useState<ClientWeek | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [s, w] = await Promise.all([
      apiFetch<SuggestionFeed>('/content/suggestions', { token }).catch(() => null),
      apiFetch<{ week: ClientWeek | null }>(`/content/my-week?lang=${vi ? 'vi' : 'en'}`, { token }).catch(() => null),
    ]);
    if (s) { setSugg(s); onCount?.(s.waiting ?? s.open.length); }
    if (w) setWeek(w.week);
  }, [token, vi, onCount]);

  useEffect(() => { load(); }, [load]);

  // An empty tab is a broken-looking tab. A salon nobody is running marketing
  // for opens this and gets a sentence, not a blank rectangle.
  const nothing = !sugg?.open.length && !sugg?.past.length && !week?.jobs.length;
  if (nothing) {
    return (
      <div style={{
        maxWidth: 760, margin: '0 auto', padding: '36px 18px', textAlign: 'center',
        background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 14,
        color: 'var(--c64748b)', fontSize: 14, lineHeight: 1.65,
      }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>🎬</div>
        {T('Chưa có việc nào cho tiệm. Khi bên em gửi đề xuất quay chụp, nó sẽ hiện ở đây.',
           'Nothing to do yet. When the team sends something to film, it shows up here.')}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 22px' }}>
      {err && (
        <div style={{
          background: 'var(--c450a0a)', border: '1px solid #ef4444', color: 'var(--cfecaca)',
          borderRadius: 12, padding: '11px 14px', fontSize: 13.5, lineHeight: 1.55, marginBottom: 14,
        }}>{err}</div>
      )}

      {/* ---- 1. what Lumio asked for ---- */}
      {!!sugg?.open.length && (
        <section style={{ marginBottom: 18 }}>
          <h2 style={h2}>
            {T('Lumio đề xuất', 'From Lumio')}
            <span style={countPill}>{sugg.open.length}</span>
          </h2>
          <p style={lede}>
            {T('Quay hoặc chụp giúp bên em, rồi bấm nút gửi ngay dưới đây. Team sẽ dựng và đăng, tiệm chỉ cần duyệt.',
               'Film or photograph these, then send them with the button below. The team edits and posts; you just approve.')}
          </p>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
            {sugg.open.map((s) => (
              <SuggestionCard key={s.id} s={s} token={token} vi={vi} onDone={load} onError={setErr} />
            ))}
          </div>
        </section>
      )}

      {/* ---- 2. the shop's own week ----
             Two cards in an auto-fit grid: side by side on a laptop, stacked on
             a phone, with no breakpoint to keep in sync and nothing that
             depends on measuring the window. */}
      {!!week?.jobs.length && (
        <section style={{ marginBottom: 18 }}>
          <h2 style={h2}>{T('Việc của tiệm tuần này', 'Your shop this week')}</h2>
          <p style={lede}>{week.focus}</p>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', alignItems: 'start' }}>
          <div style={card}>
            {week.jobs.map((j, i) => (
              <div key={i} style={{
                display: 'flex', gap: 11, padding: '11px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--c1e293b)',
              }}>
                <span style={{ fontSize: 18, lineHeight: 1.3, flex: '0 0 auto' }}>{ICON[j.kind] ?? '•'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)', fontWeight: 700, letterSpacing: '.3px' }}>
                    {j.dayIndex === 0 ? T('HÔM NAY', 'TODAY') : j.day.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 1 }}>{j.text}</div>
                </div>
              </div>
            ))}
          </div>
          {!!week.prep.length && (
            <div style={{ ...card, background: 'var(--c0f172a)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.6px', color: 'var(--c64748b)', marginBottom: 7 }}>
                {T('CẦN CHUẨN BỊ', 'WHAT TO HAVE READY')}
              </div>
              {week.prep.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, padding: '4px 0' }}>
                  <span style={{ color: 'var(--c475569)', flex: '0 0 auto' }}>▢</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>{l.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{l.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </section>
      )}

      {/* ---- what the shop already sent ---- */}
      {!!sugg?.past.length && (
        <details style={{ marginBottom: 18 }}>
          <summary style={{
            cursor: 'pointer', fontSize: 13, color: 'var(--c94a3b8)', padding: '9px 2px',
            listStyle: 'none',
          }}>
            {T(`Đã gửi trước đó (${sugg.past.length})`, `Already sent (${sugg.past.length})`)}
          </summary>
          <div style={{ ...card, marginTop: 6 }}>
            {sugg.past.map((s, i) => (
              <div key={s.id} style={{
                padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--c1e293b)',
                display: 'flex', gap: 9, alignItems: 'baseline',
              }}>
                <span style={{ flex: '0 0 auto' }}>{s.status === 'done' ? '✅' : '—'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>{s.title}</div>
                  {!!s.media.length && (
                    <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
                      {s.media.length} {T('file đã gửi', 'files sent')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * One suggestion, with the only two answers a shop has: here it is, or it does
 * not fit us.
 *
 * The file picker is the primary action and it is a real `<input type="file">`
 * with `accept` set — on a phone that opens the camera roll and the camera in
 * one sheet, which is one tap from "I have filmed it" to "Lumio has it". The
 * alternative every agency actually lives with is a video in a group chat with
 * no idea which request it answers.
 */
function SuggestionCard({
  s, token, vi, onDone, onError,
}: {
  s: Suggestion; token: string | null; vi: boolean;
  onDone: () => void; onError: (m: string | null) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const pick = useRef<HTMLInputElement | null>(null);

  async function send(files: FileList | null) {
    if (!files?.length || !token) return;
    setBusy(true); onError(null);
    try {
      const out: { url: string; kind: 'image' | 'video' }[] = [];
      // One at a time on purpose: a shop's upload is on phone data, and four
      // parallel uploads on a weak connection finish slower than four in a row
      // and give the person no idea which one is moving.
      for (let i = 0; i < files.length; i += 1) {
        const each = (p: number) => setPct(Math.round(((i + p / 100) / files.length) * 100));
        out.push(await apiUpload('/uploads/media', files[i], token, each));
      }
      await apiFetch(`/content/suggestions/${s.id}/done`, { method: 'POST', token, body: { media: out } });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : T('Không gửi được, thử lại giúp em', 'Could not send — please try again'));
    } finally { setBusy(false); setPct(null); }
  }

  async function skip() {
    if (!token) return;
    setBusy(true); onError(null);
    try {
      await apiFetch(`/content/suggestions/${s.id}/skip`, { method: 'POST', token, body: { reason } });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'error');
    } finally { setBusy(false); setAsking(false); }
  }

  return (
    <div style={{ ...card, borderColor: '#6366f1', marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.4 }}>{s.title}</div>
      {s.note && (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 4 }}>{s.note}</div>
      )}

      {busy && pct !== null && (
        <div style={{ marginTop: 11 }}>
          <div style={{ height: 6, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#6366f1', transition: 'width .2s' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 5 }}>
            {T('Đang gửi', 'Sending')} {pct}% — {T('đừng đóng trang', 'keep this page open')}
          </div>
        </div>
      )}

      {!asking && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            ref={pick}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { void send(e.target.files); e.target.value = ''; }}
          />
          <button onClick={() => pick.current?.click()} disabled={busy} style={{ ...primary, flex: '1 1 200px' }}>
            {busy ? T('Đang gửi…', 'Sending…') : `📤 ${T('Đã quay xong — gửi cho Lumio', 'Filmed it — send to Lumio')}`}
          </button>
          <button onClick={() => setAsking(true)} disabled={busy} style={ghost}>
            {T('Không hợp tiệm', 'Not for us')}
          </button>
        </div>
      )}

      {asking && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginBottom: 6, lineHeight: 1.5 }}>
            {T('Vì sao không hợp? Một câu thôi cũng được — để lần sau bên em gợi ý đúng hơn.',
               'Why not? One line is plenty — it makes the next suggestion better.')}
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={T('Ví dụ: tiệm không làm mẫu này', 'e.g. we do not do that style')}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--c0f172a)',
              border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)',
              borderRadius: 9, padding: '10px 11px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={skip} disabled={busy} style={{ ...primary, background: 'var(--c475569)' }}>
              {T('Gửi', 'Send')}
            </button>
            <button onClick={() => setAsking(false)} disabled={busy} style={ghost}>
              {T('Quay lại', 'Back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
  borderRadius: 14, padding: 15, marginBottom: 0,
};
const h2: React.CSSProperties = {
  fontSize: 17, margin: '0 0 3px', color: 'var(--cf1f5f9)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const lede: React.CSSProperties = {
  fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6, margin: '0 0 11px',
};
const countPill: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, minWidth: 22, height: 22, borderRadius: 20,
  background: '#6366f1', color: '#fff', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', padding: '0 7px',
};
// 46px tall: a thumb on a phone, not a mouse on a desktop.
const primary: React.CSSProperties = {
  minHeight: 46, padding: '12px 16px', borderRadius: 11, cursor: 'pointer',
  border: 'none', background: '#6366f1', color: '#fff', fontSize: 14.5, fontWeight: 700,
};
const ghost: React.CSSProperties = {
  minHeight: 46, padding: '12px 16px', borderRadius: 11, cursor: 'pointer',
  border: '1px solid var(--c475569)', background: 'transparent',
  color: 'var(--c94a3b8)', fontSize: 14, fontWeight: 600,
};
