import { phoneEmail, phoneKey } from '../staff-invite/staff-invite';
import { BadRequestException, Body, Controller, Get, NotFoundException, Optional, Patch, Post } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { INDUSTRY_KEY, resolveIndustry } from '../common/industry';
import { hashSecret, verifySecret } from '../auth/password.util';

/**
 * Demonstration of tenant-scoped + role-protected endpoints. Real feature
 * modules (services, staff, bookings) follow the exact same pattern in later
 * steps.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly push?: PushService,
  ) {}

  // GET /api/me/tenant -> the salon a SALON_ADMIN/STAFF belongs to.
  // SUPER_ADMIN has no tenant, so this is restricted to salon-side roles.
  @Get('tenant')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  async myTenant(@CurrentUser() user: AuthenticatedUser) {
    // The Tenant table is the root entity, so its own `id` IS the tenant id
    // (there is no `tenantId` column here). resolveTenantScope returns the
    // caller's own tenantId, so a salon user can only ever read their own
    // salon record through this route.
    const tenantId = resolveTenantScope(user);
    if (!tenantId) {
      return null;
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true, market: true, timezone: true, businessType: true },
    });
    if (!tenant) return null;
    // The currency every money figure on every salon screen is formatted with.
    // Sent from here because the shell already calls this route once per load,
    // and guessing it from the market would be a hint where a fact is available.
    const rules = await this.prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: 'booking_rules' } },
      select: { value: true },
    });
    const currency = (rules?.value as { currency?: string } | null)?.currency || 'USD';
    // The line of business decides the words and the menu on every salon screen
    // (thợ / bác sĩ / nhân viên…). Never chosen = today's nail screens.
    const ind = await this.prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: INDUSTRY_KEY } },
      select: { value: true },
    }).catch(() => null);
    const industry = resolveIndustry(ind?.value ?? null, tenant.businessType);
    return { ...tenant, currency, industry };
  }

  // GET /api/me/plan -> the salon's plan feature flags (for UI gating).
  // No plan assigned → full access so nothing breaks for un-planned salons.
  @Get('plan')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  async myPlan(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        featureOverrides: true,
        plan: {
          select: { name: true, posEnabled: true, onlinePaymentEnabled: true, multiLocationEnabled: true, whiteLabelEnabled: true },
        },
      },
    });
    const p = tenant?.plan;
    // Per-tenant override wins over the plan; absent → follow the plan (or full access
    // when the salon has no plan). Set by Super Admin, e.g. granting POS to a Starter shop.
    const raw = tenant?.featureOverrides;
    const ov: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const flag = (key: string, planVal: boolean | undefined): boolean =>
      typeof ov[key] === 'boolean' ? (ov[key] as boolean) : (p ? !!planVal : true);
    return {
      planName: p?.name ?? null,
      posEnabled: flag('posEnabled', p?.posEnabled),
      onlinePaymentEnabled: flag('onlinePaymentEnabled', p?.onlinePaymentEnabled),
      multiLocationEnabled: flag('multiLocationEnabled', p?.multiLocationEnabled),
      whiteLabelEnabled: flag('whiteLabelEnabled', p?.whiteLabelEnabled),
    };
  }

  // PATCH /api/me/account -> the signed-in user changes their OWN login email
  /**
   * GET/PATCH /api/me/preferences — this person's light/dark choice, for every
   * kind of account (owner, technician, manager, Lumio support, Super Admin).
   * Only the caller's own row is ever read or written; nothing tenant-wide.
   */
  @Get('preferences')
  async preferences(@CurrentUser() user: AuthenticatedUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { theme: true } }).catch(() => null);
    return { theme: themeOf(u?.theme) };
  }

  @Patch('preferences')
  async setPreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: { theme?: unknown }) {
    const theme = themeOf(dto?.theme);
    if (!theme) throw new BadRequestException('theme must be "light" or "dark"');
    await this.prisma.user.update({ where: { id: user.userId }, data: { theme } });
    return { theme };
  }

  /**
   * rt205: how this person signs in, for "Tài khoản của tôi" — a phone number,
   * an e-mail, or Facebook — and whether changing the password needs the
   * current one (someone who joined with Facebook never had one to type).
   */
  @Get('login-info')
  async loginInfo(@CurrentUser() user: AuthenticatedUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, passwordChangedAt: true } });
    if (!u) throw new NotFoundException('Account not found');
    const fb = await this.firstPasswordFree(user.userId, u.passwordChangedAt);
    const tel = /^tel-(\d+)@staff\.lumiobooking\.invalid$/.exec(u.email);
    const viaFb = /^fb-.+@staff\.lumiobooking\.invalid$/.test(u.email);
    return { kind: tel ? 'phone' : viaFb ? 'facebook' : 'email', login: tel ? tel[1] : viaFb ? null : u.email, needsCurrent: !fb, canChangeEmail: !tel && !viaFb };
  }

  /** Joined with Facebook and never set a password: the first one needs no "current". */
  private async firstPasswordFree(userId: string, passwordChangedAt: Date | null): Promise<boolean> {
    if (passwordChangedAt) return false;
    const n = await (this.prisma as unknown as { socialLogin: { count: (a: unknown) => Promise<number> } }).socialLogin.count({ where: { userId } }).catch(() => 0);
    return n > 0;
  }

  // and/or password. Works for any role (Super Admin, Salon Admin, Staff).
  // Current password is required to authorise the change.
  @Patch('account')
  async updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { currentPassword?: string; newEmail?: string; newPassword?: string; newPhone?: string },
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!u) throw new NotFoundException('Account not found');
    // rt205: a team member who joined with Facebook sets a first password without one to type.
    const firstFree = !!dto.newPassword && !dto.newEmail && (await this.firstPasswordFree(u.id, u.passwordChangedAt));
    if (!firstFree && (!dto.currentPassword || !(await verifySecret(dto.currentPassword, u.passwordHash)))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const data: { email?: string; passwordHash?: string; passwordChangedAt?: Date } = {};
    // A login made from a phone number or Facebook keeps its hidden address; it is not an e-mail to edit.
    const hiddenLogin = /@staff\.lumiobooking\.invalid$/.test(u.email);
    if (!hiddenLogin && dto.newEmail && dto.newEmail.trim() && dto.newEmail.trim() !== u.email) {
      data.email = dto.newEmail.trim().toLowerCase();
    }
    // rt205: a phone / Facebook login signs in with a phone number; it may set or change that number.
    if (hiddenLogin && dto.newPhone) {
      const p = phoneKey(dto.newPhone);
      if (!p) throw new BadRequestException('Số điện thoại chưa đúng.');
      if (phoneEmail(p) !== u.email) {
        // A Facebook login has no password anyone knows: a number alone would be a door with no lock.
        if (/^fb-/.test(u.email) && !dto.newPassword && !u.passwordChangedAt) throw new BadRequestException('Đặt mật khẩu cùng lúc với số điện thoại.');
        data.email = phoneEmail(p);
      }
    }
    if (dto.newPassword) {
      if (dto.newPassword.length < 8) throw new BadRequestException('New password must be at least 8 characters');
      data.passwordHash = await hashSecret(dto.newPassword);
      data.passwordChangedAt = new Date(); // invalidates all existing sessions
    }
    if (!data.email && !data.passwordHash) {
      throw new BadRequestException('Nothing to change — enter a new email or new password');
    }
    try {
      await this.prisma.user.update({ where: { id: u.id }, data });
    } catch {
      throw new BadRequestException(hiddenLogin && dto.newPhone ? 'Số điện thoại này đã có tài khoản khác.' : 'That email is already in use by another account');
    }
    if (u.tenantId) await this.prisma.auditLog.create({ data: { tenantId: u.tenantId, userId: u.id, action: data.passwordHash ? 'auth.password_changed' : 'auth.email_changed', resourceType: 'user', resourceId: u.id } }).catch(() => undefined);
    // passwordChanged tells the client to log out immediately and re-login.
    return { ok: true, email: data.email ?? u.email, passwordChanged: !!data.passwordHash };
  }

  /**
   * POST /api/me/delete-account -> the signed-in person closes their OWN login.
   *
   * Required by both stores (Apple 5.1.1(v), Google Play account-deletion
   * policy): an app that lets you create or sign in to an account must let
   * you delete it from inside the app, without emailing anyone.
   *
   * What "delete" means here, and why it is not `DELETE FROM users`:
   * the salon's bookings, payments and audit rows reference this person and
   * are the salon's business records, which the salon (and tax law) keeps.
   * So the LOGIN is destroyed — email replaced by an unusable placeholder,
   * password replaced by random bytes, account disabled, every push device
   * dropped, sessions invalidated — while the rows the business owns stay.
   * The person can never sign in again and nothing personal remains on the
   * user row. Super Admin accounts cannot self-delete (that is a platform
   * decision), and the last admin of a salon is told to hand over or close
   * the salon through support first, so a shop is never left with no owner.
   */
  @Post('delete-account')
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { currentPassword?: string; confirm?: string },
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!u) throw new NotFoundException('Account not found');
    if (u.role === UserRole.SUPER_ADMIN) throw new BadRequestException('A platform admin account cannot delete itself.');
    if (!dto?.currentPassword || !(await verifySecret(dto.currentPassword, u.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (String(dto.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
      throw new BadRequestException('Type DELETE to confirm');
    }
    if (u.role === UserRole.SALON_ADMIN && u.tenantId) {
      const admins = await this.prisma.user.count({ where: { tenantId: u.tenantId, role: UserRole.SALON_ADMIN, isActive: true } });
      if (admins <= 1) {
        throw new BadRequestException(
          'You are the only admin of this salon. Add another admin first, or ask support@lumiobooking.com to close the salon — then this account can be deleted.',
        );
      }
    }
    const stamp = new Date();
    const placeholder = `deleted+${u.id}@deleted.lumiobooking.com`;
    await this.prisma.user.update({
      where: { id: u.id },
      data: {
        email: placeholder,
        passwordHash: await hashSecret(randomBytes(32).toString('hex')),
        passwordChangedAt: stamp, // every existing session dies with this
        isActive: false,
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
      } as never,
    });
    await this.push?.removeAllForUser(u.id);
    await this.audit?.log({
      tenantId: u.tenantId ?? null,
      userId: u.id,
      action: 'user.self_deleted',
      resourceType: 'user',
      resourceId: u.id,
      metadata: { role: u.role, at: stamp.toISOString() },
    }).catch(() => undefined);
    return { ok: true, deleted: true };
  }
}

/** 'light' | 'dark', or null for anything else. */
export function themeOf(v: unknown): 'light' | 'dark' | null {
  return v === 'light' || v === 'dark' ? v : null;
}
