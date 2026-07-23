# LUMIO BOOKING — HỒ SƠ TRIỂN KHAI ĐO LƯỜNG GA4 / GTM / GOOGLE ADS

**Bản v4.1 — 07/2026 — Một file duy nhất dành cho Claude/ChatGPT/kỹ thuật viên. Đã đối chiếu từng mục với code Lumio thực tế (Phần 2 = hành vi đã kiểm chứng bằng test tự động).**

---

## 0. LỆNH THỰC HIỆN

Bạn là kỹ thuật viên triển khai GA4, Google Tag Manager, Google Ads và Google Business Profile cho hệ thống Lumio Booking.

Hãy đọc toàn bộ file này trước khi trả lời. Đây là nguồn thông tin duy nhất cần dùng cho quy trình triển khai.

### Nguyên tắc bắt buộc

1. Hệ thống Lumio Booking và plugin WordPress **đã phát sự kiện theo đặc tả ở Phần 2**. Không yêu cầu thêm script, sửa event hoặc gắn mã đo lường thủ công vào form đặt lịch.
2. Nhiệm vụ chính là hướng dẫn cấu hình trên giao diện **GA4 → GTM → plugin WordPress → Google Business Profile → Google Ads → kiểm thử**, đúng thứ tự trong file.
3. Hướng dẫn từng bước ngắn, ghi rõ bấm ở đâu. Sau mỗi bước phải chờ người dùng xác nhận hoặc gửi ảnh trước khi sang bước kế tiếp.
4. Không tự suy đoán ID, domain, số điện thoại, múi giờ, tiền tệ hoặc tài khoản quảng cáo.
5. Mỗi salon là một tenant độc lập; không dùng ID của salon này cho salon khác.
6. Nếu giao diện Google thay đổi tên menu, dùng mục tương đương hiện tại nhưng không thay đổi logic đo lường.
7. Không tạo thêm conversion/event trùng với những gì đã có.

### Trước khi bắt đầu, hỏi đủ 9 thông tin sau

1. Tên salon và slug Lumio.
2. Domain website salon.
3. GA4 Measurement ID, dạng `G-XXXXXXXXXX`.
4. GTM Container ID, dạng `GTM-XXXXXXX`.
5. Múi giờ báo cáo của salon.
6. Tiền tệ của salon, ví dụ `USD` hoặc `CAD`.
7. Website hiện dùng GTM hay gtag cài trực tiếp.
8. Salon có chạy Google Ads không; nếu có, lấy Google Ads Customer ID.
9. Số điện thoại chính xác đang hiển thị trên website và salon có quyền quản lý Google Business Profile hay không.

---

## 1. MỤC TIÊU ĐO LƯỜNG

Hệ thống cần theo dõi đúng năm hành động sau:

| Hành động | Nguồn dữ liệu chính | Có vào GA4 không? | Vai trò |
|---|---|---:|---|
| Gọi trên website | GTM/GA4 `click_call` | Có | Đo lượt bấm gọi; chưa khẳng định cuộc gọi thật |
| Booking thành công trên website | Plugin cha → GTM/GA4 `purchase` | Có | Chuyển đổi booking chính |
| Chỉ đường trên Google Maps | GBP Performance; Google Ads Local Actions nếu liên quan quảng cáo | Không | Chỉ số Maps, không tạo event giả trên website |
| Booking thành công từ Google Maps | Link ngắn `/{slug}/gbp` → GA4 `purchase` | Có | Chuyển đổi booking chính, nhận diện nguồn Maps |
| Gọi trên Google Maps | GBP Performance; Google Ads Local Actions nếu liên quan quảng cáo | Không | Chỉ số Maps; không phải event trên website |

### Kết quả cuối cùng cần đạt

- GA4 nhận đúng **một** `purchase` cho mỗi booking thành công.
- Booking website giữ nguồn của phiên website.
- Booking Google Maps được nhận diện là:
  - Session source / medium: `google / organic`
  - Session campaign: `gbp_booking`
  - UTM content: `booking_button`
