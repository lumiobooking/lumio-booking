import { Observable, Subject } from 'rxjs';

/**
 * THE NUDGE. A tiny in-process bus that tells an open screen "something of
 * yours changed — go and look", so it fetches now instead of on its next poll.
 *
 * WHY IT EXISTS
 *
 * A customer checks in on their own phone; the walk-in board at the desk
 * showed them up to five seconds later (two while the QR was up), which at a
 * counter with the customer standing there is a visible pause. Polling faster
 * would have every open board in fifty-five salons hitting the database every
 * second, all day, to learn that nothing happened.
 *
 * WHAT IT IS NOT
 *
 * It carries no data — only a topic. The screen still fetches through the
 * same endpoint, with the same auth and the same tenant scope, so a nudge can
 * never leak anything and a lost nudge costs nothing: the poll is still
 * there underneath, just slower. It is per process: on more than one API
 * instance a change on instance A does not nudge a screen attached to B, and
 * that screen falls back to the poll. Good enough, by design — the day that
 * matters, this becomes a Redis channel with the same two functions.
 */
export interface LiveEvent {
  topic: string;
  /** When it happened, ms since epoch. */
  at: number;
  /** The row concerned, when there is one. */
  id?: string;
}

class LiveEvents {
  private readonly subjects = new Map<string, Subject<LiveEvent>>();
  private readonly listeners = new Map<string, number>();

  /** Tell every screen of this tenant that `topic` changed. Never throws. */
  emit(tenantId: string | null | undefined, topic: string, id?: string): void {
    if (!tenantId) return;
    try { this.subjects.get(tenantId)?.next({ topic, at: Date.now(), id }); } catch { /* a listener's fault, not the caller's */ }
  }

  /** A stream of this tenant's events; the subject is dropped when the last screen leaves. */
  stream(tenantId: string): Observable<LiveEvent> {
    return new Observable<LiveEvent>((subscriber) => {
      let subject = this.subjects.get(tenantId);
      if (!subject) { subject = new Subject<LiveEvent>(); this.subjects.set(tenantId, subject); }
      const sub = subject.subscribe(subscriber);
      this.listeners.set(tenantId, (this.listeners.get(tenantId) ?? 0) + 1);
      return () => {
        sub.unsubscribe();
        const n = (this.listeners.get(tenantId) ?? 1) - 1;
        if (n <= 0) { this.listeners.delete(tenantId); this.subjects.delete(tenantId); }
        else this.listeners.set(tenantId, n);
      };
    });
  }

  /** How many screens are listening for this tenant (for tests and logs). */
  listening(tenantId: string): number {
    return this.listeners.get(tenantId) ?? 0;
  }
}

/** One bus per process. A plain export, not a Nest provider, so any service
 *  can nudge without wiring a module — the display's public check-in and the
 *  walk-in board live in different modules and both need it. */
export const liveEvents = new LiveEvents();
