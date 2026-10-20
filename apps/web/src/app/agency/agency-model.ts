import type { ServiceTerm } from '../../lib/agency-term';

/** One salon on the agency list (GET /support/tenants). */
export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Which market the salon is in: US | CA | AU | VN. */
  market?: string | null;
  createdAt: string;
  /** Messenger/Instagram AI: on, off (Page connected for posting only), none (no Page). */
  bot?: 'on' | 'off' | 'none';
  /** The team's own label for where this shop is in the work. Not the access switch. */
  opsStage?: OpsStage;
  /** Which department is up next, picked by hand ('' = nobody picked). */
  workNext?: WorkNext | '';
  /** Scheduled posts the shop sent back with a note — each one is waiting on us. */
  heldPosts?: number;
  /** Scheduled posts the shop has not approved yet — waiting on THEM. */
  awaitingApproval?: number;
  /** Scheduled posts the shop has approved, still to go out — done on both sides. */
  approvedPosts?: number;
  /** The newest of those sign-offs. */
  lastApprovedAt?: string | null;
  /** Which Lumio service package the shop is on ('' = not recorded). */
  servicePackage?: string;
  /** How long Lumio's service runs, and this cycle's renewal mark. A label: it locks nothing. */
  serviceTerm?: ServiceTerm | null;
  /** The accounts this salon holds — Page, Instagram, Google location, TikTok, mailbox — by name. */
  connections?: { fbPage: string | null; igUser: string | null; google: string | null; googleEmail: string | null; tiktok: string | null; mail: string | null; fbLost?: { state: string; at: string } | null } | null;
  /** Kinds of account this salon shares with ANOTHER salon: google | tiktok | mail. Always a mistake. */
  sharedWith?: string[];
  /** Bookings this month, the growth verdict and the ads status (GET /support/tenants → salon-pulse). */
  pulse?: SalonPulse | null;
}

/** One salon's pulse, as the API computes it (apps/api/src/support/salon-pulse.ts). */
export interface SalonPulse {
  bookings: { month: number; lastSameSpan: number; lastMonth: number; series: number[]; pct: number | null };
  growth: { kind: GrowthKind; label: string; reason: string };
  ads: { kind: AdsKind; spendCents: number; bookings: number; perBookingCents: number | null; lastMonth: string | null };
}
export type GrowthKind = 'up' | 'flat' | 'down' | 'thin';
export type AdsKind = 'on' | 'warn' | 'off' | 'none';

export const GROWTH_LOOK: Record<GrowthKind, { label: string; ink: string; dot: string }> = {
  up: { label: 'Tăng', ink: 'var(--ink-good)', dot: '#22c55e' },
  flat: { label: 'Ổn định', ink: 'var(--ccbd5e1)', dot: '#64748b' },
  down: { label: 'Giảm', ink: 'var(--ink-bad)', dot: '#ef4444' },
  thin: { label: 'Chưa đủ dữ liệu', ink: 'var(--c94a3b8)', dot: '#475569' },
};
export const GROWTH_ORDER: GrowthKind[] = ['down', 'flat', 'up', 'thin'];
export const ADS_LOOK: Record<AdsKind, { label: string; ink: string; dot: string }> = {
  on: { label: 'Đang chạy', ink: 'var(--ink-good)', dot: '#22c55e' },
  warn: { label: 'Chạy, chưa ra booking', ink: 'var(--ink-warn)', dot: '#f59e0b' },
  off: { label: 'Đã dừng', ink: 'var(--c94a3b8)', dot: '#64748b' },
  none: { label: 'Chưa chạy', ink: 'var(--c94a3b8)', dot: '#475569' },
};
export const ADS_ORDER: AdsKind[] = ['warn', 'on', 'off', 'none'];

/** '2026-08' → 'T8/2026'. */
export function monthLabel(key: string | null | undefined): string {
  if (!key) return '';
  const [y, m] = key.split('-');
  return `T${Number(m)}/${y}`;
}
/** Whole dollars, the way the team talks about ad money: 40000 → '$400'. */
export function usd(cents: number): string {
  const d = Math.round(cents / 100);
  return `$${d.toLocaleString('en-US')}`;
}

/** One Lumio service package (GET /support/packages). tier 4 = the most care. */
export interface ServicePackage { key: string; name: string; family: 'social' | 'maps'; priceUsd: number; tier: 1 | 2 | 3 | 4 }
export type WorkNext = 'content' | 'design' | 'review' | 'schedule' | 'done';
export type OpsStage = 'setup' | 'running' | 'paused' | 'stopped';

