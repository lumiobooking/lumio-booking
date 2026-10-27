import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PushService } from '../push/push.service';
import { PartyAvailabilityService } from '../bookings/party-availability.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { personaFor, chosenIndustry } from '../common/business-persona';
import { serviceCode, type MenuItem } from '../bookings/group-booking';
import { formatMoneyShort } from '../common/money';
import {
  AI_BRAIN_KEY, brainFromLegacy, brainPromptBlocks, defaultBrain, legacyNotes, mergeLegacy, sanitizeBrain,
  type AiBrain, type Lang, type LegacySources,
} from './brain-settings';

/** The day the old notes were moved into the brain (and the brain before it, for Undo). */
export const AI_LEGACY_MERGED_KEY = 'ai_legacy_merged';
import { END_REASON_LABEL, SLOW_TURN_MS, asLang, conversationLanguage, detectLanguage, type EndReason } from './brain-rules';
import { AiInstructionsService, instructionChannel } from './instructions.service';
import { checkingLine, cleanInstruction, correctionFor, lastResort, type Instruction, type InstructionChannel } from './instructions';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Channel = 'voice' | 'messenger' | 'instagram' | 'zalo' | 'web';

export interface CustomerMemory {
  customerId: string;
  profile: string;
  preferredLang: Lang | null;
  prefs: Record<string, unknown>;
  openIntent: { text: string; at: string; channel: string } | null;
  lastChannel: string | null;
  lastContactAt: Date | null;
  salonNote: string;
}

export interface CallbackInput {
  tenantId: string; channel: Channel; reason: string; summary: string;
  phone?: string | null; name?: string | null; customerId?: string | null; sessionId?: string | null; threadId?: string | null;
}

const CACHE_MS = 60_000;

/**
 * The salon's AI brain: one setting every assistant reads, the memory of
 * each customer across channels, the log of why every conversation ended,
 * and the "call this customer back" tasks the assistants leave for the
 * desk. Everything is keyed by tenantId; nothing here is ever read for a
 * salon other than the one asked for.
 */
@Injectable()
export class AiBrainService {
  private readonly log = new Logger('AiBrain');
  private readonly cache = new Map<string, { at: number; brain: AiBrain; legacy: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly push?: PushService,
    @Optional() private readonly party?: PartyAvailabilityService,
    // The owner's instructions (instructions.ts): the sandbox obeys them exactly as the live assistants do.
    @Optional() private readonly instructions?: AiInstructionsService,
  ) {}

