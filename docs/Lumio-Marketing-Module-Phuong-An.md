# Module Marketing tổng thể — Phương án tích hợp vào Lumio Booking

> Bản phân tích & thiết kế. **Chưa code.** Chờ anh xác nhận rồi mới triển khai.
> Ngày: 22/07/2026.

---

## 0. Tóm tắt cho người bận

Ý tưởng **làm được**, và hệ thống hiện tại đã sẵn **khoảng một nửa nền tảng** — đây là
lợi thế lớn. Những gì đã có: gán nguồn khách (website / link Lumio / hotline / messenger /
vãng lai) + thiết bị, doanh thu theo nguồn, tỷ lệ đến/no-show, review Google, hội thoại
Messenger, cuộc gọi AI Hotline, chiến dịch email/SMS, chương trình giới thiệu, và cấu trúc
**đại lý quản lý nhiều tiệm** (AccountGroup + Super Admin).

Cái còn thiếu để thành "marketing tổng thể": **lớp chi phí**, **các kênh quảng cáo trả tiền**
(Facebook/Google/TikTok Ads, Google Maps), và **lớp tự động sinh báo cáo cuối tháng có AI**.

Nguyên tắc xuyên suốt, đúng yêu cầu của anh: **không bịa số**. Mỗi con số gắn nhãn nguồn gốc
(tự động trong hệ thống / API nền tảng / nhập tay / tính ra). Thiếu dữ liệu thì ghi "chưa có",
không đoán.

**Đề xuất bắt đầu:** Giai đoạn 0 + 1 (tái dùng dữ liệu sẵn có + nhập tay chi phí + báo cáo AND
AI duyệt tay) — mang lại 80% giá trị, rủi ro thấp, **không đụng gì tới booking**, không cần
tích hợp API nền tảng nào. Các API tự động (Meta/Google...) làm sau, từng cái một.

---

## 1. Phân tích hệ thống hiện tại (những gì TÁI DÙNG được)

| Đã có trong hệ thống | Dùng cho marketing thế nào |
|---|---|
| `Appointment.source` (website/lumiolink/hotline/messenger/walkin/staff) + `device` | **Xương sống attribution**: mỗi booking đã biết đến từ kênh nào, thiết bị gì |
| `/stats/sources` | Lượt khách + doanh thu theo kênh, theo ngày/tháng/năm |
| `/overview/dashboard` | Doanh thu, tỷ lệ **đến thật (completion)**, **no-show**, khách mới, top dịch vụ/thợ, giờ cao điểm |
| `GoogleReview` + `ReviewClick` | Uy tín Google: số sao, số review mới, lượt bấm nút đánh giá |
| `MessengerThread` / `MessengerConnection` | Số hội thoại Messenger (lead nhắn tin) |
| `VoiceCall` (outcome: booked/info/handoff…) + `durationSec` | AI Hotline: số cuộc gọi, bao nhiêu ra booking |
| `EmailCampaign` (total/sent/failed) | Email marketing: đã gửi bao nhiêu, tới bao nhiêu |
| `campaigns` (email+SMS tự động: sinh nhật, khách lâu không quay lại) | Marketing giữ chân — số tin đã gửi |
| `Customer.referralCode` / `referredById` | Chương trình giới thiệu: khách mới đến từ giới thiệu |
| `AccountGroup` + `BranchMembership` + Super Admin | **Đại lý quản lý nhiều tiệm & nhiều cơ sở** — sẵn rồi |
| `Plan` / `Subscription` | Chi phí phần mềm (nếu muốn tính vào tổng chi phí dịch vụ) |
| Scheduled tasks (cron) | Chạy **tự động sinh báo cáo cuối tháng** |
| Payments-hub: BYO-key + mã hoá AES-256-GCM + revoke | **Khuôn mẫu sẵn** để kết nối API nền tảng ngoài (mỗi tiệm tự nhập key) |

**Kết luận:** phần "marketing tạo ra bao nhiêu booking → bao nhiêu khách đến → doanh thu"
**đã đo được ngay hôm nay** từ dữ liệu booking, không cần tích hợp gì thêm. Đây là điểm mạnh
nhất và là nơi nên bắt đầu.

### Cái CHƯA có (khoảng trống cần lấp)

