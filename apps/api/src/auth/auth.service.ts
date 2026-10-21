import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffRole, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashSecret, verifySecret } from './password.util';
import { canBootstrap, passwordProblem } from './bootstrap.guard';
import { JwtPayload } from './strategies/jwt.strategy';
import { capabilitiesFor, cleanStaffCaps, hasCapability } from './capabilities';

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create the very first Super Admin, once, on an empty deployment.
   *
   * A new market means a new database with nobody in it, and this API only
   * offers login — so without this there is no way in at all. The seed script
   * is not an answer: it writes demo salons and a password published in this
   * repository.
   *
   * Two locks, checked in canBootstrap(): BOOTSTRAP_TOKEN must be set and
   * presented, and the database must contain zero users. The second one closes
   * the door permanently the moment this succeeds — a fact about the data, not
   * a flag anyone has to remember to turn off — which is what makes it safe to
   * leave this endpoint in the code.
   */
  async bootstrapSuperAdmin(input: {
    email: string; password: string; token: string; firstName: string; lastName: string;
  }) {
    const userCount = await this.prisma.user.count();
    const verdict = canBootstrap({
      userCount,
      expectedToken: this.config.get<string>('BOOTSTRAP_TOKEN'),
      givenToken: input.token,
    });
    if (!verdict.allowed) {
      // Deliberately vague to a caller who should not be here: a wrong token
      // and an already-claimed system look the same from outside.
      if (verdict.reason === 'already-set-up') {
        throw new ForbiddenException('This system already has an account. Sign in instead.');
      }
      throw new ForbiddenException('Setup is not available.');
    }

    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException(problem);

    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashSecret(input.password),
        role: UserRole.SUPER_ADMIN,
        firstName: input.firstName.trim() || 'Lumio',
        lastName: input.lastName.trim() || 'Admin',
        tenantId: null,
      },
      select: { id: true, email: true },
    });
    return { created: true, email: user.email };
  }

  /**
   * Validates credentials and issues an access token. The token carries the
   * user's tenantId so all downstream tenant scoping is derived from a signed,
   * tamper-proof source rather than client input.
   */
  async login(email: string, password: string) {
    const wanted = String(email ?? '').trim().toLowerCase();
    let user = await this.prisma.user.findUnique({
      where: { email: wanted },
      include: { tenant: true },
    });
    // An account saved before every form trimmed and lower-cased its e-mail
    // ("Anna@Salon.com", or with a space pasted on the end) could never sign
    // in: the typed address was cleaned, the stored one was not. Match it the
    // same way, and only when exactly one account fits.
    if (!user && wanted) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(trim(email)) = ${wanted} LIMIT 2`.catch(() => [] as { id: string }[]);
      if (rows.length === 1) {
        user = await this.prisma.user.findUnique({ where: { id: rows[0].id }, include: { tenant: true } });
      }
    }

    // Generic message to avoid leaking which part failed. The server log says
    // which, so a "my client typed it right" ticket can be answered.
    if (!user) {
      this.log.warn(`login refused: no account for ${maskEmail(wanted)}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // The password as typed; failing that, without the spaces a phone or a
    // copy-paste puts around it.
    const raw = String(password ?? '');
    let passwordOk = await verifySecret(raw, user.passwordHash);
    if (!passwordOk && raw.trim() !== raw && raw.trim()) passwordOk = await verifySecret(raw.trim(), user.passwordHash);
    if (!passwordOk) {
      this.log.warn(`login refused: wrong password for ${maskEmail(wanted)}`);
      throw new UnauthorizedException('Invalid credentials');
    }
    // The right password on an account the salon turned off: say so — it is
    // the owner who can turn it back on, and "invalid credentials" sent
    // people to retype a password that was never the problem.
    if (!user.isActive) {
      this.log.warn(`login refused: account turned off for ${maskEmail(wanted)}`);
      throw new UnauthorizedException('This login has been turned off. Ask the salon owner to turn it back on.');
    }

    // Access control (super admin has no tenant). Free salons always pass.
    if (user.tenant && !user.tenant.billingExempt) {
      const t = user.tenant;
      if (t.status !== TenantStatus.ACTIVE) {
        if (t.status === TenantStatus.PENDING) {
          throw new UnauthorizedException('Your account is awaiting payment. Please complete checkout to activate it.');
        }
        throw new UnauthorizedException('This salon account is not active. Please contact support.');
      }
      // Hard expiry set by the platform admin.
      if (t.accessUntil && new Date(t.accessUntil).getTime() < Date.now()) {
        throw new UnauthorizedException('Your access period has ended. Please renew to continue.');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // A STAFF login carries its feature-permission sub-role (cashier/tech/manager).
    let staffRole: StaffRole | null = null;
    // …and, when the owner adjusted this person, their own list of screens.
    let staffCaps: string[] | undefined;
    if (user.role === UserRole.STAFF) {
      const sm = await this.prisma.staffMember.findFirst({ where: { userId: user.id }, select: { staffRole: true, permissions: true } as never }) as { staffRole: StaffRole | null; permissions?: unknown } | null;
      staffRole = sm?.staffRole ?? null;
      staffCaps = cleanStaffCaps(sm?.permissions) ?? undefined;
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      staffRole,
      ...(staffCaps ? { staffCaps } : {}),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        firstName: user.firstName,
        lastName: user.lastName,
        staffRole,
        capabilities: capabilitiesFor(user.role, staffRole, staffCaps),
      },
    };
  }

  /**
   * "Đổi mật khẩu" — anyone signed in changes their OWN password, proving the
   * current one. Support sessions cannot (they are not the account's owner).
   */
  /** Whether I may approve refunds / voids, and whether my PIN is set. */
  async approvalPinStatus(user: { userId: string; role: UserRole; staffRole?: StaffRole | null; staffCaps?: unknown }) {
    const row = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { approvalPinHash: true } as never }) as { approvalPinHash?: string | null } | null;
    return { canApprove: hasCapability(user.role, user.staffRole ?? null, 'pos.void', user.staffCaps), set: !!row?.approvalPinHash };
  }

  /**
   * Set (or clear, pin = '') my approval PIN. Only someone who may refund and
   * void may have one; my password proves it is me. Two approvers of one
   * salon may not share a PIN — the till would not know whose it was.
   */
  async setApprovalPin(user: { userId: string; tenantId?: string | null; role: UserRole; staffRole?: StaffRole | null; staffCaps?: unknown; supportSession?: boolean }, currentPassword: string, pin: string) {
    if (user.supportSession) throw new UnauthorizedException('A support session cannot set a PIN.');
    if (!hasCapability(user.role, user.staffRole ?? null, 'pos.void', user.staffCaps)) throw new ForbiddenException('Only someone who may refund and void can have an approval PIN.');
    const row = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { id: true, passwordHash: true, isActive: true, tenantId: true } });
    if (!row || !row.isActive) throw new UnauthorizedException();
    if (!(await verifySecret(String(currentPassword ?? ''), row.passwordHash))) throw new BadRequestException('The current password is not right.');
    const clean = String(pin ?? '').trim();
    if (!clean) {
      await this.prisma.user.update({ where: { id: row.id }, data: { approvalPinHash: null } as never });
      return { ok: true, set: false };
    }
    if (!/^\d{4,6}$/.test(clean)) throw new BadRequestException('The PIN is 4 to 6 digits.');
    if (row.tenantId) {
      const others = await this.prisma.user.findMany({ where: { tenantId: row.tenantId, id: { not: row.id }, approvalPinHash: { not: null } } as never, select: { approvalPinHash: true } as never }) as { approvalPinHash: string }[];
      for (const o of others) if (await verifySecret(clean, o.approvalPinHash)) throw new BadRequestException('Someone else in this salon uses that PIN — pick another.');
    }
    await this.prisma.user.update({ where: { id: row.id }, data: { approvalPinHash: await hashSecret(clean) } as never });
    return { ok: true, set: true };
  }

  async changeOwnPassword(user: { userId: string; supportSession?: boolean }, current: string, next: string) {
    if (user.supportSession) throw new UnauthorizedException('A support session cannot change this password.');
    if (typeof next !== 'string' || next.length < 8) throw new BadRequestException('The new password must be at least 8 characters.');
    if (next === current) throw new BadRequestException('The new password must be different.');
    const row = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { id: true, passwordHash: true, isActive: true } });
    if (!row || !row.isActive) throw new UnauthorizedException();
    if (!(await verifySecret(String(current ?? ''), row.passwordHash))) throw new BadRequestException('The current password is not right.');
    await this.prisma.user.update({ where: { id: row.id }, data: { passwordHash: await hashSecret(next) } });
    return { ok: true };
  }
}

/** "an***@salon.com" — enough to find the account in a log, not enough to read it. */
export function maskEmail(e: string): string {
  const [name, domain] = String(e ?? '').split('@');
  if (!domain) return '(no e-mail)';
  return `${name.slice(0, 2)}***@${domain}`;
}
