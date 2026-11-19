import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AiUsageService } from '../common/ai-usage.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { chat as llmChat, type ChatMessage } from '../common/llm';
import {
  IMPORTED_KEY, PENDING_KEY, RULES_KEY, blockedReason, cleanPending, cleanRules, cleanTags, isKind, parseReading,
  pickPhotos, priceSignature, suggestFor, wordsOf, type LibItem, type PhotoKind, type PhotoRules, type PickResult,
} from './photo-library';

type Row = {
  id: string; tenantId: string; url: string; kind: string; title: string; serviceId: string | null; tags: string[];
  aiAllowed: boolean; expiresAt: Date | null; flags: string[]; consent: boolean; status: string; source: string;
  priceSig: string | null; sentCount: number; lastSentAt: Date | null; createdAt: Date; updatedAt: Date;
};

export type LibraryView = {
  id: string; url: string; kind: PhotoKind; title: string; serviceId: string | null; serviceName: string | null; tags: string[];
  aiAllowed: boolean; expiresAt: string | null; flags: string[]; consent: boolean; status: string; source: string;
  sentCount: number; lastSentAt: string | null; createdAt: string;
  /** Why the AI will not send it on its own right now (null = it will when it fits). */
  blocked: string | null;
};

const https = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) && !/\.svg(\?|$)/i.test(u);

/**
 * The salon's picture library. Every query here carries the tenantId of the
 * signed-in user (or, for the AI, of the connected Page) — a picture id from
 * another salon is simply "not found".
 */
@Injectable()
export class PhotoLibraryService {
  private readonly logger = new Logger(PhotoLibraryService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly usage?: AiUsageService,
  ) {}

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private get db() {
    return (this.prisma as unknown as { mediaLibraryItem: {
      findMany: (a: unknown) => Promise<Row[]>; findFirst: (a: unknown) => Promise<Row | null>; create: (a: unknown) => Promise<Row>;
      update: (a: unknown) => Promise<Row>; updateMany: (a: unknown) => Promise<{ count: number }>; deleteMany: (a: unknown) => Promise<{ count: number }>;
      count: (a: unknown) => Promise<number>;
    } }).mediaLibraryItem;
  }

  private async audit(tenantId: string, userId: string | null, action: string, resourceId?: string, meta?: Record<string, unknown>) {
    try {
      await this.prisma.auditLog.create({
        data: { tenantId, userId: userId ?? undefined, action, resourceType: 'media_library', resourceId: resourceId ?? undefined, ...(meta ? { metadata: meta as Prisma.InputJsonValue } : {}) } as never,
      });
    } catch { /* never break */ }
  }