| Thiếu | Cách lấp |
|---|---|
| **Chi phí quảng cáo** (ad spend) từng kênh | Nhập tay (GĐ1) → API nền tảng (GĐ3) |
| **Reach / impression / click / lượt gọi từ quảng cáo** trên FB/IG/TikTok/Google | API nền tảng (GĐ3), hoặc nhập tay số tổng (GĐ1) |
| **Google Maps insights** (lượt tìm, chỉ đường, gọi) | Google Business Profile API (GĐ3) |
| **Attribution cấp chiến dịch/nội dung** (post nào ra booking nào) | Thêm UTM vào link booking (GĐ2) |
| **Lead trước khi thành booking** (nhắn tin/gọi chưa đặt) | Có sẵn một phần (VoiceCall, MessengerThread); gom thành "Lead" (GĐ2) |
| **Báo cáo tháng tự động + AI viết nháp** | Module mới (GĐ1) |

---

## 2. Cách module mới hoạt động (tổng quan)

Một module **"Marketing"** tách biệt, bật/tắt bằng feature-flag, **không đụng luồng booking**.
Ba lớp dữ liệu, mỗi con số luôn kèm **nhãn nguồn gốc**:

```
   NGUỒN DỮ LIỆU                        LỚP GOM                    ĐẦU RA
┌────────────────────┐
│ Tự động (in-system)│─┐
│ booking/source,    │ │
│ review, messenger, │ │      ┌──────────────────────┐      ┌───────────────────────┐
│ hotline, email     │ ├────► │  Marketing Data Hub   │────► │ Báo cáo NỘI BỘ (Lumio)│
├────────────────────┤ │      │  (theo tiệm × kênh    │      │ quản lý mọi tiệm/kênh │
│ API nền tảng (sau) │ │      │   × tháng)            │      ├───────────────────────┤
│ Meta, Google Ads,  │ ├────► │  + tính CPL/CPA/CAC   │────► │ Báo cáo KHÁCH (đơn giản│
│ GBP, TikTok, GA    │ │      │  chỉ khi đủ dữ liệu   │      │ trực quan, không jargon│
├────────────────────┤ │      └──────────┬───────────┘      │ + AI viết nháp)       │
│ Nhập tay           │─┘                 │                  └───────────────────────┘
│ chi phí, công việc,│         ┌─────────▼──────────┐
│ ghi chú, kế hoạch  │         │  AI phân tích tháng │  (Claude tóm tắt, tìm điểm mạnh/yếu,
└────────────────────┘         │  → nháp báo cáo     │   đề xuất kế hoạch — chỉ từ số THẬT)
                               └────────────────────┘
```

**Vòng đời báo cáo tháng (tự động hoá tối đa):**

```
[Cron cuối tháng] → gom số + AI viết nháp → trạng thái "Chờ duyệt"
     → Nhân viên Lumio mở, kiểm tra, sửa nhận xét, thêm kế hoạch → "Duyệt"
     → Gửi khách (link portal + PDF thương hiệu tiệm)
```

Nhân viên **không viết lại từ đầu** — chỉ kiểm tra, bổ sung, duyệt. Đúng mục tiêu.

---

## 3. Luồng sử dụng & giao diện chính

### 3.1. Cổng NỘI BỘ (Lumio Agency — Super Admin)

- **Bảng tổng đại lý**: danh sách mọi tiệm, mỗi dòng: chi tiêu tháng, booking từ marketing,
  doanh thu quy đổi, ROI, trạng thái báo cáo (Nháp/Chờ duyệt/Đã gửi). Lọc theo AccountGroup.
- **Trang một tiệm**: 4 tab
  1. **Kênh** — bật/tắt & kết nối từng kênh (FB, IG, Google Ads, GBP, TikTok, SEO, Email, SMS)
  2. **Chi phí & số liệu** — bảng nhập tay (GĐ1) hoặc tự đồng bộ (GĐ3), theo tháng
  3. **Công việc đã làm** — log đầu việc marketing (đăng bài, chạy ads, tối ưu SEO…)
  4. **Báo cáo** — nút "Tạo báo cáo tháng" → AI nháp → sửa → duyệt → gửi

### 3.2. Cổng KHÁCH (Salon Admin — đơn giản, trực quan)

Một trang kể chuyện 3 phần, **không thuật ngữ**:

1. **"Tháng này đã chi bao nhiêu"** — tổng chi phí + chia theo kênh (biểu đồ tròn).
2. **"Nhận lại được gì"** — số khách marketing mang tới → bao nhiêu **đã đến thật** →
   doanh thu quy đổi → **chi phí cho mỗi khách mới** (chỉ hiện khi đủ số). Kèm review mới,
   lượt tiếp cận, tin nhắn, cuộc gọi.
3. **"Lumio đã & sẽ làm gì"** — công việc tháng này + **kế hoạch tháng sau** (do AI gợi ý,
   nhân viên duyệt).

Xem trên web (link riêng) hoặc tải **PDF thương hiệu tiệm** (tái dùng skill PDF đã có).

