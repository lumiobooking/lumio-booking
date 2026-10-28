#!/usr/bin/env node
/**
 * Make the generated iOS project (ios/ from `npx cap add ios`) the Lumio
 * Booking app the App Store gets — the same way every time, on a Mac or on the
 * cloud build (.github/workflows/ios-testflight.yml), with no clicking in Xcode:
 *
 *   Info.plist   name "Lumio Booking"; iPhone upright, iPad all four ways
 *                (the counter iPad stands landscape); split view allowed;
 *                remote-notification background mode; camera / photo strings
 *                (docs/app-store/privacy-answers.md C); no non-exempt
 *                encryption; arm64 (not the template's armv7).
 *   project      bundle id com.lumioagency.booking, iPhone + iPad, iOS 15,
 *                push entitlement; for a store build (--release) manual
 *                signing with the App Store profile (IOS_TEAM_ID,
 *                IOS_PROFILE_NAME) — set on the App target only, so the Pods
 *                are not asked for a profile they cannot have.
 *   Firebase     only when ios/App/App/GoogleService-Info.plist exists: the
 *                file is added to the app's resources, FirebaseMessaging to
 *                the Podfile, and AppDelegate hands the APNs token to Firebase
 *                and the FCM token to Capacitor (what api push/fcm.ts sends to).
 *
 * Safe to run again. Prints each change. Run BEFORE `npx cap sync ios`
 * (the sync runs pod install with the Firebase pod).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

export const BUNDLE_ID = 'com.lumioagency.booking';
export const DISPLAY_NAME = 'Lumio Booking';
export const MIN_IOS = '15.0';

const IPHONE = ['UIInterfaceOrientationPortrait'];
const IPAD = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];

/** Info.plist as an object → the object the app ships with. */
export function patchInfo(info) {
  const out = { ...info };
  out.CFBundleDisplayName = DISPLAY_NAME;
  out.UIRequiredDeviceCapabilities = ['arm64'];
  out.UISupportedInterfaceOrientations = IPHONE;
  out['UISupportedInterfaceOrientations~ipad'] = IPAD;
  out.UIRequiresFullScreen = false;
  out.UIBackgroundModes = [...new Set([...(Array.isArray(info.UIBackgroundModes) ? info.UIBackgroundModes : []), 'remote-notification'])];
  out.ITSAppUsesNonExemptEncryption = false;
  out.NSCameraUsageDescription = "Lumio uses the camera to scan product barcodes at checkout and to take photos for a client's profile.";
  out.NSPhotoLibraryUsageDescription = 'Lumio needs access to your photos to attach pictures of your work to clients and social posts.';
  out.NSPhotoLibraryAddUsageDescription = 'Lumio saves receipts and post images you export to your photo library.';
  return out;
}

export function patchPodfile(text, firebase) {
  if (!firebase || /pod 'FirebaseMessaging'/.test(text)) return text;
  if (!/^\s*capacitor_pods\s*$/m.test(text)) throw new Error('Podfile: no capacitor_pods line in target App');
  // Only the first `capacitor_pods` after "target 'App' do" — not the def.
  return text.replace(/(target 'App' do\s*\n\s*capacitor_pods[^\n]*\n)/, `$1  pod 'FirebaseMessaging'\n`);
}

