import { SEEN_TO_TYPING_MS, TYPING_MAX_MS, TYPING_REFRESH_MS, notePresence, presenceStats, resetPresenceStats, senderActionBody, supportsSenderAction, typingStep } from './presence';

describe('"seen" and the typing dots (./presence)', () => {
  it('only Messenger and Instagram have them; the website widget and Zalo do not', () => {
    expect(supportsSenderAction('messenger', '4135986')).toBe(true);
    expect(supportsSenderAction('instagram', '17841422')).toBe(true);
    expect(supportsSenderAction(null, '4135986')).toBe(true); // an old thread with no channel is Messenger
    expect(supportsSenderAction('web', 'web:tenant-1')).toBe(false);
    expect(supportsSenderAction('messenger', 'web:tenant-1')).toBe(false); // the page decides, whatever the row says
    expect(supportsSenderAction('zalo', 'zalo:123')).toBe(false);
    expect(supportsSenderAction('zalo', null)).toBe(false);
  });

  it('a sender action travels alone: the recipient and the action, nothing else', () => {
    expect(senderActionBody('PSID1', 'typing_on')).toEqual({ recipient: { id: 'PSID1' }, sender_action: 'typing_on' });
    expect(Object.keys(senderActionBody('PSID1', 'mark_seen')).sort()).toEqual(['recipient', 'sender_action']);
  });

  it('the dots are renewed while the AI works, and never kept longer than a minute', () => {
    expect(typingStep(0, 8_000)).toBe('renew');
    expect(typingStep(0, TYPING_MAX_MS - 1)).toBe('renew');
    expect(typingStep(0, TYPING_MAX_MS)).toBe('stop');
  });

  it('"seen" and the dots are never sent in the same instant, and the dots are renewed well inside Meta\'s own limit', () => {
    // 17/11/2026: sent back to back, Meta accepted both and the customer saw "Seen" but no dots.
    expect(SEEN_TO_TYPING_MS).toBeGreaterThanOrEqual(500);
    expect(SEEN_TO_TYPING_MS).toBeLessThanOrEqual(1500); // a tap is answered within seconds: the dots must still come first
    expect(TYPING_REFRESH_MS).toBeLessThanOrEqual(10_000);
    expect(TYPING_REFRESH_MS).toBeGreaterThanOrEqual(3_000);
  });

  it('each action is counted by itself, so support can see WHICH call Meta took and when', () => {
    resetPresenceStats();
    notePresence(true, null, 1_000, 'mark_seen');
    notePresence(true, null, 1_800, 'typing_on');
    notePresence(false, 'typing_on 400: (#100) no matching user', 2_000, 'typing_on');
    notePresence(true, null, 9_000, 'typing_off');
    const s = presenceStats();
    expect(s.byAction.mark_seen).toEqual({ ok: 1, failed: 0, lastOkAt: 1_000 });
    expect(s.byAction.typing_on).toEqual({ ok: 1, failed: 1, lastOkAt: 1_800 });
    expect(s.byAction.typing_off).toEqual({ ok: 1, failed: 0, lastOkAt: 9_000 });
    expect(s.sent).toBe(3);
    expect(s.failed).toBe(1);
    // A copy: nobody outside can change the counters.
    s.byAction.typing_on.ok = 99;
    expect(presenceStats().byAction.typing_on.ok).toBe(1);
  });

  it('the counters show the calls reach Meta, and never keep a token', () => {
    resetPresenceStats();
    notePresence(true); notePresence(true);
    notePresence(false, 'typing_on 400: https://graph.facebook.com/v21.0/me/messages?access_token=EAAB-secret&x=1 (#10) outside window');
    const s = presenceStats();
    expect(s.sent).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.lastError).toContain('outside window');
    expect(s.lastError).not.toContain('EAAB-secret');
  });
});
