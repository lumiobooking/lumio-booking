/**
 * THE "BOOK" LINK ON A SALON'S GOOGLE PROFILE.
 *
 * Google shows a booking action on a Business Profile from its "place action
 * links": the merchant's own appointment link (Business Profile → Bookings),
 * or a Reserve with Google partner's. Lumio is not an Actions Center partner,
 * but it manages the salon's profile with the owner's consent (the Google
 * Reviews connection, scope business.manage), so it can set the salon's OWN
 * appointment link through the Place Actions API — exactly what the owner
 * would type by hand, kept right automatically.
 *
 * This file is the pure half: given the links Google has, what to change so
 * the salon's Lumio booking page is THE preferred appointment link, without
 * touching anybody else's (a partner's link is not ours to remove, and a link
 * the owner typed to another site stays — ours is simply marked preferred).
 * Tested in place-action-links.spec.ts.
 */

export interface PlaceLink {
  /** locations/{id}/placeActionLinks/{linkId} */
  name?: string;
  uri: string;
  placeActionType: string;
  isPreferred?: boolean;
  isEditable?: boolean;
  providerType?: string;
}

export type LinkStep =
  | { op: 'create'; uri: string }
  | { op: 'prefer'; name: string }
  | { op: 'delete'; name: string };

export const APPOINTMENT = 'APPOINTMENT';

/** One shape for comparing links: lower-case host, no trailing slash, no query or hash. */
export function normUri(u: string): string {
  try {
    const x = new URL(String(u).trim());
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(u ?? '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/** A link Lumio put there (any page on one of Lumio's own hosts). */
export function isOwnLink(u: string, hosts: string[]): boolean {
  try {
    const h = new URL(String(u).trim()).host.toLowerCase().replace(/^www\./, '');
    return hosts.some((x) => x.toLowerCase().replace(/^www\./, '') === h);
  } catch {
    return false;
  }
}

/**
 * The changes that make `uri` the salon's preferred appointment link.
 * `wanted = false` takes Lumio's own links off again (the salon was switched off).
 * Old Lumio links (a renamed slug, an older path) are removed; links that are
 * not Lumio's, or that Google says are not editable, are never touched.
 */
export function planBookingLink(existing: PlaceLink[], uri: string, hosts: string[], wanted = true): LinkStep[] {
  const appts = (existing ?? []).filter((l) => l && l.placeActionType === APPOINTMENT);
  const ours = appts.filter((l) => l.isEditable !== false && isOwnLink(l.uri, hosts));
  if (!wanted) return ours.filter((l) => l.name).map((l) => ({ op: 'delete', name: l.name as string }));
  const target = normUri(uri);
  const mine = ours.find((l) => normUri(l.uri) === target);
  const steps: LinkStep[] = ours.filter((l) => l !== mine && l.name).map((l) => ({ op: 'delete', name: l.name as string }));
  if (!mine) steps.push({ op: 'create', uri });
  else if (!mine.isPreferred && mine.name) steps.push({ op: 'prefer', name: mine.name });
  return steps;
}

/** How many appointment links on the profile are someone else's (a partner's, or one the owner typed). */
export function otherBookingLinks(existing: PlaceLink[], hosts: string[]): number {
  return (existing ?? []).filter((l) => l && l.placeActionType === APPOINTMENT && !isOwnLink(l.uri, hosts)).length;
}

/** Google's answer, in words the agency can act on. */
export function placeActionsError(status: number, body: string): string {
  const b = String(body ?? '');
  if (status === 403 && /SERVICE_DISABLED|has not been used|accessNotConfigured|is disabled/i.test(b)) {
    return 'Google Cloud chưa bật "My Business Place Actions API" — vào Google Cloud Console (project OAuth của Lumio) → APIs & Services → Library → bật API này, rồi chạy lại.';
  }
  if (status === 401) return 'Kết nối Google của tiệm đã hết hạn — vào tiệm → Google Reviews → nối lại.';
  if (status === 403) return 'Tài khoản Google đã nối không có quyền sửa hồ sơ này (cần Owner hoặc Manager của hồ sơ).';
  if (status === 404) return 'Không tìm thấy hồ sơ Google đang nối (đã đổi hoặc xoá?) — chọn lại hồ sơ trong Google Reviews.';
  if (status === 429) return 'Google đang giới hạn số lần gọi — thử lại sau ít phút.';
  if (status === 400 && /category|not supported|not allowed/i.test(b)) return 'Ngành của hồ sơ trên Google không cho gắn link đặt lịch — đổi danh mục chính (vd. Nail salon) trên Business Profile.';
  const msg = (/"message":\s*"([^"]+)"/.exec(b)?.[1] ?? b).slice(0, 160);
  return `Google ${status}: ${msg}`;
}
