'use client';

/**
 * THE PLAN LINK: /plan/{token}, no login (12/11/2026).
 *
 * The team used to export the month to a Google Sheet for a salon to read and
 * approve. This is that sheet, live: the month the team sees, in the four
 * words a client needs (waiting, approved, being revised, posted). A laptop
 * gets the month grid with the post opening beside it; a phone gets the posts
 * that need a yes first, each with its two buttons, then the rest by day.
 *
 * Read and decide only. The client can approve, or say what to change — the
 * same two routes the old review link had (api public-review.controller).
 * Nothing here edits, moves or deletes a post, and the token resolves to one
 * salon or to nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../lib/responsive';
import { ind } from '../lib/ui-industry';
import { byDayOf, countsOf, dayKeyIn, monthCells, openingMonth, shiftYm, type PlanStatus } from '../lib/plan-link';
import { NAME_KEY, PostReviewDetail, PostThumb, type ReviewApi, type ReviewFeed, type ReviewPost } from './PostReview';

const TONE: Record<PlanStatus, { bar: string; ink: string; wash: string; vi: string; en: string }> = {
  wait: { bar: '#8b5cf6', ink: 'var(--ca5b4fc)', wash: 'rgba(139,92,246,.14)', vi: 'Chờ duyệt', en: 'Awaiting approval' },
  approved: { bar: '#22c55e', ink: 'var(--ink-good)', wash: 'rgba(34,197,94,.12)', vi: 'Đã duyệt', en: 'Approved' },
  held: { bar: '#f97316', ink: 'var(--ink-warn)', wash: 'rgba(249,115,22,.12)', vi: 'Đang sửa theo góp ý', en: 'Being revised' },
  posted: { bar: 'var(--c475569)', ink: 'var(--c94a3b8)', wash: 'transparent', vi: 'Đã đăng', en: 'Posted' },
};
const NET: Record<string, { s: string; c: string }> = {
  facebook: { s: 'FB', c: '#1877f2' }, instagram: { s: 'IG', c: '#e1306c' }, google: { s: 'GG', c: '#34a853' }, tiktok: { s: 'TT', c: '#0e9aa7' },
};

function Nets({ channels }: { channels: string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>
      {channels.map((c) => (
        <span key={c} style={{ fontSize: 9.5, fontWeight: 800, color: NET[c]?.c ?? 'var(--c94a3b8)', border: `1px solid ${NET[c]?.c ?? 'var(--c475569)'}`, borderRadius: 4, padding: '0 3px', lineHeight: '14px' }}>{NET[c]?.s ?? c.slice(0, 2).toUpperCase()}</span>
      ))}
    </span>
  );
}

/** The first line of the caption, as the card's title. */
const titleOf = (p: ReviewPost) => (p.message.split('\n').find((l) => l.trim()) ?? '').trim();