Mockup kèm theo file này.

---

## 4. Dữ liệu: tự động lấy vs nhập tay

| Chỉ số | Nguồn | Giai đoạn |
|---|---|---|
| Booking theo kênh, thiết bị | **Tự động** (đã có) | 0 |
| Khách **đến thật** (completed) theo kênh | **Tự động** (đã có) | 0 |
| Doanh thu theo kênh | **Tự động** (đã có) | 0 |
| Khách mới / quay lại | **Tự động** (đã có) | 0 |
| Review Google mới, lượt bấm đánh giá | **Tự động** (đã có) | 0 |
| Hội thoại Messenger, cuộc gọi Hotline (+ ra booking) | **Tự động** (đã có) | 0 |
| Email/SMS đã gửi | **Tự động** (đã có) | 0 |
| **Chi phí quảng cáo mỗi kênh** | **Nhập tay** → sau này API | 1 → 3 |
| Reach / click / lượt gọi từ quảng cáo | Nhập tay (số tổng) → API | 1 → 3 |
| Google Maps: lượt tìm, chỉ đường | API GBP | 3 |
| **Công việc đã làm / ghi chú / kế hoạch** | **Nhập tay** (có mẫu nhanh) | 1 |
| CPL, CPA, CAC, ROI/ROAS | **Tính ra** (chỉ khi có cả chi phí + kết quả) | 1 |
| Attribution cấp chiến dịch (UTM) | Tự động (sau khi thêm UTM) | 2 |

> Quy tắc vàng: chỉ số **tính ra** (CPL/CPA/ROI) chỉ hiển thị khi **cả tử số lẫn mẫu số là số
> thật**. Thiếu chi phí → ẩn ROI, ghi "cần nhập chi phí". Không bao giờ hiện 0 giả hay ước đoán.

---

## 5. Liên kết Marketing ↔ Booking ↔ Doanh thu (trái tim của module)

Đã có nền: mỗi booking mang `source`. Nâng cấp 2 mức:

**Mức A — theo kênh (làm được NGAY, GĐ0):**
```
Kênh (Website/Hotline/Messenger/…) ──► #booking ──► #đến thật ──► doanh thu
                                                                     │
                        Chi phí kênh (nhập tay) ──────────────► CPL / CPA / ROI
```
Ví dụ khách sẽ thấy: "Messenger: chi $200 → 18 tin nhắn → 9 booking → 7 khách đến →
$430 doanh thu → $28/khách mới." Tất cả số booking/đến/doanh thu là **thật, tự động**.

**Mức B — theo chiến dịch/nội dung (GĐ2, thêm UTM):**
Gắn `utm_source/medium/campaign/content` vào link booking chia sẻ trên từng bài/quảng cáo.
Khi khách đặt, lưu UTM vào `Appointment`. → biết **bài viết / quảng cáo cụ thể nào** ra
booking nào, doanh thu bao nhiêu. Đây là thứ đại lý marketing nào cũng mơ nhưng ít ai đo được.

**Cửa sổ quy gán (attribution window):** booking tính cho kênh dựa trên `source`/UTM tại thời
điểm đặt. Với khách quay lại nhiều lần, mặc định tính "first-touch" cho khách mới, doanh thu
các lần sau tính riêng — sẽ chốt quy tắc rõ khi triển khai.

---

## 6. Lộ trình triển khai (dễ + giá trị trước, không đụng booking)

| GĐ | Nội dung | Auto/Manual | Giá trị | Rủi ro |
|---|---|---|---|---|
| **0. Bảng marketing từ dữ liệu sẵn có** | Trang gộp `/stats/sources` + `/overview/dashboard` + review/messenger/hotline/email → câu chuyện "kênh → booking → đến → doanh thu". Không nhập gì. | Auto | Cao — thấy ngay hiệu quả kênh **sở hữu** | Rất thấp (chỉ đọc) |
| **1. Chi phí + Công việc + Báo cáo AI duyệt tay** | Bảng nhập chi phí/số liệu/công việc theo tháng; tính CPL/CPA/ROI; **AI viết nháp báo cáo**; duyệt → PDF/portal khách. | Manual + AI | **Rất cao** — thay thế quy trình thủ công cuối tháng | Thấp (module tách, feature-flag) |
| **2. UTM attribution** | Gắn UTM vào link booking; lưu vào Appointment; báo cáo theo chiến dịch/nội dung. | Auto | Cao — biết nội dung nào hiệu quả | Thấp–TB (thêm field, không đổi luồng) |
| **3. Tự động API nền tảng (từng cái)** | Kết nối lần lượt: **Google Business Profile (Maps)** → **Meta (FB/IG)** → **Google Ads** → **TikTok** → **Google Analytics**. Mỗi tiệm tự nhập key (khuôn payments-hub). Thay dần nhập tay. | Auto (API) | Cao dần | TB–cao mỗi tích hợp (OAuth, xét duyệt app) |
| **4. AI tối ưu chủ động** | AI không chỉ tóm tắt mà **đề xuất chuyển ngân sách, cảnh báo kênh kém, dựng kế hoạch tháng sau** từ xu hướng nhiều tháng. | Auto (AI) | Cao | TB |

