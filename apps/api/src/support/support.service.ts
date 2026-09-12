import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { hashSecret } from '../auth/password.util';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { capsFor, cleanCaps, levelOf, type SupportLevel } from './support-scope';
import { crewJobs, splitCrew, groupByKind, crewCounts, type WeekRowLike, type CrewHold } from '../content/crew-board';
import { SHOP } from '../content/client-view';
import { cleanTeam, groupSalons, teamSummaries, isNewSalon } from './support-teams';

/**
 * Lumio SUPPORT staff: one login that can set up ANY salon — without being a
 * platform admin and without punching holes in tenant isolation.
 *
 * The trick: a SUPPORT account by itself can read no salon data at all. To
 * work, it "enters" ONE salon and receives a short-lived token whose role and
 * tenantId are exactly those of a normal SALON_ADMIN. Every existing guard,
 * scope check and audit path then behaves as if a salon admin were acting —
 * except the userId stays the employee's (so audit names the real person) and
 * a supportSession flag unlocks the platform-managed setup screens.
 */

// The generated Prisma client in this sandbox may predate the SUPPORT enum
// value; the runtime value is just a string, and the migration adds it to the
// DB type. Keep one cast, here.
export const SUPPORT_ROLE = 'SUPPORT' as UserRole;

/** Long enough for a working day at one salon, short enough to expire by itself. */
const SESSION_HOURS = 8;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ---- For the setup staff -------------------------------------------------

  /**
   * The salon list a SUPPORT user may pick from. Deliberately thin: name, slug
   * and status only — no revenue, no counts, no settings. Everything else
   * requires entering the salon (which is audited).
   */
  async listTenants() {
    // A deleted salon is soft-deleted (kept for its records) and is not a
    // place anyone sets up any more; it stays out of this list.
    // Likewise a cancelled one: it is reactivated from Super Admin, not set
    // up from here, and three hundred live salons do not need it in the way.
    return this.prisma.tenant.findMany({
      where: { deletedAt: null, status: { not: TenantStatus.CANCELLED } },
      select: { id: true, name: true, slug: true, status: true, createdAt: true, supportTeam: true } as never,
      orderBy: { name: 'asc' },
      take: 2000,
    });
  }

  /**
   * The salon list a support employee actually reads: their own team's open,
   * the unowned ones open under them, everyone else's folded to a line.
   * See ./support-teams for why the default matters more than the grouping.
   */
  async board(user: AuthenticatedUser) {
    const [salons, staff, me] = await Promise.all([
      this.listTenants() as Promise<{ id: string; name: string; createdAt?: Date | null; supportTeam?: string | null }[]>,
      this.prisma.user.findMany({
        where: { role: SUPPORT_ROLE, isActive: true },
        select: { email: true, firstName: true, supportTeam: true } as never,
        take: 200,
      }).catch(() => []) as Promise<{ email?: string | null; firstName?: string | null; supportTeam?: string | null }[]>,
      user.userId
        ? this.prisma.user.findUnique({ where: { id: user.userId }, select: { supportTeam: true, supportLevel: true } as never })
          .catch(() => null) as Promise<{ supportTeam?: string | null; supportLevel?: string | null } | null>
        : Promise.resolve(null),
    ]);
    const myTeam = cleanTeam(me?.supportTeam) || null;
    // Whether each salon's Facebook/Instagram is answered by the AI, read once
    // for the whole list: 'on' / 'off' (connected for posting only) / 'none'
    // (no Page at all). The board offers the switch so a salon sold posting
    // without the bot can be set that way in one click, not by entering it.
    const conns = await this.prisma.messengerConnection.findMany({
      select: { tenantId: true, enabled: true, pageId: true } as never,
    }).catch(() => []) as { tenantId: string; enabled: boolean; pageId: string | null }[];
    const botOf = new Map(conns.map((c) => [c.tenantId, botStateOf(c)]));
    // Marked here, not in the grouping, so "how new is new" is decided once
    // and the screen only has to read the flag. See ./support-teams.
    const now = Date.now();
    const marked = salons.map((s) => ({ ...s, isNew: isNewSalon(s.createdAt, now), bot: botOf.get(s.id) ?? 'none' }));
    // Whether THIS viewer may move a salon between teams — the same bar the
    // write enforces, sent down so the screen can leave the control out
    // instead of offering a button that always answers with a refusal.
    const canAssign = user.role === UserRole.SUPER_ADMIN
      || levelOf(user.supportLevel ?? me?.supportLevel) === 'full';
    return { myTeam, canAssign, groups: groupSalons(marked, myTeam), teams: teamSummaries(salons, staff) };
  }

  /**
   * Switch a salon's Messenger/Instagram AI on or off from the board.
   *
   * Off means: the Page stays connected and posts keep publishing; Lumio
   * neither reads nor answers the Page's messages. Exactly what the "Bật bot
   * tự trả lời" box on the salon's Bot page does — offered here so the
   * employee filing a posting-only client does not have to open a session
   * to flip one box. Audited, because a customer feels this one.
   */
  async setTenantBot(user: AuthenticatedUser, tenantId: string, on: unknown) {
    if (typeof on !== 'boolean') throw new BadRequestException('Cần on: true/false');
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } })
      .catch(() => null);
    if (!tenant) throw new NotFoundException('Salon not found');
    const r = await this.prisma.messengerConnection.updateMany({ where: { tenantId }, data: { enabled: on } });
    if (!r.count) throw new BadRequestException('Tiệm này chưa kết nối Facebook Page — kết nối trước rồi mới bật/tắt bot.');
    await this.prisma.auditLog.create({
      data: {
        tenantId, userId: user.userId ?? null,
        action: on ? 'support.bot_enabled' : 'support.bot_disabled',
        resourceType: 'tenant', resourceId: tenantId,
      },
    }).catch(() => undefined);
    return { ok: true, bot: on ? 'on' : 'off' };
  }

  /**
   * Move a salon to a team, or take it off one.
   *
   * The owner and full-level accounts only — the same bar as deleting a
   * handled card. With thirty salons the owner must not be the bottleneck,
   * and an ordinary employee must not be able to quietly reshuffle whose
   * list is whose.
   */
  async setTenantTeam(user: AuthenticatedUser, tenantId: string, raw: unknown) {
    await this.mustBeSenior(user);
    const team = cleanTeam(raw);
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } })
      .catch(() => null);
    if (!tenant) throw new NotFoundException('Salon not found');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { supportTeam: team || null } as never });
    await this.prisma.auditLog.create({
      data: {
        tenantId, userId: user.userId ?? null,
        action: 'support.tenant_team_set',
        resourceType: 'tenant', resourceId: tenantId,
        metadata: { team: team || null },
      } as never,
    }).catch(() => undefined);
    return { ok: true, tenantId, team: team || null };
  }

  /**
   * Move MANY salons onto a team in one call.
   *
   * WHY THIS EXISTS AND THE SINGLE MOVE IS NOT ENOUGH
   *
   * Filing fifty salons one dropdown at a time is not a slower way of doing
   * this job; it is a job nobody finishes. And an unfiled salon is precisely
   * the one that goes a fortnight without a post, so the cost of not
   * finishing lands on the client rather than on the person who gave up.
   *
   * Same bar as the single move, and one audit row per salon — the trail does
   * not get thinner for the work getting faster.
   */
  async setTeamForMany(user: AuthenticatedUser, rawIds: unknown, rawTeam: unknown) {
    await this.mustBeSenior(user);
    const ids = [...new Set(
      (Array.isArray(rawIds) ? rawIds : []).map((x) => String(x ?? '').trim()).filter(Boolean),
    )].slice(0, 500);
    if (!ids.length) throw new BadRequestException('Chưa chọn tiệm nào.');
    const team = cleanTeam(rawTeam);

    // Filtered through the DB rather than trusted: a deleted salon must not be
    // quietly resurrected onto a team by an id left over in a stale tab.
    const found = await this.prisma.tenant.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    }).catch(() => [] as { id: string }[]);
    const okIds = found.map((t) => t.id);
    if (!okIds.length) throw new NotFoundException('Không tìm thấy tiệm nào trong danh sách này.');

    await this.prisma.tenant.updateMany({
      where: { id: { in: okIds } },
      data: { supportTeam: team || null } as never,
    });
    await this.prisma.auditLog.createMany({
      data: okIds.map((tenantId) => ({
        tenantId, userId: user.userId ?? null,
        action: 'support.tenant_team_set',
        resourceType: 'tenant', resourceId: tenantId,
        metadata: { team: team || null, bulk: okIds.length },
      })) as never,
    }).catch(() => undefined);
    return { ok: true, count: okIds.length, team: team || null };
  }

  /** Put an employee on a team, or take them off one. Same bar as moving a salon. */
  async setAccountTeam(user: AuthenticatedUser, id: string, raw: unknown) {
    await this.mustBeSenior(user);
    const team = cleanTeam(raw);
    const row = await this.prisma.user.findFirst({ where: { id, role: SUPPORT_ROLE }, select: { id: true } })
      .catch(() => null);
    if (!row) throw new NotFoundException('Account not found');
    await this.prisma.user.update({ where: { id }, data: { supportTeam: team || null } as never });
    return { ok: true, id, team: team || null };
  }

  /**
   * Who may reshuffle the lists.
   *
   * WHY THIS READS THE ROW AND NOT THE TOKEN
   *
   * `supportLevel` rides on the SHORT-LIVED token minted when an employee
   * steps into one salon — deliberately frozen there, so the session that did
   * the work carries the answer to what it was allowed to do. The token an
   * employee holds on the salon-picker screen is their ordinary login, and it
   * has no such field. Reading it through `levelOf` turned "absent" into
   * "setup", which locked full-level employees out of a screen that is theirs:
   * the owner would have had to assign every team himself, which is the exact
   * bottleneck the teams were built to remove.
   *
   * So: trust the token when it carries a level (inside a salon, where the
   * freeze is the point), and otherwise ask the employee's own row.
   */
  private async mustBeSenior(user: AuthenticatedUser) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    const level = user.supportLevel
      ? levelOf(user.supportLevel)
      : levelOf(await this.levelOfAccount(user.userId));
    if (level !== 'full') {
      throw new ForbiddenException('Chỉ chủ hệ thống hoặc tài khoản quyền cao mới đổi nhóm được.');
    }
  }

  /**
   * Everything the shops have sent that nobody has turned into a post yet —
   * across EVERY salon, newest first.
   *
   * WHY IT LIVES HERE
   *
   * Each salon's own content page has an inbox, and it is the right place to
   * work from. It is the wrong place to NOTICE from: a staff member covering
   * eight salons would have to open eight pages every morning to learn that
   * one shop sent a clip at 11pm. So the first screen they see — the salon
   * picker — carries one list of what is waiting, with the salon's name on
   * each line and a button that opens that salon on its inbox.
   *
   * Read-only, and it says nothing about method: title, the shop's note,
   * how many files, how long ago. The working detail is inside the salon.
   */
  /**
   * Today's production queue, across every salon at once.
   *
   * ONE QUERY, NOT THIRTY. The naive shape of this screen — walk the salons,
   * read each one's week — is thirty round trips for a page two people open
   * every hour of the working day. Current week rows are fetched in a single
   * read and expanded in memory (see ../content/crew-board), which also means
   * adding the thirty-first salon costs nothing.
   *
   * The plan read is the EDITED one when a person has been through it, and
   * the generated one otherwise — the same precedence the salon's own screen
   * uses, so the queue can never show a job the team already rewrote away.
   */
  async today(user: AuthenticatedUser, lang?: string) {
    const loose = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown> }>;
    // A fortnight back: last week's row still holds jobs that ran late, and a
    // job that slipped is exactly what this screen exists to surface.
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const rows = await loose.contentWeek?.findMany({
      where: { startDate: { gte: since }, tenant: { deletedAt: null, status: { not: 'CANCELLED' } } },
      orderBy: { startDate: 'desc' },
      take: 400,
      select: {
        tenantId: true, weekKey: true, startDate: true, generated: true, edited: true, crew: true,
        tenant: { select: { name: true, slug: true } },
      },
    }).catch(() => []) as {
      tenantId: string; weekKey: string; startDate: string;
      generated: unknown; edited: unknown; crew: unknown;
      tenant: { name: string; slug: string } | null;
    }[];

    // Newest week per salon that has actually started. A row for next week
    // exists the moment the scheduler runs, and showing it beside today's is
    // how a queue starts lying about what is due.
    const today = new Date().toISOString().slice(0, 10);
    const latest = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      if (r.startDate > today) continue;
      if (!latest.has(r.tenantId)) latest.set(r.tenantId, r);
    }

    const weeks: WeekRowLike[] = [...latest.values()].map((r) => {
      const plan = (r.edited ?? r.generated ?? {}) as { days?: unknown };
      return {
        tenantId: r.tenantId,
        weekKey: r.weekKey,
        startDate: r.startDate,
        salon: r.tenant?.name ?? '—',
        slug: r.tenant?.slug ?? '',
        days: Array.isArray(plan.days) ? (plan.days as never[]) : [],
        crew: (r.crew ?? null) as Record<string, CrewHold> | null,
      };
    });

    /**
     * WHEN EACH SALON LAST SENT US ANYTHING.
     *
     * The shop's own uploads — the cards it opens and closes in one move when
     * it presses "Đã quay xong" (suggestions.service sendFromShop stamps them
     * createdByName: SHOP). One query for the whole board, and it is what turns
     * "Đăng clip — Dip Powder" from a job into a phone call on the mornings
     * when no clip exists.
     *
     * Deliberately NOT the posting queue: that knows what was PUBLISHED, which
     * is the wrong end of the day. The question at 9am is who owes us footage.
     */
    const lastMediaByTenant: Record<string, string | null> = {};
    const ids = weeks.map((w) => w.tenantId);
    if (ids.length) {
      const sent = await (this.prisma as unknown as {
        contentSuggestion?: { findMany?: (a: unknown) => Promise<{ tenantId: string; createdAt: Date }[]> };
      }).contentSuggestion?.findMany?.({
        where: { tenantId: { in: ids }, createdByName: SHOP },
        select: { tenantId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }).catch(() => []) ?? [];
      for (const r of sent) {
        // A row with no createdAt makes `new Date(...).toISOString()` throw a
        // RangeError, and this runs inside the crew board's only query — one
        // bad row would 500 the screen two people open every hour.
        const t = new Date(r.createdAt as never).getTime();
        if (!Number.isFinite(t)) continue;
        const d = new Date(t).toISOString().slice(0, 10);
        const cur = lastMediaByTenant[r.tenantId];
        if (!cur || d > cur) lastMediaByTenant[r.tenantId] = d;
      }
      for (const id of ids) if (!(id in lastMediaByTenant)) lastMediaByTenant[id] = null;
    }

    const tongue = lang === 'en' ? 'en' : 'vi';
    const jobs = crewJobs(weeks, { today, lang: tongue, lastMediaByTenant });
    const me = user.email ?? null;
    // Work and phone calls are two different jobs, in two different lists.
    const split = splitCrew(jobs);
    return {
      me, today,
      counts: crewCounts(jobs, me),
      groups: groupByKind(split.ready, tongue),
      blocked: split.blocked,
      chase: split.chase,
      done: jobs.filter((j) => j.done).length,
    };
  }

  /**
   * Take a job, put it back, or mark it finished.
   *
   * Anybody on the team may do any of the three to any job, including one
   * somebody else holds. That is not an oversight: the failure this screen
   * exists to prevent is a job sitting under the name of a person who is off
   * sick, and a permission check there would turn a two-second fix into a
   * phone call. Every change is stamped with a name, which is the real
   * control — people do not quietly steal work in a team of two.
   */
  async setJobState(user: AuthenticatedUser, dto: { tenantId?: unknown; weekKey?: unknown; jobId?: unknown; state?: unknown }) {
    const tenantId = String(dto?.tenantId ?? '').trim();
    const weekKey = String(dto?.weekKey ?? '').trim();
    const jobId = String(dto?.jobId ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 24);
    const state = String(dto?.state ?? '');
    if (!tenantId || !/^\d{4}-W\d{2}$/.test(weekKey) || !jobId) throw new BadRequestException('Thiếu việc cần cập nhật.');
    if (!['claim', 'release', 'done', 'undone'].includes(state)) throw new BadRequestException('Trạng thái không hợp lệ.');

    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>;
    const row = await loose.contentWeek?.findFirst({ where: { tenantId, weekKey }, select: { id: true, crew: true } })
      .catch(() => null) as { id: string; crew: Record<string, CrewHold> | null } | null;
    if (!row) throw new NotFoundException('Không tìm thấy tuần này.');

    const crew: Record<string, CrewHold> = { ...(row.crew ?? {}) };
    const who = user.email ?? 'Lumio';
    if (state === 'release') delete crew[jobId];
    else if (state === 'claim') crew[jobId] = { by: who, at: new Date().toISOString() };
    else if (state === 'done') crew[jobId] = { by: crew[jobId]?.by ?? who, at: crew[jobId]?.at ?? new Date().toISOString(), done: true };
    else crew[jobId] = { by: who, at: new Date().toISOString() };

    await loose.contentWeek?.update({ where: { id: row.id }, data: { crew: crew as never } }).catch(() => undefined);
    await this.prisma.auditLog.create({
      data: {
        tenantId, userId: user.userId ?? null,
        action: `content.job_${state}`,
        resourceType: 'content_week', resourceId: `${weekKey}:${jobId}`,
      } as never,
    }).catch(() => undefined);
    return { ok: true, jobId, state };
  }

  async inbox() {
    const loose = this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
    }>;
    const rows = await loose.contentSuggestion?.findMany({
      where: { status: { in: ['done', 'working'] }, tenant: { deletedAt: null, status: { not: 'CANCELLED' } } },
      orderBy: { doneAt: 'desc' },
      take: 60,
      select: {
        id: true, tenantId: true, title: true, note: true, createdByName: true, doneAt: true, media: true, status: true, workingByName: true,
        tenant: { select: { name: true, slug: true } },
      },
    }).catch(() => []) as {
      id: string; tenantId: string; title: string; note: string | null; createdByName: string | null;
      doneAt: Date | null; media: unknown; status: string; workingByName: string | null; tenant: { name: string; slug: string } | null;
    }[];
    return rows.map((r) => {
      const media = Array.isArray(r.media) ? (r.media as { kind?: string; driveUrl?: string; driveFileId?: string }[]) : [];
      return {
        id: r.id,
        tenantId: r.tenantId,
        salon: r.tenant?.name ?? '—',
        slug: r.tenant?.slug ?? '',
        title: r.title,
        note: r.note,
        fromShop: r.createdByName === 'shop',
        working: r.status === 'working',
        workingByName: r.workingByName ?? null,
        doneAt: r.doneAt,
        files: media.length,
        clips: media.filter((m) => m.kind === 'video').length,
        archived: media.filter((m) => Boolean(m.driveUrl || m.driveFileId)).length,
      };
    });
  }

  /**
   * Step into one salon: mint an 8-hour token scoped to that tenant with the
   * powers of its salon admin. Tenant isolation is untouched — inside the
   * session, cross-tenant requests fail exactly as they do for a real admin.
   */
  async enterSalon(user: AuthenticatedUser, tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    if (tenant.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException('This salon is suspended — reactivate it first.');
    }
    if (tenant.status === TenantStatus.CANCELLED) {
      throw new ForbiddenException('This salon is cancelled — reactivate it in Super Admin first.');
    }

    /**
     * How much of this salon this particular employee may see.
     *
     * Read from their own row at the moment they step in, and then frozen into
     * the token: the session that did the work carries, in itself, the answer
     * to what it was allowed to do. Changing somebody's level therefore takes
     * effect the next time they enter a salon — which is a minute away and is
     * the price of an audit trail that cannot be rewritten after the fact.
     *
     * A SUPER_ADMIN entering a salon is not a setup employee and is not
     * narrowed: `levelOf` is only asked about a stored SUPPORT row.
     */
    const row = user.role === UserRole.SUPER_ADMIN ? null : await this.scopeOfAccount(user.userId);
    const level: SupportLevel = user.role === UserRole.SUPER_ADMIN ? 'full' : levelOf(row?.supportLevel);
    /**
     * The employee's own ticks, when they have any.
     *
     * Three presets fitted the first six employees and stopped fitting soon
     * after — the person who only answers the inbox, the one who also needs
     * the calendar because they reschedule. So a list may be hand-picked per
     * employee, and when it exists it REPLACES the preset rather than adding
     * to it: "what this person sees" has to be readable off one row, not
     * computed by unioning a preset with an exception list.
     *
     * A SUPER_ADMIN is not a setup employee and is never narrowed.
     */
    const custom = user.role === UserRole.SUPER_ADMIN ? [] : cleanCaps(row?.supportCaps);
    const capabilities = capsFor(level, custom);

    const payload: JwtPayload = {
      sub: user.userId, // the EMPLOYEE — audit logs stay honest
      email: user.email,
      role: UserRole.SALON_ADMIN, // borrow the salon admin scope: all guards just work
      tenantId: tenant.id,
      supportSession: true,
      supportLevel: level,
      // Only when it differs from the preset, so an ordinary session's token
      // does not grow twenty-one strings for nothing — and so that a preset
      // that widens in a later release reaches the employees who are on it.
      ...(custom.length ? { supportCaps: custom } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
      expiresIn: `${SESSION_HOURS}h`,
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.userId,
      action: 'support.entered_salon',
      resourceType: 'tenant',
      resourceId: tenant.id,
      // The scope is written into the audit row, not just the level: a
      // hand-picked session has to be answerable afterwards for what it could
      // reach, and "level: setup" alone would misdescribe it.
      metadata: {
        by: user.email, sessionHours: SESSION_HOURS, level,
        ...(custom.length ? { caps: custom } : {}),
      },
    });

    return {
      accessToken,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      // The screen stores these on the session so the salon menu draws the
      // right shape immediately, without a second round trip and without
      // guessing. The server does not trust them back — every request is
      // checked against the level inside the token (see SupportScopeGuard).
      level,
      // True when this employee's ticks replace the preset. The banner says so,
      // because "Setup" on the badge while half the Setup screens are missing
      // reads as a broken build rather than as an account.
      custom: custom.length > 0,
      capabilities,
    };
  }

  /**
   * The stored scope for one SUPPORT row, or null when there is no such row.
   *
   * Asked for with the ticks, and asked again without them if that fails — the
   * same two-step as `listAccounts`, and here it matters more. `supportCaps`
   * arrives with a migration; if this select threw because the column was not
   * there yet, the single `.catch(() => null)` it replaced would have read as
   * "no such row", and `levelOf(null)` is `setup`. Every full-level employee
   * would have been quietly demoted for as long as that lasted. A demotion is
   * not a safe failure just because it is the narrow direction: it locks the
   * person covering a salon out of screens they were using ten minutes ago.
   */
  private async scopeOfAccount(userId: string): Promise<{ supportLevel?: string | null; supportCaps?: unknown } | null> {
    const where = { id: userId, role: SUPPORT_ROLE };
    return await this.prisma.user.findFirst({
      where, select: { supportLevel: true, supportCaps: true } as never,
    }).catch(() => this.prisma.user.findFirst({
      where, select: { supportLevel: true } as never,
    }).catch(() => null)) as { supportLevel?: string | null; supportCaps?: unknown } | null;
  }

  /**
   * The stored level for one SUPPORT row, or null when there is no such row.
   *
   * Kept as its own question because `mustBeSenior` asks only about the level:
   * seniority — who may reshuffle the teams — is a rank, and the ticks are a
   * list of screens. Widening somebody's screens must not quietly promote them.
   */
  private async levelOfAccount(userId: string): Promise<string | null> {
    return (await this.scopeOfAccount(userId))?.supportLevel ?? null;
  }

  // ---- For the Super Admin (account management) ---------------------------

  async listAccounts() {
    const base = {
      id: true, email: true, firstName: true, lastName: true,
      isActive: true, lastLoginAt: true, createdAt: true, supportLevel: true, supportTeam: true,
    };
    /**
     * Asked for with the ticks, and asked again without them if that fails.
     *
     * `supportCaps` arrives with a migration. Between the code going live and
     * the column existing there is a window — a rolled-back migration reopens
     * it — and in that window a single select decides whether the owner can
     * manage his staff at all. Losing the ticks for a minute is recoverable;
     * a blank Support accounts screen is what gets somebody phoned at night.
     */
    const rows = await this.prisma.user.findMany({
      where: { role: SUPPORT_ROLE },
      select: { ...base, supportCaps: true } as never,
      orderBy: { createdAt: 'desc' },
    }).catch(() => this.prisma.user.findMany({
      where: { role: SUPPORT_ROLE },
      select: base as never,
      orderBy: { createdAt: 'desc' },
    })) as unknown as { supportLevel?: string | null; supportTeam?: string | null; supportCaps?: unknown }[];
    // Normalised on the way out, so the screen never has to decide what a null
    // means — and shows the same word the guard will act on. The team is
    // normalised for the same reason: '' and null both mean "no team", and a
    // screen that has to know the difference will one day get it wrong.
    // `supportCaps` is cleaned on the way out for the same reason the level is
    // normalised: the screen draws the ticks from it, and a name this build no
    // longer knows would draw a box that cannot be unticked.
    return rows.map((r) => ({
      ...r,
      supportLevel: levelOf(r.supportLevel),
      supportTeam: cleanTeam(r.supportTeam) || null,
      supportCaps: cleanCaps(r.supportCaps),
    }));
  }

  async createAccount(dto: { email?: string; password?: string; firstName?: string; lastName?: string; supportLevel?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    const password = dto.password || '';
    if (!/.+@.+\..+/.test(email)) throw new BadRequestException('Enter a valid email.');
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new BadRequestException('An account with this email already exists.');
    const u = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashSecret(password),
        role: SUPPORT_ROLE,
        tenantId: null, // no home salon — access happens only via audited sessions
        firstName: (dto.firstName || 'Support').slice(0, 60),
        lastName: (dto.lastName || '').slice(0, 60) || null,
        isActive: true,
        supportLevel: levelOf(dto.supportLevel),
      } as never,
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true, supportLevel: true } as never,
    });
    return u;
  }

  /**
   * Change what one employee may see.
   *
   * Scoped to SUPPORT rows for the same reason as `setAccountActive`: this
   * endpoint must never become a way to re-level a salon owner. Takes effect
   * the next time they enter a salon — an open session keeps the level it was
   * minted with, which is stated on the screen rather than left to be
   * discovered.
   */
  async setAccountLevel(id: string, supportLevel: unknown, supportCaps?: unknown) {
    const level = levelOf(supportLevel);
    /**
     * The ticks are only written when the caller sent the field.
     *
     * The level dropdown and the tick list are two controls on one row, and
     * they post to one endpoint. If `undefined` meant "clear the ticks", then
     * changing somebody's preset would silently throw away the list that was
     * overriding it — so absent means "leave them alone" and an empty array
     * means "back to the preset". That distinction is the whole reason this
     * takes `unknown` rather than `Capability[]`.
     */
    const caps = supportCaps === undefined ? undefined : cleanCaps(supportCaps);
    const r = await this.prisma.user.updateMany({
      where: { id, role: SUPPORT_ROLE },
      data: (caps === undefined ? { supportLevel: level } : { supportLevel: level, supportCaps: caps }) as never,
    });
    if (r.count === 0) throw new NotFoundException('Support account not found');
    return { id, supportLevel: level, supportCaps: caps ?? null };
  }

  /**
   * Remove an employee's account for good.
   *
   * Restricted to role SUPPORT rows for the same reason as everything else on
   * this controller: it must never become a way to delete a salon owner.
   *
   * WHAT SURVIVES, AND WHY THAT IS ENOUGH
   *
   * The row goes; the history does not. Audit entries keep their text and the
   * employee's email in `metadata.by`, and their messages to salons keep the
   * name they were signed with — every one of those columns is denormalised
   * already, and the foreign keys are SetNull, so nothing is orphaned and
   * nothing silently changes author. What is lost is the LINK from an old
   * audit row to a user id that no longer exists, which is why one last row is
   * written here naming who was removed and by whom.
   *
   * Their open salon sessions die with the row — the JWT strategy re-checks the
   * account on every request (see session-check.ts). Before that check existed,
   * deleting somebody at nine in the morning left them working until dinner.
   */
  async deleteAccount(actor: AuthenticatedUser, id: string) {
    const row = await this.prisma.user.findFirst({
      where: { id, role: SUPPORT_ROLE },
      select: { id: true, email: true, firstName: true, lastName: true, supportLevel: true } as never,
    }) as { id: string; email: string; firstName: string | null; lastName: string | null; supportLevel?: string | null } | null;
    if (!row) throw new NotFoundException('Support account not found');

    // Written BEFORE the delete, so a failure leaves a record of the attempt
    // rather than a silent gap.
    await this.audit.log({
      tenantId: null,
      userId: actor.userId,
      action: 'support.account_deleted',
      resourceType: 'user',
      resourceId: row.id,
      metadata: {
        email: row.email,
        name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
        level: levelOf(row.supportLevel),
        by: actor.email,
      },
    });

    // Scoped to the role a second time: between the read and the write is the
    // only window in which this could be pointed at somebody else.
    const r = await this.prisma.user.deleteMany({ where: { id, role: SUPPORT_ROLE } });
    if (r.count === 0) throw new NotFoundException('Support account not found');
    return { id, deleted: true, email: row.email };
  }

  /**
   * Turn an account on/off. Restricted to role SUPPORT rows so this endpoint
   * can never be used to disable an owner or another platform admin.
   */
  async setAccountActive(id: string, isActive: boolean) {
    const r = await this.prisma.user.updateMany({
      where: { id, role: SUPPORT_ROLE },
      data: { isActive },
    });
    if (r.count === 0) throw new NotFoundException('Support account not found');
    return { id, isActive };
  }
}


/** What the board says about a salon's AI chat, from its brain row. */
export function botStateOf(c: { enabled?: boolean | null; pageId?: string | null } | null | undefined): 'on' | 'off' | 'none' {
  if (!c || !c.pageId) return 'none';
  return c.enabled ? 'on' : 'off';
}
