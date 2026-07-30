# Hồ sơ đăng ký Reserve with Google — Lumio Booking

_Chuẩn bị 30/07/2026 · Theo tài liệu Actions Center cập nhật 01/04/2026 · Đích: **Reservations Business Link**_

---

## PHẦN 1 — NỘI DUNG ĐIỀN VÀO FORM ĐĂNG KÝ

Form: **https://services.google.com/fb/forms/reservationsappointmentsonlinebooking-interestform/**

Form của Google bằng tiếng Anh và có thể đổi trường theo thời điểm. Dưới đây là **nội dung soạn sẵn theo từng chủ đề** — gặp trường nào thì dán nội dung tương ứng, không cần nghĩ tại chỗ.

### Thông tin công ty

| Trường | Nội dung dán |
|---|---|
| Company / Partner name | `Lumio Agency` |
| Platform / Product name | `Lumio Booking` |
| Website | `https://lumiobooking.com` |
| Country of incorporation | *(quốc gia đăng ký pháp nhân của anh)* |
| Contact name / email | `lumioagency.com@gmail.com` (nên đổi sang email tên miền, xem Phần 3) |
| Business type | `Booking software provider (SaaS) serving independent merchants` |

### Mô tả nền tảng (câu trả lời dài — dán nguyên khối)

