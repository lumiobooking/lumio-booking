/**
 * WHAT GOOGLE WILL REFUSE, SAID BEFORE GOOGLE SAYS IT.
 *
 * The Actions Center platform policies are specific about data quality, and a
 * partner whose feed breaks them gets merchants turned off — or the whole
 * integration. The rules that bite a nail salon: the merchant name must be the
 * business's real name (not "MT. HAWTHORN NAIL SPA — BEST NAILS"), service
 * names and descriptions carry no promotion, URL, e-mail, phone number, ALL
 * CAPS or emoji, the merchant must match a Maps listing (address, phone), and a
 * service must be priced, timed and bookable.
 *
 * Pure. The service reads each salon, this file lists what would be refused,
 * the agency screen shows it, and the feed builder leaves a salon out until
 * its errors are fixed (warnings go through).
 */
import type { FeedTenant, FeedService } from './feed';
import { feedableServices } from './feed';

export type LintLevel = 'error' | 'warn';
export interface LintIssue {
  code: string;
  level: LintLevel;
  /** Vietnamese, for the agency screen. */
  message: string;
  serviceId?: string;
  serviceName?: string;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const URL_RE = /(https?:\/\/|www\.|\.(com|net|org|ca|au|vn)\b)/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const PRICE_RE = /(\$|₫|€|£)\s?\d|\d\s?(\$|₫|đ\b|usd|cad|aud)/i;
const PROMO_RE = /\b(free|miễn phí|giảm giá|sale|discount|khuyến mãi|best|#1|number one|cheapest)\b|\d+\s?%\s?off\b|%\s?off\b/i;

/** "GEL MANICURE" is shouting; "SNS Dip" or "V.I.P" is not. */
export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ỹ]/g, '');
  if (letters.length < 6) return false;
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Words that stay in capitals when a shouted name is rewritten ("ZEN SHIATSU CENTER LLC" → "Zen Shiatsu Center LLC"). */
const KEEP_UPPER = new Set(['LLC', 'INC', 'LTD', 'SNS', 'OPI', 'CND', 'DND', 'UV', 'LED', 'VIP', 'CBD', 'II', 'III', 'IV', 'USA', 'UK', 'NYC', 'YYC', 'YVR', 'YYZ', 'BC', 'TX', 'CA', 'AU', 'NZ', 'VN', 'DIY', 'ASAP']);

/** Title Case for a shouted name — a suggestion the agency may still edit. */
export function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').split(' ').map((w) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (bare && KEEP_UPPER.has(bare.toUpperCase()) && w === w.toUpperCase()) return w;
    const low = w.toLocaleLowerCase();
    return low.replace(/^([^a-zà-ỹ]*)([a-zà-ỹ])/u, (_m, pre: string, c: string) => pre + c.toLocaleUpperCase());
  }).join(' ');
}

export function lintService(s: FeedService): LintIssue[] {
  const out: LintIssue[] = [];
  const tag = { serviceId: s.id, serviceName: s.name };
  const name = s.name.trim();
  if (!name) out.push({ code: 'svc_no_name', level: 'error', message: 'Dịch vụ không có tên', ...tag });
  if (isAllCaps(name)) out.push({ code: 'svc_caps', level: 'error', message: `Tên dịch vụ viết HOA toàn bộ: “${name}” → đổi thành “${titleCase(name)}”`, ...tag });
  if (EMOJI.test(name)) out.push({ code: 'svc_emoji', level: 'error', message: `Tên dịch vụ có emoji: “${name}”`, ...tag });
  if (PRICE_RE.test(name)) out.push({ code: 'svc_price_in_name', level: 'error', message: `Tên dịch vụ có giá tiền: “${name}” — giá để ở ô giá`, ...tag });
  if (URL_RE.test(name) || EMAIL_RE.test(name) || PHONE_RE.test(name)) out.push({ code: 'svc_contact_in_name', level: 'error', message: `Tên dịch vụ có link / email / số điện thoại: “${name}”`, ...tag });
  if (PROMO_RE.test(name)) out.push({ code: 'svc_promo', level: 'warn', message: `Tên dịch vụ có từ quảng cáo: “${name}”`, ...tag });
  const d = (s.description ?? '').trim();
  if (d) {
    if (d.length > 2000) out.push({ code: 'svc_desc_long', level: 'warn', message: `Mô tả “${name}” dài ${d.length} ký tự (tối đa 2000) — sẽ bị cắt`, ...tag });
    if (EMOJI.test(d)) out.push({ code: 'svc_desc_emoji', level: 'error', message: `Mô tả “${name}” có emoji`, ...tag });
    if (URL_RE.test(d) || EMAIL_RE.test(d) || PHONE_RE.test(d)) out.push({ code: 'svc_desc_contact', level: 'error', message: `Mô tả “${name}” có link / email / số điện thoại`, ...tag });
    if (PROMO_RE.test(d)) out.push({ code: 'svc_desc_promo', level: 'warn', message: `Mô tả “${name}” có từ quảng cáo`, ...tag });
  }
  if (!(s.priceCents > 0)) out.push({ code: 'svc_no_price', level: 'error', message: `“${name}” chưa có giá — Google không nhận dịch vụ 0đ`, ...tag });
  // No length: still bookable (default length) and Google shows no duration — say so, don't hold it back.
  if (!(s.durationMinutes > 0)) out.push({ code: 'svc_no_duration', level: 'warn', message: `“${name}” chưa có thời lượng — Google sẽ không hiện thời lượng (nên điền)`, ...tag });
  return out;
}

