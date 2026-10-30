import { Injectable } from '@nestjs/common';
import { bufferOf, padSpan } from './buffer';
import { matchTech } from './tech-match';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { wallTimeToUtc } from './booking.util';
import { busySpansFor, loadApprovedTimeOff } from '../staff/time-off';
import { MenuItem, PartyMember, Tech, nearestTimes, partyOpenTimes, resolveService } from './group-booking';

/** One person of a party, resolved against the menu and the team. */
export interface Member { firstName: string; items: MenuItem[]; techId: string | null; techName: string | null }
/** What the AI assistants hand in: the coded menu and who works here. */
export interface PartyCtx { menu: MenuItem[]; staff: { id: string; firstName: string; lastName: string | null }[] }

/**
 * "IS THERE ROOM FOR ALL OF US AT TWO?" — one answer for every AI door.
 *
 * The hotline learned to look in the book before promising a time; the chat
 * bot still booked blind and found out at create_booking that the chair was
 * taken. This is the hotline's arithmetic lifted out so both assistants (and
 * anything else that asks for a group) read the same diary the same way:
 * each person needs a different free technician who can do their services,
 * unassigned bookings each hold a chair, a tech's own shift bounds her day,
 * and the salon's hours, days off, lead time and booking horizon all apply.
 *
 * Every read is scoped to the tenant it is asked for.
 */
