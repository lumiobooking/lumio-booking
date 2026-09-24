import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Lumio Booking — the store app.
 *
 * WHY A SHELL AROUND THE LIVE SITE, NOT A BUNDLED COPY
 *
 * The salon app is server-rendered Next.js that changes several times a week.
 * A bundled build would mean a store review for every fix and two versions of
 * every screen in the wild. The shell loads https://lumiobooking.com/salon in
 * a native WebView, so the app is always the site; what the shell adds is what
 * a browser tab cannot give: an icon on the home screen, real push
 * notifications (APNs/FCM — iOS WebViews have no Web Push), the status bar,
 * and the back button. Everything native-only lives in apps/web/src/lib/native.ts.
 *
 * Both stores accept this shape when the app feels native and does not sell
 * the subscription inside (docs/app-store/submission-guide.md, Apple 3.1.1,
 * 4.2). The billing page hides its checkout when it detects the shell.
 */
const config: CapacitorConfig = {
  appId: 'com.lumioagency.booking',
  appName: 'Lumio Booking',
  webDir: 'www',
  server: {
    url: 'https://lumiobooking.com/salon',
    cleartext: false,
    // Only our own hosts stay inside the WebView. Any other host — Facebook,
    // Google and TikTok OAuth, Stripe — is opened in the system browser,
    // which is the ONLY place those logins work (Meta and Google refuse
    // embedded WebViews) and what Apple expects for external links.
    allowNavigation: ['lumiobooking.com', '*.lumiobooking.com'],
    // Shown from the bundle when the site cannot be reached at all.
    errorPath: 'error.html',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0b1120',
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#0b1120',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0b1120',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#111827',
      overlaysWebView: false,
    },
  },
};

export default config;