**Vì sao thứ tự này:** GĐ0 gần như miễn phí (tái dùng), chứng minh giá trị ngay. GĐ1 giải
đúng "nỗi đau" lớn nhất anh nêu — cuối tháng khỏi làm báo cáo tay — mà không cần bất kỳ API
bên ngoài nào (rủi ro thấp nhất trên mỗi đồng giá trị). GĐ3 (API) là phần khó & lâu nhất
(mỗi nền tảng là một dự án xin duyệt app riêng) nên để sau, làm dần từng kênh.

---

## 7. Đề xuất cấu trúc dữ liệu (bổ sung, additive — không sửa bảng cũ)

- `MarketingChannel` — mỗi tiệm × kênh (facebook, instagram, tiktok, google_ads, gbp, seo,
  email, sms, website): trạng thái kết nối, key mã hoá (khi tới GĐ3).
- `MarketingSpend` — tiệm × kênh × tháng × số tiền × **nguồn** (manual|api).
- `MarketingMetric` — tiệm × kênh × tháng × tên chỉ số (reach/clicks/calls/leads…) × giá trị × nguồn.
- `MarketingWorkLog` — tiệm × tháng × đầu việc × loại (đăng bài/ads/SEO/…).
- `MarketingReport` — tiệm × tháng × trạng thái (draft|review|approved|sent) × nháp-AI × nhận-xét × kế-hoạch × người-duyệt.
- (GĐ2) thêm `utmSource/Medium/Campaign/Content` vào `Appointment` (nullable).

Mọi bảng có `tenantId`, scope theo tenant, đúng chuẩn multi-tenant hiện hành. Feature-flag
`MARKETING_MODULE_ENABLED` mặc định TẮT = zero ảnh hưởng.

---

## 8. Những điểm cần anh quyết trước khi code

1. **Bắt đầu từ GĐ0+1** (đề xuất) hay anh muốn gộp thêm gì?
2. **Nền tảng API ưu tiên** ở GĐ3: Google Maps trước, hay Facebook/IG trước? (theo tệp khách của anh)
3. **Chi phí phần mềm Lumio** có tính vào "tổng chi phí marketing" trong báo cáo khách không?
4. **Ngôn ngữ báo cáo khách**: Anh, Việt, hay song ngữ (khách tiệm ở US/CA)?
5. **AI viết nháp**: chạy ở backend (tự động cuối tháng) — em sẽ dùng hạ tầng AI sẵn có; anh
   xác nhận là được phép cho AI đọc số liệu tổng hợp (không phải dữ liệu thẻ/PII nhạy cảm).

---

## 9. TRẠNG THÁI TRIỂN KHAI (cập nhật 22/07)

Anh đã chốt: **GĐ0 + 1**, báo cáo khách **song ngữ Việt–Anh**, GĐ3 làm dần Google/Meta/TikTok + nền khác.

**✅ GĐ0 — Bảng marketing từ dữ liệu sẵn có (xong)**
- Backend `/marketing/overview` (chỉ đọc, reuse dữ liệu): kênh → booking → đến → doanh thu + tín hiệu kênh sở hữu.
- Trang **Marketing report** (`/salon/marketing/report`), song ngữ, chọn khoảng ngày.

