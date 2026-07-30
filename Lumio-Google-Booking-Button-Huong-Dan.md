# Đưa nút đặt lịch của Lumio lên Google Maps — hướng dẫn cho Lumio Agency

_Cập nhật 30/07/2026 · Nguồn: tài liệu Google Actions Center (cập nhật 01/04/2026)_

---

## 0. Có 2 con đường, khác nhau hoàn toàn — làm CẢ HAI

| | **Đường A — Link đặt lịch trên hồ sơ** | **Đường B — Reserve with Google (Actions Center)** |
|---|---|---|
| Nút hiện ra | "Đặt lịch / Book online" trên hồ sơ Google của tiệm | Nút đặt lịch chính chủ, có tên **Lumio** là đối tác đặt lịch |
| Ai làm | Từng tiệm (hoặc anh, nếu có quyền quản lý hồ sơ) | Lumio đăng ký **một lần** cho toàn bộ tiệm |
| Điều kiện | Hồ sơ Google đã xác minh + ngành nghề hỗ trợ đặt lịch | Hợp đồng trực tiếp với từng tiệm + feed dữ liệu + Google duyệt |
| Thời gian | **24–48 giờ** | **4–8 tuần** (Google ghi rõ, với người làm kỹ thuật chuyên trách) |
| Chi phí | 0 | 0 (chỉ tốn công kỹ thuật) |
| Nhược điểm | Link rời, không có thương hiệu Lumio, mỗi tiệm phải tự thêm | Phải nộp feed hàng ngày, chịu chính sách của Google |

> **Chiến lược:** làm Đường A ngay tuần này để 13–16 tiệm có nút liền, đồng thời nộp form Đường B để chạy song song. Khi Đường B duyệt xong, nút sẽ nâng cấp mà không mất gì.

---

## 1. ĐƯỜNG A — làm ngay, mỗi tiệm 3 phút

Google cho phép gắn "Appointment links / Liên kết đặt lịch" thẳng vào hồ sơ doanh nghiệp; nút **Book online** xuất hiện trên Maps và Search sau khi Google duyệt link (thường 24–48 giờ).

**Các bước (làm trên tài khoản có quyền quản lý hồ sơ của tiệm):**

1. Tìm tên tiệm trên Google Search (đang đăng nhập đúng tài khoản quản lý) → hiện bảng quản lý hồ sơ.
2. Vào **Chỉnh sửa hồ sơ → Thông tin doanh nghiệp → Đặt lịch hẹn** (Bookings / Appointment links).
3. Dán **link đặt lịch riêng của tiệm đó**, ví dụ:
   - `https://lumiobooking.com/lux-nail-spa`
   - `https://lumiobooking.com/vina-nails-spa`
   Không dán trang chủ, không dán link chung — Google yêu cầu link dẫn thẳng tới trang đặt lịch của đúng tiệm đó.
4. Lưu → chờ Google duyệt.

**Điều kiện để nút hiện:**

- Hồ sơ đã **xác minh** (verified).
- **Danh mục chính** thuộc nhóm có đặt lịch: *Nail salon, Spa, Medical spa* — 12/13 tiệm trong danh sách của anh đã đúng nhóm.
- Trang đặt lịch chạy **HTTPS**, mở nhanh, hiển thị tốt trên điện thoại, **không bắt đăng nhập** mới đặt được.

Trang booking của Lumio đã đạt cả 3 điều kiện kỹ thuật này.

**Riêng Saigon Palace Cafe (nhà hàng):** nhóm nhà hàng dùng ô "Đặt bàn" (Reservations) chứ không phải "Đặt lịch hẹn" — cách làm giống hệt, chỉ khác tên ô.

---

## 2. ĐƯỜNG B — đăng ký Lumio làm đối tác đặt lịch của Google

### 2.1 Chọn đúng loại tích hợp

Google có 2 mức, **nộp mức thấp trước rồi nâng cấp** là cách nhanh nhất:

| Mức | Tên chính thức | Google làm gì | Lumio phải làm gì |
|---|---|---|---|
| **B1** | **Reservations Business Link** | Hiện link sâu tới trang đặt lịch của từng tiệm trên hồ sơ Google | Nộp **merchant feed** (danh sách tiệm + link đặt lịch), không cần API |
| **B2** | **Reservations End-to-End** | Khách đặt lịch **ngay trong Google**, không rời Maps | Thêm feed dịch vụ + feed khung giờ trống + **booking server** (API tạo/sửa/huỷ) + real-time updates + Google review sandbox |

Với 16 tiệm và mục tiêu "có nút nổi bật", **B1 là đích trước mắt**. B2 nên làm khi số tiệm đủ lớn — vì phải mở API công khai cho Google gọi vào.

### 2.2 Điều kiện Google bắt buộc (nguyên văn tài liệu)

- Lumio phải có **quan hệ hợp đồng trực tiếp với TẤT CẢ các tiệm** trong feed. → Cần hợp đồng/điều khoản dịch vụ ký với từng tiệm, lưu lại để đối chứng.
- Mỗi tiệm phải có **địa điểm thật, khớp được với dữ liệu Google Maps** (tên + địa chỉ + số điện thoại trùng khớp).
- Mỗi `action_link` phải trỏ tới **trang hành động riêng của tiệm đó** — đúng như link `lumiobooking.com/<slug>` hiện tại.

### 2.3 Các bước nộp

