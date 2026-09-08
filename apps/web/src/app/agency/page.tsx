'use client';

// ---------------------------------------------------------------------------
// Lumio setup staff home. One SUPPORT login sees ONLY this: a searchable list
// of salon names. Picking one mints an 8-hour salon-scoped session (audited
// server-side) and drops the employee into that salon's dashboard with the
// platform-managed setup screens unlocked. "Leave salon" on the banner brings
// them back here.
//
// The support account's own token is parked in localStorage while the salon
// session is active, and restored on leave — so leaving never needs a re-login.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { fresh } from '../../lib/live';
import { groupInbox, groupSummary, type InboxItem } from '../../lib/inbox-groups';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}
/** One thing a shop sent that nobody has made a post from yet. */
type InboxRow = InboxItem;

/** The salon list as one employee reads it: their team open, the rest folded. */
interface BoardGroup { team: string; label: string; mine: boolean; open: boolean; newCount?: number; salons: { id: string; name: string; supportTeam?: string | null; isNew?: boolean }[] }
interface Board { myTeam: string | null; canAssign?: boolean; groups: BoardGroup[]; teams: { team: string; label: string; salons: number; members: string[] }[] }

/** "3 phút trước" — the freshness is the point of the list. */
function ago(iso: string | null): string {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hôm qua' : `${d} ngày trước`;
}

/**
 * Above this many new salons in one view, the MỚI tag stops being a signal.
 *
 * A badge on half the rows is not a badge, it is a texture — the eye stops
 * seeing it exactly when there is most to see. Past the threshold the tags
 * come off the rows and become one line at the top that filters the list,
 * which is both quieter and more useful: you can act on it.
 */
const NEW_TAGS_MAX = 8;

/** '*' is every salon; '' is the ones nobody has claimed; anything else is a team. */
const ALL = '*';

const cssFor = `
.ag-cols { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 16px; align-items: start; }
.ag-side { display: flex; flex-direction: column; gap: 6px; position: sticky; top: 16px; }
.ag-side-lbl { font-size: 10.5px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: var(--c64748b); padding: 0 4px 4px; }
.ag-row:hover { background: var(--c162032) !important; }
@media (max-width: 880px) {
  .ag-cols { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .ag-side { flex-direction: row; overflow-x: auto; position: static; padding-bottom: 4px; scrollbar-width: none; }
  .ag-side::-webkit-scrollbar { display: none; }
  /* The items carry width:100% for the column; on a phone they have to shrink
     to their own content or the first chip eats the row and the other teams
     are off-screen with nothing to say they exist. */
  .ag-side > * { flex: 0 0 auto; width: auto !important; }
  .ag-side-lbl { display: none; }
  .ag-side-members { display: none; }
}
`;

