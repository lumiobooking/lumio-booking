'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLive, fresh } from '../lib/live';
import { apiFetch } from '../lib/api';
import { ind } from '../lib/ui-industry';

/**
 * The team's half of the loop: what the shop actually sent back.
 *
 * WHY IT WAS MISSING AND WHY THAT MATTERED
 *
 * A staff member picked a trend and sent it. The shop filmed it, pressed send,
 * and the files landed in a database column with nothing pointing at them.
 * Every part of the chain existed except the one where somebody sits down to
 * make the post — which is the part the whole feature was for. Footage that
 * arrives and is never opened is worse than footage that never arrives: the
 * shop did the work, and next week it will notice nothing came of it.
 *
 * WHY A GRID, AND PAGES
 *
 * The first version was a column of tall cards: one file per screen height,
 * and a shop that sent nine things pushed the posting queue below the fold
 * for a week. Files are pictures; pictures go in a grid. Twelve to a page,
 * the picture first, the shop's note under it, two buttons. A page control
 * instead of an endless scroll, so "what is still waiting" is a number
 * somebody can read, not a distance.
 *
 * THE THREE LANES
 *
 * What a shop sends is raw — a clip straight off the phone, six photos of
 * which two are usable. Nobody schedules that as-is; somebody edits it first,
 * in the composer or outside it, and that takes a day or three. So a card
 * has a life on the team's side: RECEIVED (nobody's yet) → IN PROGRESS
 * (picked up, with a name on it, so two people do not edit the same clip) →
 * DONE (put away with a note, under the fold). "Make a post" does not finish
 * a card by itself — the raw clip and the post made from it are different
 * things, and only the person knows when the second exists.
 *
 * WHY "PUT AWAY" TAKES A NOTE
 *
 * A card that is closed with a click is closed without a trace; three weeks
 * later nobody can answer "did we ever use that clip?". Putting a card away
 * asks for one line — "made the Tuesday reel", "blurry, asked to reshoot" —
 * and keeps it, with who and when, in the "handled" pages underneath.
 *
 * WHERE THE FILE IS
 *
 * The thumbnail and the link come from the file's home (Drive, for anything
 * sent since the archive was switched on; the hosting, for older ones).
 * "Make a post" asks the server for public addresses first — the copy on
 * the hosting exists only for the post, and only for a month.
 */

export interface MediaItem { url: string; kind: 'image' | 'video'; driveUrl?: string; driveFileId?: string; thumbUrl?: string; publicUrl?: string }

export interface TeamSuggestion {
  id: string;
  title: string;
  note: string | null;
  refUrl: string | null;
  refThumbUrl: string | null;
  refCount?: number | null;
  refCountKind?: 'views' | 'likes' | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  createdByName: string | null;
  /** The shop opened this card itself — sent files nobody asked for. */
  fromShop?: boolean;
  createdAt: string;
  status: 'sent' | 'done' | 'working' | 'skipped' | 'used';
  doneAt: string | null;
  media: MediaItem[];
  usedNote?: string | null;
  usedAt?: string | null;
  usedByName?: string | null;
  workingAt?: string | null;
  workingByName?: string | null;
}
export interface TeamFeed {
  driveFolderUrl?: string | null;
  /** Received — nobody's yet. */
  ready: TeamSuggestion[];
  /** Picked up — being edited. */
  working?: TeamSuggestion[];
  waitingOnShop: TeamSuggestion[];
  recent: TeamSuggestion[];
  readyCount: number;
  newCount?: number;
}

const PAGE = 12;

