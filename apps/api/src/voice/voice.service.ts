import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { SettingsService } from '../settings/settings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/** Convert a salon-local wall time ("2026-07-10T14:00") to the correct UTC ISO
 *  instant for the salon's timezone (handles DST). Shared shape with messenger. */
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
    const offset = localFromUtc - asUtc;
    return new Date(asUtc - offset).toISOString();
  } catch {
    return new Date(asUtc).toISOString();
  }
}

/** Escape text going inside a TwiML <Say> element. */
function xml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Normalise a phone number for matching (keep leading +, digits only). */
// Normalize a phone to E.164 (US/CA default) so Twilio can text it. Returns ''
// when the number is too short to be a real, sendable number.
function toE164(raw: string | null | undefined): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t[0] === '+') { const dd = t.slice(1).replace(/\D/g, ''); return dd.length >= 10 ? '+' + dd : ''; }
  const digits = t.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length >= 11) return '+' + digits;
  return '';
}

function normNum(v: string | null | undefined): string {
  if (!v) return '';
  const t = String(v).trim();
  const plus = t.startsWith('+') ? '+' : '';
  return plus + t.replace(/[^\d]/g, '');
}

type Turn = { role: 'user' | 'assistant'; content: string };
interface BotFact { label: string; value: string; on: boolean }
interface AnthropicBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }
export interface VoiceUsage {
  periodStart: string; aiCalls: number; aiMinutes: number; smsSent: number;
  monthlyCents: number;
  includedMinutes: number; includedSms: number;
  overageCentsPerMin: number; overageCentsPerSms: number;
  overageMinutes: number; overageSms: number; overageCents: number; hardCap: boolean;
}
export interface TenantVoiceUsage extends VoiceUsage { tenantId: string; name: string }

const MAX_TURNS = 16;
const MAX_TOOL_LOOPS = 5;
const MAX_SILENCE = 2; // reprompts before we politely hang up

