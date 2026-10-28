# Build app iOS trên mây — không cần máy Mac

App iOS được build trên **máy Mac của GitHub** (GitHub Actions) rồi tự gửi lên **TestFlight**. Anh chỉ làm trên
trình duyệt (Windows được) + chạy 1 script nhỏ để tạo chứng chỉ. Mỗi lần muốn ra bản mới: bấm **Run workflow**.

File liên quan: `.github/workflows/ios-testflight.yml` (quy trình build — bản gốc `store-app/ci/ios-testflight.yml`, xem Bước 0a), `store-app/scripts/ios-prepare.mjs`
(đặt tên app, iPad xoay, push, quyền camera/ảnh, ký app), `store-app/scripts/ios-cert.sh` (tạo chứng chỉ không cần Mac).

> 🔑 Mọi khoá/mật khẩu do anh tự tạo và tự dán vào GitHub Secrets. Không dán vào chat, không commit vào git
> (`.gitignore` đã chặn `store-app/.signing/`, `*.p8`, `*.p12`, `*.mobileprovision`).

---

## Bước 0a — Đưa quy trình build lên GitHub (làm 1 lần, 2 phút)

File quy trình nằm sẵn ở `store-app/ci/ios-testflight.yml`. GitHub chỉ chạy file trong thư mục `.github/workflows/`,
và thư mục đó anh tự tạo (vì lý do an toàn, Claude không được ghi vào `.github/`):

- **Cách 1 (trên máy):** copy `store-app/ci/ios-testflight.yml` sang `.github/workflows/ios-testflight.yml` (tạo 2
  thư mục `.github` và `workflows` nếu chưa có) → commit → push.
- **Cách 2 (trên web):** github.com/lumiobooking/lumio-booking → **Add file → Create new file** → gõ tên
  `.github/workflows/ios-testflight.yml` → dán nguyên nội dung file `store-app/ci/ios-testflight.yml` → Commit.

Sau đó tab **Actions** sẽ có quy trình **iOS → TestFlight**. Sửa quy trình về sau thì sửa cả 2 nơi (hoặc chỉ bản
trong `.github/workflows/`, bản trong `store-app/ci/` chỉ là bản gốc để copy).

## Bước 0 — Tài khoản (làm 1 lần)

1. **D-U-N-S** + **Apple Developer Program** loại *Organization* cho Lumio Agency LLC (xem `submission-guide.md` Bước 0).
   Chờ Apple duyệt xong (email "Welcome to the Apple Developer Program").
2. Đăng nhập **developer.apple.com** và **appstoreconnect.apple.com** → đồng ý mọi điều khoản đang chờ
   (*Agreements*). Còn điều khoản chưa đồng ý là build upload bị từ chối.

## Bước 1 — App ID (5 phút)

developer.apple.com → **Certificates, IDs & Profiles** → **Identifiers** → **+** → *App IDs* → *App* →
- Description: `Lumio Booking`
- Bundle ID: **Explicit** `com.lumioagency.booking`
- Capabilities: tick **Push Notifications** → Continue → Register.

## Bước 2 — Chứng chỉ phát hành (10 phút, không cần Mac)

Trên máy Windows: mở **Git Bash** trong thư mục `Booking/store-app` (hoặc nhờ Claude chạy giúp):

```bash
bash scripts/ios-cert.sh csr "Lumio Agency LLC" email-cong-ty@lumioagency.com
```

→ tạo `store-app/.signing/dist.csr`. Sau đó developer.apple.com → **Certificates** → **+** → **Apple Distribution**
→ Continue → chọn file `dist.csr` → Continue → **Download** (`distribution.cer`). Rồi:

```bash
bash scripts/ios-cert.sh p12 ~/Downloads/distribution.cer
```

→ ra 2 file chữ trong `store-app/.signing/`: `IOS_DIST_CERT_P12_BASE64.txt` và `IOS_DIST_CERT_PASSWORD.txt`.
**Giữ thư mục `.signing/` cẩn thận** (sao lưu vào nơi an toàn) — mất file `dist.key` là phải làm chứng chỉ mới.
Chứng chỉ hết hạn sau 1 năm → làm lại bước này.

## Bước 3 — Provisioning profile (5 phút)

developer.apple.com → **Profiles** → **+** → *Distribution* → **App Store Connect** → App ID `com.lumioagency.booking`
→ chọn chứng chỉ vừa tạo → Profile Name: `Lumio Booking App Store` → **Download**. Rồi:

```bash
bash scripts/ios-cert.sh b64 ~/Downloads/Lumio_Booking_App_Store.mobileprovision
```

→ `store-app/.signing/Lumio_Booking_App_Store.mobileprovision.base64.txt`.

> Bật/tắt capability của App ID (ví dụ Push) **sau** khi tạo profile thì phải *Edit → Save* profile, tải lại và cập
> nhật secret — workflow sẽ báo lỗi rõ nếu profile thiếu Push.

## Bước 4 — Tạo app trên App Store Connect (5 phút)

appstoreconnect.apple.com → **Apps** → **+** → *New App* → iOS, Name `Lumio Booking`, ngôn ngữ chính English (U.S.),
Bundle ID `com.lumioagency.booking`, SKU `lumio-booking-ios`, User Access: Full Access → Create.
Mở app vừa tạo, URL có dạng `.../apps/6XXXXXXXXX/...` → số đó là **Apple ID của app** (dùng ở Bước 6).

