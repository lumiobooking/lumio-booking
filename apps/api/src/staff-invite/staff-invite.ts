/**
 * rt200 — the team joins by an invite link and signs in with Facebook.
 *
 * The owner's words: "Tôi muốn kiểu kết nối như Pancake, không cần phải tạo
 * tài khoản." The owner presses "Mời nhân viên", sends the link on Zalo; the
 * person opens it, presses "Đăng nhập với Facebook", and is in — answering the
 * salon's customers in the Inbox, as the salon's Page.
 *
 * What Facebook gives us is ONLY who this is: an app-scoped id and a name
 * (scope public_profile). No Page, no messages, no friends. The salon's Page
 * stays connected once, by the owner, as before.
 *
 * Rules here are pure; the service does the reading and writing.
 */
import * as crypto from 'crypto';

export const PROVIDER_FACEBOOK = 'facebook';
/** Roles an invite may give. Never an owner: the salon admin is the person who signs for the salon. */
export const INVITE_ROLES = ['CHAT', 'RECEPTIONIST', 'MANAGER', 'TECHNICIAN'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** A fresh link token: 32 random bytes. Only its hash is stored. */
export function newToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
}

/** A token as it can only be: 43 base64url characters. Anything else is not looked up. */
export function tokenShapeOk(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token ?? ''));
}

export type InviteRow = { maxUses: number; uses: number; expiresAt: Date; revokedAt: Date | null };

/** Why this invite cannot be used now, or null when it can. */
export function inviteProblem(inv: InviteRow | null | undefined, now: Date): 'missing' | 'revoked' | 'expired' | 'used' | null {
  if (!inv) return 'missing';
  if (inv.revokedAt) return 'revoked';
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (inv.uses >= inv.maxUses) return 'used';
  return null;
}

export function cleanInviteInput(raw: { staffRole?: unknown; maxUses?: unknown; days?: unknown; label?: unknown }): { staffRole: InviteRole; maxUses: number; days: number; label: string | null } {
  const role = (INVITE_ROLES as readonly string[]).includes(String(raw.staffRole)) ? (String(raw.staffRole) as InviteRole) : 'CHAT';
  const n = Math.round(Number(raw.maxUses ?? 1));
  const d = Math.round(Number(raw.days ?? 7));
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 60) || null : null;
  return {
    staffRole: role,
    maxUses: Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 1,
    days: Number.isFinite(d) ? Math.min(30, Math.max(1, d)) : 7,
    label,
  };
}

/**
 * The login e-mail of someone who joined with Facebook. Users need a unique
 * e-mail; this one is unique per salon and person, reserved (.invalid never
 * resolves), and never shown — nothing can be sent to it by accident.
 */
export function facebookEmail(providerUserId: string, tenantId: string): string {
  const t = crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 10);
  return `fb-${String(providerUserId).replace(/[^0-9A-Za-z]/g, '').slice(0, 40)}-${t}@staff.lumiobooking.invalid`;
}

/** "Nguyễn Thị Lan" → first "Lan"-style split the salon screens expect. */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string | null } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Nhân viên', lastName: null };
  if (parts.length === 1) return { firstName: parts[0].slice(0, 60), lastName: null };
  return { firstName: parts.slice(0, -1).join(' ').slice(0, 60), lastName: parts[parts.length - 1].slice(0, 60) };
}

// ------------------------------------------------------- signed small tokens

const secret = () => process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-fb-signing';

function sign(prefix: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', `${prefix}|${secret()}`).update(body).digest('base64url');
  return `${prefix}${body}.${sig}`;
}

function verify<T extends { exp: number }>(prefix: string, raw: string, now: number): T | null {
  const s = String(raw ?? '');
  if (!s.startsWith(prefix)) return null;
  const [body, sig] = s.slice(prefix.length).split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', `${prefix}|${secret()}`).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    return typeof p.exp === 'number' && p.exp > now ? p : null;
  } catch { return null; }
}

/** The Facebook `state` for a staff sign-in. Its prefix tells the shared callback it is ours. */
export const STATE_PREFIX = 'sl.';
export type StaffState = { m: 'join' | 'login'; i?: string; n: string; exp: number };
export const signState = (s: Omit<StaffState, 'n' | 'exp'>, now = Date.now()) => sign(STATE_PREFIX, { ...s, n: crypto.randomBytes(8).toString('hex'), exp: now + 10 * 60_000 });
export const verifyState = (raw: string, now = Date.now()) => verify<StaffState>(STATE_PREFIX, raw, now);
export const isStaffState = (raw: string | null | undefined) => String(raw ?? '').startsWith(STATE_PREFIX);

/**
 * What the web exchanges for a session after Facebook. Short-lived; carries
 * the Lumio logins this Facebook person has (one per salon) — never a JWT in a URL.
 */
export const TICKET_PREFIX = 'st.';
export type Ticket = { u: string[]; n: string; exp: number };
export const signTicket = (userIds: string[], now = Date.now()) => sign(TICKET_PREFIX, { u: userIds.slice(0, 10), n: crypto.randomBytes(8).toString('hex'), exp: now + 3 * 60_000 });
export const verifyTicket = (raw: string, now = Date.now()) => verify<Ticket>(TICKET_PREFIX, raw, now);

export const ROLE_LABEL_VI: Record<InviteRole, string> = {
  CHAT: 'Tư vấn tin nhắn',
  RECEPTIONIST: 'Lễ tân',
  MANAGER: 'Quản lý',
  TECHNICIAN: 'Thợ',
};
