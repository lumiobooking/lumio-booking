/**
 * THE FIRST COMMENTS UNDER A PUBLISHED POST — booking link, the running
 * offer, phone, address — written by the Page itself a few minutes after the
 * post goes up, the way the team used to type them by hand.
 *
 * Pure: settings in, a plan out. The network calls (Graph
 * POST /{post-id}/comments, POST /{ig-media-id}/comments) live in
 * social-publish.service; the sweep runs the plan a minute at a time.
 *
 * Meta: Facebook needs pages_manage_engagement, Instagram
 * instagram_manage_comments. Under Standard Access both work for Pages
 * connected by an account that has a role on the Lumio app (Tester /
 * Developer / Admin) — no App Review. A token without them fails with #200
 * / #10, which explainCommentError turns into "add the account as a Tester,
 * reconnect the Page".
 */

export type CommentChannel = 'facebook' | 'instagram';
export const COMMENT_CHANNELS: CommentChannel[] = ['facebook', 'instagram'];

export interface CommentTemplate {
  id: string;
  /** With placeholders: %booking_url% %promo% %phone% %address% %website% %salon%. */
  text: string;
  on: boolean;
  channels: CommentChannel[];
}

export interface AutoCommentSettings {
  enabled: boolean;
  /** Minutes after the post goes live before the first comment. */
  delayMin: number;
  /** Minutes between comments. */
  gapMin: number;
  /** At most this many comments per post per channel. */
  max: number;
  templates: CommentTemplate[];
}

export const PLACEHOLDERS = ['%booking_url%', '%promo%', '%phone%', '%address%', '%website%', '%salon%'] as const;

/** What a template prints, for the shop. Empty / null = that placeholder cannot be filled. */
export interface CommentFacts {
  salon: string;
  bookingUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  /** The offer running today, one line, or null when nothing runs. */
  promo?: string | null;
}

export const LIMITS = { delayMin: [0, 120], gapMin: [1, 60], max: [1, 5], templates: 8, text: 1500 } as const;

/** The templates a shop starts with. Vietnamese for VN, English elsewhere. */
export function defaultTemplates(vi: boolean): CommentTemplate[] {
  return vi
    ? [
      { id: 'booking', on: true, channels: ['facebook', 'instagram'], text: '✨ Đặt lịch online bất cứ lúc nào: %booking_url%' },
      { id: 'promo', on: true, channels: ['facebook', 'instagram'], text: '🎁 %promo% — đặt lịch ngay: %booking_url%' },
      { id: 'contact', on: true, channels: ['facebook'], text: '📞 Gọi hoặc nhắn %phone% — tiệm giữ chỗ cho bạn.' },
      { id: 'address', on: false, channels: ['facebook'], text: '📍 %address%' },
    ]
    : [
      { id: 'booking', on: true, channels: ['facebook', 'instagram'], text: '✨ Browse services and book online anytime: %booking_url%' },
      { id: 'promo', on: true, channels: ['facebook', 'instagram'], text: '🎁 %promo% — book now: %booking_url%' },
      { id: 'contact', on: true, channels: ['facebook'], text: '📞 Call or text %phone% and we\'ll save you a spot.' },
      { id: 'address', on: false, channels: ['facebook'], text: '📍 Find us at %address%' },
    ];
}

export function defaultSettings(vi: boolean): AutoCommentSettings {
  return { enabled: false, delayMin: 3, gapMin: 2, max: 3, templates: defaultTemplates(vi) };
}

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const cleanChannels = (v: unknown): CommentChannel[] => {
  const arr = Array.isArray(v) ? v.filter((c): c is CommentChannel => c === 'facebook' || c === 'instagram') : [];
  return arr.length ? Array.from(new Set(arr)) : ['facebook', 'instagram'];
};

/** A stored or submitted settings blob, made safe. Unknown = the defaults. */
export function cleanAutoComments(raw: unknown, vi: boolean): AutoCommentSettings {
  const d = defaultSettings(vi);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const tpls = Array.isArray(r.templates) ? r.templates : null;
  const templates: CommentTemplate[] = tpls === null ? d.templates : tpls.slice(0, LIMITS.templates).flatMap((t, i) => {
    if (!t || typeof t !== 'object') return [];
    const o = t as Record<string, unknown>;
    const text = String(o.text ?? '').trim().slice(0, LIMITS.text);
    if (!text) return [];
    return [{ id: String(o.id ?? '').trim().slice(0, 40) || `t${i + 1}`, text, on: o.on !== false, channels: cleanChannels(o.channels) }];
  });
  return {
    enabled: r.enabled === true,
    delayMin: clampInt(r.delayMin, LIMITS.delayMin, d.delayMin),
    gapMin: clampInt(r.gapMin, LIMITS.gapMin, d.gapMin),
    max: clampInt(r.max, LIMITS.max, d.max),
    templates,
  };
}

