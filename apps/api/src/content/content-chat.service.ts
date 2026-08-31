import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/**
 * The conversation between the Lumio team and the salon, about the work.
 *
 * WHY IT IS NOT THE EXISTING INBOX
 *
 * The Messenger inbox is the salon talking to the people who book with it. This
 * is the salon talking to the marketing team that works for it. Putting them in
 * one list would sit "nên nâng giá Thứ 5 lên" next to a customer asking about
 * opening hours, and sooner or later somebody replies to the wrong one — in
 * public, as the salon.
 *
 * "Internal" is the wrong word for it and the screens no longer use it: this is
 * an agency talking to its CLIENT. What it is private from is the salon's own
 * customers, not from the salon.
 *
 * WHY ONE TABLE FOR COMMENTS AND FOR THE SHARED WINDOW
 *
 * A comment under an idea and a message in the shared window are the same thing
 * with a different address, so `subject` carries the address: 'week:2026-W36',
 * 'idea:<id>', 'ads', or 'general'. Two tables would have meant two unread
 * counts, two notification paths, and two places to fix every bug — and the
 * first time they disagreed, one side would show a dot the other could not
 * clear.
 *
 * WHICH SIDE WROTE IT IS STORED, NOT DERIVED
 *
 * A support session carries a SALON_ADMIN role by design. Working the side out
 * from the role at READ time would recolour history the moment the same person
 * signed in differently; working it out at WRITE time and storing it cannot.
 */