- Google Ads tối ưu theo `purchase`, không nhập trùng một booking thành nhiều conversion chính.
- Click gọi trên website và hành động Maps được báo cáo riêng, không trộn với booking.

---

## 2. ĐẶC TẢ HỆ THỐNG ĐÃ HOẠT ĐỘNG

### 2.1 Kiến trúc multi-tenant

Mỗi salon có:

- Trang booking hosted: `https://lumiobooking.com/{slug}`
- Link Google Business Profile ngắn: `https://lumiobooking.com/{slug}/gbp`
- Website WordPress riêng, nhúng form bằng iframe qua plugin Lumio Booking phiên bản `≥ 1.7.3`
- GA4, GTM và Google Ads riêng

Trong **Lumio → Integrations → Google Analytics & Tag Manager**, mỗi salon nhập:

- GA4 Measurement ID
- GTM Container ID
- `analytics_mode`: `auto | gtm | ga4 | none`

Trên trang booking hosted, hệ thống chỉ nạp **một** phương thức đo lường. Không được đồng thời nạp GA4 trực tiếp và GTM.

### 2.2 Ba đường vào form booking

#### A. Hosted trực tiếp

URL:

```text
https://lumiobooking.com/{slug}
```

Dùng cho quảng cáo trỏ thẳng, bio hoặc link trực tiếp. Trang booking là top window và tự nạp đúng phương thức đo của salon.

#### B. Google Maps bằng link ngắn

URL được dán vào Google Business Profile:

```text
https://lumiobooking.com/{slug}/gbp
```

Người quản lý vẫn chỉ dán link ngắn này. Không bắt buộc dán URL UTM dài vào Google Business Profile.

Khi khách mở link, Lumio phải gắn thông tin chiến dịch sau **trước khi `page_view` đầu tiên được gửi**:

```text
utm_source=google
utm_medium=organic
utm_campaign=gbp_booking
utm_content=booking_button
```

URL có thể dài hơn sau khi khách mở; điều này không ảnh hưởng đến trải nghiệm nhập link trong Google Business Profile.

#### C. Form nhúng trên website salon

- Iframe không nạp GA4/GTM và không tự bắn event.
- Khi backend tạo booking thành công, iframe gửi `postMessage` lên trang cha.
- Message đã được xác thực bằng origin, slug và `schema_version`.
- Plugin WordPress đẩy sự kiện vào GTM hoặc GA4 của website theo thiết lập **Conversion delivery**.
- Việc đo trên trang cha giữ booking trong phiên của website, tránh `lumiobooking.com` chiếm nguồn.

### 2.3 Chống trùng và attribution

- Một booking chỉ phát sự kiện thành công một lần, idempotent theo booking ID.
- Double click, retry, reload, Back/Forward không được tạo thêm `purchase`.
- Không truyền tên, email, số điện thoại hoặc PII lên GA4/GTM.
- Hệ thống lưu attribution first-party 30 ngày gồm UTM, `gclid`, `gbraid`, `wbraid`, landing page và referrer.
- Dữ liệu attribution trong database Lumio dùng để đối chiếu với GA4, không thay thế GA4.

### 2.4 Event booking thành công

Event chỉ phát sau khi backend tạo booking thành công.

Payload chuẩn:

```json
{
  "transaction_id": "<booking_id_duy_nhat>",
  "value": 45.00,
  "currency": "USD",
  "items": [
    {
      "item_id": "svc_x",
      "item_name": "Gel Manicure",
      "price": 45.00,
      "quantity": 1
    }
  ]
}
```

`value` là **Giá trị lịch đã đặt — Booked Value**, không mặc định được gọi là doanh thu đã thu.

