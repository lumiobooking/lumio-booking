import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Which Lumio service package a salon is on — so whoever opens the agency
 * list sees at a glance who pays for the most care and looks after them first.
 *
 * A label the team keeps, stored per salon in a Setting row (like the work
 * stage). It bills nobody and locks nothing; the platform's own subscription
 * (Tenant plan / billing) is separate.
 *
 * `tier` is the care priority the list colours by: 4 = the biggest packages.
 * Prices are the published monthly prices (USD), shown on the pill.
 */

export const SERVICE_PACKAGE_KEY = 'service_package';

export interface ServicePackage {
  key: string;
  name: string;
  /** 'social' = Social Care / Boost / Growth / Scale line, 'maps' = Map line. */
  family: 'social' | 'maps';
  priceUsd: number;
  tier: 1 | 2 | 3 | 4;
}

export const SERVICE_PACKAGES: readonly ServicePackage[] = [
  { key: 'social_care',    name: 'Social Care',    family: 'social', priceUsd: 45,  tier: 1 },
  { key: 'boost',          name: 'Boost',          family: 'social', priceUsd: 179, tier: 2 },
  { key: 'growth_map',     name: 'Growth (Map)',   family: 'social', priceUsd: 279, tier: 3 },
  { key: 'scale',          name: 'Scale',          family: 'social', priceUsd: 379, tier: 4 },
  { key: 'map_foundation', name: 'Map Foundation', family: 'maps',   priceUsd: 179, tier: 2 },
  { key: 'map_growth',     name: 'Map Growth',     family: 'maps',   priceUsd: 279, tier: 3 },
  { key: 'map_authority',  name: 'Map Authority',  family: 'maps',   priceUsd: 479, tier: 4 },
];

/** '' clears it (no package recorded). */
export function isServicePackage(v: unknown): v is string {
  return v === '' || (typeof v === 'string' && SERVICE_PACKAGES.some((p) => p.key === v));
}

/** The stored value, read safely: anything unreadable is "no package". */
export function servicePackageOf(stored: unknown): string {
  const v = stored && typeof stored === 'object' ? (stored as { pkg?: unknown }).pkg : null;
  return typeof v === 'string' && SERVICE_PACKAGES.some((p) => p.key === v) ? v : '';
}

/** The slice of Prisma the setter needs — so it can be tested without the whole support module. */
interface PackageStore {
  tenant: { findFirst: (a: { where: { id: string; deletedAt: null }; select: { id: true } }) => Promise<{ id: string } | null> };
  setting: { upsert: (a: unknown) => Promise<unknown> };
  auditLog: { create: (a: unknown) => Promise<unknown> };
}

/**
 * Record which package a salon is on. Any support account may (it is a
 * care-priority label, not a bill); the write lands on that one salon's own
 * Setting row and is audited, so "who moved this shop to Scale" has an answer.
 */
export async function setServicePackage(
  prisma: PackageStore,
  user: { userId?: string | null; email?: string | null },
  tenantId: string,
  pkg: unknown,
): Promise<{ ok: true; servicePackage: string }> {
  if (!isServicePackage(pkg)) {
    throw new BadRequestException(`package phải là một trong: ${SERVICE_PACKAGES.map((p) => p.key).join(' | ')} (hoặc rỗng)`);
  }
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }).catch(() => null);
  if (!tenant) throw new NotFoundException('Salon not found');
  const value = { pkg, at: new Date().toISOString(), by: user.email ?? null };
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: SERVICE_PACKAGE_KEY } },
    create: { tenantId, key: SERVICE_PACKAGE_KEY, value },
    update: { value },
  });
  await prisma.auditLog.create({
    data: { tenantId, userId: user.userId ?? null, action: 'support.service_package_set', resourceType: 'tenant', resourceId: tenantId, metadata: { pkg, by: user.email ?? null } },
  }).catch(() => undefined);
  return { ok: true, servicePackage: pkg };
}
