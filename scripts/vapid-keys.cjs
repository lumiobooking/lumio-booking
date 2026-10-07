#!/usr/bin/env node
/**
 * Make a VAPID key pair for web push — no npm download, no npx, just Node.
 *
 *   node scripts\vapid-keys.cjs           → prints the keys
 *   node scripts\vapid-keys.cjs --save    → also writes vapid-keys.txt next to this repo
 *                                           (git-ignored) and opens it in Notepad, for copying
 *
 * Prints the three environment variables to set on EACH API service in Render
 * (Environment → Add). Nothing is written to disk or sent anywhere. Run it
 * once and keep the private key secret; running it again makes a NEW pair
 * (every phone would then have to re-enable notifications).
 */
const { generateKeyPairSync } = require('crypto');

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
// Web push wants the raw uncompressed point (0x04 || x || y) and the raw 32-byte private scalar.
const publicRaw = Buffer.concat([Buffer.from([0x04]), fromB64url(pub.x), fromB64url(pub.y)]);
const privateRaw = fromB64url(priv.d);

console.log('');
console.log('Copy these into Render → (each API service) → Environment:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`);
console.log(`VAPID_PRIVATE_KEY=${b64url(privateRaw)}`);
console.log('VAPID_SUBJECT=mailto:support@lumiobooking.com');
console.log('');
if (process.argv.includes('--save')) {
  const fs = require('fs'); const path = require('path');
  const file = path.join(__dirname, '..', 'vapid-keys.txt');
  fs.writeFileSync(file, [`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`, `VAPID_PRIVATE_KEY=${b64url(privateRaw)}`, 'VAPID_SUBJECT=mailto:support@lumiobooking.com', ''].join('\r\n'));
  console.log('Saved to', file, '— delete it once the keys are in Render.');
  if (process.platform === 'win32') require('child_process').spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
}
console.log('Public key length:', b64url(publicRaw).length, '(expect 87) · private:', b64url(privateRaw).length, '(expect 43)');
