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
 * is the salon talking to US. Putting them in one list would sit "nên nâng giá
 * Thứ 5 lên" next to a customer asking about opening hours, and sooner or later
 * somebody replies to the wrong one — in public, as the salon.
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
      groupBy?: (a: unknown) => Promise<unknown>;
    }>).contentMessage;
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

  /** One thread, oldest first — the order a conversation is read in. */
  async list(user: AuthenticatedUser, subject: unknown) {
    const tenantId = this.tenantId(user);
    const key = this.cleanSubject(subject);
    const rows = await this.table?.findMany({
      where: { tenantId, subject: key },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => []) as { id: string; side: string; authorName: string; body: string; createdAt: Date }[];

    // Reading marks the thread read for THIS side only. Marking it for both
    // would clear the other side's dot without them having seen anything.
    const side = this.sideOf(user);
    await this.table?.updateMany({
      where: { tenantId, subject: key, ...(side === 'lumio' ? { readByLumioAt: null } : { readBySalonAt: null }) },
      data: side === 'lumio' ? { readByLumioAt: new Date() } : { readBySalonAt: new Date() },
    }).catch(() => undefined);

    return { subject: key, side, messages: rows ?? [] };
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
        authorName: side === 'lumio' ? 'Lumio' : (user.email ?? 'Tiệm'),
        body: text.slice(0, 4000),
        // Read by the sender by definition; unread for the other side.
        ...(side === 'lumio' ? { readByLumioAt: new Date() } : { readBySalonAt: new Date() }),
      },
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => null) as { id: string } | null;
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');
    return row;
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
}
