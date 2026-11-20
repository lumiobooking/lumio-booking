import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { InboxEventsService } from './inbox-events.service';
import { isOnDuty, isOnShift, pickAgent, reassignDue, type PickReason } from './chat-assignment';
import { StaffAlertsService } from './staff-alerts.service';
import { escalationDue, isAdThread, unrepliedMinsFor, windowOpen } from './staff-alerts';
import { STANDARD_TEAM, firstEnable, standardColumns } from './turn-standard';
import { SHIFT_PREFIX, cleanShift, remindDue, rescueOpen, shiftActive, shiftExpired, shiftKey, shiftUntil, type Shift } from './turn-shift';
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
  /** rt216: when they last got a turn (ms), for fair ties. */
  lastTurnAt?: number | null;
  /** Pressed "Vào ca" in Lumio (or on Messenger) and the shift has not ended. */
  shiftOn: boolean;
  shiftUntil: string | null;
  /** Phones/browsers of this person that get push (owner's view only). */
  devices?: number;
  /** rt206: why this person is not taking customers right now (empty = taking them). */
  blockers: TurnBlocker[];
  /** rt208: this person can open the Inbox (their app shows it). */
  canInbox: boolean;
}

/** rt206 — the reasons a person is not given a customer, in words the owner can act on. */
export type TurnBlocker = 'not-in-list' | 'away' | 'off-hours' | 'not-present' | 'full' | 'weight-zero' | 'no-inbox';

/**
 * rt207 — who can actually answer: the owner, and staff whose role opens the
 * Inbox (messages-only, front desk, manager, or a desk permission the owner
 * gave). A technician's account opens the technicians' app, where the Inbox
 * is closed — giving them a customer meant nobody saw it, and it went round
 * the team every few minutes unopened.
 */
export function canOpenInbox(role: string, staffRole: string | null | undefined, permissions: unknown, listed = false): boolean {
  if (role !== 'STAFF') return role === 'SALON_ADMIN';
  // rt208: the owner ticked this person by name in the Chia turn list — they
  // answer customers, whatever their role. Their technicians' app shows the Inbox.
  if (listed) return true;
  if (['CHAT', 'RECEPTIONIST', 'MANAGER'].includes(String(staffRole ?? ''))) return true;
  return Array.isArray(permissions) && permissions.length > 0 && String(staffRole ?? '') !== 'TECHNICIAN';
}
export type TurnMiss = { at: string; customer: string | null; why: 'rules-off' | 'nobody-in-list' | 'nobody-on-duty' | 'everyone-full' | 'no-match' | 'no-inbox'; agents: { name: string; blockers: TurnBlocker[] }[] };

