import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { FEATURE_DEFS, PolicyMode } from './feature-policy.constants';

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

  /** Merge stored overrides over each feature's built-in default. */
  async resolve(tenantId: string): Promise<Record<string, PolicyMode>> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { featurePolicy: true } });
    const raw = t?.featurePolicy;
    const stored = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, PolicyMode> = {};
    for (const f of FEATURE_DEFS) {
      const v = stored[f.key];
      out[f.key] = v === 'platform' ? 'platform' : v === 'salon' ? 'salon' : f.default;
    }
    return out;
  }

  private defs() {
    return FEATURE_DEFS.map(({ key, label, hrefs }) => ({ key, label, hrefs }));
  }

  /** Salon-side: the resolved policy so the UI can hide platform-managed items. */
  async getForSalon(user: AuthenticatedUser) {
    return { policy: await this.resolve(this.tid(user)), defs: this.defs() };
  }

  /** Super Admin: view a tenant's policy + the feature catalog. */
  async getForTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new NotFoundException('Tenant not found');
    return { policy: await this.resolve(tenantId), defs: this.defs() };
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
