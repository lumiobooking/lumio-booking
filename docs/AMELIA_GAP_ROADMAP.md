# Lumio Booking — Gap Analysis & Roadmap (so với Amelia)

> Mục tiêu: nâng Lumio Booking lên ngang tầm một hệ thống booking chuyên nghiệp như Amelia,
> nhưng giữ kiến trúc **multi-tenant SaaS** (mỗi salon = 1 tenant, dữ liệu cô lập hoàn toàn).
> Tất cả code/tên bảng/route bằng tiếng Anh; phần giải thích bằng tiếng Việt.

---

## 1. Bản đồ trang Amelia → Lumio (đang có gì, thiếu gì)

| Trang Amelia | Lumio hiện tại | Trạng thái | Ghi chú |
|---|---|---|---|
| **Dashboard** (KPI) | `overview` (API) | ⚠️ Một phần | Cần trang Dashboard salon: doanh thu, occupancy, top thợ/dịch vụ, booking sắp tới |
| **Calendar** | `salon/calendar` | ✅ Có | Có month grid + booking detail. Có thể thêm day/week view |
| **Bookings** | `salon/bookings` | ✅ Có | Amelia chia tab Appointments / Packages / Events → ta mới có Appointments |
| **Events** (lớp/sự kiện nhóm) | — | ❌ Thiếu | Booking nhiều người, có capacity (lớp nail art, workshop) |
| **Employees** | `salon/staff` | ✅ Có | Đã có avatar, login account, working hours |
| **Catalog → Services** | `salon/services` | ✅ Có | Đã có add-ons |
| **Catalog → Packages** | — | ❌ Thiếu | Gói nhiều dịch vụ + giảm giá + hạn dùng |
| **Catalog → Resources** | — | ❌ Thiếu | Tài nguyên dùng chung giới hạn (ghế, phòng, máy) |
| **Locations** | — | ❌ Thiếu | Multi-location (đã nằm trong feature limit của plan) |
| **Customers** | `salon/customers` | ✅ Có | Có thể thêm lịch sử booking, ghi chú, no-show |
| **Finance → Transactions** | `salon/payments` | ✅ Có | |
| **Finance → Invoices** | — | ❌ Thiếu | Hóa đơn PDF cho khách |
| **Finance → Taxes** | — | ❌ Thiếu | Thuế theo dịch vụ/khu vực |
| **Notifications** (Email/SMS) | `salon/notifications` | ✅ Có | Đã có template + SMTP + Twilio |
| **Customize** (giao diện form) | — | ❌ Thiếu | Tùy biến màu/nhãn/bố cục form booking |
| **Custom Fields** | — | ❌ Thiếu | Trường thu thập thêm khi khách đặt (intake form) |
| **Features & Integrations** | `salon/integrations` | ⚠️ Một phần | Thiếu Coupons, Deposit, Google/Outlook Calendar, Zoom |
| **Settings** | `salon/settings` | ✅ Có | Đã streamlined |
| **(SaaS) Super Admin** | `super-admin/tenants` | ✅ Có | Riêng của Lumio, Amelia không có |

---

## 2. Những module nên BỔ SUNG (ưu tiên cho nail salon)

### Nhóm A — Doanh thu & vận hành (tác động cao, nên làm trước)
1. **Dashboard salon (KPI)** — doanh thu kỳ, số booking, occupancy %, top thợ, top dịch vụ, booking sắp tới, no-show rate. *(tenant-scoped)*
2. **Coupons / Mã giảm giá** — bảng `coupons (tenant_id, code, type fixed|percent, value, usage_limit, used, valid_from/to, service_scope)`. Áp ở bước Payment của form booking.
3. **Deposit / Đặt cọc** — cho phép khách trả trước một phần (%, hoặc số tiền) để giữ lịch. Mở rộng `payments` + `booking_rules.depositMode`.
4. **Invoices + Taxes** — sinh hóa đơn PDF, cấu hình thuế (tax rate theo dịch vụ/khu vực). Bảng `invoices`, `tax_rates` (đều có `tenant_id`).