/** Per-post say: off, or the shop's own list for this post. Null = the shop's defaults. */
export interface PostCommentOverride {
  off?: boolean;
  items?: { text: string; channels: CommentChannel[] }[];
}

export function cleanPostComments(raw: unknown): PostCommentOverride | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.off === true) return { off: true };
  if (!Array.isArray(r.items)) return null;
  const items = r.items.slice(0, LIMITS.templates).flatMap((t) => {
    if (!t || typeof t !== 'object') return [];
    const text = String((t as { text?: unknown }).text ?? '').trim().slice(0, LIMITS.text);
    return text ? [{ text, channels: cleanChannels((t as { channels?: unknown }).channels) }] : [];
  });
  return { items };
}

/**
 * Fill a template. Null when a placeholder it needs has no value — a comment
 * reading "book here: " with nothing after the colon is worse than none.
 */
export function fillComment(text: string, f: CommentFacts): string | null {
  const vals: Record<string, string | null | undefined> = {
    '%booking_url%': f.bookingUrl, '%promo%': f.promo, '%phone%': f.phone, '%address%': f.address, '%website%': f.website, '%salon%': f.salon,
  };
  let out = text;
  for (const [k, v] of Object.entries(vals)) {
    if (!out.includes(k)) continue;
    const val = (v ?? '').trim();
    if (!val) return null;
    out = out.split(k).join(val);
  }
  return out.trim() || null;
}

export interface PostedTarget { channel: CommentChannel; id: string }

export interface CommentJob {
  channel: CommentChannel;
  /** The Facebook post id or Instagram media id the comment goes under. */
  targetId: string;
  text: string;
  dueAt: string;
  status: 'pending' | 'posted' | 'failed';
  /** The comment's own id once posted. */
  id?: string | null;
  error?: string | null;
  at?: string | null;
  attempts?: number;
}

/**
 * The comments to write under a post that just went live: the shop's
 * templates (or this post's own list), filled, deduped, capped, spaced out
 * per channel. Empty when the feature is off, the post opted out, or no
 * template can be filled.
 */
export function planComments(args: {
  settings: AutoCommentSettings;
  override: PostCommentOverride | null;
  facts: CommentFacts;
  targets: PostedTarget[];
  postedAt: Date;
}): CommentJob[] {
  const { settings, override, facts, targets, postedAt } = args;
  if (override?.off) return [];
  const source: { text: string; channels: CommentChannel[] }[] = override?.items
    ? override.items
    : settings.enabled ? settings.templates.filter((t) => t.on) : [];
  if (!source.length) return [];
  const jobs: CommentJob[] = [];
  for (const ch of COMMENT_CHANNELS) {
    const target = targets.find((t) => t.channel === ch && t.id);
    if (!target) continue;
    const seen = new Set<string>();
    let n = 0;
    for (const t of source) {
      if (!t.channels.includes(ch)) continue;
      const text = fillComment(t.text, facts);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      if (n >= settings.max) break;
      const dueAt = new Date(postedAt.getTime() + (settings.delayMin + n * settings.gapMin) * 60_000);
      jobs.push({ channel: ch, targetId: target.id, text, dueAt: dueAt.toISOString(), status: 'pending', attempts: 0 });
      n++;
    }
  }
  return jobs;
}

/** The offer running today, as one line for %promo% — or null when none runs. */
/** "… khi đặt lịch online" / "… for walk-ins": who the promotion is for (settings/promo-channel). */
function promoFor(x: { appliesTo?: unknown } | null | undefined, vi: boolean): string {
  const c = x?.appliesTo;
  if (c === 'online') return vi ? ' khi đặt lịch online' : ' when you book online';
  if (c === 'walkin') return vi ? ' cho khách walk-in' : ' for walk-ins';
  return '';
}

