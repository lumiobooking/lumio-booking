import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { MessengerService } from './messenger.service';
import {
  WEB_CHAT_KEY, WebChatConfig, cleanWebChatConfig, cleanText, cleanVisitor,
  embedSnippet, turnsSince, webPageId,
} from './web-chat';

/**
 * Website chat: the salon's switch, and the two calls a visitor's browser
 * makes. Everything the brain does with a message is MessengerService's —
 * this only decides which salon, whether the switch is on, and what the
 * browser is allowed to read back.
 */
@Injectable()
export class WebChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '') + '/api';
  }

  private async configOf(tenantId: string): Promise<WebChatConfig> {
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: WEB_CHAT_KEY }, select: { value: true } }).catch(() => null);
    return cleanWebChatConfig(null, (row?.value ?? null) as Partial<WebChatConfig> | null);
  }

  // ---- the salon's side -----------------------------------------------------

  /** Everything the settings panel shows, including the line to paste. */
  async status(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [cfg, tenant, conn] = await Promise.all([
      this.configOf(tenantId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, name: true } }).catch(() => null),
      this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null),
    ]);
    const slug = tenant?.slug ?? '';
    const threads = await this.prisma.messengerThread.count({ where: { tenantId, pageId: webPageId(tenantId) } }).catch(() => 0);
    return {
      ...cfg,
      slug,
      snippet: slug ? embedSnippet(this.apiBase(), slug) : '',
      widgetUrl: `${this.apiBase()}/public/chat/widget.js`,
      // The brain needs its per-salon row (bot name, mode, instructions). It is
      // created on first enable; until then the panel says the bot has no voice yet.
      brainReady: Boolean(conn),
      conversations: threads,
    };
  }

  /** Save the switch and the look. Turning it on wires the mouth. */
  async update(user: AuthenticatedUser, dto: Record<string, unknown>) {
    const tenantId = this.tenantId(user);
    const prev = await this.configOf(tenantId);
    const next = cleanWebChatConfig(dto, prev);
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: WEB_CHAT_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: WEB_CHAT_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    if (next.enabled) await this.ensureMouth(tenantId);
    return this.status(user);
  }

  /**
   * The rows that make the brain route "web:<tenant>" to this salon: a page
   * row for the mouth and, for a salon with no Facebook or Zalo, the minimal
   * brain row. An existing brain row is never touched — same brain, same
   * instructions, one more mouth; and its own on/off switch stays its own.
   */
  private async ensureMouth(tenantId: string): Promise<void> {
    const pageId = webPageId(tenantId);
    await this.prisma.messengerPage.upsert({
      where: { pageId },
      update: { tenantId, pageName: 'Website', enabled: true },
      create: { tenantId, pageId, pageToken: 'web', pageName: 'Website', enabled: true },
    });
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (!conn) {
      await this.prisma.messengerConnection.create({
        data: { tenantId, pageId, pageToken: 'web', pageName: 'Website', enabled: true },
      });
    }
  }

  // ---- the visitor's side ---------------------------------------------------

  /** Slug → live salon with the switch on, or null. */
  private async salonBySlug(slug: string): Promise<{ id: string; name: string; market: string | null; agentName: string | null; cfg: WebChatConfig } | null> {
    const s = String(slug ?? '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,80}$/.test(s)) return null;
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: s, deletedAt: null, status: 'ACTIVE' } as never,
      select: { id: true, name: true, market: true } as never,
    }).catch(() => null) as { id: string; name: string; market?: string | null } | null;
    if (!tenant) return null;
    const cfg = await this.configOf(tenant.id);
    if (!cfg.enabled) return null;
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId: tenant.id } }).catch(() => null) as { agentName?: string | null } | null;
    return { id: tenant.id, name: tenant.name, market: tenant.market ?? null, agentName: conn?.agentName ?? null, cfg };
  }

  /** What the widget needs to draw itself. `ok:false` = draw nothing. */
  async publicConfig(slug: string) {
    const s = await this.salonBySlug(slug);
    if (!s) return { ok: false };
    return {
      ok: true,
      name: s.name,
      color: s.cfg.color,
      greeting: s.cfg.greeting,
      position: s.cfg.position,
      offsetY: s.cfg.offsetY,
      size: s.cfg.size,
      agentName: s.agentName,
      lang: String(s.market ?? '').toUpperCase() === 'VN' ? 'vi' : 'en',
    };
  }

  /** A line from the visitor. The brain answers into the thread; the browser polls. */
  /**
   * One line from a visitor, answered in the same request.
   *
   * WHY THE REPLY RIDES BACK ON THE POST
   *
   * The brain already runs to completion inside this call — the model has
   * spoken by the time we return. The widget used to be told only "ok", then
   * waited 1.2 seconds, then polled, then waited for that round trip. So a
   * visitor on a phone watched the three dots for the model's time PLUS two
   * seconds of our own making, on every single message. That is the "chậm"
   * people feel: not the model, the choreography around it.
   *
   * Reading the thread back costs one indexed lookup and removes the whole
   * extra round trip. `since` is stamped before the brain runs, so the turns
   * that come back are exactly this exchange — the visitor's own line included,
   * which the widget de-duplicates against the one it drew optimistically.
   */
  async inbound(slug: string, body: { visitor?: unknown; text?: unknown }) {
    const s = await this.salonBySlug(slug);
    if (!s) throw new NotFoundException('Chat is not available for this site.');
    const visitor = cleanVisitor(body?.visitor);
    const text = cleanText(body?.text);
    if (!visitor) throw new BadRequestException('visitor');
    if (!text) throw new BadRequestException('text');
    // A hair earlier than the write, so a reply stamped in the same millisecond
    // is not filtered out by a strictly-greater-than comparison.
    const since = new Date(Date.now() - 1000).toISOString();
    await this.ensureMouth(s.id);
    await this.messenger.inboundWeb(s.id, visitor, text);
    // Best effort: if this read fails the widget still polls, so the visitor
    // sees the answer a moment later rather than not at all.
    const back = await this.messages(slug, visitor, since).catch(() => null);
    return { ok: true, turns: back?.turns ?? [], handoff: Boolean(back?.handoff) };
  }

  /** The conversation as the browser shows it — only this visitor's, only what is new. */
  async messages(slug: string, visitorRaw: unknown, since?: unknown) {
    const s = await this.salonBySlug(slug);
    if (!s) return { ok: false, turns: [] };
    const visitor = cleanVisitor(visitorRaw);
    if (!visitor) return { ok: false, turns: [] };
    const thread = await this.prisma.messengerThread.findUnique({
      where: { pageId_senderId: { pageId: webPageId(s.id), senderId: visitor } },
      select: { history: true, handoff: true },
    }).catch(() => null);
    if (!thread) return { ok: true, turns: [], handoff: false };
    const sinceStr = typeof since === 'string' && since ? since : null;
    return { ok: true, turns: turnsSince(thread.history, sinceStr), handoff: Boolean(thread.handoff) };
  }
}