## Bước 5 — Khoá App Store Connect API (cho việc upload, 5 phút)

App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+** →
Name `GitHub upload`, Access **App Manager** → Generate → **Download API Key** (file `AuthKey_XXXX.p8`, *chỉ tải được
1 lần*). Ghi lại **Key ID** và **Issuer ID** (hiện ở đầu trang). Rồi:

```bash
bash scripts/ios-cert.sh b64 ~/Downloads/AuthKey_XXXX.p8
```

## Bước 6 — Dán vào GitHub (10 phút)

github.com/lumiobooking/lumio-booking → **Settings** → **Secrets and variables** → **Actions**:

**Secrets** (tab *Secrets* → *New repository secret*), dán **nguyên nội dung** từng file `.txt`:

| Tên secret | Lấy từ |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | `.signing/IOS_DIST_CERT_P12_BASE64.txt` |
| `IOS_DIST_CERT_PASSWORD` | `.signing/IOS_DIST_CERT_PASSWORD.txt` |
| `IOS_PROFILE_BASE64` | `.signing/Lumio_Booking_App_Store.mobileprovision.base64.txt` |
| `ASC_KEY_ID` | Key ID ở Bước 5 (ví dụ `AB12CD34EF`) |
| `ASC_ISSUER_ID` | Issuer ID ở Bước 5 (dạng `xxxxxxxx-xxxx-...`) |
| `ASC_KEY_P8_BASE64` | `.signing/AuthKey_XXXX.p8.base64.txt` |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | *(tuỳ chọn — để có thông báo đẩy, xem Bước 8)* |

**Variables** (tab *Variables* → *New repository variable*): `ASC_APP_ID` = số Apple ID của app ở Bước 4
(giúp tránh lỗi upload "Cannot determine the Apple ID from Bundle ID" của Xcode 26.2+).

## Bước 7 — Build và gửi lên TestFlight

GitHub → **Actions** → **iOS → TestFlight** → **Run workflow** → Version `1.0.0` → Run.

- Mất khoảng 25–40 phút. Xanh = đã gửi lên Apple. Đỏ = mở bước bị đỏ, chụp màn hình gửi Claude.
- 10–30 phút sau build hiện ở App Store Connect → app → **TestFlight**. Lần đầu trả lời câu hỏi
  *Export Compliance* (app đã khai `ITSAppUsesNonExemptEncryption = NO` nên thường tự qua).
- TestFlight → **Internal Testing** → thêm email (anh + 2–3 người) → cài app **TestFlight** trên iPhone/iPad → cài
  Lumio Booking. Kiểm tra: đăng nhập, lịch, iPad **xoay ngang**, màn check-in, màn hình khách, mất mạng.
- Mỗi lần chạy lại, số build tự tăng (số lần chạy workflow). Đổi version (1.0.1…) khi nộp bản mới lên store.
- Chi phí: máy Mac của GitHub tính phút riêng (đắt hơn máy Linux). Repo riêng tư có hạn mức miễn phí nhỏ mỗi tháng;
  vượt thì GitHub tính tiền theo phút — xem *Settings → Billing* của tổ chức `lumiobooking`.

## Bước 8 — Thông báo đẩy (nên làm trước khi nộp duyệt)

Apple hay từ chối app "chỉ là website" (4.2). Thông báo đẩy là bằng chứng mạnh nhất.

1. Firebase → project *Lumio Booking* → Add app → **iOS**, bundle `com.lumioagency.booking` → tải
   `GoogleService-Info.plist` → `bash scripts/ios-cert.sh b64 ~/Downloads/GoogleService-Info.plist` → secret
   `GOOGLE_SERVICE_INFO_PLIST_BASE64`.
2. developer.apple.com → **Keys** → **+** → tick *Apple Push Notifications service (APNs)* → tải `.p8` → Firebase →
   Project settings → **Cloud Messaging** → iOS app → upload APNs key (Key ID + Team ID).
3. Firebase → **Service accounts** → *Generate new private key* → Render (`lumio-api`, `lumio-api-vn`) → biến
   `FCM_SERVICE_ACCOUNT_JSON` = nội dung file → redeploy.
4. Chạy lại workflow (Bước 7). Workflow tự thêm Firebase vào app khi có secret này; không có thì build vẫn chạy
   nhưng **không có push** (log có cảnh báo vàng).

## Khi nào phải làm lại

| Việc | Làm lại |
|---|---|
| Sửa web (lịch, check-in, giao diện…) | Không — app tải web trực tiếp, có ngay. |
| Đổi `store-app/` (plugin, cấu hình, icon) | Chạy workflow (Bước 7) và nộp bản mới. |
| Chứng chỉ hết hạn (1 năm) | Bước 2 → cập nhật 2 secret chứng chỉ; Bước 3 tạo lại profile → cập nhật `IOS_PROFILE_BASE64`. |
| Profile hết hạn / đổi capability | Bước 3 → cập nhật `IOS_PROFILE_BASE64`. |

Sau TestFlight: nộp duyệt theo `submission-guide.md` Bước 4 (chữ trong `listing.md`, ảnh theo `screenshots.md`,
tài khoản demo cho người duyệt).
