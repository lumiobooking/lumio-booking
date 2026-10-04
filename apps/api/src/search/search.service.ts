import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { Capability, capabilitiesFor } from '../auth/capabilities';
import { capsFor, levelOf } from '../support/support-scope';

/**
 * The header's one search box (Ctrl+K): customers, bookings, services, bills.
 *
 * Every query is pinned to the caller's tenant — the id comes from the token,
 * never from the request — and each kind of result is offered only to someone
 * whose role may open that screen anyway. A receptionist finds clients and
 * bookings; a support account at "content" level finds neither; a technician
 * (no salon-admin capabilities) finds nothing.
 */
export interface SearchResults {
  customers: { id: string; name: string; phone: string | null; email: string | null }[];
  appointments: { id: string; startTime: Date; status: string; customer: string; service: string | null }[];
  services: { id: string; name: string; priceCents: number; durationMinutes: number }[];
  orders: { id: string; orderNumber: number; status: string; totalCents: number; createdAt: Date }[];
}

const EMPTY: SearchResults = { customers: [], appointments: [], services: [], orders: [] };

/** What this caller may see — the same answer the guards give. */
export function searchCaps(user: AuthenticatedUser): Set<Capability> {
  if (user.supportSession) return new Set(capsFor(levelOf(user.supportLevel), user.supportCaps));
  return new Set(capabilitiesFor(user.role, user.staffRole, user.staffCaps));
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthenticatedUser, raw: unknown): Promise<SearchResults> {
    const tenantId = user.role === UserRole.SUPER_ADMIN ? null : user.tenantId;
    const q = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!tenantId || q.length < 2) return EMPTY;

    const caps = searchCaps(user);
    const any = (...c: Capability[]) => c.some((x) => caps.has(x));
    const digits = q.replace(/\D/g, '');
    const words = q.split(' ').filter(Boolean);
    const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

    // A person: by either name, "first last", email, or 3+ digits of the phone.
    const personOr: Record<string, unknown>[] = [
      { firstName: ci(q) }, { lastName: ci(q) }, { email: ci(q) }, { phone: ci(q) },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ...(words.length >= 2 ? [{ AND: [{ firstName: ci(words[0]) }, { lastName: ci(words.slice(1).join(' ')) }] }] : []),
    ];

    const orderNo = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null;
    const since = new Date(Date.now() - 60 * 86_400_000);

    const [customers, appointments, services, orders] = await Promise.all([
      any('customers', 'bookings', 'walkins', 'pos')
        ? this.prisma.customer.findMany({
            where: { tenantId, OR: personOr } as never,
            select: { id: true, firstName: true, lastName: true, phone: true, email: true },
            orderBy: { createdAt: 'desc' },
            take: 6,
          })
        : [],
      any('bookings', 'calendar')
        ? this.prisma.appointment.findMany({
            where: {
              tenantId,
              startTime: { gte: since },
              OR: [{ customer: { OR: personOr } }, { service: { name: ci(q) } }],
            } as never,
            select: { id: true, startTime: true, status: true, customer: { select: { firstName: true, lastName: true } }, service: { select: { name: true } } },
            orderBy: { startTime: 'desc' },
            take: 6,
          })
        : [],
      any('services', 'bookings', 'pos', 'walkins')
        ? this.prisma.service.findMany({
            where: { tenantId, isActive: true, name: ci(q) },
            select: { id: true, name: true, priceCents: true, durationMinutes: true },
            orderBy: { name: 'asc' },
            take: 5,
          })
        : [],
      any('orders', 'pos') && orderNo !== null
        ? this.prisma.order.findMany({
            where: { tenantId, orderNumber: orderNo },
            select: { id: true, orderNumber: true, status: true, totalCents: true, createdAt: true },
            take: 3,
          })
        : [],
    ]);

    const name = (c: { firstName: string; lastName: string | null } | null | undefined) => [c?.firstName, c?.lastName].filter(Boolean).join(' ');
    return {
      customers: (customers as Array<{ id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null }>)
        .map((c) => ({ id: c.id, name: name(c), phone: c.phone, email: c.email })),
      appointments: (appointments as Array<{ id: string; startTime: Date; status: string; customer: { firstName: string; lastName: string | null } | null; service: { name: string } | null }>)
        .map((a) => ({ id: a.id, startTime: a.startTime, status: String(a.status), customer: name(a.customer), service: a.service?.name ?? null })),
      services: services as SearchResults['services'],
      orders: (orders as Array<{ id: string; orderNumber: number; status: unknown; totalCents: number; createdAt: Date }>)
        .map((o) => ({ ...o, status: String(o.status) })),
    };
  }
}
