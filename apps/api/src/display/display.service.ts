import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { displayBaseUrl, displayPairUrl } from '../common/public-url.util';

// Server-only split used to attribute the after-payment QR tip across the ticket's
// technician(s). Never exposed to the paired device.
type TechSplit = { staffMemberId: string; weightCents: number };
interface PayTicket {
  ref: string;
  baseCents: number;
  techs: TechSplit[];
}

@Injectable()
export class DisplayService {
  private readonly logger = new Logger('Display');

  constructor(private readonly prisma: PrismaService) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  // Long, unguessable secret the paired device uses to poll + post tips.
  private newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  // Short, human-friendly code shown on the register to link a device once.
  // Excludes easily-confused characters (0/O, 1/I).
  private newPairCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    return code;
  }

  private info(s: { pairCode: string }) {
    return { pairCode: s.pairCode, pairUrl: displayPairUrl(s.pairCode), displayUrl: displayBaseUrl() };
  }

  /** Register: fetch (or lazily create) this salon's pairing info. */
  async getSession(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    const s = (await this.prisma.displaySession.findUnique({ where: { tenantId } })) ?? (await this.createSession(tenantId));
    return this.info(s);
  }

  /** Register: revoke the current link (old token/code stop working) and issue a new one. */
  async rotate(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    await this.prisma.displaySession.deleteMany({ where: { tenantId } });
    return this.info(await this.createSession(tenantId));
  }

  private async createSession(tenantId: string) {
    for (let i = 0; i < 6; i++) {
      try {
        return await this.prisma.displaySession.create({
          data: { tenantId, token: this.newToken(), pairCode: this.newPairCode() },
        });
      } catch (e) {
        // A concurrent create (same tenant) or a rare token/code clash — return the
        // existing row if present, else retry with fresh values.
        const existing = await this.prisma.displaySession.findUnique({ where: { tenantId } });
        if (existing) return existing;
        if (i === 5) throw e;
      }
    }
    throw new Error('Could not create display session');
  }

  /**
   * Register: store the latest display state. Tenant comes from the JWT — never the
   * client — so one salon can only ever write its own display. `payTicket` is kept
   * ONLY while a ticket is in the paid state, so a stray tip can't attach to nothing.
   */
  async pushState(user: AuthenticatedUser, state: Record<string, unknown>, payTicket?: Record<string, unknown>) {
    const tenantId = this.tid(user);
    const exists = await this.prisma.displaySession.findUnique({ where: { tenantId }, select: { id: true } });
    if (!exists) await this.createSession(tenantId);
    const isPaid = (state?.status as string | undefined) === 'paid';
    await this.prisma.displaySession.update({
      where: { tenantId },
      data: {
        state: state as unknown as Prisma.InputJsonValue,
        payTicket: isPaid && payTicket ? (payTicket as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    return { ok: true };
  }

  /** Public: exchange a short pairing code for the long polling token. */
  async pair(pairCode: string) {
    const code = (pairCode || '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Missing code');
    const s = await this.prisma.displaySession.findUnique({ where: { pairCode: code }, select: { token: true } });
    if (!s) throw new NotFoundException('That code is not valid. Check the register and try again.');
    return { token: s.token };
  }

  /** Public: the paired device polls the current customer-facing state (no secrets). */
  async stateByToken(token: string) {
    const s = await this.prisma.displaySession.findUnique({ where: { token }, select: { state: true, updatedAt: true } });
    if (!s) throw new NotFoundException('This screen is not linked. Re-pair it from the register.');
    return { state: s.state ?? null, at: s.updatedAt };
  }

  /**
   * Public: record an after-payment QR tip the customer chose on the paired device.
   * The tip goes straight to the tech (they scan the QR with their phone) — this only
   * LOGS it for payroll visibility. Tenant + techs come from the server-side pay ticket
   * (never the client), and it is idempotent per paid ticket so a re-tap can't double it.
   */
  async recordTip(token: string, amountCents: number) {
    const amount = Math.round(amountCents);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Invalid tip amount');
    const s = await this.prisma.displaySession.findUnique({ where: { token } });
    if (!s) throw new NotFoundException('This screen is not linked.');
    const pt = (s.payTicket as unknown as PayTicket | null) || null;
    if (!pt || !Array.isArray(pt.techs) || pt.techs.length === 0) return { ok: true, recorded: false };
    if (s.lastTipRef === pt.ref) return { ok: true, recorded: false };
    // Atomically claim this ticket ref so two quick taps record the tip only once.
    const claim = await this.prisma.displaySession.updateMany({
      where: { token, NOT: { lastTipRef: pt.ref } },
      data: { lastTipRef: pt.ref },
    });
    if (claim.count === 0) return { ok: true, recorded: false };

    const techs = pt.techs.filter((t) => t && t.staffMemberId);
    const totalW = techs.reduce((sum, t) => sum + Math.max(0, t.weightCents || 0), 0);
    let assigned = 0;
    for (let i = 0; i < techs.length; i++) {
      const last = i === techs.length - 1;
      const share = last
        ? Math.max(0, amount - assigned)
        : totalW > 0
          ? Math.round((amount * Math.max(0, techs[i].weightCents || 0)) / totalW)
          : Math.round(amount / techs.length);
      assigned += share;
      if (share <= 0) continue;
      // Defense in depth: the tech must belong to THIS session's tenant.
      const tech = await this.prisma.staffMember.findFirst({
        where: { id: techs[i].staffMemberId, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!tech) continue;
      try {
        await this.prisma.tipLog.create({
          data: { tenantId: s.tenantId, staffMemberId: techs[i].staffMemberId, amountCents: share, method: 'QR' },
        });
      } catch (e) {
        this.logger.warn(`Display tip log failed: ${(e as Error).message}`);
      }
    }
    return { ok: true, recorded: true };
  }
}