/** Problems in a service NAME that keep the service out of the feed (the rest of the salon still goes). */
const DROP_CODES = new Set(['svc_no_name', 'svc_emoji', 'svc_price_in_name', 'svc_contact_in_name']);
/** Problems in a DESCRIPTION: the feed sends the service without its description. */
const NO_DESC_CODES = new Set(['svc_desc_emoji', 'svc_desc_contact']);

/**
 * The salon as the feed will send it: a shouted service name goes in Title
 * Case, a description with a link / phone / emoji is left out, and a service
 * whose name carries a price, contact or emoji is left out — so one bad
 * service never keeps a whole salon off Google. The salon's own data is not
 * changed; `notes` says what the feed did, for the agency screen.
 */
export function cleanForFeed(t: FeedTenant): { tenant: FeedTenant; notes: LintIssue[] } {
  const notes: LintIssue[] = [];
  const kept: FeedService[] = [];
  let untimed = 0;
  for (const s of feedableServices(t)) {
    const found = lintService(s);
    const tag = { serviceId: s.id, serviceName: s.name };
    const name = s.name.trim();
    if (found.some((i) => DROP_CODES.has(i.code))) {
      const why = found.filter((i) => DROP_CODES.has(i.code)).map((i) => i.message).join(' · ');
      notes.push({ code: 'svc_dropped', level: 'warn', message: `Không gửi “${name}” lên Google: ${why}`, ...tag });
      continue;
    }
    let next: FeedService = s;
    if (found.some((i) => i.code === 'svc_caps')) {
      next = { ...next, name: titleCase(name) };
      notes.push({ code: 'svc_caps_fixed', level: 'warn', message: `Feed gửi tên “${titleCase(name)}” thay cho “${name}” (Google không nhận chữ HOA toàn bộ)`, ...tag });
    }
    if (found.some((i) => NO_DESC_CODES.has(i.code))) {
      next = { ...next, description: null };
      notes.push({ code: 'svc_desc_skipped', level: 'warn', message: `Feed không gửi mô tả của “${name}” (có link / số điện thoại / emoji)`, ...tag });
    }
    for (const i of found) if (i.level === 'warn' && i.code !== 'svc_no_duration') notes.push(i);
    if (!(s.durationMinutes > 0)) untimed += 1;
    kept.push(next);
  }
  // One line for the whole menu, not one per service (a salon can have 80).
  if (untimed) notes.push({ code: 'svc_no_duration', level: 'warn', message: `${untimed} dịch vụ chưa có thời lượng — vẫn gửi lên Google, nhưng Google sẽ không hiện thời lượng (nên điền ở trang Dịch vụ)` });
  return { tenant: { ...t, services: kept }, notes };
}

export interface TenantLint {
  tenantId: string;
  /** ready = goes in the feed; fix = held back until the errors are fixed; off = not eligible at all. */
  status: 'ready' | 'fix' | 'off';
  issues: LintIssue[];
  /** Services that would go in the feed as-is. */
  feedable: number;
}

/**
 * The countries Lumio told Google it serves (Actions Center questionnaire,
 * 29/10/2026: North America). A salon elsewhere stays out of the feed until
 * Google approves that region — `RWG_COUNTRIES` widens it.
 */
