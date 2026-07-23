# LUMIO BOOKING — QUY TRÌNH LƯU CHUYỂN ĐỔI & LỆNH TRIỂN KHAI GA4 CHI TIẾT TỪNG HÀNH ĐỘNG
(Bản v3 — 07/2026. Dán NGUYÊN file này cho ChatGPT. Một file duy nhất, đọc từ trên xuống.)

---

## PHẦN 0 — LỆNH CHO CHATGPT

Bạn là kỹ thuật viên GA4/GTM/Google Ads. Hệ thống Lumio Booking ĐÃ TỰ PHÁT đầy đủ
sự kiện như mô tả ở Phần 1-2 — TUYỆT ĐỐI không bảo tôi thêm code, thêm script,
sửa event, hay gắn tag vào trang đặt lịch. Việc của bạn CHỈ là hướng dẫn tôi
CẤU HÌNH trên giao diện GA4 / GTM / Google Ads / Google Business Profile theo
Phần 3, đúng thứ tự, từng bước bấm ở đâu. Trước khi bắt đầu, hỏi tôi 5 giá trị:
(1) tên salon + slug, (2) domain website salon, (3) GA4 Measurement ID (nếu có),
(4) GTM Container ID (nếu có), (5) salon có chạy Google Ads không. Sau đó dẫn tôi
đi từng bước, mỗi bước chờ tôi xác nhận xong mới sang bước kế. Kết thúc bằng
phần kiểm thử ở Phần 4.

---

## PHẦN 1 — HỆ THỐNG (những gì ĐÃ chạy sẵn, không cần làm lại)

Multi-tenant: mỗi salon có trang đặt lịch `https://lumiobooking.com/{slug}`,
website WordPress riêng (form nhúng iframe qua plugin Lumio ≥1.7.3), GA4/GTM/Ads
riêng. Trong Lumio → Integrations, salon dán GA4 ID + GTM ID + chọn
`analytics_mode` (auto | gtm | ga4 | none) — trang đặt lịch CHỈ nạp MỘT phương
thức, không bao giờ nạp cả hai. Consent Mode v2 default chạy trước tag.

Ba đường vào form:
- **A. Hosted trực tiếp**: `lumiobooking.com/{slug}` (ads trỏ thẳng, bio link).
- **B. Link Google Maps NGẮN**: `lumiobooking.com/{slug}/gbp` — cùng form,
  hệ thống tự gắn campaign google/organic/gbp_booking/booking_button vào URL
  TRƯỚC khi page_view được gửi.
- **C. Nhúng iframe trên website salon**: iframe IM LẶNG (không tag, không
  event); khi đặt xong chỉ postMessage (đã xác thực origin + slug +
  schema_version) lên website; plugin đẩy vào GTM/GA4 CỦA WEBSITE theo cài đặt
  "Conversion delivery" (gtm | ga4 | none | auto).

Chống trùng: mỗi booking chỉ phát 1 event (idempotent theo booking id ở cả form
lẫn plugin; double click / retry / reload / Back-Forward không phát lại). Không
PII. Attribution 30 ngày (utm×5 + gclid/gbraid/wbraid + landing + referrer) được
plugin lưu và gắn vào booking trong database — độc lập với GA4.

---

## PHẦN 2 — TỪNG HÀNH ĐỘNG HỆ THỐNG PHÁT RA (đặc tả để đối chiếu, không phải việc cần làm)

### Hành động 1: Khách mở trang đặt lịch
| Ngữ cảnh | Điều gì xảy ra |
|---|---|
| A. `/{slug}` | Tag của salon nạp → GA4 nhận `page_view`, nguồn = UTM/referrer thực tế |
| B. `/{slug}/gbp` | URL tự thành `...?utm_source=google&utm_medium=organic&utm_campaign=gbp_booking&utm_content=booking_button` TRƯỚC tag → `page_view` mang nguồn Google Maps |
| C. iframe trên web salon | KHÔNG có page_view từ iframe (thiết kế). Website tự đo page_view của nó |

### Hành động 2: Khách đặt lịch THÀNH CÔNG (chuyển đổi chính — duy nhất)
Chỉ phát sau khi backend tạo booking. Payload chuẩn mọi ngữ cảnh:
```json
{ "transaction_id": "<booking id>", "value": 45.00, "currency": "USD",
  "items": [{ "item_id": "svc_x", "item_name": "Gel Manicure", "price": 45.00, "quantity": 1 }] }
```
| Ngữ cảnh | Cách phát |
|---|---|
| A/B hosted, mode GA4 | `gtag('event','purchase', payload)` |
| A/B hosted, mode GTM | `dataLayer.push({event:'booking_completed', ...payload})` → GTM đổi thành GA4 `purchase` |
| C iframe | postMessage → plugin → theo Conversion delivery của site (gtm: push dataLayer; ga4: gtag purchase) |

`value` = **Giá trị lịch đã đặt (Booked Value)** — KHÔNG phải doanh thu đã thu
(khách có thể trả tại tiệm).

### Hành động 3: Khách bấm GỌI trên website
GA4 `click_call` (tự bắt qua GTM trigger Click URL bắt đầu `tel:` — cấu hình ở
Phần 3.4). Đây chỉ là CLICK. Cuộc gọi THẬT đo bằng Google Ads forwarding number.

