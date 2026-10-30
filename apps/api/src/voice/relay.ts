import { createHmac, timingSafeEqual } from 'crypto';
import type { TurnAction } from './voice.service';

/**
 * TWILIO CONVERSATIONRELAY — the streaming hotline (phase 2).
 *
 * The classic hotline is a chain of webhooks: Twilio records the caller,
 * transcribes, POSTs us the text, waits for TwiML, reads it aloud, and starts
 * listening again — and every "one moment" is one more round trip. With
 * ConversationRelay, Twilio keeps ONE WebSocket open for the whole call: its
 * own fast speech recognition sends us the caller's words the instant they
 * stop, we send back text, and it is spoken as it arrives. The caller can
 * also talk over the assistant and be heard (barge-in).
 *
 * THE BRAIN IS THE SAME. A relay turn runs exactly the same turnWork as a
 * classic turn: same prompt, same tools, same owner instructions, same
 * transcript, same booking rules. Only the transport changes.
 *
 * IT IS OPT-IN, PER NUMBER. Nothing changes for any salon until its Lumio
 * number is listed in VOICE_RELAY_NUMBERS on Render ("*" = every line). And
 * it FAILS SAFE: if the WebSocket cannot be reached or drops (a deploy, a
 * network blip), Twilio calls /voice/relay-end, which hands the call back to
 * the classic engine for the rest of it. The caller hears one "sorry, could
 * you say that again?" — never dead air, never a hang-up.
 */

/** Is this Lumio number on the streaming engine? Unset = no number is. */
export function relayEnabledFor(lumioNumber: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const list = String(env.VOICE_RELAY_NUMBERS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length) return false;
  if (list.includes('*')) return true;
  const n = String(lumioNumber ?? '').replace(/[^\d+]/g, '');
  return !!n && list.some((x) => x.replace(/[^\d+]/g, '') === n);
}

export interface TtsChoice { ttsProvider?: 'Amazon' | 'Google' | 'ElevenLabs'; voice?: string }

/**
 * The salon's chosen <Say> voice, in ConversationRelay terms, so a line
 * sounds the same on both engines. "Polly.Joanna-Neural" → Amazon
 * "Joanna-Neural"; "Google.vi-VN-Wavenet-A" → Google "vi-VN-Wavenet-A".
 * Anything else (a non-neural Polly voice, nothing chosen), or
 * VOICE_RELAY_TTS=elevenlabs, uses Twilio's own default voice for the
 * language (ElevenLabs).
 */
export function ttsFor(sayVoice: string | null | undefined, env: Record<string, string | undefined> = process.env): TtsChoice {
  if (String(env.VOICE_RELAY_TTS ?? '').trim().toLowerCase() === 'elevenlabs') return {};
  const v = String(sayVoice ?? '').trim();
  let m = /^Polly\.([A-Za-z]+-Neural)$/.exec(v);
  if (m) return { ttsProvider: 'Amazon', voice: m[1] };
  m = /^Google\.([a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+-[A-Z])$/.exec(v);
  if (m) return { ttsProvider: 'Google', voice: m[1] };
  return {};
}

const xml = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The wss:// twin of the API's public https:// address. */
export function relaySocketUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, '').replace(/^http/i, 'ws')}/api/voice/relay`;
}

/** The <Connect><ConversationRelay> that opens the stream, greeting included. */
export function relayTwiml(o: {
  apiBase: string;
  greeting: string;
  lang: string;
  /** Every language the line may switch to during the call (the first is the opening one). */
  langs: { code: string; tts: TtsChoice }[];
}): string {
  const tts = o.langs.find((l) => l.code === o.lang)?.tts ?? {};
  const ttsAttr = (t: TtsChoice) => (t.ttsProvider ? ` ttsProvider="${t.ttsProvider}"` : '') + (t.voice ? ` voice="${xml(t.voice)}"` : '');
  const languages = o.langs.map((l) => `<Language code="${xml(l.code)}"${ttsAttr(l.tts)}/>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><Response>'
    + `<Connect action="${xml(`${o.apiBase.replace(/\/+$/, '')}/api/voice/relay-end`)}" method="POST">`
    + `<ConversationRelay url="${xml(relaySocketUrl(o.apiBase))}" welcomeGreeting="${xml(o.greeting)}" language="${xml(o.lang)}"${ttsAttr(tts)}`
    + ' interruptible="any" interruptSensitivity="medium" welcomeGreetingInterruptible="speech" dtmfDetection="true">'
    + languages
    + `<Parameter name="lang" value="${xml(o.lang)}"/>`
    + '</ConversationRelay></Connect></Response>';
}

