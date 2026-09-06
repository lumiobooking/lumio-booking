'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLive, fresh } from '../lib/live';
import { apiFetch } from '../lib/api';

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
  token, vi, onCount, onMakePost,
}: {
  token: string | null;
  vi: boolean;
  onCount?: (n: number) => void;
  /** Open the composer with these files already attached (public addresses). */
  onMakePost: (s: TeamSuggestion) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [workPage, setWorkPage] = useState(0);
  const [donePage, setDonePage] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch<TeamFeed>(fresh('/content/suggestions/team'), { token }).catch(() => null);
    if (r) { setFeed(r); onCount?.(r.readyCount ?? 0); }
  }, [token, onCount]);
  useEffect(() => { load(); }, [load]);
  useLive(load, 45_000, Boolean(token));

  async function putAway(id: string) {
    if (!token) return;
    setBusy(id); setErr(null);
    try {
      await apiFetch(`/content/suggestions/${id}/used`, { method: 'POST', token, body: { note } });
      setClosing(null); setNote('');
      await load();
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

  return (
    <div style={{
      background: 'var(--c1e293b)', border: `1px solid ${feed.ready.length ? '#22c55e' : 'var(--c334155)'}`,
      borderRadius: 12, padding: 14, marginBottom: 14,
    }}>
      {/* ---- header ---- */}
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
          📨 {T('Tiệm đã gửi', 'From the shop')}
        </div>
        {feed.ready.length > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#14532d', border: '1px solid #22c55e', color: '#86efac' }}>
            {feed.ready.length} {T('mới nhận', 'new')}
          </span>
        )}
        {working.length > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(99,102,241,.15)', border: '1px solid #6366f1', color: 'var(--ca5b4fc)' }}>
            {working.length} {T('đang làm', 'in progress')}
          </span>
        )}
        {feed.driveFolderUrl && (
          <a href={feed.driveFolderUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--ca5b4fc)', textDecoration: 'none' }}>
            📁 {T('Folder Drive của tiệm', 'Shop’s Drive folder')} →
          </a>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 10 }}>
        {T('Đồ tiệm gửi là đồ thô. Mới nhận → bấm "Nhận làm" để ghi tên mình lên → dựng xong bấm ✓ ghi một dòng rồi cất. File gốc nằm trên Drive; "Dựng bài" chỉ chép bản sao sang kho đăng trong 1 tháng.',
           'What the shop sends is raw. New → "Take it" puts your name on it → when the post is made press ✓, note it, put it away. Originals live on Drive; "Make a post" stages a month-long copy on the hosting.')}
      </div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--cfca5a5)', marginBottom: 8 }}>{err}</div>}

      {/* ---- lane 1: received ---- */}
      {feed.ready.length > 0 && (
        <Lane title={T('MỚI NHẬN', 'RECEIVED')} count={feed.ready.length} color="#22c55e" vi={vi}>
          <Grid>
            {newL.slice.map((s) => (
              <Card key={s.id} s={s} vi={vi} border="#166534" me={me}
                closing={closing === s.id} note={note} setNote={setNote} busy={busy === s.id}
                onClose={() => { setClosing(null); setNote(''); }} onPutAway={() => putAway(s.id)}
                actions={(
                  <>
                    <button onClick={() => act(s.id, '/claim')} disabled={busy === s.id} style={{ ...btn, flex: 1, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 800 }}>
                      {busy === s.id ? '…' : `🙋 ${T('Nhận làm', 'Take it')}`}
                    </button>
                    <button onClick={() => makePost(s)} disabled={busy === s.id} title={T('Mở trình soạn với file đính sẵn', 'Open the composer with the files attached')} style={{ ...btn, background: '#22c55e', borderColor: '#22c55e', color: '#052e16', fontWeight: 800 }}>✎</button>
                    <button onClick={() => { setClosing(s.id); setNote(''); }} title={T('Không cần dựng — ghi một dòng rồi cất', 'Nothing to make — note it and put away')} style={btn}>✓</button>
                  </>
                )}
              />
            ))}
          </Grid>
          {newL.pages > 1 && <Pager page={newL.p} pages={newL.pages} onPage={setPage} vi={vi} />}
        </Lane>
      )}

      {/* ---- lane 2: in progress ---- */}
      {working.length > 0 && (
        <Lane title={T('ĐANG LÀM', 'IN PROGRESS')} count={working.length} color="#6366f1" vi={vi}>
          <Grid>
            {workL.slice.map((s) => (
              <Card key={s.id} s={s} vi={vi} border="#4338ca" me={me}
                closing={closing === s.id} note={note} setNote={setNote} busy={busy === s.id}
                onClose={() => { setClosing(null); setNote(''); }} onPutAway={() => putAway(s.id)}
                actions={(
                  <>
                    <button onClick={() => makePost(s)} disabled={busy === s.id} style={{ ...btn, flex: 1, background: '#22c55e', borderColor: '#22c55e', color: '#052e16', fontWeight: 800 }}>
                      {busy === s.id ? '…' : `✎ ${T('Dựng bài', 'Make a post')}`}
                    </button>
                    <button onClick={() => { setClosing(s.id); setNote(''); }} title={T('Xong — ghi một dòng rồi cất', 'Done — note it and put away')} style={{ ...btn, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 800 }}>✓ {T('Xong', 'Done')}</button>
                    <button onClick={() => act(s.id, '/release')} disabled={busy === s.id} title={T('Trả về Mới nhận', 'Back to received')} style={btn}>↩</button>
                  </>
                )}
              />
            ))}
          </Grid>
          {workL.pages > 1 && <Pager page={workL.p} pages={workL.pages} onPage={setWorkPage} vi={vi} />}
        </Lane>
      )}

      {/* ---- waiting on the shop ---- */}
      {!!feed.waitingOnShop.length && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', color: 'var(--c64748b)', marginBottom: 3 }}>
            {T('ĐANG CHỜ TIỆM', 'WAITING ON THE SHOP')} · {feed.waitingOnShop.length}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5, marginBottom: 6 }}>
            {T('Đề xuất team đã gửi mà tiệm chưa quay/chưa trả lời. Tiệm gửi file thì nó nhảy lên "Mới nhận"; tiệm bấm "Không hợp" thì xuống "Đã xử lý". Gửi nhầm thì ✕ thu hồi.',
               'Requests the team sent that the shop has not answered. When files arrive it moves to Received; a decline goes to Handled. Sent by mistake? ✕ withdraws it.')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {feed.waitingOnShop.map((s) => (
              <span key={s.id} title={s.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c94a3b8)', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, padding: '4px 6px 4px 9px', maxWidth: 320 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.refThumbUrl ? '▶ ' : ''}{s.title} <span style={{ color: 'var(--c475569)' }}>· {ago(s.createdAt, vi)}</span>
                </span>
                <button
                  onClick={() => { if (window.confirm(T(`Thu hồi đề xuất "${s.title}"? Tiệm sẽ không thấy nữa.`, `Withdraw "${s.title}"? The shop will no longer see it.`))) void act(s.id, '', 'DELETE'); }}
                  disabled={busy === s.id} title={T('Thu hồi', 'Withdraw')}
                  style={{ ...btn, padding: '1px 6px', fontSize: 11, color: 'var(--cf87171)', borderColor: 'transparent' }}
                >✕</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- handled: what was done with each, by whom ---- */}
      {done.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)' }}>
          <button onClick={() => setShowDone((v) => !v)} style={{ ...btn, border: 'none', padding: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', color: 'var(--c64748b)' }}>
            {showDone ? '▾' : '▸'} {T('ĐÃ XỬ LÝ', 'HANDLED')} · {done.length}
          </button>
          {showDone && (
            <>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginTop: 8 }}>
                {doneL.slice.map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 8, background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 9, padding: 8, opacity: 0.85 }}>
                    <Thumb media={s.media} vi={vi} small />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--ce2e8f0)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.title}</div>
                      <div style={{ fontSize: 11.5, color: s.status === 'skipped' ? '#fca5a5' : '#86efac', marginTop: 3, lineHeight: 1.4 }}>
                        {s.status === 'skipped' ? `✕ ${T('Tiệm từ chối', 'Shop declined')}` : `✓ ${s.usedNote || T('Đã dùng', 'Used')}`}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--c64748b)', marginTop: 2 }}>
                        {s.usedByName ? `${s.usedByName.split('@')[0]} · ` : ''}{ago(s.usedAt ?? s.doneAt ?? s.createdAt, vi)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {doneL.pages > 1 && <Pager page={doneL.p} pages={doneL.pages} onPage={setDonePage} vi={vi} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Lane({ title, count, color, vi, children }: { title: string; count: number; color: string; vi: boolean; children: React.ReactNode }) {
  void vi;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--c94a3b8)' }}>{title} · {count}</span>
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{children}</div>;
}

/** One card: the picture, the shop's words, who has it, and the lane's buttons. */
function Card({ s, vi, border, me, closing, note, setNote, busy, onClose, onPutAway, actions }: {
  s: TeamSuggestion; vi: boolean; border: string; me: (n: string | null | undefined) => string;
  closing: boolean; note: string; setNote: (v: string) => void; busy: boolean;
  onClose: () => void; onPutAway: () => void; actions: React.ReactNode;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  return (
    <div style={{ background: 'var(--c0f172a)', border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Thumb media={s.media} vi={vi} />
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: s.fromShop ? '#fde68a' : 'var(--c64748b)' }}>
            {s.fromShop ? `📤 ${T('TIỆM TỰ GỬI', 'SENT BY SHOP')}` : T('TRẢ LỜI ĐỀ XUẤT', 'ANSWERS A REQUEST')}
            <span style={{ fontWeight: 500, color: 'var(--c64748b)' }}> · {ago(s.doneAt ?? s.createdAt, vi)}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.4, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.title}</div>
          {s.note && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.note}</div>}
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

/** The first file, big; a count when there are more; a play mark for a clip. */
function Thumb({ media, vi, small }: { media: MediaItem[]; vi: boolean; small?: boolean }) {
  const T = (v: string, e: string) => (vi ? v : e);
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
        <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 11, fontWeight: 800, background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: 6, padding: '2px 6px' }}>+{media.length - 1}</span>
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
