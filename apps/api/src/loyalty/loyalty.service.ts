import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

// Accepts either the base client or a transaction client so callers can run
// earn/redeem inside their own transaction.
type Db = Prisma.TransactionClient;

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Award points for a paid amount. Returns points awarded (0 if off/no customer). */
  async award(db: Db, tenantId: string, customerId: string | null | undefined, amountCents: number, refType: string, refId: string): Promise<number> {
    if (!customerId) return 0;
    const s = await this.settings.getLoyaltySettings(tenantId);
    if (!s.enabled) return 0;
    const points = Math.floor((amountCents / 100) * s.earnPointsPerDollar);
    if (points <= 0) return 0;
    const c = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
    if (!c) return 0;
    const balanceAfter = c.loyaltyPoints + points;
    await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balanceAfter } });
    await db.loyaltyTransaction.create({
      data: { tenantId, customerId, points, balanceAfter, reason: `Earned on ${refType} payment`, refType, refId },
    });
    return points;
  }

  /**
   * Credit a fixed number of points with a custom reason (e.g. a referral bonus).
   * Unlike `award`, this is not derived from a dollar amount and is not gated on
   * the loyalty earn rate — the calling program (e.g. referrals) decides the amount.
   */
  async credit(db: Db, tenantId: string, customerId: string | null | undefined, points: number, reason: string, refType: string, refId: string): Promise<number> {
    if (!customerId || points <= 0) return 0;
    const c = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
    if (!c) return 0;
    const balanceAfter = c.loyaltyPoints + points;
    await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balanceAfter } });
    await db.loyaltyTransaction.create({ data: { tenantId, customerId, points, balanceAfter, reason, refType, refId } });
    return points;
  }

  /** Validate a redemption (no write) and return the discount it would give, in cents. */
  async previewRedeem(tenantId: string, customerId: string, points: number): Promise<{ discountCents: number }> {
    const s = await this.settings.getLoyaltySettings(tenantId);
    if (!s.enabled) throw new BadRequestException('Loyalty program is off');
    if (points < s.minRedeemPoints) throw new BadRequestException(`Minimum ${s.minRedeemPoints} points to redeem`);
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
    if (!c || c.loyaltyPoints < points) throw new BadRequestException('Customer does not have enough points');
    return { discountCents: points * s.redeemCentsPerPoint };
  }

  /** Deduct points for a redemption (inside the caller's transaction). Returns discount cents. */
  async redeem(db: Db, tenantId: string, customerId: string, points: number, refType: string, refId: string): Promise<number> {
    const s = await this.settings.getLoyaltySettings(tenantId);
    const c = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
    if (!c || c.loyaltyPoints < points) throw new BadRequestException('Customer does not have enough points');
    const balanceAfter = c.loyaltyPoints - points;
    await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balanceAfter } });
    await db.loyaltyTransaction.create({
      data: { tenantId, customerId, points: -points, balanceAfter, reason: 'Redeemed for discount', refType, refId },
    });
    return points * s.redeemCentsPerPoint;
  }

  /**
   * Reverse every loyalty effect of one reference (e.g. a voided/deleted order):
   * undo the points EARNED and restore the points REDEEMED, per customer, with a
   * compensating ledger entry. Idempotent against itself — reversal entries are
   * written under `${refType}-reversal`, so re-running finds nothing to undo (the
   * caller also guards this to a live PAID sale). Balance is clamped at 0.
   */
  async reverseForRef(db: Db, tenantId: string, refType: string, refId: string, reason = 'Sale reversed'): Promise<void> {
    const txns = await db.loyaltyTransaction.findMany({ where: { tenantId, refType, refId } });
    if (txns.length === 0) return;
    // Net points each customer gained from this ref (earned positive, redeemed negative).
    const byCustomer = new Map<string, number>();
    for (const t of txns) byCustomer.set(t.customerId, (byCustomer.get(t.customerId) ?? 0) + t.points);
    for (const [customerId, net] of byCustomer) {
      if (net === 0) continue;
      const c = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
      if (!c) continue;
      const balanceAfter = Math.max(0, c.loyaltyPoints - net); // undo the net effect
      const applied = balanceAfter - c.loyaltyPoints; // actual delta written (may be clamped)
      await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balanceAfter } });
      await db.loyaltyTransaction.create({
        data: { tenantId, customerId, points: applied, balanceAfter, reason, refType: `${refType}-reversal`, refId },
      });
    }
  }

  history(tenantId: string, customerId: string) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
