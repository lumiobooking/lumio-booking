import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { factLabel, gapKey, redact, type GapSource } from './knowledge-gaps';

/** Open questions kept per salon. Past this, new ones wait until some are answered. */
export const MAX_OPEN_GAPS = 300;

export interface GapRow {
  id: string; question: string; count: number; source: string; status: string;
  suggestedAnswer: string | null; answer: string | null; threadId: string | null;
  firstAt: Date; lastAt: Date; answeredAt: Date | null;
}

/**
 * Storage for "what the bot did not know" (see ./knowledge-gaps). Every read
 * and write carries the salon's tenantId; an id from another salon is simply
 * not found. The answer is written into THIS salon's bot facts and nowhere else.
 */
@Injectable()
export class KnowledgeGapsService {
  private readonly logger = new Logger('KnowledgeGaps');

  constructor(private readonly prisma: PrismaService) {}

  /** The generated client on a dev machine may predate the table — typed loosely on purpose. */
  private get gaps(): {
    findUnique: (a: unknown) => Promise<GapRow | null>;
    findFirst: (a: unknown) => Promise<GapRow | null>;
    findMany: (a: unknown) => Promise<GapRow[]>;
    create: (a: unknown) => Promise<GapRow>;
    update: (a: unknown) => Promise<GapRow>;
    count: (a: unknown) => Promise<number>;
  } {
    return (this.prisma as unknown as { botKnowledgeGap: never }).botKnowledgeGap;
  }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Never throws: a question that could not be stored must not cost a customer their reply. */
  async record(o: { tenantId: string; threadId?: string | null; question: string; source: GapSource; suggestedAnswer?: string | null }): Promise<void> {
    try {
      const key = gapKey(o.question);
      if (!o.tenantId || key.length < 4) return;
      const question = redact(o.question);
      const suggested = o.suggestedAnswer ? String(o.suggestedAnswer).trim().slice(0, 1000) : null;
      const existing = await this.gaps.findUnique({ where: { tenantId_key: { tenantId: o.tenantId, key } } });
      if (existing) {
        await this.gaps.update({
          where: { id: existing.id },
          data: {
            count: { increment: 1 }, lastAt: new Date(), question, threadId: o.threadId ?? existing.threadId,
            // A person's answer is the most useful thing to offer the owner — the latest one wins.
            ...(o.source === 'staff' && suggested ? { source: 'staff', suggestedAnswer: suggested } : {}),
          },
        });
        return;
      }
      if ((await this.gaps.count({ where: { tenantId: o.tenantId, status: 'open' } })) >= MAX_OPEN_GAPS) return;
      await this.gaps.create({
        data: { tenantId: o.tenantId, key, question, threadId: o.threadId ?? null, source: o.source, suggestedAnswer: suggested },
      });
    } catch (e) {
      // A race on the unique key (two customers, same question, same second) lands here too.
      this.logger.warn(`could not record a knowledge gap: ${String(e).slice(0, 140)}`);
    }
  }

  async list(user: AuthenticatedUser): Promise<{ open: GapRow[]; answered: GapRow[] }> {
    const tenantId = this.tenantOf(user);
    const [open, answered] = await Promise.all([
      this.gaps.findMany({ where: { tenantId, status: 'open' }, orderBy: [{ count: 'desc' }, { lastAt: 'desc' }], take: 100 }),
      this.gaps.findMany({ where: { tenantId, status: 'answered' }, orderBy: { answeredAt: 'desc' }, take: 20 }),
    ]);
    const shape = (g: GapRow) => ({
      id: g.id, question: g.question, count: g.count, source: g.source, status: g.status,
      suggestedAnswer: g.suggestedAnswer, answer: g.answer, threadId: g.threadId,
      firstAt: g.firstAt, lastAt: g.lastAt, answeredAt: g.answeredAt,
    });
    return { open: open.map(shape) as GapRow[], answered: answered.map(shape) as GapRow[] };
  }

  /** The owner's answer becomes a bot fact of THIS salon — the bot uses it from the next message. */
  async answer(user: AuthenticatedUser, id: string, answerText: string): Promise<{ ok: true; label: string }> {
    const tenantId = this.tenantOf(user);
    const answer = String(answerText ?? '').trim();
    if (!answer) throw new BadRequestException('Type the answer the bot should give.');
    if (answer.length > 1000) throw new BadRequestException('Keep the answer under 1000 characters.');
    const gap = await this.gaps.findFirst({ where: { id, tenantId } });
    if (!gap) throw new NotFoundException('Question not found.');
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (!conn) throw new BadRequestException('Connect Messenger first — the answer is saved to the bot.');

    const label = factLabel(gap.question);
    const facts = (Array.isArray(conn.botFacts) ? conn.botFacts : []) as { label: string; value: string; on: boolean }[];
    const at = facts.findIndex((f) => f && String(f.label).trim().toLowerCase() === label.toLowerCase());
    const next = at >= 0
      ? facts.map((f, i) => (i === at ? { ...f, value: answer, on: true } : f))
      : [...facts, { label, value: answer, on: true }];
    await this.prisma.messengerConnection.update({
      where: { tenantId },
      data: { botFacts: next as unknown as Prisma.InputJsonValue },
    });
    await this.gaps.update({
      where: { id: gap.id },
      data: { status: 'answered', answer, answeredBy: user.userId ?? null, answeredAt: new Date() },
    });
    await this.audit(tenantId, user.userId ?? null, 'messenger.knowledge_gap_answered', gap.id);
    return { ok: true, label };
  }

  async dismiss(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const tenantId = this.tenantOf(user);
    const gap = await this.gaps.findFirst({ where: { id, tenantId } });
    if (!gap) throw new NotFoundException('Question not found.');
    await this.gaps.update({ where: { id: gap.id }, data: { status: 'dismissed' } });
    await this.audit(tenantId, user.userId ?? null, 'messenger.knowledge_gap_dismissed', gap.id);
    return { ok: true };
  }

  private async audit(tenantId: string, userId: string | null, action: string, resourceId: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: { tenantId, userId, action, resourceType: 'bot_knowledge_gap', resourceId } });
    } catch { /* audit is best-effort */ }
  }
}
