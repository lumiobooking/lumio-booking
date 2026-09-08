'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { compactCount, ageOf } from '../lib/counts';
import { useLive, fresh } from '../lib/live';
import { enqueue, installOutbox, useOutbox, retryFailed, discardBatch, cancelBatch, takeLastDone, type BatchView } from '../lib/upload-queue';
import { ShopWeek, HolidayOffers, type ShopWeekData, type HolidayIdea, type LastWeek, type AdsReceipt } from './ShopWeek';

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
  /** The one clip Lumio wants the shop to look at, when one was attached. */
  refUrl: string | null;
  refThumbUrl: string | null;
  /** The reference's public numbers, when it has them. */
  refCount?: number | null;
  refCountKind?: 'views' | 'likes' | null;
  refPublishedAt?: string | null;
  media: { url: string; kind: 'image' | 'video' }[];
  /** The shop sent this on its own, nobody asked. */
  fromShop?: boolean;
}
interface SuggestionFeed { open: Suggestion[]; past: Suggestion[]; waiting: number }
type ClientWeek = ShopWeekData;

export function SalonWorkspace({ token, vi, onCount }: {
  token: string | null;
  vi: boolean;
  /** How many suggestions are still waiting on the shop, for the tab badge. */
  onCount?: (waiting: number) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [sugg, setSugg] = useState<SuggestionFeed | null>(null);
  const [week, setWeek] = useState<ClientWeek | null>(null);
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<HolidayIdea[]>([]);
  const [lastWeek, setLastWeek] = useState<LastWeek | null>(null);
  const [ads, setAds] = useState<AdsReceipt | null>(null);
  // The ask's one button opens the picker on the send box at the top of the tab.
  const askSend = useRef<(() => void) | null>(null);
  const [weekUnread, setWeekUnread] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [s, w, h, u] = await Promise.all([
      apiFetch<SuggestionFeed>(fresh('/content/suggestions'), { token }).catch(() => null),
      apiFetch<{ week: ClientWeek | null; weekKey: string | null; lastWeek: LastWeek | null; ads: AdsReceipt | null }>(fresh(`/content/my-week?lang=${vi ? 'vi' : 'en'}`), { token }).catch(() => null),
      apiFetch<{ ideas: HolidayIdea[] }>(fresh(`/content/my-holidays?lang=${vi ? 'vi' : 'en'}`), { token }).catch(() => null),
      apiFetch<{ bySubject?: Record<string, number> }>(fresh('/content/chat/unread'), { token }).catch(() => null),
    ]);
    if (s) { setSugg(s); onCount?.(s.waiting ?? s.open.length); }
    if (w) { setWeek(w.week); setWeekKey(w.weekKey ?? null); setLastWeek(w.lastWeek ?? null); setAds(w.ads ?? null); }
    if (h) setHolidays(h.ideas ?? []);
    if (u && w?.weekKey) setWeekUnread(u.bySubject?.[`week:${w.weekKey}`] ?? 0);
  }, [token, vi, onCount]);

  useEffect(() => { load(); }, [load]);
  // A suggestion the team sends at ten shows up at ten, not when the shop
  // next reloads: every 30s while visible, and the moment the app comes back.
  useLive(load, 30_000, Boolean(token));

  // The outbox runs whenever this page is open; a batch that finishes on the
  // server is what turns a card from "sending" into "sent", so reload then.
  useEffect(() => { installOutbox(() => token); }, [token]);
  const outbox = useOutbox();
  useEffect(() => { if (takeLastDone()) void load(); }, [outbox.lastDone, load]);

  // An empty tab is a broken-looking tab. A salon nobody is running marketing
  // for opens this and gets a sentence, not a blank rectangle — but the send
  // box stays: a shop with no card from Lumio yet is exactly the shop whose
  // first clip has to have somewhere to go.
  const nothing = !sugg?.open.length && !sugg?.past.length && !week?.jobs.length;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 22px' }}>
      {err && (
        <div style={{
          background: 'var(--c450a0a)', border: '1px solid #ef4444', color: 'var(--cfecaca)',
          borderRadius: 12, padding: '11px 14px', fontSize: 13.5, lineHeight: 1.55, marginBottom: 14,
        }}>{err}</div>
      )}

      <OutboxBar vi={vi} pending={outbox.pending} running={outbox.running} online={outbox.online} pct={outbox.pct} />

      {/* ---- 0. the open door, first and loud ----
             The thing a shop does most often is send what it just made. That
             is the top of the tab, one tap, no card to wait for. */}
      <SendAnything token={token} vi={vi} onDone={load} onError={setErr} openRef={askSend} />

      {nothing && (
        <div style={{
          padding: '28px 18px', textAlign: 'center',
          background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 14,
          color: 'var(--c64748b)', fontSize: 14, lineHeight: 1.65,
        }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🎬</div>
          {T('Chưa có việc nào cho tiệm. Khi bên em gửi đề xuất quay chụp, nó sẽ hiện ở đây — còn ảnh/clip tiệm có sẵn thì gửi ở khung trên bất cứ lúc nào.',
             'Nothing to do yet. When the team sends something to film, it shows up here — and anything you already have can go in the box above, any time.')}
        </div>
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

      {/* ---- 2. the week, as a thing the shop works on ----
             The whole plan, editable in place, with the thread under it —
             see ShopWeek. Then the holidays ahead with a programme each. */}
      {!!week?.jobs.length && (
        <ShopWeek
          token={token} vi={vi} week={week} weekKey={weekKey} unread={weekUnread}
          lastWeek={lastWeek} ads={ads} onSend={() => askSend.current?.()}
          onChanged={load} onError={setErr}
        />
      )}
      {!!holidays.length && (
        <HolidayOffers token={token} vi={vi} ideas={holidays} onError={setErr} />
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
                <span style={{ flex: '0 0 auto' }}>{s.fromShop ? '📤' : s.status === 'done' ? '✅' : '—'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>
                    {s.fromShop && <span style={{ color: 'var(--c94a3b8)' }}>{T('Tiệm gửi: ', 'You sent: ')}</span>}{s.title}
                  </div>
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
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const pick = useRef<HTMLInputElement | null>(null);
  // This card's own batch in the outbox, if one is on its way.
  const outbox = useOutbox();
  const mine = outbox.pending.find((b) => 'suggestionId' in b.target && b.target.suggestionId === s.id) ?? null;
  const pct = mine ? mine.pct : null;

  async function send(files: File[]) {
    if (!files.length || !token) return;
    onError(null);
    try {
      // Into the outbox and back at once. The runner sends the pieces, then
      // marks the card done on the server; `onDone` fires from the bar.
      await enqueue(files, { suggestionId: s.id });
    } catch (e) {
      onError(e instanceof Error ? e.message : T('Không gửi được, thử lại giúp em', 'Could not send — please try again'));
    }
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
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        {/* The reference, right there. An instruction with nothing to look at
            is a shop guessing at a style from a sentence — which is what the
            first version of this card asked people to do. */}
        {s.refThumbUrl && (
          <a
            href={s.refUrl ?? s.refThumbUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: 74, height: 74, borderRadius: 10, overflow: 'hidden', flex: '0 0 auto',
              border: '1px solid var(--c475569)', display: 'block', position: 'relative',
              background: 'var(--c0f172a)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.refThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 22, textShadow: '0 1px 6px rgba(0,0,0,.8)',
            }}>▶</span>
          </a>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.4 }}>{s.title}</div>
          {s.note && (
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 4 }}>{s.note}</div>
          )}
          {s.refUrl && (
            <a
              href={s.refUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', marginTop: 7, fontSize: 13, fontWeight: 600,
                color: 'var(--ca5b4fc)', textDecoration: 'none',
              }}
            >
              ▶ {T('Xem mẫu Lumio gửi', 'Watch the reference')}
            </a>
          )}
          {s.refUrl && typeof s.refCount === 'number' && s.refCountKind && (
            // The number is the argument: a shop that sees 1.2M views on the
            // reference does not need convincing that the style is worth an hour.
            <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', marginTop: 3 }}>
              {s.refCountKind === 'views' ? '👁' : '❤️'} <b style={{ color: 'var(--cf1f5f9)' }}>{compactCount(s.refCount, vi)}</b>{' '}
              {s.refCountKind === 'views' ? T('lượt xem', 'views') : T('lượt thích', 'likes')}
              {s.refPublishedAt ? <span style={{ color: 'var(--c94a3b8)' }}> · {T('đăng', 'posted')} {ageOf(s.refPublishedAt, vi)}</span> : null}
            </div>
          )}
        </div>
      </div>

      {pct !== null && (
        <div style={{ marginTop: 11 }}>
          <div style={{ height: 6, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#6366f1', transition: 'width .2s' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 5 }}>
            {T('Đang gửi', 'Sending')} {pct}% — {T('cứ để điện thoại đó, màn hình sẽ không tự tắt', 'you can put the phone down — the screen stays on')}
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
            // Copy the list BEFORE clearing the input: a FileList is live, so
            // clearing first emptied it under the upload — 0 files, progress
            // ÷ 0 = "Infinity%", and a send that never finished.
            onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          />
          <button onClick={() => pick.current?.click()} disabled={busy || pct !== null} style={{ ...primary, flex: '1 1 200px' }}>
            {pct !== null ? T('Đang gửi…', 'Sending…') : `📤 ${T('Đã quay xong — gửi cho Lumio', 'Filmed it — send to Lumio')}`}
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

/**
 * The outbox, in one line at the top of the tab.
 *
 * Says the only three things a person needs: it is going, how far, and that
 * they can put the phone down. If the road drops, it says so and offers to try
 * again; a batch that cannot be delivered can be dropped so it stops nagging.
 */
function OutboxBar({ vi, pending, running, online, pct }: {
  vi: boolean; pending: BatchView[]; running: boolean; online: boolean; pct: number;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  if (!pending.length) return null;
  const files = pending.reduce((n, b) => n + b.files.length, 0);
  const failed = pending.filter((b) => b.status === 'failed' || b.files.some((f) => f.status === 'failed'));
  const stuck = failed.length > 0 || !online;
  // The reason, verbatim. A bar that says "interrupted" and nothing else is a
  // bar nobody can act on — and nobody can report.
  const reason = failed.flatMap((b) => [b.error, ...b.files.map((f) => f.error)]).find(Boolean) ?? null;
  return (
    <div style={{
      ...card, marginBottom: 14, borderColor: stuck ? '#f59e0b' : '#6366f1',
      background: stuck ? 'rgba(245,158,11,.08)' : 'rgba(99,102,241,.10)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18 }}>{stuck ? '⏸' : '📤'}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
            {!online
              ? T('Mất mạng — sẽ gửi tiếp khi có mạng lại', 'Offline — will continue when the connection is back')
              : failed.length
                ? T('Gửi bị gián đoạn', 'Sending was interrupted')
                : running
                  ? T(`Đang gửi ${files} file cho Lumio — ${pct}%`, `Sending ${files} file(s) to Lumio — ${pct}%`)
                  : T(`${files} file đang chờ gửi`, `${files} file(s) waiting to send`)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>
            {stuck
              ? T('Những mảnh đã gửi được giữ lại — bấm "Gửi tiếp" là đi tiếp từ chỗ dở, không phải chọn lại file.',
                  'What already went is kept — press "Resume" and it carries on from where it stopped, no need to pick the files again.')
              : T('Cứ để điện thoại đó, màn hình sẽ không tự tắt. Nếu đóng app, lần mở sau tự gửi tiếp từ chỗ dở — không phải chọn lại file.',
                  'You can put the phone down — the screen stays on. If you close the app, it resumes where it left off next time, no need to pick the files again.')}
          </div>
          {reason && (
            <div style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 4, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
              {T('Lỗi', 'Error')}: {reason}
            </div>
          )}
          <div style={{ height: 5, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden', marginTop: 8 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: stuck ? '#f59e0b' : '#6366f1', transition: 'width .3s' }} />
          </div>
          {/* Each batch on its own line with a way out. Picked the wrong clip?
              Cancel it here and pick again — the pieces already sent are
              dropped on the server, nothing is delivered. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {pending.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ccbd5e1)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {'suggestionId' in b.target ? '🎬 ' : '📤 '}
                  {b.files.map((f) => f.name).join(', ') || T('file', 'file')} · {b.pct}%
                </span>
                <button
                  onClick={() => { if (window.confirm(T('Huỷ gửi đợt này? File đã gửi dở sẽ bị bỏ.', 'Cancel this send? What went so far is dropped.'))) void cancelBatch(b.id); }}
                  style={{ ...ghost, minHeight: 28, padding: '3px 10px', fontSize: 12, flex: '0 0 auto' }}
                  aria-label={T('Huỷ gửi', 'Cancel send')}
                >✕ {T('Huỷ', 'Cancel')}</button>
              </div>
            ))}
          </div>
        </div>
        {stuck && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { void retryFailed(); }} style={{ ...primary, minHeight: 38, padding: '8px 14px', fontSize: 13 }}>
              {T('Gửi tiếp', 'Resume')}
            </button>
            {failed.length > 0 && (
              <button
                onClick={() => { if (window.confirm(T('Bỏ những file chưa gửi được?', 'Drop the files that did not go?'))) failed.forEach((b) => { void discardBatch(b.id); }); }}
                style={{ ...ghost, minHeight: 38, padding: '8px 12px', fontSize: 13 }}
              >{T('Bỏ', 'Drop')}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Send us anything." One line of what it is, pick the files, done.
 *
 * Collapsed to a single row until tapped: it sits under the cards Lumio
 * asked for, and must not compete with them for the thumb. Once open it
 * is the same send as a card — same shrink, same two-at-a-time, same bar.
 */
function SendAnything({ token, vi, onDone, onError, openRef }: {
  token: string | null; vi: boolean; onDone: () => void; onError: (m: string | null) => void;
  /** Handed up so the week's one ask can open this picker with its own button. */
  openRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [note, setNote] = useState('');
  const busy = false;
  const [sent, setSent] = useState<number | null>(null);
  const pick = useRef<HTMLInputElement | null>(null);
  const outbox = useOutbox();
  useEffect(() => {
    if (!openRef) return;
    openRef.current = () => pick.current?.click();
    return () => { openRef.current = null; };
  }, [openRef]);
  const mine = outbox.pending.filter((b) => 'shop' in b.target);
  const pct = mine.length ? Math.round(mine.reduce((n, b) => n + b.pct, 0) / mine.length) : null;
  void onDone;

  async function send(files: File[]) {
    if (!files.length || !token) return;
    onError(null); setSent(null);
    try {
      await enqueue(files, { shop: true, note });
      setSent(files.length); setNote('');
    } catch (e) {
      onError(e instanceof Error ? e.message : T('Không gửi được, thử lại giúp em', 'Could not send — please try again'));
    }
  }

  return (
    <section style={{
      ...card, marginBottom: 18, padding: '16px 16px 14px',
      border: '1.5px solid #6366f1', background: 'linear-gradient(135deg, rgba(99,102,241,.18), rgba(99,102,241,.06))',
      boxShadow: '0 6px 24px rgba(99,102,241,.18)',
    }}>
      <input
        ref={pick} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
        onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 30, lineHeight: 1, flex: '0 0 auto' }}>📤</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'var(--cf1f5f9)', fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>
            {T('Gửi ảnh/clip cho Lumio', 'Send photos or clips to Lumio')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 3 }}>
            {pct !== null
              ? T(`Đang gửi ${pct}% — cứ để điện thoại đó, không cần nhìn.`, `Sending ${pct}% — you can put the phone down.`)
              : sent
                ? T(`✓ Đã nhận ${sent} file — bên em sẽ dựng bài từ đó. Gửi tiếp bất cứ lúc nào.`, `✓ Got ${sent} file(s) — we will make posts from them. Send more any time.`)
                : T('Vừa làm xong bộ móng đẹp? Chụp/quay rồi gửi ngay — bên em dựng bài, tiệm chỉ cần duyệt.',
                    'Just finished a great set? Shoot it and send — we make the post, you just approve.')}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
          placeholder={T('Ghi chú (không bắt buộc): bộ móng cô dâu, khách rất thích…', 'Note (optional): bridal set, client loved it…')}
          style={{
            flex: '1 1 220px', minWidth: 0, boxSizing: 'border-box', minHeight: 46, padding: '10px 12px', borderRadius: 11,
            border: '1px solid var(--c475569)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14,
          }}
        />
        <button onClick={() => pick.current?.click()} disabled={busy} style={{ ...primary, flex: '1 1 200px', fontSize: 15.5, minHeight: 48 }}>
          📷 {T('Chọn ảnh/clip và gửi', 'Pick photos/clips and send')}
        </button>
      </div>
    </section>
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
