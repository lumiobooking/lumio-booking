# LUMIO BOOKING — ĐO LƯỜNG CHUYỂN ĐỔI GA4 / GTM / GOOGLE ADS (v2 — 07/2026)

> Tài liệu bàn giao duy nhất. Áp dụng cho plugin ≥ 1.7.3. Multi-tenant: mỗi salon
> một GA4/GTM/Ads riêng, không dùng chung, không hard-code salon nào.

## 1. KIẾN TRÚC & CƠ CHẾ (đã triển khai trong code)

- Cài đặt per-salon (Integrations): `GA4 Measurement ID`, `GTM Container ID`,
  `analytics_mode` = auto | gtm | ga4 | none (auto ưu tiên GTM). **Chỉ một
  phương thức được nạp** trong một document; đổi salon trong SPA → hard reload.
- **Consent Mode v2**: default (analytics_storage, ad_storage, ad_user_data,
  ad_personalization = granted — thị trường US/CA) chạy TRƯỚC mọi tag; cập nhật
  qua `window.lumioConsentUpdate({...})`. Salon EU cần CMP gọi hàm này.
- **Sự kiện duy nhất / booking**: chỉ phát SAU khi backend xác nhận tạo booking.
  `transaction_id` = booking id backend (không rỗng); `value` = số backend trả
  (fallback client); `currency` ISO hoa; `items[]` = {item_id?, item_name,
  price, quantity}. Không PII. Idempotent trong app theo booking id (double
  click / retry / StrictMode / reload / Back-Forward đều không bắn lần 2 — event
  gắn vào response API, không gắn vào màn hình "Booking received").
- **Hosted (top window)**: mode gtm → `dataLayer.push({event:"booking_completed",...})`;
  mode ga4 → `gtag("event","purchase",{...})`; none → im lặng.
- **Iframe (nhúng website)**: im lặng tuyệt đối (không tag, không event). Chỉ
  `postMessage` lên ĐÚNG origin website cha (từ tham số `po` plugin gắn; không
  bao giờ dùng "*") với `{type:"lumio:booking_completed", schema_version:1,
  salon_slug, transaction_id, value, currency, items}`.
- **Plugin (≥1.7.3) xác thực message**: đúng origin Lumio, schema_version=1,
  salon_slug khớp cấu hình site, transaction_id không rỗng, sender phải là
  iframe do chính trang đó sở hữu trỏ về origin Lumio; chặn trùng theo
  transaction_id. Sau đó gửi theo **Conversion delivery** (Settings plugin):
  `gtm` (khuyên dùng — push dataLayer, GTM chưa tải vẫn xếp hàng) | `ga4` |
  `none` | `auto` (site cũ).
- **Attribution 30 ngày**: plugin lưu first-touch + last-touch (utm_source/
  medium/campaign/content/term, gclid, gbraid, wbraid, landing_url, referrer,
  captured_at) trong localStorage, tự gắn vào iframe → lưu snapshot vào booking
  (DB). Khách đi nhiều trang rồi mới đặt vẫn giữ nguồn.
- **Phân loại nguồn (server, first-party)**: `booking_surface` = hosted |
  website_embed; `acquisition_source` = google_ads (có click id) →
  google_maps_organic (utm_campaign=gbp_booking; 2 format link cũ vẫn nhận) →
  website (form nhúng) → referral → direct → unknown.

## 2. LINK CHUẨN

- **Google Business Profile — LINK NGẮN** (Integrations có nút Copy):
  `https://lumiobooking.com/{slug}/gbp`
  Route /gbp render đúng form đặt lịch thường; trước khi GA4/GTM gửi page_view,
  hệ thống tự gắn campaign google/organic/gbp_booking/booking_button vào URL
  (history.replaceState chạy trước mọi tag) → session + booking đều mang nguồn
  Google Maps, purchase phát đúng 1 lần. Link thường /{slug} KHÔNG bị gắn nguồn.
  KHÔNG dán link trần. **KHÔNG dùng link /gbp làm Google Ads Final URL.**
