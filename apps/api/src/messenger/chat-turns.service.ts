import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { InboxEventsService } from './inbox-events.service';
import { isOnDuty, isOnShift, pickAgent, reassignDue, type PickReason } from './chat-assignment';
import { StaffAlertsService } from './staff-alerts.service';
import { escalationDue, isAdThread, unrepliedMinsFor, windowOpen } from './staff-alerts';
import { DEFAULT_TEAM, REPORT_SENT_KEY, TEAM_KEY, adWaits, cleanTeam, nightText, pickWeighted, poolsFor, scoreboard, sourceOf, type LogRow, type TeamConfig, type ThreadFacts } from './turn-team';

/**
 * Chat turns ("chia turn") — who in the salon follows up which conversation.
 *
 * The rules live in pure functions (chat-assignment.ts); this service only
 * reads the facts they need, writes the result, logs it and tells the person.
 * Everything is scoped by the tenant id of the caller or of the thread — no
 * query here runs without one.
 *
 * BOT FIRST. With `chatBotFirst` on (the default), giving a conversation to a
 * person does not silence the bot: the customer still gets an answer at once,
 * and the person follows up, books, or steps in — and the bot yields the
 * moment they write, as it always has.
 */

export interface TurnSettings {
  mode: 'off' | 'round-robin';
  rotation: 'strict' | 'least-busy' | 'weighted';
  botFirst: boolean;
  needStatus: boolean;
  needShift: boolean;
  needOnline: boolean;
  onlineMins: number;
  maxOpenPerAgent: number;
  preferUsualTech: boolean;
  reassignUnreadMins: number;
  reassignUnrepliedMins: number;
  maxHops: number;
  agentIds: string[];
  /** A customer from an ad is passed on after this many minutes unanswered (0 = as everyone else). */
  reassignAdMins: number;
  /** Tell the owner/managers when a customer has waited this long with no human reply (0 = never). */
  escalateMins: number;
}

type ConnRow = Record<string, unknown> | null;

export function settingsOf(c: ConnRow): TurnSettings {
  const n = (k: string, d: number) => (typeof c?.[k] === 'number' ? (c[k] as number) : d);
  const b = (k: string, d: boolean) => (typeof c?.[k] === 'boolean' ? (c[k] as boolean) : d);
  return {
    mode: c?.chatAssignMode === 'round-robin' ? 'round-robin' : 'off',
    rotation: c?.chatRotation === 'least-busy' ? 'least-busy' : c?.chatRotation === 'weighted' ? 'weighted' : 'strict',
    botFirst: b('chatBotFirst', true),
    needStatus: b('chatNeedStatus', true),
    needShift: b('chatNeedShift', true),
    needOnline: b('chatNeedOnline', true),
    onlineMins: n('chatOnlineMins', 10),
    maxOpenPerAgent: n('chatMaxOpenPerAgent', 5),
    preferUsualTech: b('chatPreferUsualTech', true),
    reassignUnreadMins: n('chatReassignUnreadMins', 0),
    reassignUnrepliedMins: n('chatReassignUnrepliedMins', 0),
    maxHops: n('chatMaxHops', 3),
    agentIds: Array.isArray(c?.chatAgentIds) ? (c!.chatAgentIds as string[]).filter((x) => typeof x === 'string') : [],
    reassignAdMins: n('chatReassignAdMins', 0),
    escalateMins: n('chatEscalateMins', 0),
  };
}

const clampInt = (v: unknown, lo: number, hi: number): number | undefined =>
  Number.isInteger(v) ? Math.min(hi, Math.max(lo, v as number)) : undefined;

export interface AgentView {
  userId: string;
  name: string;
  role: string;
  inRotation: boolean;
  status: 'available' | 'away';
  online: boolean;
  onShift: boolean | null;
  onDuty: boolean;
  openThreads: number;
  turnsToday: number;
}

const INBOX_ROLES = [UserRole.SALON_ADMIN, UserRole.STAFF] as const;
const TICK_MS = 60_000;

