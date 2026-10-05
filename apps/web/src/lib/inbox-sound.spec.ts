/**
 * "Có tin nhắn nhưng mục inbox không báo, cũng không có chuông."
 *
 * Two causes, both guarded here:
 *  1. The alert engine was mounted only in a Lumio support session, so a
 *     salon's own owner and front desk had no badge and no chime at all.
 *  2. The chime built a new AudioContext per message; a page nobody has
 *     clicked since it loaded gets a SUSPENDED context and plays nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  audioContext, unlockSound, installSoundUnlock, playChime, _resetSoundForTests,
  setOpenConversation, openConversation,
} from './inbox-sound';
import { nextAlerts, emptyMemory } from './inbox-alerts';

class FakeCtx {
  static made = 0;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = {};
  tones = 0;
  resumeWorks = false;
  constructor() { FakeCtx.made += 1; }
  resume() {
    if (this.resumeWorks) { this.state = 'running'; return Promise.resolve(); }
    return new Promise<void>(() => undefined); // what a browser does without a click: never settles
  }
  createOscillator() { this.tones += 1; return { type: '', frequency: { value: 0 }, connect: (g: unknown) => g, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d }; }
}

function fakeWindow() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    AudioContext: FakeCtx,
    addEventListener: (e: string, h: () => void) => { (listeners[e] ||= []).push(h); },
    removeEventListener: (e: string, h: () => void) => { listeners[e] = (listeners[e] || []).filter((x) => x !== h); },
    fire: (e: string) => (listeners[e] || []).forEach((h) => h()),
    count: (e: string) => (listeners[e] || []).length,
  } as unknown as Window & { fire: (e: string) => void; count: (e: string) => number };
}

beforeEach(() => { _resetSoundForTests(); FakeCtx.made = 0; });

describe('the chime', () => {
  it('uses ONE audio context for the whole tab, not one per message', async () => {
    const w = fakeWindow();
    const c = audioContext(w) as unknown as FakeCtx;
    c.state = 'running';
    await playChime(w); await playChime(w); await playChime(w);
    expect(FakeCtx.made).toBe(1);
    expect(c.tones).toBe(6); // two notes each
  });

  it('says "blocked" — instead of failing silently — when the browser holds sound back', async () => {
    const w = fakeWindow();
    expect(await playChime(w, 20)).toBe('blocked');
    expect((audioContext(w) as unknown as FakeCtx).tones).toBe(0);
  });

  it('the first click anywhere unlocks it, and from then on it rings', async () => {
    const w = fakeWindow();
    const c = audioContext(w) as unknown as FakeCtx;
    let unlocked = false;
    const stop = installSoundUnlock(w, () => { unlocked = true; });
    c.resumeWorks = true; // a click is what makes resume() succeed
    (w as unknown as { fire: (e: string) => void }).fire('pointerdown');
    await Promise.resolve();
    expect(c.state).toBe('running');
    expect(unlocked).toBe(true);
    expect(await playChime(w)).toBe('played');
    stop();
    expect((w as unknown as { count: (e: string) => number }).count('pointerdown')).toBe(0);
  });

  it('unlockSound resumes a suspended context', () => {
    const w = fakeWindow();
    const c = audioContext(w) as unknown as FakeCtx;
    c.resumeWorks = true;
    unlockSound(w);
    expect(c.state).toBe('running');
  });

  it('a browser without audio is not an error', async () => {
    expect(await playChime({} as Window)).toBe('unsupported');
  });
});

describe('the conversation on screen does not ring', () => {
  const visible = { visibilityState: 'visible' } as Document;
  const hidden = { visibilityState: 'hidden' } as Document;
  afterEach(() => setOpenConversation(null));

  it('is reported only while the tab is visible', () => {
    setOpenConversation('t1');
    expect(openConversation(visible)).toBe('t1');
    expect(openConversation(hidden)).toBeNull();
    setOpenConversation(null);
    expect(openConversation(visible)).toBeNull();
  });

  it('feeds nextAlerts: a new message in the open conversation is silent, another one rings', () => {
    const primed = nextAlerts(emptyMemory(), [
      { id: 't1', updatedAt: '1', lastMessageAt: '1', unread: false },
      { id: 't2', updatedAt: '1', lastMessageAt: '1', unread: false },
    ]).memory;
    setOpenConversation('t1');
    const { alerts } = nextAlerts(primed, [
      { id: 't1', updatedAt: '2', lastMessageAt: '2', unread: true, senderName: 'Kim' },
      { id: 't2', updatedAt: '2', lastMessageAt: '2', unread: true, senderName: 'Lan' },
    ], { openId: openConversation(visible) });
    expect(alerts.map((a) => a.id)).toEqual(['t2']);
  });
});

describe('who gets inbox alerts', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'components', f), 'utf8');

  it('the classic shell mounts them for everyone who may see the inbox — not only support', () => {
    const s = src('SalonShell.tsx');
    expect(s).not.toMatch(/isSupport && <InboxAlerts/);
    expect(s).toMatch(/const inboxOk = hrefVisible\('\/salon\/inbox'\)/);
    expect(s).toMatch(/'\/salon\/inbox' \? inboxUnread/);
    // desktop header, phone header, and handed to the new layout
    expect((s.match(/inboxAlerts\((true|false)\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('the new layout renders what the shell hands it, and badges the Inbox item', () => {
    expect(src('shell/ShellV2.tsx')).not.toMatch(/isSupport && <InboxAlerts/);
    expect(src('SalonShell.tsx')).toMatch(/'\/salon\/inbox': inboxUnread/);
  });

  it('InboxAlerts uses the shared chime and reports the count', () => {
    const s = src('InboxAlerts.tsx');
    expect(s).not.toMatch(/new AudioCtor\(\)/);
    expect(s).toMatch(/from '\.\.\/lib\/inbox-sound'/);
    expect(s).toMatch(/onCountRef\.current\?\.\(n\)/);
  });

  it('the inbox page tells the shell which conversation is open', () => {
    expect(src('InboxView.tsx')).toMatch(/setOpenConversation\(openId\)/);
  });
});
