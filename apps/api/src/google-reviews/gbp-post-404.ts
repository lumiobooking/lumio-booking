/**
 * WHAT A 404 FROM localPosts.create ACTUALLY MEANS — because Google will not say.
 *
 * "Requested entity was not found" is one sentence for at least three
 * different situations, and the fix for each is in a different person's
 * hands:
 *
 *   1. The saved location no longer exists (merged, deleted, re-verified
 *      under a new id). The salon re-picks the location. Us.
 *   2. The location exists but Google does not let it post: unverified, or a
 *      category Google keeps posts away from. Nothing on our side; the OWNER
 *      has to verify the listing at business.google.com. Them.
 *   3. The location exists and may post, but belongs to a different Google
 *      account than the one we saved next to it — a personal account versus
 *      the location group that really owns the listing. The v4 path needs the
 *      owning account, and the mismatch is ours to repair. Nobody: we fix it.
 *
 * The service gathers the facts (locations.get, the account list); this file
 * turns them into the one sentence that names the right fix. Pure, so the
 * decision is testable without Google.
 */

export interface LocalPost404Facts {
  /** locations.get answered 200 for the saved location id. */
  locationFound: boolean;
  /** metadata.canOperateLocalPost, when the location was found. */
  canOperateLocalPost?: boolean;
  /** metadata.hasVoiceOfMerchant (verified & in good standing), when found. */
  hasVoiceOfMerchant?: boolean;
  /** The account under which the location was actually listed, if we looked. */
  ownerAccount?: string | null;
  /** The account saved in settings next to the location. */
  storedAccount?: string;
}

export type LocalPost404Verdict =
  | { kind: 'stale-location'; message: string }
  | { kind: 'cannot-post'; message: string }
  | { kind: 'wrong-account'; message: string; fixAccount: string }
  | { kind: 'unknown'; message: string };

export function explainLocalPost404(f: LocalPost404Facts): LocalPost404Verdict {
  if (!f.locationFound) {
    return {
      kind: 'stale-location',
      message: 'Địa điểm Google đã lưu không còn tồn tại (hồ sơ đã bị gộp, xoá hoặc xác minh lại dưới mã mới). '
        + 'Vào Cài đặt → Đánh giá Google → chọn lại địa điểm, rồi bấm "Đăng ngay".',
    };
  }
  if (f.canOperateLocalPost === false) {
    const why = f.hasVoiceOfMerchant === false
      ? 'Hồ sơ này CHƯA ĐƯỢC XÁC MINH trên Google, nên Google không nhận bài đăng — qua API hay bấm tay trong Google đều không được. '
        + 'Chủ tiệm cần vào business.google.com hoàn tất xác minh; xác minh xong bài sẽ đăng bình thường.'
      : 'Google không cho hồ sơ này đăng bài cập nhật (thường do ngành nghề/loại hồ sơ không được phép, hoặc hồ sơ đang bị hạn chế). '
        + 'Chủ tiệm mở business.google.com: nếu trong hồ sơ không có nút "Add update" thì Google cũng không nhận qua Lumio. '
        + 'Bài này vẫn đăng được lên Facebook/Instagram — bỏ chọn Google Business rồi đăng.';
    return { kind: 'cannot-post', message: why };
  }
  if (f.ownerAccount && f.storedAccount && f.ownerAccount !== f.storedAccount) {
    return {
      kind: 'wrong-account',
      fixAccount: f.ownerAccount,
      message: 'Địa điểm này thuộc một tài khoản Google khác với tài khoản đã lưu (thường là nhóm địa điểm của tiệm). '
        + 'Lumio đã tự sửa lại — bấm "Đăng ngay" thêm một lần.',
    };
  }
  return {
    kind: 'unknown',
    message: 'Google báo không tìm thấy dù địa điểm tồn tại và được phép đăng. Bấm "Đăng ngay" thử lại một lần; '
      + 'nếu vẫn lỗi, gửi nguyên câu tiếng Anh cho team Lumio.',
  };
}

/** "locations/456" out of whatever form the setting was saved in. */
export function bareLocationId(locationId: string): string {
  const i = locationId.indexOf('locations/');
  return i >= 0 ? locationId.slice(i) : locationId;
}