@Injectable()
export class PartyAvailabilityService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  /** "Saturday, October 10 at 2:00 PM" in the salon's own clock. */
  spoken(d: Date, tz: string, withDay = true): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, ...(withDay ? { weekday: 'long', month: 'long', day: 'numeric' } : {}), hour: 'numeric', minute: '2-digit',
    }).format(d);
  }

  /**
   * Who can work on one day, and what already fills their time: bookings
   * assigned to them, hours outside their shift, and the bookings nobody is
   * assigned to yet (each of those will take somebody's chair).
   */
  async staffDay(tenantId: string, dateStr: string, tz: string): Promise<{ techs: Tech[]; unassigned: { start: Date; end: Date }[]; salonBusy: { start: Date; end: Date }[] }> {
    const dayStart = wallTimeToUtc(dateStr, '00:00', tz);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
    const holding = [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED, AppointmentStatus.ARRIVED];
    const [staff, appts] = await Promise.all([
      this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true, takesAppointments: true },
        select: {
          id: true, firstName: true,
          staffServices: { select: { serviceId: true } },
          workingHours: { where: { isActive: true }, select: { dayOfWeek: true, startTime: true, endTime: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: { tenantId, status: { in: holding }, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
        select: { assignedStaffId: true, startTime: true, endTime: true },
      }),
    ]);
    const leave = await loadApprovedTimeOff(this.prisma, tenantId, dateStr, dateStr, staff.map((s) => s.id));
    // The salon's rest gap between a technician's appointments (bookings/buffer.ts).
    const gap = bufferOf(await this.settings.getBookingRules(tenantId).catch(() => null));
    const techs: Tech[] = staff.map((st) => {
      const busy: { start: Date; end: Date }[] = appts
        .filter((a) => a.assignedStaffId === st.id)
        .map((a) => padSpan({ start: a.startTime, end: a.endTime }, gap));
      // Approved time off (nghỉ phép) takes the day, or the part of it.
      busy.push(...busySpansFor(leave, st.id, dateStr, tz));
      const hours = st.workingHours ?? [];
      if (hours.length) {
        // A tech with a schedule is off outside it; one without follows the salon's hours.
        const spans = hours.filter((h) => h.dayOfWeek === dow)
          .map((h) => ({ s: wallTimeToUtc(dateStr, h.startTime, tz), e: wallTimeToUtc(dateStr, h.endTime, tz) }))
          .filter((x) => x.e.getTime() > x.s.getTime())
          .sort((a, b) => a.s.getTime() - b.s.getTime());
        let cursor = dayStart;
        for (const sp of spans) {
          if (sp.s.getTime() > cursor.getTime()) busy.push({ start: cursor, end: sp.s });
          if (sp.e.getTime() > cursor.getTime()) cursor = sp.e;
        }
        if (cursor.getTime() < dayEnd.getTime()) busy.push({ start: cursor, end: dayEnd });
      }
      return { id: st.id, name: st.firstName, skills: st.staffServices.map((x) => x.serviceId), busy };
    });
    const unassigned = appts.filter((a) => !a.assignedStaffId).map((a) => ({ start: a.startTime, end: a.endTime }));
    // A whole-salon block (Calendar) closes the time even for a salon with no team on file.
    const salonBusy = busySpansFor(leave.filter((o) => o.staffId == null), null, dateStr, tz);
    return { techs, unassigned, salonBusy };
  }

  /** The open start times one day has for this party: on the salon's grid, and every 5 minutes (to honour "2:10"). */
  async partySlots(tenantId: string, tz: string, dateStr: string, party: PartyMember[]): Promise<{ grid: Date[]; fine: Date[]; tooFar: number | null }> {
    const rules = await this.settings.getBookingRules(tenantId);
    const adv = Number(rules.maxAdvanceDays ?? 0);
    if (adv > 0) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const days = Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      if (days > adv) return { grid: [], fine: [], tooFar: adv };
    }
    const { techs, unassigned, salonBusy } = await this.staffDay(tenantId, dateStr, tz);
    const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
    const base = {
      dateStr, tz, party, techs, unassigned,
      day: (rules.businessHours ?? [])[dow] ?? null,
      closedToday: (rules.daysOff ?? []).includes(dateStr),
      now: new Date(Date.now() + Math.max(0, Number(rules.minLeadHours ?? 0)) * 3_600_000),
    };
    const open = (t: Date) => !salonBusy.some((b) => t.getTime() >= b.start.getTime() && t.getTime() < b.end.getTime());
    const grid = partyOpenTimes({ ...base, stepMinutes: Number((rules as { slotStepMinutes?: number }).slotStepMinutes ?? 15) || 15 }).filter(open);
    const fine = partyOpenTimes({ ...base, stepMinutes: 5 }).filter(open);
    return { grid, fine, tooFar: null };
  }

  /**
   * The party the model described, checked against THIS salon's menu and
   * team. Anything it cannot place exactly comes back as an instruction to
   * ask the customer — never a silent guess.
   */
  parseParty(input: Record<string, unknown>, ctx: PartyCtx, needNames: boolean): { members: Member[] } | { error: string } {
    const raw = Array.isArray(input.people) ? (input.people as Record<string, unknown>[]) : [];
    if (!raw.length) return { error: 'No people given. Ask who the booking is for and what service each person wants.' };
    if (raw.length > 8) return { error: 'More than 8 people is a large group — offer to have the salon call back, or to connect them to the front desk.' };
    const members: Member[] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i] || {};
      const refs = (Array.isArray(p.services) ? p.services : [p.services]).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!refs.length) return { error: `Person ${i + 1} has no service yet. Ask what they would like.` };
      const items: MenuItem[] = [];
      for (const ref of refs) {
        const hit = resolveService(ref, ctx.menu);
        if (!hit) return { error: `"${ref}" is not one exact menu item. Use the menu codes (S1, S2…), call get_services, or ask the customer which one they mean.` };
        if (!items.some((x) => x.id === hit.id)) items.push(hit);
      }
      const firstName = String(p.firstName ?? '').trim();
      if (needNames && !firstName) return { error: `Person ${i + 1} has no name yet. Ask for the first name of each person.` };
      let techId: string | null = null; let techName: string | null = null;
      const wantTech = String(p.technician ?? '').trim();
      if (wantTech && !/^(any|anyone|no preference|none)$/i.test(wantTech)) {
        // Case, accents, a trailing space in the saved name and speech-recognition
        // spellings ("Sung" for Sang) are forgiven — but never a guess between two people.
        const m = matchTech(wantTech, ctx.staff);
        if (!m.tech) {
          const team = ctx.staff.map((s) => s.firstName.trim()).join(', ') || 'none listed';
          return { error: m.candidates.length
            ? `"${wantTech}" could be ${m.candidates.map((s) => s.firstName.trim()).join(' or ')}. Ask the customer which one they mean.`
            : `There is no technician called "${wantTech}" here (team: ${team}). The name may have been misheard: say the team names and ask who they meant, or whether anyone is fine.` };
        }
        techId = m.tech.id; techName = m.tech.firstName.trim();
      }
      members.push({ firstName, items, techId, techName });
    }
    return { members };
  }

  partyOf(members: Member[]): PartyMember[] {
    return members.map((m) => ({ serviceIds: m.items.map((x) => x.id), minutes: m.items.reduce((s, x) => s + x.minutes, 0), techId: m.techId }));
  }

  /** What to tell the customer when their time does not work: the nearest that do, that day or the next open day. */
  async alternatives(tenantId: string, tz: string, dateStr: string, party: PartyMember[], wanted: Date | null, grid: Date[]): Promise<string> {
    const near = nearestTimes(grid, wanted, 3);
    if (near.length) return `Nearest open times that day: ${near.map((d) => this.spoken(d, tz, false)).join(', ')}. Offer these and let the customer choose.`;
    for (let k = 1; k <= 7; k++) {
      const next = new Date(Date.parse(`${dateStr}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
      const s = await this.partySlots(tenantId, tz, next, party);
      if (s.tooFar) break;
      if (s.grid.length) return `Nothing is open that day for ${party.length === 1 ? 'this booking' : `${party.length} people at once`}. The next open day is ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(s.grid[0])}: ${nearestTimes(s.grid, null, 3).map((d) => this.spoken(d, tz, false)).join(', ')}. Offer that.`;
    }
    return 'Nothing is open in the next week for this booking. Offer to take a message so the salon calls back, or to connect them to the front desk.';
  }

  /**
   * The check_availability tool, word for word the same on every channel:
   * the model hands in a day, maybe a time, and the party; it gets back OPEN,
   * NOT OPEN with alternatives, or the day's open times.
   */
  async describe(tenantId: string, tz: string, input: Record<string, unknown>, ctx: PartyCtx): Promise<string> {
    const dateStr = String(input.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 'date must be YYYY-MM-DD in the salon’s local calendar.';
    const parsed = this.parseParty(input, ctx, false);
    if ('error' in parsed) return parsed.error;
    const party = this.partyOf(parsed.members);
    const time = String(input.time ?? '').trim();
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) return 'time must be HH:MM in 24-hour salon-local time.';
    const wanted = time ? wallTimeToUtc(dateStr, time, tz) : null;
    const s = await this.partySlots(tenantId, tz, dateStr, party);
    if (s.tooFar) return `That day is too far ahead — the salon books up to ${s.tooFar} days in advance. Ask for an earlier day.`;
    const who = party.length === 1 ? '' : ` for all ${party.length} people`;
    if (wanted && s.fine.some((d) => d.getTime() === wanted.getTime())) {
      return `OPEN: ${this.spoken(wanted, tz)} works${who}. Carry on: get anything still missing (names, phone), then read it all back and confirm.`;
    }
    if (!wanted) {
      if (!s.grid.length) return `NOTHING OPEN that day${who}. ${await this.alternatives(tenantId, tz, dateStr, party, null, s.grid)}`;
      return `Open start times that day${who}: ${s.grid.slice(0, 6).map((d) => this.spoken(d, tz, false)).join(', ')}${s.grid.length > 6 ? ' (and later ones)' : ''}. Offer two or three, not the whole list.`;
    }
    return `NOT OPEN at ${this.spoken(wanted, tz)}${who}. ${await this.alternatives(tenantId, tz, dateStr, party, wanted, s.grid)}`;
  }

  /** The start instant the model named is still open for this party (checked on the 5-minute grid). */
  async stillOpen(tenantId: string, tz: string, dateStr: string, start: Date, party: PartyMember[]): Promise<{ ok: true } | { ok: false; reason: string }> {
    const s = await this.partySlots(tenantId, tz, dateStr, party);
    if (s.tooFar) return { ok: false, reason: `That day is too far ahead — the salon books up to ${s.tooFar} days in advance. Nothing was booked; ask for an earlier day.` };
    if (!s.fine.some((d) => d.getTime() === start.getTime())) {
      return { ok: false, reason: `${this.spoken(start, tz)} is no longer open${party.length > 1 ? ` for all ${party.length} people` : ''}. ${await this.alternatives(tenantId, tz, dateStr, party, start, s.grid)}` };
    }
    return { ok: true };
  }
}