const INBOX_ROLES = [UserRole.SALON_ADMIN, UserRole.STAFF] as const;
const TICK_MS = 60_000;
/** Log rows that are not a live turn given to someone (fairness counts and "turns today"). */
const NOT_TURNS = ['unassign', 'first-reply', 'backlog', 'opened', 'prospect', 'customer-back'];
/** A turn passed on from someone who did not act: not opened, not answered, or skipped on Messenger. */
const MISS_REASONS = ['reassign-unread', 'reassign-unreplied', 'skip'];

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
    this.staff?.setSkipRouter((tenantId, threadId, fromUserId) => this.route(tenantId, threadId, null, { excludeUserId: fromUserId, reason: 'skip' }));
    // "vào ca" / "ra ca" on Messenger opens / closes the same shift as the button.
    this.staff?.setShiftHook?.((tenantId, userId, on) => this.writeShift(tenantId, userId, on));
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
    // rt223: the eight lookups below do not depend on each other — asked at
    // once instead of one after another (GET /messenger/turns measured ~1.1 s
    // p50, called on every inbox refresh; each round trip to the database
    // costs the same whether it waits in line or not).
    const since = new Date(Date.now() - 24 * 3600_000);
    const pPresence = Promise.resolve().then(() => this.db.chatAgentPresence?.findMany({ where: { tenantId }, select: { userId: true, status: true, lastSeenAt: true } }) ?? []).catch(() => []);
    const pOpen = Promise.resolve().then(() => this.db.messengerThread.groupBy({ by: ['assignedUserId'], where: { tenantId, status: 'open', assignedUserId: { not: null } }, _count: true })).catch(() => []);
    const pLogs = Promise.resolve().then(() => this.db.chatAssignmentLog?.groupBy({ by: ['userId'], where: { tenantId, createdAt: { gte: since }, userId: { not: null }, reason: { notIn: NOT_TURNS } }, _count: true, _max: { createdAt: true } }) ?? []).catch(() => []);
    const pClock = this.salonClock(tenantId).catch(() => null);
    const pLinks = this.staff ? this.staff.linksOf(tenantId).catch(() => ({})) : Promise.resolve({});
    const pShifts = this.shiftsOf(tenantId).catch(() => new Map<string, Shift>());
    const conn = s ? null : await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null);
    const set = s ?? settingsOf(conn as ConnRow);
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: INBOX_ROLES as unknown as UserRole[] } },
      select: {
        id: true, firstName: true, lastName: true, email: true, role: true,
        staffMember: { select: { isActive: true, staffRole: true, permissions: true, workingHours: { select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true } } } },
      } as never,
      orderBy: { firstName: 'asc' },
      take: 200,
    }).catch(() => []) as unknown as {
      id: string; firstName: string | null; lastName: string | null; email: string; role: string;
      staffMember: { isActive: boolean; staffRole?: string | null; permissions?: unknown; workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[] } | null;
    }[];
    const presence = (await pPresence) as { userId: string; status: string; lastSeenAt: Date | null }[];
    const presBy = new Map<string, { status: string; lastSeenAt: Date | null }>(presence.map((p: { userId: string; status: string; lastSeenAt: Date | null }) => [p.userId, p]));
    const open = (await pOpen) as { assignedUserId: string; _count: number }[];
    const openBy = new Map(open.map((r) => [r.assignedUserId, Number(r._count) || 0]));
    const logs = (await pLogs) as { userId: string; _count: number; _max?: { createdAt?: Date | null } }[];
    const turnsBy = new Map<string, number>(logs.map((r: { userId: string; _count: number }) => [r.userId, Number(r._count) || 0]));
    const lastBy = new Map<string, number>(logs.map((r: { userId: string; _max?: { createdAt?: Date | null } }) => [r.userId, r._max?.createdAt ? new Date(r._max.createdAt).getTime() : 0]));
    const clock = await pClock;
    const now = new Date();
    // On shift through their own Messenger ("vào ca") counts as having Lumio open.
    const links = await pLinks;
    const onMsgr = (id: string) => windowOpen((links as Record<string, never>)[id], now);
    const inList = (id: string) => (set.agentIds.length ? set.agentIds.includes(id) : true);
    // rt198: "Vào ca" pressed in Lumio counts as present, app open or not.
    const shifts = await pShifts;

    const views = users.map((u) => {
      const p = presBy.get(u.id);
      const hours = u.staffMember?.workingHours ?? [];
      const onShift = !u.staffMember || !hours.length ? null : (clock ? isOnShift(hours, clock.weekday, clock.minutes) : null);
      const status = p?.status === 'away' ? 'away' as const : 'available' as const;
      const sh = shifts.get(u.id) ?? null;
      const inShift = shiftActive(sh, now);
      const present = onMsgr(u.id) || inShift;
      const online = present || (!!p?.lastSeenAt && now.getTime() - new Date(p.lastSeenAt).getTime() <= Math.max(1, set.onlineMins) * 60_000);
      return {
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
        role: String(u.role),
        inRotation: inList(u.id),
        status,
        online,
        onShift,
        // Pressing "Vào ca" is the person saying they work now — also outside their usual hours.
        onDuty: canOpenInbox(String(u.role), u.staffMember?.staffRole, u.staffMember?.permissions, set.agentIds.includes(u.id)) && isOnDuty({ status, onShift: inShift ? true : onShift, lastSeenAt: present ? now : p?.lastSeenAt ?? null }, set, now),
        openThreads: openBy.get(u.id) ?? 0,
        turnsToday: turnsBy.get(u.id) ?? 0,
        lastTurnAt: lastBy.get(u.id) || null,
        shiftOn: inShift,
        shiftUntil: inShift ? sh?.until ?? null : null,
        canInbox: canOpenInbox(String(u.role), u.staffMember?.staffRole, u.staffMember?.permissions, set.agentIds.includes(u.id)),
        blockers: ([
          !canOpenInbox(String(u.role), u.staffMember?.staffRole, u.staffMember?.permissions, set.agentIds.includes(u.id)) ? 'no-inbox' : null,
          !inList(u.id) ? 'not-in-list' : null,
          set.needStatus && status === 'away' ? 'away' : null,
          set.needShift && onShift === false && !inShift ? 'off-hours' : null,
          set.needOnline && !online ? 'not-present' : null,
          set.maxOpenPerAgent > 0 && (openBy.get(u.id) ?? 0) >= set.maxOpenPerAgent ? 'full' : null,
        ].filter(Boolean) as TurnBlocker[]),
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
  /** rt216: who already had this customer in the current round (since the last fresh turn). */
  private async roundHolders(tenantId: string, threadId: string): Promise<string[]> {
    const logs = await this.db.chatAssignmentLog?.findMany({ where: { tenantId, threadId }, orderBy: { createdAt: 'desc' }, take: 60, select: { userId: true, reason: true } }).catch(() => []) ?? [];
    const out = new Set<string>();
    for (const l of logs as { userId: string | null; reason: string }[]) {
      if (NOT_TURNS.includes(l.reason) && l.reason !== 'customer-back') continue;
      if (l.userId) out.add(l.userId);
      if (!MISS_REASONS.includes(l.reason)) break; // the turn that started this round
    }
    return [...out];
  }

  async route(tenantId: string, threadId: string, customerId: string | null, opts: { excludeUserId?: string | null; reason?: 'new' | 'reassign-unread' | 'reassign-unreplied' | 'skip' } = {}): Promise<string | null> {
    try {
      const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
      const set = settingsOf(conn);
      if (set.mode !== 'round-robin') return null;
      const all = await this.agents(tenantId, set);
      const pool = all.filter((a) => a.inRotation);
      if (!pool.length) { this.noteMiss(tenantId, { at: new Date().toISOString(), customer: null, why: 'nobody-in-list', agents: all.map((a) => ({ name: a.name, blockers: a.blockers })) }); return null; }
      // Đợt 2: which Pages each person takes, group A first for ad customers, weights.
      const team = await this.teamOf(tenantId);
      const th = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { pageId: true, channel: true, adId: true, adAt: true } }).catch(() => null) as { pageId?: string | null; channel?: string | null; adId?: string | null; adAt?: Date | null } | null;
      const pools = poolsFor(pool.map((a) => ({ userId: a.userId, onShift: a.onDuty, openThreads: a.openThreads, turnsToday: a.turnsToday })), team, { source: sourceOf(th?.pageId, th?.channel), fromAd: !!th && isAdThread(th, new Date()) });
      const avoid = opts.reason && opts.reason !== 'new' ? await this.roundHolders(tenantId, threadId) : [];

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
          agents: sub.map((a) => ({ userId: a.userId, name: a.name, onShift: a.onDuty, openThreads: a.openThreads, turnsToday: a.turnsToday, lastTurnAt: a.lastTurnAt })),
          usualUserId: null,
          lastAssignedUserId: (conn?.chatLastAssignedId as string | null) ?? null,
          excludeUserId: opts.excludeUserId ?? null,
          avoid,
        });
        if (p.userId) { pick = p; break; }
        pick = p;
      }
      if (!pick.userId) {
        const team2 = team;
        const all2 = all.map((a) => ({ name: a.name, blockers: [...a.blockers, ...((team2.members[a.userId]?.weight ?? 1) <= 0 && set.rotation === 'weighted' ? ['weight-zero' as TurnBlocker] : [])] }));
        const anyOnDuty = pool.some((a) => a.onDuty);
        const anyFree = pool.some((a) => a.onDuty && !a.blockers.includes('full'));
        const c = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { senderName: true } }).catch(() => null) as { senderName?: string | null } | null;
        this.noteMiss(tenantId, { at: new Date().toISOString(), customer: c?.senderName ?? null, why: pool.every((x) => x.blockers.includes('no-inbox')) ? 'no-inbox' : !anyOnDuty ? 'nobody-on-duty' : !anyFree ? 'everyone-full' : 'no-match', agents: all2 });
        return null;
      }
      await this.recordTurn(tenantId, threadId, pick.userId, opts.reason && opts.reason !== 'new' ? opts.reason : pick.reason, opts.excludeUserId ?? null, null, pick.reason === 'usual-technician' ? false : true);
      return pick.userId;
    } catch (e) {
      this.logger.warn(`routing failed, bot keeps the thread: ${String(e).slice(0, 160)}`);
      return null;
    }
  }

  /** Write the assignment, move the rotation pointer, log it, wake the person. */
  private async recordTurn(tenantId: string, threadId: string, userId: string, reason: PickReason | string, fromUserId: string | null, byUserId: string | null, movePointer: boolean): Promise<void> {
    const hop = MISS_REASONS.includes(String(reason));
    await this.db.messengerThread.updateMany({
      where: { id: threadId, tenantId },
      data: { assignedUserId: userId, assignedAt: new Date(), ...(hop ? { assignHops: { increment: 1 } } : { assignHops: 0 }) },
    }).catch(() => undefined);
    // rt216: passes go on without end; the count stops at 98 so it never reads as an old follow-up (99).
    if (hop) await this.db.messengerThread.updateMany({ where: { id: threadId, tenantId, assignHops: { gte: 99 } }, data: { assignHops: 98 } }).catch(() => undefined);
    // rt215: "Tôi nhận" by an earlier holder locks a conversation against
    // being passed on. When the rules give it to someone else that lock is
    // the old holder's, not the new one's — left in place it froze the turn
    // for good with whoever got it next.
    if (!byUserId) await this.db.messengerThread.updateMany({ where: { id: threadId, tenantId, handoffMode: 'locked' }, data: { handoffMode: 'auto' } }).catch(() => undefined);
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

  // ------------------------------------------------- why nobody got it (rt206) ----

  /** The last customer this salon's rules could not give to anyone, and why — shown on the Chia turn tab. */
  private readonly misses = new Map<string, TurnMiss>();
  private noteMiss(tenantId: string, m: TurnMiss): void {
    this.misses.set(tenantId, m);
    if (this.misses.size > 2000) this.misses.delete(this.misses.keys().next().value as string);
  }
  lastMiss(tenantId: string): TurnMiss | null { return this.misses.get(tenantId) ?? null; }

  /**
   * A person answered a conversation nobody held: it is theirs now (so the
   * next customer line does not go to someone else). Never moves one that
   * someone holds. Never throws.
   */
  async claimIfFree(tenantId: string, threadId: string, userId: string, role?: string): Promise<void> {
    try {
      // rt217 — "khi nhân viên chủ động follow up thì khách đó là của họ, trừ
      // khi khách nhắn lại mà họ không trả lời thì mới vào vòng chia". A reply
      // makes the conversation the replier's as a FOLLOW-UP (assignHops 99):
      // no timer passes it on while they are working it. When the customer
      // writes back, noteCustomer starts a live turn with the clock — and only
      // then, if they do not answer, it goes round the team.
      const now = new Date();
      const r = await this.db.messengerThread.updateMany({ where: { id: threadId, tenantId, assignedUserId: null }, data: { assignedUserId: userId, assignedAt: now, assignHops: 99, handoffAt: now } as never });
      if (r.count) {
        await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId, byUserId: userId, reason: 'took-by-reply' } }).catch(() => undefined);
        return;
      }
      // Held by someone else. A team member (not the owner helping out) who
      // follows up a customer the holder has not answered on this turn takes
      // it over: they did the work. One the holder IS working stays theirs.
      if (role && role !== 'STAFF') return;
      const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { assignedUserId: true, assignedAt: true } }) as { assignedUserId: string | null; assignedAt: Date | null } | null;
      if (!t?.assignedUserId || t.assignedUserId === userId) {
        // Their own: a reply on a follow-up keeps it a follow-up (nothing to do).
        return;
      }
      const worked = await this.db.chatAssignmentLog?.findFirst({ where: { tenantId, threadId, userId: t.assignedUserId, reason: 'first-reply', ...(t.assignedAt ? { createdAt: { gte: t.assignedAt } } : {}) }, select: { id: true } }).catch(() => null);
      if (worked) return;
      const holder = t.assignedUserId;
      const moved = await this.db.messengerThread.updateMany({ where: { id: threadId, tenantId, assignedUserId: holder, assignedAt: t.assignedAt }, data: { assignedUserId: userId, assignedAt: now, assignHops: 99, handoffAt: now } as never });
      if (moved.count) {
        await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId, fromUserId: holder, byUserId: userId, reason: 'took-by-reply' } }).catch(() => undefined);
        this.events.publish(tenantId, 'thread');
      }
    } catch { /* never break a reply */ }
  }

  /**
   * Customers waiting with nobody holding them — they wrote last, within the
   * last 24 hours — are given out now. Runs every minute and the moment
   * someone presses "Vào ca", so a customer who wrote while nobody was on
   * shift is not left with no one.
   */
  async distributeWaiting(tenantId: string, now: Date = new Date()): Promise<number> {
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    if (settingsOf(conn).mode !== 'round-robin') return 0;
    const rows = await this.db.messengerThread.findMany({
      where: { tenantId, status: 'open', assignedUserId: null, lastCustomerAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
      select: { id: true, customerId: true, lastCustomerAt: true, lastMessageAt: true },
      orderBy: { lastCustomerAt: 'asc' },
      take: 10,
    }).catch(() => []) as { id: string; customerId: string | null; lastCustomerAt: Date | null; lastMessageAt: Date | null }[];
    let n = 0;
    for (const t of rows) {
      // The customer spoke last (no reply from anyone since): they are waiting.
      if (t.lastMessageAt && t.lastCustomerAt && t.lastMessageAt.getTime() - t.lastCustomerAt.getTime() > 1000) continue;
      const to = await this.route(tenantId, t.id, t.customerId);
      if (!to) break; // nobody free: the rest would fail the same way
      n += 1;
    }
    return n;
  }

  // ---------------------------------------------- old customers to follow up (rt211) ----

  /**
   * "Chia khách cũ": conversations from the last `days` days that nobody holds
   * (open, not done, not spam) are given out among the people ticked in the
   * Chia turn list who can open the Inbox — evenly, fewest open first — so
   * each one finds them under "Của tôi" and follows up. They are NOT passed
   * on automatically for being unanswered (assignHops at its ceiling): an old
   * customer is a follow-up, not a live chat on a timer. Each person gets one
   * notification, not one per customer. The owner only.
   */
  async distributeBacklog(user: AuthenticatedUser, daysRaw?: number) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) throw new ForbiddenException('Only the salon admin can give out conversations.');
    const days = [7, 30, 90].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const set = settingsOf(conn);
    const people = (await this.agents(tenantId, set)).filter((a) => a.inRotation && a.canInbox && a.role === 'STAFF');
    if (!people.length) throw new BadRequestException('Chưa có nhân viên nào được tích trong danh sách Chia turn.');
    const rows = await this.db.messengerThread.findMany({
      where: { tenantId, status: 'open', assignedUserId: null, lastMessageAt: { gte: new Date(Date.now() - days * 86_400_000) } },
      select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 500,
    }).catch(() => []) as { id: string }[];
    const load = new Map(people.map((p) => [p.userId, p.openThreads]));
    const given = new Map<string, number>();
    const now = new Date();
    for (const t of rows) {
      // Fewest open first; ties keep the list order.
      const to = [...people].sort((a, b) => (load.get(a.userId)! - load.get(b.userId)!))[0].userId;
      const r = await this.db.messengerThread.updateMany({ where: { id: t.id, tenantId, assignedUserId: null }, data: { assignedUserId: to, assignedAt: now, assignHops: 99 } }).catch(() => ({ count: 0 }));
      if (!r.count) continue;
      await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId: t.id, userId: to, byUserId: user.userId, reason: 'backlog' } }).catch(() => undefined);
      load.set(to, (load.get(to) ?? 0) + 1);
      given.set(to, (given.get(to) ?? 0) + 1);
    }
    for (const [uid, n] of given) {
      void this.push?.sendToUser(tenantId, uid, { title: 'Bạn được giao khách cũ để theo dõi', body: `${n} khách — mở Tin nhắn › Của tôi để nhắn lại.`, url: '/salon/inbox', tag: 'turn-backlog' }).catch(() => undefined);
    }
    const total = [...given.values()].reduce((a, b) => a + b, 0);
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: 'messenger.turn_backlog_given', resourceType: 'tenant', resourceId: tenantId, metadata: { days, total } } }).catch(() => undefined);
    this.events.publish(tenantId, 'thread');
    return { days, total, per: people.map((p) => ({ name: p.name, n: given.get(p.userId) ?? 0 })) };
  }

  /**
   * rt215 — give these conversations (nobody holds them) out among the people
   * ticked in Chia turn who open the Inbox, fewest open first, as follow-ups
   * (assignHops 99: never passed on by the timers). One notification each.
   * The owner only; every id is re-checked against this salon on write.
   */
  async giveOut(user: AuthenticatedUser, threadIds: string[], opts: { reason: string; title: string; body: (n: number) => string; audit: string }) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) throw new ForbiddenException('Only the salon admin can give out conversations.');
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const set = settingsOf(conn);
    const people = (await this.agents(tenantId, set)).filter((a) => a.inRotation && a.canInbox && a.role === 'STAFF');
    if (!people.length) throw new BadRequestException('Chưa có nhân viên nào được tích trong danh sách Chia turn.');
    const load = new Map(people.map((p) => [p.userId, p.openThreads]));
    const given = new Map<string, number>();
    const now = new Date();
    for (const id of threadIds.slice(0, 1000)) {
      const to = [...people].sort((a, b) => (load.get(a.userId)! - load.get(b.userId)!))[0].userId;
      const r = await this.db.messengerThread.updateMany({ where: { id, tenantId, assignedUserId: null }, data: { assignedUserId: to, assignedAt: now, assignHops: 99 } }).catch(() => ({ count: 0 }));
      if (!r.count) continue;
      await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId: id, userId: to, byUserId: user.userId, reason: opts.reason } }).catch(() => undefined);
      load.set(to, (load.get(to) ?? 0) + 1);
      given.set(to, (given.get(to) ?? 0) + 1);
    }
    for (const [uid, n] of given) {
      void this.push?.sendToUser(tenantId, uid, { title: opts.title, body: opts.body(n), url: '/salon/inbox', tag: `turn-${opts.reason}` }).catch(() => undefined);
    }
    const total = [...given.values()].reduce((a, b) => a + b, 0);
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: opts.audit, resourceType: 'tenant', resourceId: tenantId, metadata: { total } } }).catch(() => undefined);
    this.events.publish(tenantId, 'thread');
    return { total, per: people.map((p) => ({ name: p.name, n: given.get(p.userId) ?? 0 })) };
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

  /** rt213: the person holding a turn opened it (once per turn). Never throws. */
  async noteOpened(tenantId: string, threadId: string, userId: string): Promise<void> {
    try {
      const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { assignedUserId: true, assignedAt: true } }) as { assignedUserId: string | null; assignedAt: Date | null } | null;
      if (!t?.assignedAt || t.assignedUserId !== userId) return;
      const seen = await this.db.chatAssignmentLog?.findFirst({ where: { tenantId, threadId, userId, reason: 'opened', createdAt: { gte: t.assignedAt } }, select: { id: true } });
      if (!seen) await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId, reason: 'opened' } });
    } catch { /* never break reading */ }
  }

  /** When the person holding each of these turns opened it (only their own opening counts). */
  private async openedAt(tenantId: string, rows: { id: string; assignedUserId: string | null; assignedAt: Date | null }[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (!rows.length) return out;
    const logs = await this.db.chatAssignmentLog?.findMany({ where: { tenantId, threadId: { in: rows.map((r) => r.id) }, reason: 'opened' }, select: { threadId: true, userId: true, createdAt: true } }).catch(() => []) ?? [];
    for (const r of rows) {
      const mine = (logs as { threadId: string; userId: string | null; createdAt: Date }[]).filter((l) => l.threadId === r.id && l.userId === r.assignedUserId && (!r.assignedAt || l.createdAt >= r.assignedAt));
      if (mine.length) out.set(r.id, mine[mine.length - 1].createdAt);
    }
    return out;
  }

  /**
   * rt215 — when a PERSON last answered each conversation: a team member in
   * Lumio, or someone replying from Meta's own inbox. Not Lumio's AI, Meta's AI
   * or the Page's automatic messages. Before, the "replied" test read
   * handoffAt, which the AI handing over, Meta's AI and even a missed echo of
   * our own AI's reply also stamp — so a customer only the AI had answered
   * counted as answered and stayed with the person who never wrote a word.
   * Null when the log cannot be read (the caller keeps its old test).
   */
  private async humanReplyAt(tenantId: string, ids: string[]): Promise<Map<string, Date> | null> {
    if (!ids.length) return new Map();
    if (!this.db.messengerMessageLog?.groupBy) return null;
    try {
      const rows = await this.db.messengerMessageLog.groupBy({
        by: ['threadId'],
        where: { tenantId, threadId: { in: ids }, failed: false, OR: [{ role: 'staff' }, { role: 'page', byName: null }] },
        _max: { at: true },
      }) as { threadId: string; _max: { at: Date | null } }[];
      const out = new Map<string, Date>();
      for (const r of rows) if (r._max?.at) out.set(r.threadId, new Date(r._max.at));
      return out;
    } catch { return null; }
  }

  /** Put each row's "replied" time to a person's last reply (see humanReplyAt). */
  private async withHumanReply<T extends { id: string; handoffAt?: Date | null }>(tenantId: string, rows: T[]): Promise<T[]> {
    const replied = await this.humanReplyAt(tenantId, rows.map((r) => r.id));
    if (replied) for (const r of rows) r.handoffAt = replied.get(r.id) ?? null;
    return rows;
  }

  /**
   * rt215 — the customer wrote again on a conversation someone holds. When the
   * holder had already answered this turn (or it was an old customer given out
   * to follow up), this message starts a NEW turn: the clock restarts and the
   * passes count from zero, so if the holder does not open / answer it in time
   * it goes on to the next person like a new customer. Before, the clock still
   * counted from the day it was first given, the old opening and reply looked
   * like answers to the new message, and the conversation sat with that person.
   * While the holder has not answered yet, the turn already running keeps its
   * clock (more messages from the customer do not buy them more time).
   */
  async noteCustomer(tenantId: string, threadId: string, now: Date = new Date()): Promise<boolean> {
    try {
      const t = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { assignedUserId: true, assignedAt: true, assignHops: true, status: true } }) as { assignedUserId: string | null; assignedAt: Date | null; assignHops: number; status: string } | null;
      if (!t?.assignedUserId || !t.assignedAt || t.status === 'spam') return false;
      const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
      if (settingsOf(conn).mode !== 'round-robin') return false;
      let fresh = (t.assignHops ?? 0) >= 99;
      if (!fresh) {
        const replied = await this.humanReplyAt(tenantId, [threadId]);
        const at = replied?.get(threadId);
        fresh = !!at && at.getTime() >= new Date(t.assignedAt).getTime();
      }
      if (!fresh) return false;
      const r = await this.db.messengerThread.updateMany({
        where: { id: threadId, tenantId, assignedUserId: t.assignedUserId, assignedAt: t.assignedAt },
        data: { assignedAt: now, assignHops: 0 },
      }).catch(() => ({ count: 0 }));
      if (!r.count) return false;
      await this.db.chatAssignmentLog?.create({ data: { tenantId, threadId, userId: t.assignedUserId, reason: 'customer-back' } }).catch(() => undefined);
      const th = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { senderName: true, adId: true, adAt: true } }).catch(() => null) as { senderName?: string | null; adId?: string | null; adAt?: Date | null } | null;
      const mins = th ? unrepliedMinsFor(th, settingsOf(conn), now) : 0;
      void this.push?.sendToUser(tenantId, t.assignedUserId, { title: '💬 Khách của bạn nhắn lại', body: `${th?.senderName || 'Khách'} vừa nhắn${mins > 0 ? ` — trả lời trong ${mins} phút, nếu không sẽ chuyển người khác` : ''}.`, url: `/salon/inbox?thread=${threadId}`, tag: `chat-turn-${threadId}` }).catch(() => undefined);
      this.events.publish(tenantId, 'thread');
      return true;
    } catch { return false; }
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
    // rt219: which of those customers booked in the period (not cancelled) — the result that counts.
    const custIds = [...new Set(rows.map((t) => t.customerId).filter(Boolean) as string[])];
    const bookedCust = custIds.length ? new Set((await this.db.appointment?.groupBy({ by: ['customerId'], where: { tenantId, customerId: { in: custIds }, createdAt: { gte: since }, status: { notIn: ['CANCELLED', 'REJECTED'] } } }).catch(() => []) ?? []).map((r: { customerId: string }) => r.customerId)) : new Set<string>();
    for (const t of rows) t.booked = !!t.customerId && bookedCust.has(t.customerId);
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

  /**
   * rt216 — "thống kê số lần bỏ turn, số lần không phản hồi khách hàng đầy đủ
   * và chi tiết để admin xử lý". Every turn passed on from someone who did not
   * act, newest first: when, which customer, who let it go, why (not opened /
   * opened but no answer / pressed Bỏ qua), who got it next, and how long the
   * customer had been waiting. Plus per-person totals and how many customers
   * waited past the alarm. The owner sees everyone (or one person); staff see
   * only their own. One salon only.
   */
  async missLog(user: AuthenticatedUser, daysRaw?: number, person?: string) {
    const tenantId = this.tenantOf(user);
    const isAdmin = user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN;
    const days = [1, 7, 30].includes(Number(daysRaw)) ? Number(daysRaw) : 7;
    const since = new Date(Date.now() - days * 86_400_000);
    const who = isAdmin ? (person ? String(person).slice(0, 64) : null) : user.userId;
    const logs = await this.db.chatAssignmentLog?.findMany({
      where: { tenantId, createdAt: { gte: since }, reason: { in: MISS_REASONS }, fromUserId: who ? who : { not: null } },
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { threadId: true, userId: true, fromUserId: true, reason: true, createdAt: true },
    }).catch(() => []) as { threadId: string; userId: string | null; fromUserId: string | null; reason: string; createdAt: Date }[] ?? [];
    const threadIds = [...new Set(logs.map((l) => l.threadId))];
    const threads = threadIds.length ? await this.db.messengerThread.findMany({ where: { tenantId, id: { in: threadIds } }, select: { id: true, senderName: true, adId: true, adAt: true } }).catch(() => []) as { id: string; senderName: string | null; adId: string | null; adAt: Date | null }[] : [];
    const tBy = new Map(threads.map((t) => [t.id, t]));
    // When each of those turns started (the assignment just before the pass), to say how long it sat.
    const starts = threadIds.length ? await this.db.chatAssignmentLog?.findMany({
      where: { tenantId, threadId: { in: threadIds }, createdAt: { gte: new Date(since.getTime() - 86_400_000) }, reason: { notIn: NOT_TURNS } },
      orderBy: { createdAt: 'asc' }, take: 5000, select: { threadId: true, userId: true, createdAt: true },
    }).catch(() => []) as { threadId: string; userId: string | null; createdAt: Date }[] ?? [] : [];
    const startOf = (l: { threadId: string; fromUserId: string | null; createdAt: Date }) => {
      let at: Date | null = null;
      for (const s of starts) { if (s.threadId !== l.threadId || s.createdAt >= l.createdAt) continue; if (s.userId === l.fromUserId) at = s.createdAt; }
      return at;
    };
    const uids = [...new Set(logs.flatMap((l) => [l.userId, l.fromUserId]).filter(Boolean) as string[])];
    const users = uids.length ? await this.prisma.user.findMany({ where: { tenantId, id: { in: uids } }, select: { id: true, firstName: true, lastName: true, email: true } }).catch(() => []) : [];
    const nm = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    const now = new Date();
    const rows = logs.map((l) => {
      const st = startOf(l);
      const t = tBy.get(l.threadId);
      return {
        at: l.createdAt.toISOString(),
        threadId: l.threadId,
        customer: t?.senderName || 'Khách',
        fromAd: !!t && isAdThread(t, l.createdAt),
        personId: l.fromUserId,
        person: l.fromUserId ? nm.get(l.fromUserId) ?? '—' : '—',
        why: l.reason === 'reassign-unread' ? 'not-opened' : l.reason === 'skip' ? 'skipped' : 'not-replied',
        heldMins: st ? Math.max(0, Math.round((l.createdAt.getTime() - st.getTime()) / 60_000)) : null,
        to: l.userId ? nm.get(l.userId) ?? '—' : null,
      };
    });
    const per = new Map<string, { personId: string; person: string; total: number; notOpened: number; notReplied: number; skipped: number; fromAd: number }>();
    for (const r of rows) {
      if (!r.personId) continue;
      const p = per.get(r.personId) ?? { personId: r.personId, person: r.person, total: 0, notOpened: 0, notReplied: 0, skipped: 0, fromAd: 0 };
      p.total += 1;
      if (r.why === 'not-opened') p.notOpened += 1; else if (r.why === 'skipped') p.skipped += 1; else p.notReplied += 1;
      if (r.fromAd) p.fromAd += 1;
      per.set(r.personId, p);
    }
    // Customers who waited past the alarm with nobody answering (owner view only: not tied to one person).
    const waited = isAdmin && !who ? await this.db.auditLog?.count({ where: { tenantId, action: 'messenger.turn_escalated', createdAt: { gte: since } } }).catch(() => 0) ?? 0 : null;
    void now;
    return { days, canSeeAll: isAdmin, totals: [...per.values()].sort((a, b) => b.total - a.total), waitedTooLong: waited, rows };
  }

  // ---------------------------------------------------------------- API ----

  async view(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null) as ConnRow;
    const settings = settingsOf(conn);
    // rt223: what does not depend on the team list is asked alongside it.
    const pRecent = Promise.resolve().then(() => this.db.chatAssignmentLog?.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, threadId: true, userId: true, fromUserId: true, reason: true, createdAt: true, thread: { select: { senderName: true } } },
    }) ?? []).catch(() => []);
    const pTeam = this.teamOf(tenantId).catch(() => DEFAULT_TEAM);
    const pSources = this.sources(tenantId).catch(() => [] as { key: string; label: string }[]);
    const agents = await this.agents(tenantId, settings);
    const isAdmin = user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN;
    // Who of the team will actually hear a customer: their registered phones.
    if (this.push) {
      await Promise.all(agents.map(async (a) => {
        if (!isAdmin && a.userId !== user.userId) return;
        const c = await this.push!.countForUser(tenantId, a.userId).catch(() => ({ web: 0, native: 0 }));
        a.devices = c.web + c.native;
      }));
    }
    const recent = await pRecent;
    const me = agents.find((a) => a.userId === user.userId) ?? null;
    const team = await pTeam;
    return { settings, agents, me, recent, team, sources: await pSources, canEdit: isAdmin, pushOn: this.push?.enabled() ?? false, lastMiss: isAdmin ? this.lastMiss(tenantId) : null };
  }

  async updateSettings(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Only the salon admin can change chat turn rules.');
    }
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null);
    if (!conn) throw new BadRequestException('Connect a chat channel first.');
    const data: Record<string, unknown> = {};
    // rt210: switched on for the first time with no timers ever set — start from the standard setup.
    const fresh = firstEnable(settingsOf(conn as ConnRow), dto.mode);
    if (fresh) Object.assign(data, standardColumns(dto));
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
    if (fresh) await this.writeStandardTeam(tenantId);
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: fresh ? 'messenger.chat_turns_enabled_standard' : 'messenger.chat_turns_updated', resourceType: 'tenant', resourceId: tenantId } }).catch(() => undefined);
    return this.view(user);
  }

  /**
   * rt210 — "Dùng cài đặt chuẩn": every rule back to the standard (turn-standard.ts).
   * Who takes turns, groups, shares and Pages, and the ad cost, are the
   * salon's own and are kept; on/off is kept too.
   */
  async applyStandard(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    if (!(user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN)) throw new ForbiddenException('Only the salon admin can change chat turn rules.');
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null);
    if (!conn) throw new BadRequestException('Connect a chat channel first.');
    await this.prisma.messengerConnection.update({ where: { tenantId }, data: standardColumns() as never });
    await this.writeStandardTeam(tenantId);
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: 'messenger.chat_turns_standard', resourceType: 'tenant', resourceId: tenantId } }).catch(() => undefined);
    return this.view(user);
  }

  private async writeStandardTeam(tenantId: string): Promise<void> {
    const cur = await this.teamOf(tenantId);
    const team = cleanTeam({ ...cur, ...STANDARD_TEAM });
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: TEAM_KEY } }, create: { tenantId, key: TEAM_KEY, value: team as never }, update: { value: team as never } });
  }

  // ---------------------------------------------------------- shift (rt198) ----

  private async shiftsOf(tenantId: string): Promise<Map<string, Shift>> {
    const rows = await Promise.resolve().then(() => this.prisma.setting.findMany({ where: { tenantId, key: { startsWith: SHIFT_PREFIX } }, select: { key: true, value: true }, take: 500 })).catch(() => [] as { key: string; value: unknown }[]);
    const out = new Map<string, Shift>();
    for (const r of rows ?? []) {
      const s = cleanShift(r.value);
      if (s) out.set(r.key.slice(SHIFT_PREFIX.length), s);
    }
    return out;
  }

  /**
   * Open or close one person's shift in one salon. The person must belong to
   * the salon (checked). Never throws to the Messenger hook.
   */
  async writeShift(tenantId: string, userId: string, on: boolean, now: Date = new Date()): Promise<{ on: boolean; until: string | null }> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      select: { id: true, staffMember: { select: { workingHours: { select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true } } } } } as never,
    }).catch(() => null) as { id: string; staffMember?: { workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[] } | null } | null;
    if (!u) throw new ForbiddenException('Not on this salon\'s team.');
    const until = on ? shiftUntil(now, await this.salonClock(tenantId), u.staffMember?.workingHours ?? []).toISOString() : null;
    const value: Shift = { on, at: now.toISOString(), until };
    const key = shiftKey(userId);
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, value: value as never }, update: { value: value as never } });
    await this.db.chatAgentPresence?.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      update: { status: on ? 'available' : 'away', lastSeenAt: now },
      create: { tenantId, userId, status: on ? 'available' : 'away', lastSeenAt: now },
    }).catch(() => undefined);
    this.events.publish(tenantId, 'thread');
    if (on) void this.distributeWaiting(tenantId, now).catch(() => 0);
    return { on, until };
  }

  /** The "Vào ca" / "Ra ca" button. Each person changes only their own shift. */
  async setShift(user: AuthenticatedUser, on: boolean) {
    const tenantId = this.tenantOf(user);
    const r = await this.writeShift(tenantId, user.userId, on);
    await this.db.auditLog?.create({ data: { tenantId, userId: user.userId, action: on ? 'messenger.turn_shift_on' : 'messenger.turn_shift_off', resourceType: 'user', resourceId: user.userId, metadata: { until: r.until } } }).catch(() => undefined);
    return r;
  }

  /** Shifts whose time ran out: close them and tell the person once. */
  private async closeShifts(tenantId: string, now: Date): Promise<number> {
    const shifts = await this.shiftsOf(tenantId);
    let n = 0;
    for (const [userId, s] of shifts) {
      if (!shiftExpired(s, now)) continue;
      await this.writeShift(tenantId, userId, false, now).catch(() => undefined);
      await this.db.auditLog?.create({ data: { tenantId, userId, action: 'messenger.turn_shift_auto_off', resourceType: 'user', resourceId: userId } }).catch(() => undefined);
      void this.push?.sendToUser(tenantId, userId, { title: 'Đã tự ra ca', body: 'Hết giờ làm nên Lumio đã cho bạn ra ca — không chia khách mới nữa. Mở Lumio bấm "Vào ca" nếu bạn còn làm.', url: '/salon/inbox', tag: 'turn-shift' }).catch(() => undefined);
      n += 1;
    }
    return n;
  }

  /** A customer given to someone a minute ago and still not opened: ring again. */
  private async remind(tenantId: string, now: Date): Promise<number> {
    const rows = await this.db.messengerThread.findMany({
      where: { tenantId, status: 'open', assignedUserId: { not: null }, assignedAt: { gt: new Date(now.getTime() - 120_000), lte: new Date(now.getTime() - 60_000) } },
      select: { id: true, status: true, senderName: true, assignedUserId: true, assignedAt: true, readAt: true, handoffAt: true },
      take: 50,
    }).catch(() => []) as { id: string; status: string; senderName: string | null; assignedUserId: string; assignedAt: Date; readAt: Date | null; handoffAt: Date | null }[];
    let n = 0;
    const opened = await this.openedAt(tenantId, rows);
    for (const t of rows) t.readAt = opened.get(t.id) ?? null;
    await this.withHumanReply(tenantId, rows);
    for (const t of rows) {
      if (!remindDue(t, now)) continue;
      void this.push?.sendToUser(tenantId, t.assignedUserId, { title: '⏰ Nhắc lại: khách đang chờ bạn', body: `${t.senderName || 'Khách'} chưa được trả lời. Bấm để mở và trả lời ngay.`, url: `/salon/inbox?thread=${t.id}`, tag: `chat-turn-${t.id}-again` }).catch(() => undefined);
      n += 1;
    }
    return n;
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
    const thread = await this.db.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { id: true, assignedUserId: true, escalatedAt: true, lastCustomerAt: true, handoffAt: true } });
    if (!thread) throw new NotFoundException('Thread not found');
    const isAdmin = user.role === UserRole.SALON_ADMIN || user.supportSession === true || user.role === UserRole.SUPER_ADMIN;
    if (!isAdmin && thread.assignedUserId && thread.assignedUserId !== user.userId) {
      // The salon may let staff TAKE a conversation (to themselves only), never move it elsewhere.
      const team = await this.teamOf(tenantId);
      // A customer left waiting past the alarm may be taken by anyone on the team ("ai rảnh nhận giúp").
      if (!((team.staffCanTake || rescueOpen(thread)) && toUserId === user.userId)) throw new ForbiddenException('This conversation belongs to someone else. Ask the salon admin to move it.');
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
        // rt213: also when the alert minutes are off — a customer whose passes ran out is announced anyway.
        await this.escalate(tenantId, set, now).catch((e) => this.logger.warn(`escalation failed: ${String(e).slice(0, 120)}`));
        await this.nightReport(tenantId, now).catch((e) => this.logger.warn(`turn report failed: ${String(e).slice(0, 120)}`));
        await this.closeShifts(tenantId, now).catch((e) => this.logger.warn(`shift close failed: ${String(e).slice(0, 120)}`));
        await this.remind(tenantId, now).catch((e) => this.logger.warn(`turn reminder failed: ${String(e).slice(0, 120)}`));
        await this.distributeWaiting(tenantId, now).catch((e) => this.logger.warn(`waiting customers not given out: ${String(e).slice(0, 120)}`));
        const mins = [set.reassignUnreadMins, set.reassignUnrepliedMins, set.reassignAdMins].filter((m) => m > 0);
        if (!mins.length) continue;
        const shortest = Math.min(...mins);
        const threads = await this.db.messengerThread.findMany({
          where: { tenantId, status: 'open', assignedUserId: { not: null }, assignedAt: { lte: new Date(now.getTime() - shortest * 60_000) }, assignHops: { lt: 99 } },
          select: { id: true, customerId: true, status: true, assignedUserId: true, assignedAt: true, readAt: true, handoffAt: true, handoffMode: true, assignHops: true, adId: true, adAt: true },
          take: 50,
        }).catch(() => []) as { id: string; customerId: string | null; assignedUserId: string; assignedAt: Date; adId?: string | null; adAt?: Date | null; readAt?: Date | null }[];
        // rt213: "opened" means opened by the person holding it — someone else looking does not count.
        const opened = await this.openedAt(tenantId, threads);
        for (const t of threads) t.readAt = opened.get(t.id) ?? null;
        await this.withHumanReply(tenantId, threads as unknown as { id: string; handoffAt?: Date | null }[]);
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
            await this.db.messengerThread.updateMany({ where: { id: t.id, tenantId }, data: { assignHops: Math.min(98, ((t as { assignHops?: number }).assignHops ?? 0) + 1) } }).catch(() => undefined);
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
    for (const o of owners) void this.push?.sendToUser(tenantId, o.id, { title: 'Báo cáo chia turn hôm nay', body: text.split('\n').slice(1, 4).join(' · '), url: '/salon/messenger#turns', tag: `turn-report-${day}` }).catch(() => undefined);
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
    // rt213: passed on the maximum number of times and still nobody answered:
    // tell the owner and the team NOW (after one minute), not after the alert
    // minutes — the passes are what used that time already. Old customers
    // given out to follow up (hops 99) are not live chats and are left out.
    await this.withHumanReply(tenantId, rows);
    const exhausted = (t: { assignHops: number }) => set.maxHops > 0 && t.assignHops >= set.maxHops && t.assignHops < 99;
    const due = rows.filter((t) => (set.escalateMins > 0 && escalationDue(t, set.escalateMins, now)) || (exhausted(t) && escalationDue(t, 1, now)));
    if (!due.length) return 0;
    const owners = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: UserRole.SALON_ADMIN }, select: { id: true } }).catch(() => []);
    // rt198: everyone on shift hears it too — whoever is free takes it.
    const ownerIds = new Set(owners.map((o) => o.id));
    const team = (await this.agents(tenantId, set).catch(() => [] as AgentView[])).filter((a) => a.inRotation && a.onDuty && !ownerIds.has(a.userId));
    for (const t of due) {
      const done = await this.db.messengerThread.updateMany({ where: { id: t.id, tenantId, OR: [{ escalatedAt: null }, { escalatedAt: { lt: t.lastCustomerAt } }] }, data: { escalatedAt: now } }).catch(() => ({ count: 0 }));
      if (!done.count) continue;
      const waited = Math.round((now.getTime() - new Date(t.lastCustomerAt).getTime()) / 60_000);
      const text = `🚨 ${t.senderName || 'Khách'}${isAdThread(t, now) ? ' (từ QUẢNG CÁO)' : ''} đã chờ ${waited} phút, chưa ai trả lời${t.assignHops ? ` · đã chuyển ${t.assignHops} lần` : ''}.`;
      for (const o of owners) {
        void this.push?.sendToUser(tenantId, o.id, { title: 'Khách chờ quá lâu', body: text, url: `/salon/inbox?thread=${t.id}`, tag: `chat-escalate-${t.id}` }).catch(() => undefined);
      }
      for (const a of team) {
        if (a.userId === t.assignedUserId) continue;
        void this.push?.sendToUser(tenantId, a.userId, { title: '🙋 Ai rảnh nhận giúp khách này?', body: `${text} Bấm để mở và nhận.`, url: `/salon/inbox?thread=${t.id}`, tag: `chat-escalate-${t.id}` }).catch(() => undefined);
      }
      void this.staff?.notifyEscalation(tenantId, owners.map((o) => o.id), `${text}
Mở Lumio › Hộp thư để trả lời.`).catch(() => 0);
      await this.db.auditLog?.create({ data: { tenantId, action: 'messenger.turn_escalated', resourceType: 'messenger', resourceId: t.id, metadata: { waited } } }).catch(() => undefined);
      this.events.publish(tenantId, 'thread');
    }
    return due.length;
  }
}
