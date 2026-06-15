import { AssignmentRuleType } from '@prisma/client';

// ===========================================================================
// Pure helpers for the staff assignment rule engine. Everything in this file is
// deterministic and free of I/O so it can be unit-tested in isolation. The
// service layer (assignment.service.ts) gathers the data (candidates, rejection
// counts, working hours, ...) and feeds it into these functions.
// ===========================================================================

/** A weekly working-hours row, salon-local time ("09:00"–"17:30"). */
export interface WorkingHourLite {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  isActive: boolean;
}

/** The salon-local placement of one appointment. */
export interface LocalSlot {
  dayOfWeek: number; // 0..6 in the salon timezone
  startMinutes: number; // minutes from local midnight
  endMinutes: number; // minutes from local midnight
}

/** Parses "HH:mm" into minutes-from-midnight. Returns NaN on bad input. */
export function parseHmToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/**
 * Converts a UTC appointment into its salon-local day-of-week and minute range.
 * Uses Intl (available in Node) so we don't need a timezone library. Appointments
 * that cross local midnight are clamped to the start day (nail-salon slots are
 * short, so this is a safe simplification).
 */
export function getLocalSlot(start: Date, durationMinutes: number, timeZone: string): LocalSlot {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(start);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = dayMap[weekday] ?? 0;
  const startMinutes = hour * 60 + minute;
  return { dayOfWeek, startMinutes, endMinutes: startMinutes + durationMinutes };
}

/**
 * True iff the appointment slot fits fully inside one active working-hours block
 * on the same local day. Back-to-back is fine (block end may equal slot end).
 */
export function isWithinWorkingHours(slot: LocalSlot, hours: WorkingHourLite[]): boolean {
  return hours.some((h) => {
    if (!h.isActive || h.dayOfWeek !== slot.dayOfWeek) return false;
    const start = parseHmToMinutes(h.startTime);
    const end = parseHmToMinutes(h.endTime);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return start <= slot.startMinutes && slot.endMinutes <= end;
  });
}

// ---------------------------------------------------------------------------
// Candidate ranking
// ---------------------------------------------------------------------------

/** A rule as the engine consumes it (subset of the AssignmentRule row). */
export interface EngineRule {
  type: AssignmentRuleType;
  config: Record<string, unknown>;
  isActive: boolean;
  priority: number;
}

/** Per-candidate facts the service precomputes before ranking. */
export interface CandidateInput {
  staffId: string;
  performanceScore: number;
  isPreferred: boolean;
  rejectionCount: number; // rejections in the configured window
  noResponseCount: number; // no-responses in the configured window
  recentAssignmentCount: number; // active/upcoming bookings (fair distribution)
}

export interface RankedCandidate {
  staffId: string;
  score: number;
  excluded: boolean;
  reasons: string[];
}

/**
 * Sensible defaults used when a tenant has not configured any AssignmentRule
 * rows. Keeps the engine useful out of the box.
 */
export const DEFAULT_RULES: EngineRule[] = [
  { type: AssignmentRuleType.REJECTION_THRESHOLD, config: { maxRejections: 3, windowDays: 7 }, isActive: true, priority: 100 },
  { type: AssignmentRuleType.NO_RESPONSE_THRESHOLD, config: { maxNoResponses: 3, windowDays: 7 }, isActive: true, priority: 90 },
  { type: AssignmentRuleType.PREFERRED_STAFF, config: { bonus: 1000 }, isActive: true, priority: 80 },
  { type: AssignmentRuleType.PERFORMANCE_SCORE, config: { weight: 1 }, isActive: true, priority: 50 },
  { type: AssignmentRuleType.FAIR_DISTRIBUTION, config: { weight: 10 }, isActive: true, priority: 40 },
];

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** The longest rejection window (days) across the active threshold rules. */
export function rejectionWindowDays(rules: EngineRule[]): number {
  const windows = rules
    .filter((r) => r.isActive && r.type === AssignmentRuleType.REJECTION_THRESHOLD)
    .map((r) => num(r.config, 'windowDays', 7));
  return windows.length ? Math.max(...windows) : 7;
}

