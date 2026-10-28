#!/usr/bin/env node
/**
 * The iPad must turn: the salon's iPad stands LANDSCAPE at the counter as the
 * check-in screen and the customer screen. Capacitor has no config key for
 * orientation, and the iOS project (ios/) is generated on the Mac that builds
 * the app — so whoever builds, this script puts the same answer into it:
 *
 *   • iPad is a supported device (TARGETED_DEVICE_FAMILY "1,2") — an
 *     iPhone-only build shows on an iPad in a small upright window that never
 *     turns, and the check-in page takes it for a phone;
 *   • iPad turns all four ways; iPhone stays upright;
 *   • UIRequiresFullScreen off (iPad split view allowed).
 *
 * Runs after `cap sync` (npm run sync / npm run ios:ipad). Safe to run again;
 * does nothing when ios/ does not exist yet. Prints what it changed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const plistPath = process.argv[2] || join(root, 'ios', 'App', 'App', 'Info.plist');
const pbxPath = process.argv[3] || join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

const IPHONE = ['UIInterfaceOrientationPortrait'];
const IPAD = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];

/** Remove a top-level <key>k</key> and the value that follows it (array / true / false / string). */
export function dropKey(xml, k) {
  const re = new RegExp(`\\s*<key>${k.replace(/[~]/g, '\\$&')}</key>\\s*(<array>[\\s\\S]*?</array>|<array\\s*/>|<true\\s*/>|<false\\s*/>|<string>[\\s\\S]*?</string>)`, 'g');
  return xml.replace(re, '');
}

export function patchPlist(xml) {
  let out = xml;
  for (const k of ['UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad', 'UIRequiresFullScreen']) out = dropKey(out, k);
  const arr = (list) => `<array>\n${list.map((o) => `\t\t<string>${o}</string>`).join('\n')}\n\t</array>`;
  const block = `\t<key>UISupportedInterfaceOrientations</key>\n\t${arr(IPHONE)}\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t${arr(IPAD)}\n\t<key>UIRequiresFullScreen</key>\n\t<false/>\n`;
  const end = out.lastIndexOf('</dict>');
  if (end < 0) throw new Error('Info.plist: no closing </dict>');
  return out.slice(0, end).replace(/\s*$/, '\n') + block + out.slice(end);
}

export function patchPbx(text) {
  // "1" = iPhone only, "2" = iPad only, "1,2" = both.
  return text.replace(/TARGETED_DEVICE_FAMILY = (?:"?1"?|"?2"?);/g, 'TARGETED_DEVICE_FAMILY = "1,2";');
}

function main() {
  if (!existsSync(plistPath)) {
    console.log(`[ios-ipad] ${plistPath} not found — run "npx cap add ios" first. Nothing changed.`);
    return;
  }
  const before = readFileSync(plistPath, 'utf8');
  const after = patchPlist(before);
  if (after !== before) { writeFileSync(plistPath, after); console.log('[ios-ipad] Info.plist: iPad turns all 4 ways, iPhone upright, split view on.'); }
  else console.log('[ios-ipad] Info.plist already right.');
  if (existsSync(pbxPath)) {
    const p0 = readFileSync(pbxPath, 'utf8');
    const p1 = patchPbx(p0);
    if (p1 !== p0) { writeFileSync(pbxPath, p1); console.log('[ios-ipad] project.pbxproj: iPhone + iPad (TARGETED_DEVICE_FAMILY "1,2").'); }
    else console.log('[ios-ipad] project.pbxproj already iPhone + iPad.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
