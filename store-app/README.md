# Lumio Booking — store app (Capacitor)

Vỏ native cho iOS/Android, tải `https://lumiobooking.com/salon`. Hướng dẫn đầy đủ: `docs/app-store/`.

```bash
npm install
npx cap add ios && npx cap add android   # một lần
npm run icons                            # icon + splash từ resources/
npx cap sync                             # sau mỗi lần đổi config/plugin
npm run open:ios                         # Xcode
npm run open:android                     # Android Studio
```

Files:
- `capacitor.config.ts` — appId `com.lumioagency.booking`, server URL, allowNavigation (host khác → mở trình duyệt ngoài).
- `www/index.html` — chuyển hướng về site; `www/error.html` — trang mất mạng.
- `resources/` — icon-only.png (iOS), icon-foreground/background.png (Android adaptive), splash*.png, feature graphic.
- Phía web: `apps/web/src/lib/native.ts`, `components/NativeBridge.tsx` (push token, back button, splash).
- Phía API: `apps/api/src/push/fcm.ts` — cần `FCM_SERVICE_ACCOUNT_JSON` trên Render.

Không commit: `google-services.json`, `GoogleService-Info.plist`, keystore, `.p8`.
