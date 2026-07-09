import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { IssueGiftCardDto, AdjustGiftCardDto } from './dto/gift-card.dto';

/**
 * Gift cards belong to exactly one tenant; codes are unique within the tenant.
 * Every query is scoped by tenantId so one salon can never see, redeem or void
 * another salon's cards. Balance changes always write a GiftCardTransaction so
 * there is a full audit trail.
 *
 * Revenue model (cash-basis, no double-counting):
 *  - Selling a card records a PAID Payment (provider pos-cash/card/transfer) →
 *    counted in dashboard/chain revenue at sale time.
 *  - Redeeming a card at the POS is NOT new revenue (handled in PosService: the
 *    Payment mirror excludes the gift-card-applied portion).
 */
@Injectable()
export class GiftCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  // Unambiguous alphabet (no 0/O/1/I) so codes are easy to read off a card.
  private randomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += alphabet[randomInt(alphabet.length)];
    return `GC${s}`;
  }

  private async uniqueCode(tenantId: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = this.randomCode();
      const exists = await this.prisma.giftCard.findFirst({ where: { tenantId, code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not generate a unique code, please try again');
  }

  list(user: AuthenticatedUser, status?: string) {
    const tenantId = this.tenantId(user);
    const where: Prisma.GiftCardWhereInput = { tenantId };
    if (status === 'ACTIVE' || status === 'REDEEMED' || status === 'VOID') where.status = status;
    return this.prisma.giftCard.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  /** Look up a card by code (balance check / before redeeming). Tenant-scoped. */
  async lookup(user: AuthenticatedUser, code: string) {
    const tenantId = this.tenantId(user);
    const card = await this.prisma.giftCard.findFirst({
      where: { tenantId, code: this.normalize(code) },
    });
    if (!card) throw new NotFoundException('Gift card not found');
    return card;
  }

  /** Issue (sell) a gift card. Records the sale as revenue unless recordSale=false. */
  async issue(user: AuthenticatedUser, dto: IssueGiftCardDto) {
    const tenantId = this.tenantId(user);
    const amount = Math.round(dto.amountCents);
    if (amount <= 0) throw new BadRequestException('Amount must be greater than 0');

    let code = dto.code ? this.normalize(dto.code) : '';
    if (code) {
      const exists = await this.prisma.giftCard.findFirst({ where: { tenantId, code }, select: { id: true } });
      if (exists) throw new ConflictException('A gift card with this code already exists');
    } else {
      code = await this.uniqueCode(tenantId);
    }

    const rules = await this.settings.getBookingRules(tenantId);
    const currency = rules.currency || 'USD';
    const recordSale = dto.recordSale !== false;
    const method = dto.paymentMethod;
    const provider = method === 'CASH' ? 'pos-cash' : method === 'CARD' ? 'pos-card' : 'pos-transfer';

    const card = await this.prisma.$transaction(async (tx) => {
      const c = await tx.giftCard.create({
        data: {
          tenantId,
          code,
          initialCents: amount,
          balanceCents: amount,
          currency,
          purchaserName: dto.purchaserName?.trim() || null,
          recipientName: dto.recipientName?.trim() || null,
          recipientContact: dto.recipientContact?.trim() || null,
          note: dto.note?.trim() || null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdByUserId: user.userId,
        },
      });
      await tx.giftCardTransaction.create({
        data: { tenantId, giftCardId: c.id, kind: 'ISSUE', amountCents: amount, createdByUserId: user.userId },
      });
      if (recordSale) {
        // Mirror into the Payment ledger so the sale shows in dashboard revenue.
        await tx.payment.create({
          data: {
            tenantId,
            amountCents: amount,
            currency,
            type: PaymentType.PAY_LATER,
            status: PaymentStatus.PAID,
            provider,
            providerReference: `giftcard:${c.id}`,
            paidAt: new Date(),
          },
        });
      }
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'giftcard.issued',
      resourceType: 'gift_card',
      resourceId: card.id,
      metadata: { code, amountCents: amount, recordSale },
    });
    return card;
  }

  /** Cancel a card: zeroes the balance, marks VOID. Does not refund money taken. */
  async void(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const card = await this.prisma.giftCard.findFirst({ where: { id, tenantId } });
    if (!card) throw new NotFoundException('Gift card not found');
    if (card.status === 'VOID') return card;

    await this.prisma.$transaction(async (tx) => {
      await tx.giftCard.updateMany({ where: { id, tenantId }, data: { status: 'VOID', balanceCents: 0 } });
      if (card.balanceCents !== 0) {
        await tx.giftCardTransaction.create({
          data: { tenantId, giftCardId: id, kind: 'VOID', amountCents: -card.balanceCents, createdByUserId: user.userId },
        });
      }
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'giftcard.voided', resourceType: 'gift_card', resourceId: id });
    return this.prisma.giftCard.findFirst({ where: { id, tenantId } });
  }

  /** Manual top-up / correction. */
  async adjust(user: AuthenticatedUser, id: string, dto: AdjustGiftCardDto) {
    const tenantId = this.tenantId(user);
    const card = await this.prisma.giftCard.findFirst({ where: { id, tenantId } });
    if (!card) throw new NotFoundException('Gift card not found');
    if (card.status === 'VOID') throw new BadRequestException('Cannot adjust a voided card');
    const delta = Math.round(dto.amountCents);
    if (!delta) throw new BadRequestException('Enter a non-zero amount');
    const newBalance = card.balanceCents + delta;
    if (newBalance < 0) throw new BadRequestException('Adjustment would make the balance negative');

    await this.prisma.$transaction(async (tx) => {
      await tx.giftCard.updateMany({
        where: { id, tenantId },
        data: { balanceCents: newBalance, status: newBalance <= 0 ? 'REDEEMED' : 'ACTIVE' },
      });
      await tx.giftCardTransaction.create({
        data: { tenantId, giftCardId: id, kind: 'ADJUST', amountCents: delta, createdByUserId: user.userId },
      });
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'giftcard.adjusted', resourceType: 'gift_card', resourceId: id, metadata: { delta } });
    return this.prisma.giftCard.findFirst({ where: { id, tenantId } });
  }

  /**
   * Read a card's redeemable balance (tenant-scoped) BEFORE an order is built, so
   * the POS can compute how much to apply. Returns 0 if not usable.
   */
  async redeemableBalance(tenantId: string, code: string): Promise<{ id: string; applicable: number; balanceCents: number } | null> {
    const card = await this.prisma.giftCard.findFirst({ where: { tenantId, code: this.normalize(code) } });
    if (!card) return null;
    if (card.status !== 'ACTIVE' || card.balanceCents <= 0) return { id: card.id, applicable: 0, balanceCents: card.balanceCents };
    if (card.expiresAt && card.expiresAt.getTime() < Date.now()) return { id: card.id, applicable: 0, balanceCents: card.balanceCents };
    return { id: card.id, applicable: card.balanceCents, balanceCents: card.balanceCents };
  }

  /**
   * Authoritative, race-safe deduction. Runs INSIDE the caller's POS order
   * transaction (tx). Returns the cents actually applied. Throws if the card is
   * not usable. The conditional decrement (balanceCents >= applied) prevents any
   * double-spend even under concurrent checkouts.
   */
  async redeemInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string,
    maxCents: number,
    orderId: string,
    userId?: string,
  ): Promise<number> {
    const card = await tx.giftCard.findFirst({ where: { tenantId, code: this.normalize(code) } });
    if (!card) throw new BadRequestException('Gift card not found');
    if (card.status !== 'ACTIVE' || card.balanceCents <= 0) throw new BadRequestException('Gift card has no balance');
    if (card.expiresAt && card.expiresAt.getTime() < Date.now()) throw new BadRequestException('Gift card has expired');

    const applied = Math.min(card.balanceCents, Math.max(0, Math.round(maxCents)));
    if (applied <= 0) return 0;
    const willBeZero = card.balanceCents - applied <= 0;

    const upd = await tx.giftCard.updateMany({
      where: { id: card.id, tenantId, status: 'ACTIVE', balanceCents: { gte: applied } },
      data: { balanceCents: { decrement: applied }, status: willBeZero ? 'REDEEMED' : 'ACTIVE' },
    });
    if (upd.count === 0) throw new BadRequestException('Gift card balance changed, please retry');

    await tx.giftCardTransaction.create({
      data: { tenantId, giftCardId: card.id, kind: 'REDEEM', amountCents: -applied, orderId, createdByUserId: userId ?? null },
    });
    return applied;
  }
}
