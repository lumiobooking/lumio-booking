# App Privacy (Apple) & Data safety (Google) — câu trả lời

Nguyên tắc chung: app dành cho **nhân viên tiệm** (người dùng đăng nhập). Dữ liệu app thu là dữ liệu vận hành tiệm,
gắn với tài khoản, dùng cho chức năng app. **Không** có quảng cáo, **không** bán dữ liệu, **không** tracking
xuyên app, **không** SDK phân tích bên thứ ba trong app (không Google Analytics/Facebook SDK trong vỏ native).

Dữ liệu khách của tiệm (tên, SĐT khách đặt lịch) là dữ liệu nhân viên **xem** trong app; Apple/Google vẫn tính là
"collected" vì app gửi lên server của mình → khai như dưới.

---

## A. Apple — App Privacy ("Data Types")

Chọn **"Yes, we collect data from this app"**, rồi khai từng loại:

| Data type | Collected? | Linked to user | Used for tracking | Purposes |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes | Yes | No | App Functionality |
| Contact Info → Physical Address (địa chỉ tiệm) | Yes | Yes | No | App Functionality |
| User Content → Photos or Videos (ảnh mẫu, ảnh khách, ảnh bài đăng) | Yes | Yes | No | App Functionality |
| User Content → Customer Support (tin nhắn chat với Lumio) | Yes | Yes | No | App Functionality |
| User Content → Other User Content (ghi chú khách, lịch hẹn, tin nhắn inbox) | Yes | Yes | No | App Functionality |
| Identifiers → User ID | Yes | Yes | No | App Functionality |
| Identifiers → Device ID (token push) | Yes | Yes | No | App Functionality |
| Purchases → Purchase History (hoá đơn POS của tiệm) | Yes | Yes | No | App Functionality |
| Usage Data → Product Interaction (audit log hành động) | Yes | Yes | No | App Functionality, Analytics (nội bộ) |
| Diagnostics → Crash Data | No | — | — | — (không có SDK crash) |
| Location | No | — | — | — |
| Financial Info → Payment Info | No | — | — | — (thẻ nhập trên Stripe/Square, app không thấy số thẻ) |
| Health & Fitness, Contacts (danh bạ máy), Browsing/Search History, Sensitive Info | No | | | |

Trả lời "Do you or your third-party partners use data for tracking?" → **No**.

**Privacy manifest** (Xcode ≥ 15, `PrivacyInfo.xcprivacy`): Capacitor 7 đã kèm manifest cho chính nó và các plugin;
app không dùng "required reason APIs" ngoài những gì Capacitor khai. Nếu Xcode báo thiếu, thêm file với
`NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []`, `NSPrivacyCollectedDataTypes` = bảng trên.

**Export compliance** (mỗi lần upload build): app chỉ dùng HTTPS chuẩn → chọn "None of the algorithms mentioned
above" / uses exempt encryption. Thêm vào Info.plist: `ITSAppUsesNonExemptEncryption = NO` để không bị hỏi lại.

---

## B. Google Play — Data safety

**Does your app collect or share any of the required user data types?** → Yes
**Is all of the user data collected by your app encrypted in transit?** → Yes
**Do you provide a way for users to request that their data is deleted?** → Yes → URL `https://lumiobooking.com/account-deletion`

| Data type | Collected | Shared | Processed ephemerally | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Personal info → Name | ✔ | ✘ | ✘ | Required | App functionality, Account management |
| Personal info → Email address | ✔ | ✘ | ✘ | Required | App functionality, Account management |
| Personal info → Phone number | ✔ | ✘ | ✘ | Optional | App functionality |
| Personal info → Address | ✔ | ✘ | ✘ | Optional | App functionality |
| Personal info → User IDs | ✔ | ✘ | ✘ | Required | App functionality, Account management |
| Financial info → Purchase history (đơn POS) | ✔ | ✘ | ✘ | Optional | App functionality |
| Photos and videos → Photos | ✔ | ✘ | ✘ | Optional | App functionality |
| Messages → Other in-app messages | ✔ | ✘ | ✘ | Optional | App functionality |
| App activity → App interactions | ✔ | ✘ | ✘ | Required | Analytics (nội bộ), App functionality |
| Device or other IDs (push token) | ✔ | ✘ | ✘ | Required | App functionality |
| Location, Contacts, Calendar (của máy), Health, Web browsing, Installed apps, Crash logs | ✘ | | | | |

"Shared" = ✘ vì các dịch vụ xử lý (Render, Neon, Twilio, Stripe, Anthropic, Firebase) là **service providers**
theo hợp đồng xử lý dữ liệu — Google không tính là "sharing".

**Account deletion (App content)**: "Provide a way for users to request account deletion" → Yes; URL ở trên;
"Users can delete some data without deleting account" → Yes (ảnh, ghi chú, tin nhắn xoá trong app).

---

## C. Quyền (permissions) và chuỗi giải thích iOS

Thêm vào `ios/App/App/Info.plist` (Capacitor không tự thêm):

| Key | Chuỗi |
|---|---|
| `NSCameraUsageDescription` | `Lumio uses the camera to scan product barcodes at checkout and to take photos for a client's profile.` |
| `NSPhotoLibraryUsageDescription` | `Lumio needs access to your photos to attach pictures of your work to clients and social posts.` |
| `NSPhotoLibraryAddUsageDescription` | `Lumio saves receipts and post images you export to your photo library.` |
| `NSUserNotificationsUsageDescription` (tuỳ chọn) | `Lumio notifies you about new bookings, cancellations and client messages.` |
| `ITSAppUsesNonExemptEncryption` | `NO` (Boolean) |

Android `AndroidManifest.xml`: Capacitor thêm `INTERNET`; `POST_NOTIFICATIONS` (Android 13+) do plugin push
thêm; camera dùng qua WebView `getUserMedia` → thêm `<uses-permission android:name="android.permission.CAMERA"/>`
và `<uses-feature android:name="android.hardware.camera" android:required="false"/>`.

---

## D. Content rating (IARC) — trả lời

Category: **Utility, Productivity, Communication, or Other**. Tất cả câu về bạo lực, tình dục, ngôn từ, chất kích
thích, cờ bạc: **No**. "Does the app allow users to interact or exchange content with other users?" → **Yes**
(inbox với khách) — không ảnh hưởng rating. "Does the app share user's location?" → No. "Digital purchases" → No.