1. **Nộp form quan tâm** (miễn phí, không cần code trước):
   https://services.google.com/fb/forms/reservationsappointmentsonlinebooking-interestform/
   Khai: tên nền tảng *Lumio Booking*, ngành *beauty / nail salon*, số merchant hiện tại **13 (đang tăng)**, thị trường **US · CA · AU**, loại tích hợp mong muốn **Reservations Business Link**.
2. Google gửi **lời mời vào Actions Center** (partnerdash.google.com/apps/reservewithgoogle) — đây là bước chờ lâu nhất, có thể vài tuần.
3. Trong Actions Center: tạo SSH key, cấu hình thông tin liên hệ, cấu hình **Brand** (logo + tên Lumio hiển thị cạnh nút).
4. **Nộp merchant feed** qua SFTP (file JSON, nộp lại hàng ngày).
5. **Merchant matching**: Google ghép từng dòng feed với địa điểm trên Maps. Dòng nào không khớp sẽ báo lỗi trong Partner Portal → sửa tên/địa chỉ cho khớp Maps.
6. **Pilot & Launch**: Google bật thử vài tiệm, rồi bật toàn bộ.

### 2.4 Feed cần những trường gì

Đúng những cột trong file anh gửi, thiếu 1 thứ quan trọng:

| Trường | Trạng thái file của anh |
|---|---|
| `merchant_id` (mã cố định, không đổi) | ✅ có |
| `name` | ✅ có |
| `telephone` (định dạng E.164, ví dụ `+16026032420`) | ⚠️ có nhưng đang nhiều kiểu — cần chuẩn hoá hết về `+1...` |
| `url` (website tiệm) | ⚠️ chưa có cột |
| `geo` (địa chỉ đầy đủ + toạ độ) | ✅ có địa chỉ · ⚠️ chưa có toạ độ |
| `category` | ✅ có |
| `action_link` (link đặt lịch) | ✅ có |
| **`place_id` / Maps URL để ghép địa điểm** | ❌ **thiếu toàn bộ 13 tiệm** |

**Việc cần làm ngay:** lấy `place_id` cho từng tiệm. Cách nhanh nhất:
- Dùng **Place ID Finder** của Google: https://developers.google.com/maps/documentation/places/web-service/place-id — gõ tên + địa chỉ, copy chuỗi `ChIJ...`.
- Hoặc trong Actions Center dùng **Maps URL matching**: dán link Maps dạng `https://maps.app.goo.gl/...` hoặc `https://www.google.com/maps/place/...?cid=...`.
  Lưu ý: link `share.google/...` trong file **không dùng được** — phải mở ra rồi lấy link Maps đầy đủ.

Một dòng cần sửa: **Lux Her Spa** chưa có link Maps nào.

---

## 3. Trạng thái 13 tiệm trong file anh gửi

| Nhóm | Số tiệm | Ghi chú |
|---|---|---|
| Đúng danh mục có đặt lịch (Nail salon / Spa / Medical spa) | 12 | đủ điều kiện Đường A ngay |
| Nhà hàng (Saigon Palace Cafe) | 1 | dùng ô "Đặt bàn" |
| Thị trường | US 6 · CA 5 · AU 2 | cả 3 nước đều được Google hỗ trợ |
| Thiếu `place_id` | **13/13** | phải bổ sung trước khi nộp feed |
| Thiếu link Maps | 1 (Lux Her Spa) | bổ sung |
| Số điện thoại chưa chuẩn E.164 | 3 (`949-919-4263`, `+13103102995`, ` +61 7 5338 7379`) | chuẩn hoá `+<mã nước><số>` |

---

## 4. Lịch chạy đề xuất

| Tuần | Việc | Người làm |
|---|---|---|
| Tuần này | Gắn link đặt lịch vào hồ sơ Google 12 tiệm (Đường A) | Anh + chủ tiệm |
| Tuần này | Nộp form đối tác Reserve with Google | Anh |
| Tuần này | Bổ sung `place_id`, chuẩn hoá số điện thoại, thêm cột website | Anh (Lumio có thể tự sinh, xem mục 5) |
| Tuần 2–4 | Chờ Google mời vào Actions Center · chuẩn bị hợp đồng ký với từng tiệm | Anh |
| Tuần 4–8 | Cấu hình Actions Center + nộp feed + merchant matching | Kỹ thuật |
| Sau khi chạy | Đo lượt đặt từ Google trong Marketing report (đã có sẵn cột nguồn *Google Maps*) | Tự động |

---

## 5. Phần Lumio nên tự động hoá (đề xuất kỹ thuật)

Với 16 tiệm và sẽ tăng "rất nhiều", **không nên** duy trì file Excel thủ công. Nên bổ sung vào hệ thống:

1. **Trường `googlePlaceId` + `rwgEnabled`** cho mỗi tenant, khai trong Salon Admin → Settings.
2. **Endpoint sinh merchant feed** `GET /public/rwg/merchants.json` — xuất đúng schema Google, chỉ gồm tiệm đã bật và đã có place_id.
3. **Cron đẩy feed lên SFTP của Google mỗi ngày** (Google yêu cầu nộp lại định kỳ, feed cũ quá hạn sẽ bị hạ).
4. **Bảng theo dõi trạng thái ghép** trong Super Admin: tiệm nào đã match, tiệm nào lỗi.
5. Khi lên B2 (End-to-End): tái sử dụng luôn API booking sẵn có — chỉ cần bọc thêm 3 method Google quy định (`BatchAvailabilityLookup`, `CreateBooking`, `UpdateBooking`) + feed khung giờ trống.

Bước 1–4 làm được trong 1–2 ngày và dùng cho mọi tiệm mới về sau: thêm tiệm là tự vào feed, không phải sửa Excel.