  private get db(): Row { return this.prisma as unknown as Row; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Owner, manager, Lumio support/admin: may change the brain. Everyone else with the screen only reads. */
  private canEdit(user: AuthenticatedUser): boolean {
    if (user.role === UserRole.SALON_ADMIN || user.role === UserRole.SUPER_ADMIN) return true;
    if (user.role === UserRole.STAFF && user.staffRole === StaffRole.MANAGER) return true;
    return false;
  }

  // ---------------------------------------------------------------- the brain

  /** This salon's brain (cached a minute). `legacy` = assembled from the old screens, never saved. */
  async getBrainFor(tenantId: string): Promise<{ brain: AiBrain; legacy: boolean }> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_MS) return { brain: hit.brain, legacy: hit.legacy };
    const [row, tenant] = await Promise.all([
      this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: AI_BRAIN_KEY } } }).catch(() => null),
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { market: true } }).catch(() => null),
    ]);
    let brain: AiBrain;
    let legacy = false;
    if (row?.value && typeof row.value === 'object') {
      const base = defaultBrain(tenant?.market);
      const v = row.value as Row;
      brain = sanitizeBrain(v, base);
      brain.version = Number(v.version) || 0;
      brain.updatedAt = typeof v.updatedAt === 'string' ? v.updatedAt : null;
      brain.updatedBy = typeof v.updatedBy === 'string' ? v.updatedBy : null;
    } else {
      legacy = true;
      const [conn, line, notes] = await Promise.all([
        this.db.messengerConnection.findUnique({ where: { tenantId }, select: { greeting: true, closing: true, agentName: true, bizIntro: true, aiInstruction: true, botFacts: true } }).catch(() => null),
        this.db.voiceLine.findUnique({ where: { tenantId }, select: { greeting: true, language: true, aiInstruction: true, transferNumber: true } }).catch(() => null),
        this.settings ? this.settings.getAiNotes(tenantId).catch(() => null) : Promise.resolve(null),
      ]);
      brain = brainFromLegacy({ market: tenant?.market, messenger: conn, voice: line, aiNotes: notes?.text ?? '' });
    }
    // ONE number for "how long staff keep the chat after they type": the
    // Messenger connection's humanActiveMins is what the bot actually obeys
    // (messenger.service yield rules). The brain screen used to keep its own
    // copy that nothing read, so changing it there changed nothing.
    // The same for every value whose real home is a channel's own record —
    // ONE value each, shown here and on the channel page alike:
    //  - the chat greeting is the Messenger connection's (what the Page's
    //    welcome screen and "Get started" send);
    //  - "yield to a human" minutes are its graceMins;
    //  - the hotline's transfer number and greeting are the line's (routing
    //    and the keypad-menu path read them there).
    const [quiet, line] = await Promise.all([
      Promise.resolve().then(() => this.db.messengerConnection.findUnique({ where: { tenantId }, select: { humanActiveMins: true, graceMins: true, greeting: true } as never })).catch(() => null) as Promise<{ humanActiveMins?: number; graceMins?: number; greeting?: string | null } | null>,
      Promise.resolve().then(() => this.db.voiceLine.findUnique({ where: { tenantId }, select: { transferNumber: true, greeting: true } })).catch(() => null) as Promise<{ transferNumber?: string | null; greeting?: string | null } | null>,
    ]);
    if (quiet && Number.isInteger(quiet.humanActiveMins)) brain.handoff.staffQuietMins = quiet.humanActiveMins as number;
    if (quiet && Number.isInteger(quiet.graceMins)) brain.channels.chat.yieldMins = quiet.graceMins as number;
    if (quiet) brain.channels.chat.greeting = String(quiet.greeting ?? '').trim();
    if (line) {
      brain.handoff.transferNumber = String(line.transferNumber ?? '').trim();
      if (!brain.channels.voice.greeting.trim()) brain.channels.voice.greeting = String(line.greeting ?? '').trim() || brain.persona.greeting;
    }
    this.cache.set(tenantId, { at: Date.now(), brain, legacy });
    return { brain, legacy };
  }

  async getBrain(tenantId: string): Promise<AiBrain> { return (await this.getBrainFor(tenantId)).brain; }

  async settingsView(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const { brain, legacy } = await this.getBrainFor(tenantId);
    const [line, conn, tenant] = await Promise.all([
      this.db.voiceLine.findUnique({ where: { tenantId }, select: { enabled: true, lumioNumber: true, mode: true, schedule: true, transferNumber: true } }).catch(() => null),
      this.db.messengerConnection.findUnique({ where: { tenantId }, select: { enabled: true, pageName: true, igId: true } }).catch(() => null),
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, market: true } }).catch(() => null),
    ]);
    const old = await this.legacyView(tenantId).catch(() => ({ notes: [], mergedAt: null, canUndo: false }));
    return {
      brain, legacy, canEdit: this.canEdit(user), oldNotes: old,
      salon: { name: tenant?.name ?? '', market: tenant?.market ?? 'US' },
      channels: {
        voice: { provisioned: !!line?.lumioNumber, enabled: !!line?.enabled, number: line?.lumioNumber ?? null, mode: line?.mode ?? 'ai', schedule: line?.schedule ?? 'always' },
        messenger: { connected: !!conn, enabled: !!conn?.enabled, pageName: conn?.pageName ?? null, instagram: !!conn?.igId },
      },
    };
  }

  async updateBrain(user: AuthenticatedUser, dto: unknown): Promise<AiBrain> {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can change the AI brain');
    const tenantId = this.tenantId(user);
    const { brain: current } = await this.getBrainFor(tenantId);
    const next = sanitizeBrain(dto, current);
    next.version = (current.version || 0) + 1;
    next.updatedAt = new Date().toISOString();
    next.updatedBy = user.email || user.userId;
    await this.db.setting.upsert({
      where: { tenantId_key: { tenantId, key: AI_BRAIN_KEY } },
      update: { value: next },
      create: { tenantId, key: AI_BRAIN_KEY, value: next },
    });
    // Staff-quiet minutes live on the Messenger connection, where the bot reads them.
    if (next.handoff.staffQuietMins !== current.handoff.staffQuietMins) {
      await Promise.resolve().then(() => this.db.messengerConnection.updateMany({ where: { tenantId }, data: { humanActiveMins: next.handoff.staffQuietMins } as never })).catch(() => undefined);
    }
    if (next.channels.chat.yieldMins !== current.channels.chat.yieldMins) {
      await Promise.resolve().then(() => this.db.messengerConnection.updateMany({ where: { tenantId }, data: { graceMins: next.channels.chat.yieldMins } as never })).catch(() => undefined);
    }
    // The hotline's transfer number lives on the line (routing): keep the two in step.
    if (next.handoff.transferNumber !== current.handoff.transferNumber) {
      await this.db.voiceLine.updateMany({ where: { tenantId }, data: { transferNumber: next.handoff.transferNumber || null } }).catch(() => undefined);
    }
    // One phone greeting: the keypad-menu path reads the line's own greeting,
    // so the line carries the same words.
    if (next.channels.voice.greeting !== current.channels.voice.greeting) {
      await this.db.voiceLine.updateMany({ where: { tenantId }, data: { greeting: next.channels.voice.greeting || null } }).catch(() => undefined);
    }
    // (The chat greeting is written through /messenger/settings by the screen,
    // which also pushes it to the Page's welcome screen.)
    this.cache.delete(tenantId);
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_brain.updated', resourceType: 'setting', resourceId: AI_BRAIN_KEY, metadata: { version: next.version } });
    return next;
  }

  /** The prompt lines every assistant shares, for this salon, channel and language. */
  async promptBlocks(tenantId: string, channel: 'voice' | 'chat', lang: Lang) {
    const [brain, tenant, tradeRow, industryRow] = await Promise.all([
      this.getBrain(tenantId),
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessType: true, timezone: true } }).catch(() => null),
      this.db.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null),
      this.db.setting.findFirst({ where: { tenantId, key: 'industry' }, select: { value: true } }).catch(() => null),
    ]);
    const persona = personaFor(tenant?.businessType, (tradeRow?.value as { trade?: string } | null)?.trade ?? null, chosenIndustry(industryRow?.value));
    return { brain, blocks: brainPromptBlocks(brain, { channel, salonName: tenant?.name ?? 'our salon', venueNoun: persona.venueNoun, lang, today: salonToday(tenant?.timezone) }) };
  }

  // ---------------------------------------------------------------- the old notes, moved in once

  private async legacySources(tenantId: string): Promise<LegacySources> {
    const [conn, line, notes] = await Promise.all([
      this.db.messengerConnection.findUnique({ where: { tenantId }, select: { greeting: true, closing: true, agentName: true, bizIntro: true, aiInstruction: true, botFacts: true, botMode: true } }).catch(() => null),
      this.db.voiceLine.findUnique({ where: { tenantId }, select: { greeting: true, language: true, aiInstruction: true, transferNumber: true } }).catch(() => null),
      this.settings ? this.settings.getAiNotes(tenantId).catch(() => null) : Promise.resolve(null),
    ]);
    // A sales bot (Lumio's own page) still reads its Messenger fields: those are not "old notes".
    const messenger = conn && conn.botMode === 'sales' ? null : conn;
    return { messenger, voice: line, aiNotes: notes?.text ?? '' };
  }

  /** Notes on the old screens that the brain does not hold — what the owner is asked to move in. */
  async legacyView(tenantId: string) {
    const { brain } = await this.getBrainFor(tenantId);
    const [src, mark] = await Promise.all([
      this.legacySources(tenantId),
      this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: AI_LEGACY_MERGED_KEY } } }).catch(() => null),
    ]);
    const merged = mark?.value && typeof mark.value === 'object' ? (mark.value as Row) : null;
    return { notes: legacyNotes(brain, src), mergedAt: merged?.at ?? null, canUndo: !!merged?.before };
  }

  /** Move every old note into the brain (appended, never overwriting); the brain before is kept for Undo. */
  async mergeLegacyNotes(user: AuthenticatedUser) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can change the AI brain');
    const tenantId = this.tenantId(user);
    const { brain } = await this.getBrainFor(tenantId);
    const src = await this.legacySources(tenantId);
    const moved = legacyNotes(brain, src);
    if (!moved.length) return { moved: 0, brain };
    const next = await this.updateBrain(user, mergeLegacy(brain, src));
    await this.db.setting.upsert({
      where: { tenantId_key: { tenantId, key: AI_LEGACY_MERGED_KEY } },
      update: { value: { at: new Date().toISOString(), by: user.email || user.userId, before: brain, moved: moved.length } },
      create: { tenantId, key: AI_LEGACY_MERGED_KEY, value: { at: new Date().toISOString(), by: user.email || user.userId, before: brain, moved: moved.length } },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_brain.legacy_merged', resourceType: 'setting', resourceId: AI_BRAIN_KEY, metadata: { moved: moved.length, sources: [...new Set(moved.map((m) => m.source))] } });
    return { moved: moved.length, brain: next };
  }

  /** Undo the move: the brain as it was just before. */
  async undoLegacyMerge(user: AuthenticatedUser) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can change the AI brain');
    const tenantId = this.tenantId(user);
    const mark = await this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: AI_LEGACY_MERGED_KEY } } }).catch(() => null);
    const before = mark?.value && typeof mark.value === 'object' ? (mark.value as Row).before : null;
    if (!before) throw new BadRequestException('Nothing to undo.');
    const next = await this.updateBrain(user, before);
    await this.db.setting.update({ where: { tenantId_key: { tenantId, key: AI_LEGACY_MERGED_KEY } }, data: { value: { ...(mark.value as Row), before: null, undoneAt: new Date().toISOString() } } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_brain.legacy_merge_undone', resourceType: 'setting', resourceId: AI_BRAIN_KEY });
    return { brain: next };
  }

  // ---------------------------------------------------------------- customers & memory

  /** This salon's customer with this phone (digits compared from the tail), or null. */
  async customerByPhone(tenantId: string, raw: string | null | undefined): Promise<{ id: string; firstName: string; lastName: string | null; phone: string | null } | null> {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length < 7) return null;
    const rows: Row[] = await this.db.customer.findMany({
      where: { tenantId, phone: { contains: digits.slice(-7) } },
      select: { id: true, firstName: true, lastName: true, phone: true },
      orderBy: { createdAt: 'asc' }, take: 20,
    }).catch(() => []);
    const tail = digits.slice(-9);
    const hit = rows.find((r) => String(r.phone ?? '').replace(/\D/g, '').endsWith(tail)) ?? rows.find((r) => String(r.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-7)));
    return hit ? { id: hit.id, firstName: hit.firstName, lastName: hit.lastName ?? null, phone: hit.phone ?? null } : null;
  }

  async getMemory(tenantId: string, customerId: string | null | undefined): Promise<CustomerMemory | null> {
    if (!customerId) return null;
    const m: Row | null = await this.db.customerMemory.findFirst({ where: { tenantId, customerId } }).catch(() => null);
    if (!m) return null;
    return {
      customerId, profile: String(m.profile ?? ''), preferredLang: asLang(m.preferredLang, 'en') === m.preferredLang ? (m.preferredLang as Lang) : null,
      prefs: (m.prefs && typeof m.prefs === 'object' ? m.prefs : {}) as Record<string, unknown>,
      openIntent: m.openIntent && typeof m.openIntent === 'object' && m.openIntent.text ? m.openIntent : null,
      lastChannel: m.lastChannel ?? null, lastContactAt: m.lastContactAt ?? null, salonNote: String(m.salonNote ?? ''),
    };
  }

  /** The memory as a prompt block (the customer's own language is used for the labels the model sees). */
  memoryBlock(m: CustomerMemory | null, now = new Date()): string {
    if (!m) return '';
    const parts: string[] = [];
    if (m.profile.trim()) parts.push(`CUSTOMER MEMORY (what this ${'salon'} remembers about this person from earlier calls and chats — use it, never ask for what is here):\n${m.profile.trim()}`);
    if (m.salonNote.trim()) parts.push(`The owner's own note about this customer: ${m.salonNote.trim()}`);
    if (m.openIntent) {
      const days = Math.max(0, Math.floor((now.getTime() - new Date(m.openIntent.at).getTime()) / 86_400_000));
      parts.push(`UNFINISHED from ${days === 0 ? 'earlier today' : `${days} day(s) ago`} (${m.openIntent.channel}): ${m.openIntent.text}. If they come back to it, continue from here — do not start over or re-ask what is already known. If they ask for something else, help with that instead.`);
    }
    if (m.lastContactAt) {
      const days = Math.floor((now.getTime() - new Date(m.lastContactAt).getTime()) / 86_400_000);
      if (days >= 1) parts.push(`RETURNING CUSTOMER: last spoke ${days} day(s) ago. Greet them like someone you know; no stranger's introduction, no re-discovery.`);
    }
    return parts.join('\n');
  }

  /** After a turn: where they spoke, in which language, and what is still open. */
  async touchMemory(tenantId: string, customerId: string | null | undefined, patch: { channel: Channel; lang?: Lang | null; openIntent?: string | null; phone?: string | null }): Promise<void> {
    if (!customerId) return;
    const now = new Date();
    const data: Row = { lastChannel: patch.channel, lastContactAt: now, updatedAt: now };
    if (patch.lang) data.preferredLang = patch.lang;
    if (patch.phone) data.phone = patch.phone;
    if (patch.openIntent !== undefined) data.openIntent = patch.openIntent ? { text: patch.openIntent.slice(0, 300), at: now.toISOString(), channel: patch.channel } : null;
    const n = await this.db.customerMemory.updateMany({ where: { tenantId, customerId }, data }).catch(() => ({ count: 0 }));
    if (!n?.count) {
      await this.db.customerMemory.create({ data: { tenantId, customerId, profile: '', prefs: {}, ...data, createdAt: now } }).catch(() => undefined);
    }
  }

  /**
   * Merge a conversation's turns into the customer's standing profile
   * (best-effort, in the background). Written in the customer's language;
   * with no model key the lines are banked raw so nothing is lost.
   */
  async distillMemory(tenantId: string, customerId: string, lines: { role: 'user' | 'assistant'; content: string }[], lang: Lang): Promise<void> {
    if (!customerId || !lines.length) return;
    const m = await this.getMemory(tenantId, customerId);
    const prev = m?.profile ?? '';
    const text = lines.slice(-30).map((t) => `${t.role === 'user' ? 'CUSTOMER' : 'SHOP'}: ${String(t.content ?? '').slice(0, 400)}`).join('\n');
    const key = process.env.ANTHROPIC_API_KEY || '';
    let next = '';
    if (key) {
      const prompt = `You keep the CUSTOMER PROFILE a salon's assistants share across phone calls and chats. Current profile:\n${prev || '(empty)'}\n\nNew conversation:\n${text}\n\nWrite the NEW profile: merge old + new, 120 words maximum, short bullet lines — name, phone if said, usual services, preferred technician, allergies or health notes they mentioned, preferences (pressure, colours), schedule habits, anything still unfinished, how they like to be spoken to. ONLY what actually appeared, never an inference. Write it in ${lang === 'vi' ? 'Vietnamese' : lang === 'es' ? 'Spanish' : 'English'}. Return the profile only.`;
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          const j = (await res.json()) as { content?: { type?: string; text?: string }[] };
          next = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
        }
      } catch { next = ''; }
    }
    if (!next) next = [prev, text].filter(Boolean).join('\n').slice(-1500);
    const now = new Date();
    const n = await this.db.customerMemory.updateMany({ where: { tenantId, customerId }, data: { profile: next.slice(0, 1500), updatedAt: now } }).catch(() => ({ count: 0 }));
    if (!n?.count) await this.db.customerMemory.create({ data: { tenantId, customerId, profile: next.slice(0, 1500), prefs: {}, createdAt: now, updatedAt: now } }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- callback tasks

  /** The assistant could not finish: leave the desk a task and tell them now. */
  async createCallback(input: CallbackInput): Promise<{ id: string } | null> {
    const brain = await this.getBrain(input.tenantId);
    const summary = String(input.summary ?? '').trim().slice(0, 500);
    const phone = input.phone ? String(input.phone).trim().slice(0, 40) : null;
    // One open task per customer/phone per reason: a caller who hits silence twice is one task.
    const dupe: Row | null = await this.db.aiCallbackTask.findFirst({
      where: { tenantId: input.tenantId, doneAt: null, reason: input.reason, ...(phone ? { phone } : input.customerId ? { customerId: input.customerId } : input.threadId ? { threadId: input.threadId } : { id: '__none__' }), createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } },
      select: { id: true },
    }).catch(() => null);
    if (dupe) {
      await this.db.aiCallbackTask.updateMany({ where: { id: dupe.id, tenantId: input.tenantId }, data: { summary, sessionId: input.sessionId ?? undefined } }).catch(() => undefined);
      return { id: dupe.id };
    }
    const row: Row = await this.db.aiCallbackTask.create({
      data: {
        tenantId: input.tenantId, channel: input.channel, reason: String(input.reason).slice(0, 40), summary,
        phone, name: input.name ? String(input.name).slice(0, 80) : null, customerId: input.customerId ?? null,
        sessionId: input.sessionId ?? null, threadId: input.threadId ?? null, dueAt: new Date(Date.now() + 15 * 60_000),
      },
    }).catch((e: unknown) => { this.log.warn(`callback task failed: ${String(e).slice(0, 120)}`); return null; });
    if (!row) return null;
    const who = input.name || phone || (input.channel === 'voice' ? 'a caller' : 'a customer');
    const title = input.channel === 'voice' ? `📞 Gọi lại ${who}` : `💬 Trả lời ${who}`;
    if (this.push && (brain.handoff.notifyOwnerPush || brain.handoff.notifyDeskPush)) {
      this.push.sendToTenant(input.tenantId, { title, body: summary || END_REASON_LABEL[(input.reason as EndReason)]?.vi || input.reason, url: '/salon/ai?tab=overview', tag: `ai-callback-${row.id}` }).catch(() => undefined);
    }
    return { id: row.id };
  }

  async listCallbacks(user: AuthenticatedUser, open = true) {
    const tenantId = this.tenantId(user);
    const rows: Row[] = await this.db.aiCallbackTask.findMany({
      where: { tenantId, ...(open ? { doneAt: null } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
    }).catch(() => []);
    return rows;
  }

  async doneCallback(user: AuthenticatedUser, id: string, done = true) {
    const tenantId = this.tenantId(user);
    const n = await this.db.aiCallbackTask.updateMany({ where: { id, tenantId }, data: { doneAt: done ? new Date() : null, doneBy: done ? user.userId : null } });
    if (!n.count) throw new NotFoundException('Task not found');
    await this.audit.log({ tenantId, userId: user.userId, action: done ? 'ai_callback.done' : 'ai_callback.reopened', resourceType: 'ai_callback_task', resourceId: id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- sessions (why it ended)

  async startSession(input: { tenantId: string; channel: Channel; externalId: string; customerId?: string | null; phone?: string | null; lang?: Lang | null }): Promise<string | null> {
    const existing: Row | null = await this.db.aiSession.findFirst({ where: { tenantId: input.tenantId, externalId: input.externalId }, select: { id: true } }).catch(() => null);
    if (existing) return existing.id;
    const row: Row | null = await this.db.aiSession.create({
      data: { tenantId: input.tenantId, channel: input.channel, externalId: input.externalId, customerId: input.customerId ?? null, phone: input.phone ?? null, lang: input.lang ?? null, outcome: 'in_progress', endReason: 'in_progress', failures: [], bookedIds: [] },
    }).catch(() => null);
    return row?.id ?? null;
  }

  /** One turn's facts, added to the session: how long it took, which tools ran, what failed. */
  async noteTurn(tenantId: string, externalId: string, t: { ms: number; toolCalls?: number; failure?: string | null; bookedId?: string | null; lang?: Lang | null; customerId?: string | null }): Promise<void> {
    const s: Row | null = await this.db.aiSession.findFirst({ where: { tenantId, externalId } }).catch(() => null);
    if (!s) return;
    const failures = Array.isArray(s.failures) ? [...s.failures] : [];
    if (t.failure) failures.push({ at: new Date().toISOString(), what: String(t.failure).slice(0, 200) });
    const booked = Array.isArray(s.bookedIds) ? [...s.bookedIds] : [];
    if (t.bookedId && !booked.includes(t.bookedId)) booked.push(t.bookedId);
    await this.db.aiSession.updateMany({
      where: { id: s.id, tenantId },
      data: {
        turns: (s.turns ?? 0) + 1, toolCalls: (s.toolCalls ?? 0) + (t.toolCalls ?? 0),
        slowTurns: (s.slowTurns ?? 0) + (t.ms >= SLOW_TURN_MS ? 1 : 0), maxTurnMs: Math.max(s.maxTurnMs ?? 0, Math.round(t.ms)),
        failures: failures.slice(-20), bookedIds: booked, ...(t.lang ? { lang: t.lang } : {}), ...(t.customerId ? { customerId: t.customerId } : {}),
        ...(booked.length ? { outcome: 'booked' } : {}),
      },
    }).catch(() => undefined);
  }

  async endSession(tenantId: string, externalId: string, endReason: EndReason, outcome?: string): Promise<void> {
    await this.db.aiSession.updateMany({
      where: { tenantId, externalId, endedAt: null },
      data: { endReason, endedAt: new Date(), ...(outcome ? { outcome } : {}) },
    }).catch(() => undefined);
  }

  async health(user: AuthenticatedUser, days = 7) {
    const tenantId = this.tenantId(user);
    const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86_400_000);
    const [sessions, openCallbacks] = await Promise.all([
      this.db.aiSession.findMany({ where: { tenantId, startedAt: { gte: since } }, select: { channel: true, outcome: true, endReason: true, slowTurns: true, bookedIds: true, failures: true } }).catch(() => [] as Row[]),
      this.db.aiCallbackTask.count({ where: { tenantId, doneAt: null } }).catch(() => 0),
    ]);
    const byChannel: Record<string, number> = {};
    const endReasons: Record<string, number> = {};
    let booked = 0, bookedCount = 0, slow = 0, errors = 0, refused = 0;
    for (const s of sessions as Row[]) {
      byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;
      endReasons[s.endReason] = (endReasons[s.endReason] ?? 0) + 1;
      const ids = Array.isArray(s.bookedIds) ? s.bookedIds.length : 0;
      if (ids) { booked += 1; bookedCount += ids; }
      slow += Number(s.slowTurns ?? 0);
      if (s.endReason === 'error' || s.endReason === 'deadline' || s.endReason === 'tool_loop') errors += 1;
      refused += (Array.isArray(s.failures) ? s.failures : []).filter((f: Row) => /NOT BOOKED|OUTSIDE|walk-in|closed/i.test(String(f?.what ?? ''))).length;
    }
    return { days, total: sessions.length, byChannel, booked, bookedCount, endReasons, slowTurns: slow, errorEnds: errors, refusedBookings: refused, openCallbacks, labels: END_REASON_LABEL };
  }

  async listSessions(user: AuthenticatedUser, q: { filter?: string; take?: number }) {
    const tenantId = this.tenantId(user);
    const where: Row = { tenantId };
    if (q.filter === 'unbooked') where.outcome = { not: 'booked' };
    if (q.filter === 'slow') where.slowTurns = { gt: 0 };
    if (q.filter === 'callback') where.endReason = { in: ['silence', 'error', 'tool_loop', 'deadline', 'callback'] };
    const rows: Row[] = await this.db.aiSession.findMany({ where, orderBy: { startedAt: 'desc' }, take: Math.min(200, q.take ?? 60) }).catch(() => []);
    const cids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    const cs: Row[] = cids.length ? await this.db.customer.findMany({ where: { tenantId, id: { in: cids } }, select: { id: true, firstName: true, lastName: true } }).catch(() => []) : [];
    const name = new Map(cs.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')]));
    return rows.map((r) => ({ ...r, customerName: r.customerId ? name.get(r.customerId) ?? null : null, failures: Array.isArray(r.failures) ? r.failures : [] }));
  }

  /** One conversation with its turns: the call's transcript or the thread's history, read under this salon. */
  async sessionDetail(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const s: Row | null = await this.db.aiSession.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Session not found');
    let turns: { role: string; content: string; at?: string }[] = [];
    if (s.channel === 'voice') {
      const call: Row | null = await this.db.voiceCall.findFirst({ where: { tenantId, callSid: s.externalId }, select: { transcript: true, durationSec: true, outcome: true } }).catch(() => null);
      turns = (Array.isArray(call?.transcript) ? call!.transcript : []).map((t: Row) => ({ role: String(t.role), content: String(t.content ?? '') }));
    } else {
      const th: Row | null = await this.db.messengerThread.findFirst({ where: { id: s.externalId, tenantId }, select: { history: true } }).catch(() => null);
      turns = (Array.isArray(th?.history) ? th!.history : []).map((t: Row) => ({ role: String(t.role), content: typeof t.content === 'string' ? t.content : '', at: t.at }));
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_session.viewed', resourceType: 'ai_session', resourceId: id });
    return { ...s, turns, failures: Array.isArray(s.failures) ? s.failures : [] };
  }

  // ---------------------------------------------------------------- memory screens

  async listMemories(user: AuthenticatedUser, q: string | undefined) {
    const tenantId = this.tenantId(user);
    const rows: Row[] = await this.db.customerMemory.findMany({ where: { tenantId }, orderBy: { lastContactAt: 'desc' }, take: 300 }).catch(() => []);
    const ids = rows.map((r) => r.customerId);
    const cs: Row[] = ids.length ? await this.db.customer.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true, phone: true } }).catch(() => []) : [];
    const byId = new Map(cs.map((c) => [c.id, c]));
    const needle = String(q ?? '').trim().toLowerCase();
    return rows.map((r) => {
      const c = byId.get(r.customerId);
      return { customerId: r.customerId, name: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : null, phone: c?.phone ?? r.phone ?? null, preferredLang: r.preferredLang ?? null, lastChannel: r.lastChannel, lastContactAt: r.lastContactAt, openIntent: r.openIntent?.text ?? null, profileShort: String(r.profile ?? '').slice(0, 160) };
    }).filter((r) => !needle || String(r.name ?? '').toLowerCase().includes(needle) || String(r.phone ?? '').replace(/\D/g, '').includes(needle.replace(/\D/g, '') || '§'));
  }

  async memoryDetail(user: AuthenticatedUser, customerId: string) {
    const tenantId = this.tenantId(user);
    const c: Row | null = await this.db.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } });
    if (!c) throw new NotFoundException('Customer not found');
    const m = await this.getMemory(tenantId, customerId);
    const sessions: Row[] = await this.db.aiSession.findMany({ where: { tenantId, customerId }, orderBy: { startedAt: 'desc' }, take: 20 }).catch(() => []);
    const visits: Row[] = await this.db.appointment.findMany({ where: { tenantId, customerId, status: 'COMPLETED' }, orderBy: { startTime: 'desc' }, take: 10, select: { startTime: true, priceCents: true, service: { select: { name: true } }, assignedStaff: { select: { firstName: true } } } }).catch(() => []);
    return {
      customer: { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), phone: c.phone, email: c.email },
      memory: m, sessions, visits: visits.map((v) => ({ at: v.startTime, service: v.service?.name ?? '', staff: v.assignedStaff?.firstName ?? null, priceCents: v.priceCents })),
    };
  }

  async noteMemory(user: AuthenticatedUser, customerId: string, dto: { salonNote?: string; profile?: string }) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can edit a memory');
    const tenantId = this.tenantId(user);
    const c = await this.db.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Customer not found');
    const data: Row = { updatedAt: new Date() };
    if (typeof dto.salonNote === 'string') data.salonNote = dto.salonNote.trim().slice(0, 600);
    if (typeof dto.profile === 'string') data.profile = dto.profile.trim().slice(0, 1500);
    const n = await this.db.customerMemory.updateMany({ where: { tenantId, customerId }, data });
    if (!n.count) await this.db.customerMemory.create({ data: { tenantId, customerId, profile: data.profile ?? '', salonNote: data.salonNote ?? '', prefs: {} } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_memory.edited', resourceType: 'customer', resourceId: customerId });
    return this.getMemory(tenantId, customerId);
  }

  async deleteMemory(user: AuthenticatedUser, customerId: string) {
    if (!this.canEdit(user)) throw new ForbiddenException('Only the owner or a manager can erase a memory');
    const tenantId = this.tenantId(user);
    await this.db.customerMemory.deleteMany({ where: { tenantId, customerId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_memory.erased', resourceType: 'customer', resourceId: customerId });
    return { ok: true };
  }

  // ---------------------------------------------------------------- sandbox

  /**
   * Talk to the brain as a customer would, with no side effects: the menu
   * and the real book are read, nothing is written, no text is sent, and
   * the memory is untouched. The same prompt blocks the live assistants use.
   */
  async sandbox(
    user: AuthenticatedUser,
    dto: { messages: { role: 'user' | 'assistant'; content: string }[]; channel?: 'voice' | 'chat'; customerId?: string | null },
    opts: { instructions?: Instruction[]; on?: InstructionChannel } = {},
  ) {
    const tenantId = this.tenantId(user);
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) throw new BadRequestException('AI is not configured on this server');
    const msgs = (Array.isArray(dto.messages) ? dto.messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-30);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new BadRequestException('Send the customer\'s message');
    const channel = dto.channel === 'voice' ? 'voice' : 'chat';
    const { brain, blocks: pre } = await this.promptBlocks(tenantId, channel, 'en');
    const lang = conversationLanguage(msgs.filter((m) => m.role === 'user').map((m) => m.content), brain.languages.allowed, brain.languages.primary);
    const { blocks } = await this.promptBlocks(tenantId, channel, lang);
    const tenant: Row | null = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true, market: true, businessType: true } }).catch(() => null);
    const tz = tenant?.timezone || 'America/New_York';
    const memory = dto.customerId ? await this.getMemory(tenantId, dto.customerId) : null;
    const services: Row[] = await this.db.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, priceCents: true, durationMinutes: true, currency: true }, orderBy: { name: 'asc' }, take: 150 }).catch(() => []);
    const menu: MenuItem[] = services.map((s) => ({ id: s.id, name: s.name, minutes: s.durationMinutes > 0 ? s.durationMinutes : 30 }));
    const staff: Row[] = await this.db.staffMember.findMany({ where: { tenantId, isActive: true, takesAppointments: true }, select: { id: true, firstName: true, lastName: true }, take: 60 }).catch(() => []);
    const locale = String(tenant?.market ?? '').toUpperCase() === 'VN' ? 'vi-VN' : 'en-US';
    const menuText = services.map((s, i) => `- ${serviceCode(i)} ${s.name} — ${formatMoneyShort(s.priceCents, s.currency ?? 'USD', locale)}${s.durationMinutes ? `, ${s.durationMinutes} min` : ''}`).join('\n');
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const lastUser = msgs[msgs.length - 1].content;
    const insCh: InstructionChannel = opts.on ?? (channel === 'voice' ? 'voice' : 'messenger');
    const owner = this.instructions ? await this.instructions.forTurn(tenantId, insCh, lastUser, opts.instructions).catch(() => null) : null;
    const system = `You are the ${channel === 'voice' ? 'phone receptionist' : 'booking assistant'} for "${tenant?.name ?? 'our salon'}". THIS IS A TEST CONVERSATION run by the salon's own staff: behave exactly as with a real customer, but no booking will be written.
${pre.persona}
${channel === 'voice' ? 'Your words are read aloud: one or two short sentences, under 30 words, one question at a time, no lists or emoji.' : 'Write like a warm receptionist texting: 1–2 short sentences, one question at a time, a light emoji sometimes.'}
Collect what a booking needs (service, day and time, first name, phone), check the book with check_availability before offering a time, recap once and ask for a yes, then call create_booking.
${blocks.booking}
${blocks.handoffNote}
Menu (pass the code to the tools; never say a code aloud):\n${menuText || '(no services yet)'}
${blocks.facts ? `Salon notes:\n${blocks.facts}` : ''}
${blocks.rules ? `THE OWNER'S RULES — follow on every conversation:\n${blocks.rules}` : ''}
${this.memoryBlock(memory)}
The salon's local time is ${nowLocal} (${tz}). Only state hours, prices and services given here.
${owner?.block ? `${owner.block}\n` : ''}${owner?.matched ? `${owner.matched}\n` : ''}${blocks.language}`;
    const ctx = { menu, staff: staff as { id: string; firstName: string; lastName: string | null }[] };
    const parties = this.party ?? (this.settings ? new PartyAvailabilityService(this.prisma, this.settings) : null);
    const tools = [
      { name: 'check_availability', description: 'Look in the book before offering or confirming a time.', input_schema: { type: 'object', properties: { date: { type: 'string' }, time: { type: 'string' }, people: { type: 'array', items: { type: 'object', properties: { services: { type: 'array', items: { type: 'string' } }, technician: { type: 'string' } }, required: ['services'] } } }, required: ['date', 'people'] } },
      { name: 'create_booking', description: 'Book after the customer said yes to the recap.', input_schema: { type: 'object', properties: { localDateTime: { type: 'string' }, people: { type: 'array', items: { type: 'object', properties: { firstName: { type: 'string' }, services: { type: 'array', items: { type: 'string' } } }, required: ['firstName', 'services'] } }, customerPhone: { type: 'string' } }, required: ['localDateTime', 'people'] } },
      { name: 'request_callback', description: 'Leave the desk a task when you cannot help.', input_schema: { type: 'object', properties: { reason: { type: 'string' }, summary: { type: 'string' } }, required: ['summary'] } },
    ];
    const messages: Row[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    const trace: string[] = [];
    const t0 = Date.now();
    let corrected = false;
    let firstDraft: string | null = null;
    let firstBroken: string[] | null = null;
    for (let loop = 0; loop < 6; loop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 300, system, tools, messages }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new BadRequestException(`AI answered ${res.status}`);
      const data = (await res.json()) as { stop_reason?: string; content?: Row[] };
      const blocksOut = data.content || [];
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocksOut });
        const results: Row[] = [];
        for (const b of blocksOut) {
          if (b.type !== 'tool_use') continue;
          let out = '';
          if (b.name === 'check_availability' && parties) {
            try { out = await parties.describe(tenantId, tz, b.input || {}, ctx); } catch (e) { out = `ERROR: ${String((e as Error).message).slice(0, 120)}`; }
          } else if (b.name === 'create_booking') {
            out = 'SUCCESS (TEST — nothing was written). Tell the customer it is booked, as you would for real.';
          } else if (b.name === 'request_callback') {
            out = 'NOTED (TEST — no task was created). Tell the customer the team will get back to them.';
          } else out = 'Unknown tool.';
          trace.push(`${b.name}: ${out.slice(0, 160)}`);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = blocksOut.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      // The owner's instructions, checked exactly as on a live conversation:
      // a broken one goes back once for a rewrite, then the judge's (or the
      // owner's own) words go out instead.
      if (owner && this.instructions && text) {
        const chk = await this.instructions.check(tenantId, { turn: owner, channel: insCh, customer: lastUser, draft: text, lang, timeoutMs: 8000 }).catch(() => null);
        if (chk?.broken.length) {
          const brokenText = chk.broken.map((i) => i.text);
          if (!corrected) {
            corrected = true;
            firstDraft = text;
            firstBroken = brokenText;
            trace.push(`blocked: ${brokenText.join(' | ').slice(0, 200)}`);
            messages.push({ role: 'assistant', content: blocksOut });
            messages.push({ role: 'user', content: correctionFor(owner.all, chk.broken) });
            continue;
          }
          const sameLang = chk.broken.every((i) => { const l = detectLanguage(i.text); return !l || l === lang; });
          const last = lastResort(chk.broken, chk.rewrite, sameLang);
          trace.push('blocked twice: replaced');
          return { reply: last || checkingLine(lang), lang, trace, ms: Date.now() - t0, check: { followed: !!last, corrected: true, draft: firstDraft ?? text, broken: firstBroken ?? brokenText, applied: chk.applied.map((i) => i.id) } };
        }
        return { reply: text, lang, trace, ms: Date.now() - t0, check: { followed: true, corrected, draft: firstDraft, broken: firstBroken ?? [], applied: (chk?.applied ?? []).map((i) => i.id) } };
      }
      return { reply: text, lang, trace, ms: Date.now() - t0, check: null };
    }
    return { reply: '', lang, trace: [...trace, 'tool loop exhausted'], ms: Date.now() - t0, check: null };
  }

  /**
   * "Thử lại" on the teach panel: the customer's question run through the
   * sandbox with the instruction being written (or edited) already in force,
   * and nothing saved. The rest of the salon's instructions apply too.
   */
  async tryInstruction(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const tenantId = this.tenantId(user);
    if (!this.instructions) throw new BadRequestException('Instructions are not available');
    const c = cleanInstruction(dto);
    if (!c.ok) throw new BadRequestException(c.error);
    const question = typeof dto.question === 'string' ? dto.question.trim().slice(0, 2000) : '';
    if (!question) throw new BadRequestException('Send the customer\'s question');
    const editing = typeof dto.editingId === 'string' ? dto.editingId : null;
    const stored = await this.instructions.allFor(tenantId);
    const temp: Instruction = { id: '__try', kind: c.value.kind, text: c.value.text, triggers: c.value.triggers, mode: c.value.mode, channels: c.value.channels, on: true };
    const list = [...stored.filter((i) => i.id !== editing), temp];
    const on = instructionChannel(typeof dto.channel === 'string' ? dto.channel : null);
    const ctx = (Array.isArray(dto.context) ? dto.context : [])
      .filter((m): m is { role: 'user' | 'assistant'; content: string } => !!m && typeof m === 'object' && ((m as Row).role === 'user' || (m as Row).role === 'assistant') && typeof (m as Row).content === 'string')
      .slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    while (ctx.length && ctx[0].role !== 'user') ctx.shift();
    while (ctx.length && ctx[ctx.length - 1].role === 'user') ctx.pop();
    const r = await this.sandbox(user, { messages: [...ctx, { role: 'user', content: question }], channel: on === 'voice' ? 'voice' : 'chat' }, { instructions: list, on });
    return { reply: r.reply, lang: r.lang, ms: r.ms, followed: r.check ? r.check.followed : true, corrected: r.check?.corrected ?? false, draft: r.check?.draft ?? null, applied: (r.check?.applied ?? []).includes('__try') };
  }

  /** "Gọi lại cho khách" from a call or a chat the owner reviewed: a callback task for the desk. */
  async ownerCallback(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const tenantId = this.tenantId(user);
    const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const summary = s(dto.summary, 600);
    if (!summary) throw new BadRequestException('Say what to tell the customer');
    const ch = s(dto.channel, 20);
    const channel = (['voice', 'messenger', 'instagram', 'zalo', 'web'].includes(String(ch)) ? ch : 'voice') as Channel;
    const r = await this.createCallback({ tenantId, channel, reason: 'owner', summary, phone: s(dto.phone, 40), name: s(dto.name, 120), customerId: s(dto.customerId, 64), threadId: s(dto.threadId, 64) });
    await this.audit.log({ tenantId, userId: user.userId, action: 'ai_callback.created_by_owner', resourceType: 'ai_callback', resourceId: r?.id ?? 'none' });
    return { ok: !!r, id: r?.id ?? null };
  }
}

/** Today's date where the salon is (YYYY-MM-DD) — dated facts switch on and off by the salon's own calendar. */
export function salonToday(tz?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
