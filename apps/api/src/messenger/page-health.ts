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

export type PageHealthState = 'ok' | 'role_lost' | 'two_factor' | 'checkpoint' | 'expired' | 'revoked' | 'unknown';

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
  // "You cannot access the app till you log in to www.facebook.com and follow
  // the instructions given." — 190 / 459: Facebook has put a checkpoint on the
  // ACCOUNT that pressed Connect (identity check, policy notice, suspicious
  // login). Every reconnect with that account mints a token that fails the
  // same way; only clearing the checkpoint on facebook.com, or connecting
  // with another admin, helps. Checked before the generic 190 branch.
  if (sub === 459 || m.includes('log in to www.facebook.com') || m.includes('cannot access the app till')) {
    return { state: 'checkpoint', at, raw, lost: true };
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
    case 'checkpoint':
      return vi
        ? 'Facebook đang tạm chặn tài khoản đã dùng để kết nối Trang (yêu cầu kiểm tra bảo mật / xác minh / chấp nhận điều khoản). Kết nối lại bằng chính tài khoản đó sẽ lỗi y hệt. Người đó cần mở www.facebook.com trên trình duyệt máy tính, đăng nhập và làm hết các bước Facebook yêu cầu cho đến khi vào được bình thường — rồi vào Cài đặt → Messenger bấm Kết nối lại. Hoặc kết nối lại bằng tài khoản Admin khác của Trang (ví dụ tài khoản của chủ tiệm).'
        : 'Facebook has put a check on the account that connected this Page (security check, identity verification, or a notice to accept). Reconnecting with that same account fails the same way. That person must open www.facebook.com in a desktop browser, log in and complete every step Facebook asks until the account works normally — then reconnect at Settings → Messenger. Or reconnect with another Admin of the Page (the owner\'s account, say).';
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