- **Google Ads**: Final URL riêng (website salon hoặc link đặt lịch KHÔNG kèm
  utm GBP), bật auto-tagging — hệ thống giữ nguyên gclid/gbraid/wbraid.

## 3. SETUP PHÍA GOOGLE (làm tay, mỗi salon một lần)

GA4: property CỦA SALON (chung với website) → Data stream → Configure your
domains: thêm domain salon + lumiobooking.com → List unwanted referrals: thêm
lumiobooking.com → Events: đánh dấu `purchase` là Key event. Trong dashboard gọi
`value` là **"Booked Value / Giá trị lịch đã đặt"** (chưa chắc đã thu tiền —
khách có thể trả tại tiệm). Không tạo thêm conversion Primary khác cho cùng booking.

GTM (khi salon dùng GTM): 4 Data Layer Variables (Version 2): `transaction_id`,
`value`, `currency`, `items` → Trigger Custom Event `booking_completed` → Tag
GA4 Event tên `purchase`, map 4 tham số. Payload là KEY PHẲNG — **không bật
"Send Ecommerce Data"**, không tự chuyển sang cấu trúc `ecommerce`.

Google Ads: link GA4 ↔ đúng account Ads của salon → Import GA4 `purchase` →
**Primary, Count = Every**. Website call conversion: dùng Google forwarding
number + minimum call duration (GA4 `click_call` chỉ là CLICK — để Secondary).
Maps Directions / Maps Calls: đọc từ GBP Performance + Ads Local Actions — 
KHÔNG tạo event `click_directions` trên website. Kết nối GBP ↔ Ads bằng
Location Assets. Không import 2 Primary từ cùng một booking.

## 4. NĂM MỤC TIÊU ĐO — NGUỒN SỐ

| Mục tiêu | Đo bằng |
|---|---|
| Booking trên website | iframe → postMessage (xác thực) → GTM/GA4 site → `purchase` |
| Booking từ Google Maps | link GBP `gbp_booking` → hosted đo trực tiếp + DB đích danh |
| Call trên website | GA4 `click_call` (click `tel:`) = Secondary; cuộc gọi thật = Ads forwarding number |
| Chỉ đường Google Maps | GBP Performance / Ads Local Actions (không event trên web) |
| Call trên Google Maps | GBP Performance / Ads Local Actions (không event trên web) |

## 5. BẢO MẬT & KHUYẾN NGHỊ HOSTED GTM

GTM do khách quản trị có thể chứa Custom HTML → chạy trên origin chung
`lumiobooking.com` là rủi ro cross-tenant (script tenant này chạy nơi tenant
khác nếu bị lợi dụng). Khuyến nghị đã ghi trong code: (1) hosted page ƯU TIÊN
mode `ga4` (an toàn, đủ đo purchase); (2) chỉ bật `gtm` cho tenant tin cậy;
(3) lộ trình cách ly: mỗi salon một hostname `{slug}.book.lumiobooking.com`
(wildcard DNS + cert, cookie/tag tách theo host — chưa đổi production, chỉ là
migration plan).

## 6. CHECKLIST

Salon MỚI: (1) tạo GA4 property + stream; (2) dán GA4/GTM ID + chọn mode trong
Integrations; (3) cross-domain + unwanted referrals; (4) key event purchase;
(5) nếu GTM: 4 DLV + trigger + tag; (6) cài plugin ≥1.7.3, điền slug, chọn
Conversion delivery = gtm; (7) dán link GBP có mã đo; (8) Ads: link GA4, import
purchase Primary/Every, auto-tagging; (9) test DebugView cả 3 luồng (trực tiếp,
nhúng, Maps) — mỗi booking đúng 1 event.

Salon CŨ nâng cấp: (1) deploy hệ thống + chờ plugin tự lên 1.7.3 (≤1h);
(2) vào plugin Settings chọn Conversion delivery (khuyên gtm); (3) thay link GBP
bằng bản `gbp_booking` mới; (4) kiểm tra mode trong Integrations (auto nếu
không chắc); (5) chạy lại 3 test DebugView.
