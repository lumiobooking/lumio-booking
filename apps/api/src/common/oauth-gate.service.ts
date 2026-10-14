/**
 * CONNECTING AN ACCOUNT FINISHES IN THE SALON'S OWN SIGNED-IN SESSION.
 *
 * Every "Connect Facebook / Gmail / Google Business / TikTok / Zalo" flow
 * returned to a public callback carrying only a signed `state` naming the
 * salon. Anyone could start a flow for THEIR salon, send the provider's link to
 * another salon's owner, and — if that owner approved — receive the owner's
 * pages, mailbox or profile. The state proved which salon started the flow,
 * not who finished it.
 *
 * Now the callback does nothing with the grant. It parks the provider's answer
 * (code + state) for ten minutes under a one-time pair (n, c) and sends the
 * browser to /oauth/confirm on the web app. That page, signed in, posts (n, c)
 * back; the grant is applied only if the signed-in user belongs to the salon
 * the flow was started for. The victim's browser is signed in to the victim's
 * salon (refused); the attacker never sees `c` (it only went to the victim's
 * browser). Same provider redirect URIs — nothing to change in any console.
 */
import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from './tenant/tenant-context';

export type GateProvider = 'facebook' | 'zalo' | 'tiktok' | 'gmail' | 'google';
export const OAUTH_GATE_TTL_MS = 10 * 60 * 1000;
const KEY = (n: string) => `oauth_gate:${n}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A provider service's own state check (each keeps it private; read here, never re-implemented). */
export function tenantOfState(svc: unknown, state: string): string | null {
  const v = (svc as { verifyState?: (s: string) => string | null }).verifyState;
  try { return typeof v === 'function' ? v.call(svc, state) : null; } catch { return null; }
}

@Injectable()
export class OAuthGate {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly audit?: AuditService) {}

  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }

  /**
   * At the public callback. Returns the web confirm URL, or null when there is
   * nothing to apply (no code, a refusal, a state that names no salon) — the
   * caller then runs its own callback, which only reports the error.
   */
  async park(provider: GateProvider, tenantId: string | null, query: Record<string, string>): Promise<string | null> {
    if (!tenantId || !query.code) return null;
    const n = randomBytes(16).toString('base64url');
    const c = randomBytes(24).toString('base64url');
    const value = { provider, query, c: sha(c), at: Date.now() } as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.create({ data: { tenantId, key: KEY(n), value } });
    // Unclaimed answers of this salon older than an hour go.
    await this.prisma.setting.deleteMany({ where: { tenantId, key: { startsWith: 'oauth_gate:' }, createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } }).catch(() => undefined);
    return `${this.webBase()}/oauth/confirm?p=${provider}&n=${encodeURIComponent(n)}&c=${encodeURIComponent(c)}`;
  }

  /** On the web, signed in: the same salon, the right code, fresh, and only once. */
  async claim(user: AuthenticatedUser, provider: GateProvider, n: string, c: string): Promise<Record<string, string>> {
    if (user.role !== UserRole.SALON_ADMIN && user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Chỉ chủ tiệm mới hoàn tất được kết nối.');
    const tenantId = resolveTenantScope(user);
    if (!tenantId || !n || !c || n.length > 64 || c.length > 128) throw new BadRequestException('Liên kết kết nối không hợp lệ.');
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: KEY(n) } }, select: { value: true, createdAt: true } });
    // Not found in THIS salon: wrong salon, already used, or made up.
    if (!row) throw new BadRequestException('Liên kết kết nối không hợp lệ, đã dùng, hoặc thuộc tiệm khác. Hãy bấm Kết nối lại từ trang cài đặt.');
    await this.prisma.setting.deleteMany({ where: { tenantId, key: KEY(n) } });
    const v = row.value as { provider?: string; query?: Record<string, string>; c?: string; at?: number };
    const a = Buffer.from(sha(c));
    const b = Buffer.from(String(v.c ?? ''));
    if (v.provider !== provider || a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('Liên kết kết nối không hợp lệ.');
    if (!v.at || Date.now() - v.at > OAUTH_GATE_TTL_MS) throw new BadRequestException('Liên kết kết nối đã hết hạn (10 phút). Hãy bấm Kết nối lại.');
    await this.audit?.log({ tenantId, userId: user.userId, action: 'oauth.confirmed', resourceType: 'tenant', resourceId: tenantId, metadata: { provider } }).catch(() => undefined);
    return v.query ?? {};
  }
}