| Ngữ cảnh | Cách hệ thống phát |
|---|---|
| Hosted, mode `ga4` | `gtag('event', 'purchase', payload)` |
| Hosted, mode `gtm` | `dataLayer.push({event: 'booking_completed', ...payload})` |
| Iframe trên website | `postMessage` → plugin → GTM `booking_completed` hoặc GA4 `purchase` của trang cha |

### 2.5 Event gọi trên website

Website dùng GTM để bắt link có URL bắt đầu bằng `tel:` và gửi:

```text
click_call
```

Đây là lượt **bấm gọi**, không phải bằng chứng cuộc gọi đã kết nối. Cuộc gọi thật từ Google Ads phải dùng Google forwarding number và ngưỡng thời lượng cuộc gọi.

### 2.6 Chỉ đường và gọi trên Google Maps

Hai hành động này xảy ra trên nền tảng Google, không xảy ra trên website hoặc form booking. Vì vậy:

- Không tạo `click_directions` trên website.
- Không tạo event GA4 giả cho cuộc gọi trên Maps.
- Dùng Google Business Profile → Performance để xem tổng hành động từ hồ sơ.
- Dùng Google Ads → Local Actions để xem hành động liên quan đến quảng cáo và location asset.

Lưu ý: số liệu Google Ads Local Actions chỉ phản ánh phần được Google Ads ghi nhận, không thay thế toàn bộ dữ liệu GBP Performance.

---

## 3. QUY TRÌNH CẤU HÌNH — LÀM TỪ TRÊN XUỐNG

## Bước 0 — Điều kiện hệ thống (làm một lần, phía Lumio)

1. Bản Lumio mới nhất đã deploy thành công (Render build xanh — bản có route `/gbp`
   và migration `booking_attribution` đã áp).
2. Kiểm tra nhanh: mở Lumio → Integrations của salon → mục Google phải hiện link
   ngắn dạng `https://lumiobooking.com/{slug}/gbp` và nút "Copy link /gbp cho
   Google". Nếu vẫn thấy link dài kèm UTM → chưa deploy bản mới, dừng lại deploy trước.
3. Plugin WordPress tự cập nhật lên ≥ 1.7.3 trong vòng ~1 giờ sau deploy
   (hoặc vào wp-admin → Plugins bấm update). Xác nhận version trước khi làm Bước 5.

**Điều kiện hoàn tất:** Integrations hiện link `/gbp`; plugin website ≥ 1.7.3.

## Bước 1 — Kiểm tra tránh cài trùng trên website

1. Xác định website đang dùng:
   - GTM; hoặc
   - gtag trực tiếp.
2. Nếu dùng GTM, không để thêm một mã GA4 trực tiếp khác gửi cùng Measurement ID.
3. Nếu website có nhiều GTM container, xác định container chính xác của salon và loại trừ container cũ/trùng.
4. Chưa Publish bất kỳ thay đổi nào cho đến khi xác nhận đúng:
   - GA4 Measurement ID
   - GTM Container ID
   - domain salon

**Điều kiện hoàn tất:** website chỉ có một đường gửi dữ liệu đến GA4 cho cùng property.

## Bước 2 — Cấu hình nền tảng GA4

Trong GA4 property của salon:

1. Vào **Admin → Property settings**:
   - Reporting time zone = múi giờ địa phương của salon
   - Currency = tiền tệ salon sử dụng
2. Vào **Admin → Data collection and modification → Data retention**:
   - Event data retention = `14 months`
   - Reset user data on new activity = `On`
3. Vào **Admin → Data streams → chọn Web stream**:
   - Xác nhận Measurement ID đúng với salon
   - Không tạo stream mới nếu stream hiện tại đã đúng
4. Dán Measurement ID đó vào:
   - Website thông qua đúng phương thức đã chọn
   - Lumio → Integrations của đúng salon

### Cross-domain và unwanted referrals

Không cấu hình máy móc cho mọi salon.

