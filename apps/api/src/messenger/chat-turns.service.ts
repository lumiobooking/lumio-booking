import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { InboxEventsService } from './inbox-events.service';
import { isOnDuty, isOnShift, pickAgent, reassignDue, type PickReason } from './chat-assignment';

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
  rotation: 'strict' | 'least-busy';
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
}

type ConnRow = Record<string, unknown> | null;

export function settingsOf(c: ConnRow): TurnSettings {
  const n = (k: string, d: number) => (typeof c?.[k] === 'number' ? (c[k] as number) : d);
  const b = (k: string, d: boolean) => (typeof c?.[k] === 'boolean' ? (c[k] as boolean) : d);
  return {
    mode: c?.chatAssignMode === 'round-robin' ? 'round-robin' : 'off',
    rotation: c?.chatRotation === 'least-busy' ? 'least-busy' : 'strict',
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
  ) {}

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
    const logs = await this.db.chatAssignmentLog?.groupBy({ by: ['userId'], where: { tenantId, createdAt: { gte: since }, userId: { not: null }, reason: { not: 'unassign' } }, _count: true }).catch(() => []) ?? [];
    const turnsBy = new Map<string, number>(logs.map((r: { userId: string; _count: number }) => [r.userId, Number(r._count) || 0]));
    const clock = await this.salonClock(tenantId);
    const now = new Date();
    const inList = (id: string) => (set.agentIds.length ? set.agentIds.includes(id) : true);

    const views = users.map((u) => {
      const p = presBy.get(u.id);
      const hours = u.staffMember?.workingHours ?? [];
      const onShift = !u.staffMember || !hours.length ? null : (clock ? isOnShift(hours, clock.weekday, clock.minutes) : null);
      const status = p?.status === 'away' ? 'away' as const : 'available' as const;
      const online = !!p?.lastSeenAt && now.getTime() - new Date(p.lastSeenAt).getTime() <= Math.max(1, set.onlineMins) * 60_000;
      return {
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
        role: String(u.role),
        inRotation: inList(u.id),
        status,
        online,
        onShift,
        onDuty: isOnDuty({ status, onShift, lastSeenAt: p?.lastSeenAt ?? null }, set, now),
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

      let usualUserId: string | null = null;
      if (set.preferUsualTech && customerId) {
        const last = await this.db.appointment.findFirst({
          where: { tenantId, customerId, assignedStaffId: { not: null } },
          orderBy: { startTime: 'desc' },
          select: { assignedStaff: { select: { userId: true } } },
        }).catch(() => null) as { assignedStaff?: { userId: string | null } | null } | null;
        usualUserId = last?.assignedStaff?.userId ?? null;
      }

      const pick = pickAgent({
        rules: { mode: 'round-robin', rotation: set.rotation, maxOpenPerAgent: set.maxOpenPerAgent, preferUsualTech: set.preferUsualTech },
        agents: pool.map((a) => ({ userId: a.userId, name: a.name, onShift: a.onDuty, openThreads: a.openThreads })),
        usualUserId,
        lastAssignedUserId: (conn?.chatLastAssignedId as string | null) ?? null,
        excludeUserId: opts.excludeUserId ?? null,
      });
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
    const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { senderName: true, lastText: true } }).catch(() => null) as { senderName?: string | null } | null;
    void this.push?.sendToUser(tenantId, userId, {
      title: hop ? 'Chuyển turn cho bạn' : 'Bạn có turn chat mới',
      body: `${t?.senderName || 'Khách'} đang nhắn — mở Inbox để theo dõi.`,
      url: '/salon/inbox',
      tag: `chat-turn-${threadId}`,
    }).catch(() => undefined);
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
    return { settings, agents, me, recent, canEdit: user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN };
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
    if (dto.rotation === 'strict' || dto.rotation === 'least-busy') data.chatRotation = dto.rotation;
    for (const [k, col] of [['botFirst', 'chatBotFirst'], ['needStatus', 'chatNeedStatus'], ['needShift', 'chatNeedShift'], ['needOnline', 'chatNeedOnline'], ['preferUsualTech', 'chatPreferUsualTech']] as const) {
      if (typeof dto[k] === 'boolean') data[col] = dto[k];
    }
    const ints: [string, string, number, number][] = [
      ['onlineMins', 'chatOnlineMins', 1, 120], ['maxOpenPerAgent', 'chatMaxOpenPerAgent', 0, 50],
      ['reassignUnreadMins', 'chatReassignUnreadMins', 0, 240], ['reassignUnrepliedMins', 'chatReassignUnrepliedMins', 0, 240],
      ['maxHops', 'chatMaxHops', 0, 10],
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
      throw new ForbiddenException('This conversation belongs to someone else. Ask the salon admin to move it.');
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
        where: { chatAssignMode: 'round-robin', OR: [{ chatReassignUnreadMins: { gt: 0 } }, { chatReassignUnrepliedMins: { gt: 0 } }] },
        take: 500,
      }).catch(() => []) as Record<string, unknown>[];
      for (const c of conns) {
        const tenantId = String(c.tenantId);
        const set = settingsOf(c);
        const shortest = Math.min(...[set.reassignUnreadMins, set.reassignUnrepliedMins].filter((m) => m > 0));
        const threads = await this.db.messengerThread.findMany({
          where: { tenantId, status: 'open', assignedUserId: { not: null }, assignedAt: { lte: new Date(now.getTime() - shortest * 60_000) }, assignHops: { lt: set.maxHops } },
          select: { id: true, customerId: true, status: true, assignedUserId: true, assignedAt: true, readAt: true, handoffAt: true, handoffMode: true, assignHops: true },
          take: 50,
        }).catch(() => []) as { id: string; customerId: string | null; assignedUserId: string; assignedAt: Date }[];
        for (const t of threads) {
          const why = reassignDue(t as never, { unreadMins: set.reassignUnreadMins, unrepliedMins: set.reassignUnrepliedMins, maxHops: set.maxHops }, now);
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
}
