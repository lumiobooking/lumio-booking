import { Injectable, Logger } from '@nestjs/common';
import { inboxBus } from './inbox-events';

/**
 * Live inbox updates, pushed instead of polled.
 *
 * WHY THIS EXISTS
 *
 * Meta delivers a webhook to the server the moment a customer writes. Nothing
 * carried that to the browser, so the inbox asked again every eight seconds.
 * That is up to eight seconds of a customer sitting there while a receptionist
 * looks at a screen that already knows nothing new — and eight seconds is long
 * enough to lose the moment in a chat.
 *
 * WHY SERVER-SENT EVENTS AND NOT A WEBSOCKET
 *
 * Everything here goes one way: server tells browser something changed. A
 * WebSocket adds a second direction nobody needs, its own protocol upgrade, its
 * own reconnect logic, and its own failure modes behind proxies. SSE is an HTTP
 * response that never ends. It reconnects by itself, survives a proxy, and the
 * browser side is a few lines.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *
 * No message content, no customer names, no ids. The event says only "something
 * in this salon changed" and the browser fetches through the normal, already
 * tenant-scoped endpoints. A stream is a long-lived connection and the easiest
 * place in a system to leak one tenant's data into another's screen; sending a
 * bare nudge makes that impossible rather than unlikely.
 */
@Injectable()
export class InboxEventsService {
  private readonly logger = new Logger('InboxEvents');

  /** tenantId → the listeners currently watching that salon's inbox. */
  private readonly subs = new Map<string, Set<(evt: string) => void>>();
  /** rt205: writes arrive in bursts (one customer message = several writes); one nudge per burst. */
  private readonly soon = new Map<string, { timer: NodeJS.Timeout; kind: 'message' | 'thread' }>();

  constructor() {
    inboxBus.on('nudge', (tenantId: string, kind: 'message' | 'thread') => this.publishSoon(tenantId, kind));
  }

  /** Coalesce within 120 ms — fast enough to read as instant, slow enough to merge a burst. */
  publishSoon(tenantId: string, kind: 'message' | 'thread' = 'thread'): void {
    if (!tenantId || !this.subs.get(tenantId)?.size) return;
    const cur = this.soon.get(tenantId);
    if (cur) { if (kind === 'message') cur.kind = 'message'; return; }
    const entry = { kind, timer: setTimeout(() => { this.soon.delete(tenantId); this.publish(tenantId, entry.kind); }, 120) };
    entry.timer.unref?.();
    this.soon.set(tenantId, entry);
  }

  subscribe(tenantId: string, fn: (evt: string) => void): () => void {
    let set = this.subs.get(tenantId);
    if (!set) {
      set = new Set();
      this.subs.set(tenantId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      // Drop the bucket when the last tab closes, so a salon that has not been
      // opened for a month does not hold an empty Set forever.
      if (!set!.size) this.subs.delete(tenantId);
    };
  }

  /**
   * Tell every open inbox for this salon that something moved.
   *
   * Never throws: this is called from the webhook path, and a browser that has
   * gone away must not be able to fail the handling of a customer's message.
   */
  publish(tenantId: string, kind: 'message' | 'thread' = 'message'): void {
    const set = this.subs.get(tenantId);
    if (!set?.size) return;
    for (const fn of set) {
      try {
        fn(kind);
      } catch (e) {
        this.logger.warn(`inbox listener failed: ${String(e).slice(0, 100)}`);
      }
    }
  }

  /** For the health endpoint: how many inboxes are currently open. */
  count(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }
}