@Injectable()
export class VoiceService {
  private readonly logger = new Logger('Voice');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly settings: SettingsService,
  ) {}

  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  // ---- TwiML helpers -------------------------------------------------------
  private twiml(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
  }
  private sayAttr(voice: string | null): string {
    return voice ? ` voice="${xml(voice)}"` : '';
  }
  /** Speak `text`, then listen. On silence Twilio falls through to the Redirect
   *  which re-enters /turn with an incremented miss counter. */
  private sayGather(text: string, miss: number, language: string, voice: string | null): string {
    const action = `${this.apiBase()}/api/voice/turn`;
    const redirect = `${this.apiBase()}/api/voice/turn?miss=${miss + 1}`;
    return this.twiml(
      `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="${xml(language)}">` +
        `<Say${this.sayAttr(voice)}>${xml(text)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">${redirect}</Redirect>`,
    );
  }
  private sayHangup(text: string, voice: string | null): string {
    return this.twiml(`<Say${this.sayAttr(voice)}>${xml(text)}</Say><Hangup/>`);
  }

  // ---- inbound call (Twilio webhook) --------------------------------------
  /** First webhook when a forwarded call reaches the salon's Lumio number. */
  async handleIncoming(body: Record<string, string>): Promise<string> {
    const to = normNum(body.To);
    const from = normNum(body.From);
    const callSid = String(body.CallSid || '');
    const line = to ? await this.prisma.voiceLine.findFirst({ where: { lumioNumber: to } }) : null;
    if (!line || !line.enabled) {
      return this.sayHangup('Sorry, we are not able to take this call right now. Please try again later. Goodbye.', null);
    }
    // Hard cap: stop taking NEW calls once over the included minutes (a call
    // already in progress is never cut off). Overage is still recorded otherwise.
    if (line.hardCap && line.includedMinutes > 0) {
      const u = await this.usageForTenant(line.tenantId);
      if (u.aiMinutes >= line.includedMinutes) {
        return this.sayHangup('Sorry, our automated booking line is not available right now. Please call back a little later. Goodbye.', line.voice || null);
      }
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: line.tenantId }, select: { name: true } });
    const salonName = tenant?.name || 'our salon';
    // Log the call session (idempotent on callSid).
    if (callSid) {
      await this.prisma.voiceCall.upsert({
        where: { callSid },
        update: { fromNumber: from || null, toNumber: to || null, tenantId: line.tenantId },
        create: { callSid, tenantId: line.tenantId, fromNumber: from || null, toNumber: to || null, transcript: [] as unknown as Prisma.InputJsonValue },
      }).catch(() => undefined);
    }
    // ALWAYS disclose the automated assistant up front (CA/TX AI-disclosure laws).
    const disclosure = `You've reached the automated booking assistant for ${salonName}.`;
    const greeting = (line.greeting && line.greeting.trim()) || 'How can I help you book an appointment today?';
    return this.sayGather(`${disclosure} ${greeting}`, 0, line.language || 'en-US', line.voice || null);
  }

  /** Each subsequent turn: caller's transcribed speech arrives in SpeechResult. */
  async handleTurn(body: Record<string, string>, missParam: string): Promise<string> {
    const callSid = String(body.CallSid || '');
    const speech = String(body.SpeechResult || '').trim();
    const miss = Number(missParam || '0') || 0;

    const call = callSid ? await this.prisma.voiceCall.findUnique({ where: { callSid } }) : null;
    const line = call ? await this.prisma.voiceLine.findUnique({ where: { tenantId: call.tenantId } }) : null;
    if (!call || !line) {
      return this.sayHangup('Sorry, something went wrong on our end. Please call again. Goodbye.', null);
    }
    const lang = line.language || 'en-US';
    const voice = line.voice || null;

    // No speech captured → reprompt a couple of times, then bow out gracefully.
    if (!speech) {
      if (miss >= MAX_SILENCE) {
        await this.finalize(call.id, 'no_action', null);
        return this.sayHangup('It looks like I lost you. Please call back any time to book. Goodbye!', voice);
      }
      return this.sayGather("Sorry, I didn't catch that. How can I help you book?", miss, lang, voice);
    }

    const history = (Array.isArray(call.transcript) ? call.transcript : []) as Turn[];
    let result: { reply: string; done: boolean; booked: boolean; appointmentId: string | null };
    try {
      result = await this.runAgent(call.tenantId, call.fromNumber || '', line.aiInstruction || '', history, speech);
    } catch (e) {
      this.logger.warn(`agent error: ${String(e).slice(0, 160)}`);
      result = { reply: 'Sorry, I am having trouble right now. A team member will call you back shortly. Goodbye.', done: true, booked: false, appointmentId: null };
    }

    const nextHistory = [...history, { role: 'user', content: speech }, { role: 'assistant', content: result.reply }].slice(-MAX_TURNS);
    await this.prisma.voiceCall.update({
      where: { id: call.id },
      data: {
        transcript: nextHistory as unknown as Prisma.InputJsonValue,
        ...(result.booked ? { outcome: 'booked', appointmentId: result.appointmentId } : {}),
      },
    }).catch(() => undefined);

    if (result.done) {
      if (!result.booked) await this.finalize(call.id, call.outcome === 'booked' ? 'booked' : 'info', null);
      return this.sayHangup(result.reply, voice);
    }
    return this.sayGather(result.reply, 0, lang, voice);
  }

  private async finalize(callId: string, outcome: string, appointmentId: string | null): Promise<void> {
    await this.prisma.voiceCall.update({
      where: { id: callId },
      data: { ...(appointmentId ? { appointmentId } : {}), outcome },
    }).catch(() => undefined);
  }

  /** Twilio "call status changes" webhook → record the real billed duration. */
  async handleStatus(body: Record<string, string>): Promise<void> {
    const callSid = String(body.CallSid || '');
    const dur = Number(body.CallDuration || body.DialCallDuration || 0) || 0;
    if (!callSid || !dur) return;
    await this.prisma.voiceCall.updateMany({ where: { callSid }, data: { durationSec: dur } }).catch(() => undefined);
  }

  // ---- usage metering (AI minutes + SMS) -----------------------------------
  private monthStart(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  }

  /** AI voice usage + SMS sent for one tenant this month, with plan limits and
   *  computed overage (minutes/SMS beyond the included allowance). */
  private async usageForTenant(tenantId: string, monthStart?: Date): Promise<VoiceUsage> {
    const since = monthStart ?? this.monthStart();
    // When billing a specific past month, bound the window to that month only.
    const until = monthStart ? new Date(since.getFullYear(), since.getMonth() + 1, 1) : null;
    const callWindow = until ? { gte: since, lt: until } : { gte: since };
    const [calls, line] = await Promise.all([
      this.prisma.voiceCall.findMany({
        where: { tenantId, createdAt: callWindow },
        select: { durationSec: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.voiceLine.findUnique({
        where: { tenantId },
        select: { monthlyCents: true, includedMinutes: true, includedSms: true, overageCentsPerMin: true, overageCentsPerSms: true, hardCap: true },
      }),
    ]);
    let seconds = 0;
    for (const c of calls) {
      // Prefer Twilio's billed duration; else estimate from the turn span (cap 30m).
      if (typeof c.durationSec === 'number' && c.durationSec > 0) seconds += c.durationSec;
      else seconds += Math.max(0, Math.min(1800, Math.round((c.updatedAt.getTime() - c.createdAt.getTime()) / 1000)));
    }
    const aiMinutes = Math.ceil(seconds / 60);
    const smsSent = await this.prisma.notification.count({
      where: { tenantId, channel: NotificationChannel.SMS, status: NotificationStatus.SENT, createdAt: callWindow },
    });
    const incMin = line?.includedMinutes ?? 0;
    const incSms = line?.includedSms ?? 0;
    const overageMinutes = incMin > 0 ? Math.max(0, aiMinutes - incMin) : 0;
    const overageSms = incSms > 0 ? Math.max(0, smsSent - incSms) : 0;
    const overageCents = overageMinutes * (line?.overageCentsPerMin ?? 0) + overageSms * (line?.overageCentsPerSms ?? 0);
    return {
      periodStart: since.toISOString(), aiCalls: calls.length, aiMinutes, smsSent,
      monthlyCents: line?.monthlyCents ?? 0,
      includedMinutes: incMin, includedSms: incSms,
      overageCentsPerMin: line?.overageCentsPerMin ?? 0, overageCentsPerSms: line?.overageCentsPerSms ?? 0,
      overageMinutes, overageSms, overageCents, hardCap: line?.hardCap ?? false,
    };
  }

  // ---- AI agent (tool use) — phone-tuned -----------------------------------
  private async runAgent(
    tenantId: string, callerPhone: string, aiInstruction: string, history: Turn[], userText: string,
  ): Promise<{ reply: string; done: boolean; booked: boolean; appointmentId: string | null }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    const acc = { wantEnd: false, booked: false, appointmentId: null as string | null };
    if (!key) return { reply: 'Thank you for calling. A team member will call you back shortly. Goodbye.', done: true, booked: false, appointmentId: null };

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { name: true, timezone: true, contactPhone: true, contactEmail: true },
    });
    const salonName = tenant?.name || 'our salon';
    const tz = tenant?.timezone || 'America/New_York';
    const infoBlock = await this.salonInfoBlock(tenantId, tenant?.contactPhone ?? null, tenant?.contactEmail ?? null);
    const facts = await this.factsFor(tenantId);
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const extra = [facts, aiInstruction].filter(Boolean).join('\n');

    // Inject the services directly into the prompt so the agent NEVER needs a
    // separate get_services round-trip — one Claude call per turn instead of two.
    const services = await this.prisma.service.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, priceCents: true, durationMinutes: true },
      orderBy: { name: 'asc' }, take: 40,
    });
    const price = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
    const servicesBlock = services.length
      ? 'Bookable services (use the exact id when you call create_booking; never say the id out loud):\n' +
        services.map((s) => `- ${s.name} — ${price(s.priceCents)}${s.durationMinutes ? `, ${s.durationMinutes} min` : ''} (id: ${s.id})`).join('\n')
      : 'No services are configured yet; take a message and tell them someone will call back.';

    const system = `You are the warm, professional phone receptionist for "${salonName}", a nail salon. Your words are read aloud on a live call. Speak naturally like a friendly human receptionist — usually one relaxed sentence, occasionally two; concise and to the point, but never curt, robotic, or scripted. A little warmth ("Of course!", "Happy to help") is good; rambling is not. No lists, no emojis, no special characters, no URLs.
The caller's phone number is ${callerPhone || 'unknown'}.${callerPhone ? ' You already have it — do NOT ask for their phone number; use it when booking.' : ' Politely ask for a good callback number if you need one.'}
Goal: book an appointment. You still need their first name, which service they want, and a specific date and time. Ask for what is missing, ONE thing at a time, and confirm details by repeating them back.
Once you have a first name, a service (use its id from the list below), and a specific date and time, call create_booking. After it succeeds, say the day and time out loud to confirm and let them know they'll get a text message confirmation.
Speak times naturally (for example, "two thirty PM on Friday"). The salon's local time right now is ${nowLocal} (timezone ${tz}); interpret "today/tomorrow/this Friday" in that timezone.
Only state hours, prices, services, address and contact details that are given to you here — never invent them. Never book outside business hours; if they ask for a closed time, tell them the salon is closed then and offer the nearest open time.
When the conversation is finished — they've booked and have nothing else, or they only had a question and it's answered, or they say goodbye — call end_call to say a warm goodbye and hang up. If the caller is upset or asks for a real person, tell them a staff member will call them back, then call end_call. Never ask for payment or card details.
${servicesBlock}
${infoBlock ? infoBlock + '\n' : ''}${extra ? 'Salon notes: ' + extra : ''}`;

    const tools = [
      {
        name: 'create_booking',
        description: 'Create the appointment. Only call once you have the caller first name, a chosen service id, and a specific local date & time.',
        input_schema: {
          type: 'object',
          properties: {
            customerFirstName: { type: 'string' },
            serviceId: { type: 'string' },
            localDateTime: { type: 'string', description: 'Salon local time in ISO form, e.g. 2026-07-10T14:00' },
            customerPhone: { type: 'string', description: 'Optional. Defaults to the caller’s own number; only set if they give a different callback number.' },
          },
          required: ['customerFirstName', 'serviceId', 'localDateTime'],
        },
      },
      {
        name: 'end_call',
        description: 'End the phone call after saying goodbye. Call this when the caller is done (booked and nothing else, question answered, or they said goodbye), or when handing off to a human.',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
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
        body: JSON.stringify({
          model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: 180, // keep replies short → faster generation + faster text-to-speech
          // Cache the (stable) system prompt so turns 2+ of the same call are faster.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
        return { reply: 'Sorry, I am having trouble right now. Please call again shortly. Goodbye.', done: true, booked: acc.booked, appointmentId: acc.appointmentId };
      }
      const data = (await res.json()) as { stop_reason?: string; content?: AnthropicBlock[] };
      const blocks = data.content || [];
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocks });
        const results: unknown[] = [];
        for (const blk of blocks) {
          if (blk.type !== 'tool_use') continue;
          const out = await this.runTool(tenantId, tz, callerPhone, blk.name || '', blk.input || {}, acc);
          results.push({ type: 'tool_result', tool_use_id: blk.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      return { reply: text || 'How else can I help you book?', done: acc.wantEnd, booked: acc.booked, appointmentId: acc.appointmentId };
    }
    return { reply: 'Thanks for calling! A team member will follow up shortly. Goodbye.', done: true, booked: acc.booked, appointmentId: acc.appointmentId };
  }

  private async runTool(
    tenantId: string, tz: string, callerPhone: string, name: string, input: Record<string, unknown>,
    acc: { wantEnd: boolean; booked: boolean; appointmentId: string | null },
  ): Promise<string> {
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
        const serviceId = String(input.serviceId || '').trim();
        const local = String(input.localDateTime || '').trim();
        // Use a fully-formed spoken number if the caller gave one; otherwise fall
        // back to the verified caller ID. Both normalized to E.164 so Twilio can text it.
        const phone = toE164(String(input.customerPhone || '')) || toE164(callerPhone);
        if (!firstName || !serviceId || !local) return 'Missing required info; ask the caller for what is missing.';
        if (!phone) return 'No phone number available; politely ask the caller for a good callback number.';
        const startTime = wallToUtcISO(local, tz);
        const dto = { serviceId, startTime, customerFirstName: firstName, customerPhone: phone } as CreateBookingDto;
        const booking = await this.bookings.createForTenant(tenantId, dto, null, 'hotline');
        const b = booking as { id?: string };
        // Auto-assign a technician (fair rotation) when the salon runs in auto mode —
        // same as the public web flow — so AI bookings don't land unassigned.
        if (b.id) {
          try {
            const rules = await this.settings.getBookingRules(tenantId);
            if (rules.assignmentMode === 'auto') await this.bookings.autoAssignForTenant(tenantId, b.id);
          } catch { /* best-effort: the booking is already created */ }
        }
        acc.booked = true;
        acc.appointmentId = b.id || null;
        return `SUCCESS. Appointment created (id ${b.id}). Confirm the service, day and time back to the caller warmly and tell them a text confirmation is on its way.`;
      }
      if (name === 'end_call') {
        acc.wantEnd = true;
        return 'OK. Give a short, warm goodbye now.';
      }
      return `Unknown tool ${name}.`;
    } catch (e) {
      return `Could not complete "${name}": ${String((e as Error).message || e).slice(0, 160)}. Tell the caller and offer another time or ask for the correct details.`;
    }
  }

  // ---- shared prompt context (mirrors messenger) ---------------------------
  private async salonInfoBlock(tenantId: string, phone: string | null, email: string | null): Promise<string> {
    const lines: string[] = [];
    try {
      const rules = await this.settings.getBookingRules(tenantId);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hrs = (rules.businessHours || []).map((h, i) =>
        !h || h.closed ? `${dayNames[i]}: Closed` : `${dayNames[i]}: ${this.minToAmPm(h.openMinutes)} – ${this.minToAmPm(h.closeMinutes)}`,
      );
      const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => hrs[i]).filter(Boolean);
      if (ordered.length) lines.push('Business hours (only take bookings within these):', ...ordered);
      const lead = rules.minLeadHours ?? 0;
      const adv = rules.maxAdvanceDays ?? 0;
      if (lead || adv) lines.push(`Booking window: at least ${lead}h in advance, up to ${adv} days ahead.`);
    } catch { /* best-effort */ }
    try {
      const ex = await this.settings.getCompanyExtra(tenantId);
      if (ex?.address) lines.push(`Address: ${ex.address}`);
      if (ex?.website) lines.push(`Website: ${ex.website}`);
    } catch { /* best-effort */ }
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

  /** Reuse the salon's Messenger FAQ facts (single source of bot knowledge). */
  private async factsFor(tenantId: string): Promise<string> {
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId }, select: { botFacts: true } });
    const botFacts = conn?.botFacts;
    if (!Array.isArray(botFacts)) return '';
    return (botFacts as unknown as BotFact[])
      .filter((f) => f && f.on && typeof f.value === 'string' && f.value.trim())
      .map((f) => `- ${String(f.label).trim()}: ${f.value.trim()}`)
      .join('\n');
  }

  // ---- Salon Admin ---------------------------------------------------------
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const line = await this.prisma.voiceLine.findUnique({ where: { tenantId } });
    const calls = await this.prisma.voiceCall.count({ where: { tenantId } });
    return {
      provisioned: Boolean(line?.lumioNumber),
      lumioNumber: line?.lumioNumber ?? '',
      enabled: line?.enabled ?? false,
      greeting: line?.greeting ?? '',
      language: line?.language ?? 'en-US',
      aiInstruction: line?.aiInstruction ?? '',
      aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      webhookUrl: `${this.apiBase()}/api/voice/incoming`,
      calls,
    };
  }

  async updateSettings(
    user: AuthenticatedUser,
    dto: { enabled?: boolean; greeting?: string; language?: string; aiInstruction?: string },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.prisma.voiceLine.findUnique({ where: { tenantId } });
    const data = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur?.enabled ?? false,
      greeting: typeof dto.greeting === 'string' ? dto.greeting.slice(0, 500) : cur?.greeting ?? null,
      language: typeof dto.language === 'string' && dto.language.trim() ? dto.language.trim().slice(0, 12) : cur?.language ?? 'en-US',
      aiInstruction: typeof dto.aiInstruction === 'string' ? dto.aiInstruction.slice(0, 2000) : cur?.aiInstruction ?? null,
    };
    if (data.enabled && !cur?.lumioNumber) {
      throw new BadRequestException('No Lumio phone number is assigned yet. Contact Lumio to provision your AI hotline number.');
    }
    await this.prisma.voiceLine.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
    await this.audit(tenantId, 'voice.settings_updated');
    return this.get(user);
  }

  async listCalls(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.voiceCall.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, fromNumber: true, outcome: true, appointmentId: true, durationSec: true, createdAt: true },
    });
    return rows;
  }

  async usage(user: AuthenticatedUser): Promise<VoiceUsage> {
    return this.usageForTenant(this.tenantId(user));
  }

  /** Usage for a specific month (monthStart = first day 00:00). Used by month-end invoicing. */
  async usageForMonth(tenantId: string, monthStart: Date): Promise<VoiceUsage> {
    return this.usageForTenant(tenantId, monthStart);
  }

  // ---- Super Admin (platform) ----------------------------------------------
  /** Assign a Lumio-owned voice number to a tenant (the number they forward to). */
  async provision(tenantId: string, lumioNumber: string) {
    const num = normNum(lumioNumber);
    if (!tenantId) throw new BadRequestException('tenantId required');
    if (!num) throw new BadRequestException('Enter the Lumio number in E.164 form, e.g. +14085551234');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const clash = await this.prisma.voiceLine.findFirst({ where: { lumioNumber: num, NOT: { tenantId } } });
    if (clash) throw new BadRequestException('That number is already assigned to another salon.');
    await this.prisma.voiceLine.upsert({
      where: { tenantId },
      update: { lumioNumber: num },
      create: { tenantId, lumioNumber: num, enabled: false },
    });
    await this.audit(tenantId, 'voice.provisioned');
    return { tenantId, lumioNumber: num };
  }

  /** Per-tenant AI usage this month (Super Admin billing oversight). */
  async usageAll(): Promise<TenantVoiceUsage[]> {
    const tenants = await this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const rows: TenantVoiceUsage[] = [];
    for (const t of tenants) rows.push({ tenantId: t.id, name: t.name, ...(await this.usageForTenant(t.id)) });
    return rows;
  }

  /** Super Admin: set the tenant's AI plan limits (0 = unlimited; overage in cents). */
  async setLimits(
    tenantId: string,
    dto: { monthlyCents?: number; includedMinutes?: number; includedSms?: number; overageCentsPerMin?: number; overageCentsPerSms?: number; hardCap?: boolean },
  ): Promise<VoiceUsage> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    const cur = await this.prisma.voiceLine.findUnique({ where: { tenantId } });
    const n = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? Math.floor(v) : d);
    const data = {
      monthlyCents: n(dto.monthlyCents, cur?.monthlyCents ?? 0),
      includedMinutes: n(dto.includedMinutes, cur?.includedMinutes ?? 0),
      includedSms: n(dto.includedSms, cur?.includedSms ?? 0),
      overageCentsPerMin: n(dto.overageCentsPerMin, cur?.overageCentsPerMin ?? 0),
      overageCentsPerSms: n(dto.overageCentsPerSms, cur?.overageCentsPerSms ?? 0),
      hardCap: typeof dto.hardCap === 'boolean' ? dto.hardCap : (cur?.hardCap ?? false),
    };
    await this.prisma.voiceLine.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
    await this.audit(tenantId, 'voice.limits_updated');
    return this.usageForTenant(tenantId);
  }

  private async audit(tenantId: string, action: string): Promise<void> {
    try { await this.prisma.auditLog.create({ data: { tenantId, action, resourceType: 'voice' } }); } catch { /* never break */ }
  }
}
