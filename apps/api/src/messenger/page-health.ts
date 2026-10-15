/**
 * Is the Page connection still alive — and if not, WHY, in words a person can act on?
 *
 * The error that keeps landing on the content calendar:
 *   "The user must be an administrator, editor, or moderator of the page in
 *    order to impersonate it. If the page business requires Two Factor
 *    Authentication, the user also needs to enable Two Factor Authentication."
 * is Graph error 190 / subcode 492. It is not about the post. The Page token
 * was minted for the Facebook ACCOUNT that pressed "Connect" (usually a Lumio
 * employee added to the client's Page); the token dies the moment that
 * account loses its role on the Page, or the Page's Business turns on
 * "require two-factor" and that account has no 2FA. Meta's sentence never says
 * that, and the raw text was all the calendar showed.
 *
 * Pure: the classifier takes Graph's error and returns a state plus the
 * sentence to show. The network call lives in the service.
 */

export type PageHealthState = 'ok' | 'role_lost' | 'two_factor' | 'expired' | 'revoked' | 'unknown';

export interface PageHealth {
  state: PageHealthState;
  /** When this was checked (ISO). */
  at: string;
  /** Graph's own words, kept for support. */
  raw: string | null;
  /** True when the Page token can no longer post or reply. */
  lost: boolean;
}

export interface GraphErrorLike { message?: string; code?: number; error_subcode?: number; type?: string }

/** Classify Graph's error for a Page token. `null` error = healthy. */
export function classifyPageError(err: GraphErrorLike | null | undefined, at = new Date().toISOString()): PageHealth {
  if (!err) return { state: 'ok', at, raw: null, lost: false };
  const m = (err.message ?? '').toLowerCase();
  const raw = err.message ?? null;
  const code = Number(err.code ?? 0);
  const sub = Number(err.error_subcode ?? 0);
  if (m.includes('two factor') || m.includes('two-factor')) {
    // Meta puts both causes in one sentence; the 2FA half is the actionable one
    // when the business enforces it, so it is named first where it appears.
    return { state: 'two_factor', at, raw, lost: true };
  }
  if (m.includes('impersonate') || m.includes('administrator, editor, or moderator') || sub === 492) {
    return { state: 'role_lost', at, raw, lost: true };
  }
  if (m.includes('session has expired') || sub === 463 || sub === 467) return { state: 'expired', at, raw, lost: true };
  if (code === 190 || m.includes('#190') || m.includes('invalid oauth access token') || sub === 460 || sub === 458) {
    return { state: 'revoked', at, raw, lost: true };
  }
  // A transient Graph hiccup (rate limit, 5xx, network) is not a lost token.
  return { state: 'unknown', at, raw, lost: false };
}

/** What to tell the salon / the team, per state. */
export function pageHealthText(state: PageHealthState, vi = true): string {
  switch (state) {
    case 'role_lost':
      return vi
        ? 'Tài khoản Facebook đã dùng để kết nối Trang không còn vai trò (Admin/Editor/Moderator) trên Trang, hoặc Trang đã đổi chủ. Nhờ chủ Trang cấp lại vai trò cho tài khoản đó, rồi vào Cài đặt → Messenger bấm Kết nối lại.'
        : 'The Facebook account that connected this Page no longer has a role (Admin/Editor/Moderator) on it. Ask the Page owner to add that account back, then reconnect at Settings → Messenger.';
    case 'two_factor':
      return vi
        ? 'Doanh nghiệp (Business) của Trang yêu cầu xác thực 2 lớp, nhưng tài khoản Facebook đã dùng để kết nối chưa bật. Bật xác thực 2 lớp cho tài khoản đó (Facebook → Cài đặt → Bảo mật), rồi vào Cài đặt → Messenger bấm Kết nối lại.'
        : 'The Page\'s Business requires two-factor authentication and the Facebook account that connected it has none. Turn on 2FA for that account (Facebook → Settings → Security), then reconnect at Settings → Messenger.';
    case 'expired':
      return vi ? 'Kết nối Facebook đã hết hạn. Vào Cài đặt → Messenger bấm Kết nối lại.' : 'The Facebook connection has expired. Reconnect at Settings → Messenger.';
    case 'revoked':
      return vi
        ? 'Facebook đã thu hồi kết nối (đổi mật khẩu, gỡ ứng dụng, hoặc tài khoản bị khoá). Vào Cài đặt → Messenger bấm Kết nối lại.'
        : 'Facebook revoked the connection (password change, app removed, or the account was locked). Reconnect at Settings → Messenger.';
    case 'unknown':
      return vi ? 'Facebook tạm thời không trả lời. Hệ thống sẽ kiểm tra lại sau.' : 'Facebook did not answer. It will be checked again later.';
    default:
      return '';
  }
}

/** A lost connection is worth telling the team about once, not every day. */
export function shouldAlert(prev: PageHealth | null | undefined, next: PageHealth): boolean {
  if (!next.lost) return false;
  if (!prev || !prev.lost) return true;
  return prev.state !== next.state;
}