export function SuggestionInbox({
  token, vi, onCount, onMakePost, canDelete,
}: {
  token: string | null;
  vi: boolean;
  onCount?: (n: number) => void;
  /** Owner or full-level support: may delete handled cards, not just withdraw unanswered ones. */
  canDelete?: boolean;
  /** Open the composer with these files already attached (public addresses). */
  onMakePost: (s: TeamSuggestion) => void;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [workPage, setWorkPage] = useState(0);
  const [donePage, setDonePage] = useState(0);
  const [closing, setClosing] = useState<string | null>(null);
  // rt237b: one lane at a time, as tabs — and "Take it" moves you to where the card went.
  const [tab, setTab] = useState<'new' | 'work' | 'wait' | 'done' | null>(null);
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch<TeamFeed>(fresh('/content/suggestions/team'), { token }).catch(() => null);
    if (r) { setFeed(r); onCount?.(r.readyCount ?? 0); }
  }, [token, onCount]);
  useEffect(() => { load(); }, [load]);
  useLive(load, 45_000, Boolean(token));
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 6000); return () => clearTimeout(t); }, [flash]);

  async function putAway(id: string) {
    if (!token) return;
    setBusy(id); setErr(null);
    try {
      await apiFetch(`/content/suggestions/${id}/used`, { method: 'POST', token, body: { note } });
      setClosing(null); setNote('');
      await load();
      setFlash({ id, text: T('Đã cất — xem lại ở tab "Đã xử lý"', 'Put away — see it under "Handled"') });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error');
    } finally { setBusy(null); }
  }

  async function act(id: string, path: string, method: 'POST' | 'DELETE' = 'POST') {
    if (!token) return;
    setBusy(id); setErr(null);
    try {
      await apiFetch(`/content/suggestions/${id}${path}`, { method, token });
      await load();
      if (path === '/claim') { setTab('work'); setFlash({ id, text: T('Đã nhận — thẻ chuyển sang "Đang làm"', 'Taken — the card is now under "In progress"') }); }
      if (path === '/release') { setTab('new'); setFlash({ id, text: T('Đã trả về "Mới nhận"', 'Back under "Received"') }); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error');
    } finally { setBusy(null); }
  }

  async function makePost(s: TeamSuggestion) {
    if (!token) return;
    setBusy(s.id); setErr(null);
    try {
      // Public addresses for the post: the copy on the hosting is made now.
      const r = await apiFetch<{ media: MediaItem[] }>(`/content/suggestions/${s.id}/stage`, { method: 'POST', token });
      // Opening the composer picks the card up; it is finished only when the
      // person says so, because the post made from raw footage is a different
      // thing from the footage.
      if (s.status !== 'working') await apiFetch(`/content/suggestions/${s.id}/claim`, { method: 'POST', token }).catch(() => undefined);
      onMakePost({ ...s, media: r.media.map((m) => ({ ...m, url: m.publicUrl ?? m.url })) });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error');
    } finally { setBusy(null); }
  }

  if (!feed) return null;
  const working = feed.working ?? [];
  const done = feed.recent.filter((s) => s.status === 'used' || s.status === 'skipped');
  if (!feed.ready.length && !working.length && !feed.waitingOnShop.length && !done.length) return null;

  const paged = <X,>(list: X[], at: number) => {
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const p = Math.min(at, pages - 1);
    return { pages, p, slice: list.slice(p * PAGE, p * PAGE + PAGE) };
  };
  const newL = paged(feed.ready, page);
  const workL = paged(working, workPage);
  const doneL = paged(done, donePage);
  const me = (name: string | null | undefined) => (name ? name.split('@')[0] : '');

  const lanes: { key: 'new' | 'work' | 'wait' | 'done'; label: string; n: number; dot: string }[] = [
    { key: 'new', label: T('Mới nhận', 'Received'), n: feed.ready.length, dot: '#22c55e' },
    { key: 'work', label: T('Đang làm', 'In progress'), n: working.length, dot: '#6366f1' },
    { key: 'wait', label: T('Chờ tiệm', 'Waiting on shop'), n: feed.waitingOnShop.length, dot: '#94a3b8' },
    { key: 'done', label: T('Đã xử lý', 'Handled'), n: done.length, dot: '#64748b' },
  ];
  const cur = tab ?? (feed.ready.length ? 'new' : working.length ? 'work' : feed.waitingOnShop.length ? 'wait' : 'done');
  const cardProps = (s: TeamSuggestion) => ({
    s, vi, me, closing: closing === s.id, note, setNote, busy: busy === s.id, lit: flash?.id === s.id,
    onClose: () => { setClosing(null); setNote(''); }, onPutAway: () => putAway(s.id),
  });

  return (
    <div style={{
      background: 'var(--c1e293b)', border: `1px solid ${feed.ready.length ? '#22c55e' : 'var(--c334155)'}`,
      borderRadius: 12, padding: 12, marginBottom: 14,
    }}>
      {/* ---- header: title, the four lanes as tabs, Drive ---- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ce2e8f0)', marginRight: 4 }}
          title={T('Đồ tiệm gửi là đồ thô. Nhận làm → dựng bài → ✓ Xong (ghi một dòng). File gốc trên Drive.', 'What the shop sends is raw. Take it → make the post → ✓ Done (one line). Originals on Drive.')}>
          📨 {T('Tiệm đã gửi', 'From the shop')}
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {lanes.map((l) => {
            const on = cur === l.key;
            return (
              <button key={l.key} role="tab" aria-selected={on} onClick={() => setTab(l.key)}
                style={{ ...btn, minHeight: 32, padding: '0 10px', borderRadius: 999, fontSize: 12.5, fontWeight: on ? 700 : 500, display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: on ? 'var(--c0f172a)' : 'transparent', borderColor: on ? l.dot : 'var(--c334155)', color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: l.dot }} />
                {l.label}
                <span style={{ fontWeight: 700, color: l.n && l.key === 'new' ? 'var(--ink-good)' : l.n && l.key === 'work' ? 'var(--ca5b4fc)' : 'inherit' }}>{l.n}</span>
              </button>
            );
          })}
        </div>
        {feed.driveFolderUrl && (
          <a href={feed.driveFolderUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--ca5b4fc)', textDecoration: 'none' }}>
            📁 Drive →
          </a>
        )}
      </div>
      {flash && <div role="status" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--c86efac)', background: 'rgba(34,197,94,.1)', border: '1px solid #166534', borderRadius: 8, padding: '6px 10px' }}>✓ {flash.text}</div>}
      {err && <div style={{ fontSize: 12.5, color: 'var(--cfca5a5)', marginTop: 8 }}>{err}</div>}

      <div style={{ marginTop: 10 }}>
        {/* ---- received ---- */}
        {cur === 'new' && (feed.ready.length === 0 ? <Empty text={T('Không có gì mới từ tiệm.', 'Nothing new from the shop.')} /> : (
          <>
            <Items list={newL.slice} render={(s) => (
              <Card key={s.id} {...cardProps(s)} border="#166534" actions={(
                <>
                  <button onClick={() => act(s.id, '/claim')} disabled={busy === s.id} style={{ ...btn, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 700 }}>
                    {busy === s.id ? '…' : `🙋 ${T('Nhận làm', 'Take it')}`}
                  </button>
                  <button onClick={() => makePost(s)} disabled={busy === s.id} title={T('Dựng bài với file đính sẵn', 'Open the composer with the files attached')} style={{ ...btn, background: '#22c55e', borderColor: '#22c55e', color: '#052e16', fontWeight: 700 }}>✎</button>
                  <button onClick={() => { setClosing(s.id); setNote(''); }} title={T('Không cần dựng — ghi một dòng rồi cất', 'Nothing to make — note it and put away')} style={btn}>✓</button>
                </>
              )} />
            )} />
            {newL.pages > 1 && <Pager page={newL.p} pages={newL.pages} onPage={setPage} vi={vi} />}
          </>
        ))}

        {/* ---- in progress ---- */}
        {cur === 'work' && (working.length === 0 ? <Empty text={T('Chưa ai nhận làm thẻ nào.', 'Nobody has taken a card yet.')} /> : (
          <>
            <Items list={workL.slice} render={(s) => (
              <Card key={s.id} {...cardProps(s)} border="#4338ca" actions={(
                <>
                  <button onClick={() => makePost(s)} disabled={busy === s.id} style={{ ...btn, background: '#22c55e', borderColor: '#22c55e', color: '#052e16', fontWeight: 700 }}>
                    {busy === s.id ? '…' : `✎ ${T('Dựng bài', 'Make a post')}`}
                  </button>
                  <button onClick={() => { setClosing(s.id); setNote(''); }} title={T('Xong — ghi một dòng rồi cất', 'Done — note it and put away')} style={{ ...btn, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 700 }}>✓ {T('Xong', 'Done')}</button>
                  <button onClick={() => act(s.id, '/release')} disabled={busy === s.id} title={T('Trả về Mới nhận', 'Back to received')} style={btn}>↩</button>
                </>
              )} />
            )} />
            {workL.pages > 1 && <Pager page={workL.p} pages={workL.pages} onPage={setWorkPage} vi={vi} />}
          </>
        ))}

        {/* ---- waiting on the shop ---- */}
        {cur === 'wait' && (feed.waitingOnShop.length === 0 ? <Empty text={T('Không có đề xuất nào đang chờ tiệm.', 'No requests waiting on the shop.')} /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {feed.waitingOnShop.map((s) => (
              <span key={s.id} title={s.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c94a3b8)', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, padding: '4px 6px 4px 9px', maxWidth: 320 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.refThumbUrl ? '▶ ' : ''}{s.title} <span style={{ color: 'var(--ink-faint)' }}>· {ago(s.createdAt, vi)}</span>
                </span>
                <button
                  onClick={() => { if (window.confirm(T(`Thu hồi đề xuất "${s.title}"? Tiệm sẽ không thấy nữa.`, `Withdraw "${s.title}"? The shop will no longer see it.`))) void act(s.id, '', 'DELETE'); }}
                  disabled={busy === s.id} title={T('Thu hồi', 'Withdraw')}
                  style={{ ...btn, padding: '1px 6px', fontSize: 11, color: 'var(--cf87171)', borderColor: 'transparent' }}
                >✕</button>
              </span>
            ))}
          </div>
        ))}

        {/* ---- handled: what was done with each, by whom ---- */}
        {cur === 'done' && (done.length === 0 ? <Empty text={T('Chưa có thẻ nào được cất.', 'Nothing put away yet.')} /> : (
          <>
            <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {doneL.slice.map((s) => <DoneRow key={s.id} s={s} vi={vi} lit={flash?.id === s.id} canDelete={!!canDelete} busy={busy === s.id}
                onDelete={() => { if (window.confirm(T(`Xoá hẳn "${s.title}"? Ghi chú và lịch sử mất; file gốc trên Drive vẫn còn.`, `Delete "${s.title}" for good? The note and history go; the Drive originals stay.`))) void act(s.id, '', 'DELETE'); }} />)}
            </div>
            {doneL.pages > 1 && <Pager page={doneL.p} pages={doneL.pages} onPage={setDonePage} vi={vi} />}
          </>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: 'var(--c64748b)', padding: '6px 2px' }}>{text}</div>;
}

/** Text-only cards (an offer request, an ad approval) as compact rows; cards with files in a picture grid. */
function Items({ list, render }: { list: TeamSuggestion[]; render: (s: TeamSuggestion) => React.ReactNode }) {
  const text = list.filter((s) => !s.media?.length);
  const pics = list.filter((s) => s.media?.length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {text.length > 0 && <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>{text.map(render)}</div>}
      {pics.length > 0 && <Grid>{pics.map(render)}</Grid>}
    </div>
  );
}

/** A handled card: one line of what, one of what was done, who and when; opens in full. */
function DoneRow({ s, vi, lit, canDelete, busy, onDelete }: { s: TeamSuggestion; vi: boolean; lit: boolean; canDelete: boolean; busy: boolean; onDelete: () => void }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--c0f172a)', border: `1px solid ${lit ? '#22c55e' : 'var(--line)'}`, borderRadius: 9, padding: '6px 8px', position: 'relative' }}>
      {open && <DetailModal s={s} vi={vi} onClose={() => setOpen(false)} />}
      {s.media?.length ? <Thumb media={s.media} vi={vi} small /> : null}
      <button onClick={() => setOpen(true)} style={{ ...btn, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
        <div style={{ fontSize: 11.5, color: s.status === 'skipped' ? 'var(--ink-bad)' : 'var(--ink-good)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.status === 'skipped' ? `✕ ${T('Tiệm từ chối', 'Shop declined')}` : `✓ ${s.usedNote || T('Đã dùng', 'Used')}`}
          <span style={{ color: 'var(--c64748b)' }}> · {s.usedByName ? `${s.usedByName.split('@')[0]} · ` : ''}{ago(s.usedAt ?? s.doneAt ?? s.createdAt, vi)}</span>
        </div>
      </button>
      {canDelete && (
        <button onClick={onDelete} disabled={busy} title={T('Xoá (chỉ tài khoản quyền cao)', 'Delete (senior accounts only)')}
          style={{ ...btn, padding: '0 6px', fontSize: 11, lineHeight: '18px', color: 'var(--cf87171)', borderColor: 'transparent' }}>✕</button>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>{children}</div>;
}

/** One card: the picture, the shop's words, who has it, and the lane's buttons. */
function Card({ s, vi, border, me, closing, note, setNote, busy, onClose, onPutAway, actions, lit }: {
  s: TeamSuggestion; vi: boolean; border: string; me: (n: string | null | undefined) => string;
  closing: boolean; note: string; setNote: (v: string) => void; busy: boolean;
  onClose: () => void; onPutAway: () => void; actions: React.ReactNode; lit?: boolean;
}) {
  if (!s.media?.length) return <TextRow s={s} vi={vi} border={border} me={me} closing={closing} note={note} setNote={setNote} busy={busy} onClose={onClose} onPutAway={onPutAway} actions={actions} lit={lit} />;
  return <PicCard s={s} vi={vi} border={border} me={me} closing={closing} note={note} setNote={setNote} busy={busy} onClose={onClose} onPutAway={onPutAway} actions={actions} lit={lit} />;
}

/** rt237b: a card with no file is one compact row — the title, one line of the note, who has it, the buttons. */
function TextRow({ s, vi, border, me, closing, note, setNote, busy, onClose, onPutAway, actions, lit }: {
  s: TeamSuggestion; vi: boolean; border: string; me: (n: string | null | undefined) => string;
  closing: boolean; note: string; setNote: (v: string) => void; busy: boolean;
  onClose: () => void; onPutAway: () => void; actions: React.ReactNode; lit?: boolean;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'var(--c0f172a)', border: `1px solid ${lit ? '#22c55e' : border}`, boxShadow: lit ? '0 0 0 2px rgba(34,197,94,.35)' : 'none', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {open && <DetailModal s={s} vi={vi} onClose={() => setOpen(false)} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(true)} title={T('Xem đầy đủ', 'See it all')} style={{ ...btn, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', minWidth: 0, flex: '1 1 220px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.fromShop ? `📤 ${T('Tiệm gửi', 'Shop')}` : T('Trả lời đề xuất', 'Answer')} · {ago(s.doneAt ?? s.createdAt, vi)}
            {s.status === 'working' && <span style={{ color: 'var(--ca5b4fc)' }}> · 🙋 {me(s.workingByName) || 'Lumio'}</span>}
            <span style={{ color: 'var(--ca5b4fc)', fontWeight: 600 }}> · {T('Xem chi tiết ›', 'Details ›')}</span>
          </div>
        </button>
        {!closing && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{actions}</div>}
      </div>
      {closing && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onPutAway(); if (e.key === 'Escape') onClose(); }}
            placeholder={T('Đã làm gì? — vd: đã lên bài ưu đãi', 'What was done? — e.g. posted the offer')} style={{ ...inp, flex: '1 1 200px' }} />
          <button onClick={onPutAway} disabled={busy} style={{ ...btn, background: '#6366f1', borderColor: '#6366f1', color: '#fff' }}>✓ {T('Cất đi', 'Put away')}</button>
          <button onClick={onClose} style={btn}>{T('Huỷ', 'Cancel')}</button>
        </div>
      )}
    </div>
  );
}

function PicCard({ s, vi, border, me, closing, note, setNote, busy, onClose, onPutAway, actions, lit }: {
  s: TeamSuggestion; vi: boolean; border: string; me: (n: string | null | undefined) => string;
  closing: boolean; note: string; setNote: (v: string) => void; busy: boolean;
  onClose: () => void; onPutAway: () => void; actions: React.ReactNode; lit?: boolean;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  // rt237: an offer request or a note has no file — the text IS the content, so show
  // more of it, and open the whole thing on a click (the card only fits two lines).
  const [open, setOpen] = useState(false);
  const textOnly = !s.media?.length;
  return (
    <div style={{ background: 'var(--c0f172a)', border: `1px solid ${lit ? '#22c55e' : border}`, boxShadow: lit ? '0 0 0 2px rgba(34,197,94,.35)' : 'none', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {!textOnly && <Thumb media={s.media} vi={vi} />}
      {open && <DetailModal s={s} vi={vi} onClose={() => setOpen(false)} />}
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
          title={T('Xem đầy đủ', 'See it all')} style={{ minWidth: 0, cursor: 'pointer' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: s.fromShop ? 'var(--ink-warn)' : 'var(--c64748b)' }}>
            {s.fromShop ? `📤 ${T('TIỆM TỰ GỬI', 'SENT BY SHOP')}` : T('TRẢ LỜI ĐỀ XUẤT', 'ANSWERS A REQUEST')}
            <span style={{ fontWeight: 500, color: 'var(--c64748b)' }}> · {ago(s.doneAt ?? s.createdAt, vi)}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.4, marginTop: 2, display: '-webkit-box', WebkitLineClamp: textOnly ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.title}</div>
          {s.note && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45, marginTop: 2, whiteSpace: 'pre-line', display: '-webkit-box', WebkitLineClamp: textOnly ? 8 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.note}</div>}
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ca5b4fc)', marginTop: 4 }}>{T('Xem chi tiết ›', 'Details ›')}</div>
          {s.status === 'working' && (
            <div style={{ fontSize: 11.5, color: 'var(--ca5b4fc)', marginTop: 3 }}>
              🙋 {me(s.workingByName) || 'Lumio'} · {s.workingAt ? ago(s.workingAt, vi) : ''}
            </div>
          )}
        </div>
        {closing ? (
          <div>
            <input
              autoFocus value={note} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onPutAway(); if (e.key === 'Escape') onClose(); }}
              placeholder={T('Đã làm gì? — vd: dựng reel thứ 3', 'What was done? — e.g. Tuesday reel')}
              style={inp}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={onPutAway} disabled={busy} style={{ ...btn, flex: 1, background: '#6366f1', borderColor: '#6366f1', color: '#fff' }}>✓ {T('Cất đi', 'Put away')}</button>
              <button onClick={onClose} style={btn}>{T('Huỷ', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>{actions}</div>
        )}
      </div>
    </div>
  );
}

/** rt237: everything the shop sent on one card — the full text, every file, and a copy button. */
function DetailModal({ s, vi, onClose }: { s: TeamSuggestion; vi: boolean; onClose: () => void }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const text = [s.title, s.note ?? ''].filter(Boolean).join('\n\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the text is selectable */ }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={s.title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2,6,23,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: s.fromShop ? 'var(--ink-warn)' : 'var(--c64748b)' }}>
              {s.fromShop ? `📤 ${T('TIỆM TỰ GỬI', 'SENT BY SHOP')}` : T('TRẢ LỜI ĐỀ XUẤT', 'ANSWERS A REQUEST')} · {ago(s.doneAt ?? s.createdAt, vi)}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.4, marginTop: 4, overflowWrap: 'anywhere' }}>{s.title}</div>
          </div>
          <button onClick={onClose} aria-label={T('Đóng', 'Close')} style={{ ...btn, minWidth: 40 }}>✕</button>
        </div>
        {s.note && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{s.note}</div>}
        {s.media.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {s.media.map((m, i) => {
              const src = m.thumbUrl ?? (m.kind === 'image' ? m.url : null);
              return (
                <a key={i} href={m.driveUrl ?? m.url} target="_blank" rel="noopener noreferrer" style={{ position: 'relative', display: 'block', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: 'var(--c1e293b)' }}>
                  {src
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 26 }}>🎬</div>}
                  {m.kind === 'video' && <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: 24, color: '#fff' }}>▶</span>}
                </a>
              );
            })}
          </div>
        )}
        {(s.sourceUrl || s.refUrl) && (
          <a href={(s.sourceUrl || s.refUrl)!} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--ca5b4fc)', overflowWrap: 'anywhere' }}>🔗 {s.sourceLabel || T('Mở liên kết', 'Open the link')}</a>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void copy()} style={{ ...btn, flex: 1, minHeight: 40 }}>{copied ? T('Đã chép ✓', 'Copied ✓') : T('📋 Chép nội dung', '📋 Copy the text')}</button>
          <button onClick={onClose} style={{ ...btn, minHeight: 40 }}>{T('Đóng', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}

/** The first file, big; a count when there are more; a play mark for a clip. */
function Thumb({ media, vi, small }: { media: MediaItem[]; vi: boolean; small?: boolean }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const first = media[0];
  const size = small ? 56 : undefined;
  const box: React.CSSProperties = small
    ? { width: 56, height: 56, borderRadius: 7, flex: '0 0 auto', overflow: 'hidden', position: 'relative', background: 'var(--c1e293b)' }
    : { width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', position: 'relative', background: 'var(--c1e293b)' };
  if (!first) return <div style={box} />;
  const src = first.thumbUrl ?? (first.kind === 'image' ? first.url : null);
  return (
    <a href={first.driveUrl ?? first.url} target="_blank" rel="noopener noreferrer" style={{ ...box, display: 'block' }} title={T('Mở file gốc', 'Open the original')}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} width={size} height={size} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: small ? 18 : 30 }}>🎬</div>
      )}
      {first.kind === 'video' && (
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: small ? 16 : 28, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.6)' }}>▶</span>
      )}
      {media.length > 1 && (
        <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 11, fontWeight: 700, background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: 6, padding: '2px 6px' }}>+{media.length - 1}</span>
      )}
      {(first.driveFileId || first.driveUrl) && !small && (
        <span title={T('Đã ở Drive', 'On Drive')} style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 11, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 6, padding: '2px 5px' }}>📁</span>
      )}
    </a>
  );
}

function Pager({ page, pages, onPage, vi }: { page: number; pages: number; onPage: (p: number) => void; vi: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 10 }}>
      <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} style={btn}>‹</button>
      <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Trang' : 'Page'} {page + 1}/{pages}</span>
      <button onClick={() => onPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} style={btn}>›</button>
    </div>
  );
}

function ago(iso: string, vi: boolean): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return vi ? 'vừa gửi' : 'just now';
  if (h < 24) return vi ? `${h} giờ trước` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return vi ? `${d} ngày trước` : `${d}d ago`;
}

const btn: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)',
};
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--c1e293b)', border: '1px solid var(--c475569)',
  color: 'var(--ce2e8f0)', borderRadius: 7, padding: '7px 9px', fontSize: 12.5, fontFamily: 'inherit',
};
