import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { chosenIndustry, personaFor } from '../common/business-persona';
import { agentLangRule, cannedLines, effectiveLang, isBilingual, menuLines, parseLangChoice, voiceFor, agentFallbackLines, transferLines } from './voice-lang';
import { isTransientStatus } from '../messenger/agent-fallback';
import { Prisma, NotificationChannel, NotificationStatus, AppointmentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { wallTimeToUtc } from '../bookings/booking.util';
import { MenuItem, resolveService, serviceCode } from '../bookings/group-booking';
import { PartyAvailabilityService, type Member } from '../bookings/party-availability.service';
import { aiBookingNote, noteLangForMarket } from '../bookings/ai-booking-note';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AiUsageService } from '../common/ai-usage.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { toE164 as normalizeE164, dialCodeFor } from '../common/phone';
import { bookingPhone, spokenLast4 } from './phone-readback';
import { formatMoneyShort, localeForCountry } from '../common/money';

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
/**
 * Normalize a phone to E.164 so Twilio can text it. Returns '' when the number
 * cannot be one.
 *
 * This used to be a second, private copy of the rule, and it still said "ten
 * digits means the United States". A Vietnamese mobile is written 0912 345 678
 * — also ten digits — so the hotline turned it into +10912345678: a
 * plausible-looking US number that quietly fails to deliver. The salon believes
 * the callback text went out; the caller never hears anything.
 *
 * One rule now, shared with the reminder path. `dial` defaults to '1', so every
 * call site that does not know the salon behaves exactly as it did.
 */
function toE164(raw: string | null | undefined, dial = '1'): string {
  return normalizeE164(raw, dial) ?? '';
}

function normNum(v: string | null | undefined): string {
  if (!v) return '';
  const t = String(v).trim();
  const plus = t.startsWith('+') ? '+' : '';
  return plus + t.replace(/[^\d]/g, '');
}

/** `meta` marks a turn for us (never sent to the model): 'transfer_missed' = a
 *  hand-off to staff was tried on this call and nobody picked up. */
type Turn = { role: 'user' | 'assistant'; content: string; meta?: string };
export interface UpdateVoiceInput {
  enabled?: boolean; greeting?: string; language?: string; aiInstruction?: string;
  mode?: string; forwardNumbers?: string; ringSeconds?: number; transferNumber?: string;
  schedule?: string; customHours?: { day: number; enabled?: boolean; start?: string; end?: string }[];
  noAnswerAction?: string; awayMessage?: string; voicemailSms?: string;
}
interface BotFact { label: string; value: string; on: boolean }
/** What the tools need from the turn that called them: the coded menu, who works here, and which booking flow applies. */
interface ToolCtx { menu: MenuItem[]; staff: { id: string; firstName: string; lastName: string | null }[]; groupMode: boolean }
interface AnthropicBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }
export interface VoiceUsage {
  periodStart: string; aiCalls: number; aiMinutes: number; smsSent: number;
  monthlyCents: number;
  includedMinutes: number; includedSms: number;
  overageCentsPerMin: number; overageCentsPerSms: number;
  overageMinutes: number; overageSms: number; overageCents: number; hardCap: boolean;
}
export interface TenantVoiceUsage extends VoiceUsage { tenantId: string; name: string }

/**
 * Turns of the conversation the model sees. Sixteen (eight exchanges) was
 * fine for "one gel manicure, Friday, Anna" — a party of three, each with
 * their own services, then the time, then the names, scrolled its own
 * beginning out of view and the assistant asked again for what it had been
 * told. Forty keeps a whole long call in sight.
 */
const MAX_TURNS = 40;
const MAX_TOOL_LOOPS = 5;
const MAX_SILENCE = 2; // reprompts before we politely hang up
/**
 * THE PAUSE THAT SOUNDS LIKE A HANG-UP.
 *
 * A turn is: Twilio finishes transcribing, asks us, we ask the model (once,
 * or three times when it reaches for a tool), we answer, Twilio turns the
 * text into speech. Four to eight seconds of silence on a phone, and the
 * caller says "hello? hello?" or hangs up. The owner's words: "phản hồi hơi
 * chậm".
 *
 * So a turn now answers in one of two ways. If the brain is back within
 * FAST_REPLY_MS the answer goes out as before. If not, the caller hears a
 * short "one moment" straight away — a human receptionist says exactly that
 * while she looks at the book — and Twilio is sent to /voice/turn-result,
 * where the finished answer is waiting (or nearly). The work is never done
 * twice: the same promise that missed the fast window is the one the result
 * endpoint awaits. The filler also buys the brain more time than the old 9s:
 * the deadline is now measured from the filler, at RESULT_WAIT_MS.
 */
const FAST_REPLY_MS = 1_200;
/** How long /turn-result waits for the brain before asking the caller to repeat. */
const RESULT_WAIT_MS = 12_000;
/** The brain's own deadline per turn, filler included. Under Twilio's 15s. */
const TURN_DEADLINE_MS = FAST_REPLY_MS + RESULT_WAIT_MS;
/** A pending answer is forgotten after this — Twilio never came back for it. */
const PENDING_TTL_MS = 60_000;

@Injectable()
export class VoiceService implements OnModuleInit {
  private readonly logger = new Logger('Voice');

  /**
   * Self-healing schema for the one column the whole bilingual flow leans on.
   * The migration adding voice_calls.language failed on its first deploy
   * (wrong table name) — and if the retry ever didn't stick, EVERY
   * voiceCall.findUnique (which selects all columns) threw, /lang and /turn
   * returned 500, and Twilio spoke its own English "application error" and
   * hung up: the exact "sorry và tắt máy" reported from live calls. Booting
   * must not depend on migration history being clean.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe('ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "language" TEXT');
      // Same lesson for the receptionist's hand-off number: every voiceLine
      // read selects all columns, so a missing one would take the whole line down.
      await this.prisma.$executeRawUnsafe('ALTER TABLE "voice_lines" ADD COLUMN IF NOT EXISTS "transferNumber" TEXT');
      this.logger.log('voice_calls.language + voice_lines.transferNumber ensured');
    } catch (e) {
      this.logger.error(`could not ensure voice_calls.language: ${String(e).slice(0, 160)}`);
    }
  }
  /** Agent failures per active call — three strikes before we say goodbye. */
  private readonly turnFails = new Map<string, number>();
  /** Answers still being computed while the caller hears a filler — see FAST_REPLY_MS. */
  private readonly pendingTurns = new Map<string, { promise: Promise<string>; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    // Optional like everywhere else the meter is injected: counting a call
    // must never be able to drop one.
    @Optional() private readonly aiUsage?: AiUsageService,
    // The shared "is there room for all of us" arithmetic (bookings module).
    // Optional so the older specs that build the service bare still run.
    @Optional() private readonly party?: PartyAvailabilityService,
  ) {}

  /** The party service, built on demand when Nest did not hand one in (specs). */
  private get parties(): PartyAvailabilityService {
    if (!this.party) (this as unknown as { party?: PartyAvailabilityService }).party = new PartyAvailabilityService(this.prisma, this.settings);
    return this.party!;
  }

  /**
   * Count one turn of a phone call. A caller who says four things costs four
   * model calls, not one — so the hotline is metered per TURN, and the report
   * can tell a long conversation from a busy morning.
   */
  private meter(tenantId: string | null, body: unknown, ok: boolean) {
    const d = (body ?? {}) as { model?: string; usage?: Record<string, number> };
    this.aiUsage?.record({
      feature: 'voice',
      tenantId,
      model: d.model || process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5',
      input: Number(d.usage?.input_tokens ?? 0) || 0,
      output: Number(d.usage?.output_tokens ?? 0) || 0,
      cacheRead: Number(d.usage?.cache_read_input_tokens ?? 0) || 0,
      cacheWrite: Number(d.usage?.cache_creation_input_tokens ?? 0) || 0,
      failed: !ok,
    });
  }

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
  private sayGather(text: string, miss: number, language: string, voice: string | null, lg?: string | null): string {
    // `lg` rides the webhook URL so a bilingual call keeps its language even
    // if persisting it failed — the first live vi caller got English "Sorry…
    // Goodbye" because the choice was lost between turns.
    const lgQ = lg ? `lg=${encodeURIComponent(lg)}` : '';
    const action = `${this.apiBase()}/api/voice/turn${lgQ ? `?${lgQ}` : ''}`;
    const redirect = `${this.apiBase()}/api/voice/turn?miss=${miss + 1}${lgQ ? `&${lgQ}` : ''}`;
    // Without a language-capable voice, Vietnamese text is read with English
    // phonetics — technically speech, practically noise.
    const v = voiceFor(language, voice);
    const langAttr = v.sayLanguage ? ` language="${xml(v.sayLanguage)}"` : '';
    // The URLs go INSIDE XML: a naked & (miss=1&lg=vi-VN) is invalid markup.
    // Twilio answered with error 12100 "Document parse failure", spoke its own
    // English apology and hung up — on every single turn that carried the
    // language parameter. Everything in a TwiML document gets escaped.
    return this.twiml(
      `<Gather input="speech" action="${xml(action)}" method="POST" speechTimeout="auto" language="${xml(language)}">` +
        `<Say${this.sayAttr(v.voice)}${langAttr}>${xml(text)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">${xml(redirect)}</Redirect>`,
    );
  }

  /** The bilingual opening menu: each half spoken in its own language.
   *  KEYPAD ONLY. The first version also listened for speech — and Vietnamese
   *  callers answer the phone talking ("a lô!"), so the speech capture kept
   *  finishing the gather BEFORE the keypress: unmatched speech, menu replays,
   *  they speak again… an endless loop that ended in English. A keypress is
   *  the one signal background talk cannot fake. */
  private langMenuTwiml(salonName: string, miss: number): string {
    const m = menuLines(salonName);
    const action = `${this.apiBase()}/api/voice/lang?miss=${miss}`;
    const redirect = `${this.apiBase()}/api/voice/lang?miss=${miss + 1}`;
    return this.twiml(
      `<Gather input="dtmf" numDigits="1" timeout="7" action="${xml(action)}" method="POST">` +
        `<Say voice="Polly.Joanna-Neural">${xml(m.en)}</Say>` +
        `<Say voice="Google.vi-VN-Wavenet-A" language="vi-VN">${xml(m.vi)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">${xml(redirect)}</Redirect>`,
    );
  }
  private sayHangup(text: string, voice: string | null, language = 'en-US'): string {
    const v = voiceFor(language, voice);
    const langAttr = v.sayLanguage ? ` language="${xml(v.sayLanguage)}"` : '';
    return this.twiml(`<Say${this.sayAttr(v.voice)}${langAttr}>${xml(text)}</Say><Pause length="1"/><Hangup/>`);
  }

