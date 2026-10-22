'use client';

// ---------------------------------------------------------------------------
// Lumio setup staff home. One SUPPORT login sees ONLY this: a searchable list
// of salons. Picking one mints an 8-hour salon-scoped session (audited
// server-side) and drops the employee into that salon's dashboard with the
// platform-managed setup screens unlocked. "Leave salon" on the banner brings
// them back here.
//
// The salon session lives in THIS TAB only (sessionStorage — see
// lib/support-session.ts): an employee setting up three salons in three tabs
// keeps three sessions, and no tab ever silently becomes another salon. The
// support account's own login stays in localStorage, so leaving never needs a
// re-login.
//
// THE LAYOUT (redesign, Oct 2026)
//
// A row carries information, not controls: name, term, package, team, stage,
// next step, channels. The only colour on it is the service term — red when
// it has run out, amber when it is about to — so a glance says which shops
// need a renewal call. Every control that used to sit on the row (stage,
// next department, team, package, the AI switch) lives in the salon's panel,
// opened by clicking the row: a drawer on a computer, a sheet on a phone.
//
// Filters are one button per group (Thời hạn ▾, Nhóm ▾ …) on a computer or a
// tablet, and one page behind "Lọc" on a phone. A group in use turns purple
// and says what it holds; each option shows how many salons it would leave.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { enterSupportSession } from '../../lib/support-session';
import { fresh } from '../../lib/live';
import { useIsMobile } from '../../lib/responsive';
import { groupInbox, groupSummary, type InboxItem } from '../../lib/inbox-groups';
import { LumioLogo } from '../../components/LumioLogo';
import { TeamBell, noticesByTenant, noticeSummary, ago as agoShort, type RowNotice, type TeamNotice } from '../../components/TeamBell';
import {
  activeGroups, applyFilters, clearGroup, facetCounts, NO_FILTERS, rememberedFilters, REMEMBERED, toggleValue,
  type AgencyFilters, type FilterFacts, type GroupKey,
} from '../../lib/agency-filters';
import {
  fmtDay, needsRenewal, renewBucket, renewState as renewStateOf0, termStatus, todayKey,
  type RenewState, type ServiceTerm, type TermState,
} from '../../lib/agency-term';
import {
  ago, ADS_LOOK, ADS_ORDER, GROWTH_LOOK, GROWTH_ORDER, MARKET_LOOK, MARKET_ORDER, marketOf, NEXT_LOOK, STAGE_LOOK, STAGE_ORDER, TIER_DOT,
  type Board, type OpsStage, type ServicePackage, type TenantRow, type WorkNext,
} from './agency-model';
import {
  ActiveChips, AdsText, BookingsCell, C, ChannelSquares, ChannelWords, Dot, FilterBar, FilterSheet, GrowthText, Icon, MarketChip, NextPicker, PackageText,
  PulseTiles, PulseWords, RenewAction, SalonPanel, StageText, TERM_LOOK, TermText, type FilterGroupDef,
} from './AgencyParts';

/**
 * Above this many new salons in one view, the MỚI tag stops being a signal.
 * A badge on half the rows is texture, not information — past the threshold
 * the tags come off the rows and become one line at the top that filters.
 */
const NEW_TAGS_MAX = 8;

type Tab = 'all' | 'mine' | 'renew' | 'down' | 'adswarn' | 'none' | 'parked';
/** Paused and stopped salons live in their own tab, never mixed into the working lists. */
const isParked = (stage: string | null | undefined) => stage === 'paused' || stage === 'stopped';
type SortKey = 'work' | 'growth' | 'bookings' | 'pkg' | 'end' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'work', label: 'Cần làm trước' },
  { key: 'growth', label: 'Giảm nhiều nhất' },
  { key: 'bookings', label: 'Nhiều booking nhất' },
  { key: 'end', label: 'Ngày hết hạn' },
  { key: 'pkg', label: 'Gói lớn trước' },
  { key: 'name', label: 'Tên A–Z' },
];

const TERM_SECTIONS: { key: TermState; title: string; dot: string; note?: string }[] = [
  { key: 'expired', title: 'Hết hạn', dot: '#ef4444', note: 'Báo bộ phận gia hạn' },
  { key: 'soon', title: 'Sắp hết hạn', dot: '#f59e0b' },
  { key: 'ok', title: 'Còn hạn', dot: '#22c55e' },
  { key: 'none', title: 'Chưa có thời hạn', dot: '#64748b' },
];
const RENEW_SECTIONS: { key: RenewState; title: string; dot: string; note?: string }[] = [
  { key: 'untold', title: 'Chưa báo', dot: '#f59e0b', note: 'Cần báo bộ phận gia hạn' },
  { key: 'told', title: 'Đã báo · chờ gia hạn', dot: '#6366f1' },
  { key: 'renewed', title: 'Đã gia hạn tháng này', dot: '#22c55e' },
];

/**
 * The table's columns on a wide screen:
 * Tiệm (tên → chi tiết · Vào) · Bước tiếp · Booking tháng này · Hiệu quả · Ads · Gói · Nhóm · Trạng thái · (gia hạn, chi tiết).
 * "Bước tiếp" — the hand-off staff change most — sits right after the name;
 * the term moved into the salon's detail panel (the row's edge colour and the
 * renewal button still flag an expiring one).
 */
const COLS = 'minmax(270px, 1.6fr) 158px 136px 168px 186px 122px 90px 104px 96px';
/** Below this the fixed columns do not fit and the table scrolls sideways. */
const TABLE_MIN = 1470;

const cssFor = `
.ag-row:hover { background: var(--c162032) !important; }
.ag-name:hover { text-decoration: underline; text-underline-offset: 3px; }
.ag-next:hover { filter: brightness(1.12); }
.ag-next:focus-within { outline: 2px solid #6366f1; outline-offset: 1px; }
.ag-row:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
.ag-scroll { scrollbar-width: none; }
.ag-scroll::-webkit-scrollbar { display: none; }
`;

type Note = { text: string; undo?: () => void };

