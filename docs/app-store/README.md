# Đưa Lumio Booking lên App Store & Google Play

Thư mục này là toàn bộ hồ sơ để nộp app **quản lý cho tiệm** (chủ tiệm + nhân viên).
Khách của tiệm vẫn đặt lịch qua web/WordPress như cũ — không có app cho khách trong đợt này.

| File | Dùng để làm gì |
|---|---|
| `submission-guide.md` | Các bước theo thứ tự: đăng ký tài khoản → Firebase → build iOS/Android → TestFlight/Internal testing → nộp duyệt. **Đọc file này trước.** |
| `listing.md` | Toàn bộ chữ để dán vào App Store Connect và Play Console (EN + VI): tên, phụ đề, từ khoá, mô tả, ghi chú cho người duyệt. |
| `privacy-answers.md` | Câu trả lời cho bảng **App Privacy** (Apple) và **Data safety** (Google) + bảng câu hỏi phân loại nội dung. |
| `screenshots.md` | Kích thước ảnh bắt buộc, 6 màn hình cần chụp, cách chụp bằng Chrome DevTools. |
| `assets/` | Icon 1024 và feature graphic 1024×500 (bản gốc nằm ở `store-app/resources/`). |
| `../../store-app/` | Dự án Capacitor (vỏ native). `README.md` trong đó là lệnh build. |

## Những gì đã làm sẵn trong code (không cần làm lại)

- **Vỏ app** `store-app` (Capacitor 7): tải `lumiobooking.com/salon`, link ngoài (Facebook/Google/TikTok OAuth, Stripe) tự mở trình duyệt hệ thống, trang offline, splash, status bar, nút Back Android.
- **Thông báo đẩy native** qua Firebase (APNs + FCM): web đăng ký token khi đăng nhập (`components/NativeBridge.tsx`), API lưu và gửi song song với web-push (`push/fcm.ts`). Chỉ cần điền biến `FCM_SERVICE_ACCOUNT_JSON` trên Render.
- **Xoá tài khoản trong app** (Apple 5.1.1(v), Google bắt buộc): Tài khoản của tôi → Xoá tài khoản; trang công khai `/account-deletion`.
- **Không bán gói trong app** (Apple 3.1.1): trang Gói dịch vụ trong app chỉ hiện gói hiện tại, không có nút mua.
- Trang pháp lý đã có: `/privacy`, `/terms`, `/support`, `/data-deletion`, `/account-deletion`.

## Việc anh phải tự làm (không code)

1. Đăng ký **D-U-N-S** cho Lumio Agency LLC (miễn phí, ~5 ngày) → cần cho cả Apple lẫn Google tài khoản tổ chức.
2. Đăng ký **Apple Developer Program** ($99/năm) và **Google Play Console** ($25 một lần).
3. Tạo **Firebase project** (miễn phí) để có push.
4. Trên Mac: cài Xcode mới nhất + Android Studio, chạy các lệnh trong `store-app/README.md`.
5. Chụp 6 ảnh màn hình theo `screenshots.md`.
6. Dán chữ từ `listing.md`, trả lời form theo `privacy-answers.md`, nộp.

Thời gian thực tế: 1–2 tuần chờ tài khoản, 1 ngày build + nộp, Apple duyệt 1–3 ngày, Google 1–7 ngày (lần đầu có thể lâu hơn).
