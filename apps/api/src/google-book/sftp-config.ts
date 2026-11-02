/**
 * THE SFTP DROP FOR GOOGLE'S FEEDS — reading the Partner Portal credentials
 * from the environment the way people actually paste them.
 *
 * Google's Actions Center takes the daily feeds over SFTP at
 * partnerupload.google.com:19321, authenticated by an RSA key pair: the public
 * key goes in the Partner Portal, the private key in Render (RWG_SFTP_KEY).
 * A PEM pasted into a web form arrives in every shape — real line breaks,
 * literal "\n", Windows line ends, everything on one line with spaces, or
 * base64 of the whole file — and one wrong shape is a failed upload at 3 a.m.
 * This file turns any of them back into the PEM the SSH library wants, and
 * turns the library's errors into what to change. Pure; see sftp-config.spec.ts.
 *
 * Platform-level (one partner account for every salon): nothing here is per
 * tenant, and the key never leaves the server — the agency screen only learns
 * whether it is set and what its fingerprint-free shape looks like.
 */

export interface SftpConfig {
  host: string;
  user: string;
  key: string;
  port: number;
  dir: string;
}

const PEM_RE = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

/** Any pasted shape of a private key → a PEM with real line breaks, or '' when it is not a key at all. */
export function normalizePrivateKey(raw: string | null | undefined): string {
  let k = String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!k) return '';
  if (!k.includes('-----BEGIN')) {
    // base64 of the whole key file (a single line, nothing to break on paste)
    try {
      const decoded = Buffer.from(k.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) k = decoded.trim();
      else return '';
    } catch {
      return '';
    }
  }
  k = k.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n');
  const m = PEM_RE.exec(k);
  if (!m) return '';
  const label = m[1];
  let body = m[2];
  const headers: string[] = [];
  // Old-style encrypted PEMs carry "Proc-Type:" / "DEK-Info:" headers before the base64.
  body = body.replace(/^\s*((?:Proc-Type|DEK-Info):[^\n]*)\n/gm, (_x, h: string) => { headers.push(h.trim()); return ''; });
  const b64 = body.replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return '';
  const lines = b64.match(/.{1,64}/g) ?? [];
  const head = headers.length ? `${headers.join('\n')}\n\n` : '';
  return `-----BEGIN ${label}-----\n${head}${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** What the environment gives, and what is missing, without ever returning the key itself. */
export function readSftpEnv(env: Record<string, string | undefined>): { config: SftpConfig | null; missing: string[]; keyProblem: string | null; host: string | null; user: string | null; port: number; dir: string } {
  const host = (env.RWG_SFTP_HOST ?? '').trim().replace(/^sftp:\/\//i, '').replace(/\/+$/, '') || null;
  const user = (env.RWG_SFTP_USER ?? '').trim() || null;
  const rawKey = env.RWG_SFTP_KEY ?? env.RWG_SFTP_KEY_B64 ?? '';
  const key = normalizePrivateKey(rawKey);
  const port = Number(env.RWG_SFTP_PORT || 19321) || 19321;
  const dir = (env.RWG_SFTP_DIR ?? '').trim() || '/';
  const missing: string[] = [];
  if (!host) missing.push('RWG_SFTP_HOST');
  if (!user) missing.push('RWG_SFTP_USER');
  if (!String(rawKey).trim()) missing.push('RWG_SFTP_KEY');
  let keyProblem: string | null = null;
  if (String(rawKey).trim() && !key) keyProblem = 'RWG_SFTP_KEY không phải khoá riêng hợp lệ — dán nguyên file lumio_rwg (từ -----BEGIN đến -----END), hoặc nội dung file lumio_rwg.b64';
  else if (/-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(key) || /^ssh-rsa /.test(String(rawKey).trim())) keyProblem = 'RWG_SFTP_KEY đang là khoá CÔNG KHAI — Render cần khoá RIÊNG (file lumio_rwg, không có .pub)';
  else if (/ENCRYPTED/.test(key)) keyProblem = 'Khoá riêng có mật khẩu (passphrase) — tạo lại khoá không mật khẩu';
  const config = !missing.length && !keyProblem && host && user ? { host, user, key, port, dir } : null;
  return { config, missing, keyProblem, host, user, port, dir };
}

/** The SSH library's error → what to change, in Vietnamese for the agency screen. */
export function sftpErrorHint(message: string): string {
  const m = String(message ?? '');
  if (/All configured authentication methods failed|authentication|Permission denied \(publickey/i.test(m)) {
    return 'Google từ chối khoá: kiểm tra RWG_SFTP_USER đúng tên user của môi trường (sandbox / production) ở Partner Portal → Feeds, và khoá CÔNG KHAI lumio_rwg.pub đã dán ở Onboarding Tasks / Feeds Configuration. Khoá mới dán có thể mất vài phút mới có hiệu lực.';
  }
  if (/Cannot parse privateKey|Unsupported key format|Malformed|privateKey/i.test(m)) return 'Không đọc được khoá riêng trong RWG_SFTP_KEY — dán lại nguyên file lumio_rwg hoặc nội dung lumio_rwg.b64.';
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(m)) return 'Sai tên máy chủ: RWG_SFTP_HOST phải là partnerupload.google.com (không có sftp://).';
  if (/ECONNREFUSED|ETIMEDOUT|timed out|Timed out while waiting/i.test(m)) return 'Không kết nối được: kiểm tra RWG_SFTP_PORT = 19321.';
  if (/No such file|ENOENT/i.test(m)) return 'Thư mục RWG_SFTP_DIR không tồn tại — để trống (thư mục gốc /).';
  if (/permission denied|EACCES/i.test(m)) return 'Không có quyền ghi vào thư mục này — để RWG_SFTP_DIR trống (thư mục gốc /).';
  return 'Xem lỗi gốc ở trên; so lại host, port, user và khoá với Partner Portal → Configuration → Feeds.';
}
