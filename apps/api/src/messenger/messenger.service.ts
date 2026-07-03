import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
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

  // ---- admin (salon) -------------------------------------------------------
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const threads = await this.prisma.messengerThread.count({ where: { tenantId } });
    return {
      connected: Boolean(c?.pageId && c?.pageToken),
      pageId: c?.pageId ?? '',
      enabled: c?.enabled ?? false,
      greeting: c?.greeting ?? '',
      aiInstruction: c?.aiInstruction ?? '',
      aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      webhookUrl: `${this.apiBase()}/api/messenger/webhook`,
      verifyToken: this.verifyToken(),
      threads,
    };
  }

  async updateSettings(
    user: AuthenticatedUser,
    dto: { pageId?: string; pageToken?: string; enabled?: boolean; greeting?: string; aiInstruction?: string },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const pageId = typeof dto.pageId === 'string' ? dto.pageId.trim() : cur?.pageId ?? '';
    const pageToken = cleanSecret(dto.pageToken) ?? cur?.pageToken ?? '';
    const data = {
      pageId,
      pageToken,
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur?.enabled ?? false,
      greeting: typeof dto.greeting === 'string' ? dto.greeting.slice(0, 500) : cur?.greeting ?? null,
      aiInstruction: typeof dto.aiInstruction === 'string' ? dto.aiInstruction.slice(0, 2000) : cur?.aiInstruction ?? null,
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
    if (b?.object !== 'page' || !Array.isArray(b.entry)) return;
    for (const entry of b.entry) {
      const pageId = entry.id || '';
      for (const ev of entry.messaging || []) {
        const senderId = ev.sender?.id;
        const text = ev.message?.text;
        if (!senderId || !text || ev.message?.is_echo) continue;
        await this.handleMessage(pageId, senderId, text).catch((e) =>
          this.logger.warn(`handleMessage failed: ${String(e).slice(0, 160)}`),
        );
      }
    }
  }

  private async handleMessage(pageId: string, senderId: string, text: string): Promise<void> {
    const conn = await this.prisma.messengerConnection.findUnique({ where: { pageId } });
    if (!conn || !conn.enabled || !conn.pageToken) return;
    const thread = await this.prisma.messengerThread.upsert({
      where: { pageId_senderId: { pageId, senderId } },
      update: { lastText: text.slice(0, 300) },
      create: { tenantId: conn.tenantId, pageId, senderId, lastText: text.slice(0, 300) },
    });
    if (thread.handoff) return; // a human is handling this conversation

    const history = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
    let reply: string;
    try {
      reply = await this.runAgent(conn.tenantId, conn.aiInstruction || '', history, text);
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

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true } });
    const salonName = tenant?.name || 'our salon';
    const tz = tenant?.timezone || 'America/New_York';
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const system = `You are the friendly booking assistant for "${salonName}", a nail salon, chatting with a customer on Facebook Messenger.
Goal: help them book an appointment. Be warm, concise (1-3 short sentences), and reply in the SAME language the customer uses.
To book you MUST collect: their name, their phone number, which service, and a specific date & time. Ask for whatever is missing, one or two things at a time.
Use the get_services tool to tell them what's available and to get service ids. When you have name + phone + service + a specific date/time, call create_booking. After it succeeds, confirm the details warmly.
The salon's local time right now is: ${nowLocal} (timezone ${tz}). Interpret "today/tomorrow/this Friday" in that timezone.
Never invent prices, availability, or promises. If the customer is upset or asks for a human, tell them a staff member will follow up soon. Do not ask for payment.${aiInstruction ? `\nSalon owner's extra notes: ${aiInstruction}` : ''}`;

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
          },
          required: ['customerFirstName', 'customerPhone', 'serviceId', 'localDateTime'],
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
        if (!firstName || !phone || !serviceId || !local) return 'Missing required info; ask the customer for what is missing.';
        const startTime = wallToUtcISO(local, tz);
        const dto = { serviceId, startTime, customerFirstName: firstName, customerPhone: phone } as CreateBookingDto;
        const booking = await this.bookings.createForTenant(tenantId, dto, null);
        const b = booking as { id?: string };
        return `SUCCESS. Appointment created (id ${b.id}). Confirm the service, date and time back to the customer warmly.`;
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