/** The salon list as one employee reads it: their team open, the rest folded. */
export interface BoardGroup { team: string; label: string; mine: boolean; open: boolean; newCount?: number; salons: { id: string; name: string; supportTeam?: string | null; isNew?: boolean }[] }
export interface Board { myTeam: string | null; canAssign?: boolean; groups: BoardGroup[]; teams: { team: string; label: string; salons: number; members: string[] }[] }

/**
 * Where a salon is in the team's work. The team's own label (see
 * api/src/support/ops-stage.ts), not the account's access status: picking
 * "Tạm ngưng" locks nobody out. The real lock is the separate KHOÁ.
 */
export const STAGE_LOOK: Record<OpsStage, { label: string; dot: string; ink: string }> = {
  setup: { label: 'Chờ setup', dot: '#f59e0b', ink: 'var(--ink-warn)' },
  running: { label: 'Đang chạy', dot: '#22c55e', ink: 'var(--ccbd5e1)' },
  paused: { label: 'Tạm ngưng', dot: '#38bdf8', ink: 'var(--ccbd5e1)' },
  stopped: { label: 'Ngưng hoàn toàn', dot: '#64748b', ink: 'var(--c94a3b8)' },
};
export const STAGE_ORDER: OpsStage[] = ['setup', 'running', 'paused', 'stopped'];

/** Who is up next on this salon — picked by hand by whoever just finished their part. */
/**
 * Each department has its own colour, so a column of these reads at a glance:
 * which shops sit with Design, which wait for review, which are done.
 */
export const NEXT_LOOK: Record<WorkNext, { label: string; icon: string; fg: string; bg: string; bd: string }> = {
  content: { label: 'Chờ Content', icon: '✍️', fg: 'var(--ink-warn)', bg: 'rgba(245,158,11,.14)', bd: 'rgba(245,158,11,.55)' },
  design: { label: 'Chờ Design', icon: '🎨', fg: '#ec4899', bg: 'rgba(236,72,153,.13)', bd: 'rgba(236,72,153,.55)' },
  review: { label: 'Chờ Duyệt', icon: '👀', fg: 'var(--ink-link)', bg: 'rgba(99,102,241,.15)', bd: 'rgba(99,102,241,.6)' },
  schedule: { label: 'Chờ Lên lịch', icon: '🗓️', fg: 'var(--ink-sky)', bg: 'rgba(56,189,248,.13)', bd: 'rgba(56,189,248,.55)' },
  done: { label: 'Xong', icon: '✅', fg: 'var(--ink-good)', bg: 'rgba(34,197,94,.13)', bd: 'rgba(34,197,94,.55)' },
};
export const NEXT_ORDER: WorkNext[] = ['content', 'design', 'review', 'schedule', 'done'];

/** Colour climbs with the care the package buys: grey → blue → violet → gold. */
export const TIER_DOT: Record<number, string> = { 4: '#f59e0b', 3: '#8b5cf6', 2: '#3b82f6', 1: '#94a3b8' };

/**
 * The salon's market, as two letters in its own colour. Letters, not flags:
 * Windows has no glyph for a flag emoji.
 */
export const MARKET_ORDER = ['US', 'CA', 'AU', 'VN'] as const;
export const MARKET_LOOK: Record<string, { name: string; fg: string; bg: string; border: string }> = {
  US: { name: 'Mỹ', fg: 'var(--c93c5fd)', bg: 'rgba(59,130,246,.14)', border: '#3b82f6' },
  CA: { name: 'Canada', fg: 'var(--cfca5a5)', bg: 'rgba(239,68,68,.12)', border: '#ef4444' },
  AU: { name: 'Úc', fg: 'var(--cfcd34d)', bg: 'rgba(245,158,11,.14)', border: '#f59e0b' },
  VN: { name: 'Việt Nam', fg: 'var(--c86efac)', bg: 'rgba(34,197,94,.13)', border: '#22c55e' },
};
export function marketOf(t: { market?: string | null }): string {
  const m = String(t.market ?? 'US').trim().toUpperCase();
  return (MARKET_ORDER as readonly string[]).includes(m) ? m : 'US';
}

