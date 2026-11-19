import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PushService } from '../push/push.service';
import { hashSecret } from '../auth/password.util';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { oauthBase } from '../common/public-url.util';
import { takesAppointmentsFor } from '../staff/bookable-role';
import {
  PROVIDER_FACEBOOK, ROLE_LABEL_VI, cleanInviteInput, phoneEmail, phoneKey, facebookEmail, hashToken, inviteProblem, newToken,
  signState, signTicket, splitName, tokenShapeOk, verifyState, verifyTicket, type InviteRole,
} from './staff-invite';

/**
 * rt200 — invite links and "Đăng nhập với Facebook" for a salon's team.
 * Every query is scoped by the caller's tenant, or by the tenant the invite
 * or the login row belongs to; nothing here trusts an id from the browser.
 */
@Injectable()
export class StaffInviteService {
  private readonly log = new Logger('StaffInvite');
  /** Tickets already turned into a session (one use each; short-lived anyway). */
  private readonly spent = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    @Optional() private readonly push?: PushService,
  ) {}

  private get db() { return this.prisma as unknown as Record<string, any>; }
  private web(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  private appId(): string { return process.env.FB_APP_ID || ''; }
  private appSecret(): string { return process.env.FB_APP_SECRET || ''; }
  /** The SAME redirect the Page connection uses — already allowed in the Meta app, nothing to add there. */
  private redirect(): string { return `${oauthBase()}/api/messenger/oauth/callback`; }

  private adminTenant(user: AuthenticatedUser): string {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new NotFoundException('No tenant context');
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Only the salon owner can invite people.');
    }
    return tenantId;
  }

  // ------------------------------------------------------------ the owner ----

  async create(user: AuthenticatedUser, raw: { staffRole?: unknown; maxUses?: unknown; days?: unknown; label?: unknown }) {
    const tenantId = this.adminTenant(user);
    const input = cleanInviteInput(raw);
    const { token, hash } = newToken();
    const row = await this.db.staffInvite.create({
      data: {
        tenantId, tokenHash: hash, staffRole: input.staffRole as StaffRole, label: input.label,
        maxUses: input.maxUses, uses: 0, expiresAt: new Date(Date.now() + input.days * 86_400_000), createdById: user.userId,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'staff.invite_created', resourceType: 'staff_invite', resourceId: row.id, metadata: { staffRole: input.staffRole, maxUses: input.maxUses, days: input.days } });
    // The link is shown this once; the server keeps only its hash.
    return { url: `${this.web()}/join/${token}`, invite: this.viewOf(row) };
  }

  async list(user: AuthenticatedUser) {
    const tenantId = this.adminTenant(user);
    const rows = await this.db.staffInvite.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 30 });
    return rows.map((r: Record<string, unknown>) => this.viewOf(r));
  }

  async revoke(user: AuthenticatedUser, id: string) {
    const tenantId = this.adminTenant(user);
    const r = await this.db.staffInvite.updateMany({ where: { id: String(id), tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Invite not found');
    await this.audit.log({ tenantId, userId: user.userId, action: 'staff.invite_revoked', resourceType: 'staff_invite', resourceId: String(id) });
    return { ok: true };
  }

  private viewOf(r: Record<string, any>) {
    const problem = inviteProblem(r as never, new Date());
    return {
      id: r.id as string, staffRole: r.staffRole as InviteRole, roleLabel: ROLE_LABEL_VI[r.staffRole as InviteRole] ?? String(r.staffRole),
      label: (r.label as string | null) ?? null, maxUses: r.maxUses as number, uses: r.uses as number,
      expiresAt: r.expiresAt as Date, createdAt: r.createdAt as Date, status: problem ?? 'open',
    };
  }

  // ------------------------------------------------------- the newcomer ----

  /** What the join page shows before anyone signs in: the salon's name and the role. */
  async preview(token: string) {
    if (!tokenShapeOk(token)) return { ok: false, reason: 'missing' as const };
    const inv = await this.db.staffInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    const problem = inviteProblem(inv, new Date());
    if (problem || !inv) return { ok: false, reason: problem ?? 'missing' };
    const t = await this.prisma.tenant.findUnique({ where: { id: inv.tenantId }, select: { name: true } });
    return { ok: true, salonName: t?.name ?? '', role: inv.staffRole as InviteRole, roleLabel: ROLE_LABEL_VI[inv.staffRole as InviteRole] ?? '' };
  }

  /** The Facebook dialog: only public_profile — who the person is, nothing else. */
  async start(mode: 'join' | 'login', token?: string) {
    if (!this.appId()) throw new BadRequestException('Facebook sign-in is not set up on this server.');
    let i: string | undefined;
    if (mode === 'join') {
      if (!token || !tokenShapeOk(token)) throw new BadRequestException('This invite link is not valid.');
      const inv = await this.db.staffInvite.findUnique({ where: { tokenHash: hashToken(token) } });
      const problem = inviteProblem(inv, new Date());
      if (problem) throw new BadRequestException(`invite-${problem}`);
      i = hashToken(token);
    }
    const params = new URLSearchParams({
      client_id: this.appId(), redirect_uri: this.redirect(), response_type: 'code',
      scope: 'public_profile', state: signState({ m: mode, ...(i ? { i } : {}) }),
    });
    return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
  }

  /** Who Facebook says this is: the app-scoped id and the name. */
  private async facebookPerson(code: string): Promise<{ id: string; name: string | null } | null> {
    const tokRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${this.appId()}&client_secret=${this.appSecret()}&redirect_uri=${encodeURIComponent(this.redirect())}&code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(15000) });
    const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tok.access_token) return null;
    const proof = crypto.createHmac('sha256', this.appSecret()).update(tok.access_token).digest('hex');
    const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(tok.access_token)}&appsecret_proof=${proof}`, { signal: AbortSignal.timeout(10000) });
    const me = (await meRes.json().catch(() => ({}))) as { id?: string; name?: string };
    return me.id && /^\d{1,32}$/.test(me.id) ? { id: me.id, name: me.name ?? null } : null;
  }

  /**
   * Facebook sends the person back to the shared callback with our state.
   * Returns where to send the browser. The Facebook token itself is used once
   * to read id + name and then dropped — never stored.
   */
  async callback(code: string, state: string, error: string, person?: { id: string; name: string | null } | null): Promise<string> {
    const web = this.web();
    if (error) return `${web}/login?fb=cancel`;
    const st = verifyState(state);
    if (!st || !code) return `${web}/login?fb=expired`;
    let who = person;
    if (who === undefined) who = await this.facebookPerson(code).catch(() => null);
    if (!who) return `${web}/login?fb=failed`;
    try {
      const userIds = st.m === 'join' ? await this.join(st.i ?? '', who) : await this.loginsOf(who.id);
      if (!userIds.length) return `${web}/login?fb=none`;
      return `${web}/login/facebook?t=${encodeURIComponent(signTicket(userIds))}`;
    } catch (e) {
      const m = /invite-(missing|revoked|expired|used)/.exec(String((e as Error)?.message ?? ''));
      if (m) return `${web}/login?fb=invite-${m[1]}`;
      this.log.warn(`staff facebook sign-in failed: ${String(e).slice(0, 160)}`);
      return `${web}/login?fb=failed`;
    }
  }

  /** The Lumio logins (one per salon) this Facebook person may open, switched on. */
  private async loginsOf(providerUserId: string): Promise<string[]> {
    const rows = await this.db.socialLogin.findMany({ where: { provider: PROVIDER_FACEBOOK, providerUserId }, select: { userId: true, tenantId: true }, take: 10 }) as { userId: string; tenantId: string }[];
    if (!rows.length) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, isActive: true }, select: { id: true, tenantId: true } });
    // The login row and the user must belong to the same salon — checked, not assumed.
    const ok = new Set(rows.filter((r) => users.some((u) => u.id === r.userId && u.tenantId === r.tenantId)).map((r) => r.userId));
    return [...ok];
  }

  /**
   * Accept an invite: the person becomes a team member of THAT salon with the
   * invite's role. Already a member there through Facebook → just signed in,
   * the invite is not spent again. One use is claimed atomically, so a link
   * for one person cannot let two in.
   */
  async join(inviteHash: string, who: { id: string; name: string | null }): Promise<string[]> {
    const inv = await this.db.staffInvite.findUnique({ where: { tokenHash: inviteHash } });
    const now = new Date();
    if (!inv) throw new Error('invite-missing');
    const existing = await this.db.socialLogin.findUnique({ where: { provider_providerUserId_tenantId: { provider: PROVIDER_FACEBOOK, providerUserId: who.id, tenantId: inv.tenantId } } });
    if (existing) {
      const u = await this.prisma.user.findFirst({ where: { id: existing.userId, tenantId: inv.tenantId, isActive: true }, select: { id: true } });
      if (u) return [u.id];
      throw new Error('invite-revoked'); // the salon turned this login off; an old link must not turn it back on
    }
    const problem = inviteProblem(inv, now);
    if (problem) throw new Error(`invite-${problem}`);
    const { firstName, lastName } = splitName(who.name);
    const passwordHash = await hashSecret(crypto.randomBytes(32).toString('hex')); // no password: Facebook is the way in
    const role = inv.staffRole as StaffRole;
    const userId = await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<string, any>;
      const claimed = await t.staffInvite.updateMany({ where: { id: inv.id, tenantId: inv.tenantId, revokedAt: null, expiresAt: { gt: now }, uses: { lt: inv.maxUses } }, data: { uses: { increment: 1 } } });
      if (!claimed.count) throw new Error('invite-used');
      const user = await t.user.create({ data: { tenantId: inv.tenantId, role: UserRole.STAFF, email: facebookEmail(who.id, inv.tenantId), passwordHash, firstName, lastName } });
      await t.staffMember.create({ data: { tenantId: inv.tenantId, firstName, lastName, isActive: true, staffRole: role, takesAppointments: takesAppointmentsFor(role, undefined), userId: user.id } });
      await t.socialLogin.create({ data: { tenantId: inv.tenantId, userId: user.id, provider: PROVIDER_FACEBOOK, providerUserId: who.id, displayName: who.name } });
      return user.id as string;
    });
    await this.audit.log({ tenantId: inv.tenantId, userId, action: 'staff.joined_by_invite', resourceType: 'staff_invite', resourceId: inv.id, metadata: { staffRole: role } });
    const owners = await this.prisma.user.findMany({ where: { tenantId: inv.tenantId, isActive: true, role: UserRole.SALON_ADMIN }, select: { id: true } }).catch(() => []);
    for (const o of owners) void this.push?.sendToUser(inv.tenantId, o.id, { title: 'Nhân viên mới đã tham gia', body: `${who.name || 'Một người'} vừa vào tiệm qua link mời (${ROLE_LABEL_VI[role as InviteRole] ?? role}).`, url: '/salon/staff', tag: `staff-joined-${userId}` }).catch(() => undefined);
    return [userId];
  }

  /**
   * rt202 — the same invite without Facebook: the person types their name,
   * phone number and a password of their own, and is signed in at once. Next
   * time: phone + password on the normal sign-in page. Same atomic claim of
   * one use as the Facebook path; same tenant, role and audit.
   */
  async joinWithPassword(token: string, raw: { name?: unknown; phone?: unknown; password?: unknown }) {
    if (!tokenShapeOk(token)) throw new BadRequestException('Link mời không đúng.');
    const inv = await this.db.staffInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    const now = new Date();
    const problem = inviteProblem(inv, now);
    if (problem || !inv) throw new BadRequestException(problem === 'used' ? 'Link mời đã dùng hết lượt.' : problem === 'expired' ? 'Link mời đã hết hạn.' : problem === 'revoked' ? 'Link mời đã bị huỷ.' : 'Link mời không đúng.');
    const name = String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (name.length < 2) throw new BadRequestException('Nhập tên của bạn.');
    const phone = phoneKey(raw.phone);
    if (!phone) throw new BadRequestException('Số điện thoại chưa đúng.');
    const password = String(raw.password ?? '');
    if (password.length < 8) throw new BadRequestException('Mật khẩu cần ít nhất 8 ký tự.');
    const email = phoneEmail(phone);
    const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) throw new BadRequestException('Số điện thoại này đã có tài khoản — vào trang đăng nhập, gõ số điện thoại và mật khẩu.');
    const { firstName, lastName } = splitName(name);
    const passwordHash = await hashSecret(password);
    const role = inv.staffRole as StaffRole;
    const userId = await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<string, any>;
      const claimed = await t.staffInvite.updateMany({ where: { id: inv.id, tenantId: inv.tenantId, revokedAt: null, expiresAt: { gt: now }, uses: { lt: inv.maxUses } }, data: { uses: { increment: 1 } } });
      if (!claimed.count) throw new BadRequestException('Link mời đã dùng hết lượt.');
      const user = await t.user.create({ data: { tenantId: inv.tenantId, role: UserRole.STAFF, email, passwordHash, firstName, lastName } });
      await t.staffMember.create({ data: { tenantId: inv.tenantId, firstName, lastName, phone, isActive: true, staffRole: role, takesAppointments: takesAppointmentsFor(role, undefined), userId: user.id } });
      return user.id as string;
    });
    await this.audit.log({ tenantId: inv.tenantId, userId, action: 'staff.joined_by_invite', resourceType: 'staff_invite', resourceId: inv.id, metadata: { staffRole: role, via: 'phone' } });
    const owners = await this.prisma.user.findMany({ where: { tenantId: inv.tenantId, isActive: true, role: UserRole.SALON_ADMIN }, select: { id: true } }).catch(() => []);
    for (const o of owners) void this.push?.sendToUser(inv.tenantId, o.id, { title: 'Nhân viên mới đã tham gia', body: `${name} vừa vào tiệm qua link mời (${ROLE_LABEL_VI[role as InviteRole] ?? role}).`, url: '/salon/staff', tag: `staff-joined-${userId}` }).catch(() => undefined);
    return this.auth.sessionForUser(userId);
  }

  /**
   * The web trades the short ticket for a session. Someone in two salons picks
   * one (by its place in the list — no ids go to the browser).
   */
  async exchange(ticket: string, pick?: number) {
    const t = verifyTicket(ticket);
    if (!t || this.spent.has(t.n)) throw new UnauthorizedException('This sign-in has expired. Press “Đăng nhập với Facebook” again.');
    const users = await this.prisma.user.findMany({ where: { id: { in: t.u }, isActive: true }, select: { id: true, tenantId: true } });
    const live = t.u.filter((id) => users.some((u) => u.id === id));
    if (!live.length) throw new UnauthorizedException('This login has been turned off. Ask the salon owner to turn it back on.');
    if (live.length > 1 && (pick === undefined || pick === null)) {
      const tenants = await this.prisma.tenant.findMany({ where: { id: { in: users.map((u) => u.tenantId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      return { choose: live.map((id, i) => ({ i, salon: tenants.find((x) => x.id === users.find((u) => u.id === id)?.tenantId)?.name ?? '' })) };
    }
    const id = live.length === 1 ? live[0] : live[Number(pick)];
    if (!id) throw new BadRequestException('Pick a salon.');
    const session = await this.auth.sessionForUser(id);
    this.spent.set(t.n, t.exp);
    for (const [n, exp] of this.spent) if (exp < Date.now()) this.spent.delete(n);
    const tenantId = users.find((u) => u.id === id)?.tenantId ?? null;
    if (tenantId) {
      await this.db.socialLogin.updateMany({ where: { userId: id, tenantId, provider: PROVIDER_FACEBOOK }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
      await this.audit.log({ tenantId, userId: id, action: 'auth.facebook_login', resourceType: 'user', resourceId: id });
    }
    return session;
  }
}
