# Hướng dẫn nộp app — từng bước theo thứ tự

Làm đúng thứ tự vì bước sau cần kết quả bước trước. Chỗ nào có 🔑 là anh phải tự nhập khoá/mật khẩu — tôi không
bao giờ cầm những thứ đó.

---

## Bước 0 — Trước khi bắt đầu (tuần 1, chờ là chính)

1. **D-U-N-S number** cho *Lumio Agency LLC* (địa chỉ 5900 Balcones Drive STE 100, Austin, TX 78731):
   https://developer.apple.com/enroll/duns-lookup/ → tra cứu; chưa có thì yêu cầu cấp (miễn phí, 5–7 ngày làm việc).
   Tên/địa chỉ phải **khớp giấy đăng ký LLC** từng chữ.
2. **Apple Developer Program** — https://developer.apple.com/programs/enroll/ → chọn *Organization*, dùng Apple ID của
   công ty (không dùng Apple ID cá nhân đang có mua hàng), điền D-U-N-S, người ký phải là người có thẩm quyền pháp lý
   (Owner). $99/năm. Apple gọi điện xác minh, thường 2–7 ngày.
3. **Google Play Console** — https://play.google.com/console/signup → *Organization*, D-U-N-S, $25 một lần, xác minh
   danh tính (ID + giấy tờ công ty) 1–3 ngày. Tài khoản tổ chức **không** phải qua bước "20 tester 14 ngày" như tài
   khoản cá nhân.
4. **Firebase** — https://console.firebase.google.com → Add project "Lumio Booking" (tắt Analytics cũng được).
5. Trên **Mac**: cài Xcode mới nhất từ App Store (mất ~1 giờ), mở một lần để cài components; cài Android Studio
   (kèm SDK Android 15 / API 35 trở lên); cài Node 20+; `sudo gem install cocoapods` hoặc `brew install cocoapods`.

## Bước 1 — Dựng dự án native (Mac, 20 phút)

```bash
cd "Booking/store-app"
npm install
npx cap add ios
npx cap add android
npm run icons          # tạo toàn bộ icon/splash từ resources/ cho cả 2 nền tảng
npx cap sync
```

Sau lệnh này có 2 thư mục `ios/` và `android/` — **commit chúng vào git** (trừ Pods/build, đã có .gitignore).

### iOS — chỉnh trong Xcode (`npm run open:ios`)
- Target **App** → *Signing & Capabilities*: Team = Lumio Agency LLC; Bundle Identifier `com.lumioagency.booking`;
  bấm **+ Capability** → *Push Notifications*; **+ Capability** → *Background Modes* → tick *Remote notifications*.
- *General* → Supported Destinations: bỏ **iPad** (để không phải nộp ảnh iPad). Minimum Deployments: iOS 15.
- *Info* → thêm các khoá trong `privacy-answers.md` mục C (Camera, Photo Library, ITSAppUsesNonExemptEncryption).
- Display Name: `Lumio Booking`. Version 1.0.0, Build 1.

### Android — chỉnh (`npm run open:android`)
- `android/app/build.gradle`: `applicationId "com.lumioagency.booking"`, `versionCode 1`, `versionName "1.0.0"`,
  `targetSdk` = giá trị Capacitor đặt (≥ 35 — Play bắt buộc API 35 từ 31/8/2025).
- `AndroidManifest.xml`: thêm `<uses-permission android:name="android.permission.CAMERA"/>` và
  `<uses-feature android:name="android.hardware.camera" android:required="false"/>`.
- Tạo **upload keystore** 🔑 (giữ file này cả đời app, mất là không cập nhật được):
  `keytool -genkey -v -keystore lumio-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias lumio`
  → cấu hình `signingConfigs.release` trong build.gradle (đừng commit mật khẩu; dùng `~/.gradle/gradle.properties`).

## Bước 2 — Push notifications (Firebase, 30 phút)

1. Firebase → Project settings → **Your apps** → *Add app* → iOS: bundle `com.lumioagency.booking` → tải
   `GoogleService-Info.plist` → kéo vào Xcode (target App, *Copy items*). *Add app* → Android: package
   `com.lumioagency.booking` → tải `google-services.json` → đặt vào `android/app/`.
2. **APNs key** 🔑: developer.apple.com → Certificates, IDs & Profiles → *Keys* → + → tick *Apple Push Notifications
   service (APNs)* → tải file `.p8` (chỉ tải được 1 lần). Firebase → Project settings → *Cloud Messaging* → iOS app →
   *APNs Authentication Key* → upload `.p8`, nhập Key ID + Team ID.
3. iOS `AppDelegate.swift`: Capacitor push plugin cần `FirebaseMessaging` — làm theo README của
   `@capacitor/push-notifications` mục *iOS → Using Firebase* (thêm `pod 'FirebaseMessaging'` vào Podfile, `pod install`,
   và đoạn `Messaging.messaging().apnsToken = deviceToken` trong `didRegisterForRemoteNotificationsWithDeviceToken`).
4. **Service account** 🔑 cho server: Firebase → Project settings → *Service accounts* → *Generate new private key*
   → file JSON. Trên **Render** (cả `lumio-api` và `lumio-api-vn`) → Environment → thêm biến
   `FCM_SERVICE_ACCOUNT_JSON` = *toàn bộ nội dung file JSON* (dán nguyên, hoặc base64). Redeploy API.
   Kiểm tra: `GET https://api.lumiobooking.com/api/push/public-key` trả về `"native": true`.