export default function AgencyPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [allSalons, setAllSalons] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const groups = useMemo(() => groupInbox(inbox), [inbox]);
  // Which salons arrived this week, as the API judged it. Searching cuts
  // across the groups, so the badge has to survive the search too.
  const newIds = useMemo(
    () => new Set((board?.groups ?? []).flatMap((g) => g.salons.filter((x) => x.isNew).map((x) => x.id))),
    [board],
  );
  /** Which team's list is on screen. Null until the board says which is mine. */
  const [pick, setPick] = useState<string | null>(null);
  const [newOnly, setNewOnly] = useState(false);
  /** Bulk mode: the tick boxes are showing, and these are the salons ticked. */
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user || (user.role !== 'SUPPORT' && user.role !== 'SUPER_ADMIN')) {
      router.replace('/login');
      return;
    }
    if (!token) return;
    apiFetch<TenantRow[]>('/support/tenants', { token })
      .then((r) => setRows(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load salons'))
      .finally(() => setLoading(false));
    // How this employee's list is grouped. Separate from the salon rows so a
    // slow group read never delays the list itself.
    apiFetch<Board>('/support/board', { token }).then(setBoard).catch(() => undefined);
    // What is waiting, across every salon. Refreshed each minute while the
    // picker is open — this is the screen somebody leaves up on a second
    // monitor, and it has to be right when they glance at it.
    const pull = () => apiFetch<InboxRow[]>(fresh('/support/inbox'), { token }).then(setInbox).catch(() => undefined);
    pull();
    const t = setInterval(pull, 60_000);
    return () => clearInterval(t);
  }, [ready, user, token, router]);

  // An employee lands on their own list; the owner, who has no team, lands on
  // all of them. Only ever set once — after that the choice is the viewer's.
  useEffect(() => {
    if (!board || pick !== null) return;
    setPick(board.myTeam && board.groups.some((g) => g.team === board.myTeam) ? board.myTeam : ALL);
  }, [board, pick]);

  // The browser tab says it too, so a staff member on another page notices.
  useEffect(() => {
    document.title = inbox.length ? `(${inbox.length}) Tiệm vừa gửi · Lumio Support` : 'Lumio Support';
  }, [inbox.length]);

  /**
   * The salons actually on screen.
   *
   * A search cuts across every team, because somebody looking for a name does
   * not care whose list it is on. Otherwise it is the chosen team's list, in
   * the order the server put it in — this week's arrivals, then the alphabet.
   */
  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return rows.filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(needle));
    let out: TenantRow[];
    if (!board || pick === null || pick === ALL) {
      out = [...rows].sort((a, b) =>
        (newIds.has(b.id) ? 1 : 0) - (newIds.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
    } else {
      const byId = new Map(rows.map((r) => [r.id, r]));
      out = (board.groups.find((g) => g.team === pick)?.salons ?? [])
        .map((sg) => byId.get(sg.id))
        .filter((t): t is TenantRow => Boolean(t));
    }
    return newOnly ? out.filter((t) => newIds.has(t.id)) : out;
  }, [rows, board, pick, q, newOnly, newIds]);

  /** How many of the salons on screen arrived this week. Decides the tags. */
  const newHere = useMemo(() => listed.filter((t) => newIds.has(t.id)).length, [listed, newIds]);
  const tagRows = newHere > 0 && newHere <= NEW_TAGS_MAX;

  /** Which team each salon is on, for the chip at the end of a row. */
  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of board?.groups ?? []) for (const sg of g.salons) m.set(sg.id, g.team);
    return m;
  }, [board]);

  /** The sidebar: every team plus the two views that are not teams. */
  const sideItems = useMemo(() => {
    const gs = board?.groups ?? [];
    const teams = gs.filter((g) => g.team).map((g) => ({
      key: g.team, label: g.label, count: g.salons.length, fresh: g.newCount ?? 0,
      mine: g.mine, members: board?.teams.find((t) => t.team === g.team)?.members ?? [],
    }));
    const none = gs.find((g) => !g.team);
    return {
      teams,
      unassigned: { key: '', label: 'Chưa giao', count: none?.salons.length ?? 0, fresh: none?.newCount ?? 0 },
      all: { key: ALL, label: 'Tất cả', count: rows.length, fresh: newIds.size },
    };
  }, [board, rows.length, newIds]);

  const toggleChosen = (id: string) => setChosen((c) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /**
   * Move a salon onto a team. Refused by the server for anyone but the owner
   * and full-level accounts, so the button is offered to everyone and the
   * rule is stated once, where it is enforced.
   */
  async function setTeam(tenantId: string, team: string) {
    if (!token) return;
    setError(null);
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(tenantId)}/team`, { method: 'POST', token, body: { team } });
      const b = await apiFetch<Board>('/support/board', { token });
      setBoard(b);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đổi được nhóm');
    }
  }

  /**
   * File everything ticked, in one call.
   *
   * The confirmation matters more here than on a single move: twelve salons
   * just left the list you were looking at, and without a count you cannot
   * tell that from a page that silently lost them.
   */
  async function assignMany(team: string) {
    if (!token || !chosen.size || assigning) return;
    setAssigning(true); setError(null); setNote(null);
    try {
      const r = await apiFetch<{ count: number }>('/support/tenants/team', {
        method: 'POST', token, body: { ids: [...chosen], team },
      });
      const b = await apiFetch<Board>('/support/board', { token });
      setBoard(b);
      setChosen(new Set());
      setPicking(false);
      setNote(`Đã giao ${r.count} tiệm cho ${team || '“chưa phân nhóm”'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không giao được nhóm');
    } finally {
      setAssigning(false);
    }
  }

  async function enter(t: TenantRow, landing = '/salon') {
    if (!token || busy) return;
    setBusy(t.id); setError(null);
    try {
      const r = await apiFetch<{
        accessToken: string;
        tenant: { id: string; name: string; slug: string };
        level?: string;
        capabilities?: string[];
      }>(
        `/support/enter/${t.id}`, { method: 'POST', token, body: {} },
      );
      // Park the support login, activate the salon session. The session user
      // borrows SALON_ADMIN so the salon dashboard works untouched; the
      // supportSession flag drives the banner and unlocks hidden screens.
      //
      // The capability list is the employee's LEVEL, resolved by the server.
      // It goes on the session because the menu has to draw the right shape on
      // the first paint — but it is only a drawing instruction: the same level
      // is inside the token, and every request is checked against that copy,
      // so editing this one in a browser console buys nothing.
      const session = {
        accessToken: r.accessToken,
        user: {
          id: user!.id,
          email: user!.email,
          role: 'SALON_ADMIN' as const,
          tenantId: r.tenant.id,
          firstName: user!.firstName || 'Lumio',
          lastName: 'Support',
          supportSession: true,
          tenantName: r.tenant.name,
          supportLevel: r.level,
          capabilities: r.capabilities,
        },
      };
      try {
        const home = localStorage.getItem('lumio_auth');
        if (home) localStorage.setItem('lumio_agency_home', home);
        localStorage.setItem('lumio_auth', JSON.stringify(session));
        localStorage.removeItem('lumio_active_branch');
      } catch { /* private mode: fall through, the assign below will 401 → login */ }
      window.location.assign(landing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter this salon');
      setBusy(null);
    }
  }

  if (!ready || loading) {
    return <main style={screen}><div style={{ color: 'var(--c94a3b8)' }}>Loading…</div></main>;
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--ce2e8f0)', padding: '28px 16px' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', paddingBottom: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>🛠 Lumio Support</h1>
          <button onClick={() => { logout(); router.replace('/login'); }}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: '0 0 12px' }}>
          Pick a salon to set it up. Each visit opens an 8-hour working session and is logged.
        </p>

        {/* The bench comes before the salon list: two people running thirty
            clients answer "what now" far more often than "open which salon". */}
        <a
          href="/agency/today"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
            border: '1.5px solid #6366f1', background: 'rgba(99,102,241,.10)', borderRadius: 14,
            padding: '13px 16px', marginBottom: 14, color: 'var(--ce2e8f0)',
          }}
        >
          <span style={{ fontSize: 20 }}>🛠</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Việc hôm nay — mọi tiệm, gộp theo loại</div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 1 }}>
              Đăng bài, story, ưu đãi, hồ sơ Google… của tất cả khách trong một hàng đợi. Nhận việc, thấy ai đang làm gì.
            </div>
          </div>
          <span style={{ marginLeft: 'auto', color: '#a5b4fc', fontWeight: 800, fontSize: 14 }}>Mở →</span>
        </a>

        {error && <div style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{error}</div>}
        {note && (
          <div style={{ background: 'rgba(34,197,94,.12)', border: '1px solid #22c55e', color: '#bbf7d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14, display: 'flex', gap: 10 }}>
            <span>{note}</span>
            <button onClick={() => setNote(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#86efac', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        )}

        {/* ---- what the shops sent, across every salon ----
             The one list that stops a clip sent at 11pm from being found on
             Thursday. One LINE per salon, not a card per thing: with a few
             hundred salons the list has to stay a glance — which salons, how
             much, how fresh — and the things themselves are handled on that
             salon's own inbox, one tap away. Newest first; a handful shown,
             the rest behind one tap. */}
        <section style={{
          border: `1.5px solid ${inbox.length ? '#f59e0b' : 'var(--c1f2937)'}`, borderRadius: 14, padding: '12px 14px', marginBottom: 18,
          background: inbox.length ? 'rgba(245,158,11,.06)' : 'var(--c111827)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: inbox.length ? 8 : 0 }}>
            <span style={{ fontSize: 18 }}>📥</span>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              Tiệm vừa gửi
              {inbox.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, background: '#f59e0b', color: '#1c1917', borderRadius: 999, padding: '1px 8px' }}>{inbox.length}</span>
              )}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c64748b)', textAlign: 'right' }}>
              {inbox.length
                ? `${groups.length} tiệm · ${inbox.filter((r) => !r.working).length} mới · ${inbox.filter((r) => r.working).length} đang làm`
                : 'Không có gì đang chờ — mọi thứ tiệm gửi đã được xử lý.'}
            </span>
          </div>
          {inbox.length > 0 && (
            <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 10, overflow: 'hidden', background: 'var(--c0f172a)' }}>
              {(allSalons ? groups : groups.slice(0, 6)).map((g, i) => {
                const opening = busy === g.tenantId;
                return (
                  <div
                    key={g.tenantId}
                    role="button"
                    tabIndex={0}
                    onClick={() => { const t = rows.find((x) => x.id === g.tenantId); if (t && !opening) enter(t, '/salon/content?tab=queue'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { const t = rows.find((x) => x.id === g.tenantId); if (t && !opening) enter(t, '/salon/content?tab=queue'); } }}
                    style={{
                      display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 10, alignItems: 'center',
                      padding: '8px 12px', borderTop: i ? '1px solid var(--c1f2937)' : 'none', cursor: 'pointer',
                      opacity: opening ? 0.5 : 1,
                    }}
                  >
                    {/* The one glyph: a dot that says "untouched" or "someone is on it". */}
                    <span title={g.fresh ? 'Chưa ai mở' : 'Đang có người làm'} style={{
                      width: 9, height: 9, borderRadius: 999, background: g.fresh ? '#22c55e' : '#a5b4fc',
                      boxShadow: g.fresh ? '0 0 0 3px rgba(34,197,94,.18)' : 'none',
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.salon}</span>
                        <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700, whiteSpace: 'nowrap' }}>{groupSummary(g)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                        {g.fromShop ? '📤 ' : ''}{g.headline}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{ago(g.latest)}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{opening ? '…' : 'Mở →'}</span>
                    </div>
                  </div>
                );
              })}
              {groups.length > 6 && (
                <button
                  onClick={() => setAllSalons((v) => !v)}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderTop: '1px solid var(--c1f2937)', color: '#fbbf24', padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {allSalons ? 'Thu gọn ↑' : `Xem thêm ${groups.length - 6} tiệm ↓`}
                </button>
              )}
            </div>
          )}
        </section>

        <style dangerouslySetInnerHTML={{ __html: cssFor }} />

        {/* ---- the groups, and then the salons ----
             The teams live in their own column so they can never be pushed
             off the screen by the pile of salons nobody has claimed yet. That
             pile IS the longest list on this page, and it was burying the two
             lists people came here to read. On a phone the column lies down
             into a row of chips that scrolls sideways — same idea, one line. */}
        <div className="ag-cols">
          <aside className="ag-side">
            <div className="ag-side-lbl">Nhóm phụ trách</div>
            <SideItem item={sideItems.all} active={pick === ALL} onClick={() => { setPick(ALL); setNewOnly(false); }} />
            {sideItems.teams.map((it) => (
              <SideItem key={it.key} item={it} active={pick === it.key} onClick={() => { setPick(it.key); setNewOnly(false); }} />
            ))}
            <SideItem
              item={sideItems.unassigned}
              tone="warn"
              active={pick === ''}
              onClick={() => { setPick(''); setNewOnly(false); }}
            />
          </aside>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm tiệm theo tên…"
                autoFocus
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 10, padding: '11px 14px', fontSize: 15 }}
              />
              {board?.canAssign && (
                <button
                  onClick={() => { setPicking((v) => !v); setChosen(new Set()); }}
                  style={{
                    background: picking ? '#6366f1' : 'transparent', color: picking ? '#fff' : 'var(--c94a3b8)',
                    border: `1px solid ${picking ? '#6366f1' : 'var(--c334155)'}`, borderRadius: 10,
                    padding: '0 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >{picking ? '✕ Thoát' : '☑ Chọn nhiều'}</button>
              )}
            </div>

            {/* Too many arrivals to tag one by one: one line that filters. */}
            {!q.trim() && newHere > NEW_TAGS_MAX && (
              <button
                onClick={() => setNewOnly((v) => !v)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 10,
                  background: newOnly ? 'rgba(34,197,94,.14)' : 'var(--c111827)',
                  border: `1px solid ${newOnly ? '#22c55e' : 'var(--c1f2937)'}`, borderRadius: 10,
                  padding: '9px 13px', color: 'var(--ce2e8f0)', fontSize: 13,
                }}
              >
                <span style={{ color: '#4ade80', fontWeight: 800 }}>{newHere} tiệm mới</span> trong tuần này
                <span style={{ float: 'right', color: newOnly ? '#4ade80' : 'var(--c64748b)', fontWeight: 700 }}>
                  {newOnly ? 'Bỏ lọc ✕' : 'Chỉ xem các tiệm mới →'}
                </span>
              </button>
            )}

            {q.trim() && (
              <div style={{ fontSize: 12.5, color: 'var(--c64748b)', marginBottom: 8 }}>
                Đang tìm trong tất cả các nhóm — {listed.length} tiệm khớp.
              </div>
            )}

            <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
              {listed.length === 0 && (
                <div style={{ padding: 18, color: 'var(--c64748b)', fontSize: 14 }}>
                  {q.trim() ? 'Không có tiệm nào khớp.' : 'Nhóm này chưa có tiệm nào.'}
                </div>
              )}
              {listed.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  fresh={tagRows && newIds.has(t.id)}
                  team={teamOf.get(t.id) ?? ''}
                  showTeam={pick === ALL || Boolean(q.trim())}
                  canAssign={Boolean(board?.canAssign)}
                  teams={board?.teams ?? []}
                  picking={picking}
                  checked={chosen.has(t.id)}
                  onCheck={() => toggleChosen(t.id)}
                  busy={busy}
                  onEnter={enter}
                  editing={editing}
                  setEditing={setEditing}
                  onTeam={setTeam}
                />
              ))}
            </div>

            {picking && listed.length > 0 && (
              <button
                onClick={() => setChosen((c) => c.size === listed.length ? new Set() : new Set(listed.map((t) => t.id)))}
                style={{ background: 'transparent', border: 'none', color: '#a5b4fc', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '10px 2px' }}
              >
                {chosen.size === listed.length ? 'Bỏ chọn tất cả' : `Chọn cả ${listed.length} tiệm đang hiện`}
              </button>
            )}
          </div>
        </div>

        {/* ---- what happens to everything ticked ----
             Anchored to the bottom of the window, because the list it acts on
             is longer than the screen: a bar that scrolls away is a bar you
             have to scroll back to before you can finish. */}
        {picking && chosen.size > 0 && (
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
            background: 'var(--c111827)', borderTop: '1.5px solid #6366f1',
            boxShadow: '0 -8px 24px rgba(0,0,0,.45)', padding: '11px 16px',
          }}>
            <div style={{ maxWidth: 1060, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>Đã chọn {chosen.size} tiệm</span>
              <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>Giao cho:</span>
              <select
                value=""
                disabled={assigning}
                onChange={(e) => { if (e.target.value) assignMany(e.target.value === '_none' ? '' : e.target.value); }}
                style={{ background: 'var(--c0f172a)', border: '1px solid #6366f1', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontWeight: 700 }}
              >
                <option value="">— chọn nhóm —</option>
                {(board?.teams ?? []).filter((x) => x.team).map((x) => <option key={x.team} value={x.team}>{x.team}</option>)}
                <option value="_none">Bỏ khỏi nhóm</option>
              </select>
              {assigning && <span style={{ fontSize: 13, color: '#a5b4fc' }}>Đang giao…</span>}
              <button
                onClick={() => setChosen(new Set())}
                style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '7px 13px', fontSize: 13, cursor: 'pointer' }}
              >Bỏ chọn</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const screen: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c0b1120)' };

