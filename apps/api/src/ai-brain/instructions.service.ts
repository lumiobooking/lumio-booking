import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { chat as llmChat } from '../common/llm';
import { AiUsageService } from '../common/ai-usage.service';
import { detectLanguage } from './brain-rules';
import { LANG_NAME, type Lang } from './brain-settings';
import {
  CHANNELS, MAX_PER_SALON, cleanInstruction, instructionsBlock, interpretPrompt, judgePrompt, keepsWords, labelOf, matchInstructions,
  matchedBlock, meaningKey, needsMeaning, parseInterpret, parseJudge, toCheck,
  type Instruction, type InstructionChannel, type InstructionInput, type Interpretation, type Match,
} from './instructions';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Short: invalidate() only clears THIS process, and the Messenger webhook may
// land on another instance — an owner who saves a correction and texts the
// page straight away must not get the old answer for a minute.
const CACHE_MS = 15_000;
const SOURCE_KINDS = ['thread', 'call', 'session', 'gap', 'manual'];

export interface TurnInstructions {
  all: Instruction[];
  /** The highest-priority prompt section for this channel ('' when the salon has none). */
  block: string;
  matches: Match[];
  /** The MUST lines for this one message ('' when nothing matched). */
  matched: string;
}

export interface CheckResult {
  /** Instructions the draft breaks. */
  broken: Instruction[];
  /** Instructions that applied to this message (counted as "used"). */
  applied: Instruction[];
  /** The judge's corrected reply, when it wrote one. */
  rewrite: string;
}

const NONE: CheckResult = { broken: [], applied: [], rewrite: '' };

/** Which instruction channel a conversation is on. */
export function instructionChannel(ch: string | null | undefined): InstructionChannel {
  return (CHANNELS as string[]).includes(String(ch)) ? (ch as InstructionChannel) : 'messenger';
}

/** Was this row's stored meaning written for its current words? */
function fresh(r: Row): boolean {
  if (!r || typeof r.meaning !== 'string' || r.meaning.trim().length < 8 || !r.meaningKey) return false;
  const triggers = Array.isArray(r.triggers) ? r.triggers.map(String) : [];
  return r.meaningKey === meaningKey({ kind: r.kind, mode: r.mode, text: String(r.text ?? ''), triggers });
}

/**
 * The owner's instructions to the salon's AI (instructions.ts): kept per
 * salon, served to every assistant, checked against every reply. Reads are by
 * tenantId only — the cache too — so one salon's instructions can never reach
 * another salon's customers.
 */