- Với form iframe im lặng: không cần cross-domain giữa website và Lumio.
- Với khách mở trực tiếp link Google Maps `/gbp`: không cần nối phiên với website vì phiên bắt đầu trên Lumio.
- Chỉ cấu hình cross-domain nếu website có nút/link điều hướng top-level từ website sang trang hosted Lumio và cần giữ cùng phiên.
- Chỉ thêm `lumiobooking.com` vào unwanted referrals khi thực tế có referral không mong muốn từ luồng chuyển trang; không cần cho iframe im lặng.

**Điều kiện hoàn tất:** GA4 đúng salon, đúng múi giờ, đúng tiền tệ và không có stream/property trùng.

## Bước 3 — Cấu hình Google Tag trong GTM

Chỉ làm bước này nếu salon dùng GTM.

1. Vào GTM container của salon → **Tags**.
2. Kiểm tra đã có **Google Tag** với Tag ID bằng đúng GA4 Measurement ID chưa.
3. Nếu đã có và đúng:
   - Giữ lại
   - Không tạo thêm Google Tag thứ hai
4. Nếu chưa có:
   - Tags → New
   - Tag type: **Google Tag**
   - Tag ID: GA4 Measurement ID của salon
   - Trigger: **Initialization — All Pages**
   - Đặt tên: `Google Tag - [GA4 Measurement ID]`

**Điều kiện hoàn tất:** chỉ có một Google Tag nền gửi đến đúng GA4 property.

## Bước 4 — Cấu hình booking thành `purchase` trong GTM

Chỉ làm nếu hosted mode là `gtm` hoặc website plugin delivery là `gtm`.

### 4.1 Tạo bốn Data Layer Variables

Tạo bốn biến loại **Data Layer Variable**, Data Layer Version = `Version 2`:

| Tên biến gợi ý | Data Layer Variable Name |
|---|---|
| `DLV - transaction_id` | `transaction_id` |
| `DLV - value` | `value` |
| `DLV - currency` | `currency` |
| `DLV - items` | `items` |

### 4.2 Tạo trigger

- Trigger type: **Custom Event**
- Event name: `booking_completed`
- This trigger fires on: **All Custom Events**
- Tên: `CE - booking_completed`

### 4.3 Tạo tag GA4 Event

- Tag type: **Google Analytics: GA4 Event**
- Chọn Google Tag/Measurement ID đúng salon
- Event name: `purchase`
- Event parameters:

| Parameter | Value |
|---|---|
| `transaction_id` | `{{DLV - transaction_id}}` |
| `value` | `{{DLV - value}}` |
| `currency` | `{{DLV - currency}}` |
| `items` | `{{DLV - items}}` |

- Trigger: `CE - booking_completed`
- Tên tag: `GA4 Event - purchase - Lumio Booking`

Payload dùng key phẳng trên `dataLayer`. **Không bật Send Ecommerce data** và không tự bọc lại dưới object `ecommerce`.

### 4.4 Preview trước khi Publish

Trong GTM Preview:

1. Tạo một booking test.
2. Tìm custom event `booking_completed`.
3. Kiểm tra tag `purchase` fired đúng một lần.
4. Kiểm tra bốn biến có đúng giá trị.
5. Sau khi đạt mới Submit/Publish container.

## Bước 5 — Cấu hình plugin WordPress

Trong website salon:

1. Plugin Lumio Booking phải ở phiên bản `≥ 1.7.3`.
2. Vào Lumio Booking → Settings → **Conversion delivery**:
   - Website dùng GTM: chọn `gtm`
   - Website chỉ dùng gtag trực tiếp: chọn `ga4`
   - Không dùng `auto` nếu muốn cấu hình dễ kiểm soát và kiểm thử rõ ràng
3. Xác nhận plugin/iframe đang dùng đúng slug salon.

**Điều kiện hoàn tất:** booking trong iframe chỉ được trang cha phát một lần bằng đúng phương thức website đang dùng.

## Bước 6 — Xác nhận `purchase` trong GA4