### Hành động 4-5: Chỉ đường / Gọi trên Google Maps
KHÔNG có event nào trên web (đúng thiết kế). Đọc số từ Google Business Profile
→ Performance, và Google Ads → Local Actions (Directions / Clicks to call).
KHÔNG tạo `click_directions` trên website.

---

## PHẦN 3 — VIỆC CẤU HÌNH (ChatGPT dẫn tôi làm theo đúng thứ tự này)

### 3.1 GA4 nền tảng (mọi salon)
1. Dùng/tạo GA4 property CỦA salon (chung với website). Web stream = domain website salon.
2. Admin → Data streams → chọn stream → Configure tag settings:
   - Configure your domains: thêm `domain-salon.com` VÀ `lumiobooking.com`.
   - List unwanted referrals: thêm `lumiobooking.com`.
3. Dán Measurement ID vào: website (GTM hoặc gtag) VÀ Lumio → Integrations.
4. Chọn `analytics_mode` trong Lumio: salon có GTM → `gtm`; không → `ga4`.

### 3.2 Chuyển đổi booking (Hành động 2)
1. Đặt thử 1 booking test (Phần 4) để event về property.
2. GA4 → Admin → Events → tìm `purchase` → gạt **Mark as key event**.
3. Salon dùng GTM (mode gtm hoặc form nhúng + delivery gtm) thì trong GTM tạo:
   - 4 biến Data Layer Variable (Version 2): `transaction_id`, `value`, `currency`, `items`.
   - Trigger: Custom Event, tên sự kiện `booking_completed`.
   - Tag: GA4 Event, Event name `purchase`, tham số map 4 biến trên.
   - LƯU Ý: payload là KEY PHẲNG — KHÔNG bật "Send Ecommerce data", không tự
     chế cấu trúc `ecommerce`.
   - Publish.
4. Plugin WordPress → Lumio Booking → Settings → Conversion delivery = `gtm`
   (site không có GTM thì `ga4`).

### 3.3 Google Business Profile (Hành động 1B + 4-5)
1. Lumio → Integrations → copy link ngắn `https://lumiobooking.com/{slug}/gbp`.
2. GBP → Edit profile → Bookings / Appointment links → dán link /gbp → Save
   (duyệt 24-48h). KHÔNG dán link thường (mất định danh nguồn).
3. Đọc chỉ đường/gọi Maps tại GBP → Performance (không cấu hình gì thêm).

### 3.4 Đo click gọi trên website (Hành động 3)
Trong GTM của website: Trigger "Just Links", điều kiện Click URL starts with
`tel:` → Tag GA4 Event tên `click_call` (tham số `link_url` = {{Click URL}}).
Không đánh dấu key event vội — để Secondary.

### 3.5 Google Ads (salon có chạy Ads)
1. Ads ↔ GA4: GA4 Admin → Product links → Google Ads → link đúng account salon.
2. Ads → Goals/Conversions → Import → GA4 key event `purchase` →
   **Primary, Count = Every**.
3. Bật auto-tagging (gclid) — hệ thống giữ gclid/gbraid/wbraid và lưu vào booking.
4. Final URL của Ads = website salon hoặc `lumiobooking.com/{slug}` —
   **TUYỆT ĐỐI KHÔNG dùng link /gbp làm Final URL**.
5. Đo cuộc gọi thật: Ads → Conversions → Phone calls → website call conversion
   (Google forwarding number) + đặt minimum call duration (vd 30s) → có thể để
   Primary. `click_call`, Maps Directions, Maps Calls → Secondary.
6. Ads → Assets → Location: kết nối Google Business Profile (Location Assets).
7. KHÔNG import thêm conversion Primary nào khác từ cùng booking.

---

## PHẦN 4 — KIỂM THỬ TỪNG HÀNH ĐỘNG (bắt buộc, dùng GA4 DebugView + Realtime)

| # | Làm gì | Phải thấy |
|---|---|---|
| T1 | Mở `lumiobooking.com/{slug}?utm_source=test` → đặt 1 lịch | đúng 1 `purchase`, source `test` |
| T2 | Mở website salon → mở form nhúng → đặt 1 lịch | đúng 1 event qua GTM site, session vẫn của website (không phải referral lumiobooking.com) |
| T3 | Mở `lumiobooking.com/{slug}/gbp` → đặt 1 lịch | page_view + purchase mang google / organic / gbp_booking |
| T4 | Đặt xong bấm Back rồi Forward, F5 trang thành công | KHÔNG có purchase thứ 2 |
| T5 | Bấm nút gọi trên website | 1 `click_call` |
| T6 | Xem GA4 Engagement → Events → purchase + dimension "Session source / medium" | phân biệt rõ google/organic (Maps) vs google/cpc (Ads) vs facebook... |

Thấy 2 event cho 1 booking ⇒ website đang nạp trùng GA4 direct + GA4 trong GTM
(lỗi duy nhất có thể gây trùng, nằm ở phía website — tắt một trong hai).

## PHẦN 5 — NHỮNG ĐIỀU CẤM
- Không thêm bất kỳ script đo lường nào vào trang đặt lịch (hệ thống tự lo).
- Không dùng ID của salon này cho salon khác.
- Không bật Send Ecommerce data trong tag GTM.
- Không dùng link /gbp làm Google Ads Final URL.
- Không tạo event chỉ đường trên website.
- Không gọi `value` là "doanh thu đã thu" trong báo cáo — gọi là "Giá trị lịch đã đặt".