@Injectable()
export class AiInstructionsService {
  private readonly log = new Logger('AiInstructions');
  private readonly cache = new Map<string, { at: number; list: Instruction[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly usage?: AiUsageService,
  ) {}

  private get db(): Row { return this.prisma as unknown as Row; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Owner, manager, Lumio support/admin. */
  canEdit(user: AuthenticatedUser): boolean {
    if (user.role === UserRole.SALON_ADMIN || user.role === UserRole.SUPER_ADMIN) return true;
    return user.role === UserRole.STAFF && user.staffRole === StaffRole.MANAGER;
  }

  private toInstruction(r: Row): Instruction {
    const base: Instruction = {
      id: String(r.id), kind: r.kind, text: String(r.text ?? ''),
      triggers: Array.isArray(r.triggers) ? r.triggers.map(String) : [],
      mode: r.mode === 'verbatim' ? 'verbatim' : 'meaning',
      channels: Array.isArray(r.channels) ? r.channels.filter((c: unknown) => (CHANNELS as unknown[]).includes(c)) : [],
      on: r.on !== false, usedCount: Number(r.usedCount) || 0,
    };
    // A meaning written for other words is never applied to these.
    base.meaning = fresh(r) ? String(r.meaning) : null;
    return base;
  }

  // ---------------------------------------------------------------- the assistants' side

  /** This salon's instructions, oldest first (labels stay put as rows are added). Never throws. */
  async allFor(tenantId: string): Promise<Instruction[]> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
    const rows: Row[] = await Promise.resolve()
      .then(() => this.db.aiInstruction.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, take: MAX_PER_SALON }))
      .catch(() => []);
    const mine = (rows ?? []).filter((r) => r.tenantId === tenantId);
    const list = mine.map((r) => this.toInstruction(r));
    this.cache.set(tenantId, { at: Date.now(), list });
    // Instructions saved before meanings existed (or while the model was
    // down) get theirs in the background — never on a customer's time.
    this.backfill(tenantId, mine.filter((r) => r.on !== false && needsMeaning({ kind: r.kind, mode: r.mode }) && !fresh(r)));
    return list;
  }

  private readonly filling = new Set<string>();
  /** Row+wording → when it was last tried: a note the model cannot read is not asked about again for hours. */
  private readonly tried = new Map<string, number>();
  private backfill(tenantId: string, rows: Row[]): void {
    // Tests drive the model call by call; a background call would take one of theirs.
    if (process.env.NODE_ENV === 'test') return;
    if (!rows.length || this.filling.has(tenantId) || !(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) return;
    const now = Date.now();
    const due = rows.filter((r) => {
      const k = `${r.id}:${meaningKey({ kind: r.kind, mode: r.mode, text: String(r.text ?? ''), triggers: Array.isArray(r.triggers) ? r.triggers.map(String) : [] })}`;
      if ((this.tried.get(k) ?? 0) > now - 6 * 3600_000) return false;
      this.tried.set(k, now);
      return true;
    });
    if (!due.length) return;
    this.filling.add(tenantId);
    void Promise.resolve().then(async () => {
      for (const r of due.slice(0, 5)) {
        const it = await this.interpret(tenantId, { kind: r.kind, text: String(r.text ?? ''), triggers: Array.isArray(r.triggers) ? r.triggers.map(String) : [], mode: r.mode, sourceQuestion: r.sourceQuestion, sourceReply: r.sourceReply }, 'vi').catch(() => null);
        if (!it) continue;
        await this.db.aiInstruction.updateMany({ where: { id: r.id, tenantId }, data: { meaning: it.rule, meaningNote: it.explain || null, meaningKey: meaningKey({ kind: r.kind, mode: r.mode, text: String(r.text ?? ''), triggers: Array.isArray(r.triggers) ? r.triggers.map(String) : [] }) } });
      }
      this.invalidate(tenantId);
    }).catch(() => undefined).finally(() => this.filling.delete(tenantId));
  }

  /**
   * What the owner means by these words — the rule the assistants follow and
   * the sentence the owner reads back ("AI sẽ …"). Null when no model answers
   * or the words are said as written (a word-for-word answer); the owner's own
   * words are then used exactly as before.
   */
  async interpret(tenantId: string, o: { kind: string; text: string; triggers: string[]; mode?: string; sourceQuestion?: string | null; sourceReply?: string | null }, ownerLang: 'vi' | 'en'): Promise<Interpretation | null> {
    const kind = (['answer', 'always', 'never'] as const).find((k) => k === o.kind);
    const text = String(o.text ?? '').trim();
    if (!kind || text.length < 3 || !needsMeaning({ kind, mode: o.mode })) return null;
    if (!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) return null;
    const p = interpretPrompt({ kind, text, triggers: o.triggers ?? [], sourceQuestion: o.sourceQuestion ?? null, sourceReply: o.sourceReply ?? null, ownerLang });
    const out = await llmChat({ system: p.system, messages: [{ role: 'user', content: p.user }], max_tokens: 500, timeoutMs: 9000 }).catch(() => null);
    if (!out || !out.ok) return null;
    this.usage?.record({
      feature: 'messenger', tenantId, model: out.reply.usage?.model ?? 'unknown',
      input: out.reply.usage?.input ?? 0, output: out.reply.usage?.output ?? 0,
      cacheRead: out.reply.usage?.cacheRead ?? 0, cacheWrite: out.reply.usage?.cacheWrite ?? 0, failed: false,
    });
    return parseInterpret(out.reply.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' '));
  }

  /** The owner's screen asks before saving: "this is how the AI reads it". */
  async preview(user: AuthenticatedUser, dto: unknown) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can teach the AI');
    const tenantId = this.tenantId(user);
    const r = (dto && typeof dto === 'object' ? dto : {}) as Row;
    const c = cleanInstruction({ ...r, triggers: Array.isArray(r.triggers) && r.triggers.length ? r.triggers : ['_'] });
    if (!c.ok) throw new BadRequestException(c.error);
    const triggers = Array.isArray(r.triggers) ? c.value.triggers : [];
    const lang = r.lang === 'en' ? 'en' : 'vi';
    const it = await this.interpret(tenantId, { ...c.value, triggers, sourceQuestion: typeof r.sourceQuestion === 'string' ? r.sourceQuestion.slice(0, 600) : null, sourceReply: typeof r.sourceReply === 'string' ? r.sourceReply.slice(0, 1200) : null }, lang);
    return { ...(it ?? { rule: '', explain: '', fixes: [], suggestKind: null }), ok: !!it, key: meaningKey({ ...c.value, triggers }) };
  }

  /**
   * The meaning stored with a save: the one the owner was shown, when it was
   * made for exactly these words, else a fresh one. Null keeps the words as
   * they are (no model, or a word-for-word answer).
   */
  private async meaningFor(tenantId: string, v: InstructionInput, dto: Row, source: Row, lang: 'vi' | 'en'): Promise<{ meaning: string | null; meaningNote: string | null; meaningKey: string | null }> {
    if (!needsMeaning(v)) return { meaning: null, meaningNote: null, meaningKey: null };
    const key = meaningKey(v);
    const shown = typeof dto.meaning === 'string' ? dto.meaning.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
    if (shown.length >= 8 && dto.meaningKey === key) {
      const note = typeof dto.meaningNote === 'string' ? dto.meaningNote.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
      return { meaning: shown, meaningNote: note || null, meaningKey: key };
    }
    const it = await this.interpret(tenantId, { ...v, sourceQuestion: source.sourceQuestion ?? null, sourceReply: source.sourceReply ?? null }, lang).catch(() => null);
    return it ? { meaning: it.rule, meaningNote: it.explain || null, meaningKey: key } : { meaning: null, meaningNote: null, meaningKey: null };
  }

  invalidate(tenantId: string): void { this.cache.delete(tenantId); }

  /** What one reply on one channel must obey. `list` overrides the stored rows (the try-out). */
  async forTurn(tenantId: string, channel: InstructionChannel, message: string, list?: Instruction[]): Promise<TurnInstructions> {
    const all = list ?? await this.allFor(tenantId);
    const matches = matchInstructions(all, message, channel);
    return { all, block: instructionsBlock(all, channel), matches, matched: matchedBlock(all, matches) };
  }

  /**
   * Is this draft allowed out? A verbatim answer in the customer's own
   * language is checked by its words, here; everything else by one short
   * judging call. A judge that is slow or unreadable never blocks a reply.
   */
  async check(tenantId: string, o: { turn: TurnInstructions; channel: InstructionChannel; customer: string; draft: string; lang: Lang; timeoutMs?: number }): Promise<CheckResult> {
    const draft = String(o.draft ?? '').trim();
    if (!draft) return NONE;
    const check = toCheck(o.turn.all, o.channel, o.turn.matches);
    if (!check.length) return NONE;
    const broken = new Map<string, Instruction>();
    const applied = new Map<string, Instruction>();
    for (const m of o.turn.matches) applied.set(m.ins.id, m.ins);
    // Word-for-word answers, same language: no model needed.
    const needJudge: Instruction[] = [];
    for (const i of check) {
      if (i.kind === 'answer' && i.mode === 'verbatim') {
        const l = detectLanguage(i.text);
        if (!l || l === o.lang) { if (!keepsWords(draft, i.text)) broken.set(i.id, i); continue; }
      }
      needJudge.push(i);
    }
    let rewrite = '';
    if (needJudge.length && (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) {
      const p = judgePrompt({ all: o.turn.all, check: needJudge, customer: o.customer, draft, langName: LANG_NAME[o.lang]?.en ?? 'English', voice: o.channel === 'voice' });
      const out = await llmChat({ system: p.system, messages: [{ role: 'user', content: p.user }], max_tokens: 400, timeoutMs: o.timeoutMs ?? 6000 }).catch(() => null);
      if (out && out.ok) {
        this.usage?.record({
          feature: o.channel === 'voice' ? 'voice' : 'messenger', tenantId, model: out.reply.usage?.model ?? 'unknown',
          input: out.reply.usage?.input ?? 0, output: out.reply.usage?.output ?? 0,
          cacheRead: out.reply.usage?.cacheRead ?? 0, cacheWrite: out.reply.usage?.cacheWrite ?? 0, failed: false,
        });
        const text = out.reply.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');
        const labels = needJudge.map((i) => labelOf(o.turn.all, i));
        const v = parseJudge(text, labels);
        if (v) {
          const byLabel = new Map(needJudge.map((i) => [labelOf(o.turn.all, i), i]));
          for (const l of v.applies) { const i = byLabel.get(l); if (i) applied.set(i.id, i); }
          for (const l of v.violations) { const i = byLabel.get(l); if (i) { broken.set(i.id, i); applied.set(i.id, i); } }
          rewrite = v.rewrite;
        }
      } else if (out && !out.ok) {
        this.log.warn(`instruction check skipped (${out.status ?? 'network'})`);
      }
    }
    return { broken: [...broken.values()], applied: [...applied.values()], rewrite: broken.size ? rewrite : '' };
  }

  /** Counted for the owner's screen. Never awaited by a conversation, never fatal. */
  noteUse(tenantId: string, applied: Instruction[], blocked: Instruction[]): void {
    const used = [...new Set(applied.map((i) => i.id))];
    const hit = [...new Set(blocked.map((i) => i.id))];
    const now = new Date();
    void Promise.resolve().then(async () => {
      if (used.length) await this.db.aiInstruction.updateMany({ where: { tenantId, id: { in: used } }, data: { usedCount: { increment: 1 }, lastUsedAt: now } });
      if (hit.length) await this.db.aiInstruction.updateMany({ where: { tenantId, id: { in: hit } }, data: { blockedCount: { increment: 1 } } });
    }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- the owner's screen

  private view(r: Row) {
    return {
      id: r.id, kind: r.kind, text: r.text, triggers: Array.isArray(r.triggers) ? r.triggers : [], mode: r.mode, channels: Array.isArray(r.channels) ? r.channels : [],
      on: r.on !== false, reason: r.reason ?? null, sourceKind: r.sourceKind ?? null, sourceId: r.sourceId ?? null,
      sourceQuestion: r.sourceQuestion ?? null, sourceReply: r.sourceReply ?? null,
      usedCount: Number(r.usedCount) || 0, blockedCount: Number(r.blockedCount) || 0, lastUsedAt: r.lastUsedAt ?? null,
      // The owner reads back how the AI understood the note.
      meaningNote: fresh(r) ? (r.meaningNote ?? null) : null,
      createdBy: r.createdBy ?? null, updatedBy: r.updatedBy ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt ?? null,
    };
  }

  async list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows: Row[] = await this.db.aiInstruction.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: MAX_PER_SALON });
    const items = rows.map((r) => this.view(r));
    return {
      items, canEdit: this.canEdit(user),
      stats: {
        total: items.length, on: items.filter((i) => i.on).length,
        used: items.reduce((s, i) => s + i.usedCount, 0), blocked: items.reduce((s, i) => s + i.blockedCount, 0),
      },
    };
  }

  private source(dto: Row) {
    const kind = SOURCE_KINDS.includes(String(dto.sourceKind)) ? String(dto.sourceKind) : 'manual';
    const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    return { sourceKind: kind, sourceId: s(dto.sourceId, 64), sourceQuestion: s(dto.sourceQuestion, 600), sourceReply: s(dto.sourceReply, 1200) };
  }

  async create(user: AuthenticatedUser, dto: unknown) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can teach the AI');
    const tenantId = this.tenantId(user);
    const c = cleanInstruction(dto);
    if (!c.ok) throw new BadRequestException(c.error);
    const n: number = await this.db.aiInstruction.count({ where: { tenantId } });
    if (n >= MAX_PER_SALON) throw new BadRequestException(`A salon can keep up to ${MAX_PER_SALON} instructions — turn off or delete old ones first`);
    const who = user.email || user.userId;
    const src = this.source((dto ?? {}) as Row);
    const m = await this.meaningFor(tenantId, c.value, (dto ?? {}) as Row, src, ((dto ?? {}) as Row).lang === 'en' ? 'en' : 'vi');
    const row = await this.db.aiInstruction.create({
      data: {
        tenantId, kind: c.value.kind, text: c.value.text, triggers: c.value.triggers, mode: c.value.mode, channels: c.value.channels,
        on: c.value.on, reason: c.value.reason, ...src, ...m, createdBy: who, updatedBy: who,
      },
    });
    this.invalidate(tenantId);
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_instruction.created', resourceType: 'ai_instruction', resourceId: row.id, metadata: { kind: c.value.kind } });
    return this.view(row);
  }

  async update(user: AuthenticatedUser, id: string, dto: unknown) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can teach the AI');
    const tenantId = this.tenantId(user);
    const cur: Row | null = await this.db.aiInstruction.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Instruction not found');
    const c = cleanInstruction(dto, { kind: cur.kind, text: cur.text, triggers: cur.triggers, mode: cur.mode, channels: cur.channels, on: cur.on, reason: cur.reason });
    if (!c.ok) throw new BadRequestException(c.error);
    // Same words, same meaning: an on/off or a channel change keeps it. New words get a new one.
    const keep = fresh(cur) && meaningKey(c.value) === cur.meaningKey;
    const m = keep ? {} : await this.meaningFor(tenantId, c.value, (dto ?? {}) as Row, cur, ((dto ?? {}) as Row).lang === 'en' ? 'en' : 'vi');
    await this.db.aiInstruction.updateMany({
      where: { id, tenantId },
      data: { kind: c.value.kind, text: c.value.text, triggers: c.value.triggers, mode: c.value.mode, channels: c.value.channels, on: c.value.on, reason: c.value.reason, ...m, updatedBy: user.email || user.userId },
    });
    this.invalidate(tenantId);
    await this.audit.log({ tenantId, userId: user.userId, action: c.value.on === (cur.on !== false) ? 'ai_instruction.updated' : (c.value.on ? 'ai_instruction.enabled' : 'ai_instruction.disabled'), resourceType: 'ai_instruction', resourceId: id });
    const row = await this.db.aiInstruction.findFirst({ where: { id, tenantId } });
    return this.view(row);
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can teach the AI');
    const tenantId = this.tenantId(user);
    const r = await this.db.aiInstruction.deleteMany({ where: { id, tenantId } });
    if (!r.count) throw new NotFoundException('Instruction not found');
    this.invalidate(tenantId);
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_instruction.deleted', resourceType: 'ai_instruction', resourceId: id });
    return { ok: true };
  }

  /** A gap the bot could not answer, answered by the owner: an answer instruction from then on. */
  async fromGap(tenantId: string, userId: string | null, who: string | null, question: string, answer: string, gapId: string): Promise<void> {
    const c = cleanInstruction({ kind: 'answer', text: answer, triggers: [question] });
    if (!c.ok) return;
    await this.db.aiInstruction.create({
      data: { tenantId, kind: 'answer', text: c.value.text, triggers: c.value.triggers, mode: 'meaning', channels: [], on: true, sourceKind: 'gap', sourceId: gapId, sourceQuestion: question.slice(0, 600), createdBy: who, updatedBy: who },
    });
    this.invalidate(tenantId);
    await this.audit.log({ tenantId, userId, action: 'ai_instruction.created', resourceType: 'ai_instruction', resourceId: gapId, metadata: { kind: 'answer', from: 'gap' } });
  }
}