export function promoLine(p: {
  today: string; // salon-local YYYY-MM-DD
  weekday: number; // 0 = Sunday, salon-local
  dates?: { enabled: boolean; rules: { startDate: string; endDate: string | null; percent: number; label?: string; appliesTo?: string }[] } | null;
  weekdays?: { enabled: boolean; message?: string; rules: { weekday?: number; day?: number; percent: number }[]; startDate?: string | null; endDate?: string | null; appliesTo?: string } | null;
  firstVisit?: { enabled: boolean; percent: number; message?: string; startDate?: string | null; endDate?: string | null; appliesTo?: string } | null;
  group?: { enabled: boolean; message?: string; tiers: { minSize: number; percent: number }[]; startDate?: string | null; endDate?: string | null; appliesTo?: string } | null;
}, vi: boolean): string | null {
  const inWin = (s?: string | null, e?: string | null) => (!s || s <= p.today) && (!e || e >= p.today);
  // 1. A named date promo running today beats everything: it has a name and an end.
  if (p.dates?.enabled) {
    const live = p.dates.rules.filter((r) => r.startDate <= p.today && (r.endDate ?? r.startDate) >= p.today && r.percent > 0)
      .sort((a, b) => b.percent - a.percent)[0];
    if (live) {
      const name = (live.label ?? '').trim();
      const until = live.endDate && live.endDate !== live.startDate ? live.endDate : null;
      const d = until ? `${until.slice(8, 10)}/${until.slice(5, 7)}` : null;
      return vi
        ? `Giảm ${live.percent}%${promoFor(live, vi)}${name ? ` · ${name}` : ''}${d ? ` đến ${d}` : ' hôm nay'}`
        : `${live.percent}% off${promoFor(live, vi)}${name ? ` · ${name}` : ''}${d ? ` until ${d}` : ' today'}`;
    }
  }
  // 2. Today's weekday discount.
  if (p.weekdays?.enabled && inWin(p.weekdays.startDate, p.weekdays.endDate)) {
    const r = p.weekdays.rules.find((x) => (x.weekday ?? x.day) === p.weekday && x.percent > 0);
    if (r) return vi ? `Giảm ${r.percent}% hôm nay${promoFor(p.weekdays, vi)}` : `${r.percent}% off today${promoFor(p.weekdays, vi)}`;
  }
  // 3. Standing programmes.
  if (p.firstVisit?.enabled && p.firstVisit.percent > 0 && inWin(p.firstVisit.startDate, p.firstVisit.endDate)) {
    return vi ? `Khách mới giảm ${p.firstVisit.percent}%${promoFor(p.firstVisit, vi)}` : `${p.firstVisit.percent}% off your first visit${promoFor(p.firstVisit, vi)}`;
  }
  if (p.group?.enabled && p.group.tiers.length && inWin(p.group.startDate, p.group.endDate)) {
    const t = [...p.group.tiers].sort((a, b) => a.minSize - b.minSize)[0];
    return vi ? `Nhóm từ ${t.minSize} người giảm ${t.percent}%${promoFor(p.group, vi)}` : `Groups of ${t.minSize}+ get ${t.percent}% off${promoFor(p.group, vi)}`;
  }
  return null;
}

/** Meta's error for a failed comment, in words the team can act on. */
export function explainCommentError(raw: string | null | undefined, vi = true): string {
  const e = (raw ?? '').toLowerCase();
  if (e.includes('pages_manage_engagement') || e.includes('instagram_manage_comments') || e.includes('#200') || e.includes('#10') || e.includes('permission')) {
    return vi
      ? 'Trang chưa có quyền bình luận (pages_manage_engagement / instagram_manage_comments). Thêm tài khoản đã kết nối Trang vào Testers của app Meta, rồi Kết nối lại Trang.'
      : 'The Page token lacks comment rights (pages_manage_engagement / instagram_manage_comments). Add the connecting account as a Tester on the Meta app, then reconnect the Page.';
  }
  if (e.includes('#190') || e.includes('session has expired') || e.includes('impersonate')) {
    return vi ? 'Kết nối Facebook đã mất — xem Cài đặt → Messenger.' : 'The Facebook connection is lost — see Settings → Messenger.';
  }
  if (e.includes('#4') || e.includes('#17') || e.includes('#32') || e.includes('#613') || e.includes('rate limit') || e.includes('limit')) {
    return vi ? 'Facebook đang giới hạn tần suất — sẽ thử lại sau.' : 'Facebook is rate-limiting — will retry later.';
  }
  if (e.includes('#100') && e.includes('comment')) {
    return vi ? 'Bài này tắt bình luận hoặc không bình luận được (bài video/Reel chưa xử lý xong).' : 'Comments are off for this post, or it cannot be commented on yet.';
  }
  return raw?.trim() || (vi ? 'Không gửi được bình luận.' : 'Could not post the comment.');
}

/** True for an error worth retrying (rate limit, network); false for a dead token / missing permission. */
export function commentRetryable(raw: string | null | undefined): boolean {
  const e = (raw ?? '').toLowerCase();
  if (!e) return true;
  if (e.includes('permission') || e.includes('#200') || e.includes('#10') || e.includes('#190') || e.includes('impersonate') || e.includes('expired')) return false;
  return true;
}

export const COMMENT_MAX_ATTEMPTS = 3;

/** Which jobs the sweep runs now, in order; never one already posted or given up on. */
export function dueComments(jobs: CommentJob[], now: Date): CommentJob[] {
  return jobs.filter((j) => j.status === 'pending' && new Date(j.dueAt).getTime() <= now.getTime() && (j.attempts ?? 0) < COMMENT_MAX_ATTEMPTS);
}

export function commentSummary(jobs: CommentJob[] | null | undefined): { posted: number; failed: number; pending: number } {
  const s = { posted: 0, failed: 0, pending: 0 };
  for (const j of jobs ?? []) {
    if (j.status === 'posted') s.posted++;
    else if (j.status === 'failed') s.failed++;
    else s.pending++;
  }
  return s;
}
