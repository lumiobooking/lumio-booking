/**
 * THE EMPTY CART ON THE BOOKING PAGE, IN THE SALON'S OWN TRADE.
 *
 * The first thing a customer sees before picking anything was the same
 * shopping bag and "Pick your tech" for a nail salon, a dental clinic and a
 * café. Each salon now picks a ready-made template for its line of business
 * (picture, headline, the line under it, four reasons to book), and may type
 * its own headline and line on top. 'auto' = the first template of its trade.
 *
 * Pure data + resolver; the pictures live in components/CartArt.tsx.
 */
import type { IndustryKey } from './ui-industry';

export type Lang = 'vi' | 'en';
type Txt = { vi: string; en: string };
type Perk = { icon: string; title: Txt; sub: Txt };
export type ArtKind = 'polish' | 'sparkle' | 'lash' | 'scissors' | 'lotus' | 'stones' | 'tooth' | 'plate' | 'cup' | 'house' | 'tools' | 'calendar' | 'bag';

export interface CartTemplate {
  key: string;
  /** Trades it is made for; empty = any trade. */
  industries: IndustryKey[];
  art: ArtKind;
  name: Txt;
  title: Txt;
  hint: Txt;
  perks: 'beauty' | 'health' | 'food' | 'property' | 'service';
}

const BEAUTY: IndustryKey[] = ['NAIL', 'LASH', 'HAIR', 'SPA', 'MASSAGE'];
const FOOD: IndustryKey[] = ['RESTAURANT', 'FAST_FOOD', 'CAFE'];

export const CART_TEMPLATES: CartTemplate[] = [
  { key: 'nail-polish', industries: ['NAIL'], art: 'polish', perks: 'beauty',
    name: { vi: 'Lọ sơn móng', en: 'Polish bottle' },
    title: { vi: 'Hôm nay bạn muốn làm móng gì?', en: 'What are we doing for your nails today?' },
    hint: { vi: 'Bấm + ở dịch vụ bất kỳ — chọn được nhiều dịch vụ.', en: 'Tap + on any service — pick as many as you like.' } },
  { key: 'nail-sparkle', industries: ['NAIL', 'LASH'], art: 'sparkle', perks: 'beauty',
    name: { vi: 'Lấp lánh', en: 'Sparkle' },
    title: { vi: 'Chọn dịch vụ để bắt đầu làm đẹp', en: 'Pick a service to get glowing' },
    hint: { vi: 'Bấm + ở dịch vụ bất kỳ — chọn được nhiều dịch vụ.', en: 'Tap + on any service — pick as many as you like.' } },
  { key: 'lash-eye', industries: ['LASH'], art: 'lash', perks: 'beauty',
    name: { vi: 'Hàng mi', en: 'Lashes' },
    title: { vi: 'Chọn kiểu mi, chân mày bạn muốn', en: 'Choose your lash or brow service' },
    hint: { vi: 'Bấm + ở dịch vụ — thêm dặm mi hay tẩy được nhiều dịch vụ.', en: 'Tap + on a service — add fills or removals too.' } },
  { key: 'hair-scissors', industries: ['HAIR'], art: 'scissors', perks: 'beauty',
    name: { vi: 'Kéo cắt tóc', en: 'Scissors' },
    title: { vi: 'Hôm nay làm tóc gì đây?', en: 'What are we doing with your hair today?' },
    hint: { vi: 'Bấm + ở dịch vụ — cắt, nhuộm, gội… chọn được nhiều.', en: 'Tap + on a service — cut, colour, wash… pick several.' } },
  { key: 'spa-lotus', industries: ['SPA', 'MASSAGE'], art: 'lotus', perks: 'beauty',
    name: { vi: 'Hoa sen', en: 'Lotus' },
    title: { vi: 'Chọn liệu trình thư giãn của bạn', en: 'Choose your moment to unwind' },
    hint: { vi: 'Bấm + ở liệu trình bất kỳ — kết hợp được nhiều liệu trình.', en: 'Tap + on any treatment — combine as many as you like.' } },
  { key: 'massage-stones', industries: ['MASSAGE', 'SPA'], art: 'stones', perks: 'beauty',
    name: { vi: 'Đá nóng', en: 'Hot stones' },
    title: { vi: 'Chọn gói massage để bắt đầu', en: 'Pick a massage to start' },
    hint: { vi: 'Bấm + ở gói bất kỳ — thêm thời gian hay dịch vụ kèm.', en: 'Tap + on any session — add time or extras.' } },
  { key: 'dental-tooth', industries: ['DENTAL'], art: 'tooth', perks: 'health',
    name: { vi: 'Răng', en: 'Tooth' },
    title: { vi: 'Bạn cần khám hay điều trị gì?', en: 'What can we help you with?' },
    hint: { vi: 'Bấm + ở dịch vụ khám hoặc điều trị bạn cần.', en: 'Tap + on the check-up or treatment you need.' } },
  { key: 'food-plate', industries: ['RESTAURANT', 'FAST_FOOD'], art: 'plate', perks: 'food',
    name: { vi: 'Đĩa ăn', en: 'Plate' },
    title: { vi: 'Chọn món để bắt đầu', en: 'Pick a dish to start' },
    hint: { vi: 'Bấm + ở món bất kỳ — gọi được nhiều món.', en: 'Tap + on any dish — order as many as you like.' } },
  { key: 'cafe-cup', industries: ['CAFE'], art: 'cup', perks: 'food',
    name: { vi: 'Ly cà phê', en: 'Coffee cup' },
    title: { vi: 'Hôm nay bạn uống gì?', en: 'What are you having today?' },
    hint: { vi: 'Bấm + ở món bất kỳ — chọn được nhiều món.', en: 'Tap + on anything — pick as many as you like.' } },
  { key: 'house', industries: ['REAL_ESTATE'], art: 'house', perks: 'property',
    name: { vi: 'Ngôi nhà', en: 'House' },
    title: { vi: 'Chọn dịch vụ để đặt lịch hẹn', en: 'Pick a service to book a viewing' },
    hint: { vi: 'Bấm + ở dịch vụ — xem nhà, tư vấn, định giá…', en: 'Tap + on a service — viewing, advice, valuation…' } },
  { key: 'service-tools', industries: ['SERVICE'], art: 'tools', perks: 'service',
    name: { vi: 'Dụng cụ', en: 'Tools' },
    title: { vi: 'Bạn cần chúng tôi làm gì?', en: 'What do you need done?' },
    hint: { vi: 'Bấm + ở dịch vụ bất kỳ — chọn được nhiều dịch vụ.', en: 'Tap + on any service — pick as many as you need.' } },
  { key: 'calendar', industries: [], art: 'calendar', perks: 'service',
    name: { vi: 'Lịch hẹn', en: 'Calendar' },
    title: { vi: 'Chọn dịch vụ để đặt lịch', en: 'Pick a service to book' },
    hint: { vi: 'Bấm + ở dịch vụ bất kỳ. Có thể chọn nhiều dịch vụ.', en: 'Tap + on any service. You can add more than one.' } },
  { key: 'classic', industries: [], art: 'bag', perks: 'beauty',
    name: { vi: 'Giỏ hàng (mặc định cũ)', en: 'Shopping bag (classic)' },
    title: { vi: 'Chọn dịch vụ để bắt đầu', en: 'Pick a service to start' },
    hint: { vi: 'Bấm + ở dịch vụ bất kỳ. Có thể chọn nhiều dịch vụ.', en: 'Tap + on any service. You can add more than one.' } },
];