export default function AgencyPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  /** Phone: cards and a filter page. Tablet (up to 1279): two-line rows. Wider: the table. */
  const phone = useIsMobile(699);
  const narrow = useIsMobile(1379);
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  /** Everything a shop wrote that nobody answered — the bell, and a line per row. */
  const [notices, setNotices] = useState<TeamNotice[]>([]);
  const noticeBy = useMemo(() => noticesByTenant(notices), [notices]);
  const [allSalons, setAllSalons] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const groups = useMemo(() => groupInbox(inbox), [inbox]);
  // Which salons arrived this week, as the API judged it.
  const newIds = useMemo(
    () => new Set((board?.groups ?? []).flatMap((g) => g.salons.filter((x) => x.isNew).map((x) => x.id))),
    [board],
  );
  /** Which list is on screen. Null until the board says which team is mine. */
  const [tab, setTab] = useState<Tab | null>(null);
  const [filters, setFilters] = useState<AgencyFilters>(NO_FILTERS);
  const [sort, setSortState] = useState<SortKey>('work');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('lumio_agency_filters');
      let f = rememberedFilters(raw ? JSON.parse(raw) : null);
      if (!raw) {
        // The old one-choice market / package filters, carried over once.
        const m = window.localStorage.getItem('lumio_agency_market');
        const p = window.localStorage.getItem('lumio_agency_pkg');
        if (m) f = { ...f, market: [m] };
        if (p) f = { ...f, pkg: [p] };
      }
      setFilters(f);
      const s = window.localStorage.getItem('lumio_agency_sort') as SortKey | null;
      if (s && SORTS.some((x) => x.key === s)) setSortState(s);
      else if (window.localStorage.getItem('lumio_agency_bigfirst') === '1') setSortState('pkg');
    } catch { /* private mode */ }
  }, []);
  /** Market and package are remembered on this device, as before; the rest are for now. */
  const updateFilters = useCallback((fn: (f: AgencyFilters) => AgencyFilters) => {
    setFilters((cur) => {
      const next = fn(cur);
      try { window.localStorage.setItem('lumio_agency_filters', JSON.stringify(Object.fromEntries(REMEMBERED.map((g) => [g, next[g]])))); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const setSort = (s: SortKey) => { setSortState(s); try { window.localStorage.setItem('lumio_agency_sort', s); } catch { /* ignore */ } };
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const pkgByKey = useMemo(() => new Map(packages.map((p) => [p.key, p])), [packages]);
  /** Bulk mode: the tick boxes are showing, and these are the salons ticked. */
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  /** The salon whose panel is open. */
  const [panelId, setPanelId] = useState<string | null>(null);
  /** Phone: the filter page. */
  const [sheet, setSheet] = useState(false);
  const today = todayKey();

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

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
    apiFetch<ServicePackage[]>('/support/packages', { token }).then(setPackages).catch(() => undefined);
    // What is waiting, across every salon. Refreshed each minute while the
    // picker is open — this is the screen somebody leaves up on a second
    // monitor, and it has to be right when they glance at it.
    const pull = () => {
      apiFetch<InboxItem[]>(fresh('/support/inbox'), { token }).then(setInbox).catch(() => undefined);
      apiFetch<{ count: number; items: TeamNotice[] }>(fresh('/support/notifications'), { token })
        .then((r) => setNotices(r.items ?? [])).catch(() => undefined);
    };
    pull();
    const t = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [ready, user, token, router]);

  // An employee lands on their own team; the owner, who has no team, on all.
  // Only ever set once — after that the choice is the viewer's.
  useEffect(() => {
    if (!board || tab !== null) return;
    setTab(board.myTeam && board.groups.some((g) => g.team === board.myTeam) ? 'mine' : 'all');
  }, [board, tab]);

  // The browser tab says it too, so a staff member on another page notices.
  useEffect(() => {
    document.title = inbox.length ? `(${inbox.length}) Tiệm vừa gửi · Lumio Support` : 'Lumio Support';
  }, [inbox.length]);

  /** Which team each salon is on. */
  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of board?.groups ?? []) for (const sg of g.salons) m.set(sg.id, g.team);
    return m;
  }, [board]);
  const myTeam = board?.myTeam ?? null;
  const hasMine = Boolean(myTeam && board?.groups.some((g) => g.team === myTeam));

  /** The facts the filters and the sections read, worked out once per salon. */
  const facts = useMemo(() => {
    const m = new Map<string, FilterFacts>();
    for (const r of rows) {
      const flags: string[] = [];
      if (noticeBy.has(r.id) || (r.heldPosts ?? 0) > 0) flags.push('waiting');
      if (newIds.has(r.id)) flags.push('new');
      if (r.status === 'SUSPENDED') flags.push('locked');
      if (r.connections?.fbPage && r.connections.fbLost) flags.push('fblost');
      m.set(r.id, {
        id: r.id,
        term: termStatus(r.serviceTerm, today).state,
        renew: renewBucket(r.serviceTerm, today),
        team: teamOf.get(r.id) ?? '',
        pkg: r.servicePackage || '',
        stage: r.opsStage ?? 'running',
        market: marketOf(r),
        growth: r.pulse?.growth.kind ?? 'thin',
        ads: r.pulse?.ads.kind ?? 'none',
        flags,
      });
    }
    return m;
  }, [rows, noticeBy, newIds, teamOf, today]);

  const needle = q.trim().toLowerCase();
  const activeTab: Tab = tab ?? 'all';
  /**
   * The salons the filters work on: the tab's list — or, while searching,
   * every salon, because somebody looking for a name does not care whose list
   * it is on.
   */
  const base = useMemo(() => rows.filter((r) => {
    const f = facts.get(r.id)!;
    if (needle) return `${r.name} ${r.slug}`.toLowerCase().includes(needle);
    if (activeTab === 'parked') return isParked(f.stage);
    if (isParked(f.stage)) return false;
    if (activeTab === 'mine') return f.team === myTeam;
    if (activeTab === 'none') return f.team === '';
    if (activeTab === 'renew') return f.renew !== null;
    if (activeTab === 'down') return f.growth === 'down';
    if (activeTab === 'adswarn') return f.ads === 'warn';
    return true;
  }), [rows, facts, needle, activeTab, myTeam]);
  const baseFacts = useMemo(() => base.map((r) => facts.get(r.id)!), [base, facts]);
  const counts = useMemo(() => facetCounts(baseFacts, filters), [baseFacts, filters]);
  const shown = useMemo(() => {
    const keep = new Set(applyFilters(baseFacts, filters).map((f) => f.id));
    return base.filter((r) => keep.has(r.id));
  }, [base, baseFacts, filters]);
  const filtering = activeGroups(filters).length > 0;

  /** The order inside each section. "Cần làm trước": waiting on us, newest wait first; then this week's arrivals. */
  const sections = useMemo(() => {
    const waitAt = (t: TenantRow) => {
      const n = noticeBy.get(t.id);
      return n ? Date.parse(n.newest.at) : (t.heldPosts ?? 0) > 0 ? 1 : 0;
    };
    const tierOf = (t: TenantRow) => (t.servicePackage ? pkgByKey.get(t.servicePackage)?.tier ?? 0 : 0);
    const work = (a: TenantRow, b: TenantRow) => waitAt(b) - waitAt(a) || (newIds.has(b.id) ? 1 : 0) - (newIds.has(a.id) ? 1 : 0);
    // Steepest fall first; a salon without a verdict sorts after every one that has one.
    const pctOf = (t: TenantRow) => (t.pulse && t.pulse.growth.kind !== 'thin' && t.pulse.bookings.pct != null ? t.pulse.bookings.pct : Number.POSITIVE_INFINITY);
    const cmp = (a: TenantRow, b: TenantRow) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'growth') return pctOf(a) - pctOf(b) || a.name.localeCompare(b.name);
      if (sort === 'bookings') return (b.pulse?.bookings.month ?? 0) - (a.pulse?.bookings.month ?? 0) || a.name.localeCompare(b.name);
      if (sort === 'pkg') return tierOf(b) - tierOf(a) || work(a, b) || a.name.localeCompare(b.name);
      if (sort === 'end') {
        const ea = a.serviceTerm?.end ?? '9999-99-99'; const eb = b.serviceTerm?.end ?? '9999-99-99';
        return ea < eb ? -1 : ea > eb ? 1 : a.name.localeCompare(b.name);
      }
      return work(a, b) || a.name.localeCompare(b.name);
    };
    const sorted = [...shown].sort(cmp);
    if (activeTab === 'renew' && !needle) {
      return RENEW_SECTIONS.map((s) => ({ ...s, key: s.key as string, rows: sorted.filter((r) => facts.get(r.id)!.renew === s.key) }));
    }
    return TERM_SECTIONS.map((s) => ({ ...s, key: s.key as string, rows: sorted.filter((r) => facts.get(r.id)!.term === s.key) }));
  }, [shown, sort, activeTab, needle, facts, noticeBy, pkgByKey, newIds]);
  const filled = sections.filter((s) => s.rows.length);
  // Until anybody records a term, every salon is "Chưa có thời hạn": one
  // heading over the whole list says nothing, so it is left off.
  const headings = (activeTab === 'renew' && !needle) || filled.length > 1 || (filled.length === 1 && filled[0].key !== 'none');

  /** The numbers on the tabs, and on the renewal line. */
  const tabCounts = useMemo(() => {
    let mine = 0; let none = 0; let renewAll = 0; let expired = 0; let soon = 0; let down = 0; let adswarn = 0; let parked = 0;
    for (const f of facts.values()) {
      if (isParked(f.stage)) { parked++; continue; }
      if (myTeam && f.team === myTeam) mine++;
      if (f.team === '') none++;
      if (f.renew !== null) renewAll++;
      if (f.growth === 'down') down++;
      if (f.ads === 'warn') adswarn++;
    }
    for (const r of rows) {
      if (isParked(facts.get(r.id)?.stage)) continue;
      if (!needsRenewal(r.serviceTerm, today)) continue;
      if (termStatus(r.serviceTerm, today).state === 'expired') expired++; else soon++;
    }
    return { all: rows.length - parked, mine, none, renewAll, expired, soon, need: expired + soon, down, adswarn, parked };
  }, [facts, rows, myTeam, today]);
  const waitingHere = useMemo(() => [...facts.values()].filter((f) => f.flags.includes('waiting')).length, [facts]);
  /** How many of the salons on screen arrived this week. Decides the tags. */
  const newHere = useMemo(() => shown.filter((t) => newIds.has(t.id)).length, [shown, newIds]);
  const tagRows = newHere > 0 && newHere <= NEW_TAGS_MAX;

  /** Every filter group, with its options — the same list feeds the bar, the chips and the phone page. */
  const filterGroups = useMemo((): FilterGroupDef[] => {
    const marketTotals = new Map<string, number>();
    for (const f of facts.values()) marketTotals.set(f.market, (marketTotals.get(f.market) ?? 0) + 1);
    return [
      {
        key: 'term', label: 'Thời hạn', title: 'Lọc theo thời hạn', kind: 'tiles',
        options: [
          { value: 'expired', label: 'Hết hạn', sub: 'đã quá ngày kết thúc', icon: 'alert', tint: TERM_LOOK.expired.ink },
          { value: 'soon', label: 'Sắp hết hạn', sub: 'trong mốc báo trước', icon: 'hourglass', tint: TERM_LOOK.soon.ink },
          { value: 'ok', label: 'Còn hạn', sub: 'chưa tới mốc báo', icon: 'check', tint: C.good },
          { value: 'none', label: 'Chưa có thời hạn', sub: 'chưa ghi ngày', icon: 'cal', tint: C.sub },
        ],
        foot: 'Mốc báo trước mặc định 14 ngày, sửa riêng ở từng tiệm.',
      },
      {
        key: 'team', label: 'Nhóm', title: 'Lọc theo nhóm phụ trách', kind: 'toggles',
        options: [
          ...(board?.teams ?? []).filter((x) => x.team).map((x) => ({ value: x.team, label: x.label || x.team, sub: x.members.join(', ') || undefined })),
          { value: 'none', label: 'Chưa giao' },
        ],
      },
      {
        key: 'renew', label: 'Gia hạn', title: 'Lọc theo gia hạn', kind: 'toggles',
        options: [
          { value: 'untold', label: 'Chưa báo', sub: 'hết hạn / sắp hết, chưa ai báo' },
          { value: 'told', label: 'Đã báo', sub: 'chờ bộ phận gia hạn' },
          { value: 'renewed', label: 'Đã gia hạn', sub: 'trong tháng này' },
        ],
      },
      {
        key: 'pkg', label: 'Gói', title: 'Lọc theo gói dịch vụ', kind: 'list',
        options: [
          ...[...packages].sort((a, b) => b.tier - a.tier || b.priceUsd - a.priceUsd).map((p) => ({
            value: p.key, label: p.name, sub: `$${p.priceUsd}/tháng`, lead: <Dot color={TIER_DOT[p.tier] ?? TIER_DOT[1]} size={9} />,
          })),
          { value: 'none', label: 'Chưa có gói', lead: <Dot color="var(--c334155)" size={9} /> },
        ],
      },
      {
        key: 'stage', label: 'Trạng thái', title: 'Lọc theo trạng thái', kind: 'toggles',
        options: STAGE_ORDER.map((k) => ({ value: k, label: STAGE_LOOK[k].label, lead: <Dot color={STAGE_LOOK[k].dot} /> })),
      },
      {
        key: 'growth', label: 'Hiệu quả', title: 'Lọc theo booking tháng này so với cùng kỳ tháng trước', kind: 'toggles',
        options: GROWTH_ORDER.map((k) => ({ value: k, label: GROWTH_LOOK[k].label, lead: <Dot color={GROWTH_LOOK[k].dot} /> })),
        foot: 'So số booking từ đầu tháng tới hôm nay với cùng số ngày của tháng trước. Lệch dưới 10% tính là ổn định.',
      },
      {
        key: 'ads', label: 'Ads', title: 'Lọc theo quảng cáo tháng này', kind: 'toggles',
        options: ADS_ORDER.map((k) => ({ value: k, label: ADS_LOOK[k].label, lead: <Dot color={ADS_LOOK[k].dot} /> })),
        foot: 'Đọc từ chi phí ads đã ghi trong tháng và các booking đến qua Google, Facebook/Instagram, Zalo.',
      },
      {
        key: 'market', label: 'Thị trường', title: 'Lọc theo thị trường', kind: 'toggles',
        options: MARKET_ORDER.filter((code) => (marketTotals.get(code) ?? 0) > 0 || filters.market.includes(code))
          .map((code) => ({ value: code, label: MARKET_LOOK[code].name, lead: <MarketChip code={code} /> })),
      },
      {
        key: 'flag', label: 'Khác', title: 'Lọc khác', kind: 'list',
        options: [
          { value: 'waiting', label: 'Đang chờ Lumio trả lời', sub: 'góp ý bài, tin nhắn, file gửi', icon: 'alert', tint: C.bad },
          { value: 'fblost', label: 'Mất kết nối Facebook', sub: 'bài không đăng được, bot không trả lời — cần kết nối lại Trang', icon: 'x', tint: C.bad },
          { value: 'new', label: 'Tiệm mới tuần này', icon: 'check', tint: C.good },
          { value: 'locked', label: 'Đang bị khoá', sub: 'khoá đăng nhập ở Super Admin', icon: 'x', tint: C.bad },
        ],
      },
    ];
  }, [board, packages, facts, filters.market]);

  const toggle = (g: GroupKey, v: string) => updateFilters((f) => toggleValue(f, g, v));
  const clear = (g: GroupKey) => updateFilters((f) => clearGroup(f, g));
  const clearAll = () => updateFilters(() => NO_FILTERS);

  const toggleChosen = (id: string) => setChosen((c) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /**
   * Move a salon onto a team. Refused by the server for anyone but the owner
   * and full-level accounts, so the rule is stated once, where it is enforced.
   */
  async function setTeam(tenantId: string, team: string) {
    if (!token) return;
    setError(null);
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(tenantId)}/team`, { method: 'POST', token, body: { team } });
      const b = await apiFetch<Board>('/support/board', { token });
      setBoard(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đổi được nhóm');
    }
  }

  /** Bot on/off for one salon. A confirm first: a customer feels this one within the minute. */
  async function setBot(t: TenantRow, on: boolean) {
    if (!token) return;
    const msg = on
      ? `BẬT trợ lý AI trả lời tin nhắn cho ${t.name}? Bot sẽ trả lời khách trên Messenger/Instagram ngay.`
      : `TẮT trợ lý AI của ${t.name}? Page vẫn kết nối để đăng bài; Lumio sẽ không đọc và không trả lời tin nhắn của khách.`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(t.id)}/bot`, { method: 'POST', token, body: { on } });
      const b = await apiFetch<Board>('/support/board', { token });
      setBoard(b);
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, bot: on ? 'on' : 'off' } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đổi được trạng thái bot');
    }
  }

  /** Hand a salon to the next department. Optimistic: it snaps back if the server refuses. */
  async function setNext(t: TenantRow, next: WorkNext | '') {
    if (!token || next === (t.workNext ?? '')) return;
    const before = t.workNext ?? '';
    setError(null);
    setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, workNext: next } : r)));
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(t.id)}/next`, { method: 'POST', token, body: { next } });
      // Changed straight from the row, so a slip of the finger gets an undo.
      setNote({
        text: `${t.name} → ${next ? NEXT_LOOK[next].label : 'chưa chọn bộ phận'}`,
        undo: () => { setNote(null); void setNext({ ...t, workNext: next }, before); },
      });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, workNext: before } : r)));
      setError(e instanceof Error ? e.message : 'Không đổi được bộ phận tiếp theo');
    }
  }

  /** Record a salon's service package. Optimistic. */
  async function setPackage(t: TenantRow, pkg: string) {
    if (!token || pkg === (t.servicePackage ?? '')) return;
    const before = t.servicePackage ?? '';
    setError(null);
    setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, servicePackage: pkg } : r)));
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(t.id)}/package`, { method: 'POST', token, body: { package: pkg } });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, servicePackage: before } : r)));
      setError(e instanceof Error ? e.message : 'Không đổi được gói dịch vụ');
    }
  }

  /** Relabel a salon's stage. A label nobody outside the team sees: no confirm, optimistic. */
  async function setStage(t: TenantRow, stage: OpsStage) {
    if (!token || stage === t.opsStage) return;
    const before = t.opsStage;
    setError(null);
    setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, opsStage: stage } : r)));
    try {
      await apiFetch(`/support/tenants/${encodeURIComponent(t.id)}/stage`, { method: 'POST', token, body: { stage } });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, opsStage: before } : r)));
      setError(e instanceof Error ? e.message : 'Không đổi được trạng thái');
    }
  }

  const putTerm = (id: string, term: ServiceTerm | null) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, serviceTerm: term } : r)));

  /** Record, change or clear a salon's service term. */
  async function saveTerm(t: TenantRow, body: Record<string, unknown>) {
    if (!token) return;
    setError(null);
    try {
      const r = await apiFetch<{ serviceTerm: ServiceTerm | null }>(`/support/tenants/${encodeURIComponent(t.id)}/term`, { method: 'POST', token, body });
      putTerm(t.id, r.serviceTerm);
      setNote({ text: body.clear ? `Đã xoá thời hạn của ${t.name}.` : `Đã lưu thời hạn của ${t.name}.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được thời hạn');
    }
  }

  /**
   * Told the renewals people / undo / renewed. "Told" is optimistic — it is
   * the one-click action on the row — and offers an undo for a slip.
   */
  async function renewal(t: TenantRow, body: Record<string, unknown>) {
    if (!token) return;
    setError(null);
    const before = t.serviceTerm ?? null;
    if (body.action === 'told' && before) {
      putTerm(t.id, { ...before, renew: { state: 'told', by: user?.email ?? null, at: new Date().toISOString(), forEnd: before.end, ...(body.note ? { note: String(body.note) } : {}) } });
    }
    try {
      const r = await apiFetch<{ serviceTerm: ServiceTerm }>(`/support/tenants/${encodeURIComponent(t.id)}/renewal`, { method: 'POST', token, body });
      putTerm(t.id, r.serviceTerm);
      if (body.action === 'told') setNote({ text: `Đã báo gia hạn: ${t.name}.`, undo: () => { void renewal({ ...t, serviceTerm: r.serviceTerm }, { action: 'undo' }); setNote(null); } });
      if (body.action === 'renewed') setNote({ text: `${t.name} đã gia hạn đến ${fmtDay(r.serviceTerm.end, today, true)}.` });
    } catch (e) {
      putTerm(t.id, before);
      setError(e instanceof Error ? e.message : 'Không cập nhật được gia hạn');
    }
  }

  /**
   * File everything ticked, in one call. The count in the confirmation
   * matters: twelve salons just left the list you were looking at.
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
      setNote({ text: `Đã giao ${r.count} tiệm cho ${team || '“chưa phân nhóm”'}.` });
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
        custom?: boolean;
        capabilities?: string[];
      }>(
        `/support/enter/${t.id}`, { method: 'POST', token, body: {} },
      );
      // Park the support login, activate the salon session. The session user
      // borrows SALON_ADMIN so the salon dashboard works untouched; the
      // supportSession flag drives the banner and unlocks hidden screens.
      //
      // The capability list is the employee's LEVEL, resolved by the server.
      // It is only a drawing instruction: the same level is inside the token,
      // and every request is checked against that copy.
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
          supportCustom: r.custom === true,
          capabilities: r.capabilities,
        },
      };
      enterSupportSession(session);
      window.location.assign(landing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter this salon');
      setBusy(null);
    }
  }

  /**
   * A push or a bell row on another device said "open salon X at Y": once the
   * salon rows are in we step in without a click. Read once, then cleared
   * from the address bar so a reload does not step in again.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || loading || !token) return;
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get('open');
    const to = sp.get('to');
    if (!id) return;
    autoOpened.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    const t = rows.find((x) => x.id === id);
    if (!t) { setError('Không tìm thấy tiệm trong danh sách của bạn.'); return; }
    void enter(t, to && to.startsWith('/salon') ? to : '/salon/content?tab=queue');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, token, rows]);

  /** A bell row: step into that salon and land on the post/thread it names. */
  function openNotice(n: TeamNotice) {
    const t = rows.find((x) => x.id === n.tenantId)
      ?? { id: n.tenantId, name: n.salon, slug: n.slug, status: 'ACTIVE', createdAt: '' };
    void enter(t, n.link);
  }

  const closePanel = useCallback(() => setPanelId(null), []);
  const closeSheet = useCallback(() => setSheet(false), []);

  if (!ready || loading) {
    return <main style={screen}><div style={{ color: C.sub }}>Loading…</div></main>;
  }

  const panelRow = panelId ? rows.find((r) => r.id === panelId) ?? null : null;
  const canAssign = Boolean(board?.canAssign);
  const rowProps = (t: TenantRow) => ({
    t,
    today,
    term: facts.get(t.id)!.term,
    fresh: tagRows && newIds.has(t.id),
    team: teamOf.get(t.id) ?? '',
    pkg: t.servicePackage ? pkgByKey.get(t.servicePackage) ?? null : null,
    notice: noticeBy.get(t.id) ?? null,
    picking,
    checked: chosen.has(t.id),
    opening: busy === t.id,
    onCheck: () => toggleChosen(t.id),
    onOpen: () => setPanelId(t.id),
    onEnter: (landing?: string) => { void enter(t, landing); },
    onTell: () => { void renewal(t, { action: 'told' }); },
    onNext: (n: WorkNext | '') => { void setNext(t, n); },
  });

  const tabs: { key: Tab; label: string; n: number; badge?: boolean }[] = [
    { key: 'all', label: 'Tất cả', n: tabCounts.all },
    ...(hasMine ? [{ key: 'mine' as Tab, label: phone ? 'Của tôi' : `Của tôi · ${myTeam}`, n: tabCounts.mine }] : []),
    { key: 'renew', label: 'Gia hạn', n: tabCounts.need, badge: tabCounts.need > 0 },
    { key: 'down', label: 'Đang giảm', n: tabCounts.down, badge: tabCounts.down > 0 },
    ...(tabCounts.adswarn > 0 ? [{ key: 'adswarn' as Tab, label: phone ? 'Ads chưa hiệu quả' : 'Ads chưa ra booking', n: tabCounts.adswarn, badge: true }] : []),
    { key: 'none', label: 'Chưa giao', n: tabCounts.none },
    ...(tabCounts.parked > 0 ? [{ key: 'parked' as Tab, label: phone ? 'Tạm ngưng' : 'Tạm ngưng · Ngưng', n: tabCounts.parked }] : []),
  ];

  const resultLine = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.sub, minHeight: 28 }}>
      {filtering ? (
        <>
          <span><b style={{ color: C.ink }}>{shown.length}</b> / {base.length} tiệm khớp</span>
          <button type="button" onClick={clearAll} style={linkBtn}>Xoá lọc</button>
        </>
      ) : <span>{shown.length} tiệm</span>}
      <span style={{ flex: 1 }} />
      <SortPicker value={sort} onChange={setSort} />
    </div>
  );

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, color: C.ink2, padding: phone ? '14px 12px' : '24px 20px' }}>
      <style dangerouslySetInnerHTML={{ __html: cssFor }} />
      <div style={{ maxWidth: narrow ? 1060 : 1720, margin: '0 auto', paddingBottom: 80 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {user?.role === 'SUPER_ADMIN' && (
            <a href="/super-admin/tenants" style={{ color: C.link, textDecoration: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>← Super Admin</a>
          )}
          <h1 style={{ fontSize: 22, margin: 0 }}><LumioLogo size={phone ? 30 : 34} sub="Support" /></h1>
          <span style={{ marginLeft: 'auto' }} />
          <TeamBell items={notices} onOpen={openNotice} busy={Boolean(busy)} />
          <button onClick={() => { logout(); router.replace('/login'); }}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>

        {/* The bench: two people running thirty clients answer "what now" more often than "open which salon". */}
        <div className="ag-scroll" style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }}>
          <a href="/agency/today" title="Đăng bài, story, ưu đãi, hồ sơ Google… của tất cả khách trong một hàng đợi"
            style={{ ...benchLink, border: '1.5px solid #6366f1', background: 'rgba(99,102,241,.10)' }}>
            <span>🛠</span>Việc hôm nay<span style={{ color: C.link }}>→</span>
          </a>
          <a href="/agency/reports" title="Tiệm nào đã chốt số, nháp chờ đọc, đã gửi; kênh nào đọc lỗi" style={benchLink}>
            <span>📊</span>Báo cáo tháng
          </a>
          <a href="/agency/google-book" title="Nút “Book online” trên Google cho mọi tiệm: tiệm nào vào feed, tiệm nào cần sửa dữ liệu" style={benchLink}>
            <span>📍</span>Nút Google
          </a>
        </div>

        {/* What the shops sent, across every salon — only when there is something. One line per salon. */}
        {inbox.length > 0 && (
          <section style={{ border: '1.5px solid #f59e0b', borderRadius: 14, padding: '12px 14px', marginBottom: 16, background: 'rgba(245,158,11,.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>📥</span>
              <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>
                Tiệm vừa gửi
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, background: '#f59e0b', color: '#1c1917', borderRadius: 999, padding: '1px 8px' }}>{inbox.length}</span>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted, textAlign: 'right' }}>
                {`${groups.length} tiệm · ${inbox.filter((r) => !r.working).length} mới · ${inbox.filter((r) => r.working).length} đang làm`}
              </span>
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', background: C.soft }}>
              {(allSalons ? groups : groups.slice(0, phone ? 4 : 6)).map((g, i) => {
                const opening = busy === g.tenantId;
                const go = () => { const t = rows.find((x) => x.id === g.tenantId); if (t && !opening) void enter(t, '/salon/content?tab=queue'); };
                return (
                  <div key={g.tenantId} role="button" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
                    style={{
                      display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 10, alignItems: 'center',
                      padding: '8px 12px', borderTop: i ? `1px solid ${C.line}` : 'none', cursor: 'pointer', opacity: opening ? 0.5 : 1,
                    }}>
                    <span title={g.fresh ? 'Chưa ai mở' : 'Đang có người làm'} style={{
                      width: 9, height: 9, borderRadius: 999, background: g.fresh ? '#22c55e' : '#a5b4fc',
                      boxShadow: g.fresh ? '0 0 0 3px rgba(34,197,94,.18)' : 'none',
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.salon}</span>
                        <span style={{ fontSize: 12, color: C.warn, fontWeight: 600, whiteSpace: 'nowrap' }}>{groupSummary(g)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                        {g.fromShop ? '📤 ' : ''}{g.headline}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 12, color: C.muted }}>{ago(g.latest)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.warn }}>{opening ? '…' : 'Mở →'}</span>
                    </div>
                  </div>
                );
              })}
              {groups.length > (phone ? 4 : 6) && (
                <button onClick={() => setAllSalons((v) => !v)}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderTop: `1px solid ${C.line}`, color: C.warn, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {allSalons ? 'Thu gọn ↑' : `Xem thêm ${groups.length - (phone ? 4 : 6)} tiệm ↓`}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ---- title, search ---- */}
        {phone ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.ink }}>Tiệm</h2>
              <span style={{ fontSize: 13, color: C.muted }}>{rows.length}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <SearchBox value={q} onChange={setQ} phone />
              <button type="button" onClick={() => setSheet(true)} aria-label="Bộ lọc" style={{
                position: 'relative', height: 44, padding: '0 14px', borderRadius: 12, flexShrink: 0, cursor: 'pointer',
                border: `1px solid ${filtering ? C.indigoLine : C.border}`, background: filtering ? C.indigoSoft : 'transparent',
                display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: filtering ? C.link : C.ink2,
              }}>
                <Icon name="filter" size={17} color={filtering ? C.link : C.body} />Lọc
                {filtering && <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 999, background: '#6366f1', color: '#ffffff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxSizing: 'border-box' }}>{activeGroups(filters).length}</span>}
              </button>
              {canAssign && <PickButton picking={picking} onClick={() => { setPicking((v) => !v); setChosen(new Set()); }} compact />}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.ink }}>Tiệm</h2>
            <span style={{ fontSize: 14, color: C.muted }}>{rows.length} tiệm</span>
            <span style={{ flex: 1 }} />
            <div style={{ width: narrow ? 300 : 340, display: 'flex' }}><SearchBox value={q} onChange={setQ} /></div>
            {canAssign && <PickButton picking={picking} onClick={() => { setPicking((v) => !v); setChosen(new Set()); }} />}
          </div>
        )}

        {/* ---- tabs ---- */}
        <div className="ag-scroll" role="tablist" style={{
          display: 'flex', gap: phone ? 0 : 24, borderBottom: `1px solid ${C.line}`, marginTop: phone ? 4 : 10, overflowX: 'auto',
          ...(phone ? { margin: '4px -12px 0', padding: '0 4px' } : {}),
        }}>
          {tabs.map((x) => {
            const on = activeTab === x.key && !needle;
            return (
              <button key={x.key} role="tab" aria-selected={on} type="button" onClick={() => { setTab(x.key); setQ(''); }}
                style={{
                  flex: phone ? '1 0 auto' : '0 0 auto', height: 44, padding: phone ? '0 5px' : '0 4px', border: 0, background: 'transparent',
                  borderBottom: `2px solid ${on ? '#6366f1' : 'transparent'}`, fontFamily: 'inherit', fontSize: phone ? 13.5 : 14, fontWeight: on ? 700 : 500,
                  color: on ? C.ink : C.sub, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                {x.label}
                {x.badge ? (
                  <span style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, background: '#ef4444', color: '#ffffff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{x.n}</span>
                ) : <span style={{ color: C.muted, fontWeight: 500 }}>{x.n}</span>}
              </button>
            );
          })}
        </div>

        {/* ---- the month, across the salons on this tab. Each tile filters. ---- */}
        {!needle && activeTab !== 'renew' && (
          <PulseTiles rows={base} compact={phone} onPick={(g, v) => updateFilters((f) => toggleValue(f, g, v))} />
        )}

        {/* ---- filters ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {!narrow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.muted, marginRight: 2 }}>
                <Icon name="filter" size={15} color={C.muted} />Lọc
              </span>
              <FilterBar groups={filterGroups} filters={filters} counts={counts} onToggle={toggle} onClear={clear} />
              <span style={{ flex: 1 }} />
              {filtering && (
                <>
                  <span style={{ fontSize: 13, color: C.sub }}><b style={{ color: C.ink }}>{shown.length}</b> / {base.length} tiệm</span>
                  <button type="button" onClick={clearAll} style={linkBtn}>Xoá lọc</button>
                  <span style={{ width: 1, height: 20, background: C.line }} />
                </>
              )}
              <SortPicker value={sort} onChange={setSort} />
            </div>
          )}
          {narrow && !phone && (
            <>
              <div className="ag-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px 2px' }}>
                <FilterBar groups={filterGroups} filters={filters} counts={counts} onToggle={toggle} onClear={clear} h={40} />
              </div>
              {resultLine}
            </>
          )}
          {phone && (
            <>
              <ActiveChips groups={filterGroups} filters={filters} onOpen={() => setSheet(true)} onClear={clear} />
              {resultLine}
            </>
          )}

          {/* The lines that say "someone must act": renewals first, then shops waiting on us. */}
          {!needle && tabCounts.need > 0 && activeTab !== 'renew' && (
            <button type="button" onClick={() => setTab('renew')} style={{ ...alertLine, border: '1px solid rgba(239,68,68,.45)', background: 'var(--wash-red)' }}>
              <Icon name="alert" size={17} color={C.bad} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {tabCounts.expired > 0 && <b style={{ color: C.bad }}>{tabCounts.expired} hết hạn</b>}
                {tabCounts.expired > 0 && tabCounts.soon > 0 && ' · '}
                {tabCounts.soon > 0 && <b style={{ color: C.warn }}>{tabCounts.soon} sắp hết hạn</b>}
                {!phone && <span style={{ color: C.sub }}> chưa báo gia hạn</span>}
              </span>
              <span style={{ fontWeight: 600, color: C.ink2, whiteSpace: 'nowrap' }}>Xem →</span>
            </button>
          )}
          {!needle && waitingHere > 0 && (
            <button type="button" onClick={() => toggle('flag', 'waiting')} style={{
              ...alertLine,
              border: `1px solid ${filters.flag.includes('waiting') ? '#ef4444' : 'rgba(239,68,68,.35)'}`,
              background: filters.flag.includes('waiting') ? 'rgba(239,68,68,.16)' : 'rgba(239,68,68,.06)',
            }}>
              <span style={{ fontSize: 15 }}>🔔</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ color: C.bad }}>{waitingHere} tiệm đang chờ Lumio trả lời</b>{!phone && <span style={{ color: C.sub }}> — góp ý bài, tin nhắn, file gửi</span>}</span>
              <span style={{ fontWeight: 600, color: filters.flag.includes('waiting') ? C.bad : C.sub, whiteSpace: 'nowrap' }}>
                {filters.flag.includes('waiting') ? 'Bỏ lọc ✕' : 'Chỉ xem →'}
              </span>
            </button>
          )}
          {!needle && newHere > NEW_TAGS_MAX && (
            <button type="button" onClick={() => toggle('flag', 'new')} style={{
              ...alertLine, border: `1px solid ${filters.flag.includes('new') ? '#22c55e' : C.line}`,
              background: filters.flag.includes('new') ? 'rgba(34,197,94,.14)' : C.panel,
            }}>
              <span style={{ flex: 1 }}><b style={{ color: C.good }}>{newHere} tiệm mới</b> trong tuần này</span>
              <span style={{ fontWeight: 600, color: filters.flag.includes('new') ? C.good : C.muted }}>{filters.flag.includes('new') ? 'Bỏ lọc ✕' : 'Chỉ xem →'}</span>
            </button>
          )}
          {needle && (
            <div style={{ fontSize: 12.5, color: C.muted }}>Đang tìm trong tất cả các nhóm — {shown.length} tiệm khớp.</div>
          )}
        </div>

        {/* ---- the salons ---- */}
        <div style={{ marginTop: 12 }}>
          {shown.length === 0 ? (
            <div style={{ padding: 18, color: C.muted, fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 14, background: C.panel }}>
              {needle ? 'Không có tiệm nào khớp.'
                : filtering ? <>Không có tiệm nào khớp bộ lọc. <button type="button" onClick={clearAll} style={linkBtn}>Xoá lọc</button></>
                : activeTab === 'renew' ? 'Không có tiệm nào hết hạn hoặc sắp hết hạn.'
                : activeTab === 'down' ? 'Không có tiệm nào đang giảm booking so với cùng kỳ tháng trước.'
                : activeTab === 'adswarn' ? 'Không có tiệm nào chạy ads mà chưa ra booking.'
                : 'Nhóm này chưa có tiệm nào.'}
            </div>
          ) : !narrow ? (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflowX: 'auto' }}>
              <div style={{ minWidth: TABLE_MIN }}>
              <div style={{ display: 'grid', gridTemplateColumns: picking ? `28px ${COLS}` : COLS, columnGap: 14, alignItems: 'center', height: 40, padding: '0 14px 0 18px', background: C.soft, borderBottom: `1px solid ${C.line}` }}>
                {picking && <span />}
                {['Tiệm', 'Bước tiếp', 'Booking tháng này', 'Hiệu quả', 'Ads', 'Gói', 'Nhóm', 'Trạng thái', ''].map((h) => (
                  <span key={h || 'act'} style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, color: C.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</span>
                ))}
              </div>
              {sections.map((s) => s.rows.length > 0 && (
                <div key={s.key}>
                  {headings && <SectionHead title={s.title} dot={s.dot} n={s.rows.length} note={s.note} pad="9px 18px" boxed />}
                  {s.rows.map((t) => <WideRow key={t.id} {...rowProps(t)} />)}
                </div>
              ))}
              </div>
            </div>
          ) : (
            sections.map((s) => s.rows.length > 0 && (
              <div key={s.key}>
                {headings && <SectionHead title={s.title} dot={s.dot} n={s.rows.length} note={phone ? undefined : s.note} pad={phone ? '14px 4px 8px' : '14px 6px 8px'} />}
                <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.line}`, marginBottom: headings ? 0 : 10 }}>
                  {s.rows.map((t) => (phone ? <PhoneRow key={t.id} {...rowProps(t)} /> : <TabletRow key={t.id} {...rowProps(t)} />))}
                </div>
              </div>
            ))
          )}
        </div>

        {picking && shown.length > 0 && (
          <button
            onClick={() => setChosen((c) => c.size === shown.length ? new Set() : new Set(shown.map((t) => t.id)))}
            style={{ ...linkBtn, padding: '10px 2px' }}
          >
            {chosen.size === shown.length ? 'Bỏ chọn tất cả' : `Chọn cả ${shown.length} tiệm đang hiện`}
          </button>
        )}
      </div>

      {/* ---- what happens to everything ticked ----
           Anchored to the bottom of the window, because the list it acts on is
           longer than the screen. */}
      {picking && chosen.size > 0 && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
          background: C.panel, borderTop: '1.5px solid #6366f1',
          boxShadow: '0 -8px 24px rgba(0,0,0,.45)', padding: '11px 16px', paddingBottom: 'calc(11px + env(safe-area-inset-bottom, 0px))',
        }}>
          <div style={{ maxWidth: 1060, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Đã chọn {chosen.size} tiệm</span>
            <span style={{ fontSize: 13, color: C.sub }}>Giao cho:</span>
            <select
              value=""
              disabled={assigning}
              onChange={(e) => { if (e.target.value) void assignMany(e.target.value === '_none' ? '' : e.target.value); }}
              style={{ background: C.soft, border: '1px solid #6366f1', color: C.ink2, borderRadius: 8, padding: '8px 10px', fontSize: phone ? 16 : 13.5, fontWeight: 600 }}
            >
              <option value="">— chọn nhóm —</option>
              {(board?.teams ?? []).filter((x) => x.team).map((x) => <option key={x.team} value={x.team}>{x.team}</option>)}
              <option value="_none">Bỏ khỏi nhóm</option>
            </select>
            {assigning && <span style={{ fontSize: 13, color: C.link }}>Đang giao…</span>}
            <button
              onClick={() => setChosen(new Set())}
              style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8, padding: '7px 13px', fontSize: 13, cursor: 'pointer' }}
            >Bỏ chọn</button>
          </div>
        </div>
      )}

      {panelRow && (
        <SalonPanel
          t={panelRow} today={today} phone={phone}
          team={teamOf.get(panelRow.id) ?? ''} teams={board?.teams ?? []} canAssign={canAssign}
          packages={packages} notice={noticeBy.get(panelRow.id) ?? null} busy={busy === panelRow.id}
          onClose={closePanel}
          onEnter={(t, landing) => { void enter(t, landing); }}
          onNext={(t, n) => { void setNext(t, n); }}
          onStage={(t, s) => { void setStage(t, s); }}
          onPackage={(t, k) => { void setPackage(t, k); }}
          onTeam={(id, team) => { void setTeam(id, team); }}
          onBot={(t, on) => { void setBot(t, on); }}
          onTerm={saveTerm}
          onRenewal={renewal}
        />
      )}

      {sheet && (
        <FilterSheet groups={filterGroups} filters={filters} counts={counts} result={shown.length}
          onToggle={toggle} onClearAll={clearAll} onClose={closeSheet} />
      )}

      {(error || note) && (
        <div role="status" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: picking && chosen.size ? 84 : 20, zIndex: 90,
          width: 'max-content', maxWidth: 'min(560px, calc(100vw - 24px))', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, fontSize: 14,
          background: C.panel, border: `1px solid ${error ? '#ef4444' : '#22c55e'}`, color: error ? C.bad : C.ink2,
          boxShadow: '0 16px 40px -12px rgba(0,0,0,.6)',
        }}>
          <span style={{ minWidth: 0 }}>{error ?? note?.text}</span>
          {!error && note?.undo && <button type="button" onClick={note.undo} style={linkBtn}>Hoàn tác</button>}
          <button type="button" aria-label="Đóng" onClick={() => { setError(null); setNote(null); }} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <Icon name="x" size={16} color={C.sub} />
          </button>
        </div>
      )}
    </main>
  );
}