1. Tạo một booking test trước để GA4 nhận event.
2. Vào **GA4 → Admin → Events/Key events**.
3. Tìm event `purchase`.
4. `purchase` thường là key event mặc định của GA4; chỉ cần **xác nhận** trạng thái key event đang bật.
5. Không tạo thêm event tên khác để đại diện cùng booking.
6. Không tạo thêm một key event trùng `purchase`.

## Bước 7 — Đo click gọi trên website

Trong GTM:

### Trigger

- Trigger type: **Just Links**
- Fire on: Some Link Clicks
- Điều kiện: `Click URL starts with tel:`
- Tên: `Click - Phone Link`

Nếu chưa thấy `Click URL` hoặc `Click Text`, vào **Variables → Configure** và bật các Built-in Variables liên quan đến Click.

### Tag

- Tag type: **GA4 Event**
- Event name: `click_call`
- Parameters:

| Parameter | Value |
|---|---|
| `link_url` | `{{Click URL}}` |
| `link_text` | `{{Click Text}}` |
| `page_location` | `{{Page URL}}` |
| `contact_method` | `phone` |

- Trigger: `Click - Phone Link`

Giữ `click_call` là chỉ số phụ/Secondary trước; không dùng nó thay cho cuộc gọi thật.

## Bước 8 — Cấu hình Google Business Profile

1. Vào Lumio → Integrations của đúng salon.
2. Copy link ngắn:

```text
https://lumiobooking.com/{slug}/gbp
```

3. Vào Google Business Profile → Edit profile → Booking/Appointment links.
4. Dán nguyên link ngắn `/gbp` và Save.
5. Không cần dán URL UTM dài.
6. Không dùng link trần `/{slug}` cho nút booking trên Maps nếu muốn phân biệt đích danh nguồn GBP.
7. Chờ Google xét duyệt nếu giao diện báo cần thời gian.

Booking hoàn tất được kiểm tra trong GA4/Lumio. GBP Performance có thể không hiển thị số booking hoàn tất giống một booking-provider integration chính thức; không dùng riêng chỉ số GBP để thay thế `purchase`.

## Bước 9 — Cấu hình Google Ads

Chỉ làm nếu salon chạy Google Ads.

### 9.1 Liên kết GA4 và Google Ads

1. GA4 → Admin → Product links → Google Ads links.
2. Link đúng Google Ads Customer ID của salon.
3. Bật auto-tagging trong Google Ads.

### 9.2 Nhập booking conversion

1. Google Ads → Goals → Conversions.
2. Import từ Google Analytics 4.
3. Chọn key event `purchase`.
4. Thiết lập:
   - Action optimization: **Primary**
   - Count: **Every**
   - Value: dùng giá trị và currency từ GA4
5. Không nhập hoặc tạo thêm conversion Primary khác cho cùng một booking.

### 9.3 Final URL

Google Ads có thể trỏ đến:

- Website salon; hoặc
- `https://lumiobooking.com/{slug}`

Không dùng link `/gbp` làm Google Ads Final URL vì `/gbp` được dành riêng để nhận diện Google Business Profile.

### 9.4 Đo cuộc gọi thật từ website

1. Google Ads → Goals → Conversions → tạo conversion loại **Phone calls → Calls to a phone number on your website**.
2. Nhập đúng số điện thoại đang hiển thị trên website.
3. Chọn minimum call duration, ví dụ 30 hoặc 60 giây theo tiêu chuẩn salon.
4. Lấy Conversion ID và Conversion Label do Google Ads cung cấp.
5. Trong GTM tạo **Google Ads Calls from Website Conversion** tag:
   - đúng Conversion ID
   - đúng Conversion Label
   - đúng số điện thoại
   - trigger trên các trang có số điện thoại hoặc All Pages nếu số xuất hiện toàn site
6. Preview và xác minh Google forwarding number thay thế đúng số trên website.
7. Có thể để cuộc gọi đủ thời lượng là Primary; `click_call` vẫn là Secondary.

### 9.5 Location Assets