const PERKS: Record<CartTemplate['perks'], Perk[]> = {
  beauty: [
    { icon: '🕐', title: { vi: 'Đặt lịch bất cứ lúc nào', en: 'Book any time' }, sub: { vi: 'Đặt online 24/7 — kể cả khi tiệm đã đóng cửa.', en: 'Open 24/7 online — even when the shop is closed.' } },
    { icon: '✅', title: { vi: 'Xác nhận ngay', en: 'Instant confirmation' }, sub: { vi: 'Có tin nhắn ngay khi chỗ của bạn được giữ.', en: 'You get a text the moment your spot is held.' } },
    { icon: '💇', title: { vi: 'Chọn thợ quen', en: 'Pick your tech' }, sub: { vi: 'Chọn thợ quen của bạn, hoặc để tiệm sắp xếp.', en: 'Choose the person you always go to, or let us match you.' } },
    { icon: '💳', title: { vi: 'Thanh toán tuỳ ý', en: 'Pay how you like' }, sub: { vi: 'Trả online ngay, hoặc trả tại tiệm khi đến.', en: 'Online now, or at the shop when you arrive.' } },
  ],
  health: [
    { icon: '🕐', title: { vi: 'Đặt lịch khám 24/7', en: 'Book any time' }, sub: { vi: 'Không cần gọi điện, không phải chờ máy.', en: 'No phone call, no hold music.' } },
    { icon: '✅', title: { vi: 'Xác nhận ngay', en: 'Instant confirmation' }, sub: { vi: 'Có tin nhắn ngay khi lịch được giữ.', en: 'You get a text the moment your visit is held.' } },
    { icon: '🩺', title: { vi: 'Chọn bác sĩ', en: 'Choose your doctor' }, sub: { vi: 'Chọn bác sĩ quen, hoặc để phòng khám sắp xếp.', en: 'Pick your usual doctor, or let us match you.' } },
    { icon: '🔔', title: { vi: 'Nhắc lịch trước giờ khám', en: 'Reminder before your visit' }, sub: { vi: 'Đổi hoặc huỷ lịch dễ dàng qua link.', en: 'Move or cancel any time from your link.' } },
  ],
  food: [
    { icon: '🕐', title: { vi: 'Đặt trước 24/7', en: 'Order ahead 24/7' }, sub: { vi: 'Đặt món, đặt bàn ngay cả khi quán đông.', en: 'Order or reserve even when we are busy.' } },
    { icon: '✅', title: { vi: 'Xác nhận ngay', en: 'Instant confirmation' }, sub: { vi: 'Có tin nhắn ngay khi quán nhận đơn.', en: 'You get a text as soon as we have it.' } },
    { icon: '📝', title: { vi: 'Ghi chú theo ý bạn', en: 'Your way' }, sub: { vi: 'Ít cay, không hành, dị ứng… quán đều thấy.', en: 'Less spicy, no onion, allergies — we see it all.' } },
    { icon: '💳', title: { vi: 'Thanh toán tuỳ ý', en: 'Pay how you like' }, sub: { vi: 'Trả online ngay, hoặc trả tại quán.', en: 'Online now, or when you pick up.' } },
  ],
  property: [
    { icon: '🕐', title: { vi: 'Đặt lịch bất cứ lúc nào', en: 'Book any time' }, sub: { vi: 'Chọn giờ xem nhà phù hợp với bạn.', en: 'Pick a viewing time that suits you.' } },
    { icon: '✅', title: { vi: 'Xác nhận ngay', en: 'Instant confirmation' }, sub: { vi: 'Có tin nhắn ngay khi lịch được giữ.', en: 'You get a text the moment it is held.' } },
    { icon: '🧑‍💼', title: { vi: 'Chọn chuyên viên', en: 'Choose your agent' }, sub: { vi: 'Gặp đúng người bạn đã trao đổi.', en: 'Meet the person you already spoke to.' } },
    { icon: '🔔', title: { vi: 'Nhắc lịch trước giờ hẹn', en: 'Reminder before we meet' }, sub: { vi: 'Đổi hoặc huỷ lịch dễ dàng qua link.', en: 'Move or cancel any time from your link.' } },
  ],
  service: [
    { icon: '🕐', title: { vi: 'Đặt lịch bất cứ lúc nào', en: 'Book any time' }, sub: { vi: 'Đặt online 24/7, không cần gọi điện.', en: 'Book online 24/7 — no phone call needed.' } },
    { icon: '✅', title: { vi: 'Xác nhận ngay', en: 'Instant confirmation' }, sub: { vi: 'Có tin nhắn ngay khi lịch được giữ.', en: 'You get a text the moment your spot is held.' } },
    { icon: '👤', title: { vi: 'Chọn người phục vụ', en: 'Choose who helps you' }, sub: { vi: 'Chọn người quen, hoặc để chúng tôi sắp xếp.', en: 'Pick someone you know, or let us match you.' } },
    { icon: '💳', title: { vi: 'Thanh toán tuỳ ý', en: 'Pay how you like' }, sub: { vi: 'Trả online ngay, hoặc trả khi đến.', en: 'Online now, or when you arrive.' } },
  ],
};

