/**
 * What a push notification is allowed to say, and who gets one.
 *
 * Separated from the sending machinery so both decisions can be tested. The
 * sending is a network call; these are judgements, and judgements are what go
 * wrong quietly.
 */

export interface PushDevice {
  id: string;
  userId: string;
  endpoint: string;
}

export interface PushAudienceOptions {
  /**
   * The person who caused this, if it was a person. They do not need telling
   * about their own reply — and being buzzed by your own message is the fastest
   * way to make somebody switch notifications off for good.
   */
  exceptUserId?: string | null;
}

/** Which devices should be woken. */
export function pushAudience(devices: PushDevice[], opts: PushAudienceOptions = {}): PushDevice[] {
  const list = Array.isArray(devices) ? devices.filter((d) => d && d.endpoint) : [];
  const skip = opts.exceptUserId ?? null;
  const out = skip ? list.filter((d) => d.userId !== skip) : list;

  // One device may somehow appear twice — a race between two subscribe calls,
  // or a browser that reissued the same endpoint. Buzzing a phone twice for one
  // customer looks like the software is broken.
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.endpoint) ? false : (seen.add(d.endpoint), true)));
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * The words on the notification.
 *
 * IT NEVER CONTAINS THE MESSAGE.
 *
 * A notification is read on a lock screen, over a shoulder, on a phone lying
 * face-up on the front desk while customers stand at it. The salon's messages
 * are private and none of those places are. The customer's name and "vừa nhắn
 * tin" is enough to make somebody open the app, which is the whole job the
 * notification has.
 *
 * The name is included because knowing WHO is what makes somebody decide to
 * stop what they are doing — and a name is already visible to anyone standing
 * in the salon anyway.
 */
export function pushPayload(opts: { name?: string | null; pageName?: string | null; vi?: boolean; url?: string }): PushPayload {
  const vi = opts.vi !== false;
  const name = String(opts.name ?? '').trim() || (vi ? 'Khách' : 'A customer');
  const page = String(opts.pageName ?? '').trim();

  return {
    title: vi ? `${name} vừa nhắn tin` : `${name} sent a message`,
    body: page
      ? (vi ? `Trên ${page} · mở Lumio để trả lời` : `On ${page} · open Lumio to reply`)
      : (vi ? 'Mở Lumio để trả lời khách' : 'Open Lumio to reply'),
    url: opts.url || '/staff/inbox',
    // One tag for the whole inbox, so a busy morning replaces the notification
    // instead of stacking fourteen of them down somebody's lock screen.
    tag: 'lumio-inbox',
  };
}

/**
 * Whether a failed push means the device is gone for good.
 *
 * 404 and 410 are the browser vendor saying this endpoint no longer exists —
 * the app was uninstalled, the browser data cleared, permission revoked. Those
 * rows must be deleted or they are retried forever, several times an hour, for
 * every message, until the push service starts rate-limiting the ones that DO
 * still work.
 *
 * Anything else — a timeout, a 500, a 429 — is temporary and the row stays.
 * Deleting a device because a push service had a bad minute would silently
 * unsubscribe somebody who never asked to be unsubscribed.
 */
export function isDeadEndpoint(statusCode: unknown): boolean {
  const n = Number(statusCode);
  return n === 404 || n === 410;
}
