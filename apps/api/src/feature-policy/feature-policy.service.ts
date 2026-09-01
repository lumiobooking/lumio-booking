import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { FEATURE_DEFS, PolicyMode, resolvePolicy } from './feature-policy.constants';
import { featureAvailableInMarket, marketOf } from '../common/markets';

/**
 * Resolves and enforces the per-tenant feature access policy. A feature set to
 * 'platform' is hidden from the salon and blocked from salon edits at the API.
 */
@Injectable()
export class FeaturePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /**
   * Merge stored overrides over each feature's built-in default, then take away
   * anything the salon's market does not have.
   *
   * The market check is last and cannot be outvoted. A Vietnamese salon has no
   * US phone number for the hotline and no North American card terminal, so
   * those screens are not shown even if someone ticked the box — which is the
   * point: it makes the mistake unmakeable rather than merely unlikely.
   */
  async resolve(tenantId: string): Promise<Record<string, PolicyMode>> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { featurePolicy: true, market: true } });
    const raw = t?.featurePolicy;
    const stored = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
    return resolvePolicy(stored, (key) => featureAvailableInMarket(t?.market, key));
  }

  private defs(market?: string | null) {
    // `unavailable` is what lets the Super Admin screen grey a row out instead
    // of offering a sale that cannot be delivered.
    return FEATURE_DEFS.map(({ key, label, hrefs }) => ({
      key, label, hrefs, unavailable: !featureAvailableInMarket(market, key),
    }));
  }

  /** Salon-side: the resolved policy so the UI can hide platform-managed items. */
  async getForSalon(user: AuthenticatedUser) {
    // A Lumio SUPPORT session is here to configure the locked screens, so the
    // menu must not hide them. Purely presentational: the guard above already
    // lets these sessions write.
    const tenantId = this.tid(user);
    const market = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } }))?.market;
    if (user.supportSession) {
      // Support opens the locked screens to configure them — but not screens
      // for hardware and phone numbers that do not exist in this market.
      const open = Object.fromEntries(
        FEATURE_DEFS.map((d) => [d.key, featureAvailableInMarket(market, d.key) ? ('salon' as const) : ('platform' as const)]),
      );
      return { policy: open, defs: this.defs(market) };
    }
    return { policy: await this.resolve(tenantId), defs: this.defs(market) };
  }

  /** Super Admin: view a tenant's policy + the feature catalog. */
  async getForTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, market: true } });
    if (!t) throw new NotFoundException('Tenant not found');
    return { policy: await this.resolve(tenantId), defs: this.defs(t.market), market: marketOf(t.market).code };
  }

  /** Super Admin: set overrides. Only known keys + valid modes are stored. */
  async setForTenant(tenantId: string, overrides: Record<string, unknown>) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new NotFoundException('Tenant not found');
    const clean: Record<string, PolicyMode> = {};
    for (const f of FEATURE_DEFS) {
      const v = overrides?.[f.key];
      if (v === 'platform' || v === 'salon') clean[f.key] = v;
    }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { featurePolicy: clean as unknown as Prisma.InputJsonValue } });
    try { await this.prisma.auditLog.create({ data: { tenantId, action: 'feature_policy.updated', resourceType: 'tenant' } }); } catch { /* never break */ }
    return this.getForTenant(tenantId);
  }

  /** Throws 403 if this feature is platform-managed for the tenant. */
  async assertSalonManaged(tenantId: string, key: string): Promise<void> {
    const policy = await this.resolve(tenantId);
    if (policy[key] === 'platform') {
      throw new ForbiddenException('This setting is managed by Lumio and cannot be changed here.');
    }
  }
}