@Injectable()
export class ChatTurnsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ChatTurns');
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: InboxEventsService,
    @Optional() private readonly push?: PushService,
    // A team member's own Messenger as their turn alert (./staff-alerts). Optional: without it, push only.
    @Optional() private readonly staff?: StaffAlertsService,
  ) {
    // "Bỏ qua" on Messenger passes the turn on through the same routing.
    this.staff?.setSkipRouter((tenantId, threadId, fromUserId) => this.route(tenantId, threadId, null, { excludeUserId: fromUserId, reason: 'reassign-unreplied' }));
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private get db() { return this.prisma as unknown as Record<string, any>; }

  /** The salon's clock: weekday 0-6 and minutes past midnight. */
  private async salonClock(tenantId: string): Promise<{ weekday: number; minutes: number } | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    const tz = t?.timezone || 'America/Los_Angeles';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
      const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
      const h = Number(get('hour')) % 24;
      const minutes = h * 60 + Number(get('minute'));
      return weekday < 0 || !Number.isFinite(minutes) ? null : { weekday, minutes };
    } catch { return null; }
  }

  /** Everyone who could take a turn in this salon, with the facts the rules need. */
  async agents(tenantId: string, s?: TurnSettings): Promise<AgentView[]> {
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null);
    const set = s ?? settingsOf(conn as ConnRow);
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: INBOX_ROLES as unknown as UserRole[] } },
      select: {
        id: true, firstName: true, lastName: true, email: true, role: true,
        staffMember: { select: { isActive: true, workingHours: { select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true } } } },
      } as never,
      orderBy: { firstName: 'asc' },
      take: 200,
    }).catch(() => []) as unknown as {
      id: string; firstName: string | null; lastName: string | null; email: string; role: string;
      staffMember: { isActive: boolean; workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[] } | null;
    }[];
    const presence = await this.db.chatAgentPresence?.findMany({ where: { tenantId }, select: { userId: true, status: true, lastSeenAt: true } }).catch(() => []) ?? [];
    const presBy = new Map<string, { status: string; lastSeenAt: Date | null }>(presence.map((p: { userId: string; status: string; lastSeenAt: Date | null }) => [p.userId, p]));
    const open = await this.db.messengerThread.groupBy({ by: ['assignedUserId'], where: { tenantId, status: 'open', assignedUserId: { not: null } }, _count: true }).catch(() => []) as { assignedUserId: string; _count: number }[];
    const openBy = new Map(open.map((r) => [r.assignedUserId, Number(r._count) || 0]));
    const since = new Date(Date.now() - 24 * 3600_000);
    const logs = await this.db.chatAssignmentLog?.groupBy({ by: ['userId'], where: { tenantId, createdAt: { gte: since }, userId: { not: null }, reason: { notIn: ['unassign', 'first-reply'] } }, _count: true }).catch(() => []) ?? [];
    const turnsBy = new Map<string, number>(logs.map((r: { userId: string; _count: number }) => [r.userId, Number(r._count) || 0]));
    const clock = await this.salonClock(tenantId);
    const now = new Date();
    // On shift through their own Messenger ("vào ca") counts as having Lumio open.
    const links = this.staff ? await this.staff.linksOf(tenantId).catch(() => ({})) : {};
    const onMsgr = (id: string) => windowOpen((links as Record<string, never>)[id], now);
    const inList = (id: string) => (set.agentIds.length ? set.agentIds.includes(id) : true);

    const views = users.map((u) => {
      const p = presBy.get(u.id);
      const hours = u.staffMember?.workingHours ?? [];
      const onShift = !u.staffMember || !hours.length ? null : (clock ? isOnShift(hours, clock.weekday, clock.minutes) : null);
      const status = p?.status === 'away' ? 'away' as const : 'available' as const;
      const online = onMsgr(u.id) || (!!p?.lastSeenAt && now.getTime() - new Date(p.lastSeenAt).getTime() <= Math.max(1, set.onlineMins) * 60_000);
      return {
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
        role: String(u.role),
        inRotation: inList(u.id),
        status,
        online,
        onShift,
        onDuty: isOnDuty({ status, onShift, lastSeenAt: onMsgr(u.id) ? now : p?.lastSeenAt ?? null }, set, now),
        openThreads: openBy.get(u.id) ?? 0,
        turnsToday: turnsBy.get(u.id) ?? 0,
      };
    });
    // The queue order: the salon's own list order when it made one, else by name.
    if (set.agentIds.length) {
      const pos = new Map(set.agentIds.map((id, i) => [id, i]));
      views.sort((a, b) => (pos.get(a.userId) ?? 999) - (pos.get(b.userId) ?? 999));
    }
    return views;
  }

  /**
   * Pick the person for a conversation and record it. Returns their user id,
   * or null (the bot keeps it). Never throws — a failed pick must not cost
   * the customer their reply.
   */
  async route(tenantId: string, threadId: string, customerId: string | null, opts: { excludeUserId?: string | null; reason?: 'new' | 'reassign-unread' | 'reassign-unreplied' } = {}): Promise<string | null> {
    try {
      const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
      const set = settingsOf(conn);
      if (set.mode !== 'round-robin') return null;
      const all = await this.agents(tenantId, set);
      const pool = all.filter((a) => a.inRotation);
      if (!pool.length) return null;
      // Đợt 2: which Pages each person takes, group A first for ad customers, weights.
      const team = await this.teamOf(tenantId);
      const th = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { pageId: true, channel: true, adId: true, adAt: true } }).catch(() => null) as { pageId?: string | null; channel?: string | null; adId?: string | null; adAt?: Date | null } | null;
      const pools = poolsFor(pool.map((a) => ({ userId: a.userId, onShift: a.onDuty, openThreads: a.openThreads, turnsToday: a.turnsToday })), team, { source: sourceOf(th?.pageId, th?.channel), fromAd: !!th && isAdThread(th, new Date()) });

      let usualUserId: string | null = null;
      if (set.preferUsualTech && customerId) {
        const last = await this.db.appointment.findFirst({
          where: { tenantId, customerId, assignedStaffId: { not: null } },
          orderBy: { startTime: 'desc' },
          select: { assignedStaff: { select: { userId: true } } },
        }).catch(() => null) as { assignedStaff?: { userId: string | null } | null } | null;
        usualUserId = last?.assignedStaff?.userId ?? null;
      }

      let pick: { userId: string | null; reason: PickReason } = { userId: null, reason: 'nobody-on-shift' };
      for (const cand of pools) {
        const ids = new Set(cand.map((c) => c.userId));
        const sub = pool.filter((a) => ids.has(a.userId));
        if (!sub.length) continue;
        // The usual technician still wins inside the pool, whatever the rotation.
        const usual = set.preferUsualTech && usualUserId ? sub.find((a) => a.userId === usualUserId && a.onDuty && a.userId !== opts.excludeUserId && (set.maxOpenPerAgent <= 0 || a.openThreads < set.maxOpenPerAgent)) : null;
        if (usual) { pick = { userId: usual.userId, reason: 'usual-technician' }; break; }
        if (set.rotation === 'weighted') {
          const id = pickWeighted(cand, team, set.maxOpenPerAgent, opts.excludeUserId ?? null);
          if (id) { pick = { userId: id, reason: 'round-robin' }; break; }
          continue;
        }
        const p = pickAgent({
          rules: { mode: 'round-robin', rotation: set.rotation, maxOpenPerAgent: set.maxOpenPerAgent, preferUsualTech: false },
          agents: sub.map((a) => ({ userId: a.userId, name: a.name, onShift: a.onDuty, openThreads: a.openThreads })),
          usualUserId: null,
          lastAssignedUserId: (conn?.chatLastAssignedId as string | null) ?? null,
          excludeUserId: opts.excludeUserId ?? null,
        });
        if (p.userId) { pick = p; break; }
        pick = p;
      }
      if (!pick.userId) return null;
      await this.recordTurn(tenantId, threadId, pick.userId, opts.reason && opts.reason !== 'new' ? opts.reason : pick.reason, opts.excludeUserId ?? null, null, pick.reason === 'usual-technician' ? false : true);
      return pick.userId;
    } catch (e) {
      this.logger.warn(`routing failed, bot keeps the thread: ${String(e).slice(0, 160)}`);
      return null;
    }
  }

  /** Write the assignment, move the rotation pointer, log it, wake the person. */
  private async recordTurn(tenantId: string, threadId: string, userId: string, reason: PickReason | string, fromUserId: string | null, byUserId: string | null, movePointer: boolean): Promise<void> {
    const hop = reason === 'reassign-unread' || reason === 'reassign-unreplied';
    await this.db.messengerThread.updateMany({
      where: { id: threadId, tenantId },
      data: { assignedUserId: userId, assignedAt: new Date(), ...(hop ? { assignHops: { increment: 1 } } : { assignHops: 0 }) },
    }).catch(() => undefined);
    if (movePointer) {
      await this.prisma.messengerConnection.update({ where: { tenantId }, data: { chatLastAssignedId: userId } as never }).catch(() => undefined);
    }
    await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId, fromUserId, byUserId, reason: String(reason) } }).catch(() => undefined);
    this.events.publish(tenantId, 'thread');
    const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { senderName: true, lastText: true, adId: true, adAt: true } }).catch(() => null) as { senderName?: string | null; adId?: string | null; adAt?: Date | null } | null;
    const now = new Date();
    const fromAd = !!t && isAdThread(t, now);
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const mins = t ? unrepliedMinsFor(t, settingsOf(conn), now) : 0;
    void this.push?.sendToUser(tenantId, userId, {
      title: fromAd ? 'Khách mới từ QUẢNG CÁO' : hop ? 'Chuyển turn cho bạn' : 'Bạn có turn chat mới',
      body: `${t?.senderName || 'Khách'} đang nhắn${mins > 0 ? ` — trả lời trong ${mins} phút` : ''}. Mở Inbox để trả lời.`,
      url: `/salon/inbox?thread=${threadId}`,
      tag: `chat-turn-${threadId}`,
    }).catch(() => undefined);
    void this.staff?.notifyTurn(tenantId, userId, threadId, { hop, fromAd, mins }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- team (đợt 2) ----

  async teamOf(tenantId: string): Promise<TeamConfig> {
    const row = await Promise.resolve().then(() => this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: TEAM_KEY } } })).catch(() => null);
    return row ? cleanTeam(row.value) : DEFAULT_TEAM;
  }

  /** The Pages / Instagram accounts a person can be limited to, by name. */
  private async sources(tenantId: string): Promise<{ key: string; label: string }[]> {
    const pages = await Promise.resolve().then(() => this.prisma.messengerPage.findMany({ where: { tenantId }, select: { pageId: true, pageName: true, igId: true, igUsername: true } })).catch(() => [] as { pageId: string; pageName: string | null; igId: string | null; igUsername: string | null }[]);
    const out: { key: string; label: string }[] = [];
    for (const p of pages) {
      out.push({ key: sourceOf(p.pageId, 'messenger'), label: `${p.pageName || p.pageId} · Messenger` });
      if (p.igId) out.push({ key: sourceOf(p.pageId, 'instagram'), label: `${p.igUsername ? '@' + p.igUsername : p.pageName || p.pageId} · Instagram` });
    }
    return out;
  }

  async team(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    return { team: await this.teamOf(tenantId), sources: await this.sources(tenantId) };
  }

  async saveTeam(user: AuthenticatedUser, raw: unknown) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) throw new ForbiddenException('Only the salon admin can change the team.');
    // Only people of THIS salon may be put in its team.
    const ids = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true } }).catch(() => []);
    const team = cleanTeam(raw, new Set(ids.map((u) => u.id)));
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: TEAM_KEY } }, create: { tenantId, key: TEAM_KEY, value: team as never }, update: { value: team as never } });
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: 'messenger.turn_team_updated', resourceType: 'tenant', resourceId: tenantId } }).catch(() => undefined);
    return this.team(user);
  }

  /**
   * A person answered: the first answer on a turn they hold is logged, so the
   * scoreboard can time it. Never throws.
   */
  async noteReply(tenantId: string, threadId: string, userId: string): Promise<void> {
    try {
      const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { assignedUserId: true, assignedAt: true } }) as { assignedUserId: string | null; assignedAt: Date | null } | null;
      if (!t?.assignedUserId || t.assignedUserId !== userId || !t.assignedAt) return;
      const seen = await this.db.chatAssignmentLog?.findFirst({ where: { tenantId, threadId, userId, reason: 'first-reply', createdAt: { gte: t.assignedAt } }, select: { id: true } });
      if (seen) return;
      await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId, reason: 'first-reply' } });
    } catch { /* never break a reply */ }
  }

  /**
   * The scoreboard for the last `days` days. The owner sees everyone; a member
   * of staff sees only their own row.
   */
  async scoreboardView(user: AuthenticatedUser, daysRaw?: number) {
    const tenantId = this.tenantOf(user);
    const isAdmin = user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN;
    const days = daysRaw === 7 || daysRaw === 30 ? daysRaw : 1;
    const out = await this.computeScores(tenantId, days, new Date());
    return { ...out, scores: isAdmin ? out.scores : out.scores.filter((s) => s.userId === user.userId), canSeeAll: isAdmin };
  }

  private async computeScores(tenantId: string, days: number, now: Date) {
    const since = new Date(now.getTime() - days * 24 * 3600_000);
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const set = settingsOf(conn);
    const team = await this.teamOf(tenantId);
    const logs = await this.db.chatAssignmentLog?.findMany({ where: { tenantId, createdAt: { gte: since } }, select: { threadId: true, userId: true, fromUserId: true, reason: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 5000 }).catch(() => []) as LogRow[] ?? [];
    const threadIds = Array.from(new Set(logs.map((l) => l.threadId)));
    const rows = threadIds.length ? await this.db.messengerThread.findMany({ where: { tenantId, id: { in: threadIds } }, select: { id: true, adId: true, adAt: true, customerId: true } }).catch(() => []) as ThreadFacts[] : [];
    const facts = new Map(rows.map((t) => [t.id, t]));
    const limit = (t: ThreadFacts | undefined) => (t ? unrepliedMinsFor(t, set, now) : set.reassignUnrepliedMins);
    const scores = scoreboard(logs, facts, limit);
    const users = await this.prisma.user.findMany({ where: { tenantId, id: { in: scores.map((s) => s.userId) } }, select: { id: true, firstName: true, lastName: true, email: true } }).catch(() => []);
    const name = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    // Ad customers of the period and when each first got a human answer.
    const adThreads = await this.db.messengerThread.findMany({ where: { tenantId, adAt: { gte: since } }, select: { id: true, adId: true, adAt: true, customerId: true }, take: 2000 }).catch(() => []) as ThreadFacts[];
    const first = new Map<string, Date>();
    for (const l of logs) if (l.reason === 'first-reply' && !first.has(l.threadId)) first.set(l.threadId, l.createdAt);
    const adLimit = set.reassignAdMins > 0 ? set.reassignAdMins : set.reassignUnrepliedMins;
    const adWaiting = adWaits(adThreads, first, adLimit, now);
    return {
      days, adCustomers: adThreads.length, adWaiting, adLimitMins: adLimit,
      adMoneyCents: team.adCostCents > 0 ? adWaiting * team.adCostCents : null,
      scores: scores.map((s) => ({ ...s, name: name.get(s.userId) ?? '—' })),
    };
  }

  // ---------------------------------------------------------------- API ----

  async view(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const settings = settingsOf(conn);
    const agents = await this.agents(tenantId, settings);
    const recent = await this.db.chatAssignmentLog?.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, threadId: true, userId: true, fromUserId: true, reason: true, createdAt: true, thread: { select: { senderName: true } } },
    }).catch(() => []) ?? [];
    const me = agents.find((a) => a.userId === user.userId) ?? null;
    const team = await this.teamOf(tenantId);
    return { settings, agents, me, recent, team, sources: await this.sources(tenantId), canEdit: user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN };
  }

  async updateSettings(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Only the salon admin can change chat turn rules.');
    }
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null);
    if (!conn) throw new BadRequestException('Connect a chat channel first.');
    const data: Record<string, unknown> = {};
    if (dto.mode === 'off' || dto.mode === 'round-robin') data.chatAssignMode = dto.mode;
    if (dto.rotation === 'strict' || dto.rotation === 'least-busy' || dto.rotation === 'weighted') data.chatRotation = dto.rotation;
    for (const [k, col] of [['botFirst', 'chatBotFirst'], ['needStatus', 'chatNeedStatus'], ['needShift', 'chatNeedShift'], ['needOnline', 'chatNeedOnline'], ['preferUsualTech', 'chatPreferUsualTech']] as const) {
      if (typeof dto[k] === 'boolean') data[col] = dto[k];
    }
    const ints: [string, string, number, number][] = [
      ['onlineMins', 'chatOnlineMins', 1, 120], ['maxOpenPerAgent', 'chatMaxOpenPerAgent', 0, 50],
      ['reassignUnreadMins', 'chatReassignUnreadMins', 0, 240], ['reassignUnrepliedMins', 'chatReassignUnrepliedMins', 0, 240],
      ['maxHops', 'chatMaxHops', 0, 10],
      ['reassignAdMins', 'chatReassignAdMins', 0, 240], ['escalateMins', 'chatEscalateMins', 0, 240],
    ];
    for (const [k, col, lo, hi] of ints) { const v = clampInt(dto[k], lo, hi); if (v !== undefined) data[col] = v; }
    if (Array.isArray(dto.agentIds)) {
      // Only people of THIS salon may be put in its queue.
      const wanted = (dto.agentIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 200);
      const ok = await this.prisma.user.findMany({ where: { tenantId, id: { in: wanted } }, select: { id: true } }).catch(() => []);
      const okSet = new Set(ok.map((u) => u.id));
      data.chatAgentIds = wanted.filter((id) => okSet.has(id));
    }
    await this.prisma.messengerConnection.update({ where: { tenantId }, data: data as never });
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: 'messenger.chat_turns_updated', resourceType: 'tenant', resourceId: tenantId } }).catch(() => undefined);
    return this.view(user);
  }

  async setStatus(user: AuthenticatedUser, status: string) {
    const tenantId = this.tenantOf(user);
    const s = status === 'away' ? 'away' : 'available';
    await this.db.chatAgentPresence.upsert({
      where: { tenantId_userId: { tenantId, userId: user.userId } },
      update: { status: s, lastSeenAt: new Date() },
      create: { tenantId, userId: user.userId, status: s, lastSeenAt: new Date() },
    });
    return { status: s };
  }

  async heartbeat(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    await this.db.chatAgentPresence.upsert({
      where: { tenantId_userId: { tenantId, userId: user.userId } },
      update: { lastSeenAt: new Date() },
      create: { tenantId, userId: user.userId, lastSeenAt: new Date() },
    }).catch(() => undefined);
    return { ok: true };
  }

  /**
   * Hand a conversation to someone by hand (or take it back to nobody).
   * The admin may move any conversation; staff may move only one that is
   * theirs or nobody's. Both the thread and the person must belong to the
   * caller's salon — checked, not assumed.
   */
  async assign(user: AuthenticatedUser, threadId: string, toUserId: string | null) {
    const tenantId = this.tenantOf(user);
    const thread = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { id: true, assignedUserId: true } });
    if (!thread) throw new NotFoundException('Thread not found');
    const isAdmin = user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN;
    if (!isAdmin && thread.assignedUserId && thread.assignedUserId !== user.userId) {
      // The salon may let staff TAKE a conversation (to themselves only), never move it elsewhere.
      const team = await this.teamOf(tenantId);
      if (!(team.staffCanTake && toUserId === user.userId)) throw new ForbiddenException('This conversation belongs to someone else. Ask the salon admin to move it.');
    }
    if (toUserId) {
      const target = await this.prisma.user.findFirst({ where: { id: toUserId, tenantId, isActive: true, role: { in: INBOX_ROLES as unknown as UserRole[] } }, select: { id: true } });
      if (!target) throw new BadRequestException('That person is not on this salon\'s team.');
      await this.recordTurn(tenantId, threadId, toUserId, 'manual', thread.assignedUserId ?? null, user.userId, false);
    } else {
      await this.db.messengerThread.updateMany({ where: { id: threadId, tenantId }, data: { assignedUserId: null, assignedAt: null, assignHops: 0 } });
      await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId: null, fromUserId: thread.assignedUserId ?? null, byUserId: user.userId, reason: 'unassign' } }).catch(() => undefined);
      this.events.publish(tenantId, 'thread');
    }
    return { ok: true };
  }

  // -------------------------------------------------------- the minute ----

  /**
   * Once a minute: pass on conversations whose person did not open or answer
   * them in the time the salon set. One salon at a time, each scoped by its
   * own id; the update is conditional on the assignment not having changed
   * since it was read, so two ticks can never double-pass one conversation.
   */
  async tick(now: Date = new Date()): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let moved = 0;
    try {
      const conns = await this.db.messengerConnection.findMany({
        where: { chatAssignMode: 'round-robin' },
        take: 500,
      }).catch(() => []) as Record<string, unknown>[];
      for (const c of conns) {
        const tenantId = String(c.tenantId);
        const set = settingsOf(c);
        if (set.escalateMins > 0) await this.escalate(tenantId, set, now).catch((e) => this.logger.warn(`escalation failed: ${String(e).slice(0, 120)}`));
        await this.nightReport(tenantId, now).catch((e) => this.logger.warn(`turn report failed: ${String(e).slice(0, 120)}`));
        const mins = [set.reassignUnreadMins, set.reassignUnrepliedMins, set.reassignAdMins].filter((m) => m > 0);
        if (!mins.length) continue;
        const shortest = Math.min(...mins);
        const threads = await this.db.messengerThread.findMany({
          where: { tenantId, status: 'open', assignedUserId: { not: null }, assignedAt: { lte: new Date(now.getTime() - shortest * 60_000) }, assignHops: { lt: set.maxHops } },
          select: { id: true, customerId: true, status: true, assignedUserId: true, assignedAt: true, readAt: true, handoffAt: true, handoffMode: true, assignHops: true, adId: true, adAt: true },
          take: 50,
        }).catch(() => []) as { id: string; customerId: string | null; assignedUserId: string; assignedAt: Date; adId?: string | null; adAt?: Date | null }[];
        for (const t of threads) {
          // A customer from an ad is passed on sooner when the salon set it (./staff-alerts).
          const un = unrepliedMinsFor(t, set, now);
          const unread = isAdThread(t, now) && set.reassignAdMins > 0 && set.reassignUnreadMins > 0 ? Math.min(set.reassignUnreadMins, set.reassignAdMins) : set.reassignUnreadMins;
          const why = reassignDue(t as never, { unreadMins: unread, unrepliedMins: un, maxHops: set.maxHops }, now);
          if (!why) continue;
          // Claim it first: only if nobody moved it since we read it.
          const claimed = await this.db.messengerThread.updateMany({
            where: { id: t.id, tenantId, assignedUserId: t.assignedUserId, assignedAt: t.assignedAt },
            data: { assignedAt: now },
          }).catch(() => ({ count: 0 }));
          if (!claimed.count) continue;
          const to = await this.route(tenantId, t.id, t.customerId, { excludeUserId: t.assignedUserId, reason: why });
          if (to) moved += 1;
          else {
            // Nobody else free: keep the person, count the attempt so it stops
            // asking after maxHops instead of every minute forever.
            await this.db.messengerThread.updateMany({ where: { id: t.id, tenantId }, data: { assignHops: { increment: 1 } } }).catch(() => undefined);
          }
        }
      }
    } catch (e) {
      this.logger.warn(`turn tick failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.ticking = false;
    }
    return moved;
  }

  /** 21:00 salon time, once a day, when the owner asked for it: today's scoreboard on their phone. */
  private async nightReport(tenantId: string, now: Date): Promise<void> {
    const team = await this.teamOf(tenantId);
    if (!team.nightReport) return;
    const clock = await this.salonClock(tenantId);
    if (!clock || clock.minutes < 21 * 60) return;
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: t?.timezone || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const sent = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: REPORT_SENT_KEY } } }).catch(() => null);
    if ((sent?.value as { day?: string } | null)?.day === day) return;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: REPORT_SENT_KEY } }, create: { tenantId, key: REPORT_SENT_KEY, value: { day } }, update: { value: { day } } });
    const sc = await this.computeScores(tenantId, 1, now);
    if (!sc.scores.length && !sc.adWaiting) return;
    const money = sc.adMoneyCents != null ? new Intl.NumberFormat('vi-VN').format(sc.adMoneyCents) : null;
    const text = nightText({ scores: sc.scores, adWaiting: sc.adWaiting, money });
    const owners = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: UserRole.SALON_ADMIN }, select: { id: true } }).catch(() => []);
    for (const o of owners) void this.push?.sendToUser(tenantId, o.id, { title: 'Báo cáo chia turn hôm nay', body: text.split('\n').slice(1, 4).join(' · '), url: '/salon/messenger?tab=turns', tag: `turn-report-${day}` }).catch(() => undefined);
    void this.staff?.notifyEscalation(tenantId, owners.map((o) => o.id), text).catch(() => 0);
  }

  /**
   * A customer has waited too long with nobody from the team answering:
   * tell the salon's owners (push, and their own Messenger when on shift),
   * once per wait. Only conversations a person is meant to handle — given to
   * someone, or handed over by the AI.
   */
  async escalate(tenantId: string, set: TurnSettings, now: Date = new Date()): Promise<number> {
    const since = new Date(now.getTime() - 6 * 3600_000);
    const rows = await this.db.messengerThread.findMany({
      where: { tenantId, status: 'open', lastCustomerAt: { gte: since, lte: new Date(now.getTime() - set.escalateMins * 60_000) }, OR: [{ assignedUserId: { not: null } }, { handoff: true }] },
      select: { id: true, status: true, senderName: true, lastCustomerAt: true, handoffAt: true, escalatedAt: true, assignedUserId: true, assignHops: true, adId: true, adAt: true },
      take: 50,
    }).catch(() => []) as { id: string; status: string; senderName: string | null; lastCustomerAt: Date; handoffAt: Date | null; escalatedAt: Date | null; assignedUserId: string | null; assignHops: number; adId: string | null; adAt: Date | null }[];
    const due = rows.filter((t) => escalationDue(t, set.escalateMins, now));
    if (!due.length) return 0;
    const owners = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: UserRole.SALON_ADMIN }, select: { id: true } }).catch(() => []);
    for (const t of due) {
      const done = await this.db.messengerThread.updateMany({ where: { id: t.id, tenantId, OR: [{ escalatedAt: null }, { escalatedAt: { lt: t.lastCustomerAt } }] }, data: { escalatedAt: now } }).catch(() => ({ count: 0 }));
      if (!done.count) continue;
      const waited = Math.round((now.getTime() - new Date(t.lastCustomerAt).getTime()) / 60_000);
      const text = `🚨 ${t.senderName || 'Khách'}${isAdThread(t, now) ? ' (từ QUẢNG CÁO)' : ''} đã chờ ${waited} phút, chưa ai trả lời${t.assignHops ? ` · đã chuyển ${t.assignHops} lần` : ''}.`;
      for (const o of owners) {
        void this.push?.sendToUser(tenantId, o.id, { title: 'Khách chờ quá lâu', body: text, url: `/salon/inbox?thread=${t.id}`, tag: `chat-escalate-${t.id}` }).catch(() => undefined);
      }
      void this.staff?.notifyEscalation(tenantId, owners.map((o) => o.id), `${text}
Mở Lumio › Hộp thư để trả lời.`).catch(() => 0);
      await this.db.auditLog?.create({ data: { tenantId, action: 'messenger.turn_escalated', resourceType: 'messenger', resourceId: t.id, metadata: { waited } } }).catch(() => undefined);
      this.events.publish(tenantId, 'thread');
    }
    return due.length;
  }
}