  // ---- call routing ---------------------------------------------------------
  /** The salon's own phones we ring before (or instead of) the AI. A number equal
   *  to the Lumio number is dropped — that would forward straight back to us and
   *  loop the call. */
  private humanNumbers(line: { forwardNumbers: string | null; lumioNumber: string | null }, dial = '1'): string[] {
    const lumio = normNum(line.lumioNumber);
    return String(line.forwardNumbers || '')
      .split(/[,;\n]/)
      .map((x) => toE164(x, dial))
      .filter((x) => x && normNum(x) !== lumio)
      .slice(0, 5);
  }

  /**
   * Who the assistant hands a caller to mid-call: the receptionist's phone when
   * the salon set one (the person actually holding the desk phone today), else
   * the numbers it rings first. Never the Lumio number itself.
   */
  private transferTargets(line: { transferNumber?: string | null; forwardNumbers: string | null; lumioNumber: string | null }, dial = '1'): string[] {
    const lumio = normNum(line.lumioNumber);
    const direct = toE164(line.transferNumber ?? '', dial);
    if (direct && normNum(direct) !== lumio) return [direct];
    return this.humanNumbers(line, dial);
  }

  /**
   * How this salon's numbers and prices should be read: its dial code and the
   * locale its own customers are written to. Both follow the country chosen in
   * Settings, falling back to the timezone, so a salon that has stated nothing
   * behaves exactly as it always has.
   */
  private async localeInfo(tenantId: string): Promise<{ dial: string; locale: string }> {
    try {
      const [t, extra] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
        this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }),
      ]);
      const country = (extra?.value as { country?: string } | null)?.country ?? '';
      return { dial: dialCodeFor(country, t?.timezone), locale: localeForCountry(country, t?.timezone) };
    } catch {
      return { dial: '1', locale: 'en-US' };
    }
  }

  /** Salon-local day (0=Sun) and minutes-since-midnight, DST-safe. */
  private localNow(tz: string): { day: number; minutes: number } {
    try {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date());
      const wd = String(p.find((x) => x.type === 'weekday')?.value || 'Sun');
      const h = Number(p.find((x) => x.type === 'hour')?.value || 0);
      const mi = Number(p.find((x) => x.type === 'minute')?.value || 0);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return { day: Math.max(0, days.indexOf(wd)), minutes: (h === 24 ? 0 : h) * 60 + mi };
    } catch {
      const d = new Date();
      return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
    }
  }

  private hhmmToMin(v: unknown, fallback: number): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
    if (!m) return fallback;
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const mi = Math.min(59, Math.max(0, Number(m[2])));
    return h * 60 + mi;
  }

  /**
   * Is the AI allowed to answer RIGHT NOW? Exact, salon-timezone aware.
   *   always         → yes
   *   business_hours → only while the salon is open
   *   after_hours    → only while the salon is closed (nights, days off, holidays)
   *   custom         → the salon's own per-weekday windows
   */
  private async aiWindowOpen(line: { schedule: string; customHours: unknown }, tenantId: string): Promise<boolean> {
    const sched = String(line.schedule || 'always');
    if (sched === 'always') return true;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = tenant?.timezone || 'America/Los_Angeles';
    const now = this.localNow(tz);

    if (sched === 'custom') {
      const rows = Array.isArray(line.customHours) ? (line.customHours as Record<string, unknown>[]) : [];
      const row = rows.find((r) => Number(r?.day) === now.day);
      if (!row || row.enabled === false) return false;
      const start = this.hhmmToMin(row.start, 0);
      const end = this.hhmmToMin(row.end, 24 * 60);
      // An overnight window (e.g. 18:00 → 09:00) wraps past midnight.
      return end > start ? now.minutes >= start && now.minutes < end : now.minutes >= start || now.minutes < end;
    }

    // business_hours / after_hours follow the salon's real opening hours + days off.
    const rules = await this.settings.getBookingRules(tenantId);
    const h = rules.businessHours?.[now.day];
    let open = !!h && !h.closed && now.minutes >= h.openMinutes && now.minutes < h.closeMinutes;
    if (open && Array.isArray(rules.daysOff) && rules.daysOff.length) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (rules.daysOff.includes(today)) open = false; // holiday → treated as closed
    }
    return sched === 'business_hours' ? open : !open;
  }

  /** Ring the salon's own phones. When nobody picks up (or the line is busy /
   *  declined) Twilio calls `action`, where we decide: AI, voicemail, or bye. */
  private dialHumans(nums: string[], line: { ringSeconds: number; lumioNumber: string | null }): string {
    const timeout = Math.min(60, Math.max(5, Number(line.ringSeconds) || 20));
    const action = `${this.apiBase()}/api/voice/after-dial`;
    const callerId = toE164(line.lumioNumber);
    const cid = callerId ? ` callerId="${xml(callerId)}"` : '';
    const list = nums.map((n) => `<Number>${xml(n)}</Number>`).join('');
    return this.twiml(
      `<Dial timeout="${timeout}" answerOnBridge="true"${cid} action="${action}" method="POST">${list}</Dial>`,
    );
  }

  /**
   * The caller asked the assistant for a person: speak the hand-off line,
   * then ring the salon's own phones with the caller still on the line.
   * However the ringing ends, Twilio comes back to /voice/after-transfer.
   */
  private transferTwiml(
    say: string, nums: string[], line: { ringSeconds: number; lumioNumber: string | null },
    language: string, voice: string | null, lg: string | null,
  ): string {
    const v = voiceFor(language, voice);
    const langAttr = v.sayLanguage ? ` language="${xml(v.sayLanguage)}"` : '';
    const timeout = Math.min(60, Math.max(10, Number(line.ringSeconds) || 20));
    const action = `${this.apiBase()}/api/voice/after-transfer${lg ? `?lg=${encodeURIComponent(lg)}` : ''}`;
    const callerId = toE164(line.lumioNumber);
    const cid = callerId ? ` callerId="${xml(callerId)}"` : '';
    const list = nums.map((n) => `<Number>${xml(n)}</Number>`).join('');
    return this.twiml(
      `<Say${this.sayAttr(v.voice)}${langAttr}>${xml(say)}</Say>` +
      `<Dial timeout="${timeout}" answerOnBridge="true"${cid} action="${xml(action)}" method="POST">${list}</Dial>`,
    );
  }

  /**
   * The hand-off's ringing is over.
   *   answered → a person has the caller: the call is theirs, we hang up our leg.
   *   no answer / busy / failed → the assistant comes back, apologises, says the
   *   salon will call back (and texts the salon so it does), and keeps helping —
   *   a caller who asked for help is never left on dead air or hung up on.
   */
  async handleAfterTransfer(body: Record<string, string>, lgParam?: string): Promise<string> {
    const callSid = String(body.CallSid || '');
    const status = String(body.DialCallStatus || '').toLowerCase();
    const call = callSid ? await this.prisma.voiceCall.findUnique({ where: { callSid } }).catch(() => null) : null;
    const line = call ? await this.prisma.voiceLine.findUnique({ where: { tenantId: call.tenantId } }).catch(() => null) : null;
    if (!call || !line) return this.twiml('<Hangup/>');

    if (status === 'completed' || status === 'answered') {
      await this.prisma.voiceCall.updateMany({ where: { callSid, tenantId: call.tenantId }, data: { outcome: 'transferred' } }).catch(() => undefined);
      return this.twiml('<Hangup/>');
    }

    const savedLang = (call as unknown as { language?: string | null }).language || lgParam || null;
    const lang = effectiveLang(line.language, savedLang);
    const lgFlag = isBilingual(line.language) ? lang : null;
    const lines = transferLines(lang);

    // Remember on the call that the hand-off was tried, so the assistant takes
    // a message next instead of offering to transfer again.
    const history = (Array.isArray(call.transcript) ? call.transcript : []) as Turn[];
    const last = history[history.length - 1];
    const next: Turn[] = last && last.role === 'assistant'
      ? [...history.slice(0, -1), { ...last, content: `${last.content} ${lines.missed}`, meta: 'transfer_missed' }]
      : [...history, { role: 'assistant', content: lines.missed, meta: 'transfer_missed' }];
    await this.prisma.voiceCall.update({
      where: { id: call.id },
      data: { outcome: 'transfer_missed', transcript: next as unknown as Prisma.InputJsonValue },
    }).catch(() => undefined);

    // Text the salon so the promised call-back actually happens.
    try {
      const n = await this.settings.getNotificationSettings(call.tenantId);
      const { dial } = await this.localeInfo(call.tenantId);
      const to = toE164(line.voicemailSms || n.adminPhone || '', dial);
      if (to) {
        const ownerLines = transferLines(String(line.language || '').startsWith('vi') || isBilingual(line.language) ? 'vi-VN' : 'en-US');
        await this.notifications.send({
          tenantId: call.tenantId,
          channel: NotificationChannel.SMS,
          recipient: to,
          body: ownerLines.ownerSms(call.fromNumber || 'unknown'),
          twilio: n.twilio,
          relatedType: 'voice',
        });
      }
    } catch { /* a failed alert must never break the call */ }

    return this.sayGather(lines.missed, 0, lang, line.voice || null, lgFlag);
  }

  /** Nobody is going to answer: leave a voicemail, play a notice, or hang up. */
  private noAnswerTwiml(
    line: { noAnswerAction: string; awayMessage: string | null; voice: string | null; language: string },
    salonName: string,
  ): string {
    const voice = line.voice || null;
    const act = String(line.noAnswerAction || 'voicemail');
    const msg = (line.awayMessage && line.awayMessage.trim())
      || `Thanks for calling ${salonName}. We can't take your call right now.`;
    if (act === 'hangup') return this.sayHangup(msg, voice);
    if (act === 'message') {
      return this.sayHangup(`${msg} Please call back during our business hours. Goodbye.`, voice);
    }
    // voicemail (default)
    const action = `${this.apiBase()}/api/voice/voicemail`;
    return this.twiml(
      `<Say${this.sayAttr(voice)}>${xml(msg)} Please leave your name, number and message after the beep, and we'll call you right back.</Say>` +
      `<Record maxLength="120" playBeep="true" trim="trim-silence" timeout="4" action="${action}" method="POST"/>` +
      `<Say${this.sayAttr(voice)}>We didn't get a message. Goodbye.</Say><Hangup/>`,
    );
  }

  // ---- inbound call (Twilio webhook) --------------------------------------
  /** First webhook when a forwarded call reaches the salon's Lumio number. */
  async handleIncoming(body: Record<string, string>): Promise<string> {
    const to = normNum(body.To);
    const from = normNum(body.From);
    const callSid = String(body.CallSid || '');
    const line = to ? await this.prisma.voiceLine.findFirst({ where: { lumioNumber: to } }) : null;
    if (!line) {
      return this.sayHangup('Sorry, we are not able to take this call right now. Please try again later. Goodbye.', null);
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

    const { dial } = await this.localeInfo(line.tenantId);
    const humans = this.humanNumbers(line, dial);
    const mode = String(line.mode || 'ai');

    // "forward" = never let the AI speak: ring the humans, then voicemail/notice.
    if (mode === 'forward') {
      return humans.length ? this.dialHumans(humans, line) : this.noAnswerTwiml(line, salonName);
    }

    // "ring_first" = Lumio rings the salon's own phones FIRST. Rings and busy are
    // decided here, not by the carrier, so the salon gets exactly what it set.
    // The AI (or voicemail) only takes over from /voice/after-dial.
    if (mode === 'ring_first' && humans.length) {
      return this.dialHumans(humans, line);
    }

    // "ai" (or ring_first with nobody to ring): the assistant answers now — if it
    // is allowed to at this moment.
    return this.aiOrNoAnswer(line, salonName);
  }

  /** Start the AI conversation when it's allowed to answer; otherwise fall back
   *  to voicemail / a notice. One place, so every path obeys the same rules. */
  private async aiOrNoAnswer(
    line: {
      tenantId: string; enabled: boolean; hardCap: boolean; includedMinutes: number; schedule: string;
      customHours: unknown; greeting: string | null; language: string; voice: string | null;
      noAnswerAction: string; awayMessage: string | null;
    },
    salonName: string,
  ): Promise<string> {
    if (!line.enabled) return this.noAnswerTwiml(line, salonName);

    // Outside the salon's chosen AI hours → the AI stays silent.
    const open = await this.aiWindowOpen(line, line.tenantId);
    if (!open) return this.noAnswerTwiml(line, salonName);

    // Hard cap: stop taking NEW AI calls once over the included minutes (a call
    // already in progress is never cut off). Overage is still recorded otherwise.
    if (line.hardCap && line.includedMinutes > 0) {
      const u = await this.usageForTenant(line.tenantId);
      if (u.aiMinutes >= line.includedMinutes) return this.noAnswerTwiml(line, salonName);
    }

    // Bilingual line: ask the caller which language FIRST — recognition is
    // locked per turn, so the choice must come before any real listening.
    // (The menu itself already discloses the automated assistant.)
    if (isBilingual(line.language)) return this.langMenuTwiml(salonName, 0);

    // ALWAYS disclose the automated assistant up front (CA/TX AI-disclosure laws).
    const lang = line.language || 'en-US';
    const canned = cannedLines(lang);
    const disclosure = canned.disclosure(salonName);
    const greeting = (line.greeting && line.greeting.trim()) || canned.defaultGreeting;
    return this.sayGather(`${disclosure} ${greeting}`, 0, lang, line.voice || null);
  }

  /**
   * Twilio calls this when the <Dial> to the salon's own phones finishes.
   *   completed → a human took the call: we're done.
   *   no-answer / busy / failed / canceled → hand over to the AI (if it may
   *   answer now), else voicemail / notice.
   */
  async handleAfterDial(body: Record<string, string>): Promise<string> {
    const callSid = String(body.CallSid || '');
    const status = String(body.DialCallStatus || '').toLowerCase();
    const to = normNum(body.To);
    const line = to ? await this.prisma.voiceLine.findFirst({ where: { lumioNumber: to } }) : null;
    if (!line) return this.twiml('<Hangup/>');

    if (status === 'completed' || status === 'answered') {
      if (callSid) {
        await this.prisma.voiceCall
          .updateMany({ where: { callSid }, data: { outcome: 'forwarded' } })
          .catch(() => undefined);
      }
      return this.twiml('<Hangup/>'); // a human handled it
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: line.tenantId }, select: { name: true } });
    const salonName = tenant?.name || 'our salon';

    // "Ring people only" means exactly that: nobody picked up → voicemail/notice,
    // never the assistant.
    if (String(line.mode || 'ai') === 'forward') return this.noAnswerTwiml(line, salonName);

    return this.aiOrNoAnswer(line, salonName);
  }

  /** Twilio posts the finished voicemail recording here. Save it and text the salon. */
  async handleVoicemail(body: Record<string, string>): Promise<string> {
    const callSid = String(body.CallSid || '');
    const url = String(body.RecordingUrl || '');
    const from = normNum(body.From);
    const to = normNum(body.To);
    const line = to ? await this.prisma.voiceLine.findFirst({ where: { lumioNumber: to } }) : null;

    if (line && url) {
      if (callSid) {
        await this.prisma.voiceCall
          .updateMany({ where: { callSid }, data: { outcome: 'voicemail', recordingUrl: `${url}.mp3` } })
          .catch(() => undefined);
      }
      // Text whoever the salon nominated (falls back to the admin phone).
      try {
        const n = await this.settings.getNotificationSettings(line.tenantId);
        const { dial: vmDial } = await this.localeInfo(line.tenantId);
        const to2 = toE164(line.voicemailSms || n.adminPhone || '', vmDial);
        if (to2) {
          await this.notifications.send({
            tenantId: line.tenantId,
            channel: NotificationChannel.SMS,
            recipient: to2,
            body: `New voicemail from ${from || 'a caller'}: ${url}.mp3`,
            twilio: n.twilio,
            relatedType: 'voice',
          });
        }
      } catch { /* a failed alert must never break the call */ }
    }
    return this.twiml(`<Say${this.sayAttr(line?.voice || null)}>Thank you. We got your message and will call you back shortly. Goodbye.</Say><Hangup/>`);
  }

  /** The caller answered the bilingual menu (digits or speech). */
  async handleLang(body: Record<string, string>, missParam: string): Promise<string> {
    const callSid = String(body.CallSid || '');
    const miss = Number(missParam || '0') || 0;
    const call = callSid ? await this.prisma.voiceCall.findUnique({ where: { callSid } }).catch((e: unknown) => { this.logger.error(`lang read failed: ${String(e).slice(0, 160)}`); return null; }) : null;
    const line = call ? await this.prisma.voiceLine.findUnique({ where: { tenantId: call.tenantId } }).catch(() => null) : null;
    if (!call || !line) return this.sayHangup('Sorry, something went wrong on our end. Please call again. Goodbye.', null);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: call.tenantId }, select: { name: true } }).catch(() => null);
    const salonName = tenant?.name || 'our salon';

    this.logger.log(`voice lang-menu answer digits='${String(body.Digits || '')}' speech='${String(body.SpeechResult || '').slice(0, 40)}' miss=${miss}`);
    let choice = parseLangChoice(body.Digits, body.SpeechResult);
    // No keypress yet → replay, at most twice, with the retry count IN the
    // URL (both action and redirect) so a talkative line can never loop the
    // menu forever. Still nothing → English, and the mid-call
    // switch_language tool remains the safety net for Vietnamese callers.
    if (!choice && miss < 2) return this.langMenuTwiml(salonName, miss + 1);
    if (!choice) choice = 'en-US';

    this.logger.log(`voice lang chosen ${choice}`);
    await this.prisma.voiceCall.update({ where: { id: call.id }, data: { language: choice } as never }).catch(() => undefined);
    const canned = cannedLines(choice);
    // The configured greeting is written in ONE language (usually English).
    // A caller who just chose Vietnamese must not be greeted with it — that
    // reads as "pressed 2, still got English". Vietnamese gets the canned
    // Vietnamese opening; English keeps the salon's own wording.
    const greeting = choice === 'vi-VN' ? canned.defaultGreeting : ((line.greeting && line.greeting.trim()) || canned.defaultGreeting);
    // The menu already disclosed the assistant in English; repeat the
    // disclosure in Vietnamese for callers who picked Vietnamese.
    const open = choice === 'vi-VN' ? `${canned.disclosure(salonName)} ${greeting}` : greeting;
    return this.sayGather(open, 0, choice, line.voice || null, choice);
  }

  /** Each subsequent turn: caller's transcribed speech arrives in SpeechResult. */
  async handleTurn(body: Record<string, string>, missParam: string, lgParam?: string): Promise<string> {
    const callSid = String(body.CallSid || '');
    const speech = String(body.SpeechResult || '').trim();
    const miss = Number(missParam || '0') || 0;

    const call = callSid ? await this.prisma.voiceCall.findUnique({ where: { callSid } }).catch((e: unknown) => { this.logger.error(`turn read failed: ${String(e).slice(0, 160)}`); return null; }) : null;
    const line = call ? await this.prisma.voiceLine.findUnique({ where: { tenantId: call.tenantId } }).catch(() => null) : null;
    if (!call || !line) {
      return this.sayHangup('Sorry, something went wrong on our end. Please call again. Goodbye.', null);
    }
    const savedLang = (call as unknown as { language?: string | null }).language || lgParam || null;
    const biline = isBilingual(line.language);
    let lang = effectiveLang(line.language, savedLang);
    let lgFlag = biline ? lang : null;
    const voice = line.voice || null;
    let canned = cannedLines(lang);

    // No speech captured → reprompt a couple of times, then bow out gracefully.
    if (!speech) {
      if (miss >= MAX_SILENCE) {
        await this.finalize(call.id, 'no_action', null);
        return this.sayHangup(canned.lostYou, voice, lang);
      }
      return this.sayGather(canned.didntCatch, miss, lang, voice, lgFlag);
    }

    const history = (Array.isArray(call.transcript) ? call.transcript : []) as Turn[];
    const t0 = Date.now();
    // A real person to hand the caller to: the salon's own numbers, once per
    // call (a second "please hold" after nobody answered the first is worse
    // than taking a message).
    const { dial: lineDial } = await this.localeInfo(call.tenantId);
    const humans = String(line.mode || 'ai') === 'forward' ? [] : this.transferTargets(line as unknown as { transferNumber?: string | null; forwardNumbers: string | null; lumioNumber: string | null }, lineDial);
    const canTransfer = humans.length > 0 && !history.some((h) => h.meta === 'transfer_missed');

    // Everything after "we have their words" — brain, transcript, next TwiML —
    // runs here, once, whether it finishes inside the fast window or is
    // collected later by /turn-result.
    const work = (async (): Promise<string> => {
      let result: { reply: string; done: boolean; booked: boolean; appointmentId: string | null; langSwitch?: string | null; transfer?: boolean };
      let lang2 = lang; let lgFlag2 = lgFlag; let canned2 = canned;
      // What this call has already booked, so a repeated or late turn never books twice.
      const alreadyBooked = call.outcome === 'booked' && call.appointmentId ? String(call.appointmentId) : null;
      const agentRun = this.runAgent(call.tenantId, call.fromNumber || '', line.aiInstruction || '', history, speech, lang2, biline, canTransfer, alreadyBooked);
      agentRun.catch(() => undefined);
      try {
        // Twilio abandons a webhook after ~15 seconds and HANGS UP — the caller
        // hears dead air, then nothing. Past the deadline we ask them to repeat
        // themselves and the CALL SURVIVES. A phone conversation that dies is
        // worse than one that says "sorry, once more?".
        result = await Promise.race([
          agentRun,
          new Promise<never>((_, rej) => { const tm = setTimeout(() => rej(new Error('turn-deadline')), TURN_DEADLINE_MS); (tm as { unref?: () => void }).unref?.(); }),
        ]);
      } catch (e) {
        const msg = String(e);
        this.logger.warn(`agent error after ${Date.now() - t0}ms: ${msg.slice(0, 160)}`);
        // Past the deadline the brain is still WORKING — and may be halfway
        // through writing a booking. Its answer used to be thrown away: the
        // caller heard "sorry, once more?", the booking existed, and the next
        // turn had no idea, so it asked for everything again. Keep it.
        if (msg.includes('turn-deadline')) this.keepLateAnswer(call.id, speech, agentRun);
        // ANY failure — deadline, model abort, tool crash — gets a polite
        // "say that again?" and the call stays ALIVE. Goodbye is only earned by
        // three failures in one call; one bad moment must not end a customer
        // conversation in the wrong language ("Sorry… Goodbye" to a vi caller).
        const fails = (this.turnFails.get(callSid) || 0) + 1;
        if (this.turnFails.size > 500) this.turnFails.clear();
        this.turnFails.set(callSid, fails);
        if (fails < 3) return this.sayGather(canned2.slowRetry, 0, lang2, voice, lgFlag2);
        this.turnFails.delete(callSid);
        await this.finalize(call.id, 'error', null);
        return this.sayHangup(canned2.trouble, voice, lang2);
      }
      this.turnFails.delete(callSid);
      // The agent may have DETECTED the caller's language mid-conversation (the
      // menu's keypress can get lost on some carriers — this is the escape
      // hatch). Speak this very reply, and listen from now on, in the new one.
      if (biline && result.langSwitch && result.langSwitch !== lang2) {
        lang2 = result.langSwitch;
        lgFlag2 = lang2;
        canned2 = cannedLines(lang2);
        await this.prisma.voiceCall.update({ where: { id: call.id }, data: { language: lang2 } as never }).catch(() => undefined);
        this.logger.log(`voice lang switched mid-call → ${lang2}`);
      }
      this.logger.log(`voice turn ${Date.now() - t0}ms lang=${lang2}`);

      const nextHistory = [...history, { role: 'user', content: speech }, { role: 'assistant', content: result.reply }].slice(-MAX_TURNS);
      await this.prisma.voiceCall.update({
        where: { id: call.id },
        data: {
          transcript: nextHistory as unknown as Prisma.InputJsonValue,
          ...(result.booked ? { outcome: 'booked', appointmentId: result.appointmentId } : {}),
        },
      }).catch(() => undefined);

      // The caller asked for a person: say so, then ring the salon's phones
      // with the caller still on the line. The AI's share of the call is
      // stamped now — the minutes a human talks are never billed as AI.
      if (result.transfer && canTransfer) {
        const aiSec = Math.max(1, Math.round((Date.now() - new Date((call as unknown as { createdAt?: Date }).createdAt ?? Date.now()).getTime()) / 1000));
        await this.prisma.voiceCall.update({
          where: { id: call.id },
          data: { outcome: 'transferring', durationSec: aiSec },
        }).catch(() => undefined);
        const say = result.reply || transferLines(lang2).connecting;
        return this.transferTwiml(say, humans, line, lang2, voice, lgFlag2);
      }

      if (result.done) {
        if (!result.booked) await this.finalize(call.id, call.outcome === 'booked' ? 'booked' : 'info', null);
        return this.sayHangup(result.reply, voice, lang2);
      }
      return this.sayGather(result.reply, 0, lang2, voice, lgFlag2);
    })();
    // Never let a rejection go unobserved: the result endpoint (or nobody)
    // reads it later, and the function above already answers every error.
    work.catch(() => undefined);

    // Fast enough → the answer itself. Otherwise a filler now, the answer next.
    const quick = await Promise.race([
      work,
      new Promise<null>((res) => { const tm = setTimeout(() => res(null), FAST_REPLY_MS); (tm as { unref?: () => void }).unref?.(); }),
    ]);
    if (quick) return quick;

    const id = `${callSid}-${t0.toString(36)}`;
    if (this.pendingTurns.size > 500) this.sweepPending(true);
    this.pendingTurns.set(id, { promise: work, at: Date.now() });
    const filler = canned.thinking[Math.floor(Math.random() * canned.thinking.length)];
    this.logger.log(`voice turn filler after ${Date.now() - t0}ms`);
    return this.fillerRedirect(filler, id, lang, voice, lgFlag);
  }

  /** Twilio comes back here after the filler for the answer the brain owes. */
  async handleTurnResult(body: Record<string, string>, id: string, lgParam?: string): Promise<string> {
    const callSid = String(body.CallSid || '');
    const pending = this.pendingTurns.get(id);
    this.pendingTurns.delete(id);
    this.sweepPending(false);
    const call = callSid ? await this.prisma.voiceCall.findUnique({ where: { callSid } }).catch(() => null) : null;
    const line = call ? await this.prisma.voiceLine.findUnique({ where: { tenantId: call.tenantId } }).catch(() => null) : null;
    const savedLang = (call as unknown as { language?: string | null } | null)?.language || lgParam || null;
    const lang = line ? effectiveLang(line.language, savedLang) : (lgParam || 'en-US');
    const lgFlag = line && isBilingual(line.language) ? lang : null;
    const voice = line?.voice || null;
    const canned = cannedLines(lang);
    // Unknown id: the process restarted between filler and result (Render
    // deploy mid-call), or Twilio replayed the request. Ask again; the call lives.
    if (!pending) return this.sayGather(canned.slowRetry, 0, lang, voice, lgFlag);
    try {
      return await Promise.race([
        pending.promise,
        new Promise<never>((_, rej) => { const tm = setTimeout(() => rej(new Error('result-wait')), RESULT_WAIT_MS); (tm as { unref?: () => void }).unref?.(); }),
      ]);
    } catch {
      return this.sayGather(canned.slowRetry, 0, lang, voice, lgFlag);
    }
  }

  /**
   * A turn that finished after the caller was already asked to repeat: write
   * what it did into the call, so the next turn knows. The caller never heard
   * the reply, and the model is told so — it says it again instead of
   * assuming they know.
   */
  private keepLateAnswer(callId: string, speech: string, run: Promise<{ reply: string; booked: boolean; appointmentId: string | null }>): void {
    run.then(async (r) => {
      const fresh = await this.prisma.voiceCall.findUnique({ where: { id: callId } });
      const prior = (Array.isArray(fresh?.transcript) ? fresh!.transcript : []) as Turn[];
      const turns = [...prior, { role: 'user', content: speech }, { role: 'assistant', content: `(The line was slow, so the caller did NOT hear this reply — say what matters again:) ${r.reply}` }].slice(-MAX_TURNS);
      await this.prisma.voiceCall.update({
        where: { id: callId },
        data: {
          transcript: turns as unknown as Prisma.InputJsonValue,
          ...(r.booked ? { outcome: 'booked', appointmentId: r.appointmentId } : {}),
        },
      });
    }).catch(() => undefined);
  }

  private sweepPending(force: boolean): void {
    const now = Date.now();
    for (const [k, v] of this.pendingTurns) {
      if (force || now - v.at > PENDING_TTL_MS) this.pendingTurns.delete(k);
    }
  }

  /** "One moment" + a redirect to where the real answer will be. No <Gather>:
   *  the caller is not being asked anything yet. */
  private fillerRedirect(text: string, id: string, language: string, voice: string | null, lg: string | null): string {
    const lgQ = lg ? `&lg=${encodeURIComponent(lg)}` : '';
    const next = `${this.apiBase()}/api/voice/turn-result?id=${encodeURIComponent(id)}${lgQ}`;
    const v = voiceFor(language, voice);
    const langAttr = v.sayLanguage ? ` language="${xml(v.sayLanguage)}"` : '';
    return this.twiml(
      `<Say${this.sayAttr(v.voice)}${langAttr}>${xml(text)}</Say>` +
      `<Redirect method="POST">${xml(next)}</Redirect>`,
    );
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
    // A call handed to a person keeps the AI's share stamped at the hand-off;
    // the whole call's length would bill the salon's own staff time as AI.
    await this.prisma.voiceCall.updateMany({ where: { callSid, outcome: { notIn: ['transferred', 'transferring'] } }, data: { durationSec: dur } }).catch(() => undefined);
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
    // Same convention as `since` (UTC month), or the window's far edge lands
    // hours inside the neighbouring month and the last evening's minutes and
    // SMS fall out of the invoice entirely.
    const until = monthStart ? new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1)) : null;
    const callWindow = until ? { gte: since, lt: until } : { gte: since };
    const [calls, line] = await Promise.all([
      this.prisma.voiceCall.findMany({
        // Calls a HUMAN picked up (mode "ring first") are not AI usage — the salon
        // must never be billed AI minutes for calls its own staff answered.
        where: { tenantId, createdAt: callWindow, outcome: { not: 'forwarded' } },
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
    tenantId: string, callerPhone: string, aiInstruction: string, history: Turn[], userText: string, lang = 'en-US', bilingual = false, canTransfer = false,
    alreadyBooked: string | null = null,
  ): Promise<{ reply: string; done: boolean; booked: boolean; appointmentId: string | null; langSwitch?: string | null; transfer?: boolean }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    const acc = { wantEnd: false, booked: false, appointmentId: null as string | null, langSwitch: null as string | null, transfer: false };
    if (!key) {
      this.logger.error('ANTHROPIC_API_KEY is not set on this service — the voice agent cannot think. Every call will fail until it is added.');
      throw new Error('no-anthropic-key');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { name: true, timezone: true, contactPhone: true, contactEmail: true, businessType: true },
    });
    // The AI's identity, goal and vocabulary follow the tenant's line of
    // business — a real-estate caller must never be offered a gel set, and a
    // coffee shop must not open by offering a table reservation. The declared
    // trade refines the type where it has something to say; where it does not,
    // the type answers alone and nothing changes.
    const [tradeRow, industryRow] = await Promise.all([
      this.prisma.setting
        .findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } })
        .catch(() => null),
      // The industry the owner CHOSE (Mi, Tóc, Spa, Nha khoa…) — names the business correctly.
      this.prisma.setting
        .findFirst({ where: { tenantId, key: 'industry' }, select: { value: true } })
        .catch(() => null),
    ]);
    const persona = personaFor(
      (tenant as unknown as { businessType?: string } | null)?.businessType,
      (tradeRow?.value as { trade?: string } | null)?.trade ?? null,
      chosenIndustry(industryRow?.value),
    );
    const salonName = tenant?.name || 'our salon';
    const tz = tenant?.timezone || 'America/New_York';
    const infoBlock = await this.salonInfoBlock(tenantId, tenant?.contactPhone ?? null, tenant?.contactEmail ?? null);
    const facts = await this.factsFor(tenantId);
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // The owner's own instructions used to be appended to the FAQ facts as
    // "notes" at the very end of the prompt, where the step-by-step booking
    // script above outweighed them: a salon wrote "when they want a full set,
    // say acrylic full set is $60 and up and ask design or solid color" and
    // the assistant never asked. They are now a named block the model is told
    // to follow on every call — still one question per turn, and still never
    // a price or service the salon did not give.
    // The salon's shared rules (every AI door) come first, the hotline's own
    // extras after — both are the owner's words, both are followed.
    let shared = '';
    try { shared = (await this.settings.getAiNotes(tenantId))?.text ?? ''; } catch { shared = ''; }
    const ownerNote = [shared, String(aiInstruction ?? '').trim()].filter(Boolean).join('\n').slice(0, 4000);
    const ownerRules = ownerNote
      ? `\nTHE ${persona.venueNoun.toUpperCase()} OWNER'S INSTRUCTIONS — follow these on every call. They are this ${persona.venueNoun}'s own rules: when one says to quote a price a certain way or to ask a question for a certain service, do exactly that at that point in the booking steps (one question per turn), in the caller's language:\n${ownerNote}\n`
      : '';

    // The whole menu, once per turn, in one stable order. Every item gets a
    // short code (S1, S2…) the model passes to the tools: it used to copy a
    // 25-character database id out of the prompt, and one wrong character was
    // "Service not found" read aloud to a customer who had just said yes.
    const menuRows = await this.prisma.service.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, priceCents: true, durationMinutes: true, currency: true, priceFrom: true },
      orderBy: { name: 'asc' }, take: 250,
    });
    const menu: MenuItem[] = menuRows.map((s) => ({ id: s.id, name: s.name, minutes: s.durationMinutes > 0 ? s.durationMinutes : 30 }));
    // Prices are read ALOUD, so they are formatted in the salon's own money —
    // the old "$" + divide-by-100 read a 200,000₫ service as "two thousand
    // dollars". Only the first forty are written into the prompt; a longer
    // menu is searched with get_services, so the assistant never books "the
    // nearest thing it can see".
    const { locale: menuLocale } = await this.localeInfo(tenantId);
    const shown = menuRows.slice(0, 40);
    const servicesBlock = shown.length
      ? 'Menu (pass the code, e.g. S3, to the tools; never say a code out loud):\n' +
        shown.map((s, i) => `- ${serviceCode(i)} ${s.name} — ${formatMoneyShort(s.priceCents, (s as { currency?: string }).currency ?? 'USD', menuLocale)}${(s as { priceFrom?: boolean }).priceFrom ? ' and up (a starting price — say it that way)' : ''}${s.durationMinutes ? `, ${s.durationMinutes} min` : ''}`).join('\n') +
        (menuRows.length > shown.length ? `\n(Only ${shown.length} of this ${persona.venueNoun}'s ${menuRows.length} services are listed here. If the caller asks for something not on this list, call get_services and search the full menu before saying anything about it.)` : '')
      : 'No services are configured yet; take a message and tell them someone will call back.';

    // Group-aware booking is for businesses that book PEOPLE onto STAFF —
    // salons and appointment businesses. A restaurant's party is one table,
    // and keeps its own single-reservation flow.
    const bizType = String((tenant as unknown as { businessType?: string } | null)?.businessType ?? 'SALON').toUpperCase();
    const groupMode = bizType === 'SALON' || bizType === 'SERVICE';
    // Best-effort: a missing team list only loses "ask for Kim", never the call.
    const staff = groupMode
      ? await Promise.resolve()
          .then(() => this.prisma.staffMember.findMany({
            where: { tenantId, isActive: true, takesAppointments: true },
            select: { id: true, firstName: true, lastName: true },
            orderBy: { firstName: 'asc' }, take: 60,
          }))
          .catch(() => [] as { id: string; firstName: string; lastName: string | null }[])
      : [];
    const ctx: ToolCtx = { menu, staff, groupMode };

    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    // HOW IT SOUNDS. Owners reported a hotline that "talks too long and never
    // books": every reply carried a compliment, a restatement of what the
    // caller had just said and a question. A receptionist says one thing.
    const style = `Your words are read aloud on a live phone call. Keep EVERY reply short: one sentence, two at most, under 30 words, and ask only ONE thing at a time. Do not repeat back what the caller just said (the only read-back is the final one before booking), do not list the menu unless asked, and never explain what you are doing. One brief warm touch is fine ("Sure!", "Of course."); no long thank-yous. No lists, emojis, special characters or URLs.
The call has already been answered with the ${persona.venueNoun}'s greeting — do not greet again; go straight to helping. If the caller is not ready to book ("just asking", "I'll call back"), answer their question, say they are welcome to call any time, and do not push. Quote a price in one short sentence; never walk through arithmetic unless they ask for a total. Thank the caller when the booking is made, and thank them for calling in the goodbye.`;
    const groupScript = `BOOKING A NEW ${persona.bookableNoun.toUpperCase()} — collect only what is still missing; when the caller gives several details at once, take them all and move on:
- WHO and WHAT: the service or services for each person. One person can have several services ("gel manicure and a pedicure"). A group is several people at the SAME time, each with their own technician. If the caller says "we", "us", "my friend", "my mom and I" or a number of people, find out how many people and what each person wants; otherwise it is just the caller — do not ask how many. If their words could mean more than one menu item (e.g. "manicure" when the menu has a regular and a gel manicure), ask which one; never choose for them. If something is not on the menu, call get_services before saying so.
- WHEN: the day and time. As soon as you know everyone's services and the day or time, call check_availability. Only offer times it says are open; if theirs is taken, offer the times it gives you.
- NAMES: the first name of each person, asked once for everybody ("And the first names for each of you?"). Never invent, guess or reuse a name. Do not ask the caller to read out a phone number — it is confirmed in the read-back below.
- TECHNICIAN: only if the caller asks for someone by name, pass that name; otherwise anyone is fine — do not ask.
- REQUESTS: if they mention anything the salon should know (an allergy, a design, being late), pass it in create_booking's "request" — do not ask for it.
- CONFIRM: read everything back in ONE sentence INCLUDING the last four digits of the phone number, and wait for a clear yes, e.g. "So Anna for a gel manicure and pedicure and Lisa for a pedicure, Saturday October 10 at 2 PM, under the number ending in 0, 1, 4, 7 — is that right?" If they give a different number, pass it as customerPhone and read back once more with ITS last four digits.
- BOOK: after the yes, call create_booking ONCE with everyone in it and phoneConfirmed: true. Then say in one short sentence that it is booked and a text confirmation is on the way, and ask if there is anything else.${staff.length ? `\nTechnicians here (first names): ${staff.map((s) => s.firstName).join(', ')}.` : ''}`;
    const singleScript = `${persona.voiceGoal}
BOOKING, STEP BY STEP — one question per turn, skipping anything the caller already said: (1) which service; if their words could mean more than one service on the menu, ask which one ("a regular manicure, or the gel manicure?") instead of choosing; if it is not on the menu, call get_services before you answer; (2) the day and time; (3) their first name — never invent or reuse a name; (4) read all of it back in ONE short sentence INCLUDING "under the number ending in" and the phone's last four digits, and wait for a clear yes — if they give a different number, pass it as customerPhone and read back once more with its last four digits; (5) only then call create_booking with the service's code and phoneConfirmed: true.`;
    const bookedNote = alreadyBooked ? '\nEarlier on this call a booking was already made. Do NOT book the same people again; for a change, use find_appointment and reschedule_appointment.' : '';
    const system = `You are the warm, professional phone receptionist for "${salonName}", ${persona.identity}. ${style}
${callerPhone && spokenLast4(callerPhone)
  ? `The caller is calling from ${callerPhone} (ending in ${spokenLast4(callerPhone)}). Do NOT ask them to read out a phone number. Instead, in the read-back before booking, say the booking will be "under the number ending in ${spokenLast4(callerPhone)}" so they can confirm it or give another. If they give another, take it as customerPhone; if it sounds incomplete, ask them to repeat it digit by digit. Always say the four digits one at a time.`
  : 'The caller\'s number is hidden. Before the read-back, ask for a good callback number, then include its last four digits (one at a time) in the read-back.'}
${groupMode ? groupScript : singleScript}${bookedNote}
Never book a service the caller has not named back to you, and never guess between two services — a wrong service means a chair, a technician and a price the ${persona.venueNoun} did not agree to. Do not hang up right after booking.
If the caller asks about a booking they already have ("when is my appointment", "can I move it"), call find_appointment first and read back what it returns — never answer from memory. To move it, call reschedule_appointment; that tool applies the ${persona.venueNoun}'s notice policy and hands you the reason when it refuses, so say THAT reason rather than inventing a policy.
Speak times naturally ("two thirty PM on Friday"). The ${persona.venueNoun}'s local time right now is ${nowLocal} (timezone ${tz}); interpret "today/tomorrow/this Friday" in that timezone.
Only state hours, prices, services, address and contact details that are given to you here — never invent them. Never book outside business hours.
When the conversation is finished — they've booked and have nothing else, or their question is answered, or they say goodbye — call end_call. ${canTransfer ? 'If the caller asks for a real person — a staff member, the owner, a manager, "someone at the ' + persona.venueNoun + '" — or is upset and wants a human, do not argue or keep them: say ONE short sentence that you are connecting them now (no goodbye), and call transfer_to_human. If they ask something you cannot answer from what you were given here (never guess), say you are not sure and offer to connect them to the front desk; if they say yes, call transfer_to_human.' : 'If the caller is upset or asks for a real person, tell them a staff member will call them back, then call end_call. If they ask something you cannot answer from what you were given here, never guess: say a staff member will call them back with the answer.'} Never ask for payment or card details.
${servicesBlock}
${infoBlock ? infoBlock + '\n' : ''}${facts ? cap(persona.venueNoun) + ' notes: ' + facts + '\n' : ''}${ownerRules}${agentLangRule(lang)}${bilingual ? '\nThis line serves BOTH English and Vietnamese callers. If the caller speaks Vietnamese, asks for Vietnamese, or their words look like mis-transcribed Vietnamese, call switch_language with vi-VN immediately and reply in Vietnamese from then on (switch back with en-US if they ask).' : ''}`;

    const personItem = (withName: boolean) => ({
      type: 'object',
      properties: {
        ...(withName ? { firstName: { type: 'string', description: 'This person’s first name, exactly as the caller said it.' } } : {}),
        services: { type: 'array', items: { type: 'string' }, description: 'Menu codes for this person, e.g. ["S3"] or ["S3","S8"] for two services.' },
        technician: { type: 'string', description: 'Only when the caller asked for a technician by name.' },
      },
      required: withName ? ['firstName', 'services'] : ['services'],
    });
    const bookingTools = groupMode
      ? [
          {
            name: 'check_availability',
            description: 'Look in the book before offering or confirming a time. Each person needs their own free technician at the same start time. Returns whether the asked time works for everyone and the nearest open times.',
            input_schema: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'The salon-local day, YYYY-MM-DD.' },
                time: { type: 'string', description: 'The salon-local start, HH:MM in 24-hour time. Leave out to hear the open times that day.' },
                people: { type: 'array', minItems: 1, maxItems: 8, items: personItem(false) },
              },
              required: ['date', 'people'],
            },
          },
          {
            name: 'create_booking',
            description: 'Book everyone at once — one entry per person, all at the same start time. Only after the caller said yes to the full read-back, including the phone number’s last four digits. Never call twice for the same people.',
            input_schema: {
              type: 'object',
              properties: {
                localDateTime: { type: 'string', description: 'Salon local start time in ISO form, e.g. 2026-07-10T14:00' },
                people: { type: 'array', minItems: 1, maxItems: 8, items: personItem(true) },
                customerPhone: { type: 'string', description: 'Optional. Defaults to the caller’s own number; only set if they give a different callback number.' },
                phoneConfirmed: { type: 'boolean', description: 'true ONLY after the caller said yes to a read-back that included the last four digits of the number this booking goes under.' },
                request: { type: 'string', description: 'Optional. Anything the caller asked the salon to know, in their words: an allergy, a design they want, "running 10 minutes late". Leave out if nothing.' },
              },
              required: ['localDateTime', 'people', 'phoneConfirmed'],
            },
          },
        ]
      : [
          {
            name: 'create_booking',
            description: 'Create the appointment. Only call after the caller has given their first name, named the service themselves, and said yes to the day, time, service and the phone number’s last four digits read back to them.',
            input_schema: {
              type: 'object',
              properties: {
                customerFirstName: { type: 'string' },
                serviceId: { type: 'string', description: 'The menu code, e.g. S3.' },
                localDateTime: { type: 'string', description: 'Salon local time in ISO form, e.g. 2026-07-10T14:00' },
                customerPhone: { type: 'string', description: 'Optional. Defaults to the caller’s own number; only set if they give a different callback number.' },
                phoneConfirmed: { type: 'boolean', description: 'true ONLY after the caller said yes to a read-back that included the last four digits of the number this booking goes under.' },
              },
              required: ['customerFirstName', 'serviceId', 'localDateTime', 'phoneConfirmed'],
            },
          },
        ];

    const tools = [
      {
        // The prompt carries the first forty services; a longer menu, or a
        // caller asking for something by another name, needs the whole list.
        // Without this the assistant could only pick from what it could see.
        name: 'get_services',
        description: 'Search the full service menu when the caller asks for something not in the list above, or when two services could match their words. Returns every active service with its code, name, price and length.',
        input_schema: { type: 'object', properties: {}, required: [] as string[] },
      },
      ...bookingTools,
      {
        name: 'find_appointment',
        description: 'Look up the caller’s upcoming appointments. Defaults to the number they are calling from. ALWAYS call this before saying anything about an existing booking — never answer from memory.',
        input_schema: {
          type: 'object',
          properties: {
            customerPhone: { type: 'string', description: 'Optional. Only set if they booked under a different number.' },
          },
          required: [],
        },
      },
      {
        name: 'reschedule_appointment',
        description: 'Move one of the caller’s appointments to a new time. The tool checks the salon’s notice policy, opening hours and the technician’s diary, and hands back the exact reason when it refuses.',
        input_schema: {
          type: 'object',
          properties: {
            appointmentId: { type: 'string', description: 'The id from find_appointment. Never guessed, never read aloud.' },
            localDateTime: { type: 'string', description: 'The NEW salon-local time in ISO form, e.g. 2026-07-10T14:00' },
            customerPhone: { type: 'string', description: 'Optional. Defaults to the number they are calling from.' },
          },
          required: ['appointmentId', 'localDateTime'],
        },
      },
      {
        name: 'cancel_appointment',
        description: 'Cancel one of the caller’s appointments. ONLY call this after the caller has clearly confirmed they want it cancelled — read the day and time back to them and get a yes first, because this empties the salon’s chair and cannot be undone from this call. The tool checks the salon’s notice policy and hands back the exact reason when it refuses.',
        input_schema: {
          type: 'object',
          properties: {
            appointmentId: { type: 'string', description: 'The id from find_appointment. Never guessed, never read aloud.' },
            customerPhone: { type: 'string', description: 'Optional. Defaults to the number they are calling from.' },
          },
          required: ['appointmentId'],
        },
      },
      {
        // Offered on EVERY line now, not only the bilingual ones. A line set
        // to Vietnamese answered an English-speaking caller in Vietnamese and
        // had no way out of it; a caller who plainly speaks the other language
        // is answered in that language from the next sentence on.
        name: 'switch_language',
        description: 'Switch this call to the given language when the caller speaks it or asks for it. All later replies MUST be in that language.',
        input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['vi-VN', 'en-US'] } }, required: ['language'] },
      },
      {
        name: 'end_call',
        description: 'End the phone call after saying goodbye. Call this when the caller is done (booked and nothing else, question answered, or they said goodbye).',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
      },
      // Only on a line that has people to hand the caller to (and has not
      // already tried and failed on this call).
      ...(canTransfer ? [{
        name: 'transfer_to_human',
        description: 'Connect the caller to a real staff member right now. Use when the caller asks for a person, the owner or a manager, or is upset and wants a human. Say one short sentence that you are connecting them (no goodbye) — the call is then put through to the salon’s phone.',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: [] as string[] },
      }] : []),
    ];

    // The model must see user/assistant turns alternating and starting with
    // the caller. A trimmed or patched transcript can break that (a late
    // answer, a hand-off note), and a malformed history is an API error —
    // which the caller hears as "sorry, once more?" on every turn after.
    const messages: { role: string; content: unknown }[] = [];
    for (const h of [...history.map((x) => ({ role: x.role, content: x.content })), { role: 'user' as const, content: userText }]) {
      if (!h.content) continue;
      if (!messages.length && h.role !== 'user') continue;
      const last = messages[messages.length - 1];
      if (last && last.role === h.role) last.content = `${String(last.content)}\n${h.content}`;
      else messages.push({ role: h.role, content: h.content });
    }

    let apiRetried = false;
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
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) {
        this.meter(tenantId, null, false);
        this.logger.warn(`Anthropic voice ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
        if (!apiRetried && isTransientStatus(res.status)) {
          apiRetried = true;
          await new Promise((r) => setTimeout(r, 1200));
          loop -= 1;
          continue;
        }
        throw new Error(`anthropic ${res.status}`);
      }
      const data = (await res.json()) as { stop_reason?: string; content?: AnthropicBlock[]; model?: string; usage?: Record<string, number> };
      this.meter(tenantId, data, true);
      const blocks = data.content || [];
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocks });
        const results: unknown[] = [];
        for (const blk of blocks) {
          if (blk.type !== 'tool_use') continue;
          const out = await this.runTool(tenantId, tz, callerPhone, blk.name || '', blk.input || {}, acc, ctx);
          results.push({ type: 'tool_result', tool_use_id: blk.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      if (acc.transfer) {
        return { reply: text || transferLines(acc.langSwitch || lang).connecting, done: true, transfer: true, booked: acc.booked, appointmentId: acc.appointmentId, langSwitch: acc.langSwitch };
      }
      return { reply: text || agentFallbackLines(acc.langSwitch || lang).keepGoing, done: acc.booked ? false : acc.wantEnd, booked: acc.booked, appointmentId: acc.appointmentId, langSwitch: acc.langSwitch };
    }
    return { reply: agentFallbackLines(acc.langSwitch || lang).handOff, done: true, booked: acc.booked, appointmentId: acc.appointmentId, langSwitch: acc.langSwitch };
  }

  private async runTool(
    tenantId: string, tz: string, callerPhone: string, name: string, input: Record<string, unknown>,
    acc: { wantEnd: boolean; booked: boolean; appointmentId: string | null; langSwitch?: string | null; transfer?: boolean },
    ctx: ToolCtx = { menu: [], staff: [], groupMode: false },
  ): Promise<string> {
    try {
      if (name === 'check_availability') return await this.toolCheckAvailability(tenantId, tz, input, ctx);
      if (name === 'create_booking' && ctx.groupMode) return await this.toolBookParty(tenantId, tz, callerPhone, input, acc, ctx);
      if (name === 'transfer_to_human') {
        acc.transfer = true;
        return 'TRANSFERRING. Say ONE short, warm sentence telling the caller you are connecting them to a team member now. Do not say goodbye and do not ask anything else.';
      }
      if (name === 'switch_language') {
        const lg = String(input.language || '');
        if (lg === 'vi-VN' || lg === 'en-US') { acc.langSwitch = lg; return `SWITCHED. Reply in ${lg === 'vi-VN' ? 'Vietnamese' : 'English'} from now on.`; }
        return 'ERROR: language must be vi-VN or en-US.';
      }
      if (name === 'get_services') {
        const services = await this.prisma.service.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true, priceCents: true, durationMinutes: true, currency: true, priceFrom: true },
          orderBy: { name: 'asc' }, take: 250,
        });
        if (!services.length) return 'No services are configured.';
        // Same order and codes as the menu in the prompt.
        const codeOf = (id: string) => { const i = ctx.menu.findIndex((m) => m.id === id); return i >= 0 ? serviceCode(i) : id; };
        // The "$" was hard-coded and the amount divided by 100, so the phone
        // assistant read a 200,000₫ service aloud as "two thousand dollars".
        // The take was also 40, which quietly hid the rest of a long menu —
        // the same cut that once made the bot say a service did not exist.
        const { locale: svcLocale } = await this.localeInfo(tenantId);
        return JSON.stringify(services.map((s) => ({ code: codeOf(s.id), name: s.name, price: formatMoneyShort(s.priceCents, s.currency, svcLocale) + ((s as { priceFrom?: boolean }).priceFrom ? ' and up' : ''), minutes: s.durationMinutes })));
      }
      if (name === 'create_booking') {
        const firstName = String(input.customerFirstName || '').trim();
        // A menu code ("S3") or, from an older prompt, the id itself.
        const ref = String(input.serviceId || '').trim();
        const serviceId = (ctx.menu.length ? resolveService(ref, ctx.menu)?.id : null) ?? ref;
        const local = String(input.localDateTime || '').trim();
        if (!firstName || !serviceId || !local) return 'Missing required info; ask the caller for what is missing.';
        // The number the caller gave, else the caller ID — and either way only
        // once the caller has heard its last four digits and said yes. A
        // garbled number is asked for again, never swapped for the caller ID.
        // See phone-readback.ts.
        const { dial: bkDial } = await this.localeInfo(tenantId);
        const pd = bookingPhone({ given: input.customerPhone, callerPhone, confirmed: input.phoneConfirmed, norm: (r) => toE164(r, bkDial) });
        if (!pd.ok) return pd.say;
        const phone = pd.phone;
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
        return `SUCCESS. The appointment is booked (id ${b.id}). Warmly confirm the service, day and time back to the caller and let them know a text confirmation is on the way. Do NOT end the call yet: after confirming, ask if there is anything else you can help with, and wait for their reply.`;
      }
      if (name === 'find_appointment') {
        const { dial } = await this.localeInfo(tenantId);
        const phone = toE164(String(input.customerPhone || ''), dial) || toE164(callerPhone, dial);
        if (!phone) return 'No phone number available; politely ask the caller for the number they booked with.';
        const rows = await this.bookings.upcomingForPhone(tenantId, phone);
        if (!rows.length) {
          return 'No upcoming appointment found for that number. Ask gently whether they booked under a different number; do NOT tell them they have no booking.';
        }
        const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', {
          timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(d);
        return JSON.stringify(rows.map((r) => ({
          appointmentId: r.id, service: r.service?.name ?? '', when: fmt(r.startTime),
        })));
      }

      if (name === 'reschedule_appointment') {
        const id = String(input.appointmentId || '').trim();
        const local = String(input.localDateTime || '').trim();
        const { dial: rDial } = await this.localeInfo(tenantId);
        const phone = toE164(String(input.customerPhone || ''), rDial) || toE164(callerPhone, rDial);
        if (!id || !local) return 'Missing the appointment or the new time; ask the caller for what is missing.';
        if (!phone) return 'No phone number available; ask the caller for the number they booked with.';
        const r = await this.bookings.selfReschedule({
          tenantId, appointmentId: id, phone, newStartIso: wallToUtcISO(local, tz), by: 'hotline',
        });
        if (!r.ok) {
          // Same rule, same sentence, as the Messenger bot. One policy with two
          // front doors must not develop two different explanations.
          return `REFUSED (${r.code}). Tell the caller this, warmly and in your own words, and offer to have a staff member call back — do not invent a different reason: ${r.say}`;
        }
        const when = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(r.startTime as Date);
        return `SUCCESS. The appointment now sits at ${when} and the salon calendar is already updated. Warmly repeat the new day and time back, say a text confirmation is on the way, then ask if there is anything else — do not end the call yet.`;
      }

      if (name === 'cancel_appointment') {
        const id = String(input.appointmentId || '').trim();
        const { dial: cDial } = await this.localeInfo(tenantId);
        const phone = toE164(String(input.customerPhone || ''), cDial) || toE164(callerPhone, cDial);
        if (!id) return 'Missing the appointment; use find_appointment first.';
        if (!phone) return 'No phone number available; ask the caller for the number they booked with.';
        const r = await this.bookings.selfCancel({ tenantId, appointmentId: id, phone, by: 'hotline' });
        if (!r.ok) {
          // Same rule, same sentence, as the Messenger bot — one policy with two
          // front doors must not develop two different explanations.
          return `REFUSED (${r.code}). Tell the caller this, warmly and in your own words, and offer to have a staff member call back — do not invent a different reason: ${r.say}`;
        }
        const when = r.startTime ? new Intl.DateTimeFormat('en-US', {
          timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(r.startTime) : 'that appointment';
        return `SUCCESS. The appointment on ${when} is cancelled and the salon calendar is already updated. Confirm it warmly in one sentence, say they are welcome to book again any time, then ask if there is anything else — do not end the call yet.`;
      }

      if (name === 'end_call') {
        acc.wantEnd = true;
        return 'Say ONE short, warm goodbye now: thank them for calling, use their name if you know it.';
      }
      return `Unknown tool ${name}.`;
    } catch (e) {
      return `Could not complete "${name}": ${String((e as Error).message || e).slice(0, 160)}. Tell the caller and offer another time or ask for the correct details.`;
    }
  }

  // ---- party booking (one person or a group) --------------------------------
  // The arithmetic lives in bookings/party-availability.service.ts, shared
  // with the chat bot; the hotline only phrases it for a phone call.

  private async toolCheckAvailability(tenantId: string, tz: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
    return this.parties.describe(tenantId, tz, input, ctx);
  }

  /**
   * Book a person or a whole party in one go. The book is checked FIRST —
   * a time that cannot seat everybody books nobody, instead of booking the
   * first two and telling the third to call back. Guests are written before
   * the caller, so the one confirmation text (the caller's) only goes out
   * once everyone is in; if one fails, the ones already written are cancelled.
   */
  private async toolBookParty(
    tenantId: string, tz: string, callerPhone: string, input: Record<string, unknown>,
    acc: { booked: boolean; appointmentId: string | null }, ctx: ToolCtx,
  ): Promise<string> {
    const parsed = this.parties.parseParty(input, ctx, true);
    if ('error' in parsed) return parsed.error;
    const members = parsed.members;
    // The caller's own words — an allergy, "running late", "same colour as
    // last time" — go on the booking so the desk reads them, not just the AI.
    const request = String(input.request ?? '').trim().slice(0, 300);
    const local = String(input.localDateTime ?? '').trim();
    const lm = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/.exec(local);
    if (!lm) return 'localDateTime must look like 2026-07-10T14:00 (salon local). Ask for the day and time if you do not have them.';
    const { dial } = await this.localeInfo(tenantId);
    // Confirmed with the caller, last four digits read back — see phone-readback.ts.
    const pd = bookingPhone({ given: input.customerPhone, callerPhone, confirmed: input.phoneConfirmed, norm: (r) => toE164(r, dial) });
    if (!pd.ok) return pd.say;
    const phone = pd.phone;
    const dateStr = lm[1];
    // The same wall-clock arithmetic the open-times grid uses, so "14:00" here is the very instant offered there.
    const start = wallTimeToUtc(dateStr, `${lm[2]}:${lm[3]}`, tz);
    if (start.getTime() < Date.now()) return 'That time has already passed. Ask for another time.';

    // A repeated turn (a slow line, a caller saying "yes" twice) must not book twice.
    const dupe = await this.prisma.appointment.findFirst({
      where: { tenantId, source: 'hotline', startTime: start, createdAt: { gte: new Date(Date.now() - 60 * 60_000) }, customer: { phone } },
      select: { id: true },
    }).catch(() => null);
    if (dupe) {
      acc.booked = true; acc.appointmentId = dupe.id;
      return 'ALREADY BOOKED a moment ago — do not book again. Tell the caller they are all set and a text confirmation is on the way, then ask if there is anything else.';
    }

    const party = this.parties.partyOf(members);
    const open = await this.parties.stillOpen(tenantId, tz, dateStr, start, party);
    if (!open.ok) return `NOT BOOKED — ${open.reason}`;
    const noteLang = noteLangForMarket((await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } as never }).catch(() => null) as { market?: string } | null)?.market);

    const n = members.length;
    const groupId = n > 1 ? `ph-${randomUUID()}` : undefined;
    const lead = members[0];
    const order = [...members.slice(1).map((m, i) => ({ m, i: i + 1 })), { m: lead, i: 0 }];
    const made: string[] = [];
    let leadId: string | null = null;
    try {
      for (const { m, i } of order) {
        const isLead = i === 0;
        const dto = {
          serviceId: m.items[0].id,
          ...(m.items.length > 1 ? { serviceIds: m.items.map((x) => x.id) } : {}),
          startTime: start.toISOString(),
          customerFirstName: m.firstName,
          ...(isLead ? { customerPhone: phone } : {}),
          ...(m.techId ? { preferredStaffId: m.techId } : {}),
          ...(n > 1 ? { partySize: n, groupId } : {}),
          notes: aiBookingNote({
            channel: 'hotline', lang: noteLang, phone, techName: m.techName,
            partyNames: n > 1 ? [lead.firstName, ...members.slice(1).map((x) => x.firstName)] : undefined,
            services: m.items.map((x) => x.name),
            request: isLead ? request : (request ? `(${lead.firstName}) ${request}` : null),
          }),
        } as CreateBookingDto;
        const b = await this.bookings.createForTenant(tenantId, dto, null, 'hotline', null, { autoAssign: true, groupGuest: !isLead });
        const id = (b as { id?: string }).id;
        if (id) made.push(id);
        if (isLead) leadId = id ?? null;
      }
    } catch (e) {
      if (made.length) {
        await this.prisma.appointment.updateMany({ where: { tenantId, id: { in: made } }, data: { status: AppointmentStatus.CANCELLED } }).catch(() => undefined);
      }
      return `NOT BOOKED: ${String((e as Error).message || e).slice(0, 160)}. Nothing was kept. Tell the caller briefly and offer another time, or to connect them to the front desk.`;
    }
    acc.booked = true;
    acc.appointmentId = leadId;
    const who = members.map((m) => `${m.firstName} (${m.items.map((x) => x.name).join(' + ')}${m.techName ? ` with ${m.techName}` : ''})`).join(', ');
    return `SUCCESS. Booked ${who} for ${this.parties.spoken(start, tz)}. Thank them and confirm in ONE short sentence, saying a text confirmation is on its way to this number. Then ask if there is anything else — do not end the call yet.`;
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

  /** Live health of the ONE Anthropic key the whole platform shares. */
  async aiDiag(): Promise<{ keyPresent: boolean; model: string; ok: boolean; status: number | null; error: string | null }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    const model = process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001';
    if (!key) return { keyPresent: false, model, ok: false, status: null, error: 'ANTHROPIC_API_KEY is not set on this service.' };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(10_000),
      });
      // Eight tokens, pressed by hand — counted anyway, so the report never
      // has to be read as "everything except the bits we forgot".
      this.aiUsage?.record({ feature: 'other', tenantId: null, model, input: 1, output: 1, failed: !res.ok });
      const error = res.ok ? null : (await res.text().catch(() => '')).slice(0, 300);
      return { keyPresent: true, model, ok: res.ok, status: res.status, error };
    } catch (e) {
      return { keyPresent: true, model, ok: false, status: null, error: String(e).slice(0, 200) };
    }
  }

  // ---- Salon Admin ---------------------------------------------------------
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const line = await this.prisma.voiceLine.findUnique({ where: { tenantId } });
    const calls = await this.prisma.voiceCall.count({ where: { tenantId } });
    // A salon with no line yet opens the settings on its own English.
    const market = line ? null : await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } as never }).catch(() => null) as { market?: string | null } | null;
    const defaultLang = String(market?.market ?? '').toUpperCase() === 'AU' ? 'en-AU' : 'en-US';
    return {
      provisioned: Boolean(line?.lumioNumber),
      lumioNumber: line?.lumioNumber ?? '',
      enabled: line?.enabled ?? false,
      greeting: line?.greeting ?? '',
      language: line?.language ?? defaultLang,
      aiInstruction: line?.aiInstruction ?? '',
      mode: line?.mode ?? 'ai',
      forwardNumbers: line?.forwardNumbers ?? '',
      transferNumber: (line as unknown as { transferNumber?: string | null } | null)?.transferNumber ?? '',
      ringSeconds: line?.ringSeconds ?? 20,
      schedule: line?.schedule ?? 'always',
      customHours: (line?.customHours as unknown) ?? null,
      noAnswerAction: line?.noAnswerAction ?? 'voicemail',
      awayMessage: line?.awayMessage ?? '',
      voicemailSms: line?.voicemailSms ?? '',
      aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      webhookUrl: `${this.apiBase()}/api/voice/incoming`,
      calls,
    };
  }

  async updateSettings(user: AuthenticatedUser, dto: UpdateVoiceInput) {
    const tenantId = this.tenantId(user);
    const cur = await this.prisma.voiceLine.findUnique({ where: { tenantId } });

    const { dial } = await this.localeInfo(tenantId);
    const MODES = ['ai', 'ring_first', 'forward'];
    const SCHEDULES = ['always', 'business_hours', 'after_hours', 'custom'];
    const ACTIONS = ['voicemail', 'message', 'hangup'];

    // Clean the phone list: valid E.164 only, never the Lumio number itself
    // (that would forward the call straight back to us and loop forever).
    const lumio = normNum(cur?.lumioNumber);
    let forwardNumbers = cur?.forwardNumbers ?? null;
    if (typeof dto.forwardNumbers === 'string') {
      const list = dto.forwardNumbers
        .split(/[,;\n]/)
        .map((x) => toE164(x, dial))
        .filter((x) => x && normNum(x) !== lumio);
      if (dto.forwardNumbers.trim() && list.length === 0) {
        throw new BadRequestException('None of those phone numbers look valid. Use a full number, e.g. +1 403 555 0123 — and it cannot be your Lumio hotline number.');
      }
      forwardNumbers = list.slice(0, 5).join(',') || null;
    }

    // The receptionist's phone for mid-call hand-offs: one valid number, never
    // the Lumio line (that would ring straight back into the assistant).
    let transferNumber = (cur as unknown as { transferNumber?: string | null } | null)?.transferNumber ?? null;
    if (typeof dto.transferNumber === 'string') {
      const raw = dto.transferNumber.trim();
      const e164 = raw ? toE164(raw, dial) : '';
      if (raw && (!e164 || normNum(e164) === lumio)) {
        throw new BadRequestException('That transfer number does not look valid. Use a full number, e.g. +1 403 555 0123 — and it cannot be your Lumio hotline number.');
      }
      transferNumber = e164 || null;
    }

    const mode = typeof dto.mode === 'string' && MODES.includes(dto.mode) ? dto.mode : cur?.mode ?? 'ai';
    if ((mode === 'ring_first' || mode === 'forward') && !forwardNumbers) {
      throw new BadRequestException('Add at least one phone number to ring before the assistant takes over.');
    }

    const data = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur?.enabled ?? false,
      greeting: typeof dto.greeting === 'string' ? dto.greeting.slice(0, 500) : cur?.greeting ?? null,
      language: typeof dto.language === 'string' && dto.language.trim() ? dto.language.trim().slice(0, 12) : cur?.language ?? 'en-US',
      aiInstruction: typeof dto.aiInstruction === 'string' ? dto.aiInstruction.slice(0, 2000) : cur?.aiInstruction ?? null,
      mode,
      forwardNumbers,
      ringSeconds: typeof dto.ringSeconds === 'number' ? Math.min(60, Math.max(5, Math.round(dto.ringSeconds))) : cur?.ringSeconds ?? 20,
      schedule: typeof dto.schedule === 'string' && SCHEDULES.includes(dto.schedule) ? dto.schedule : cur?.schedule ?? 'always',
      customHours: Array.isArray(dto.customHours)
        ? (dto.customHours
            .filter((r) => r && Number.isInteger(r.day) && r.day >= 0 && r.day <= 6)
            .slice(0, 7)
            .map((r) => ({
              day: r.day,
              enabled: r.enabled !== false,
              start: /^\d{1,2}:\d{2}$/.test(String(r.start)) ? String(r.start) : '18:00',
              end: /^\d{1,2}:\d{2}$/.test(String(r.end)) ? String(r.end) : '09:00',
            })) as unknown as Prisma.InputJsonValue)
        : (cur?.customHours as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      noAnswerAction: typeof dto.noAnswerAction === 'string' && ACTIONS.includes(dto.noAnswerAction) ? dto.noAnswerAction : cur?.noAnswerAction ?? 'voicemail',
      awayMessage: typeof dto.awayMessage === 'string' ? dto.awayMessage.slice(0, 500) : cur?.awayMessage ?? null,
      voicemailSms: typeof dto.voicemailSms === 'string' ? (toE164(dto.voicemailSms, dial) || null) : cur?.voicemailSms ?? null,
      transferNumber,
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
    // Twilio always sends `To` with its "+"; a number saved without one never
    // matches an incoming call, so the line looks set up and never answers.
    if (!num || !/^\+\d{8,15}$/.test(num)) throw new BadRequestException('Enter the Lumio number in E.164 form with the "+", e.g. +14085551234 or +61412345678');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, market: true } as never }) as { id: string; market?: string | null } | null;
    if (!tenant) throw new NotFoundException('Tenant not found');
    const clash = await this.prisma.voiceLine.findFirst({ where: { lumioNumber: num, NOT: { tenantId } } });
    if (clash) throw new BadRequestException('That number is already assigned to another salon.');
    const isAu = String(tenant.market ?? '').toUpperCase() === 'AU';
    await this.prisma.voiceLine.upsert({
      where: { tenantId },
      update: { lumioNumber: num },
      // A new Australian line starts in Australian English; a salon can
      // still switch it to Vietnamese or bilingual in its settings.
      create: { tenantId, lumioNumber: num, enabled: false, ...(isAu ? { language: 'en-AU' } : {}) },
    });
    await this.audit(tenantId, 'voice.provisioned');
    return { tenantId, lumioNumber: num };
  }

  /** Per-tenant AI usage this month (Super Admin billing oversight). */
  async usageAll(): Promise<TenantVoiceUsage[]> {
    const tenants = await this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    // Ten salons at a time, not one after another: with three queries per
    // salon in series this page grew slower with every tenant added.
    const rows: TenantVoiceUsage[] = [];
    for (let i = 0; i < tenants.length; i += 10) {
      const batch = tenants.slice(i, i + 10);
      const got = await Promise.all(batch.map(async (t) => ({ tenantId: t.id, name: t.name, ...(await this.usageForTenant(t.id)) })));
      rows.push(...got);
    }
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