/**
 * A salon that arrived this week.
 *
 * The API decides what "this week" means (see support-teams) and sends the
 * flag; the screen only draws it. One place to change the window, and search
 * results and the grouped list can never disagree about which salons are new.
 */
function NewTag() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, background: '#22c55e', color: '#052e16',
      borderRadius: 999, padding: '2px 7px', marginRight: 7, verticalAlign: 2,
    }}>MỚI</span>
  );
}

/**
 * One line in the left column: a team, or one of the two views that is not a
 * team. The count is what makes it a decision — "Team 2 · 1" says more about
 * where the work is than any label could.
 */
function SideItem({ item, active, onClick, tone }: {
  item: { key: string; label: string; count: number; fresh: number; mine?: boolean; members?: string[] };
  active: boolean;
  onClick: () => void;
  tone?: 'warn';
}) {
  const accent = tone === 'warn' ? '#f59e0b' : '#6366f1';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: active ? (tone === 'warn' ? 'rgba(245,158,11,.14)' : 'rgba(99,102,241,.16)') : 'var(--c111827)',
        border: `1px solid ${active ? accent : 'var(--c1f2937)'}`,
        borderLeft: `3px solid ${active ? accent : 'transparent'}`,
        borderRadius: 10, padding: '8px 11px', color: 'var(--ce2e8f0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap' }}>{item.label}</span>
        {item.mine && <span style={{ fontSize: 9.5, fontWeight: 800, background: '#6366f1', color: '#fff', borderRadius: 999, padding: '1px 6px' }}>TÔI</span>}
        {item.fresh > 0 && <span style={{ fontSize: 9.5, fontWeight: 800, background: '#22c55e', color: '#052e16', borderRadius: 999, padding: '1px 6px' }}>{item.fresh}&nbsp;MỚI</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: active ? 'var(--ce2e8f0)' : 'var(--c64748b)', paddingLeft: 8 }}>{item.count}</span>
      </div>
      {!!item.members?.length && (
        <div className="ag-side-members" style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.members.join(', ')}
        </div>
      )}
    </button>
  );
}

