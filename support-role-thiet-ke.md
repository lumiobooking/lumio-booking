# Thiết kế: Tài khoản SUPPORT — nhân viên Lumio setup giùm tiệm

Mục tiêu: nhân viên của Lumio Agency có MỘT tài khoản vào được mọi tiệm để setup
(kể cả phần chuyên sâu đang ẩn với chủ tiệm), nhưng KHÔNG phải Super Admin và
KHÔNG phá tenant isolation.

## Nguyên tắc cốt lõi

Không tạo "tài khoản admin toàn cục". Thay vào đó: tài khoản SUPPORT tự nó không
đọc được dữ liệu tiệm nào; muốn làm việc phải **bước vào đúng một tiệm** và nhận
**token phiên ngắn hạn** scoped tiệm đó. Bên trong phiên, mọi API chạy y hệt một
Salon Admin thật — toàn bộ cơ chế tenant isolation hiện có giữ nguyên, không mở
thêm bất kỳ đường xuyên tiệm nào.

## 1. Dữ liệu & vai trò

- `UserRole` thêm giá trị **SUPPORT** (migration enum). User role SUPPORT có
  `tenantId = null` (giống SUPER_ADMIN).
- Chỉ SUPER_ADMIN tạo/khóa được tài khoản SUPPORT (trang quản lý user hiện có
  của admin portal, thêm lựa chọn role).

## 2. Bước vào tiệm (phiên support)

- Endpoint mới: `POST /auth/support/enter-salon` body `{ tenantId }`.
  - Cho phép: SUPPORT và SUPER_ADMIN (tiện cho chính bạn).
  - Kiểm tra tenant tồn tại và không bị SUSPENDED.
  - Trả về JWT **8 giờ** với payload:
    - `role: SALON_ADMIN` → mọi guard `@Roles(SALON_ADMIN)` hiện có tự hoạt động,
      không sửa từng endpoint.
    - `tenantId: <tiệm đã chọn>` → resolveTenantScope giữ nguyên, cross-tenant
      vẫn bị chặn như cũ.
    - `userId: <id nhân viên>` → audit_logs ghi đích danh nhân viên (không phải
      tài khoản chủ tiệm).
    - `supportSession: true` → cờ nhận diện phiên support.
- Audit: ghi `support.entered_salon` (tenantId, userId) ngay khi cấp token.
- Hết 8h token tự chết; muốn làm tiếp thì bước vào lại (một click).

## 3. Vượt feature-policy khi setup

- FeaturePolicyGuard hiện cho "Admin always passes". Mở rộng: phiên có
  `supportSession: true` cũng pass → nhân viên setup được các mục đang ở chế độ
  `platform` (ẩn với chủ tiệm).
- Web SalonShell: khi token có `supportSession`, hiện đủ menu kể cả mục bị khóa,
  kèm banner mỏng "Đang setup với quyền Lumio Support — tiệm: {tên}" để nhân
  viên không nhầm mình đang ở tiệm nào.

## 4. Trang làm việc của nhân viên

- Route mới `/support` (web):
  - Đăng nhập bằng tài khoản SUPPORT → đưa thẳng về đây (không vào /salon,
    không vào /admin).
  - Danh sách tiệm: CHỈ tên + slug + trạng thái (không số liệu doanh thu).
    Endpoint riêng `GET /support/tenants` trả đúng chừng đó trường.
  - Nút "Vào setup" → gọi enter-salon → lưu token phiên → mở /salon như một
    Salon Admin bình thường.
  - Nút "Rời tiệm" trên banner → xóa token phiên, quay về /support.

## 5. Giới hạn cứng của SUPPORT (khác Super Admin)

KHÔNG gọi được (guard chặn theo role):
- Tạo / sửa / suspend / xóa tenant; đổi plan, billing, license.
- Bật/tắt feature-policy cho tiệm.
- `POST /maintenance/retention/run`, các API platform khác.
- Xem danh sách tenant đầy đủ số liệu (chỉ endpoint rút gọn ở mục 4).

## 6. Kiểm thử bắt buộc (theo rule dự án)

1. Token phiên tiệm A gọi API với dữ liệu tiệm B → 403/404 (isolation giữ nguyên).
2. Tài khoản SUPPORT gọi thẳng API platform (tenants CRUD, feature-policy,
   retention) → 403.
3. Tài khoản SUPPORT gọi API salon KHÔNG qua enter-salon (token gốc, không
   tenantId) → bị chặn "not associated with a tenant".
4. Audit: hành động trong phiên support ghi userId nhân viên + tenantId tiệm.
5. Khóa tài khoản SUPPORT → enter-salon và refresh đều fail ngay.

## 7. Việc KHÔNG nằm trong phạm vi (làm sau nếu cần)

- Cho chủ tiệm xem lịch sử "Lumio đã vào tài khoản của bạn" (minh bạch — nên có
  ở bản public lớn).
- Giới hạn SUPPORT theo danh sách tiệm được giao (per-employee assignment).
- 2FA cho tài khoản SUPPORT.

## Khối lượng dự kiến

- API: migration enum + enter-salon + GET /support/tenants + sửa FeaturePolicyGuard
  + audit (~1 buổi).
- Web: trang /support + banner phiên + route theo role (~1 buổi).
- Test isolation: node simulation + hand-audit (~nửa buổi).