### Nhóm B — Mở rộng sản phẩm dịch vụ
5. **Packages / Gói dịch vụ** — `packages (tenant_id, name, price, discount, validity_days)` + `package_services` + `customer_packages` (theo dõi lượt còn lại). Hiện ở Bookings tab Packages.
6. **Service categories** — nhóm dịch vụ (MANICURE / PEDICURE / NAIL ART…) như cột trái Catalog của Amelia. (Nếu chưa có cột category trong `services` thì thêm.)
7. **Capacity / Group booking** — `service.minCapacity/maxCapacity` để 1 slot nhận nhiều khách (vd lớp học), khác mặc định 1-1.
8. **Resources / Tài nguyên** — `resources (tenant_id, name, quantity)` + ràng buộc dịch vụ dùng resource → chống đặt vượt số ghế/phòng/máy.

### Nhóm C — Trải nghiệm khách & thu thập dữ liệu
9. **Custom Fields (intake form)** — `custom_fields (tenant_id, label, type, required, options, service_scope)` + lưu giá trị vào `appointment.customFields (Json)`. Vd: "Bạn muốn mẫu nail nào?", upload ảnh tham khảo.
10. **Customize booking form** — chọn layout (Step-by-step / Catalog / Calendar), đổi nhãn các bước, ẩn/hiện trường, màu theo branding. Lưu vào `settings.booking_form`.
11. **Reviews / Đánh giá** — sau khi xong, gửi link đánh giá thợ + dịch vụ. `reviews (tenant_id, appointment_id, rating, comment)`.
12. **Waiting list** — khi slot đầy, khách đăng ký chờ; có chỗ trống thì thông báo.

### Nhóm D — Tích hợp & lịch
13. **Google Calendar / Outlook 2 chiều** — đồng bộ lịch thợ, tránh double-booking ngoài hệ thống.
14. **Zoom / Google Meet** — cho dịch vụ tư vấn online (nếu có).
15. **Recurring appointments** — khách đặt lịch định kỳ (vd mỗi 2 tuần).
16. **Buffer time** — thời gian dọn dẹp trước/sau mỗi booking cho mỗi dịch vụ.

### Nhóm E — Nền tảng SaaS (Lumio-only, không có trong Amelia)
17. **Plan limits enforcement** — chặn vượt giới hạn theo `subscription.plan` (số thợ, booking/tháng, SMS, online payment, multi-location).
18. **Billing portal cho Salon Admin** — xem plan, hạn mức đã dùng, nâng cấp.
19. **Usage metering** — đếm booking/tháng, SMS đã gửi, để hiển thị và áp limit.
20. **White-label nâng cao** — logo/domain riêng từng salon.

---

## 3. Nguyên tắc multi-tenant áp cho MỌI module mới
- Mọi bảng mới đều có `tenant_id` (trừ bảng platform-level như `plans`).
- Mọi API mới: lấy `tenantId` từ JWT, scope mọi query, thêm `assertTenantAccess`.
- Mọi feature có giới hạn theo plan → kiểm tra limit trước khi tạo.
- Thêm test cross-tenant isolation cho từng endpoint mới.
- Secrets (gateway, SMS, SMTP) luôn ở server, không trả về frontend.

---

## 4. Build order đề xuất (theo tác động / công sức)
1. **Dashboard salon (KPI)** — nhanh, gây ấn tượng, tận dụng `overview` sẵn có.
2. **Coupons** — bán hàng, vừa sức.
3. **Custom Fields** — đặc thù nail (chọn mẫu, ghi chú móng), tăng giá trị rõ rệt.
4. **Packages** — tăng doanh thu/giữ khách.
5. **Invoices + Taxes** — chuyên nghiệp hoá tài chính.
6. **Deposit** — giảm no-show.
7. **Customize booking form** — đẹp & nhận diện thương hiệu.
8. **Resources / Capacity / Events** — khi cần mô hình lớp/nhóm.
9. **Integrations (Google Calendar…)** — khi cần đồng bộ ngoài.
10. **SaaS plan limits + billing** — khi chuẩn bị bán cho nhiều salon.
