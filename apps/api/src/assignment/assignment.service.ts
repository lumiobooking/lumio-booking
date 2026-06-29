import { Injectable } from '@nestjs/common';
import { AppointmentStatus, RejectionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BLOCKING_STATUSES } from '../bookings/booking.util';
import {
  CandidateInput,
  DEFAULT_RULES,
  EngineRule,
  RankedCandidate,
  getLocalSlot,
  isWithinWorkingHours,
  noResponseWindowDays,
  rankCandidates,
  rejectionWindowDays,
} from './assignment.util';

/** Minimal appointment shape the engine needs to find a staff member. */
export interface AppointmentForAssignment {
  id: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  preferredStaffId: string | null;
}

export interface EligibilityResult {
  /** Staff ids ordered best-first. Empty when nobody qualifies. */
  orderedStaffIds: string[];
  /** Full ranking incl. excluded candidates, for auditing / debugging. */
  ranked: RankedCandidate[];
}

const ACTIVE_WORKLOAD_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.ASSIGNED,
  AppointmentStatus.ACCEPTED,
  AppointmentStatus.CONFIRMED,
];

/**
 * The staff assignment rule engine. Given an appointment it gathers every
 * eligible staff member (right skill, working at that time, free of overlap),
 * scores them with the tenant's configured AssignmentRule rows (or sensible
 * defaults), and returns them ordered best-first. It performs READS only; the
 * actual race-safe write is done by BookingsService inside a locked transaction.
 */
@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads the tenant's active rules, falling back to DEFAULT_RULES. */
  async loadRules(tenantId: string): Promise<EngineRule[]> {
    const rows = await this.prisma.assignmentRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: { priority: 'desc' },
    });
    if (rows.length === 0) return DEFAULT_RULES;
    return rows.map((r) => ({
      type: r.type,
      config: (r.config as Record<string, unknown>) ?? {},
      isActive: r.isActive,
      priority: r.priority,
    }));
  }

  /**
   * Ranks eligible staff for an appointment.
   * @param excludeStaffIds staff to hard-exclude (e.g. the one who just
   *        rejected, plus everyone already in this appointment's rejection log).
   */
  async rankEligibleStaff(
    tenantId: string,
    appt: AppointmentForAssignment,
    excludeStaffIds: string[] = [],
  ): Promise<EligibilityResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timeZone = tenant?.timezone ?? 'UTC';

    const rules = await this.loadRules(tenantId);
    const exclude = new Set(excludeStaffIds);

    // Candidate pool: active staff who can perform the service. Skills are an
    // optional restriction — if no technician is explicitly linked to this
    // service, every active technician is treated as able to perform it (mirrors
    // the public availability rule so an unconfigured service still gets assigned).
    const linkedCount = await this.prisma.staffMember.count({
      where: { tenantId, isActive: true, takesAppointments: true, staffServices: { some: { serviceId: appt.serviceId } } },
    });
    const staff = await this.prisma.staffMember.findMany({
      where: {
        tenantId,
        isActive: true,
        takesAppointments: true,
        ...(linkedCount > 0 ? { staffServices: { some: { serviceId: appt.serviceId } } } : {}),
        id: exclude.size ? { notIn: [...exclude] } : undefined,
      },
      include: { workingHours: true },
    });

    const durationMinutes = Math.round(
      (appt.endTime.getTime() - appt.startTime.getTime()) / 60_000,
    );
    const slot = getLocalSlot(appt.startTime, durationMinutes, timeZone);

    const rejWindow = rejectionWindowDays(rules);
    const noRespWindow = noResponseWindowDays(rules);
    const now = new Date();
    const rejSince = new Date(now.getTime() - rejWindow * 86_400_000);
    const noRespSince = new Date(now.getTime() - noRespWindow * 86_400_000);

    const candidates: CandidateInput[] = [];

    for (const s of staff) {
      // Hard filter 1: must be working at that local time.
      if (!isWithinWorkingHours(slot, s.workingHours)) continue;

      // Hard filter 2: must not already have a blocking overlapping booking.
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          tenantId,
          assignedStaffId: s.id,
          status: { in: BLOCKING_STATUSES },
          startTime: { lt: appt.endTime },
          endTime: { gt: appt.startTime },
          id: { not: appt.id },
        },
        select: { id: true },
      });
      if (conflict) continue;

      const [rejectionCount, noResponseCount, recentAssignmentCount] = await Promise.all([
        this.prisma.bookingRejection.count({
          where: {
            tenantId,
            staffMemberId: s.id,
            type: RejectionType.REJECTED,
            createdAt: { gte: rejSince },
          },
        }),
        this.prisma.bookingRejection.count({
          where: {
            tenantId,
            staffMemberId: s.id,
            type: RejectionType.NO_RESPONSE,
            createdAt: { gte: noRespSince },
          },
        }),
        this.prisma.appointment.count({
          where: {
            tenantId,
            assignedStaffId: s.id,
            status: { in: ACTIVE_WORKLOAD_STATUSES },
            startTime: { gte: now },
          },
        }),
      ]);

      candidates.push({
        staffId: s.id,
        performanceScore: s.performanceScore,
        isPreferred: appt.preferredStaffId === s.id,
        rejectionCount,
        noResponseCount,
        recentAssignmentCount,
      });
    }

    const ranked = rankCandidates(candidates, rules);
    return {
      orderedStaffIds: ranked.filter((r) => !r.excluded).map((r) => r.staffId),
      ranked,
    };
  }
}