  // ---------------------------------------------------------------- settings
  async rulesOf(tenantId: string): Promise<PhotoRules> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: RULES_KEY } } }).catch(() => null);
    return cleanRules(row?.value);
  }

  async getRules(user: AuthenticatedUser): Promise<PhotoRules> {
    return this.rulesOf(this.tenantOf(user));
  }

  async setRules(user: AuthenticatedUser, raw: unknown): Promise<PhotoRules> {
    const tenantId = this.tenantOf(user);
    const rules = cleanRules(raw);
    const value = rules as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: RULES_KEY } }, create: { tenantId, key: RULES_KEY, value }, update: { value } });
    await this.audit(tenantId, user.userId ?? null, 'media_library.rules_saved', undefined, { modes: rules.modes, minScore: rules.minScore, max: rules.max });
    return rules;
  }

  /** The prices on the menu right now, as one short signature (see priceSignature). */
  async priceSigOf(tenantId: string): Promise<string> {
    const rows = await this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, priceCents: true } }).catch(() => []);
    return priceSignature(rows);
  }

  private async serviceNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const want = Array.from(new Set(ids.filter((x): x is string => !!x)));
    if (!want.length) return new Map();
    const rows = await this.prisma.service.findMany({ where: { tenantId, id: { in: want } }, select: { id: true, name: true } }).catch(() => []);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private toLib(r: Row, names: Map<string, string>): LibItem {
    return {
      id: r.id, url: r.url, kind: isKind(r.kind) ? r.kind : 'sample', title: r.title, serviceId: r.serviceId,
      serviceName: r.serviceId ? names.get(r.serviceId) ?? null : null, tags: r.tags ?? [], aiAllowed: r.aiAllowed,
      expiresAt: r.expiresAt, flags: r.flags ?? [], consent: r.consent, status: r.status === 'pending' ? 'pending' : 'ready', priceSig: r.priceSig,
    };
  }

  /** One salon's library, as LibItems. */
  async itemsOf(tenantId: string): Promise<{ rows: Row[]; items: LibItem[] }> {
    const rows = await this.db.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 500 }).catch(() => [] as Row[]);
    const names = await this.serviceNames(tenantId, rows.map((r) => r.serviceId));
    return { rows, items: rows.map((r) => this.toLib(r, names)) };
  }

  // ---------------------------------------------------------------- the page
  async list(user: AuthenticatedUser): Promise<{ items: LibraryView[]; rules: PhotoRules; warnings: { priceStale: number; flagged: number; pending: number; expired: number }; services: { id: string; name: string }[] }> {
    const tenantId = this.tenantOf(user);
    // First visit: bring in the pictures the salon already chose elsewhere.
    const imported = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: IMPORTED_KEY } } }).catch(() => null);
    if (!imported) await this.importExisting(tenantId, user.userId ?? null).catch((e) => this.logger.warn(`library import failed: ${String(e).slice(0, 120)}`));
    const [{ rows, items }, rules, sig, services] = await Promise.all([
      this.itemsOf(tenantId), this.rulesOf(tenantId), this.priceSigOf(tenantId),
      this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 }).catch(() => []),
    ]);
    const now = new Date();
    const views = rows.map((r, i) => {
      const it = items[i];
      return {
        id: r.id, url: r.url, kind: it.kind, title: r.title, serviceId: r.serviceId, serviceName: it.serviceName ?? null, tags: r.tags ?? [],
        aiAllowed: r.aiAllowed, expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null, flags: r.flags ?? [], consent: r.consent,
        status: it.status, source: r.source, sentCount: r.sentCount, lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(), blocked: blockedReason(it, now, sig),
      } satisfies LibraryView;
    });
    const warnings = {
      priceStale: views.filter((v) => v.blocked === 'price_stale').length,
      flagged: views.filter((v) => v.blocked === 'flagged' || v.blocked === 'no_consent').length,
      pending: views.filter((v) => v.status === 'pending').length,
      expired: views.filter((v) => v.blocked === 'expired').length,
    };
    return { items: views, rules, warnings, services };
  }

  private async cleanServiceId(tenantId: string, raw: unknown): Promise<string | null> {
    const id = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    if (!id) return null;
    const ok = await this.prisma.service.findFirst({ where: { id, tenantId }, select: { id: true } }).catch(() => null);
    if (!ok) throw new BadRequestException('Dịch vụ không thuộc tiệm này.');
    return id;
  }

  private cleanDate(raw: unknown): Date | null {
    if (raw == null || raw === '') return null;
    const d = new Date(String(raw));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  /**
   * A new picture. `url` was just stored in THIS salon's upload folder by the
   * controller — nothing a browser names is trusted as a source.
   */
  async create(user: AuthenticatedUser, url: string, body: Record<string, unknown>): Promise<LibraryView> {
    const tenantId = this.tenantOf(user);
    if (!https(url)) throw new BadRequestException('Not a photo address.');
    const kind: PhotoKind = isKind(body.kind) ? body.kind : 'sample';
    const serviceId = await this.cleanServiceId(tenantId, body.serviceId);
    const consent = body.consent === true;
    const row = await this.db.create({
      data: {
        tenantId, url, kind, title: String(body.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), serviceId,
        tags: cleanTags(body.tags), aiAllowed: body.aiAllowed !== false, expiresAt: this.cleanDate(body.expiresAt),
        consent, status: 'ready', source: 'upload', createdBy: user.userId ?? null,
        priceSig: kind === 'price_list' ? await this.priceSigOf(tenantId) : null,
      },
    });
    await this.audit(tenantId, user.userId ?? null, 'media_library.added', row.id, { kind });
    // Read the picture in the background: labels it was given are kept, the reader only adds and flags.
    void this.readPicture(tenantId, row.id).catch(() => undefined);
    return this.viewOne(tenantId, row.id);
  }

  private async viewOne(tenantId: string, id: string): Promise<LibraryView> {
    const r = await this.db.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Không tìm thấy ảnh.');
    const names = await this.serviceNames(tenantId, [r.serviceId]);
    const it = this.toLib(r, names);
    return {
      id: r.id, url: r.url, kind: it.kind, title: r.title, serviceId: r.serviceId, serviceName: it.serviceName ?? null, tags: r.tags ?? [],
      aiAllowed: r.aiAllowed, expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null, flags: r.flags ?? [], consent: r.consent,
      status: it.status, source: r.source, sentCount: r.sentCount, lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(), blocked: blockedReason(it, new Date(), await this.priceSigOf(tenantId)),
    };
  }

  async update(user: AuthenticatedUser, id: string, body: Record<string, unknown>): Promise<LibraryView> {
    const tenantId = this.tenantOf(user);
    const cur = await this.db.findFirst({ where: { id: String(id ?? ''), tenantId } });
    if (!cur) throw new NotFoundException('Không tìm thấy ảnh.');
    const data: Record<string, unknown> = {};
    if ('kind' in body && isKind(body.kind)) data.kind = body.kind;
    if ('title' in body) data.title = String(body.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if ('serviceId' in body) data.serviceId = await this.cleanServiceId(tenantId, body.serviceId);
    if ('tags' in body) data.tags = cleanTags(body.tags);
    if ('aiAllowed' in body) data.aiAllowed = body.aiAllowed === true;
    if ('expiresAt' in body) data.expiresAt = this.cleanDate(body.expiresAt);
    if ('consent' in body) data.consent = body.consent === true;
    if ('status' in body && (body.status === 'ready' || body.status === 'pending')) data.status = body.status;
    // "Giá trên ảnh đã đúng": the owner checked the picture against today's menu.
    const kindNow = (data.kind as string | undefined) ?? cur.kind;
    if (kindNow === 'price_list' && (body.priceChecked === true || data.kind === 'price_list')) data.priceSig = await this.priceSigOf(tenantId);
    await this.db.updateMany({ where: { id: cur.id, tenantId }, data });
    const action = 'consent' in data ? (data.consent ? 'media_library.consent_given' : 'media_library.consent_removed')
      : body.priceChecked === true ? 'media_library.price_checked' : 'media_library.updated';
    await this.audit(tenantId, user.userId ?? null, action, cur.id);
    return this.viewOne(tenantId, cur.id);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const tenantId = this.tenantOf(user);
    const out = await this.db.deleteMany({ where: { id: String(id ?? ''), tenantId } });
    if (!out.count) throw new NotFoundException('Không tìm thấy ảnh.');
    await this.audit(tenantId, user.userId ?? null, 'media_library.removed', String(id));
    return { ok: true };
  }

  /**
   * The pictures the salon already chose elsewhere, once:
   *   service photos and the branding price list / storefront → ready (the
   *   owner picked them for exactly this); posted posts → pending, because a
   *   post's picture was what got sent wrongly in the first place.
   */
  async importExisting(tenantId: string, userId: string | null): Promise<{ added: number }> {
    const have = new Set((await this.db.findMany({ where: { tenantId }, select: { url: true }, take: 1000 }).catch(() => [] as Row[])).map((r) => r.url));
    const add: Record<string, unknown>[] = [];
    const push = (x: Record<string, unknown>) => { const u = x.url as string; if (https(u) && !have.has(u)) { have.add(u); add.push({ tenantId, createdBy: userId, ...x }); } };
    const services = await this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, imageUrl: true }, take: 300 }).catch(() => []);
    for (const s of services) if (s.imageUrl) push({ url: s.imageUrl, kind: 'sample', title: s.name.slice(0, 60), serviceId: s.id, status: 'ready', source: 'service' });
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { branding: true } }).catch(() => null);
    const b = (this.settings?.brandingFrom(t?.branding) ?? {}) as unknown as { priceListImageUrl?: string; storefrontImageUrl?: string };
    const sig = await this.priceSigOf(tenantId);
    if (b.priceListImageUrl) push({ url: b.priceListImageUrl, kind: 'price_list', title: 'Bảng giá', status: 'ready', source: 'branding', priceSig: sig });
    if (b.storefrontImageUrl) push({ url: b.storefrontImageUrl, kind: 'storefront', title: 'Mặt tiền tiệm', status: 'ready', source: 'branding' });
    const posts = await this.prisma.scheduledPost.findMany({
      where: { tenantId, status: 'posted', mediaPurgedAt: null }, orderBy: { postedAt: 'desc' }, take: 30, select: { media: true, imageUrl: true, message: true },
    }).catch(() => []) as { media?: unknown; imageUrl?: string | null; message?: string | null }[];
    for (const p of posts) {
      const media = Array.isArray(p.media) ? p.media as { url?: string; kind?: string }[] : [];
      const first = media.find((m) => m.kind === 'image' && https(m.url))?.url ?? (https(p.imageUrl) ? p.imageUrl : null);
      if (first) push({ url: first, kind: 'sample', title: String(p.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), status: 'pending', source: 'post' });
    }
    for (const row of add) {
      const r = await this.db.create({ data: row }).catch(() => null);
      if (r) void this.readPicture(tenantId, r.id).catch(() => undefined);
    }
    const value = { at: new Date().toISOString(), added: add.length } as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: IMPORTED_KEY } }, create: { tenantId, key: IMPORTED_KEY, value }, update: { value } }).catch(() => undefined);
    if (add.length) await this.audit(tenantId, userId, 'media_library.imported', undefined, { added: add.length });
    return { added: add.length };
  }

  async reimport(user: AuthenticatedUser) {
    return this.importExisting(this.tenantOf(user), user.userId ?? null);
  }

  /**
   * Look at the picture once: suggest labels and a title when none were given,
   * and flag a face, a phone number or another business's name/logo. Flags
   * stop the AI from sending it until the owner confirms. Best effort: no
   * key, no reply, a slow model — the picture simply keeps what it has.
   */
  async readPicture(tenantId: string, id: string): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return;
    const r = await this.db.findFirst({ where: { id, tenantId } });
    if (!r) return;
    const block = await this.imageBlock(r.url);
    if (!block) return;
    const out = await llmChat({
      system: 'You label photos a beauty salon or restaurant sends to customers in chat. Reply with ONE JSON object only.',
      messages: [{ role: 'user', content: [block, { type: 'text', text:
        'Trả về JSON: {"title": tên ngắn tiếng Việt (≤ 6 từ), "tags": tối đa 8 nhãn ngắn tiếng Việt thường (kiểu, màu, độ dài, dáng, món…), '
        + '"kind": "sample"|"price_list"|"storefront"|"guide"|"promo", '
        + '"flags": mảng gồm "face" nếu thấy rõ khuôn mặt người, "phone" nếu có số điện thoại/giấy tờ cá nhân, "other_shop" nếu có tên hoặc logo của một cửa tiệm khác}. '
        + 'Chỉ ghi điều thấy trong ảnh, không đoán.' }] }] as unknown as ChatMessage[],
      max_tokens: 250,
      timeoutMs: 20_000,
    });
    this.usage?.record({
      feature: 'messenger', tenantId,
      model: out.ok ? out.reply.usage?.model ?? 'unknown' : 'unknown',
      input: out.ok ? out.reply.usage?.input ?? 0 : 0, output: out.ok ? out.reply.usage?.output ?? 0 : 0,
      cacheRead: 0, cacheWrite: 0, failed: !out.ok,
    });
    if (!out.ok) return;
    const text = ((out.reply as { content?: { type: string; text?: string }[] }).content ?? []).filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
    const read = parseReading(text);
    if (!read) return;
    const data: Record<string, unknown> = { flags: read.flags };
    if (!(r.tags ?? []).length && read.tags.length) data.tags = read.tags;
    if (!r.title.trim() && read.title) data.title = read.title;
    await this.db.updateMany({ where: { id: r.id, tenantId }, data });
    if (read.flags.length) await this.audit(tenantId, null, 'media_library.flagged', r.id, { flags: read.flags });
  }

  private async imageBlock(url: string): Promise<unknown | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: 'follow' });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 4_500_000) return null;
      const type = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png'
        : buf.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : buf[0] === 0x47 && buf[1] === 0x49 ? 'image/gif' : null;
      return type ? { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } } : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- the AI
  /**
   * The AI asked for pictures. `null` = this salon has no ready picture of
   * that kind in the library yet, so the caller keeps its old sources —
   * nothing changes for a salon until it starts using the library.
   */
  async pickForAi(tenantId: string, kind: PhotoKind, serviceId: string | null, words: string[], sent: Set<string>): Promise<{ result: PickResult; rules: PhotoRules } | null> {
    const { items } = await this.itemsOf(tenantId);
    const kinds = kind === 'sample' ? ['sample', 'result'] : [kind];
    if (!items.some((i) => kinds.includes(i.kind) && i.status === 'ready')) return null;
    const [rules, priceSig] = await Promise.all([this.rulesOf(tenantId), this.priceSigOf(tenantId)]);
    return { result: pickPhotos(items, { kind, serviceId, words }, { now: new Date(), sent, priceSig, rules }), rules };
  }

  async markSent(tenantId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db.updateMany({ where: { tenantId, id: { in: ids } }, data: { sentCount: { increment: 1 }, lastSentAt: new Date() } }).catch(() => undefined);
  }

  async markSentByUrl(tenantId: string, url: string): Promise<void> {
    await this.db.updateMany({ where: { tenantId, url }, data: { sentCount: { increment: 1 }, lastSentAt: new Date() } }).catch(() => undefined);
  }

  async logAiSend(tenantId: string, threadId: string | null, ids: string[], reason: string): Promise<void> {
    await this.audit(tenantId, null, 'messenger.photo_sent', threadId ?? undefined, { by: 'ai', ids, reason: reason.slice(0, 80) });
  }

  // ---------------------------------------------------------------- waiting for a person
  private async pendingOf(tenantId: string) {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PENDING_KEY } } }).catch(() => null);
    return cleanPending(row?.value);
  }

  private async savePending(tenantId: string, map: ReturnType<typeof cleanPending>) {
    const value = cleanPending(map) as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: PENDING_KEY } }, create: { tenantId, key: PENDING_KEY, value }, update: { value } }).catch(() => undefined);
  }

  /** The AI found pictures but the salon wants a person to send them (or found none and the salon wants to know). */
  async addPending(tenantId: string, threadId: string, ids: string[], label: string): Promise<void> {
    const map = await this.pendingOf(tenantId);
    map[threadId] = { ids: ids.length ? ids.slice(0, 3) : ['none'], label, at: new Date().toISOString() };
    await this.savePending(tenantId, map);
    await this.audit(tenantId, null, 'messenger.photo_waiting', threadId, { ids, label: label.slice(0, 80) });
  }

  async clearPending(tenantId: string, threadId: string): Promise<void> {
    const map = await this.pendingOf(tenantId);
    if (!map[threadId]) return;
    delete map[threadId];
    await this.savePending(tenantId, map);
  }

  /**
   * What the Inbox shows beside a conversation: what is waiting for approval
   * there, and the pictures that fit what the customer last wrote. The thread
   * is looked up inside the caller's salon first.
   */
  async suggest(user: AuthenticatedUser, threadId: string) {
    const tenantId = this.tenantOf(user);
    const thread = await this.prisma.messengerThread.findFirst({ where: { id: String(threadId ?? ''), tenantId }, select: { id: true, history: true } });
    if (!thread) throw new NotFoundException('Thread not found');
    const hist = (Array.isArray(thread.history) ? thread.history : []) as { role?: string; content?: unknown; images?: unknown }[];
    const sent = sentUrls(hist);
    const lastText = [...hist].reverse().find((t) => t.role === 'user' && typeof t.content === 'string' && t.content.trim())?.content as string | undefined;
    const [{ items }, priceSig, pending] = await Promise.all([this.itemsOf(tenantId), this.priceSigOf(tenantId), this.pendingOf(tenantId)]);
    const now = new Date();
    const view = (i: LibItem) => ({ id: i.id, url: i.url, kind: i.kind, title: i.title, serviceName: i.serviceName ?? null, tags: i.tags });
    const suggestions = suggestFor(items, lastText ?? '', { now, sent, priceSig }).map((s) => ({ ...view(s.item), score: Math.round(s.score * 100), sent: s.sent, blocked: s.blocked }));
    const p = pending[thread.id];
    const waiting = p ? { label: p.label, at: p.at, items: p.ids.map((id) => items.find((i) => i.id === id)).filter((i): i is LibItem => !!i).map(view) } : null;
    return { lastText: lastText ? String(lastText).slice(0, 200) : null, words: wordsOf(lastText ?? ''), suggestions, waiting, total: items.length };
  }

  /** A person is about to send this library picture: it must be this salon's, and not one held back for privacy or age. */
  async sendable(user: AuthenticatedUser, itemId: string): Promise<{ tenantId: string; url: string; id: string }> {
    const tenantId = this.tenantOf(user);
    const r = await this.db.findFirst({ where: { id: String(itemId ?? ''), tenantId } });
    if (!r) throw new NotFoundException('Không tìm thấy ảnh.');
    const names = new Map<string, string>();
    const why = blockedReason(this.toLib(r, names), new Date(), await this.priceSigOf(tenantId));
    if (why === 'flagged' || why === 'no_consent') throw new BadRequestException('Ảnh này có khuôn mặt hoặc thông tin riêng — chủ tiệm cần xác nhận khách đã đồng ý trong Thư viện ảnh.');
    if (why === 'expired') throw new BadRequestException('Ảnh này đã hết hạn (khuyến mãi đã kết thúc).');
    if (why === 'price_stale') throw new BadRequestException('Ảnh bảng giá cũ hơn giá hiện tại — cập nhật ảnh hoặc bấm "Giá trên ảnh đã đúng" trong Thư viện ảnh.');
    return { tenantId, url: r.url, id: r.id };
  }

  async afterPersonSent(user: AuthenticatedUser, tenantId: string, threadId: string, itemId: string): Promise<void> {
    await this.markSent(tenantId, [itemId]);
    await this.clearPending(tenantId, threadId);
    await this.audit(tenantId, user.userId ?? null, 'messenger.photo_sent', threadId, { by: 'person', ids: [itemId] });
  }
}

/** Every picture this conversation has already had from the salon. */
export function sentUrls(hist: { role?: string; images?: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const t of hist) if (t?.role === 'assistant' && Array.isArray(t.images)) for (const u of t.images) if (typeof u === 'string') out.add(u);
  return out;
}