const screen: React.CSSProperties = { minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--c0b1120)' };
const linkBtn: React.CSSProperties = { border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink-link)', cursor: 'pointer', whiteSpace: 'nowrap' };
const benchLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', borderRadius: 10, flexShrink: 0,
  border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', textDecoration: 'none', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
};
const alertLine: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12,
  fontFamily: 'inherit', fontSize: 13, color: 'var(--ce2e8f0)', cursor: 'pointer', textAlign: 'left',
};

function SearchBox({ value, onChange, phone }: { value: string; onChange: (v: string) => void; phone?: boolean }) {
  return (
    <label style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: phone ? 44 : 40, padding: '0 12px',
      borderRadius: phone ? 12 : 10, background: C.soft, border: `1px solid ${C.border}`,
    }}>
      <Icon name="search" size={16} color={C.muted} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tìm tiệm theo tên…" aria-label="Tìm tiệm"
        style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: C.ink2, fontFamily: 'inherit', fontSize: phone ? 16 : 14 }} />
      {value && (
        <button type="button" aria-label="Xoá tìm kiếm" onClick={() => onChange('')} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex' }}>
          <Icon name="x" size={15} color={C.sub} />
        </button>
      )}
    </label>
  );
}

function PickButton({ picking, onClick, compact }: { picking: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={picking ? 'Thoát chọn nhiều' : 'Chọn nhiều'} title="Chọn nhiều tiệm để giao nhóm"
      style={{
        height: compact ? 44 : 40, padding: compact ? '0 11px' : '0 14px', borderRadius: compact ? 12 : 10, flexShrink: 0, cursor: 'pointer',
        background: picking ? '#6366f1' : 'transparent', border: `1px solid ${picking ? '#6366f1' : 'var(--c334155)'}`,
        color: picking ? '#ffffff' : 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7,
      }}>
      <Icon name={picking ? 'x' : 'checksq'} size={16} color={picking ? '#ffffff' : 'var(--ccbd5e1)'} />
      {!compact && (picking ? 'Thoát' : 'Chọn nhiều')}
    </button>
  );
}

