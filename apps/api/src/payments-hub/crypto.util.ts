import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for payment provider credentials stored at rest.
 * The 32-byte key comes ONLY from env PAYMENT_ENC_KEY (hex-64 or base64) and is
 * never hard-coded. Format: "v1:<ivB64>:<tagB64>:<ciphertextB64>".
 * We never store raw card data — only the tenant's own API key/token.
 */
const VERSION = 'v1';

function key(): Buffer {
  const raw = process.env.PAYMENT_ENC_KEY;
  if (!raw || raw.trim().length < 16) {
    throw new Error('PAYMENT_ENC_KEY is not configured or too short (use a strong random value)');
  }
  const t = raw.trim();
  // Accept a 32-byte key given as 64 hex chars or as base64; otherwise derive a
  // stable 32-byte key from any sufficiently-random value (e.g. Render's
  // "Generate"). Deterministic, so the same env value always yields the same key.
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, 'hex');
  try {
    const b = Buffer.from(t, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* not base64 */
  }
  return createHash('sha256').update(t, 'utf8').digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted secret');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Last-4 display hint, never the full secret. */
export function maskHint(secret: string): string {
  const s = (secret ?? '').trim();
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

export function encConfigured(): boolean {
  return !!process.env.PAYMENT_ENC_KEY;
}
