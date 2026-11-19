/**
 * Thư viện ảnh gửi khách — the words and small rules the screens share
 * (the library tab on the AI page, the picker in the Inbox).
 */
export type PhotoKind = 'sample' | 'price_list' | 'storefront' | 'guide' | 'promo' | 'result';
export type PhotoMode = 'auto' | 'approve' | 'off';
export const PHOTO_KINDS: PhotoKind[] = ['sample', 'price_list', 'storefront', 'guide', 'promo', 'result'];

export interface LibraryItem {
  id: string; url: string; kind: PhotoKind; title: string; serviceId: string | null; serviceName: string | null; tags: string[];
  aiAllowed: boolean; expiresAt: string | null; flags: string[]; consent: boolean; status: 'ready' | 'pending' | string; source: string;
  sentCount: number; lastSentAt: string | null; createdAt: string; blocked: string | null;
}
export interface PhotoRules { modes: Record<PhotoKind, PhotoMode>; minScore: 0.7 | 0.8 | 0.9; max: 1 | 2 | 3; whenNone: 'notify' | 'quiet' }
export interface LibraryResponse {
  items: LibraryItem[]; rules: PhotoRules;
  warnings: { priceStale: number; flagged: number; pending: number; expired: number };
  services: { id: string; name: string }[];
}
export interface SuggestItem { id: string; url: string; kind: PhotoKind; title: string; serviceName: string | null; tags: string[]; score: number; sent: boolean; blocked: string | null }
export interface SuggestResponse {
  lastText: string | null; words: string[]; suggestions: SuggestItem[]; total: number;
  waiting: { label: string; at: string; items: { id: string; url: string; kind: PhotoKind; title: string; serviceName: string | null; tags: string[] }[] } | null;
}

const K: Record<PhotoKind, [string, string]> = {
  sample: ['Mẫu', 'Sample'], price_list: ['Bảng giá', 'Price list'], storefront: ['Mặt tiền', 'Storefront'],
  guide: ['Hướng dẫn', 'Guide'], promo: ['Khuyến mãi', 'Promotion'], result: ['Kết quả của khách', 'Customer result'],
};
export const kindLabel = (k: string, vi: boolean) => (K[k as PhotoKind] ?? K.sample)[vi ? 0 : 1];

const KH: Record<PhotoKind, [string, string]> = {
  sample: ['Khi khách hỏi mẫu hoặc gửi ảnh mẫu', 'When a customer asks for or sends a design'],
  price_list: ['Chỉ gửi khi ảnh không cũ hơn giá trong hệ thống', 'Only while the picture matches today’s prices'],
  storefront: ['Khi khách hỏi đường, kèm địa chỉ bằng chữ', 'When asked for directions, with the address in words'],
  guide: ['Chuẩn bị trước / chăm sóc sau buổi hẹn', 'Before / after-care for a visit'],
  promo: ['Chỉ khi khách hỏi, và còn hạn', 'Only when asked, and still running'],
  result: ['Ảnh khách thật — cần khách đồng ý, AI không tự gửi', 'Real customers — needs consent, never sent by the AI alone'],
};
export const kindHint = (k: PhotoKind, vi: boolean) => KH[k][vi ? 0 : 1];

const M: Record<PhotoMode, [string, string]> = { auto: ['AI tự gửi', 'AI sends'], approve: ['Nhân viên duyệt', 'Staff approves'], off: ['Tắt', 'Off'] };
export const modeLabel = (m: PhotoMode, vi: boolean) => M[m][vi ? 0 : 1];
/** A customer's result photo can never be set to "AI sends". */
export const modesFor = (k: PhotoKind): PhotoMode[] => (k === 'result' ? ['approve', 'off'] : ['auto', 'approve', 'off']);

const B: Record<string, [string, string]> = {
  pending: ['Chờ chủ tiệm duyệt', 'Waiting for the owner'],
  ai_off: ['AI không gửi ảnh này', 'The AI won’t send this'],
  expired: ['Đã hết hạn', 'Expired'],
  flagged: ['Có mặt người / thông tin riêng — cần xác nhận', 'Face or private details — needs confirming'],
  no_consent: ['Cần khách đồng ý', 'Needs the customer’s consent'],
  price_stale: ['Cũ hơn giá trong hệ thống', 'Older than today’s prices'],
};
export const blockedLabel = (b: string | null, vi: boolean) => (b ? (B[b] ?? [b, b])[vi ? 0 : 1] : null);
/** Red for privacy, amber for the rest. */
export const blockedTone = (b: string | null): 'bad' | 'warn' | null => (!b ? null : b === 'flagged' || b === 'no_consent' ? 'bad' : 'warn');

const F: Record<string, [string, string]> = { face: ['khuôn mặt', 'a face'], phone: ['số điện thoại / giấy tờ', 'a phone number / ID'], other_shop: ['tên tiệm khác', 'another shop’s name'] };
export const flagText = (flags: string[], vi: boolean) => flags.map((f) => (F[f] ?? [f, f])[vi ? 0 : 1]).join(', ');

export type LibFilter = 'all' | PhotoKind | 'review';
/** The library's filter: by kind, or everything that needs the owner (pending, flagged, stale, expired). */
export function filterItems(items: LibraryItem[], f: LibFilter, q: string): LibraryItem[] {
  const words = q.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f === 'review' && !(i.status === 'pending' || (i.blocked && i.blocked !== 'ai_off'))) return false;
    if (f !== 'all' && f !== 'review' && i.kind !== f && !(f === 'sample' && i.kind === 'result')) return false;
    if (!words.length) return true;
    const hay = [i.title, i.serviceName ?? '', ...i.tags].join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "french, trắng ,  vuông" → ["french","trắng","vuông"] */
export function parseTags(s: string): string[] {
  const out: string[] = [];
  for (const t of s.split(',')) { const v = t.trim().toLowerCase(); if (v && !out.includes(v)) out.push(v); }
  return out.slice(0, 12);
}

/** yyyy-mm-dd for a date input, from an ISO string. */
export const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