**✅ GĐ1 — Chi phí + Công việc + Báo cáo AI duyệt tay (xong)**
- 3 bảng mới (additive): `MarketingSpend` (chi phí + reach/clicks/leads), `MarketingWorkLog`, `MarketingReport` (nội dung song ngữ dạng JSON + trạng thái).
- Backend: CRUD chi phí/công việc; `monthlyData` với **chỉ số blended** (tổng chi ÷ kết quả thật, null khi chưa có chi phí — **không bịa**); `generateReport` gọi **Anthropic** viết nháp song ngữ (prompt cấm bịa số, cấm quy gán sai kênh); get/update/**approve**.
- Trang **Monthly report** (`/salon/marketing/monthly`): nhập chi phí từng kênh + log công việc → **AI viết nháp** → nhân viên sửa/duyệt → **xem bản khách + in PDF song ngữ** (nút Client view / Print).
- Feature-flag: read-only, tách biệt, **không đụng booking**.

**Cần khi deploy:** `deploy.bat` chạy migration + `prisma generate`. AI dùng `ANTHROPIC_API_KEY` (đã có sẵn cho AI Hotline/Messenger); nếu chưa set, báo cáo vẫn tạo khung để nhập tay.

**Kiểm thử:** 12/12 method backend scope tenant; blended null khi thiếu chi phí; prompt AI có 3 lớp chống bịa; toàn bộ file transpile + type-check frontend sạch.

**✅ Tự động sinh báo cáo cuối tháng (xong)**
- `MarketingScheduler` (khuôn campaigns.scheduler): đầu tháng tự tạo **nháp** báo cáo tháng trước cho mọi tiệm **có hoạt động thật**, để trạng thái `review` — người luôn duyệt trước khi tới khách.
- **Idempotent** (bỏ qua tiệm đã có báo cáo), tenant-safe (system chạy như super admin gắn đúng 1 tiệm), feature-flag `MARKETING_AUTOREPORT_ENABLED`. Endpoint `POST /marketing/auto-generate` chạy tay để test.

**✅ GĐ2 — UTM attribution (xong)**
- 4 cột UTM (`utmSource/Medium/Campaign/Content`) trên `Appointment` (additive migration); `CreateBookingDto` nhận UTM; `createForTenant` lưu.
- Trang đặt lịch `/book/[slug]` đọc UTM từ URL và gửi kèm. Plugin **v1.7.0** forward UTM của trang cha vào iframe (đóng gói + manifest auto-update xong).
- `marketing.overview` gộp **theo chiến dịch** (chỉ booking có UTM): campaign → đặt → đến → doanh thu. Trang **Marketing report** có mục "Theo chiến dịch / nội dung (UTM)".
- Kiểm: frontend type-check sạch; JS plugin hợp lệ; backend chỉ còn false-positive Prisma client sandbox cũ (Render tự generate).

**✅ GĐ3 — Khung kết nối API social (xong phần dựng được)**
- Bảng `MarketingChannelConnection` (BYO credential mã hoá AES-256-GCM, reuse crypto payments-hub) + migration.
- Khung connector `SocialConnector` + registry (từ chối connector chưa bật).
- **Meta (FB/IG)** connector THẬT — Insights: spend/impressions/reach/clicks.
- **Google Maps (GBP)** connector THẬT — Performance: impressions/calls/directions/website clicks (có hỗ trợ refresh token Google).
- **TikTok + Google Ads**: scaffold enabled=false (cần duyệt app + token thật, hoàn thiện khi anh có).
- Endpoints connect/test/sync/disconnect; **cron cuối tháng tự đồng bộ chi phí từ API** rồi mới AI viết nháp → tự động hoá trọn vẹn.
- UI **"Kênh kết nối"** trên trang Monthly report: dán token + ID → Test → Đồng bộ; chi phí tự đổ về bảng (đánh dấu 'api').
- Hướng dẫn **chuẩn bị tài khoản** từng nền: `Lumio-Marketing-GD3-ChuanBi-TaiKhoan.md`.
- Trung thực: lỗi token/quyền hiện rõ trên kết nối, không bịa số.

**Cần anh:** tạo app developer + lấy token/ID theo hướng dẫn GĐ3 (Meta nhanh nhất). Khi có token TikTok/Google Ads, gửi em finalize 2 connector còn lại.

**✅ GĐ4 — AI tối ưu chủ động (xong)**
- AI nhận **4 tháng gần nhất** (chi phí/doanh thu/booking/khách mới) + chi phí từng kênh → nhìn xu hướng, **đề xuất chuyển ngân sách cụ thể** (kênh nào rẻ khách/hiệu quả → tăng, kênh yếu → giảm), chỉ dựa số thật.
- Báo cáo khách thêm **"★ Điều quan trọng nhất tháng này"** (một câu chốt khách liếc là hiểu) + mũi tên ▲▼ so tháng trước + badge mức hiệu quả.

**✅ Tối ưu giao diện**: gộp 2 mục marketing report → 1 "Marketing report" (có tab Báo cáo tháng ↔ Tổng quan trực tiếp); đổi tên "Reports"→"Business report" cho phân biệt rõ.

*Module marketing đã hoàn thiện trọn vẹn GĐ0→GĐ4. Còn lại chỉ là finalize connector TikTok/Google Ads khi anh có token thật, và tinh chỉnh theo phản hồi thực tế.*

---

*Chờ anh xác nhận scope + trả lời mục 8, em mới bắt đầu triển khai GĐ0.*