1. Google Ads → Assets → Location.
2. Kết nối đúng Google Business Profile của salon.
3. Không dùng GBP hoặc Ads account của salon khác.

## Bước 10 — Kiểm tra Consent Mode v2

Trong Tag Assistant → tab **Consent**:

1. Consent default phải xuất hiện trước các tag đo lường.
2. Kiểm tra bốn tín hiệu:
   - `analytics_storage`
   - `ad_storage`
   - `ad_user_data`
   - `ad_personalization`
3. Sau khi người dùng lựa chọn consent, phải có consent update phù hợp.
4. Kiểm tra `page_view`, `purchase` và Google Ads tags hoạt động theo đúng trạng thái consent.
5. Không ép tất cả trạng thái thành `granted` nếu người dùng chưa đồng ý hoặc quy định địa phương không cho phép.
6. Hành vi thực tế của hệ thống (để đối chiếu, không phải việc cần làm):
   - Trang hosted Lumio đặt consent default = `granted` cho cả bốn tín hiệu
     TRƯỚC khi tag nạp (thị trường mặc định US/CA — nơi không áp dụng GDPR),
     và cung cấp hook `window.lumioConsentUpdate({...})` cho CMP khi salon cần.
     Trang hosted không có banner consent — đó là thiết kế, không phải thiếu sót;
     salon thị trường EU cần CMP riêng gọi hook trên.
   - Phía WEBSITE salon: consent do website/CMP của salon chịu trách nhiệm —
     kiểm tra T7 áp dụng cho website, không áp dụng cho trang hosted.

---

## 4. QUY TRÌNH KIỂM THỬ BẮT BUỘC

Mở đồng thời:

- GTM Preview/Tag Assistant
- GA4 DebugView
- GA4 Realtime

### T1 — Hosted trực tiếp có UTM test

Mở:

```text
https://lumiobooking.com/{slug}?utm_source=lumio_test&utm_medium=test&utm_campaign=booking_test
```

Đặt một lịch. Phải thấy:

- đúng một `purchase`
- đúng `transaction_id`
- đúng Booked Value và currency
- source / medium = `lumio_test / test`
- campaign = `booking_test`

### T2 — Form iframe trên website

1. Mở website salon với UTM test riêng.
2. Mở form nhúng và đặt lịch.
3. Phải thấy đúng một `purchase` được gửi bởi trang cha.
4. Phiên vẫn thuộc website/nguồn ban đầu, không trở thành referral từ `lumiobooking.com`.
5. Iframe không tạo `page_view` hoặc `purchase` riêng.

### T3 — Link Google Maps ngắn

Mở:

```text
https://lumiobooking.com/{slug}/gbp
```

Đặt lịch. Phải thấy:

- `page_view` và `purchase`
- Session source / medium = `google / organic`
- Session campaign = `gbp_booking`
- UTM content = `booking_button`

### T4 — Chống trùng

Sau khi đặt thành công:

1. Refresh trang.
2. Bấm Back rồi Forward.
3. Mở lại success state nếu có thể.

Kết quả: không có `purchase` thứ hai cho cùng `transaction_id`.

### T5 — Click gọi trên website

1. Bấm nút/link có `tel:`.
2. GTM Preview phải thấy trigger phone link.
3. GA4 phải nhận đúng một `click_call`.
4. `link_url` phải chứa đúng số điện thoại.

### T6 — Google Ads website call

Nếu đã cấu hình:

1. Dùng Tag Assistant kiểm tra tag Calls from Website Conversion fired.
2. Kiểm tra số trên website được Google forwarding number thay thế khi đủ điều kiện.
3. Không coi `click_call` là cuộc gọi thật.

### T7 — Consent Mode

Kiểm tra một lần trước và một lần sau khi chọn consent. Xác nhận consent default, consent update và hành vi của các tag.

### T8 — Báo cáo GA4

Vào **Reports → Acquisition → Traffic acquisition**:

- Primary dimension: `Session source / medium`
- Secondary dimension: `Session campaign`
- Xem các cột:
  - Key events
  - Purchase revenue/Booked Value
  - Users
  - Sessions

Hoặc dùng Explore:

- Rows: Session source / medium, Session campaign
- Values: Key events, Event count, Purchase revenue
- Filter: Event name exactly matches `purchase`

Phải phân biệt được tối thiểu:

- Google Maps: `google / organic`, campaign `gbp_booking`
- Google Ads: `google / cpc`
- Website/SEO/social/referral theo nguồn thực tế

---

## 5. CHẨN ĐOÁN KHI MỘT BOOKING BỊ ĐẾM HAI LẦN

Không kết luận ngay rằng chỉ do website cài GA4 trực tiếp và GTM cùng lúc. Kiểm tra theo thứ tự:

1. Cùng một `transaction_id` có hai `purchase` hay hai booking ID khác nhau.
2. Website có vừa gtag trực tiếp vừa Google Tag trong GTM gửi đến cùng GA4 không.
3. Website có hai GTM container không.
4. Có hai GA4 Event tag `purchase` cùng bắt `booking_completed` không.
5. `dataLayer.push({event: 'booking_completed'})` có chạy hai lần không.
6. Plugin listener hoặc `postMessage` có xử lý hai lần không.
7. Hosted page có vô tình nạp cả GA4 trực tiếp và GTM không.
8. Idempotency theo booking ID có hoạt động sau reload/retry không.

Chỉ Publish sau khi một booking test tạo đúng một `purchase`.

---

## 6. QUẢN LÝ DỮ LIỆU TEST

- Nên kiểm thử trước khi import `purchase` vào Google Ads.
- Nếu test trên production, ghi chú rõ booking test và hủy booking trong Lumio sau khi xác minh.
- Không đưa booking test vào báo cáo vận hành/doanh thu thật.
- Có thể dùng Developer Traffic trong GA4, nhưng phải để filter ở trạng thái **Testing** trước.
- Không bật filter loại trừ vĩnh viễn nếu chưa xác minh, vì dữ liệu bị loại sẽ không thể khôi phục trong GA4.

---

## 7. DANH SÁCH CẤM

- Không thêm script đo lường thủ công vào trang booking Lumio.
- Không dùng GA4/GTM/Ads ID của salon này cho salon khác.
- Không nạp đồng thời GA4 trực tiếp và GTM cho cùng property trên cùng trang.
- Không tạo Google Tag nền thứ hai khi container đã có tag đúng.
- Không bật Send Ecommerce data cho payload flat hiện tại.
- Không tạo conversion Primary khác cho cùng booking.
- Không dùng link `/gbp` làm Google Ads Final URL.
- Không dùng link trần `/{slug}` trên GBP nếu cần phân biệt nguồn Google Maps.
- Không tạo `click_directions` trên website.
- Không coi `click_call` là cuộc gọi đã kết nối.
- Không gọi `value` là doanh thu đã thu; phải gọi là **Giá trị lịch đã đặt**.
- Không cấu hình cross-domain/unwanted referrals nếu luồng thực tế không cần.

---

## 8. TIÊU CHÍ NGHIỆM THU CUỐI CÙNG

Chỉ kết luận hoàn tất khi tất cả mục sau đạt:

- [ ] Mỗi salon dùng đúng GA4, GTM và Ads ID riêng.
- [ ] Website chỉ có một phương thức gửi đến GA4.
- [ ] GTM có đúng một Google Tag nền.
- [ ] Hosted direct tạo đúng một `purchase`.
- [ ] Iframe website tạo đúng một `purchase` từ trang cha.
- [ ] Link `/gbp` tạo `purchase` với `google / organic` và `gbp_booking`.
- [ ] `transaction_id`, `value`, `currency`, `items` đều đúng.
- [ ] Reload/Back/Forward không đếm lại cùng booking.
- [ ] Website phone link tạo đúng một `click_call`.
- [ ] Maps Directions/Calls được đọc từ GBP/Ads, không tạo event web giả.
- [ ] `purchase` là key event trong GA4.
- [ ] Google Ads import duy nhất `purchase` làm Primary, Count = Every.
- [ ] Google Ads auto-tagging và Location Asset đã bật nếu salon chạy Ads.
- [ ] Website call conversion dùng Google forwarding number nếu cần đo cuộc gọi thật.
- [ ] Consent Mode v2 đã được kiểm tra trong Tag Assistant.
- [ ] Báo cáo GA4 phân biệt được Maps, Ads và các nguồn website khác.

