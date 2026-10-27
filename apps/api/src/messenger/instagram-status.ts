/**
 * IS THIS SALON'S INSTAGRAM ACTUALLY RECEIVING DMs? — read from the things
 * that decide it, not from an endpoint that does not apply to us.
 *
 * The status page used to ask Meta `GET /{ig-id}/subscribed_apps` and show
 * "Chưa nhận tin" (not receiving) whenever the list came back empty. That
 * edge belongs to "Instagram API with Instagram Login" (graph.instagram.com,
 * an Instagram user token). Lumio connects Instagram through FACEBOOK Login:
 * the Instagram account rides on its Facebook Page, and DMs are delivered
 * because (1) the Page is subscribed to our app and (2) the app subscribes to
 * the `instagram` object with the `messages` field, pointed at this server.
 * Asked with a Page token, the Instagram edge is always empty — so EVERY salon
 * showed "not receiving", whatever the truth was. Our bug, not Meta's.
 *
 * What decides it now, in order (the first failing check is the reason):
 *   - an Instagram professional account is linked to the Page;
 *   - the Page is subscribed to our app (same subscription Messenger uses);
 *   - the app's `instagram` subscription has `messages` and its callback is
 *     this server;
 *   - Meta lets this Page token read Instagram conversations (the
 *     `instagram_manage_messages` permission and the account's "Allow access
 *     to messages" switch) — Meta's own refusal is shown word for word;
 *   - the newest Instagram conversation Meta holds is not newer than the
 *     newest one we have (if it is, a DM did not reach us — the mirror now
 *     picks it up, and the status says so).
 * Pure; the Graph calls are in messenger.service.ts.
 */

export type IgState = 'not_linked' | 'ok' | 'not_receiving' | 'unknown';

export interface IgFacts {
  igId: string | null;
  pageSubscribed: boolean;
  /** The app-level `instagram` subscription: its fields and callback (null = none). */
  app: { fields: string[]; callbackUrl: string | null } | null;
  /** The app's subscription could not be read (no app secret, network). */
  appUnreadable?: boolean;
  /** Hosts this server answers on. */
  myHosts: string[];
  /** Meta's answer to reading the Page's Instagram conversations. */
  probe: { ok: true; newestAt: string | null } | { ok: false; error: string } | null;
  /** The newest Instagram conversation we hold for this salon. */
  ourNewestAt: string | null;
  /** The last Instagram webhook this server received for the account (since boot). */
  lastEventAt: string | null;
}

export interface IgVerdict { state: IgState; reason: string | null; reasonVi: string | null }

const hostOf = (u: string | null | undefined): string | null => { try { return u ? new URL(u).host : null; } catch { return null; } };

/** Up to two minutes between Meta's clock and ours is not a missed message. */
const SKEW_MS = 2 * 60_000;

export function igVerdict(f: IgFacts): IgVerdict {
  const bad = (en: string, vi: string): IgVerdict => ({ state: 'not_receiving', reason: en, reasonVi: vi });
  if (!f.igId) return { state: 'not_linked', reason: null, reasonVi: null };
  if (!f.pageSubscribed) {
    return bad('The Facebook Page is not subscribed to Lumio — Instagram DMs ride on that subscription. Reconnect.',
      'Page Facebook chưa đăng ký với Lumio — tin Instagram đi qua đăng ký này. Bấm Kết nối lại.');
  }
  if (f.app && !f.app.fields.includes('messages')) {
    return bad('The Lumio app is not subscribed to Instagram messages (App Dashboard → Webhooks → Instagram → messages).',
      'App Lumio chưa đăng ký nhận tin Instagram (App Dashboard → Webhooks → Instagram → messages). Việc của Lumio.');
  }
  if (f.app && f.app.callbackUrl && f.myHosts.length && !f.myHosts.includes(hostOf(f.app.callbackUrl) || '') && !f.lastEventAt) {
    return bad(`Instagram events are sent to ${hostOf(f.app.callbackUrl)}, not to this server.`,
      `Meta gửi tin Instagram tới ${hostOf(f.app.callbackUrl)}, không phải máy chủ này. Việc của Lumio.`);
  }
  if (f.probe && !f.probe.ok) {
    return bad(`Meta refuses Instagram messages for this Page: ${f.probe.error}`,
      `Meta không cho đọc tin Instagram của Page này: ${f.probe.error}`);
  }
  if (f.probe && f.probe.ok && f.probe.newestAt) {
    const theirs = new Date(f.probe.newestAt).getTime();
    const ours = f.ourNewestAt ? new Date(f.ourNewestAt).getTime() : 0;
    if (Number.isFinite(theirs) && theirs - ours > SKEW_MS) {
      return bad('Instagram has a newer conversation than the inbox — a DM did not arrive by webhook (the mirror is bringing it in).',
        'Instagram có hội thoại mới hơn Hộp thư — tin chưa về qua webhook (đang tự kéo về).');
    }
  }
  if (!f.app && f.appUnreadable) return { state: 'unknown', reason: 'The app subscription could not be read.', reasonVi: 'Không đọc được đăng ký của app.' };
  return { state: 'ok', reason: null, reasonVi: null };
}

/**
 * Who the customer is in an Instagram conversation from the Graph mirror:
 * the participant who is neither the Instagram account nor the Page.
 */
export function igCustomer(participants: { id: string; username?: string; name?: string }[] | undefined, igId: string, pageId: string): { id: string; name: string | null } | null {
  const p = (participants || []).find((x) => x.id !== igId && x.id !== pageId);
  return p ? { id: p.id, name: p.username || p.name || null } : null;
}