/** Templates for a trade, its own first, then the ones that fit any trade. */
export function templatesFor(industry: IndustryKey): CartTemplate[] {
  const own = CART_TEMPLATES.filter((t) => t.industries.includes(industry));
  const any = CART_TEMPLATES.filter((t) => t.industries.length === 0);
  const near = BEAUTY.includes(industry)
    ? CART_TEMPLATES.filter((t) => !own.includes(t) && t.industries.some((i) => BEAUTY.includes(i)))
    : FOOD.includes(industry)
      ? CART_TEMPLATES.filter((t) => !own.includes(t) && t.industries.some((i) => FOOD.includes(i)))
      : [];
  return [...own, ...near, ...any];
}

/** The template a salon shows: its pick when known, else the first of its trade. */
export function resolveTemplate(key: string | null | undefined, industry: IndustryKey): CartTemplate {
  const picked = key && key !== 'auto' ? CART_TEMPLATES.find((t) => t.key === key) : undefined;
  return picked ?? templatesFor(industry)[0] ?? CART_TEMPLATES[CART_TEMPLATES.length - 1];
}

export interface CartCopy { art: ArtKind; title: string; hint: string; perks: { icon: string; title: string; sub: string }[] }

/** What the page prints: the salon's own words win over the template's. */
export function cartCopy(opts: { key?: string | null; industry: IndustryKey; lang: Lang; title?: string | null; hint?: string | null }): CartCopy {
  const t = resolveTemplate(opts.key, opts.industry);
  const L = (x: Txt) => (opts.lang === 'vi' ? x.vi : x.en);
  return {
    art: t.art,
    title: (opts.title ?? '').trim().slice(0, 80) || L(t.title),
    hint: (opts.hint ?? '').trim().slice(0, 140) || L(t.hint),
    perks: PERKS[t.perks].map((p) => ({ icon: p.icon, title: L(p.title), sub: L(p.sub) })),
  };
}