/** "3 phút trước" — the freshness is the point of the list. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hôm qua' : `${d} ngày trước`;
}

// ---- the channel strip ------------------------------------------------------

const CONNECTED = new Set(['connected', 'gmail', 'brevo']);
function friendly(v: string | null): string | null {
  if (!v) return null;
  return v.split(', ').map((x) => (CONNECTED.has(x) ? 'Đã kết nối' : x)).join(', ');
}
/** "glow nails & spa" vs "Glow Nails and Spa - Austin": the same shop? Loose on purpose; it flags, never decides. */
export function sameShop(account: string | null, salon: string): boolean {
  if (!account) return true;
  const first = account.split(', ')[0];
  if (CONNECTED.has(first)) return true; // no name to compare
  // Digits go too: "@5point.nails.spa" is "5 Points Nails & Spa"; a year in a handle is not a different shop.
  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^@/, '').replace(/[^a-z ]+/g, ' ').replace(/\b(nails?|spa|salon|and|the|llc|inc|beauty|studio|lounge|bar)\b/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const a = norm(first); const b = norm(salon);
  if (!a.length || !b.length) return true; // nothing distinctive to compare (e.g. "Nails & Spa")
  const joinedA = a.join(''); const joinedB = b.join('');
  if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) return true;
  const hit = a.filter((w) => b.some((v) => v.includes(w) || w.includes(v))).length;
  return hit / Math.min(a.length, b.length) >= 0.5;
}

export interface ChannelCell { k: string; icon: string; label: string; v: string | null; extra?: string; tone: 'on' | 'off' | 'warn' | 'bad'; /** Why the cell is red/amber, when it is not the shared-account case. */ why?: string }

/** The Page token is dead — one short reason per state (api: messenger/page-health.ts). */
export const FB_LOST_LABEL: Record<string, string> = {
  role_lost: 'tài khoản kết nối mất vai trò trên Trang',
  two_factor: 'Business yêu cầu xác thực 2 lớp',
  checkpoint: 'Facebook tạm chặn tài khoản đã kết nối — cần đăng nhập facebook.com',
  expired: 'kết nối hết hạn',
  revoked: 'Facebook thu hồi kết nối',
};
export function fbLostLabel(state: string | null | undefined): string {
  return (state && FB_LOST_LABEL[state]) || 'mất kết nối';
}

/**
 * Five accounts in a fixed order (inbox · Instagram · Google · TikTok · mail).
 * GREEN = connected, GREY = not yet, AMBER = connected but the account's name
 * does not look like this salon's, RED = the same account sits under another
 * salon too.
 */
export function channelCells(t: TenantRow): { cells: ChannelCell[]; n: number; worry: string | null } | null {
  const c = t.connections;
  if (!c) return null;
  const shared = new Set(t.sharedWith ?? []);
  // A dead Page token takes Instagram down with it: both ride the same connection.
  const lost = c.fbPage && c.fbLost ? `MẤT KẾT NỐI — ${fbLostLabel(c.fbLost.state)}` : null;
  const inboxState = lost ?? (c.fbPage ? (t.bot === 'on' ? 'bot bật' : t.bot === 'off' ? 'chỉ đăng bài' : 'đã nối') : undefined);
  const raw = [
    { k: 'fb', icon: '💬', label: 'Messenger', v: friendly(c.fbPage), mismatch: !sameShop(c.fbPage, t.name), extra: inboxState, why: lost ?? undefined },
    { k: 'ig', icon: '📷', label: 'Instagram', v: friendly(c.igUser), mismatch: !sameShop(c.igUser, t.name), why: c.igUser && lost ? lost : undefined },
    { k: 'google', icon: 'G', label: 'Google', v: friendly(c.google), mismatch: !sameShop(c.google, t.name), extra: c.googleEmail ?? undefined },
    { k: 'tiktok', icon: '♪', label: 'TikTok', v: friendly(c.tiktok), mismatch: !sameShop(c.tiktok, t.name) },
    { k: 'mail', icon: '✉', label: 'Email gửi đi', v: friendly(c.mail), mismatch: false },
  ];
  const cells: ChannelCell[] = raw.map((x) => ({
    k: x.k, icon: x.icon, label: x.label, v: x.v, extra: x.extra, why: 'why' in x ? x.why : undefined,
    tone: shared.has(x.k) ? 'bad' : !x.v ? 'off' : ('why' in x && x.why) ? 'bad' : x.mismatch ? 'warn' : 'on',
  }));
  const n = cells.filter((x) => x.v).length;
  const bad = cells.filter((x) => x.tone === 'bad');
  const warn = cells.filter((x) => x.tone === 'warn');
  const worry = lost ? 'mất kết nối Facebook — cần kết nối lại Trang'
    : bad.length ? 'trùng tài khoản với tiệm khác' : warn.length ? `kiểm tra ${warn.map((x) => x.label).join(', ')}` : null;
  return { cells, n, worry };
}