export function patchAppDelegate(text, firebase) {
  if (!firebase || /FirebaseApp\.configure\(\)/.test(text)) return text;
  let out = text.replace(/import Capacitor\n/, 'import Capacitor\nimport FirebaseCore\nimport FirebaseMessaging\n');
  out = out.replace(
    /(didFinishLaunchingWithOptions launchOptions:[^{]*\{\n)/,
    '$1        // Push: Firebase turns the APNs token into the FCM token the Lumio API sends to (api push/fcm.ts).\n        FirebaseApp.configure()\n',
  );
  const handlers = `
    // Push (Capacitor + Firebase): give Firebase the APNs token, then hand the
    // FCM token to the Capacitor push plugin — the web side registers it.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token(completion: { (token, error) in
            if let error = error {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        })
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;
  const end = out.lastIndexOf('\n}');
  if (end < 0) throw new Error('AppDelegate: no closing brace');
  out = out.slice(0, end) + '\n' + handlers + out.slice(end);
  if (!/FirebaseApp\.configure\(\)/.test(out) || !/import FirebaseMessaging/.test(out)) throw new Error('AppDelegate: template not recognised');
  return out;
}

export const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>production</string>
</dict>
</plist>
`;

const q = (v) => (/^[A-Za-z0-9_./$()-]+$/.test(v) ? v : `"${String(v).replace(/"/g, '\\"')}"`);

/** The App target's build configurations in an `xcode` project. */
function appConfigs(proj) {
  const sec = proj.pbxXCBuildConfigurationSection();
  return Object.entries(sec)
    .filter(([k, v]) => !k.endsWith('_comment') && v && v.buildSettings && String(v.buildSettings.INFOPLIST_FILE || '').replace(/"/g, '') === 'App/Info.plist')
    .map(([, v]) => v);
}

/** Build settings on the App target. `release` = manual App Store signing on the Release config. */
export function patchProject(proj, { release = false, teamId = '', profileName = '', firebase = false } = {}) {
  const changes = [];
  for (const c of appConfigs(proj)) {
    const s = c.buildSettings;
    const set = (k, v) => { const val = q(v); if (s[k] !== val) { s[k] = val; changes.push(`${c.name}: ${k} = ${v}`); } };
    set('PRODUCT_BUNDLE_IDENTIFIER', BUNDLE_ID);
    set('TARGETED_DEVICE_FAMILY', '1,2');
    set('IPHONEOS_DEPLOYMENT_TARGET', MIN_IOS);
    set('CODE_SIGN_ENTITLEMENTS', 'App/App.entitlements');
    if (release && c.name === 'Release') {
      if (!teamId || !profileName) throw new Error('--release needs IOS_TEAM_ID and IOS_PROFILE_NAME');
      set('CODE_SIGN_STYLE', 'Manual');
      set('DEVELOPMENT_TEAM', teamId);
      set('CODE_SIGN_IDENTITY', 'Apple Distribution');
      set('PROVISIONING_PROFILE_SPECIFIER', profileName);
    }
  }
  if (!changes.length && !appConfigs(proj).length) throw new Error('project: App target not found');
  if (firebase) {
    const has = Object.values(proj.pbxFileReferenceSection()).some((f) => f && typeof f === 'object' && String(f.path || '').replace(/"/g, '') === 'GoogleService-Info.plist');
    if (!has) {
      const appGroup = Object.entries(proj.hash.project.objects.PBXGroup).find(([k, g]) => !k.endsWith('_comment') && g && (g.children || []).some((ch) => ch.comment === 'AppDelegate.swift'));
      if (!appGroup) throw new Error('project: App group not found');
      const target = proj.pbxTargetByName('App');
      const targetKey = Object.entries(proj.pbxNativeTargetSection()).find(([, t]) => t === target)?.[0];
      // By hand: the library's addResourceFile insists on a "Resources" group the template does not have.
      const PbxFile = require('xcode/lib/pbxFile');
      const file = new PbxFile('GoogleService-Info.plist');
      file.uuid = proj.generateUuid();
      file.fileRef = proj.generateUuid();
      file.target = targetKey;
      for (const k of Object.keys(file)) if (file[k] === undefined) delete file[k]; // the writer would print "undefined"
      proj.addToPbxBuildFileSection(file);
      proj.addToPbxResourcesBuildPhase(file);
      proj.addToPbxFileReferenceSection(file);
      const ref = proj.pbxFileReferenceSection()[file.fileRef];
      for (const k of Object.keys(ref)) if (ref[k] === undefined) delete ref[k];
      proj.addToPbxGroup(file, appGroup[0]);
      changes.push('GoogleService-Info.plist added to the App resources');
    }
  }
  return changes;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const root = join(here, '..', 'ios', 'App');
  const infoPath = join(root, 'App', 'Info.plist');
  if (!existsSync(infoPath)) { console.log('[ios-prepare] ios/ not found — run "npx cap add ios" first. Nothing changed.'); return; }
  const plist = require('plist');
  const xcode = require('xcode');
  const firebase = existsSync(join(root, 'App', 'GoogleService-Info.plist'));

  const info = plist.parse(readFileSync(infoPath, 'utf8'));
  const next = plist.build(patchInfo(info));
  if (next !== readFileSync(infoPath, 'utf8')) { writeFileSync(infoPath, next); console.log('[ios-prepare] Info.plist: name, orientations (iPad 4-way), push mode, privacy strings, arm64.'); }

  const entPath = join(root, 'App', 'App.entitlements');
  if (!existsSync(entPath) || readFileSync(entPath, 'utf8') !== ENTITLEMENTS) { writeFileSync(entPath, ENTITLEMENTS); console.log('[ios-prepare] App.entitlements: push (production).'); }

  const podPath = join(root, 'Podfile');
  const pod0 = readFileSync(podPath, 'utf8'); const pod1 = patchPodfile(pod0, firebase);
  if (pod1 !== pod0) { writeFileSync(podPath, pod1); console.log("[ios-prepare] Podfile: pod 'FirebaseMessaging'."); }

  const adPath = join(root, 'App', 'AppDelegate.swift');
  const ad0 = readFileSync(adPath, 'utf8'); const ad1 = patchAppDelegate(ad0, firebase);
  if (ad1 !== ad0) { writeFileSync(adPath, ad1); console.log('[ios-prepare] AppDelegate: Firebase push token hand-off.'); }

  const pbxPath = join(root, 'App.xcodeproj', 'project.pbxproj');
  const proj = xcode.project(pbxPath); proj.parseSync();
  const changes = patchProject(proj, { release: args.has('--release'), teamId: process.env.IOS_TEAM_ID || '', profileName: process.env.IOS_PROFILE_NAME || '', firebase });
  if (changes.length) { writeFileSync(pbxPath, proj.writeSync()); for (const c of changes) console.log(`[ios-prepare] project: ${c}`); }
  if (!firebase) console.log('[ios-prepare] No GoogleService-Info.plist: built WITHOUT push notifications.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(`[ios-prepare] ${e instanceof Error ? e.message : e}`); process.exit(1); }
}