5. Thử: chạy app trên **iPhone thật** (simulator không nhận push), đăng nhập, cho phép thông báo, rồi đặt một lịch
   thử từ trang booking của tiệm → điện thoại phải rung.

## Bước 3 — Chạy thử và TestFlight / Internal testing

```bash
npx cap sync            # mỗi lần đổi capacitor.config hoặc plugin
npm run open:ios        # Xcode → chọn iPhone thật → Run
npm run open:android    # Android Studio → Run
```

Kiểm tra trên máy thật: đăng nhập, lịch, inbox, duyệt bài, xoay màn hình, nút Back (Android), mất mạng (phải ra
trang "Không có kết nối"), mở kết nối Facebook (phải bật Safari/Chrome ngoài app), thông báo đẩy.

- **iOS**: Xcode → Product → *Archive* → *Distribute App* → App Store Connect → Upload. Trên App Store Connect →
  TestFlight → thêm tester nội bộ (tối đa 100, cài app TestFlight) — không cần duyệt.
- **Android**: Android Studio → Build → *Generate Signed Bundle* (AAB, không APK) → Play Console → Testing →
  *Internal testing* → tải AAB lên → thêm email tester → link cài.

Chạy thử 2–3 ngày với 2–3 tiệm thân thiết trước khi nộp.

## Bước 4 — Điền hồ sơ trên store (1 buổi)

**App Store Connect** (https://appstoreconnect.apple.com): My Apps → + → New App → iOS, tên, bundle ID, SKU.
- *App Information*: category, Privacy Policy URL, Content Rights ("does not contain third-party content").
- *Pricing*: Free, tất cả quốc gia (hoặc chỉ US + VN).
- *App Privacy*: theo `privacy-answers.md` A.
- *1.0 Prepare for Submission*: 6 ảnh 6.9", Promotional Text, Description, Keywords, Support URL, Marketing URL,
  Version 1.0.0, Copyright, chọn build đã upload, **App Review Information**: tick *Sign-in required*, điền tài khoản
  demo + Notes từ `listing.md` D, số điện thoại liên hệ. *Age Rating*: trả lời No hết → 4+.
- Bấm **Add for Review** → **Submit to App Review**.

**Play Console**: Create app → *Dashboard* làm theo checklist: Store listing (ảnh, feature graphic, mô tả), App content
(privacy policy, ads = No, app access = demo account, content rating, target audience, data safety, government/news/
financial = No, account deletion URL), rồi *Production* → Create release → tải AAB (Google ký hộ — *Play App Signing*
bật mặc định) → chọn quốc gia → *Review release* → *Start rollout to Production*.

## Bước 5 — Những lý do bị từ chối hay gặp, và cách tránh (đã lo sẵn trong code)

| Guideline | Rủi ro | Đã làm |
|---|---|---|
| Apple **4.2 Minimum functionality** ("chỉ là website đóng gói") | Cao nhất với app dạng WebView | Có push native, offline page, status bar, không hiện thanh địa chỉ; trong Notes nhấn mạnh đây là app cho nhân viên tiệm với thông báo đẩy. Nếu vẫn bị từ chối: trả lời (Reply) giải thích + video quay push notification; 80 % qua ở lần trả lời. |
| Apple **3.1.1 In-App Purchase** | Bán gói trong app → bắt buộc dùng IAP | Trang Gói dịch vụ trong app **không có nút mua**, chỉ nói "quản lý trên web". **Không** ghi giá gói, không link "Mua tại lumiobooking.com" trong app (link mua ngoài vẫn bị soi ngoài Mỹ). |
| Apple **5.1.1(v) Account deletion** | Bắt buộc từ 2022 | Có trong Tài khoản của tôi + trang `/account-deletion`. |
| Apple **4.8 Sign in with Apple** | Chỉ khi có đăng nhập Google/Facebook | App chỉ có email + mật khẩu → không áp dụng. Đừng thêm "Đăng nhập bằng Google" vào app sau này mà không thêm Sign in with Apple. |
| Apple **2.1 Demo account** | Không đăng nhập được → từ chối ngay | Tiệm demo riêng, mật khẩu không đổi, kiểm tra trước khi nộp. |
| Apple **5.1.2 / 2.5.2** WebView chạy code ngoài | Không sao khi tải trang HTTPS của chính mình | OK. |
| Google **Deceptive behavior / Minimum functionality** | Tương tự 4.2 | Như trên. |
| Google **Data safety không khớp** | Google quét SDK | Không SDK nào ngoài Capacitor + Firebase Messaging → khai đúng bảng. |
| Google **Target API level** | Build cũ bị chặn | Capacitor 7 đặt targetSdk 35. Từ 8/2026 Google đòi 36 → cập nhật Capacitor khi đó. |

## Bước 6 — Sau khi lên store

- Thêm nút "Tải app trên App Store / Google Play" ở landing page và email chào mừng (tôi làm khi có link thật).
- Mỗi lần đổi **vỏ** (plugin, config) mới cần build lại và nộp bản mới; đổi **web** thì app tự có ngay, không cần nộp.
- Khi bị Apple hỏi, trả lời trong Resolution Center trong 24 giờ; đừng nộp lại build mới nếu chỉ cần giải thích.