@Injectable()
export class ContentChatService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new BadRequestException('No tenant context');
    return id;
  }

  /** Lumio staff, or the salon itself. Decided once, at write time. */
  private sideOf(user: AuthenticatedUser): 'lumio' | 'salon' {
    return user.role === UserRole.SUPER_ADMIN || user.supportSession ? 'lumio' : 'salon';
  }

  /** Loose access: these models exist on the deploy, not on the local client. */
  private get table() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
      updateMany: (a: unknown) => Promise<unknown>;
      count?: (a: unknown) => Promise<number>;
    }>).contentMessage;
  }

  private get threads() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      upsert: (a: unknown) => Promise<unknown>;
      updateMany: (a: unknown) => Promise<unknown>;
    }>).contentThread;
  }

  /**
   * The name that goes on a message.
   *
   * "Lumio" was wrong the moment a second person joined. The salon needs to
   * know WHO it is talking to — an answer signed by a company is an answer
   * nobody is accountable for — and the team needs to know who replied last.
   * Falls back to the company name only when there is no human name at all.
   */
  private displayName(user: AuthenticatedUser, side: 'lumio' | 'salon'): string {
    const email = String(user.email ?? '').trim();
    const local = email.includes('@') ? email.split('@')[0] : email;
    const person = local.replace(/[._-]+/g, ' ').trim();
    if (side === 'lumio') return person ? `Lumio · ${person}` : 'Lumio';
    return person || 'Tiệm';
  }

  /**
   * The subject an address is allowed to have.
   *
   * Validated rather than trusted: `subject` goes straight into a WHERE clause,
   * and an unbounded string is an invitation to store a thread nobody can find
   * again — or to address one that belongs to a different screen.
   */
  private cleanSubject(raw: unknown): string {
    const s = String(raw ?? 'general').trim().slice(0, 80);
    if (s === 'general' || s === 'ads') return s;
    if (/^week:\d{4}-W\d{2}$/.test(s)) return s;
    if (/^idea:[a-zA-Z0-9-]{6,40}$/.test(s)) return s;
    throw new BadRequestException('Chủ đề trao đổi không hợp lệ.');
  }

  /**
   * One thread — the most recent messages, oldest-first for reading.
   *
   * The first version took the FIRST 200 rows. That is fine for a month and
   * then silently wrong forever: message 201 onwards never appears, and the
   * thread looks abandoned while both sides are still writing into it. Take
   * the NEWEST page and reverse it; `before` walks backwards for older ones.
   */
  async list(user: AuthenticatedUser, subject: unknown, before?: string) {
    const tenantId = this.tenantId(user);
    const key = this.cleanSubject(subject);
    const cutoff = before ? new Date(before) : null;
    const page = 50;
    const newest = await this.table?.findMany({
      where: {
        tenantId, subject: key,
        ...(cutoff && !Number.isNaN(cutoff.getTime()) ? { createdAt: { lt: cutoff } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: page + 1,
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => []) as { id: string; side: string; authorName: string; body: string; createdAt: Date }[];

    const hasMore = (newest ?? []).length > page;
    const rows = (newest ?? []).slice(0, page).reverse();

    // Reading marks the thread read for THIS side only. Marking it for both
    // would clear the other side's dot without them having seen anything.
    const side = this.sideOf(user);
    await this.table?.updateMany({
      where: { tenantId, subject: key, ...(side === 'lumio' ? { readByLumioAt: null } : { readBySalonAt: null }) },
      data: side === 'lumio' ? { readByLumioAt: new Date() } : { readBySalonAt: new Date() },
    }).catch(() => undefined);

    const thread = await this.threads?.findFirst({
      where: { tenantId, subject: key },
      select: { assigneeName: true, resolvedAt: true, resolvedByName: true },
    }).catch(() => null) as { assigneeName: string | null; resolvedAt: Date | null; resolvedByName: string | null } | null;

    return {
      subject: key, side, messages: rows,
      hasMore,
      /** Pass back as `before` to walk further into the past. */
      oldestAt: rows.length ? rows[0].createdAt : null,
      assigneeName: thread?.assigneeName ?? null,
      resolvedAt: thread?.resolvedAt ?? null,
      resolvedByName: thread?.resolvedByName ?? null,
    };
  }

  async send(user: AuthenticatedUser, subject: unknown, body: string) {
    const tenantId = this.tenantId(user);
    const key = this.cleanSubject(subject);
    const text = String(body ?? '').trim();
    if (!text) throw new BadRequestException('Chưa có nội dung.');
    const side = this.sideOf(user);

    const row = await this.table?.create({
      data: {
        tenantId, subject: key, side,
        authorId: user.userId ?? null,
        authorName: this.displayName(user, side),
        body: text.slice(0, 4000),
        // Read by the sender by definition; unread for the other side.
        ...(side === 'lumio' ? { readByLumioAt: new Date() } : { readBySalonAt: new Date() }),
      },
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => null) as { id: string } | null;
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');

    // The thread row is what the cross-salon inbox reads. Upserted here so it
    // cannot fall behind the messages — and a reply REOPENS a resolved thread,
    // because somebody writing into a closed matter means it was not closed.
    await this.threads?.upsert({
      where: { tenantId_subject: { tenantId, subject: key } },
      create: { tenantId, subject: key, lastMessageAt: new Date(), lastSide: side },
      update: { lastMessageAt: new Date(), lastSide: side, resolvedAt: null, resolvedByName: null },
    }).catch(() => undefined);

    return row;
  }

  /**
   * Close a thread, or take it.
   *
   * Team-side only. The salon does not decide when a matter is settled — and
   * more practically, a queue anyone can clear is a queue that empties without
   * the work being done.
   */
  async setThreadState(
    user: AuthenticatedUser,
    subject: unknown,
    patch: { resolved?: boolean; assignToMe?: boolean },
  ) {
    const tenantId = this.tenantId(user);
    const key = this.cleanSubject(subject);
    if (this.sideOf(user) !== 'lumio') {
      throw new BadRequestException('Chỉ team Lumio đóng hoặc nhận xử lý được.');
    }
    const name = this.displayName(user, 'lumio');
    const data: Record<string, unknown> = {};
    if (patch.resolved === true) { data.resolvedAt = new Date(); data.resolvedByName = name; }
    if (patch.resolved === false) { data.resolvedAt = null; data.resolvedByName = null; }
    if (patch.assignToMe === true) { data.assigneeId = user.userId ?? null; data.assigneeName = name; }
    if (patch.assignToMe === false) { data.assigneeId = null; data.assigneeName = null; }
    if (!Object.keys(data).length) return { ok: true };

    await this.threads?.upsert({
      where: { tenantId_subject: { tenantId, subject: key } },
      create: { tenantId, subject: key, lastMessageAt: new Date(), ...data },
      update: data,
    }).catch(() => undefined);
    return { ok: true, subject: key, ...data };
  }

  /**
   * How many messages this side has not read, per subject.
   *
   * Per subject, not just a total: the dot has to appear ON the idea being
   * discussed, otherwise the reader has to open every card to find the one
   * message waiting for them.
   */
  async unread(user: AuthenticatedUser): Promise<{ total: number; bySubject: Record<string, number> }> {
    const tenantId = this.tenantId(user);
    const side = this.sideOf(user);
    const rows = await this.table?.findMany({
      where: {
        tenantId,
        // Not my own messages, and not yet read by my side.
        side: side === 'lumio' ? 'salon' : 'lumio',
        ...(side === 'lumio' ? { readByLumioAt: null } : { readBySalonAt: null }),
      },
      select: { subject: true },
      take: 500,
    }).catch(() => []) as { subject: string }[];

    const bySubject: Record<string, number> = {};
    for (const r of rows ?? []) bySubject[r.subject] = (bySubject[r.subject] ?? 0) + 1;
    return { total: (rows ?? []).length, bySubject };
  }

  // ---- the team's cross-salon inbox ---------------------------------------

  /**
   * Every conversation the Lumio team can see, across every salon.
   *
   * THIS IS THE PIECE THAT DECIDES WHETHER THE CHANNEL LIVES
   *
   * Without it, the only way in is a salon's own content page — so a staff
   * member covering forty salons would have to open forty pages to find the
   * three that wrote in. Nobody does that twice, the replies stop, and a
   * channel the client has been told to use but that nobody answers is worse
   * than never having offered it.
   *
   * Ordered by "waiting on us" first, then by how long they have waited. The
   * oldest unanswered message is the most expensive one.
   */
  async inbox(filter: 'waiting' | 'mine' | 'open' | 'all', userId?: string | null) {
    const rows = await this.threads?.findMany({
      where: {
        ...(filter === 'mine' ? { assigneeId: userId ?? '__none__' } : {}),
        ...(filter === 'all' ? {} : { resolvedAt: null }),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      select: {
        tenantId: true, subject: true, lastMessageAt: true, lastSide: true,
        assigneeName: true, resolvedAt: true, resolvedByName: true,
        tenant: { select: { name: true, slug: true } },
      },
    }).catch(() => []) as {
      tenantId: string; subject: string; lastMessageAt: Date; lastSide: string | null;
      assigneeName: string | null; resolvedAt: Date | null; resolvedByName: string | null;
      tenant: { name: string; slug: string } | null;
    }[];

    // Unread for OUR side, per (tenant, subject). One query for all of them —
    // a per-thread count would be two hundred round trips on a busy morning.
    const unread = await this.table?.findMany({
      where: { side: 'salon', readByLumioAt: null },
      select: { tenantId: true, subject: true, body: true, createdAt: true, authorName: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }).catch(() => []) as { tenantId: string; subject: string; body: string; createdAt: Date; authorName: string }[];

    const count = new Map<string, number>();
    const preview = new Map<string, string>();
    for (const m of unread ?? []) {
      const k = `${m.tenantId}|${m.subject}`;
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!preview.has(k)) preview.set(k, m.body.slice(0, 120));
    }

    const out = (rows ?? []).map((t) => {
      const k = `${t.tenantId}|${t.subject}`;
      return {
        tenantId: t.tenantId,
        salonName: t.tenant?.name ?? '—',
        salonSlug: t.tenant?.slug ?? '',
        subject: t.subject,
        lastMessageAt: t.lastMessageAt,
        lastSide: t.lastSide,
        assigneeName: t.assigneeName,
        resolvedAt: t.resolvedAt,
        resolvedByName: t.resolvedByName,
        unread: count.get(k) ?? 0,
        preview: preview.get(k) ?? '',
        /** True when the salon spoke last and nobody has answered. */
        waiting: t.lastSide === 'salon' && !t.resolvedAt,
      };
    });

    const list = filter === 'waiting' ? out.filter((t) => t.waiting) : out;
    // Waiting first, then oldest wait first inside that group: the message that
    // has been ignored longest is the one that costs the most.
    list.sort((a, b) => {
      if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
      if (a.waiting) return a.lastMessageAt.getTime() - b.lastMessageAt.getTime();
      return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    });
    return { filter, threads: list, waiting: out.filter((t) => t.waiting).length };
  }

  /** One thread read from the team console, scoped to the salon it belongs to. */
  async inboxThread(tenantId: string, subject: unknown, user: AuthenticatedUser) {
    return this.list({ ...user, tenantId }, subject);
  }

  /** Reply from the team console, into a named salon's thread. */
  async inboxReply(tenantId: string, subject: unknown, body: string, user: AuthenticatedUser) {
    return this.send({ ...user, tenantId, supportSession: true }, subject, body);
  }
}