---

## 8B. QUY TRÌNH TIỆM MỚI — 15 PHÚT (turnkey)

Lumio đã tự động: `analytics_mode` mặc định auto; link `/gbp` tự sinh theo slug;
plugin tự cập nhật + Conversion delivery; consent default; chống trùng; attribution.
Việc còn lại cho MỖI tiệm mới đúng 4 bước:

1. **Tạo GA4 property** của tiệm (đúng múi giờ + tiền tệ) → copy `G-ID` →
   dán vào Lumio → Integrations. (5 phút)
2. **GTM**: Admin → Import Container → chọn file mẫu
   `https://lumiobooking.com/downloads/lumio-gtm-container.json` (nút tải ngay
   trong Integrations) → Merge → sửa MỘT biến `CONST - GA4 Measurement ID`
   thành G-ID của tiệm → Preview thử → Publish. Mẫu đã gồm: Google Tag nền,
   4 DLV + trigger `booking_completed` + tag `purchase`, trigger `tel:` +
   tag `click_call`. (5 phút — thay cho toàn bộ Bước 3, 4, 7)
3. **GBP**: copy link `/{slug}/gbp` trong Integrations → dán vào Bookings →
   Save. (2 phút)
4. **Test T1 + T2 + T3** bằng DebugView → xác nhận `purchase` là key event →
   (nếu chạy Ads) import purchase Primary/Every. (3 phút)

Sau import mẫu vẫn đối chiếu nhanh theo Bước 3-4-7 nếu cần tuỳ biến thêm.

---

## 9. TÀI LIỆU GOOGLE CHÍNH THỨC THAM KHẢO

- Google Tag trong GTM: <https://support.google.com/tagmanager/answer/9442095>
- GA4 key events: <https://support.google.com/analytics/answer/13128484>
- GA4 cross-domain measurement: <https://support.google.com/analytics/answer/10071811>
- GA4 data retention: <https://support.google.com/analytics/answer/7667196>
- GA4 currency: <https://support.google.com/analytics/answer/9796179>
- GA4 Traffic acquisition: <https://support.google.com/analytics/answer/12923437>
- GA4 ecommerce `purchase`: <https://developers.google.com/analytics/devguides/collection/ga4/set-up-ecommerce>
- Google Ads website call conversions: <https://support.google.com/google-ads/answer/6095883>
- Google Ads local actions: <https://support.google.com/google-ads/answer/9013908>
- Google Business Profile Performance: <https://support.google.com/business/answer/9918094>
- Google Business Profile local links: <https://support.google.com/business/answer/6218037>

---

## 10. CÁCH CLAUDE PHẢI BẮT ĐẦU SAU KHI ĐỌC FILE

Claude không tóm tắt lại toàn bộ tài liệu và không đưa tất cả bước cùng lúc. Câu trả lời đầu tiên chỉ cần:

1. Xác nhận đã hiểu kiến trúc hosted `/slug`, GBP `/slug/gbp` và iframe website.
2. Yêu cầu người dùng cung cấp 9 thông tin ở Phần 0.
3. Sau khi nhận đủ, bắt đầu từ **Bước 1 — kiểm tra tránh cài trùng trên website**.
4. Mỗi lần chỉ hướng dẫn một bước và chờ ảnh/xác nhận trước khi tiếp tục.

