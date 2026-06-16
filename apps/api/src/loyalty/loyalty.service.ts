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

  history(tenantId: string, customerId: string) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
