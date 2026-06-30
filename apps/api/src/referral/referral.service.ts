import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { referralBookingUrl } from '../common/public-url.util';
import {
  REFERRAL_SETTINGS_KEY,
  ReferralSettings,
  DEFAULT_REFERRAL_SETTINGS,
  buildReferralCode,
} from './referral.constants';

type Db = Prisma.TransactionClient;

@Injectable()
export class ReferralService {
  private readonly logger = new Logger('Referral');

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
  ) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  async getForTenant(tenantId: string): Promise<ReferralSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: REFERRAL_SETTINGS_KEY } } });
    return { ...DEFAULT_REFERRAL_SETTINGS, ...((row?.value as Partial<ReferralSettings>) ?? {}) };
  }

  getSettings(user: AuthenticatedUser): Promise<ReferralSettings> {
    return this.getForTenant(this.tid(user));
  }

  async updateSettings(user: AuthenticatedUser, dto: Partial<ReferralSettings>): Promise<ReferralSettings> {
    const tenantId = this.tid(user);
    const cur = await this.getForTenant(tenantId);
    const posInt = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : d);
    const next: ReferralSettings = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      referrerPoints: posInt(dto.referrerPoints, cur.referrerPoints),
      refereePoints: posInt(dto.refereePoints, cur.refereePoints),
      message: typeof dto.message === 'string' ? dto.message : cur.message,
    };
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: REFERRAL_SETTINGS_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: REFERRAL_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** Total referred customers + how many have triggered a reward (last lifetime). */
  async getStats(user: AuthenticatedUser): Promise<{ totalReferred: number; rewarded: number }> {
    const tenantId = this.tid(user);
    const [totalReferred, rewarded] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId, referredById: { not: null } } }),
      this.prisma.customer.count({ where: { tenantId, referralRewardedAt: { not: null } } }),
    ]);
    return { totalReferred, rewarded };
  }

  /** Ensure a customer has a referral code, and return it with the shareable link. */
  async getCustomerLink(user: AuthenticatedUser, customerId: string): Promise<{ code: string; link: string }> {
    const tenantId = this.tid(user);
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, firstName: true, referralCode: true } });
    if (!c) throw new NotFoundException('Customer not found');
    let code = c.referralCode;
    if (!code) {
      code = await this.generateUniqueCode(tenantId, c.firstName);
      await this.prisma.customer.updateMany({ where: { id: customerId, tenantId }, data: { referralCode: code } });
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    const link = referralBookingUrl(tenant?.slug, code);
    return { code, link };
  }

  private async generateUniqueCode(tenantId: string, firstName: string | null): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = buildReferralCode(firstName);
      const exists = await this.prisma.customer.findFirst({ where: { tenantId, referralCode: code }, select: { id: true } });
      if (!exists) return code;
    }
    return `REF${Date.now().toString(36).toUpperCase()}`;
  }

  /**
   * Resolve a referral code to the referrer's customer id (within the caller's
   * transaction), only when the program is enabled. Returns null if invalid/off.
   */
  async resolveReferrerId(db: Db, tenantId: string, code: string | null | undefined): Promise<string | null> {
    if (!code) return null;
    const s = await this.getForTenant(tenantId);
    if (!s.enabled) return null;
    const ref = await db.customer.findFirst({ where: { tenantId, referralCode: code.trim() }, select: { id: true } });
    return ref?.id ?? null;
  }

  /**
   * Reward a referral when the referred customer completes their first visit.
   * Idempotent: only fires once per referred customer (guarded by referralRewardedAt).
   * Fire-and-forget — never throws to the caller.
   */
  async rewardOnCompletion(tenantId: string, refereeCustomerId: string | null | undefined, appointmentId: string): Promise<void> {
    if (!refereeCustomerId) return;
    try {
      const s = await this.getForTenant(tenantId);
      if (!s.enabled) return;
      const referee = await this.prisma.customer.findFirst({
        where: { id: refereeCustomerId, tenantId },
        select: { referredById: true, referralRewardedAt: true },
      });
      if (!referee?.referredById || referee.referralRewardedAt) return;
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction so concurrent completes can't double-reward.
        const fresh = await tx.customer.findFirst({ where: { id: refereeCustomerId, tenantId }, select: { referredById: true, referralRewardedAt: true } });
        if (!fresh?.referredById || fresh.referralRewardedAt) return;
        await tx.customer.update({ where: { id: refereeCustomerId }, data: { referralRewardedAt: new Date() } });
        if (s.referrerPoints > 0) await this.loyalty.credit(tx, tenantId, fresh.referredById, s.referrerPoints, 'Referral reward', 'referral', appointmentId);
        if (s.refereePoints > 0) await this.loyalty.credit(tx, tenantId, refereeCustomerId, s.refereePoints, 'Referral welcome bonus', 'referral', appointmentId);
      });
    } catch (e) {
      this.logger.warn(`Referral reward failed for customer ${refereeCustomerId}: ${(e as Error).message}`);
    }
  }
}