/** The longest no-response window (days) across the active threshold rules. */
export function noResponseWindowDays(rules: EngineRule[]): number {
  const windows = rules
    .filter((r) => r.isActive && r.type === AssignmentRuleType.NO_RESPONSE_THRESHOLD)
    .map((r) => num(r.config, 'windowDays', 7));
  return windows.length ? Math.max(...windows) : 7;
}

/**
 * Scores and orders candidates by the active rules. Candidates excluded by a
 * threshold rule are pushed to the bottom (and flagged). The service then picks
 * the first non-excluded candidate. Hard eligibility (skill, working hours,
 * overlap, the staff who just rejected) is filtered out BEFORE this call.
 */
export function rankCandidates(candidates: CandidateInput[], rules: EngineRule[]): RankedCandidate[] {
  const active = rules.filter((r) => r.isActive).sort((a, b) => b.priority - a.priority);

  const perfRule = active.find((r) => r.type === AssignmentRuleType.PERFORMANCE_SCORE);
  const perfWeight = perfRule ? num(perfRule.config, 'weight', 1) : 1;

  const rejRule = active.find((r) => r.type === AssignmentRuleType.REJECTION_THRESHOLD);
  const noRespRule = active.find((r) => r.type === AssignmentRuleType.NO_RESPONSE_THRESHOLD);
  const prefRule = active.find((r) => r.type === AssignmentRuleType.PREFERRED_STAFF);
  const fairRule = active.find((r) => r.type === AssignmentRuleType.FAIR_DISTRIBUTION);

  const ranked = candidates.map<RankedCandidate>((c) => {
    const reasons: string[] = [];
    let excluded = false;
    let score = c.performanceScore * perfWeight;
    reasons.push(`base ${c.performanceScore} x perfWeight ${perfWeight}`);

    if (rejRule) {
      const max = num(rejRule.config, 'maxRejections', 3);
      if (c.rejectionCount >= max) {
        excluded = true;
        reasons.push(`excluded: ${c.rejectionCount} rejections >= ${max}`);
      } else {
        const penalty = num(rejRule.config, 'penaltyPerRejection', 0) * c.rejectionCount;
        score -= penalty;
        if (penalty) reasons.push(`-${penalty} rejection penalty`);
      }
    }

    if (noRespRule) {
      const max = num(noRespRule.config, 'maxNoResponses', 3);
      if (c.noResponseCount >= max) {
        excluded = true;
        reasons.push(`excluded: ${c.noResponseCount} no-responses >= ${max}`);
      } else {
        const penalty = num(noRespRule.config, 'penaltyPerNoResponse', 0) * c.noResponseCount;
        score -= penalty;
        if (penalty) reasons.push(`-${penalty} no-response penalty`);
      }
    }

    if (prefRule && c.isPreferred) {
      const bonus = num(prefRule.config, 'bonus', 1000);
      score += bonus;
      reasons.push(`+${bonus} preferred staff`);
    }

    if (fairRule) {
      const weight = num(fairRule.config, 'weight', 10);
      const penalty = c.recentAssignmentCount * weight;
      score -= penalty;
      if (penalty) reasons.push(`-${penalty} fair distribution`);
    }

    return { staffId: c.staffId, score, excluded, reasons };
  });

  // Non-excluded first; then highest score; deterministic tie-break by staffId.
  return ranked.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.staffId.localeCompare(b.staffId);
  });
}

/** Returns the best eligible staffId, or null if none qualify. */
export function pickBest(candidates: CandidateInput[], rules: EngineRule[]): string | null {
  const ranked = rankCandidates(candidates, rules).filter((r) => !r.excluded);
  return ranked.length ? ranked[0].staffId : null;
}