/**
 * One salon.
 *
 * WHAT CAME OFF THIS ROW AND WHY
 *
 * An ACTIVE badge on fifty-four of fifty-six rows is not information, it is
 * texture — so the status only appears when it is NOT active, which is the
 * only time anybody needs to read it. The purple "Vào setup" button is gone
 * too: it was the loudest thing on a screen where every row had one, and the
 * whole row does the same job. Both together take the row from about 80px to
 * about 52px, which is eighteen salons on a screen instead of ten.
 *
 * The team it belongs to is edited here rather than on a settings page: the
 * moment somebody notices a salon is in the wrong list is the moment they are
 * looking at the list, and a fix that needs a second screen does not happen.
 */
function Row({
  t, fresh, team, showTeam, canAssign, teams, picking, checked, onCheck,
  busy, onEnter, editing, setEditing, onTeam,
}: {
  t: TenantRow;
  fresh?: boolean;
  team: string;
  showTeam: boolean;
  canAssign: boolean;
  teams: { team: string; label: string }[];
  picking: boolean;
  checked: boolean;
  onCheck: () => void;
  busy: string | null;
  onEnter: (t: TenantRow, landing?: string) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onTeam: (tenantId: string, team: string) => void;
}) {
  const isEditing = editing === t.id;
  const suspended = t.status === 'SUSPENDED';
  const opening = busy === t.id;
  const open = () => { if (!suspended && !opening && !picking) onEnter(t); };
  return (
    <div
      className="ag-row"
      role="button"
      tabIndex={suspended ? -1 : 0}
      onClick={() => (picking ? onCheck() : open())}
      onKeyDown={(e) => { if (e.key === 'Enter') (picking ? onCheck() : open()); }}
      title={suspended ? 'Tiệm đang bị khoá — mở lại ở Super Admin' : 'Mở phiên setup 8 tiếng'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
        borderBottom: '1px solid var(--c1f2937)', background: 'var(--c111827)',
        cursor: suspended && !picking ? 'default' : 'pointer', opacity: opening ? 0.5 : 1,
      }}
    >
      {picking && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 17, height: 17, accentColor: '#6366f1', cursor: 'pointer', flex: '0 0 auto' }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fresh && <NewTag />}{t.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/{t.slug}</div>
      </div>

      {/* Only the abnormal status is worth a badge. */}
      {suspended && (
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#ef4444', border: '1px solid #ef4444', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>KHOÁ</span>
      )}

      {showTeam && !picking && (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
          {!canAssign ? (
            team ? <span style={{ color: 'var(--c94a3b8)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '2px 9px', fontSize: 11.5, whiteSpace: 'nowrap' }}>{team}</span> : null
          ) : isEditing ? (
            <select
              autoFocus
              defaultValue={team}
              onChange={(e) => onTeam(t.id, e.target.value)}
              onBlur={() => setEditing(null)}
              style={{ background: 'var(--c0f172a)', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '4px 7px', fontSize: 12.5 }}
            >
              <option value="">— chưa phân nhóm —</option>
              {teams.filter((x) => x.team).map((x) => <option key={x.team} value={x.team}>{x.team}</option>)}
            </select>
          ) : (
            <button
              onClick={() => setEditing(t.id)}
              title="Đổi nhóm phụ trách"
              style={{ background: 'transparent', border: '1px dashed var(--c334155)', color: team ? 'var(--c94a3b8)' : '#fbbf24', borderRadius: 999, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >{team || '+ nhóm'}</button>
          )}
        </span>
      )}

      {!picking && (
        <span style={{ color: suspended ? 'var(--c475569)' : '#a5b4fc', fontWeight: 800, fontSize: 15, flex: '0 0 auto' }}>
          {opening ? '…' : '→'}
        </span>
      )}
    </div>
  );
}
