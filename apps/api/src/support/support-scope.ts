import { ALL_CAPS, type Capability } from '../auth/capabilities';

/**
 * How much of a salon a Lumio setup employee may see once they are inside it.
 *
 * WHY THIS EXISTS
 *
 * A support session borrows the SALON_ADMIN role so that every existing guard
 * "just works" (see support.service). That was the right call for isolation and
 * the wrong one for privacy: it also handed a content writer the salon's
 * revenue chart, its customer phone numbers, its payroll and its Stripe
 * billing. The agency has six employees covering many salons; each of them
 * needs a different slice, and none of them needs the takings.
 *
 * So the borrowed role stays — isolation is not the thing to weaken — and a
 * LEVEL is attached to the employee. The level becomes an explicit capability
 * list, baked into the session token, which the existing capability machinery
 * already knows how to enforce and the existing nav already knows how to read.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No per-salon assignment, and no read/write split. Both are real wants and
 * both would double the surface; the honest version of this feature is "which
 * screens", answered once per employee.
 *
 * THE THREE LEVELS ARE PRESETS NOW, NOT THE WHOLE ANSWER
 *
 * Three buckets fit the first six employees and stopped fitting soon after.
 * A person who answers the inbox and nothing else, a person who may also see
 * the calendar because they reschedule, a bookkeeper who needs reports and no
 * marketing — none of them is 'content', 'setup' or 'full', and picking the
 * nearest one either hands over too much or blocks the work.
 *
 * So an employee may carry an explicit capability list, and when they do it
 * REPLACES the preset. The presets stay, because ticking twenty boxes for
 * every new starter is how a permission system ends up with everyone on
 * 'full'.
 *
 * The safety property from `levelOf` is carried over exactly: an unknown,
 * empty or corrupted list must never read as "everything". It falls back to
 * the preset, and the preset for garbage is `setup`.
 */
export type SupportLevel = 'content' | 'setup' | 'full';

/**
 * The money screens. Out of every level except `full`, and named as a list
 * rather than spelled out three times so "is payroll money?" has one answer.
 */
const MONEY: Capability[] = [
  'dashboard', // the salon's revenue chart and today's takings live here
  'pos', 'orders', 'payments', 'payroll', 'reports', 'billing', 'inventory',
];

/**
 * The customer's own data. Out of every level except `full`.
 *
 * A setup employee does not need a single customer's phone number to connect a
 * Facebook Page, and the salon never agreed to hand its list to six people at
 * an agency. `calendar`/`bookings` are here for the same reason: an appointment
 * IS a named customer at a named time.
 */
const CLIENT_DATA: Capability[] = ['customers', 'calendar', 'bookings', 'walkins', 'waitlist'];

const SETUP_CAPS: Capability[] = ALL_CAPS.filter(
  (c) => !MONEY.includes(c) && !CLIENT_DATA.includes(c),
);

/**
 * Writing and running the marketing, and nothing else.
 *
 * `services` is deliberately absent. A content writer needs to READ the menu
 * to write about it, which the API rule below allows; they do not need to
 * change a price, and the one time somebody does it by accident it goes out on
 * the salon's own booking page.
 */
const CONTENT_CAPS: Capability[] = ['reviews', 'marketing'];

/**
 * The capabilities whose DATA is private, not merely out of scope.
 *
 * The distinction runs through the whole rule below. Lacking `settings` means
 * "you do not change the salon's settings" — but half the screens read
 * `/settings` for the currency symbol, so refusing the read would break pages
 * the employee is supposed to use. Lacking `customers` means something else
 * entirely: there is no page, no field and no reason. So money and client data
 * are refused outright, and everything else is readable but not writable.
 */
const PRIVATE: Capability[] = [...MONEY, ...CLIENT_DATA];

export function isPrivateCap(cap: Capability): boolean {
  return PRIVATE.includes(cap);
}

export function capsForLevel(level: SupportLevel): Capability[] {
  if (level === 'full') return [...ALL_CAPS];
  if (level === 'content') return [...CONTENT_CAPS];
  return [...SETUP_CAPS];
}

/**
 * Keep only the strings that are really capabilities, in a stable order.
 *
 * The stored list is data that has been through a form, a JSON column and
 * possibly a hand-written API call. A name this build does not know — a
 * capability that was renamed, or a typo — is dropped rather than carried,
 * because a permission system that keeps values it cannot interpret is one
 * that cannot say what it grants.
 */