/**
 * Is this WebSocket upgrade really Twilio? Twilio signs the wss:// URL it
 * connects to (no body, no params) with the account's auth token — the same
 * HMAC-SHA1 as every other webhook. Same switches as TwilioSignatureGuard:
 * no token configured, or VOICE_VERIFY_SIGNATURE=false, lets it through.
 */
export function relaySignatureOk(o: { apiBase: string; path: string; signature: unknown }, env: Record<string, string | undefined> = process.env): boolean {
  const token = env.TWILIO_AUTH_TOKEN;
  if (!token || env.VOICE_VERIFY_SIGNATURE === 'false') return true;
  const sig = typeof o.signature === 'string' ? o.signature : '';
  if (!sig) return false;
  const url = o.apiBase.replace(/\/+$/, '').replace(/^http/i, 'ws') + o.path;
  const want = Buffer.from(createHmac('sha1', token).update(Buffer.from(url, 'utf-8')).digest('base64'));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Roughly how long a line takes to say aloud, to wait before ending or handing off. */
export function speakMs(text: string): number {
  return Math.min(15_000, 600 + String(text ?? '').length * 65);
}

// ---------------------------------------------------------------------------
// One call's conversation over the socket.
// ---------------------------------------------------------------------------

export interface RelayDeps {
  send(msg: Record<string, unknown>): void;
  close(): void;
  /** The call exists, belongs to a relay line, and Twilio's account matches. */
  setup(callSid: string, accountSid: string): Promise<{ ok: boolean; lang: string; maxSilence: number }>;
  turn(callSid: string, speech: string, interim: (text: string) => void): Promise<TurnAction>;
  silence(callSid: string, misses: number): Promise<{ text: string; end: boolean; lang: string }>;
  interrupted(callSid: string, heard: string): Promise<void> | void;
  filler(lang: string, n: number): string;
  log(msg: string): void;
}

export const RELAY_FILLER_MS = 1_500;
export const RELAY_STILL_MS = 6_000;
export const RELAY_SILENCE_MS = 9_000;
/** Keypad digits with no # are taken as finished after this pause. */
export const RELAY_KEYPAD_PAUSE_MS = 3_000;

export class RelaySession {
  private callSid = '';
  private lang = 'en-US';
  private maxSilence = 3;
  private ready = false;
  private busy = false;
  private queued: string[] = [];
  private misses = 0;
  private ended = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** The transcript fix after a barge-in, which the next turn must read. */
  private pendingWrite: Promise<void> = Promise.resolve();

  /** Opens once setup has been answered: anything that arrives sooner waits for it, nothing is lost. */
  private readonly setupGate: Promise<void>;
  private openGate: () => void = () => undefined;

  constructor(private readonly d: RelayDeps) {
    this.setupGate = new Promise<void>((r) => { this.openGate = r; });
  }

  async onMessage(raw: string): Promise<void> {
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = String(m.type ?? '');
    if (type === 'setup') {
      try { await this.onSetup(m); } finally { this.openGate(); }
      return;
    }
    await this.setupGate;
    if (!this.ready || this.ended) return;
    if (type === 'prompt') {
      if (m.last === false) return;
      const words = String(m.voicePrompt ?? '').trim();
      if (!words) return;
      this.clearSilence();
      this.misses = 0;
      if (this.busy) { this.queued.push(words); return; }
      return this.runTurn(words);
    }
    if (type === 'dtmf') {
      // The keypad: digits gather until # or a short pause, then count as one
      // caller turn — exact, where a number spoken in pieces was misheard.
      const digit = String(m.digit ?? '');
      if (!/^[0-9#*]$/.test(digit)) return;
      this.clearSilence();
      if (this.keyTimer) clearTimeout(this.keyTimer);
      if (digit === '#') return this.flushKeys();
      if (digit !== '*') this.keys += digit;
      this.keyTimer = setTimeout(() => { this.flushKeys().catch(() => undefined); }, RELAY_KEYPAD_PAUSE_MS);
      (this.keyTimer as { unref?: () => void }).unref?.();
      return;
    }
    if (type === 'interrupt') {
      this.clearSilence();
      const heard = String(m.utteranceUntilInterrupt ?? '').trim();
      if (heard) this.pendingWrite = Promise.resolve().then(() => this.d.interrupted(this.callSid, heard)).catch(() => undefined);
      return;
    }
    if (type === 'error') this.d.log(`relay error from Twilio: ${String(m.description ?? '').slice(0, 200)}`);
  }

  private keys = '';
  private keyTimer: ReturnType<typeof setTimeout> | null = null;
  private async flushKeys(): Promise<void> {
    if (this.keyTimer) clearTimeout(this.keyTimer);
    this.keyTimer = null;
    const d = this.keys;
    this.keys = '';
    if (!d || this.ended) return;
    const words = `(typed on the keypad) ${d}`;
    this.misses = 0;
    if (this.busy) { this.queued.push(words); return; }
    return this.runTurn(words);
  }

  onClose(): void {
    if (this.keyTimer) clearTimeout(this.keyTimer);
    this.ended = true;
    this.clearSilence();
    this.openGate();
  }

  private async onSetup(m: Record<string, unknown>): Promise<void> {
    this.callSid = String(m.callSid ?? '');
    const params = (m.customParameters ?? {}) as Record<string, unknown>;
    const r = await this.d.setup(this.callSid, String(m.accountSid ?? '')).catch(() => ({ ok: false, lang: 'en-US', maxSilence: 3 }));
    if (!r.ok) {
      this.d.log(`relay setup refused for ${this.callSid || '(no call)'}`);
      this.ended = true;
      this.d.send({ type: 'end', handoffData: JSON.stringify({ do: 'fallback' }) });
      return;
    }
    this.lang = String(params.lang ?? '') || r.lang;
    this.maxSilence = r.maxSilence;
    this.ready = true;
    // The greeting is being spoken now; start listening for silence after it.
    this.armSilence(4_000);
  }

  private say(text: string, lang: string, last = true): void {
    if (this.ended || !text) return;
    if (lang && lang !== this.lang) {
      this.lang = lang;
      this.d.send({ type: 'language', ttsLanguage: lang, transcriptionLanguage: lang });
    }
    this.d.send({ type: 'text', token: text, last, lang: this.lang });
  }

  private async runTurn(words: string): Promise<void> {
    this.busy = true;
    await this.pendingWrite;
    // Words the model says before reaching for a tool go out at once.
    let spokeEarly = false;
    const early = (t: string) => { spokeEarly = true; this.say(`${t} `, this.lang, false); };
    // Nothing to say yet → a short "one moment"; a long tool → "still checking".
    const timers = [
      setTimeout(() => { if (!spokeEarly) this.say(`${this.d.filler(this.lang, 0)} `, this.lang, false); }, RELAY_FILLER_MS),
      setTimeout(() => this.say(`${this.d.filler(this.lang, 1)} `, this.lang, false), RELAY_FILLER_MS + RELAY_STILL_MS),
      setTimeout(() => this.say(`${this.d.filler(this.lang, 2)} `, this.lang, false), RELAY_FILLER_MS + 2 * RELAY_STILL_MS),
    ];
    for (const t of timers) (t as { unref?: () => void }).unref?.();
    let a: TurnAction;
    try {
      a = await this.d.turn(this.callSid, words, early);
    } catch (e) {
      // turnWork never throws; this is belt and braces.
      this.d.log(`relay turn threw: ${String(e).slice(0, 160)}`);
      a = { kind: 'say', text: this.d.filler(this.lang, -1), lang: this.lang, lgFlag: null };
    } finally {
      for (const t of timers) clearTimeout(t);
    }
    this.busy = false;
    if (this.ended) return;
    this.say(a.text, a.lang, true);
    if (a.kind === 'hangup' || a.kind === 'transfer') {
      this.ended = true;
      const handoff = JSON.stringify(a.kind === 'transfer' ? { do: 'transfer', lang: a.lang } : { do: 'hangup' });
      const tm = setTimeout(() => this.d.send({ type: 'end', handoffData: handoff }), speakMs(a.text));
      (tm as { unref?: () => void }).unref?.();
      return;
    }
    if (this.queued.length) {
      const next = this.queued.splice(0).join(' ');
      return this.runTurn(next);
    }
    this.armSilence(speakMs(a.text));
  }

  private armSilence(afterSpeechMs: number): void {
    this.clearSilence();
    if (this.ended) return;
    this.silenceTimer = setTimeout(() => { this.onSilence().catch(() => undefined); }, afterSpeechMs + RELAY_SILENCE_MS);
    (this.silenceTimer as { unref?: () => void }).unref?.();
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private async onSilence(): Promise<void> {
    if (this.ended || this.busy) return;
    this.misses += 1;
    const r = await this.d.silence(this.callSid, this.misses).catch(() => ({ text: '', end: false, lang: this.lang }));
    if (this.ended) return;
    this.say(r.text, r.lang, true);
    if (r.end) {
      this.ended = true;
      const tm = setTimeout(() => this.d.send({ type: 'end', handoffData: JSON.stringify({ do: 'hangup' }) }), speakMs(r.text));
      (tm as { unref?: () => void }).unref?.();
      return;
    }
    this.armSilence(speakMs(r.text));
  }
}
