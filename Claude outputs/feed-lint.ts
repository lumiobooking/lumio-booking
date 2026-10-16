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
const PROMO_RE = /\b(free|miễn phí|giảm giá|sale|discount|% off|khuyến mãi|best|#1|number one|cheapest)\b/i;

/** "GEL MANICURE" is shouting; "SNS Dip" or "V.I.P" is not. */
export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ỹ]/g, '');
  if (letters.length < 6) return false;
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Title Case for a shouted name, keeping short tokens like "SNS", "V.I.P", "&". */
export function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').split(' ').map((w) => {
    if (w.length <= 3 && w === w.toUpperCase()) return w; // SNS, VIP, &, 2
    const low = w.toLocaleLowerCase();
    return low.replace(/^([a-zà-ỹ])/u, (m) => m.toLocaleUpperCase());
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
  if (!(s.durationMinutes > 0)) out.push({ code: 'svc_no_duration', level: 'error', message: `“${name}” chưa có thời lượng`, ...tag });
  return out;
}

export interface TenantLint {
  tenantId: string;
  /** ready = goes in the feed; fix = held back until the errors are fixed; off = not eligible at all. */
  status: 'ready' | 'fix' | 'off';
  issues: LintIssue[];
  /** Services that would go in the feed as-is. */
  feedable: number;
}

export function lintTenant(t: FeedTenant, opts: { googleLinked: boolean; googleMismatch?: boolean; enabled: boolean } ): TenantLint {
  const issues: LintIssue[] = [];
  if (!opts.enabled) return { tenantId: t.id, status: 'off', issues: [{ code: 'disabled', level: 'warn', message: 'Nút Google đang tắt cho tiệm này' }], feedable: 0 };
  const name = t.name.trim();
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
  const feedable = feedableServices(t);
  if (!feedable.length) issues.push({ code: 'no_services', level: 'error', message: 'Không có dịch vụ nào đặt online được (cần giá > 0, thời lượng > 0, không phải chỉ walk-in)' });
  for (const s of feedable) issues.push(...lintService(s));
  const status = issues.some((i) => i.level === 'error') ? 'fix' : 'ready';
  return { tenantId: t.id, status, issues, feedable: feedable.length };
}