/**
 * The order of the list. A native select laid over a quiet label at 16px, so
 * a phone opens its own picker without zooming the page.
 */
function SortPicker({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.body, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}>
      <Icon name="sort" size={14} color={C.sub} />
      {SORTS.find((s) => s.key === value)?.label}
      <Icon name="down" size={14} color={C.sub} />
      <select value={value} aria-label="Sắp xếp" onChange={(e) => onChange(e.target.value as SortKey)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, fontSize: 16, border: 0, cursor: 'pointer' }}>
        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </span>
  );
}

function SectionHead({ title, dot, n, note, pad, boxed }: { title: string; dot: string; n: number; note?: string; pad: string; boxed?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: pad,
      ...(boxed ? { background: C.soft, borderBottom: `1px solid ${C.line}` } : {}),
    }}>
      <Dot color={dot} size={8} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: C.ink2, textTransform: 'uppercase' }}>{title}</span>
      <span style={{ fontSize: 12, color: C.muted }}>{n}</span>
      {note && <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{note}</span>}
    </div>
  );
}

// ---- one salon ------------------------------------------------------------------

interface RowProps {
  t: TenantRow;
  today: string;
  term: TermState;
  fresh: boolean;
  team: string;
  pkg: ServicePackage | null;
  notice: RowNotice | null;
  picking: boolean;
  checked: boolean;
  opening: boolean;
  onCheck: () => void;
  onOpen: () => void;
  onEnter: (landing?: string) => void;
  onTell: () => void;
  /** Hand the shop to the next department, right from the row. */
  onNext: (n: WorkNext | '') => void;
}

