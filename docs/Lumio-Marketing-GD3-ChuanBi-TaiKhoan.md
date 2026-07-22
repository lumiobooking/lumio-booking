# GĐ3 — Kết nối API các kênh: cần chuẩn bị tài khoản gì

> Mỗi nền tảng bắt buộc **anh (Lumio Agency) tự tạo app developer + xin quyền**.
> Lumio không thể tạo hộ hay test bằng tài khoản thật — giống mô hình BYO như Dejavoo.
> Một số nền cần **duyệt app vài ngày đến vài tuần**, nên nộp sớm.

Nguyên tắc kết nối (đã dựng sẵn trong hệ thống): mỗi tiệm/anh **tự dán token + ID
tài khoản quảng cáo** vào Lumio → Lumio mã hoá lưu (AES-256-GCM) → tự kéo chi phí +
reach + click mỗi tháng, đổ vào bảng chi phí (đánh dấu "api"), thay việc nhập tay.
**Không bịa số:** thiếu quyền/sai token → hiện lỗi rõ, không hiện số giả.

---

## 1. Meta — Facebook + Instagram Ads  ⭐ (quan trọng nhất)

**Tạo gì:**
1. Tài khoản **Meta Business** (business.facebook.com) — thường tiệm/anh đã có.
2. **Meta App** tại developers.facebook.com → loại *Business* → thêm sản phẩm **Marketing API**.
3. Tạo **System User** (Business Settings → Users → System Users) → cấp quyền vào
   **Ad Account** của tiệm → **Generate Token** với quyền **`ads_read`**
   (chọn token **không hết hạn** = long-lived).

**Cần lấy 2 thứ dán vào Lumio:**
- **Access Token** (chuỗi dài, quyền `ads_read`)
- **Ad Account ID** (dạng `act_1234567890`, xem ở Ads Manager)

**Duyệt app:** để token đọc được dữ liệu ad account của người khác cần **App Review**
cho `ads_read` + `business_management` (Meta xét vài ngày). Nếu anh chỉ đọc ad account
**của chính mình/của tiệm mà anh là admin**, System User token thường dùng được ngay,
không cần review — đây là đường nhanh nhất cho mô hình đại lý.

**Lấy được:** chi phí (spend), hiển thị (impressions), tiếp cận (reach), click, CPC, CPM, CTR.

---

## 2. Google Business Profile — Google Maps  ⭐ (local, rất quan trọng với nail)

**Tạo gì:**
1. **Google Cloud project** (console.cloud.google.com).
2. Bật **Business Profile Performance API** (`businessprofileperformance.googleapis.com`).
   → Sau khi bật, quota thường = 0, phải **điền form xin quyền GBP API** (Google duyệt,
   có thể vài ngày).
3. **OAuth 2.0 Client** (scope `https://www.googleapis.com/auth/business.manage`) →
   lấy **refresh token** cho tài khoản Google quản lý trang doanh nghiệp của tiệm.

**Cần lấy dán vào Lumio:**
- **OAuth refresh token** (hoặc access token) quyền `business.manage`
- **Location ID** của trang doanh nghiệp trên Maps (dạng `locations/1234567890`)

**Lấy được:** lượt hiển thị trên Maps/Search, lượt **gọi**, lượt **xin chỉ đường**,
lượt bấm website, lượt tìm theo từ khoá.

> Lưu ý: GBP **không có chi phí** (Maps miễn phí) — kênh này đo *độ phủ tự nhiên*, không tính spend.

---

## 3. TikTok — TikTok for Business Ads

**Tạo gì:**
1. **TikTok for Business** + **TikTok Ads Manager** (advertiser account).
2. **TikTok for Developers** → tạo app → xin quyền **Marketing API** (TikTok duyệt).
3. OAuth để lấy **access token** + **Advertiser ID**.

**Cần lấy dán vào Lumio:**
- **Access Token** (quyền reporting)
- **Advertiser ID**

**Lấy được:** spend, impressions, click, reach (endpoint `report/integrated/get`).

**Trạng thái:** connector đã dựng khung; em hoàn thiện & test khi anh có token thật
(TikTok bắt buộc duyệt app nên không thử trước được).

---

## 4. Google Ads — quảng cáo tìm kiếm Google

**Tạo gì (nặng nhất, làm sau cùng):**
1. **Google Cloud project** + bật **Google Ads API**.
2. **Developer Token** (xin trong Google Ads → API Center) — **Google phải duyệt**,
   thường lâu nhất (có thể 1–2 tuần), ban đầu chỉ ở mức "test account".
3. **OAuth Client** → refresh token; cần **Customer ID** của tài khoản Ads.

**Cần lấy dán vào Lumio:**
- **Developer Token** + **OAuth refresh token** + **Customer ID** (`123-456-7890`)

**Lấy được:** spend (cost), impressions, click, conversions (qua GAQL).

**Trạng thái:** connector đã dựng khung; hoàn thiện khi anh có Developer Token đã duyệt.

---

## Thứ tự đề xuất (dễ + nhanh trước)

| # | Nền | Độ khó lấy quyền | Ưu tiên |
|---|---|---|---|
| 1 | **Meta (FB/IG)** | Trung bình (System User token nhanh) | **Làm trước** — nơi tiệm chi tiền nhất |
| 2 | **Google Maps (GBP)** | Trung bình (xin quota) | Làm song song — local quan trọng |
| 3 | **TikTok** | Cần duyệt app | Khi có token |
| 4 | **Google Ads** | Khó nhất (Developer Token) | Cuối |

## Anh cần làm gì tiếp

1. Bắt đầu tạo **Meta App + System User token + Ad Account ID** (đường nhanh nhất).
2. Song song nộp **form xin GBP API** (vì Google duyệt lâu).
3. Khi có token + ID của nền nào, vào Lumio → **Marketing → Monthly report → Kênh kết nối**
   → chọn nền → dán token + ID → **Test** → **Đồng bộ**. Chi phí tự đổ về.
4. TikTok / Google Ads: gửi em token khi có, em finalize connector.

*Toàn bộ token được mã hoá lưu, có thể huỷ (revoke) bất cứ lúc nào — Lumio không giữ mật khẩu gốc.*
