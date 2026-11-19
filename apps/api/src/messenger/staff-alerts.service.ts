import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { publicWebBase } from '../common/public-url.util';
import {
  CLAIM_PREFIX, CODES_KEY, LINKS_KEY, SKIP_PREFIX, cleanCodes, cleanLinks, linkOf, turnAlert, windowOpen,
  type StaffCommand, type StaffLink,
} from './staff-alerts';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * A team member's own Messenger as their turn alert (see ./staff-alerts).
 * Everything is per salon: the links and the one-time codes live in that
 * salon's settings, a code only links inside the salon whose Page received
 * it, and a "Nhận khách" tap only reaches a conversation of that salon.
 */
@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger('StaffAlerts');
  /** Set by ChatTurnsService (it routes; we only ask). Avoids a module cycle. */
  private skipRouter: ((tenantId: string, threadId: string, fromUserId: string) => Promise<string | null>) | null = null;
  private readonly cache = new Map<string, { at: number; links: Record<string, StaffLink> }>();

  constructor(private readonly prisma: PrismaService) {}

  setSkipRouter(fn: (tenantId: string, threadId: string, fromUserId: string) => Promise<string | null>) { this.skipRouter = fn; }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async read(tenantId: string, key: string): Promise<unknown> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key } } }).catch(() => null);
    return row?.value ?? null;
  }

  private async write(tenantId: string, key: string, value: unknown) {
    const v = value as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, value: v }, update: { value: v } });
    if (key === LINKS_KEY) this.cache.delete(tenantId);
  }

  async linksOf(tenantId: string): Promise<Record<string, StaffLink>> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.links;
    const links = cleanLinks(await this.read(tenantId, LINKS_KEY));
    this.cache.set(tenantId, { at: Date.now(), links });
    return links;
  }

  private async audit(tenantId: string, userId: string | null, action: string, resourceId?: string) {
    try { await this.prisma.auditLog.create({ data: { tenantId, userId: userId ?? undefined, action, resourceType: 'messenger', resourceId } as never }); } catch { /* never break */ }
  }

  // ---------------------------------------------------------------- the app

  /** My link: whether my Messenger is linked, on shift, and the window left. */
  async mine(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const l = (await this.linksOf(tenantId))[user.userId] ?? null;
    const pages = await this.prisma.messengerPage.findMany({ where: { tenantId, enabled: true }, select: { pageId: true, pageName: true }, take: 10 }).catch(() => []);
    const now = new Date();
    return {
      linked: !!l,
      on: !!l?.on,
      windowOpen: windowOpen(l, now),
      windowEndsAt: l?.on && l.lastAt ? new Date(new Date(l.lastAt).getTime() + 23.5 * 3600_000).toISOString() : null,
      page: pages.length ? { name: pages[0].pageName ?? null, link: `https://m.me/${pages[0].pageId}` } : null,
    };
  }

  /** A 6-digit code, 15 minutes, to send to the salon's Page as "LUMIO 123456". */
  async newCode(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const now = new Date();
    const codes = cleanCodes(await this.read(tenantId, CODES_KEY), now);
    for (const [c, v] of Object.entries(codes)) if (v.userId === user.userId) delete codes[c];
    let code = '';
    for (let i = 0; i < 20 && (!code || codes[code]); i++) code = String(Math.floor(100000 + Math.random() * 900000));
    codes[code] = { userId: user.userId, exp: new Date(now.getTime() + 15 * 60_000).toISOString() };
    await this.write(tenantId, CODES_KEY, codes);
    const m = await this.mine(user);
    return { code, text: `LUMIO ${code}`, expiresInMin: 15, page: m.page };
  }

  async unlink(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const links = await this.linksOf(tenantId);
    if (!links[user.userId]) return { ok: true };
    const next = { ...links }; delete next[user.userId];
    await this.write(tenantId, LINKS_KEY, next);
    await this.audit(tenantId, user.userId, 'messenger.staff_messenger_unlinked');
    return { ok: true };
  }

  // ---------------------------------------------------------------- the Page

  /**
   * A message reached the salon's Page. Returns true when it was a team
   * member talking to Lumio (handled here, never a customer conversation),
   * false when it is a customer's and must go on as usual.
   */
  async onPageMessage(tenantId: string, pageId: string, pageToken: string, psid: string, cmd: StaffCommand | null): Promise<boolean> {
    const links = await this.linksOf(tenantId);
    const me = linkOf(links, pageId, psid);
    if (!me && cmd?.kind !== 'link') return false;
    const now = new Date();
    const say = (text: string) => this.send(pageToken, psid, text);

    if (cmd?.kind === 'link') {
      const codes = cleanCodes(await this.read(tenantId, CODES_KEY), now);
      const hit = codes[cmd.code];
      if (!hit) { if (me) { await say('Mã liên kết không đúng hoặc đã hết hạn. Lấy mã mới trong Lumio › Hộp thư.'); return true; } return false; }
      const user = await this.prisma.user.findFirst({ where: { id: hit.userId, tenantId, isActive: true }, select: { id: true, firstName: true } });
      if (!user) return false;
      delete codes[cmd.code];
      await this.write(tenantId, CODES_KEY, codes);
      const next: Record<string, StaffLink> = {};
      // One Messenger account per person, and one person per Messenger account.
      for (const [k, v] of Object.entries(links)) if (k !== user.id && !(v.pageId === pageId && v.psid === psid)) next[k] = v;
      next[user.id] = { userId: user.id, pageId, psid, linkedAt: now.toISOString(), lastAt: now.toISOString(), on: false };
      await this.write(tenantId, LINKS_KEY, next);
      await this.audit(tenantId, user.id, 'messenger.staff_messenger_linked');
      await say(`✅ Đã liên kết Messenger với tài khoản Lumio của ${user.firstName || 'bạn'}.\nMỗi đầu ca nhắn “vào ca” để nhận báo khách mới tại đây; hết ca nhắn “ra ca”.`);
      return true;
    }

    const links2 = { ...links, [me!.userId]: { ...me!, lastAt: now.toISOString() } };
    if (cmd?.kind === 'on') {
      links2[me!.userId].on = true;
      await this.write(tenantId, LINKS_KEY, links2);
      await this.setPresence(tenantId, me!.userId, 'available');
      await this.audit(tenantId, me!.userId, 'messenger.staff_shift_on');
      await say('✅ Đã vào ca. Khách mới được chia cho bạn sẽ báo ở đây (trong 24 giờ). Hết ca nhắn “ra ca”.');
      return true;
    }
    if (cmd?.kind === 'off') {
      links2[me!.userId].on = false;
      await this.write(tenantId, LINKS_KEY, links2);
      await this.setPresence(tenantId, me!.userId, 'away');
      await this.audit(tenantId, me!.userId, 'messenger.staff_shift_off');
      await say('👋 Đã ra ca. Bạn sẽ không được chia khách mới tới khi nhắn “vào ca”.');
      return true;
    }
    await this.write(tenantId, LINKS_KEY, links2);
    if (cmd?.kind === 'claim' || cmd?.kind === 'skip') {
      const t = await this.prisma.messengerThread.findFirst({ where: { id: cmd.threadId, tenantId }, select: { id: true, assignedUserId: true, senderName: true, status: true } as never }) as { id: string; assignedUserId: string | null; senderName: string | null; status?: string } | null;
      if (!t) { await say('Không tìm thấy cuộc trò chuyện này.'); return true; }
      if (t.assignedUserId && t.assignedUserId !== me!.userId) { await say(`Khách ${t.senderName || ''} đã được giao cho người khác.`); return true; }
      if (cmd.kind === 'claim') {
        await this.prisma.messengerThread.updateMany({ where: { id: t.id, tenantId }, data: { assignedUserId: me!.userId, readAt: now, ...(t.assignedUserId ? {} : { assignedAt: now }) } as never });
        await this.audit(tenantId, me!.userId, 'messenger.turn_claimed_messenger', t.id);
        await say(`👍 Đã nhận khách ${t.senderName || ''}. Trả lời tại: ${publicWebBase()}/salon/inbox?thread=${t.id}`);
      } else {
        const to = this.skipRouter ? await this.skipRouter(tenantId, t.id, me!.userId).catch(() => null) : null;
        await this.audit(tenantId, me!.userId, 'messenger.turn_skipped_messenger', t.id);
        await say(to ? 'Đã chuyển khách cho người kế tiếp.' : 'Hiện không còn ai trực để chuyển — khách vẫn ở với bạn.');
      }
      return true;
    }
    await say('Đây là kênh báo khách của Lumio. Nhắn “vào ca” để nhận báo, “ra ca” để ngừng. Khách được trả lời trong Lumio › Hộp thư.');
    return true;
  }

  private async setPresence(tenantId: string, userId: string, status: 'available' | 'away') {
    const db = this.prisma as unknown as { chatAgentPresence?: { upsert: (a: unknown) => Promise<unknown> } };
    await db.chatAgentPresence?.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      update: { status, lastSeenAt: new Date() },
      create: { tenantId, userId, status, lastSeenAt: new Date() },
    }).catch(() => undefined);
  }

  /** Is this person reachable on Messenger right now (counts as "online" for turns). */
  async onMessenger(tenantId: string, userId: string, now = new Date()): Promise<boolean> {
    return windowOpen((await this.linksOf(tenantId))[userId], now);
  }

  /** A turn was given to someone: tell them on their own Messenger when the window allows. */
  async notifyTurn(tenantId: string, userId: string, threadId: string, o: { hop: boolean; fromAd: boolean; mins: number }): Promise<boolean> {
    const l = (await this.linksOf(tenantId))[userId];
    if (!windowOpen(l, new Date())) return false;
    const pg = await this.prisma.messengerPage.findFirst({ where: { tenantId, pageId: l!.pageId }, select: { pageToken: true } }).catch(() => null);
    if (!pg?.pageToken) return false;
    const t = await this.prisma.messengerThread.findFirst({ where: { id: threadId, tenantId }, select: { senderName: true, lastText: true, channel: true } as never }).catch(() => null) as { senderName?: string | null; lastText?: string | null; channel?: string } | null;
    const text = turnAlert({ customer: t?.senderName || 'Khách', lastText: t?.lastText ?? null, channel: t?.channel ?? 'messenger', ...o });
    return this.send(pg.pageToken, l!.psid, text, [
      { content_type: 'text', title: 'Nhận khách', payload: `${CLAIM_PREFIX}${threadId}` },
      { content_type: 'text', title: 'Bỏ qua', payload: `${SKIP_PREFIX}${threadId}` },
    ]);
  }

  /** Tell every linked owner/manager on shift (the push goes separately). */
  async notifyEscalation(tenantId: string, userIds: string[], text: string): Promise<number> {
    let n = 0;
    const links = await this.linksOf(tenantId);
    for (const id of userIds) {
      const l = links[id];
      if (!windowOpen(l, new Date())) continue;
      const pg = await this.prisma.messengerPage.findFirst({ where: { tenantId, pageId: l!.pageId }, select: { pageToken: true } }).catch(() => null);
      if (pg?.pageToken && await this.send(pg.pageToken, l!.psid, text)) n++;
    }
    return n;
  }

  /** One message from the Page to a team member, inside their 24-hour window. Tagged so its echo is ignored. */
  private async send(pageToken: string, psid: string, text: string, quick?: unknown[]): Promise<boolean> {
    try {
      const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900), metadata: 'LUMIO_BOT', ...(quick ? { quick_replies: quick } : {}) } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`staff alert refused: ${res.status}`);
      return res.ok;
    } catch (e) {
      this.logger.warn(`staff alert failed: ${String(e).slice(0, 120)}`);
      return false;
    }
  }
}