export function allowedCountries(env: string | undefined): string[] {
  const list = String(env ?? '').split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length ? list : ['US', 'CA'];
}

export function lintTenant(t: FeedTenant, opts: { googleLinked: boolean; googleMismatch?: boolean; enabled: boolean; notAppointments?: boolean; countries?: string[] } ): TenantLint {
  const issues: LintIssue[] = [];
  if (!opts.enabled) return { tenantId: t.id, status: 'off', issues: [{ code: 'disabled', level: 'warn', message: 'Nút Google đang tắt cho tiệm này' }], feedable: 0 };
  if (opts.notAppointments) return { tenantId: t.id, status: 'off', issues: [{ code: 'not_appointments', level: 'warn', message: 'Nhà hàng / bất động sản — không thuộc nhóm đặt hẹn (Appointments) của Google' }], feedable: 0 };
  // Outside the approved region: judged like any salon (the Book link on its own
  // profile still needs the checks), but never in the partner feed.
  const country = (t.address?.country ?? '').toUpperCase();
  const outside = Boolean(country && opts.countries?.length && !opts.countries.includes(country));
  if (outside) issues.push({ code: 'outside_region', level: 'warn', message: `Tiệm ở ${country} — Google mới duyệt Lumio cho ${opts.countries!.join(', ')}; không vào feed Actions Center (thêm nước vào RWG_COUNTRIES khi Google mở)` });
  const name = (t.listingName || t.name).trim();
  if (!name) issues.push({ code: 'name_missing', level: 'error', message: 'Tiệm chưa có tên' });
  if (isAllCaps(name)) issues.push({ code: 'name_caps', level: 'error', message: `Tên tiệm viết HOA toàn bộ: “${name}” → “${titleCase(name)}” (Google yêu cầu tên pháp lý, viết thường/hoa đầu chữ)` });
  if (EMOJI.test(name) || PROMO_RE.test(name) || URL_RE.test(name)) issues.push({ code: 'name_extra', level: 'error', message: `Tên tiệm có emoji / từ quảng cáo / link: “${name}”` });
  if (!opts.googleLinked) issues.push({ code: 'google_not_linked', level: 'error', message: 'Chưa nối hồ sơ Google (Google Reviews) — không có địa chỉ, toạ độ và tên chuẩn để khớp Maps' });
  if (opts.googleMismatch) issues.push({ code: 'google_mismatch', level: 'error', message: 'Hồ sơ Google đang nối có vẻ là của tiệm khác — chọn lại đúng địa điểm' });
  if (!t.phone) issues.push({ code: 'phone_missing', level: 'warn', message: 'Chưa có số điện thoại tiệm — Google khớp tiệm kém hơn' });
  if (!t.address && !t.unstructuredAddress) issues.push({ code: 'address_missing', level: 'error', message: 'Chưa có địa chỉ' });
  else if (!t.address) issues.push({ code: 'address_unstructured', level: 'warn', message: 'Địa chỉ chưa có cấu trúc (quốc gia, thành phố, mã bưu điện) — lấy từ hồ sơ Google khi nối' });
  if (typeof t.lat !== 'number' || typeof t.lng !== 'number') issues.push({ code: 'geo_missing', level: 'warn', message: 'Chưa có toạ độ — lấy từ hồ sơ Google khi nối' });
  if (!t.cancelNoticeHours) issues.push({ code: 'policy_missing', level: 'warn', message: 'Chưa có chính sách huỷ (giờ báo trước) — nên có' });
  const raw = feedableServices(t);
  const { tenant: clean, notes } = cleanForFeed(t);
  const feedable = clean.services;
  if (!raw.length) issues.push({ code: 'no_services', level: 'error', message: t.services.length && t.services.every((s) => s.isActive === false) ? `Cả ${t.services.length} dịch vụ đang tắt (ẩn) — bật lại các dịch vụ khách đặt được` : t.services.length ? 'Không có dịch vụ nào đặt online được (cần giá > 0, không phải chỉ walk-in)' : 'Tiệm chưa có dịch vụ nào trong menu' });
  else if (!feedable.length) issues.push({ code: 'no_clean_services', level: 'error', message: 'Mọi dịch vụ đều có giá / link / số điện thoại / emoji trong tên — sửa ít nhất một dịch vụ' });
  issues.push(...notes);
  const status = outside ? 'off' : issues.some((i) => i.level === 'error') ? 'fix' : 'ready';
  return { tenantId: t.id, status, issues, feedable: feedable.length };
}
