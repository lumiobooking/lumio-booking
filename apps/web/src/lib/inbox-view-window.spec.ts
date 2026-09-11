/**
 * THE COMPOSER STRINGS, WORD FOR WORD AS THE META SUBMISSION QUOTES THEM.
 *
 * These sentences are pasted into the App Review notes and shown in the
 * screencast. If the wording drifts, the screencast and the written note stop
 * matching, and a reviewer comparing the two sees an inconsistency we cannot
 * explain afterwards. So they are pinned here, exactly, in English.
 */
import { windowNotice } from './inbox-view';

describe('the composer, word for word as the submission quotes it', () => {
  const en = (w: Parameters<typeof windowNotice>[0]) => windowNotice(w, false, 'Mai');

  it('under 24h: no banner, box open', () => {
    const n = en({ kind: 'open', daysLeft: null, canSend: true, code: null })!;
    expect(n.banner).toBeNull();
    expect(n.blocked).toBe(false);
    expect(n.placeholder).toBe('Message the customer…');
  });

  it('bot holding, mid window: the exact banner and placeholder', () => {
    const n = en({ kind: 'needs-takeover', daysLeft: 4, canSend: false, code: 'take_over_required' })!;
    expect(n.banner).toBe(
      'Past 24 hours — a reply now goes out under Meta\'s human-agent tag, which only a person may use. Press "Take over" to answer this customer. About 4 day(s) left.',
    );
    expect(n.placeholder).toBe('Press "Take over" to reply');
    expect(n.blocked).toBe(true);
    expect(n.tone).toBe('amber');
  });

  it('human holding, mid window: the exact banner, and the box is open', () => {
    const n = windowNotice({ kind: 'human-agent', daysLeft: 4, canSend: true, code: null, staffName: 'Mai Tran' }, false)!;
    expect(n.banner).toBe(
      'Past 24 hours — this reply goes out under Meta\'s human-agent tag. The bot can no longer message this customer. About 4 day(s) left.',
    );
    expect(n.placeholder).toBe('Type your reply — sent as Mai Tran');
    expect(n.blocked).toBe(false);
  });

  // CHECK 5 — the old hard-coded string said "past 24 hours" on an eleven-day
  // conversation. A reviewer reading that on screen sees an app that does not
  // know its own rule.
  it('past 7 days: the placeholder names the 7-day window, never 24 hours', () => {
    const n = en({ kind: 'closed', daysLeft: 0, canSend: false, code: 'window_closed' })!;
    expect(n.placeholder).toBe('Cannot send — the 7-day window has closed');
    expect(n.placeholder).not.toContain('24 hours');
    expect(n.banner).toBe('More than 7 days since they wrote — Meta has closed the window. Call or text them instead.');
    expect(n.tone).toBe('red');
    expect(n.blocked).toBe(true);
  });

  it('take-over is amber, not red: the reply is one click away', () => {
    expect(en({ kind: 'needs-takeover', daysLeft: 2, canSend: false, code: 'take_over_required' })!.tone).toBe('amber');
    expect(en({ kind: 'closed', daysLeft: 0, canSend: false, code: 'window_closed' })!.tone).toBe('red');
  });

  it('a missing window field leaves the composer alone instead of locking it', () => {
    expect(windowNotice(null, false)).toBeNull();
    expect(windowNotice(undefined, false)).toBeNull();
  });

  it('never prints "0 day(s) left"', () => {
    const n = en({ kind: 'human-agent', daysLeft: 0, canSend: true, code: null })!;
    expect(n.banner).toContain('About 1 day(s) left');
  });

  // The screen and the server must agree, or the box is open on a send the
  // server is about to refuse. The server's table is restated here on purpose:
  // it lives in another package, and a shared import would let both sides
  // drift together without a single test turning red.
  it('the screen locks exactly on the states the server refuses', () => {
    const table: { kind: 'open' | 'needs-takeover' | 'human-agent' | 'closed' | 'unknown'; canSend: boolean }[] = [
      { kind: 'open', canSend: true },
      { kind: 'unknown', canSend: true },
      { kind: 'needs-takeover', canSend: false },
      { kind: 'human-agent', canSend: true },
      { kind: 'closed', canSend: false },
    ];
    for (const row of table) {
      const n = windowNotice({ kind: row.kind, daysLeft: 3, canSend: row.canSend, code: null }, false)!;
      expect(n.blocked).toBe(!row.canSend);
    }
  });
});