export function cleanCaps(raw: unknown): Capability[] {
  const want = new Set(
    (Array.isArray(raw) ? raw : [])
      .map((v) => String(v ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  return ALL_CAPS.filter((c) => want.has(c));
}

/**
 * What this employee may actually see: their own list when they have one, the
 * level's preset when they do not.
 *
 * A list that survives cleaning to nothing is treated as no list at all. That
 * is deliberate and it is the safe direction: the alternative reading — "an
 * empty list means no capabilities" — locks a real person out of every screen
 * on a typo, and the person it locks out is the one covering a salon at the
 * time. Falling back to the preset is visible and recoverable; a blank app is
 * neither.
 */
export function capsFor(level: SupportLevel, custom?: unknown): Capability[] {
  const picked = cleanCaps(custom);
  return picked.length ? picked : capsForLevel(level);
}

/** Does this employee carry a hand-picked list rather than a preset? */
export function isCustomScope(custom?: unknown): boolean {
  return cleanCaps(custom).length > 0;
}

/**
 * Every capability, with what it is called and whether its DATA is private.
 *
 * The Super Admin screen needs to draw twenty-one checkboxes without inventing
 * its own names for them, and it needs to mark the ones that expose money or
 * customers — those are the ticks somebody should think twice about, and a
 * list that does not say so invites a click that hands over a salon's takings.
 */
export const CAP_CATALOG: { id: Capability; label: string; private: boolean }[] = [
  { id: 'dashboard', label: 'Tổng quan (có doanh thu)', private: true },
  { id: 'calendar', label: 'Lịch hẹn', private: true },
  { id: 'bookings', label: 'Danh sách booking', private: true },
  { id: 'walkins', label: 'Khách vãng lai', private: true },
  { id: 'waitlist', label: 'Danh sách chờ', private: true },
  { id: 'customers', label: 'Khách hàng (tên, số điện thoại)', private: true },
  { id: 'pos', label: 'Tính tiền (POS)', private: true },
  { id: 'orders', label: 'Hoá đơn', private: true },
  { id: 'payments', label: 'Thanh toán thẻ', private: true },
  { id: 'payroll', label: 'Lương thợ', private: true },
  { id: 'reports', label: 'Báo cáo doanh thu', private: true },
  { id: 'billing', label: 'Hoá đơn dịch vụ Lumio', private: true },
  { id: 'inventory', label: 'Kho hàng', private: true },
  { id: 'services', label: 'Bảng dịch vụ & giá', private: false },
  { id: 'products', label: 'Sản phẩm bán lẻ', private: false },
  { id: 'staff', label: 'Thợ & ca làm', private: false },
  { id: 'marketing', label: 'Marketing, hộp thư, đăng bài', private: false },
  { id: 'reviews', label: 'Đánh giá Google', private: false },
  { id: 'notifications', label: 'Nhắc hẹn & thông báo', private: false },
  { id: 'integrations', label: 'Kết nối kênh', private: false },
  { id: 'settings', label: 'Cài đặt tiệm', private: false },
];

/**
 * A stored value into a level.
 *
 * Unknown, missing or garbage all land on `setup`, never on `full`: the rows
 * that existed before this column did were created when a setup account saw
 * everything, and reading them as "full" would preserve exactly the problem
 * this module was written to end.
 */
export function levelOf(raw: unknown): SupportLevel {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'full' || s === 'content' ? s : 'setup';
}

/** What each level is called on screen, and what it means in one line. */
export const SUPPORT_LEVELS: { id: SupportLevel; label: string; blurb: string }[] = [
  {
    id: 'content',
    label: 'Nội dung & marketing',
    blurb: 'Lịch đăng bài, kế hoạch marketing, đánh giá, bảng dịch vụ. Không thấy tiền, khách, cài đặt.',
  },
  {
    id: 'setup',
    label: 'Setup toàn diện (trừ tiền & khách)',
    blurb: 'Thêm dịch vụ, thợ, kết nối kênh, cài đặt tiệm. Không thấy doanh thu, POS, lương, hoá đơn, danh sách khách.',
  },
  {
    id: 'full',
    label: 'Toàn quyền như chủ tiệm',
    blurb: 'Thấy mọi thứ trong tiệm, kể cả doanh thu và dữ liệu khách. Chỉ nên cấp cho người quản lý.',
  },
];

// ---- the API side of the same rule -----------------------------------------

/**
 * Which capability owns which API path.
 *
 * Hiding a menu item is decoration; this table is the part that means it. A
 * path is matched on its leading segments, longest first, so `pos/report`
 * belongs to `reports` while `pos` belongs to `pos`.
 *
 * Anything NOT listed is allowed: sign-in, the employee's own account, uploads,
 * health, the public endpoints and the support module itself. An allow-list
 * would have been the safer default in the abstract and the wrong one here — a
 * new endpoint that nobody remembered to list would break a working session in
 * front of a client, and the sensitive surfaces are a closed, known set.
 */
const PATH_CAPS: [string, Capability][] = [
  // money
  ['pos/report', 'reports'],
  ['pos/held', 'pos'],
  ['pos', 'pos'],
  ['print-jobs', 'pos'],
  ['display', 'pos'],
  ['gift-cards', 'pos'],
  ['payments-hub', 'payments'],
  ['payments', 'payments'],
  ['billing', 'billing'],
  ['stats', 'reports'],
  ['overview', 'dashboard'],
  ['supplies', 'inventory'],
  ['referral', 'billing'],
  // the customer's own data
  ['customers', 'customers'],
  ['bookings', 'bookings'],
  ['walkins', 'walkins'],
  ['waitlist', 'waitlist'],
  ['activity', 'bookings'],
  // the rest of the salon
  ['services', 'services'],
  ['menu-items', 'services'],
  ['tables', 'services'],
  // Per-technician takings and commission. Money wearing a staff URL — and the
  // reason `staff` alone is not enough to decide this one.
  ['staff/performance', 'payroll'],
  ['staff', 'staff'],
  ['stations', 'staff'],
  ['my-chair', 'staff'],
  ['reviews', 'reviews'],
  ['google-reviews', 'reviews'],
  ['marketing', 'marketing'],
  ['campaigns', 'marketing'],
  ['email-campaigns', 'marketing'],
  ['content', 'marketing'],
  ['messenger', 'marketing'],
  ['voice', 'marketing'],
  ['zalo', 'marketing'],
  ['notifications', 'notifications'],
  ['push', 'notifications'],
  ['integrations', 'integrations'],
  ['api-keys', 'integrations'],
  // Two settings sub-trees that belong to the work rather than to the salon's
  // configuration. Longest match wins, so these are lifted out of `settings`:
  // the marketing screen SAVES the business profile it plans from, and the
  // review screen saves its own rules. Leaving them under `settings` would
  // give a content account a page it can open and cannot save.
  ['settings/business-profile', 'marketing'],
  ['settings/review', 'reviews'],
  ['settings', 'settings'],
  ['trash', 'settings'],
];

/** The path with its leading slash, query string and api prefix removed. */
export function normalizePath(raw: unknown): string {
  let p = String(raw ?? '').split('?')[0].trim();
  p = p.replace(/^https?:\/\/[^/]+/i, '');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === 'api' || p.startsWith('api/')) p = p.slice(4);
  return p.replace(/^\/+/, '');
}

/** Which capability this API path belongs to, or null when it belongs to none. */
export function capForApiPath(raw: unknown): Capability | null {
  const p = normalizePath(raw);
  if (!p) return null;
  // Longest prefix wins, so `pos/report` cannot be swallowed by `pos`.
  let best: { len: number; cap: Capability } | null = null;
  for (const [base, cap] of PATH_CAPS) {
    if (p !== base && !p.startsWith(base + '/')) continue;
    if (!best || base.length > best.len) best = { len: base.length, cap };
  }
  return best?.cap ?? null;
}

/** The HTTP methods that change something. */
function isWrite(method: unknown): boolean {
  const m = String(method ?? 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/**
 * May a support session at this level make this call?
 *
 * Two rules, and the difference between them is the whole design:
 *
 *   money and client data  → refused, read and write alike
 *   everything else        → readable, not writable
 *
 * The second rule is what keeps the first one honest. A blanket block on every
 * capability the level lacks would have refused `GET /settings`, which the
 * services list, the review screen and the marketing report all read for the
 * salon's currency — so the employee would meet a broken page rather than a
 * closed door, and the next person to touch this would widen the whole rule to
 * get the page back.
 *
 * `public/...` is answered before either rule: those endpoints serve the
 * salon's own customers with no token at all, and a support session must not
 * be treated more harshly than an anonymous visitor.
 *
 * `custom` is the employee's own hand-picked list when they carry one. It is
 * read here rather than resolved by the caller so that the guard, the token
 * and this rule cannot drift into three different answers: whatever the
 * session was minted with is the same list this function asks about.
 */
export function supportMayCall(
  level: SupportLevel,
  method: unknown,
  path: unknown,
  custom?: unknown,
): boolean {
  const p = normalizePath(path);
  if (p === 'public' || p.startsWith('public/')) return true;
  const cap = capForApiPath(p);
  if (!cap) return true;
  if (capsFor(level, custom).includes(cap)) return true;
  return !isPrivateCap(cap) && !isWrite(method);
}