> Lumio Booking is a multi-tenant appointment-booking platform for nail salons, spas and wellness businesses in North America and Australia. Each merchant has a dedicated, merchant-specific booking page (e.g. https://lumiobooking.com/lux-nail-spa) where customers choose a service, staff member and time slot, and receive an immediate confirmation by email and SMS. We operate the booking engine, calendar, staff scheduling, POS and customer records for every merchant under a direct service agreement with that merchant.

### Quy mô & thị trường

| Trường | Nội dung |
|---|---|
| Number of merchants live today | `13` |
| Expected in 12 months | `60–100` |
| Countries | `United States, Canada, Australia` |
| Verticals | `Beauty & personal care (nail salons, spas, medical spa), 1 restaurant` |
| Monthly bookings processed | *(điền số thật từ Dashboard — đừng thổi phồng, Google có thể đối chiếu)* |

### Loại tích hợp mong muốn

> We would like to start with the **Reservations Business Link** integration (merchant feed with merchant-specific action links), and upgrade to **Reservations End-to-End** once the Business Link integration is live and stable.

### Năng lực kỹ thuật (câu này quyết định việc được mời)

> We have an in-house engineering team and full control of our booking stack (Node.js/NestJS API, PostgreSQL, hosted on Render). We can generate and upload merchant feeds in JSON over SFTP on a daily schedule, manage SSH key exchange, and monitor ingestion through the Partner Portal. Our booking pages are HTTPS-only, mobile-first, require no account creation to complete a booking, and each merchant has a permanent, unique booking URL. For a future End-to-End integration we already expose a booking API with availability lookup, create, reschedule and cancel operations that can be adapted to the Actions Center Booking Server specification.

### Quan hệ với merchant

> We hold a direct commercial agreement with every merchant included in our feed. Merchants subscribe to Lumio Booking and we operate their booking channel on their behalf; no merchant is listed without a signed agreement.

---

## PHẦN 2 — CÁC BƯỚC ĐĂNG KÝ (thứ tự đúng)

| Bước | Việc | Thời gian | Ai làm |
|---|---|---|---|
| **1** | Chuẩn bị hồ sơ: place_id, số điện thoại E.164, email tên miền, trang Terms + Privacy | 2–3 ngày | Anh |
| **2** | Nộp **Partner interest form** (Phần 1) | 30 phút | Anh |
| **3** | Chờ Google mời vào **Actions Center** | 1–6 tuần, **không có SLA** | Google |
| **4** | Tạo SSH key, cấu hình liên hệ, cấu hình **Brand** (logo + tên Lumio hiện cạnh nút) | 1 ngày | Kỹ thuật |
| **5** | Nộp **merchant feed** JSON qua SFTP (file mẫu đã có sẵn) | 1 ngày | Kỹ thuật |
| **6** | **Merchant matching** — Google ghép từng dòng với địa điểm Maps, báo lỗi trong Partner Portal | 3–10 ngày | Anh sửa dữ liệu |
| **7** | **Pilot** vài tiệm → **Launch** toàn bộ | 1–2 tuần | Google |

Google ghi rõ trong tài liệu: **toàn bộ tích hợp thường mất 4–8 tuần** khi có người kỹ thuật chuyên trách.

---

## PHẦN 3 — ĐÁNH GIÁ TỶ LỆ ĐƯỢC DUYỆT (đánh giá thật, không tô hồng)

Chia làm 2 cửa ải độc lập:

### Cửa 1 — Được Google mời vào Actions Center

Đây là cửa **khó và không nằm trong tay anh**. Google không công bố tiêu chí, chỉ ghi *"we reserve the right to include or exclude merchants as we see appropriate"*. Thực tế Google ưu tiên nền tảng có quy mô.

| Yếu tố | Hiện trạng Lumio | Ảnh hưởng |
|---|---|---|
| Số merchant | 13 | ⚠️ **Yếu nhất** — dưới ngưỡng thường được ưu tiên |
| Ngành | Nail salon / spa | ✅ Ngành Google đang mở rộng |
| Thị trường US · CA · AU | 3 nước lớn | ✅ Tốt |
| Hợp đồng trực tiếp với merchant | Có | ✅ Bắt buộc, đã đạt |
| Trang booking riêng từng tiệm, HTTPS, mobile | Có | ✅ Đạt |
| Năng lực kỹ thuật tự làm feed | Có | ✅ Đạt |

**Ước lượng của em:** với 13 tiệm, xác suất được mời trong 8 tuần khoảng **40–55%**. Nếu nộp lại khi đã có **50+ tiệm**, xác suất lên khoảng **75–85%**. Đây là ước lượng dựa trên tiêu chí Google công bố + cách họ ưu tiên quy mô, **không phải số liệu chính thức của Google**.

### Cửa 2 — Sau khi được mời, có qua được kiểm duyệt kỹ thuật không

Cửa này **nằm trong tay anh** và mang tính cơ khí: feed đúng schema, merchant ghép được với Maps, link mở đúng trang đặt lịch của đúng tiệm.

**Ước lượng: 85–95%** nếu làm đủ checklist Phần 4. Rủi ro còn lại chủ yếu là vài tiệm không ghép được địa điểm (sai tên/địa chỉ so với Maps) — sửa được, chỉ mất thời gian.

### Nói thẳng về "đảm bảo 100%"

**Không ai đảm bảo được 100%** việc Google mời hợp tác — kể cả Google cũng không cam kết. Bất kỳ ai hứa 100% cho Cửa 1 là đang nói quá.

Nhưng có một thứ **chắc chắn 100%**: **Đường A** (gắn link đặt lịch trực tiếp vào hồ sơ Google từng tiệm) cho ra nút *Book online* trên Maps trong 24–48 giờ, không phụ thuộc Google có duyệt đối tác hay không. Điều kiện duy nhất là hồ sơ đã xác minh và danh mục đúng ngành — 12/13 tiệm của anh đã đủ.

Nên lộ trình dưới đây tách rõ: **kết quả đảm bảo** vs **kết quả nỗ lực tối đa**.

---

## PHẦN 4 — LỘ TRÌNH THEO CỔNG KIỂM SOÁT

### Giai đoạn 0 — Kết quả ĐẢM BẢO (tuần 1)

Mục tiêu: **13/13 tiệm có nút đặt lịch trên Google Maps**, không phụ thuộc ai duyệt.

- [ ] Mỗi tiệm: hồ sơ Google đã xác minh (chưa có thì làm trước)
- [ ] Danh mục chính đúng ngành (Nail salon / Spa / Medical spa / Restaurant)
- [ ] Dán link `lumiobooking.com/<slug>` vào ô **Đặt lịch hẹn** (nhà hàng: ô **Đặt bàn**)
- [ ] Sau 48 giờ kiểm lại từng hồ sơ, chụp màn hình lưu bằng chứng
- [ ] Bật gắn thẻ nguồn `?utm_source=google_maps` để Marketing report đo được lượt đặt từ Google

**Cổng G0:** ≥ 90% tiệm hiện nút. Chưa đạt → xử lý từng hồ sơ (thường do chưa xác minh).

### Giai đoạn 1 — Làm sạch dữ liệu trước khi nộp (tuần 1–2)

- [ ] Điền **place_id** cho đủ 13 tiệm (file Excel kèm theo có hướng dẫn 30 giây/tiệm)
- [ ] Bổ sung link Maps cho **Lux Her Spa**
- [ ] Số điện thoại E.164 — đã chuẩn hoá sẵn trong file
- [ ] Kiểm tra **tên + địa chỉ trong feed khớp từng chữ với Google Maps** (đây là nguyên nhân trượt matching số 1)
- [ ] Email tên miền `partners@lumiobooking.com` thay Gmail — hồ sơ đối tác dùng Gmail bị đánh giá thiếu chuyên nghiệp
- [ ] Trang **Terms of Service** và **Privacy Policy** công khai trên lumiobooking.com (Google sẽ kiểm)
- [ ] Hợp đồng/điều khoản dịch vụ ký với từng tiệm, lưu file

**Cổng G1:** file merchant list 13/13 dòng trạng thái "Sẵn sàng".

### Giai đoạn 2 — Nộp form (tuần 2)

- [ ] Dán nội dung Phần 1, đính kèm số liệu thật
- [ ] Lưu lại ngày nộp + ảnh chụp form
- [ ] Sau 3 tuần chưa hồi âm → nộp lại kèm cập nhật số merchant mới

**Cổng G2:** nhận lời mời Actions Center. **Không đạt → không sao**, Giai đoạn 0 vẫn đang chạy; quay lại nộp khi đủ 50 tiệm.

### Giai đoạn 3 — Kỹ thuật (khi đã được mời, 2–4 tuần)

- [ ] SSH key + SFTP, cấu hình Brand (logo Lumio)
- [ ] Nộp feed (file JSON mẫu đã có, chỉ cần thay place_id thật)
- [ ] Feed phải **nộp lại hàng ngày** — dựng cron, không làm tay
- [ ] Xử lý lỗi trong Feeds Dashboard đến khi 0 lỗi

**Cổng G3:** feed ingest 100%, matching ≥ 95% số tiệm.

### Giai đoạn 4 — Pilot & Launch (1–2 tuần)

- [ ] Google bật thử 2–3 tiệm → kiểm nút, kiểm link mở đúng trang
- [ ] Bật toàn bộ
- [ ] Theo dõi Onboarding Health Dashboard hàng tuần

**Cổng G4:** nút Reserve with Google hiện trên ≥ 90% tiệm.

---

## PHẦN 5 — 6 LỖI LÀM TRƯỢT PHỔ BIẾN (tránh từ đầu)

1. **Link trỏ về trang chủ** thay vì trang riêng của tiệm → vi phạm chính sách action link, trượt ngay.
2. **Tên/địa chỉ trong feed khác Google Maps** (viết tắt Suite/Ste, thiếu số phòng) → không ghép được địa điểm.
3. **Bắt khách tạo tài khoản** mới đặt được → vi phạm trải nghiệm.
4. **Feed để lâu không cập nhật** → Google hạ nút.
5. **Khai số merchant không đúng thực tế** → mất uy tín hồ sơ, khó xin lại.
6. **Đưa tiệm chưa ký hợp đồng vào feed** → vi phạm điều kiện tiên quyết, có thể bị chấm dứt tích hợp.

---

## PHẦN 6 — FILE KÈM THEO

| File | Dùng để |
|---|---|
| `Lumio-RwG-MerchantList-READY.xlsx` | Danh sách 13 tiệm đã chuẩn hoá + cột place_id cần điền + sheet hướng dẫn lấy place_id |
| `merchants-feed-sample.json` | Feed mẫu **đúng schema Google**, dữ liệu thật của 13 tiệm — chỉ cần thêm `place_id` là nộp được |

Khi đã có place_id, phần sinh feed nên chuyển thành endpoint tự động trong Lumio (`/public/rwg/merchants.json` + cron đẩy SFTP) để tiệm mới tự vào feed, không phải sửa Excel.
