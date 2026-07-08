import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { SettingsService } from '../settings/settings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

// A blank/masked secret must never overwrite a stored Page token.
function cleanSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^[•*·.\s]+$/.test(t)) return null;
  return t;
}

/** Convert a salon-local wall time ("2026-07-10T14:00") to the correct UTC ISO
 *  instant for the salon's timezone (handles DST). */
function wallToUtcISO(local: string, tz: string): string {
  const clean = local.replace('Z', '').trim();
  const [datePart, timePartRaw] = clean.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePartRaw || '00:00').split(':').map(Number);
  const asUtc = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(asUtc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const localFromUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'));
    const offset = localFromUtc - asUtc; // ms the zone is ahead of UTC
    return new Date(asUtc - offset).toISOString();
  } catch {
    return new Date(asUtc).toISOString();
  }
}

type Turn = { role: 'user' | 'assistant'; content: string };
export interface BotFact { label: string; value: string; on: boolean }
interface AnthropicBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_TURNS = 12; // history cap
const MAX_TOOL_LOOPS = 5;

@Injectable()
export class MessengerService {
  private readonly logger = new Logger('Messenger');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly settings: SettingsService,
  ) {}

  // ---- config --------------------------------------------------------------
  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private verifyToken(): string {
    return process.env.MESSENGER_VERIFY_TOKEN || 'lumio-verify';
  }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  private appId(): string { return process.env.FB_APP_ID || ''; }
  private appSecret(): string { return process.env.FB_APP_SECRET || ''; }
  private oauthRedirect(): string { return `${this.apiBase()}/api/messenger/oauth/callback`; }
  private signSecret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-fb-signing'; }
  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): string | null {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    if (sig !== expect) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!d.exp || Date.now() > d.exp) return null;
      return d.t;
    } catch { return null; }
  }

  // ---- admin (salon) -------------------------------------------------------
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const threads = await this.prisma.messengerThread.count({ where: { tenantId } });
    return {
      connected: Boolean(c?.pageId && c?.pageToken),
      pageId: c?.pageId ?? '',
      igId: c?.igId ?? '',
      enabled: c?.enabled ?? false,
      greeting: c?.greeting ?? '',
      aiInstruction: c?.aiInstruction ?? '',
      botFacts: Array.isArray(c?.botFacts) ? (c!.botFacts as unknown as BotFact[]) : [],
      aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      webhookUrl: `${this.apiBase()}/api/messenger/webhook`,
      verifyToken: this.verifyToken(),
      fbConfigured: Boolean(this.appId() && this.appSecret()),
      threads,
    };
  }

  // ---- One-click OAuth (Facebook Login for Business) -----------------------
  async oauthUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = this.tenantId(user);
    if (!this.appId() || !this.appSecret()) {
      throw new BadRequestException('Facebook app not configured (set FB_APP_ID and FB_APP_SECRET). Contact Lumio.');
    }
    // Core Messenger booking scopes (must be added to the app in Meta first).
    // Instagram scopes are opt-in: Facebook rejects the WHOLE dialog with
    // "Invalid Scopes" if instagram_basic / instagram_manage_messages aren't yet
    // added to the app, so we only request them once the owner has added those
    // permissions in Meta and flipped FB_ENABLE_INSTAGRAM=1.
    const igOn = process.env.FB_ENABLE_INSTAGRAM === '1' || process.env.FB_ENABLE_INSTAGRAM === 'true';
    const scope = [
      'pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'business_management',
      ...(igOn ? ['instagram_basic', 'instagram_manage_messages'] : []),
    ].join(',');
    const params = new URLSearchParams({
      client_id: this.appId(), redirect_uri: this.oauthRedirect(), response_type: 'code',
      state: this.signState(tenantId), scope,
    });
    return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
  }

  /** Facebook redirects here with ?code&state. Exchange it, grab the salon's Page
   *  + linked Instagram, store the Page token and subscribe the Page to our app. */
  async oauthCallback(code: string, state: string, error?: string): Promise<string> {
    const web = this.webBase();
    const back = (q: string) => `${web}/salon/messenger?${q}`;
    if (error) return back(`fb=error&msg=${encodeURIComponent(error)}`);
    const tenantId = this.verifyState(state);
    if (!tenantId || !code) return back('fb=error&msg=invalid_state');
    try {
      const tokRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${this.appId()}&client_secret=${this.appSecret()}&redirect_uri=${encodeURIComponent(this.oauthRedirect())}&code=${encodeURIComponent(code)}`,
      );
      const tok = (await tokRes.json()) as { access_token?: string; error?: { message?: string } };
      if (!tok.access_token) return back(`fb=error&msg=${encodeURIComponent(tok.error?.message || 'no_token')}`);
      const pagesRes = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(tok.access_token)}`,
      );
      const pagesData = (await pagesRes.json()) as { data?: { id: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }[] };
      const pages = pagesData.data || [];
      if (!pages.length) return back('fb=error&msg=no_pages');
      const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
      const chosen = pages.find((p) => p.id === cur?.pageId) || pages[0];
      if (!chosen.access_token) return back('fb=error&msg=no_page_token');
      const igId = chosen.instagram_business_account?.id || null;
      await this.prisma.messengerConnection.upsert({
        where: { tenantId },
        update: { pageId: chosen.id, igId, pageToken: chosen.access_token, enabled: true },
        create: { tenantId, pageId: chosen.id, igId, pageToken: chosen.access_token, enabled: true },
      });
      // Subscribe the Page to our app's webhook so messages start flowing.
      await fetch(
        `https://graph.facebook.com/v21.0/${chosen.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions&access_token=${encodeURIComponent(chosen.access_token)}`,
        { method: 'POST' },
      ).catch(() => undefined);
      await this.audit(tenantId, 'messenger.connected');
      return back(`fb=connected&page=${encodeURIComponent(chosen.name || '')}`);
    } catch (e) {
      this.logger.warn(`fb oauth failed: ${String(e).slice(0, 160)}`);
      return back('fb=error&msg=exception');
    }
  }

  private async audit(tenantId: string, action: string): Promise<void> {
    try { await this.prisma.auditLog.create({ data: { tenantId, action, resourceType: 'messenger' } }); } catch { /* never break */ }
  }

  /** Facebook "Data Deletion Request" callback. Verify the signed_request, delete
   *  the Messenger/Instagram conversation data we hold for that user, and return
   *  the status URL + confirmation code Meta requires. */
  async dataDeletion(signedRequest: string): Promise<{ url: string; confirmation_code: string }> {
    const web = this.webBase();
    const code = crypto.randomBytes(8).toString('hex');
    const parsed = this.parseSignedRequest(signedRequest);
    const userId = parsed?.user_id ? String(parsed.user_id) : '';
    if (userId) {
      // PSID is page-scoped; delete every conversation thread for this sender.
      await this.prisma.messengerThread.deleteMany({ where: { senderId: userId } }).catch(() => undefined);
    }
    return { url: `${web}/data-deletion?id=${code}`, confirmation_code: code };
  }

  private parseSignedRequest(signed: string): { user_id?: string } | null {
    try {
      const [sig, payload] = (signed || '').split('.');
      if (!sig || !payload) return null;
      const expected = crypto.createHmac('sha256', this.appSecret()).update(payload).digest('base64url');
      if (sig !== expected) return null;
      return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { user_id?: string };
    } catch { return null; }
  }

  /** Fully disconnect the salon's Page: unsubscribe our app from its webhook
   *  (best-effort) and delete the stored connection so no token remains. */
  async disconnect(user: AuthenticatedUser): Promise<{ connected: false }> {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (c?.pageId && c?.pageToken) {
      await fetch(`${GRAPH}/${c.pageId}/subscribed_apps?access_token=${encodeURIComponent(c.pageToken)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await this.prisma.messengerConnection.deleteMany({ where: { tenantId } });
    await this.audit(tenantId, 'messenger.disconnected');
    return { connected: false };
  }

  async updateSettings(
    user: AuthenticatedUser,
    dto: { pageId?: string; igId?: string; pageToken?: string; enabled?: boolean; greeting?: string; aiInstruction?: string; botFacts?: BotFact[] },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const pageId = typeof dto.pageId === 'string' ? dto.pageId.trim() : cur?.pageId ?? '';
    const igId = typeof dto.igId === 'string' ? (dto.igId.trim() || null) : cur?.igId ?? null;
    const pageToken = cleanSecret(dto.pageToken) ?? cur?.pageToken ?? '';
    const data = {
      pageId,
      igId,
      pageToken,
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur?.enabled ?? false,
      greeting: typeof dto.greeting === 'string' ? dto.greeting.slice(0, 500) : cur?.greeting ?? null,
      aiInstruction: typeof dto.aiInstruction === 'string' ? dto.aiInstruction.slice(0, 2000) : cur?.aiInstruction ?? null,
      botFacts: (Array.isArray(dto.botFacts) ? dto.botFacts.slice(0, 40) : (cur?.botFacts ?? [])) as unknown as Prisma.InputJsonValue,
    };
    if (!pageId) throw new BadRequestException('Enter your Facebook Page ID.');
    await this.prisma.messengerConnection.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
    return this.get(user);
  }

  async listThreads(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.messengerThread.findMany({
      where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 50,
      select: { id: true, senderId: true, lastText: true, handoff: true, updatedAt: true },
    });
    return rows;
  }

  async setHandoff(user: AuthenticatedUser, id: string, handoff: boolean) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.messengerThread.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Thread not found');
    await this.prisma.messengerThread.update({ where: { id: row.id }, data: { handoff } });
    return { ok: true };
  }

  // ---- webhook -------------------------------------------------------------
  verify(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.verifyToken()) return challenge;
    return null;
  }

  /** Meta POSTs message events here. We ack immediately and process async. */
  async handleWebhook(body: unknown): Promise<void> {
    const b = body as { object?: string; entry?: { id?: string; messaging?: MessagingEvent[] }[] };
    // "page" = Facebook Messenger, "instagram" = Instagram DMs (same event shape).
    if ((b?.object !== 'page' && b?.object !== 'instagram') || !Array.isArray(b.entry)) return;
    for (const entry of b.entry) {
      const entryId = entry.id || ''; // Page id (Messenger) or IG account id (Instagram)
      for (const ev of entry.messaging || []) {
        const senderId = ev.sender?.id;
        const text = ev.message?.text;
        if (!senderId || !text || ev.message?.is_echo) continue;
        await this.handleMessage(entryId, senderId, text).catch((e) =>
          this.logger.warn(`handleMessage failed: ${String(e).slice(0, 160)}`),
        );
      }
    }
  }

  private async handleMessage(entryId: string, senderId: string, text: string): Promise<void> {
    // Route by Facebook Page id OR the linked Instagram account id.
    const conn = await this.prisma.messengerConnection.findFirst({ where: { OR: [{ pageId: entryId }, { igId: entryId }] } });
    if (!conn || !conn.enabled || !conn.pageToken) return;
    const pageId = conn.pageId;
    const thread = await this.prisma.messengerThread.upsert({
      where: { pageId_senderId: { pageId, senderId } },
      update: { lastText: text.slice(0, 300) },
      create: { tenantId: conn.tenantId, pageId, senderId, lastText: text.slice(0, 300) },
    });
    if (thread.handoff) return; // a human is handling this conversation

    const history = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
    let reply: string;
    try {
      const instruction = [this.factsText(conn.botFacts), conn.aiInstruction || ''].filter(Boolean).join('\n');
      reply = await this.runAgent(conn.tenantId, instruction, history, text);
    } catch (e) {
      this.logger.warn(`agent error: ${String(e).slice(0, 160)}`);
      reply = 'Thanks for your message! A team member will get back to you shortly. 💕';
    }
    await this.sendText(conn.pageToken, senderId, reply);
    const nextHistory = [...history, { role: 'user', content: text }, { role: 'assistant', content: reply }].slice(-MAX_TURNS);
    await this.prisma.messengerThread.update({
      where: { id: thread.id },
      data: { history: nextHistory as unknown as Prisma.InputJsonValue },
    });
  }

  // ---- AI agent (tool use) -------------------------------------------------
  private async runAgent(tenantId: string, aiInstruction: string, history: Turn[], userText: string): Promise<string> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return 'Thanks for reaching out! A team member will reply to you shortly. 💕';

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true, contactPhone: true, contactEmail: true } });
    const salonName = tenant?.name || 'our salon';
    const tz = tenant?.timezone || 'America/New_York';
    const infoBlock = await this.salonInfoBlock(tenantId, tenant?.contactPhone ?? null, tenant?.contactEmail ?? null);
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const system = `You are the friendly booking assistant for "${salonName}", a nail salon, chatting with a customer on Facebook Messenger.
Goal: help them book an appointment. Be warm, concise (1-3 short sentences), and reply in the SAME language the customer uses.
To book you MUST collect: their name, their phone number, which service, and a specific date & time. Ask for whatever is missing, one or two things at a time.
You MAY also ask for their email so the salon can send an email confirmation — this is OPTIONAL; if they skip or decline, book anyway without it.
Use the get_services tool to tell them what's available and to get service ids. When you have name + phone + service + a specific date/time, call create_booking (include their email if they gave one). After it succeeds, confirm the details warmly and let them know a confirmation is on its way.
As a kind final touch AFTER the booking is confirmed, mention the salon loves to send a little birthday treat and gently ask if they'd like to share their birthday (just the month and day) — make it clear this is entirely optional. If they share it, call save_birthday with their phone. If they decline, hesitate, or don't answer, that is completely fine — thank them warmly and never push or ask again.
The salon's local time right now is: ${nowLocal} (timezone ${tz}). Interpret "today/tomorrow/this Friday" in that timezone.
${infoBlock ? infoBlock + '\n' : ''}Only state hours, prices, services, address, and contact info that are given to you here; never invent them. Do not book or promise a time outside business hours — if the customer asks for a closed day or time, tell them the salon is closed then and offer the nearest open time. If the customer is upset or asks for a human, tell them a staff member will follow up soon. Do not ask for payment.${aiInstruction ? `\nSalon owner's extra notes: ${aiInstruction}` : ''}`;

    const tools = [
      { name: 'get_services', description: 'List this salon’s bookable services with their id, name, price and duration.', input_schema: { type: 'object', properties: {}, required: [] } },
      {
        name: 'create_booking',
        description: 'Create the appointment. Only call once you have the customer name, phone, a chosen service id, and a specific local date & time.',
        input_schema: {
          type: 'object',
          properties: {
            customerFirstName: { type: 'string' },
            customerPhone: { type: 'string' },
            serviceId: { type: 'string' },
            localDateTime: { type: 'string', description: 'Salon local time in ISO form, e.g. 2026-07-10T14:00' },
            customerEmail: { type: 'string', description: 'Optional. The customer email for an email confirmation; omit entirely if they did not give one.' },
          },
          required: ['customerFirstName', 'customerPhone', 'serviceId', 'localDateTime'],
        },
      },
      {
        name: 'save_birthday',
        description: "Save the customer's birthday so the salon can send a birthday treat. Only call after they willingly share it — it is always optional and asked only after the booking is confirmed.",
        input_schema: {
          type: 'object',
          properties: {
            customerPhone: { type: 'string', description: 'The same phone number used to book, to find the customer.' },
            birthDate: { type: 'string', description: 'Birthday as YYYY-MM-DD. If the year is unknown, use 2000, e.g. 2000-05-20.' },
          },
          required: ['customerPhone', 'birthDate'],
        },
      },
    ];

    const messages: { role: string; content: unknown }[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userText },
    ];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 500, system, tools, messages }),
      });
      if (!res.ok) {
        this.logger.warn(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
        return 'Thanks! A team member will get back to you shortly. 💕';
      }
      const data = (await res.json()) as { stop_reason?: string; content?: AnthropicBlock[] };
      const blocks = data.content || [];
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocks });
        const results: unknown[] = [];
        for (const blk of blocks) {
          if (blk.type !== 'tool_use') continue;
          const out = await this.runTool(tenantId, tz, blk.name || '', blk.input || {});
          results.push({ type: 'tool_result', tool_use_id: blk.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      return text || 'Got it! How else can I help you book?';
    }
    return 'Thanks! A team member will follow up with you shortly. 💕';
  }

  /** Business hours + contact injected into the agent prompt so it can answer
   *  "when are you open?" and never book outside opening times. */
  private async salonInfoBlock(tenantId: string, phone: string | null, email: string | null): Promise<string> {
    const lines: string[] = [];
    try {
      const rules = await this.settings.getBookingRules(tenantId);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hrs = (rules.businessHours || []).map((h, i) =>
        !h || h.closed ? `${dayNames[i]}: Closed` : `${dayNames[i]}: ${this.minToAmPm(h.openMinutes)} – ${this.minToAmPm(h.closeMinutes)}`,
      );
      const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => hrs[i]).filter(Boolean); // Mon..Sun
      if (ordered.length) lines.push('Business hours (only take bookings within these):', ...ordered);
      const lead = rules.minLeadHours ?? 0;
      const adv = rules.maxAdvanceDays ?? 0;
      if (lead || adv) lines.push(`Booking window: at least ${lead}h in advance, up to ${adv} days ahead.`);
    } catch { /* hours are best-effort */ }
    try {
      const extra = await this.settings.getCompanyExtra(tenantId);
      if (extra?.address) lines.push(`Address: ${extra.address}`);
      if (extra?.website) lines.push(`Website: ${extra.website}`);
    } catch { /* address is best-effort */ }
    if (phone) lines.push(`Salon phone: ${phone}`);
    if (email) lines.push(`Salon email: ${email}`);
    return lines.join('\n');
  }

  private minToAmPm(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  /** Turn the salon's ticked FAQ facts into prompt lines the bot can answer from. */
  private factsText(botFacts: unknown): string {
    if (!Array.isArray(botFacts)) return '';
    return (botFacts as BotFact[])
      .filter((f) => f && f.on && typeof f.value === 'string' && f.value.trim())
      .map((f) => `- ${String(f.label).trim()}: ${f.value.trim()}`)
      .join('\n');
  }

  private async runTool(tenantId: string, tz: string, name: string, input: Record<string, unknown>): Promise<string> {
    try {
      if (name === 'get_services') {
        const services = await this.prisma.service.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true, priceCents: true, durationMinutes: true },
          orderBy: { name: 'asc' }, take: 40,
        });
        if (!services.length) return 'No services are configured.';
        return JSON.stringify(services.map((s) => ({ id: s.id, name: s.name, price: `$${(s.priceCents / 100).toFixed(0)}`, minutes: s.durationMinutes })));
      }
      if (name === 'create_booking') {
        const firstName = String(input.customerFirstName || '').trim();
        const phone = String(input.customerPhone || '').trim();
        const serviceId = String(input.serviceId || '').trim();
        const local = String(input.localDateTime || '').trim();
        const email = String(input.customerEmail || '').trim();
        if (!firstName || !phone || !serviceId || !local) return 'Missing required info; ask the customer for what is missing.';
        const startTime = wallToUtcISO(local, tz);
        const dto = {
          serviceId, startTime, customerFirstName: firstName, customerPhone: phone,
          ...(email && /.+@.+\..+/.test(email) ? { customerEmail: email } : {}),
        } as CreateBookingDto;
        const booking = await this.bookings.createForTenant(tenantId, dto, null, 'messenger');
        const b = booking as { id?: string };
        const manageUrl = b.id ? this.bookings.buildApptManageUrl(b.id) : '';
        return `SUCCESS. Appointment created (id ${b.id}). Confirm the service, date and time back to the customer warmly${manageUrl ? `, and share this link so they can view or cancel their appointment: ${manageUrl}` : ''}.`;
      }
      if (name === 'save_birthday') {
        const phone = String(input.customerPhone || '').trim();
        const d = new Date(String(input.birthDate || '').trim());
        if (!phone || isNaN(d.getTime())) return 'Could not save the birthday; gently ask again or simply skip it.';
        await this.prisma.customer.updateMany({ where: { tenantId, phone }, data: { birthDate: d } });
        return 'SUCCESS. Birthday saved — thank the customer warmly and wish them a great day.';
      }
      return `Unknown tool ${name}.`;
    } catch (e) {
      return `Could not complete "${name}": ${String((e as Error).message || e).slice(0, 160)}. Tell the customer and offer another time or ask for correct details.`;
    }
  }

  // ---- Facebook Send API ---------------------------------------------------
  private async sendText(pageToken: string, recipientId: string, text: string): Promise<void> {
    try {
      await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900) } }),
      });
    } catch (e) {
      this.logger.warn(`Send API failed: ${String(e).slice(0, 120)}`);
    }
  }
}

interface MessagingEvent {
  sender?: { id?: string };
  message?: { text?: string; is_echo?: boolean };
}