/** The red/amber edge: the one mark that survives a squint. */
function Edge({ term }: { term: TermState }) {
  if (term !== 'expired' && term !== 'soon') return null;
  return <span aria-hidden style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: TERM_LOOK[term].bar }} />;
}

function rowShell(p: RowProps): React.HTMLAttributes<HTMLDivElement> & { style: React.CSSProperties } {
  const waiting = Boolean(p.notice) || (p.t.heldPosts ?? 0) > 0;
  const act = () => (p.picking ? p.onCheck() : p.onOpen());
  return {
    className: 'ag-row',
    role: 'button',
    tabIndex: 0,
    onClick: act,
    onKeyDown: (e) => { if (e.key === 'Enter') act(); },
    title: p.picking ? undefined : 'Bấm để xem chi tiết tiệm',
    style: {
      position: 'relative', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', opacity: p.opening ? 0.5 : 1,
      background: waiting ? 'rgba(239,68,68,.05)' : C.panel,
    },
  };
}

function Tags({ t, fresh }: { t: TenantRow; fresh: boolean }) {
  return (
    <>
      {fresh && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.good, border: '1px solid rgba(34,197,94,.6)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>MỚI</span>}
      {t.status === 'SUSPENDED' && (
        <span title="Tài khoản tiệm đang bị khoá đăng nhập — mở lại ở Super Admin"
          style={{ fontSize: 9.5, fontWeight: 800, color: C.bad, border: '1px solid #ef4444', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>KHOÁ</span>
      )}
    </>
  );
}

/** What this shop is waiting for — one red line that opens the newest item directly. */
function WaitLine({ t, notice, onEnter, size = 12 }: { t: TenantRow; notice: RowNotice | null; onEnter: (landing?: string) => void; size?: number }) {
  const base: React.CSSProperties = {
    border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: size, fontWeight: 700, color: 'var(--ink-bad)',
    cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', minWidth: 0,
  };
  if (notice) {
    return (
      <button type="button" style={base} onClick={(e) => { e.stopPropagation(); onEnter(notice.newest.link); }}
        title={`${notice.newest.who ? notice.newest.who + ': ' : ''}${notice.newest.preview || notice.newest.title} — bấm để mở`}>
        {notice.held ? '✏️' : '🔔'} {noticeSummary(notice)} · {agoShort(notice.newest.at)}
      </button>
    );
  }
  if ((t.heldPosts ?? 0) > 0) {
    return (
      <button type="button" style={base} onClick={(e) => { e.stopPropagation(); onEnter('/salon/content?tab=queue&work=held'); }} title="Tiệm yêu cầu sửa bài — bấm để mở">
        ✏️ {t.heldPosts} sửa bài
      </button>
    );
  }
  return null;
}

function Checkbox({ p }: { p: RowProps }) {
  if (!p.picking) return null;
  return (
    <input type="checkbox" checked={p.checked} onChange={p.onCheck} onClick={(e) => e.stopPropagation()} aria-label={`Chọn ${p.t.name}`}
      style={{ width: 17, height: 17, accentColor: '#6366f1', cursor: 'pointer', flex: '0 0 auto', margin: 0 }} />
  );
}

function MoreBtn({ onOpen, size = 32 }: { onOpen: () => void; size?: number }) {
  return (
    <button type="button" aria-label="Chi tiết" onClick={(e) => { e.stopPropagation(); onOpen(); }}
      style={{ width: size, height: size, borderRadius: 9, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
      <Icon name="dots" size={18} color={C.sub} />
    </button>
  );
}

const renewStateOf = (t: TenantRow) => renewStateOf0(t.serviceTerm);
const Sep = () => <span style={{ color: 'var(--c64748b)', opacity: 0.6 }}>·</span>;
function joinSep(parts: React.ReactNode[]) {
  const out: React.ReactNode[] = [];
  parts.filter(Boolean).forEach((x, i) => { if (i) out.push(<Sep key={`s${i}`} />); out.push(<span key={`p${i}`} style={{ display: 'inline-flex', flexShrink: 0 }}>{x}</span>); });
  return out;
}

/** The salon's name: opens its detail panel (term, package, team, notes…). */
function NameLink({ p, size }: { p: RowProps; size: number }) {
  return (
    <button type="button" className="ag-name" title="Xem chi tiết tiệm (thời hạn, gói, nhóm…)"
      onClick={(e) => { e.stopPropagation(); if (p.picking) p.onCheck(); else p.onOpen(); }}
      style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: size, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, cursor: 'pointer', textAlign: 'left' }}>
      {p.t.name}
    </button>
  );
}

/** Straight into the salon, right beside its name. */
function EnterBtn({ p }: { p: RowProps }) {
  if (p.picking) return null;
  const suspended = p.t.status === 'SUSPENDED';
  return (
    <button type="button" disabled={suspended} title={suspended ? 'Tiệm đang bị khoá — mở lại ở Super Admin' : 'Vào tiệm — mở phiên setup 8 tiếng'}
      onClick={(e) => { e.stopPropagation(); p.onEnter(); }}
      style={{ flexShrink: 0, height: 22, padding: '0 8px', borderRadius: 999, border: `1px solid ${suspended ? C.line : '#6366f1'}`, background: 'transparent', color: suspended ? C.muted : C.link, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: suspended ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
      {p.opening ? '…' : 'Vào ↗'}
    </button>
  );
}

/** Computer: one table row, fixed columns. */
function WideRow(p: RowProps) {
  const { t, today, term } = p;
  const shell = rowShell(p);
  return (
    <div {...shell} style={{
      ...shell.style, display: 'grid', gridTemplateColumns: p.picking ? `28px ${COLS}` : COLS, columnGap: 14, alignItems: 'center',
      minHeight: 60, padding: '8px 14px 8px 18px',
    }}>
      <Edge term={term} />
      {p.picking && <Checkbox p={p} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <NameLink p={p} size={14} />
          <EnterBtn p={p} />
          <MarketChip code={marketOf(t)} />
          <Tags t={t} fresh={p.fresh} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>
          <WaitLine t={t} notice={p.notice} onEnter={p.onEnter} />
          {!p.notice && !(t.heldPosts ?? 0) && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>/{t.slug}</span>}
          {(t.awaitingApproval ?? 0) > 0 && <span style={{ color: C.sub }}>· ⏳ {t.awaitingApproval} chờ duyệt</span>}
          {/* The channel squares, where the column used to be. */}
          <span style={{ marginLeft: 2, display: 'inline-flex' }}><ChannelSquares t={t} size={12} /></span>
        </span>
      </div>
      <div style={{ minWidth: 0, display: 'flex' }}><NextPicker next={t.workNext} onChange={p.onNext} disabled={p.picking} /></div>
      <div style={{ minWidth: 0 }}><BookingsCell pulse={t.pulse} /></div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}><GrowthText pulse={t.pulse} /></div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}><AdsText pulse={t.pulse} /></div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}><PackageText pkg={p.pkg} /></div>
      <div style={{ fontSize: 13, color: p.team ? C.body : C.warn, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team || 'Chưa giao'}</div>
      <div style={{ minWidth: 0 }}><StageText stage={t.opsStage ?? 'running'} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        {!p.picking && <RenewAction term={t.serviceTerm} today={today} onTell={p.onTell} />}
        {!p.picking && <MoreBtn onOpen={p.onOpen} />}
      </div>
    </div>
  );
}

/** Tablet: two lines on the left, channels in the middle, the term on the right. */
function TabletRow(p: RowProps) {
  const { t, today, term } = p;
  const shell = rowShell(p);
  const waitLine = <WaitLine t={t} notice={p.notice} onEnter={p.onEnter} size={12.5} />;
  return (
    <div {...shell} style={{ ...shell.style, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 6px 12px 18px' }}>
      <Edge term={term} />
      <Checkbox p={p} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <NameLink p={p} size={15} />
          <EnterBtn p={p} />
          <MarketChip code={marketOf(t)} />
          <Tags t={t} fresh={p.fresh} />
        </span>
        {(p.notice || (t.heldPosts ?? 0) > 0) && waitLine}
        <PulseWords pulse={t.pulse} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
          {joinSep([
            <NextPicker key="n" next={t.workNext} onChange={p.onNext} size="sm" disabled={p.picking} />,
            <PackageText key="p" pkg={p.pkg} size={12.5} />,
            <span key="t" style={{ color: p.team ? C.sub : C.warn }}>{p.team || 'Chưa giao'}</span>,
            <StageText key="s" stage={t.opsStage ?? 'running'} size={12.5} />,
            (t.awaitingApproval ?? 0) > 0 ? <span key="a">{t.awaitingApproval} chờ duyệt</span> : null,
          ])}
        </span>
      </div>
      <div style={{ width: 118, flexShrink: 0 }}><ChannelSquares t={t} size={16} /></div>
      <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <TermText term={t.serviceTerm} today={today} />
        {!p.picking && <RenewAction term={t.serviceTerm} today={today} onTell={p.onTell} size={11.5} />}
      </div>
      {!p.picking && <MoreBtn onOpen={p.onOpen} size={36} />}
    </div>
  );
}

/** Phone: three quiet lines — name and term; market · package · team; stage · next · channels. */
function PhoneRow(p: RowProps) {
  const { t, today, term } = p;
  const shell = rowShell(p);
  // The renewal action takes the end of line 3; what it pushes out is one tap away in the panel.
  const busyLine = !p.picking && (term === 'expired' || term === 'soon' || renewStateOf(t) === 'told');
  return (
    <div {...shell} style={{ ...shell.style, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 4px 12px 14px' }}>
      <Edge term={term} />
      {p.picking && <span style={{ paddingTop: 2 }}><Checkbox p={p} /></span>}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t.name}</span>
            <Tags t={t} fresh={p.fresh} />
          </span>
          {term !== 'none' && <TermText term={t.serviceTerm} today={today} />}
        </span>
        {(p.notice || (t.heldPosts ?? 0) > 0) && <WaitLine t={t} notice={p.notice} onEnter={p.onEnter} size={12.5} />}
        <span style={{ display: 'flex', minWidth: 0, overflow: 'hidden' }}><PulseWords pulse={t.pulse} size={12} /></span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
          {joinSep([
            <span key="m" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>{marketOf(t)}</span>,
            <PackageText key="p" pkg={p.pkg} size={12.5} />,
            <span key="t" style={{ color: p.team ? C.body : C.warn }}>{p.team || 'Chưa giao nhóm'}</span>,
          ])}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(90deg, #000 88%, transparent)', maskImage: 'linear-gradient(90deg, #000 88%, transparent)' }}>
            {joinSep([
              // The department picker leads: it is the thing people change most.
              <NextPicker key="n" next={t.workNext} onChange={p.onNext} size="sm" disabled={p.picking} />,
              <StageText key="s" stage={t.opsStage ?? 'running'} size={12} />,
              ...(busyLine ? [] : [
                <ChannelWords key="c" t={t} />,
                (t.awaitingApproval ?? 0) > 0 ? <span key="a" style={{ color: C.warn }}>{t.awaitingApproval} chờ duyệt</span> : null,
              ]),
            ])}
          </span>
          {!p.picking && <RenewAction term={t.serviceTerm} today={today} onTell={p.onTell} size={12} />}
        </span>
      </div>
      {!p.picking && <MoreBtn onOpen={p.onOpen} size={36} />}
    </div>
  );
}