export function PlanLinkView({ api, vi }: { api: ReviewApi; vi: boolean }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const phone = useIsMobile(820);
  const [feed, setFeed] = useState<ReviewFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ym, setYm] = useState<string | null>(null);
  const [tab, setTab] = useState<'need' | 'all' | 'posted'>('need');
  /** Asking who is approving: once per device, then remembered. */
  const [ask, setAsk] = useState<null | { run: (name: string) => void }>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setFeed(await api.feed()); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const tz = feed?.timezone;
  const locale = vi ? 'vi-VN' : 'en-US';
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'numeric', ...(tz ? { timeZone: tz } : {}) });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });

  const posts = useMemo(() => feed?.posts ?? [], [feed]);
  const counts = useMemo(() => countsOf(posts), [posts]);
  const byDay = useMemo(() => byDayOf(posts, tz), [posts, tz]);
  const month = ym ?? (feed ? openingMonth(posts, tz) : null);
  const today = dayKeyIn(new Date(), tz);
  const waiting = useMemo(() => posts.filter((p) => p.clientStatus === 'wait').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), [posts]);
  const open = posts.find((p) => p.id === openId) ?? null;

  const withName = (run: (name: string) => void) => {
    let n = '';
    try { n = window.localStorage.getItem(NAME_KEY) || ''; } catch { /* asked below */ }
    if (n.trim()) run(n.trim()); else { setNameDraft(''); setAsk({ run }); }
  };
  const approve = (ids: string[], key: string) => withName(async (name) => {
    setBusy(key); setNote(null);
    let failed = 0;
    for (const id of ids) { try { await api.approve(id, name); } catch { failed++; } }
    setBusy(null); setArmed(false);
    setNote(failed
      ? T(`${failed} bài chưa duyệt được, thử lại giúp em.`, `${failed} could not be approved — please try again.`)
      : T(ids.length > 1 ? `Đã duyệt ${ids.length} bài. Cảm ơn ${name}!` : `Đã duyệt. Cảm ơn ${name}!`, ids.length > 1 ? `${ids.length} posts approved. Thank you, ${name}!` : `Approved. Thank you, ${name}!`));
    void load();
  });

  if (err) {
    return (
      <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--c94a3b8)' }}>
        <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>{err}</div>
      </div>
    );
  }
  if (!feed || !month) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--c64748b)' }}>{T('Đang tải…', 'Loading…')}</div>;

  const [yy, mm] = month.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(yy, mm - 1, 15)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const chip = (n: number, s: PlanStatus, label: string) => n > 0 && (
    <span style={{ fontSize: 12.5, fontWeight: 700, color: TONE[s].ink, background: TONE[s].wash, border: `1px solid ${TONE[s].bar}`, borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap' }}>{n} {label}</span>
  );
  const approveAllBtn = waiting.length > 1 && (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => { if (!armed) { setArmed(true); return; } approve(waiting.map((p) => p.id), 'all'); }}
      style={{ ...BTN, background: armed ? '#15803d' : '#16a34a', color: '#fff', border: 'none', width: phone ? '100%' : undefined, opacity: busy ? 0.6 : 1 }}
    >
      {busy === 'all' ? T('Đang duyệt…', 'Approving…')
        : armed ? T(`Bấm lần nữa để duyệt cả ${waiting.length} bài`, `Tap again to approve all ${waiting.length}`)
          : `✓ ${T(`Duyệt cả ${waiting.length} bài`, `Approve all ${waiting.length}`)}`}
    </button>
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: 'auto' }}>
        <h1 style={{ fontSize: phone ? 17 : 19, margin: 0 }}>{feed.salonName} — {T('Kế hoạch bài đăng', 'Content plan')}</h1>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>
          {T('Bấm vào một bài để xem trước và duyệt. Không cần đăng nhập.', 'Tap a post to preview and approve it. No login needed.')}
        </span>
      </div>
      {!phone && chip(counts.wait, 'wait', T('chờ duyệt', 'awaiting approval'))}
      {!phone && chip(counts.approved, 'approved', T('đã duyệt', 'approved'))}
      {!phone && chip(counts.held, 'held', T('đang sửa', 'being revised'))}
      {!phone && chip(counts.posted, 'posted', T('đã đăng', 'posted'))}
      {!phone && approveAllBtn}
    </div>
  );

  const card = (p: ReviewPost) => {
    const t = TONE[p.clientStatus];
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setOpenId(p.id)}
        style={{
          font: 'inherit', textAlign: 'left', cursor: 'pointer', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2,
          padding: '5px 6px', borderRadius: 8, color: 'inherit',
          background: p.clientStatus === 'posted' ? 'transparent' : t.wash,
          border: '1px solid var(--c334155)', borderLeft: `4px solid ${t.bar}`,
          boxShadow: openId === p.id ? `0 0 0 2px ${t.bar}` : undefined,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtTime(p.scheduledAt)}</span>
          <Nets channels={p.channels} />
        </span>
        <span style={{ fontSize: 11, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{titleOf(p) || T('(bài ảnh / video)', '(photo / video post)')}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.ink }}>{vi ? t.vi : t.en}</span>
      </button>
    );
  };

  const grid = (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <button type="button" onClick={() => setYm(shiftYm(month, -1))} aria-label={T('Tháng trước', 'Previous month')} style={NAV}>‹</button>
        <b style={{ fontSize: 15, minWidth: 150, textAlign: 'center' }}>{monthLabel}</b>
        <button type="button" onClick={() => setYm(shiftYm(month, 1))} aria-label={T('Tháng sau', 'Next month')} style={NAV}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
        {(vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d) => (
          <div key={d} style={{ fontSize: 11.5, color: 'var(--c64748b)', textAlign: 'center', fontWeight: 600 }}>{d}</div>
        ))}
        {monthCells(month).map((k, i) => (k === null
          ? <div key={`x${i}`} style={{ minHeight: 104, borderRadius: 10, background: 'var(--c111827)', opacity: 0.45 }} />
          : (
            <div key={k} style={{ minHeight: 104, minWidth: 0, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--c151f38)', border: k === today ? '1.5px solid #6366f1' : '1px solid var(--c1f2937)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: k === today ? 'var(--ca5b4fc)' : 'var(--c94a3b8)' }}>{Number(k.slice(8))}</span>
              {(byDay.get(k) ?? []).map(card)}
            </div>
          )))}
      </div>
    </div>
  );

  const row = (p: ReviewPost, buttons: boolean) => {
    const t = TONE[p.clientStatus];
    return (
      <div key={p.id} style={{ background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderLeft: `4px solid ${t.bar}`, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => setOpenId(p.id)} style={{ font: 'inherit', color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <PostThumb media={p.media} w={54} h={54} vi={vi} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{fmtDay(p.scheduledAt)} · {fmtTime(p.scheduledAt)}</span>
            <b style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleOf(p) || T('(bài ảnh / video)', '(photo / video post)')}</b>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Nets channels={p.channels} /><span style={{ fontSize: 11, fontWeight: 700, color: t.ink }}>{vi ? t.vi : t.en}</span></span>
          </span>
        </button>
        {buttons && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy !== null} onClick={() => approve([p.id], p.id)} style={{ ...BTN, flex: 1, background: '#16a34a', color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}>
              {busy === p.id ? '…' : `✓ ${T('Duyệt', 'Approve')}`}
            </button>
            <button type="button" onClick={() => setOpenId(p.id)} style={{ ...BTN, flex: 1, background: 'transparent', color: 'var(--ink-bad)', border: '1.5px solid var(--ink-bad)' }}>
              ✎ {T('Cần sửa', 'Needs a change')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const upcoming = posts.filter((p) => p.clientStatus !== 'posted' && p.clientStatus !== 'wait').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const posted = posts.filter((p) => p.clientStatus === 'posted').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const tabBtn = (k: typeof tab, label: string) => (
    <button key={k} type="button" onClick={() => setTab(k)} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '7px 12px', minHeight: 36, border: 'none', background: tab === k ? '#7c3aed' : 'var(--c1e293b)', color: tab === k ? '#fff' : 'var(--ccbd5e1)' }}>{label}</button>
  );
  const list = (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabBtn('need', `${T('Chờ duyệt', 'To approve')} ${counts.wait}`)}
        {tabBtn('all', T('Sắp đăng', 'Coming up'))}
        {tabBtn('posted', `${T('Đã đăng', 'Posted')} ${counts.posted}`)}
      </div>
      {tab === 'need' && (
        <>
          {waiting.length === 0 && <div style={EMPTY}>{T('Không còn bài nào chờ duyệt. Cảm ơn anh/chị!', 'Nothing is waiting for your approval. Thank you!')}</div>}
          {waiting.map((p) => row(p, true))}
          {approveAllBtn}
          {upcoming.length > 0 && <div style={SECTION}>{T('SẮP ĐĂNG', 'COMING UP')}</div>}
          {upcoming.map((p) => row(p, false))}
        </>
      )}
      {tab === 'all' && (
        <>
          {[...waiting, ...upcoming].length === 0 && <div style={EMPTY}>{T('Chưa có bài nào sắp đăng.', 'Nothing scheduled yet.')}</div>}
          {[...waiting, ...upcoming].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).map((p) => row(p, p.clientStatus === 'wait'))}
        </>
      )}
      {tab === 'posted' && (
        <>
          {posted.length === 0 && <div style={EMPTY}>{T('Chưa có bài nào đăng trong 30 ngày qua.', 'Nothing posted in the last 30 days.')}</div>}
          {posted.map((p) => row(p, false))}
        </>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: phone ? 640 : 1320, margin: '0 auto', padding: '0 0 40px' }}>
      {header}
      {note && <div role="status" style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 10, fontSize: 13.5, background: 'var(--c151f38)', border: '1px solid var(--c334155)' }}>{note}</div>}
      {phone ? list : grid}

      {open && (
        <>
          {!phone && <div onClick={() => setOpenId(null)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(2,6,23,.45)' }} />}
          <PostReviewDetail
            key={open.id}
            p={open}
            feedMeta={{ pageName: feed.pageName, igUsername: feed.igUsername, salonName: feed.salonName }}
            api={api}
            vi={vi}
            fmtDay={fmtDay}
            fmtTime={fmtTime}
            variant={phone ? 'sheet' : 'drawer'}
            onClose={() => setOpenId(null)}
            onChanged={load}
          />
        </>
      )}

      {ask && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(2,6,23,.6)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = nameDraft.trim();
              if (!n) return;
              try { window.localStorage.setItem(NAME_KEY, n); } catch { /* this session only */ }
              const run = ask.run; setAsk(null); run(n);
            }}
            style={{ width: '100%', maxWidth: 360, background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <label htmlFor="plan-approver" style={{ fontSize: 15, fontWeight: 700 }}>{T('Tên người duyệt', 'Who is approving?')}</label>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{T('Chỉ hỏi một lần trên máy này, để đội Lumio biết ai đã duyệt.', 'Asked once on this device, so the team knows who approved.')}</span>
            <input id="plan-approver" autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={60} placeholder={T('VD: Chị Hằng', 'e.g. Hannah')}
              style={{ font: 'inherit', fontSize: 16, minHeight: 44, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', padding: '0 12px' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setAsk(null); setArmed(false); }} style={{ ...BTN, flex: 1, background: 'transparent', color: 'var(--c94a3b8)', border: '1px solid var(--c334155)' }}>{T('Thôi', 'Cancel')}</button>
              <button type="submit" disabled={!nameDraft.trim()} style={{ ...BTN, flex: 1, background: '#16a34a', color: '#fff', border: 'none', opacity: nameDraft.trim() ? 1 : 0.5 }}>{T('Duyệt', 'Approve')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const BTN: React.CSSProperties = { fontFamily: 'inherit', cursor: 'pointer', borderRadius: 12, fontSize: 14, fontWeight: 800, minHeight: 44, padding: '0 14px', boxSizing: 'border-box' };
const NAV: React.CSSProperties = { font: 'inherit', cursor: 'pointer', minWidth: 36, minHeight: 36, borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c151f38)', color: 'var(--ce2e8f0)' };
const EMPTY: React.CSSProperties = { padding: '28px 16px', textAlign: 'center', color: 'var(--c94a3b8)', background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 12, marginBottom: 10, fontSize: 13.5 };
const SECTION: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: 'var(--c64748b)', margin: '16px 2px 8px' };
