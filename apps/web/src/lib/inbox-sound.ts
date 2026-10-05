/**
 * The inbox chime, made to actually ring.
 *
 * WHY THE OLD ONE WAS SILENT
 *
 * It built a brand-new AudioContext for every message. Browsers (Chrome,
 * Edge, Safari) start an AudioContext SUSPENDED unless the page has had a
 * click or key press, and a context that is never resumed plays nothing —
 * no error, no warning. The front-desk tab is exactly that page: opened in
 * the morning, left alone, expected to ring. So the chime "worked" in every
 * test (someone had just clicked) and was mute in the salon.
 *
 * Now there is ONE context for the whole tab. The first click or key press
 * anywhere unlocks it, and it stays unlocked. If a message arrives before
 * anybody has touched the page, playChime says 'blocked' so the screen can
 * ask for the one click it needs, instead of failing silently.
 */

type AudioCtor = new () => AudioContext;
type Win = Window & { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };

let shared: AudioContext | null = null;

function ctorOf(w: Win): AudioCtor | undefined {
  return w.AudioContext || w.webkitAudioContext;
}

/** The tab's single AudioContext, created on first use. Null where audio does not exist. */
export function audioContext(w: Win = window as Win): AudioContext | null {
  if (shared) return shared;
  const C = ctorOf(w);
  if (!C) return null;
  try { shared = new C(); } catch { return null; }
  return shared;
}

/** Ask the browser to let us make sound. Works when called from a click/keypress. */
export function unlockSound(w: Win = window as Win): void {
  const c = audioContext(w);
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

/**
 * Unlock on the first real interaction with the page, wherever it happens.
 * Returns the clean-up. `onUnlocked` lets the screen drop its "click to enable
 * sound" hint once the browser has said yes.
 */
export function installSoundUnlock(w: Win = window as Win, onUnlocked?: () => void): () => void {
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const handler = () => {
    unlockSound(w);
    const c = audioContext(w);
    if (c && c.state === 'running') onUnlocked?.();
    else if (c) void c.resume().then(() => { if (c.state === 'running') onUnlocked?.(); }).catch(() => undefined);
  };
  for (const e of events) w.addEventListener(e, handler, { passive: true });
  return () => { for (const e of events) w.removeEventListener(e, handler); };
}

function tones(ctx: AudioContext) {
  const now = ctx.currentTime;
  [880, 1170].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // A quick fade in and out. A square-edged tone clicks, and a click is
    // what people describe as "that horrible noise".
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.30);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.32);
  });
}

export type ChimeResult = 'played' | 'blocked' | 'unsupported';

/**
 * A short two-note chime. Resolves 'blocked' when the browser will not let the
 * page make a sound yet (nobody has clicked it since it loaded). A blocked
 * chime is NOT played later — a ding three minutes late is worse than none.
 */
export async function playChime(w: Win = window as Win, waitMs = 400): Promise<ChimeResult> {
  const c = audioContext(w);
  if (!c) return 'unsupported';
  try {
    if (c.state !== 'running') {
      const resumed = await Promise.race([
        c.resume().then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), waitMs)),
      ]);
      // resume() changes state behind TypeScript's back — read it fresh.
      if (!resumed || (c.state as string) !== 'running') return 'blocked';
    }
    tones(c);
    return 'played';
  } catch {
    return 'unsupported';
  }
}

/** Tests only: forget the shared context. */
export function _resetSoundForTests() { shared = null; }

// ---------------------------------------------------------------------------
// Which conversation is on screen right now.
//
// The alert engine lives in the shell; the open conversation is local state of
// the inbox page. Without this, the shell rang for the very message the person
// was reading. The inbox page writes it, the shell reads it, nothing else does.
// ---------------------------------------------------------------------------

let openConversationId: string | null = null;

export function setOpenConversation(id: string | null) { openConversationId = id || null; }

/** The conversation being read — only while the tab is actually visible. */
export function openConversation(doc: Pick<Document, 'visibilityState'> | null = typeof document === 'undefined' ? null : document): string | null {
  if (!doc || doc.visibilityState !== 'visible') return null;
  return openConversationId;
}
