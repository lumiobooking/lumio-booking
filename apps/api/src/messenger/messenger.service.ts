import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel, UserRole } from '@prisma/client';
import { BookingsService } from '../bookings/bookings.service';
import { SettingsService } from '../settings/settings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

// A blank/masked secret must never overwrite a stored Page token.
function cleanSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^[•*·.\s]+$/.test(t)) return null;
  return t;
}

/** Convert a salon-local wall time ("2026-07-10T14:00") to the correct UTC ISO
 *  instant for the salon's timezone (handles DST). */
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
    const offset = localFromUtc - asUtc; // ms the zone is ahead of UTC
    return new Date(asUtc - offset).toISOString();
  } catch {
    return new Date(asUtc).toISOString();
  }
}

type Turn = { role: 'user' | 'assistant'; content: string; at?: string; manual?: boolean };
type Channel = 'messenger' | 'instagram';
export interface BotFact { label: string; value: string; on: boolean }
interface AnthropicBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_TURNS = 12; // history cap
const MAX_TOOL_LOOPS = 5;

@Injectable()
export class MessengerService implements OnModuleInit {
  /**
   * Existing pages were subscribed WITHOUT message_echoes (the field that
   * carries human replies from the Page inbox), so the bot could not yield.
   * One quiet sweep after boot re-subscribes every connected page with the
   * full set. Idempotent and best-effort — a failed page just stays as-is.
   */
  onModuleInit(): void {
    const t = setTimeout(() => {
      void this.resubscribeAllPages().catch((e) => this.logger.warn(`echo resubscribe sweep failed: ${String(e).slice(0, 120)}`));
      void this.ensureAppSubscription().catch((e) => this.logger.warn(`app subscription sweep failed: ${String(e).slice(0, 120)}`));
      // Instagram DMs ride the SAME webhook but need their own app-level
      // subscription object — only attempted when Instagram is switched on.
      if (process.env.FB_ENABLE_INSTAGRAM === '1' || process.env.FB_ENABLE_INSTAGRAM === 'true') {
        void this.ensureAppSubscription(true, 'instagram').catch((e) => this.logger.warn(`ig subscription sweep failed: ${String(e).slice(0, 120)}`));
      }
    }, 90 * 1000); // well after boot
    t.unref?.();
  }

  private async resubscribeAllPages(): Promise<void> {
    const FIELDS = 'messages,messaging_postbacks,message_reactions,message_echoes';
    const seen = new Set<string>();
    const subscribe = async (pageId: string, token: string) => {
      if (!pageId || !token || seen.has(pageId)) return;
      seen.add(pageId);
      await fetch(`${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=${FIELDS}&access_token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
    };
    const pages = await this.prisma.messengerPage.findMany({ select: { pageId: true, pageToken: true } }).catch(() => []);
    for (const pg of pages) await subscribe(pg.pageId, pg.pageToken);
    const legacy = await this.prisma.messengerConnection.findMany({ where: { enabled: true }, select: { pageId: true, pageToken: true } }).catch(() => []);
    for (const c of legacy) await subscribe(c.pageId, c.pageToken);
    this.logger.log(`Echo resubscribe sweep done: ${seen.size} page(s).`);
  }

  private readonly logger = new Logger('Messenger');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- config --------------------------------------------------------------
  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private verifyToken(): string {
    return process.env.MESSENGER_VERIFY_TOKEN || 'lumio-verify';
  }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  private appId(): string { return process.env.FB_APP_ID || ''; }
  private appSecret(): string { return process.env.FB_APP_SECRET || ''; }
  private oauthRedirect(): string { return `${this.apiBase()}/api/messenger/oauth/callback`; }
  private signSecret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-fb-signing'; }
  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): string | null {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    if (sig !== expect) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!d.exp || Date.now() > d.exp) return null;
      return d.t;
    } catch { return null; }
  }

  // ---- admin (salon) -------------------------------------------------------
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const threads = await this.prisma.messengerThread.count({ where: { tenantId } });
    return {
      connected: Boolean((c?.pageId && c?.pageToken) || (await this.prisma.messengerPage.count({ where: { tenantId } })) > 0),
      pageId: c?.pageId ?? '',
      pageName: c?.pageName ?? '',
      igId: c?.igId ?? '',
      enabled: c?.enabled ?? false,
      greeting: c?.greeting ?? '',
      closing: (c as unknown as { closing?: string | null } | null)?.closing ?? '',
      agentName: (c as unknown as { agentName?: string | null } | null)?.agentName ?? '',
      bizIntro: (c as unknown as { bizIntro?: string | null } | null)?.bizIntro ?? '',
      humanActiveMins: (c as unknown as { humanActiveMins?: number } | null)?.humanActiveMins ?? 15,
      graceMins: (c as unknown as { graceMins?: number } | null)?.graceMins ?? 5,
      aiInstruction: c?.aiInstruction ?? '',
      botFacts: Array.isArray(c?.botFacts) ? (c!.botFacts as unknown as BotFact[]) : [],
      botMode: ((c as unknown as { botMode?: string } | null)?.botMode === 'sales' ? 'sales' : 'booking'),
      leadEmail: (c as unknown as { leadEmail?: string | null } | null)?.leadEmail ?? '',
      aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      webhookUrl: `${this.apiBase()}/api/messenger/webhook`,
      verifyToken: this.verifyToken(),
      fbConfigured: Boolean(this.appId() && this.appSecret()),
      threads,
      // Every page speaking with this tenant's brain.
      pages: await this.prisma.messengerPage.findMany({
        where: { tenantId },
        select: { pageId: true, pageName: true, igId: true, igUsername: true, enabled: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Step-by-step record of the LAST connect attempt — Support-only, so a
      // failed OAuth can be diagnosed from a screenshot.
      connectTrace: (user.supportSession === true || user.role === UserRole.SUPER_ADMIN)
        ? await this.settings.getMessengerConnectTrace(tenantId)
        : null,
    };
  }

  // ---- One-click OAuth (Facebook Login for Business) -----------------------
  async oauthUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = this.tenantId(user);
    if (!this.appId() || !this.appSecret()) {
      throw new BadRequestException('Facebook app not configured (set FB_APP_ID and FB_APP_SECRET). Contact Lumio.');
    }
    // Core Messenger booking scopes (must be added to the app in Meta first).
    // Instagram scopes are opt-in: Facebook rejects the WHOLE dialog with
    // "Invalid Scopes" if instagram_basic / instagram_manage_messages aren't yet
    // added to the app, so we only request them once the owner has added those
    // permissions in Meta and flipped FB_ENABLE_INSTAGRAM=1.
    const igOn = process.env.FB_ENABLE_INSTAGRAM === '1' || process.env.FB_ENABLE_INSTAGRAM === 'true';
    // business_management drags an extra "choose your business" step into the
    // dialog and buries personal (non-BM) pages behind it. The bot only needs
    // page-level scopes — pages the user manages (in a BM or not) all appear in
    // the plain page picker. Re-enable via env only if a business API is ever
    // actually needed.
    const bizOn = process.env.FB_REQUEST_BUSINESS_SCOPE === '1' || process.env.FB_REQUEST_BUSINESS_SCOPE === 'true';
    // pages_read_engagement lets us READ the ticked page (name + page access
    // token) — without it Meta answers "#100 Object does not exist". BUT if the
    // permission has not been added to the app in the Meta dashboard yet,
    // requesting it kills the WHOLE dialog with "Invalid Scopes" — so it can be
    // switched off with FB_SCOPE_READ_ENGAGEMENT=0 until the dashboard is set.
    const readEng = process.env.FB_SCOPE_READ_ENGAGEMENT !== '0';
    const scope = [
      'pages_show_list', 'pages_messaging', 'pages_manage_metadata',
      ...(readEng ? ['pages_read_engagement'] : []),
      ...(bizOn ? ['business_management'] : []),
      ...(igOn ? ['instagram_basic', 'instagram_manage_messages'] : []),
    ].join(',');
    const params = new URLSearchParams({
      client_id: this.appId(), redirect_uri: this.oauthRedirect(), response_type: 'code',
      state: this.signState(tenantId), scope,
      // If a permission was declined in an earlier run, plain OAuth silently
      // skips it forever — rerequest puts it back on the dialog.
      auth_type: 'rerequest',
    });
    return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
  }

  /** Facebook redirects here with ?code&state. Exchange it, grab the salon's Page
   *  + linked Instagram, store the Page token and subscribe the Page to our app. */
  async oauthCallback(code: string, state: string, error?: string): Promise<string> {
    const web = this.webBase();
    const back = (q: string) => `${web}/salon/messenger?${q}`;
    if (error) return back(`fb=error&msg=${encodeURIComponent(error)}`);
    const tenantId = this.verifyState(state);
    if (!tenantId || !code) return back('fb=error&msg=invalid_state');
    // Every step lands in this trace; it is saved on EVERY exit and shown to
    // the Support session in the UI — a failed connect diagnoses itself.
    const trace: string[] = [`start ${new Date().toISOString()}`];
    const finish = async (q: string) => { await this.settings.setMessengerConnectTrace(tenantId, trace).catch(() => undefined); return back(q); };
    try {
      const tokRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${this.appId()}&client_secret=${this.appSecret()}&redirect_uri=${encodeURIComponent(this.oauthRedirect())}&code=${encodeURIComponent(code)}`,
      );
      const tok = (await tokRes.json()) as { access_token?: string; error?: { message?: string } };
      if (!tok.access_token) { trace.push(`token: FAILED — ${tok.error?.message || 'no_token'}`); return finish(`fb=error&msg=${encodeURIComponent(tok.error?.message || 'no_token')}`); }
      trace.push('token: ok');
      const pagesRes = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(tok.access_token)}`,
      );
      const pagesData = (await pagesRes.json()) as { data?: { id: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }[]; error?: { message?: string } };
      if (pagesData.error) {
        // Meta told us exactly what is wrong — passing that through beats a
        // guessed "no pages" every time.
        this.logger.warn(`fb oauth /me/accounts error for ${tenantId}: ${pagesData.error.message || 'unknown'}`);
        trace.push(`accounts: ERROR — ${pagesData.error.message || 'unknown'}`);
        return finish(`fb=error&msg=${encodeURIComponent(`accounts_error:${(pagesData.error.message || 'unknown').slice(0, 140)}`)}`);
      }
      let pages = pagesData.data || [];
      trace.push(`accounts: ${pages.length} page(s)`);
      if (!pages.length) {
        // Known Meta quirk: /me/accounts often OMITS pages the user manages
        // through a Business Portfolio (exactly how an agency holds client
        // pages). The token itself still records which pages were ticked —
        // granular_scopes names them — so fetch those pages directly.
        try {
          const dbgRes = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(tok.access_token)}&access_token=${encodeURIComponent(`${this.appId()}|${this.appSecret()}`)}`,
          );
          const dbg = (await dbgRes.json()) as { data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } };
          const gs = dbg.data?.granular_scopes || [];
          const ids = gs.find((g) => g.scope === 'pages_show_list')?.target_ids
            || gs.find((g) => g.scope === 'pages_messaging')?.target_ids
            || [];
          this.logger.log(`fb oauth fallback for ${tenantId}: /me/accounts empty, granular pages = ${ids.length}`);
          trace.push(`granular scopes: ${ids.length} page id(s) ${ids.length ? '[' + ids.slice(0, 5).join(', ') + ']' : ''}`);
          const fetched: typeof pages = [];
          for (const id of ids.slice(0, 25)) {
            const pr = await fetch(
              `https://graph.facebook.com/v21.0/${id}?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(tok.access_token)}`,
            );
            const pd = (await pr.json()) as { id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string }; error?: { message?: string } };
            if (pd.error) { this.logger.warn(`fb oauth fallback page ${id}: ${pd.error.message || 'error'}`); trace.push(`page ${id}: ERROR — ${pd.error.message || 'error'}`); continue; }
            if (pd.id && pd.access_token) { trace.push(`page ${id} (${pd.name || '?'}): token ok`); fetched.push({ id: pd.id, name: pd.name, access_token: pd.access_token, instagram_business_account: pd.instagram_business_account }); }
            else trace.push(`page ${id}: no access_token in response`);
          }
          pages = fetched;
        } catch (e) {
          this.logger.warn(`fb oauth granular fallback failed: ${String(e).slice(0, 120)}`);
          trace.push(`granular fallback: THREW — ${String(e).slice(0, 120)}`);
        }
      }
      if (!pages.length) {
        // Still empty: tell apart "nothing ticked" from "permission declined".
        try {
          const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(tok.access_token)}`);
          const perms = (await permRes.json()) as { data?: { permission: string; status: string }[] };
          const showList = perms.data?.find((pp) => pp.permission === 'pages_show_list');
          trace.push(`permissions: ${(perms.data || []).map((pp) => `${pp.permission}=${pp.status}`).join(', ') || 'none returned'}`);
          if (showList && showList.status !== 'granted') return finish('fb=error&msg=perm_declined');
        } catch { /* fall through to the generic hint */ }
        return finish('fb=error&msg=no_pages');
      }
      const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
      // Meta's classic footgun: re-running OAuth re-issues page tokens, and any
      // page the user left ticked gets a FRESH token while its old one may die.
      // Heal every page in this grant that ANY tenant already holds — refresh
      // its stored token and re-subscribe the webhook. Without this, connecting
      // shop B silently broke shop A.
      const healed = await this.healKnownPages(pages);
      if (healed) trace.push(`heal: refreshed ${healed} known page(s) from this grant`);
      const withIg = pages.filter((p) => p.instagram_business_account?.id).length;
      trace.push(`instagram: ${withIg} of ${pages.length} page(s) have a linked IG account`);
      // What in the grant is NEW to this tenant? A page we already hold must
      // never short-circuit the flow (that bug ate "add a second page" alive):
      //  · exactly ONE new page → connect it straight away
      //  · SEVERAL new pages   → park them, the staff picks (agency accounts
      //    manage many clients' pages — auto-taking one binds a random client)
      //  · NOTHING new         → pure reconnect: refresh tokens on the pages
      //    we already hold and report success.
      const held = new Set((await this.prisma.messengerPage.findMany({ where: { tenantId }, select: { pageId: true } })).map((pp) => pp.pageId));
      if (cur?.pageId) held.add(cur.pageId);
      const freshOnes = pages.filter((p) => !held.has(p.id));
      trace.push(`held: ${held.size} · new in grant: ${freshOnes.length}`);
      let chosen = pages.length === 1 ? pages[0] : freshOnes.length === 1 ? freshOnes[0] : null;
      if (!chosen && freshOnes.length === 0) {
        for (const p of pages) {
          if (held.has(p.id) && p.access_token) {
            await this.completeConnect(tenantId, { id: p.id, name: p.name || '', access_token: p.access_token, igId: p.instagram_business_account?.id || null }, cur?.greeting ?? null);
          }
        }
        trace.push('reconnect: tokens refreshed on held pages');
        return finish(`fb=connected&page=${encodeURIComponent(pages.map((p) => p.name || p.id).join(', '))}`);
      }
      trace.push(chosen ? `chosen: ${chosen.id} (${chosen.name || '?'})` : `multi-page: ${freshOnes.length} new candidates → staff picks`);
      if (!chosen) {
        await this.settings.setMessengerOauthStash(
          tenantId,
          pages.map((p) => ({ id: p.id, name: p.name || '', access_token: p.access_token || '', igId: p.instagram_business_account?.id || null })),
        );
        return finish('fb=pick');
      }
      const res = await this.completeConnect(tenantId, { id: chosen.id, name: chosen.name || '', access_token: chosen.access_token || '', igId: chosen.instagram_business_account?.id || null }, cur?.greeting ?? null);
      trace.push(`connect: ${res}`);
      if (res !== 'ok') return finish(`fb=error&msg=${res}`);
      return finish(`fb=connected&page=${encodeURIComponent(chosen.name || '')}`);
    } catch (e) {
      this.logger.warn(`fb oauth failed for tenant ${tenantId}: ${String(e).slice(0, 200)}`);
      trace.push(`EXCEPTION: ${String(e).slice(0, 160)}`);
      return finish('fb=error&msg=exception');
    }
  }

  /** Read the Instagram handle of a linked professional account. This is the
   *  ONLY thing we use instagram_basic for: showing the owner (and an App Review
   *  reviewer) WHICH Instagram account is connected, as "@username" instead of a
   *  bare numeric id. No media, insights or follower data is read. */
  /** Instagram Direct needs the IG ACCOUNT itself subscribed to the app, not
   *  just the Page. Without this Meta accepts the connection but never delivers
   *  a single DM webhook. Idempotent and best-effort. */
  private async subscribeIgAccount(igId: string, pageToken: string): Promise<void> {
    try {
      const res = await fetch(
        `${GRAPH}/${igId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,message_echoes&access_token=${encodeURIComponent(pageToken)}`,
        { method: 'POST', signal: AbortSignal.timeout(8000) },
      );
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      if (!json.success) this.logger.warn(`ig subscribe ${igId}: ${String(json.error?.message || 'no success flag').slice(0, 140)}`);
    } catch (e) {
      this.logger.warn(`ig subscribe failed: ${String(e).slice(0, 120)}`);
    }
  }

  private async fetchIgUsername(igId: string, pageToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${GRAPH}/${igId}?fields=username&access_token=${encodeURIComponent(pageToken)}`, { signal: AbortSignal.timeout(8000) });
      const json = (await res.json().catch(() => ({}))) as { username?: string };
      return json.username || null;
    } catch {
      return null;
    }
  }

  /** Refresh token + webhook subscription for every page in an OAuth grant
   *  that the platform already knows (any tenant). Page identity is global —
   *  a token belongs to the page — so this crosses tenants SAFELY: it never
   *  reads or moves tenant data, it only keeps existing links alive. */
  private async healKnownPages(
    pages: { id: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }[],
  ): Promise<number> {
    let healed = 0;
    for (const p of pages) {
      if (!p.id || !p.access_token) continue;
      const known = await this.prisma.messengerPage.findUnique({ where: { pageId: p.id } }).catch(() => null);
      if (known) {
        // Capture the linked Instagram account the FIRST time Meta reveals it
        // (it only appears once instagram_basic is granted). Guard: an IG
        // account already bound to a different tenant is never stolen.
        let igId: string | null = known.igId ?? null;
        const fresh = p.instagram_business_account?.id || null;
        if (fresh && fresh !== igId) {
          const clash = await this.prisma.messengerPage.findFirst({ where: { igId: fresh, NOT: { pageId: p.id } }, select: { tenantId: true } }).catch(() => null);
          const clashLegacy = await this.prisma.messengerConnection.findFirst({ where: { igId: fresh, NOT: { tenantId: known.tenantId } }, select: { tenantId: true } }).catch(() => null);
          if (!clash && !clashLegacy) igId = fresh;
        }
        const knownUser = (known as unknown as { igUsername?: string | null }).igUsername ?? null;
        const igUsername = igId ? (knownUser || await this.fetchIgUsername(igId, p.access_token)) : null;
        if (igId) await this.subscribeIgAccount(igId, p.access_token);
        await this.prisma.messengerPage.update({
          where: { pageId: p.id },
          data: { pageToken: p.access_token, pageName: p.name || known.pageName, igId, igUsername } as never,
        }).catch(() => undefined);
        if (igId && igId !== (known.igId ?? null)) {
          await this.prisma.messengerConnection.updateMany({ where: { tenantId: known.tenantId, pageId: p.id }, data: { igId } }).catch(() => undefined);
        }
      }
      const legacy = await this.prisma.messengerConnection.findFirst({ where: { pageId: p.id } }).catch(() => null);
      if (legacy) {
        await this.prisma.messengerConnection.update({
          where: { tenantId: legacy.tenantId },
          data: { pageToken: p.access_token },
        }).catch(() => undefined);
      }
      if (known || legacy) {
        await fetch(`${GRAPH}/${p.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,message_echoes&access_token=${encodeURIComponent(p.access_token)}`, { method: 'POST' }).catch(() => undefined);
        healed += 1;
      }
    }
    return healed;
  }

  /** Bind ONE page to the tenant: clash checks, token save, webhook subscribe,
   *  Get Started profile. Shared by the auto path and the manual page pick. */
  private async completeConnect(
    tenantId: string,
    page: { id: string; name: string; access_token: string; igId: string | null },
    greeting: string | null,
  ): Promise<'ok' | 'page_in_use' | 'no_page_token'> {
    if (!page.access_token) return 'no_page_token';
    // One page belongs to ONE tenant — checked against BOTH the new page table
    // and the legacy columns, named instead of exploding as a unique-key error.
    const clashPg = await this.prisma.messengerPage.findUnique({ where: { pageId: page.id }, select: { tenantId: true } });
    const clashLegacy = await this.prisma.messengerConnection.findUnique({ where: { pageId: page.id }, select: { tenantId: true } });
    if ((clashPg && clashPg.tenantId !== tenantId) || (clashLegacy && clashLegacy.tenantId !== tenantId)) {
      this.logger.warn(`fb oauth: page ${page.id} already bound to another tenant (wanted ${tenantId})`);
      return 'page_in_use';
    }
    let igId = page.igId;
    if (igId) {
      const igPg = await this.prisma.messengerPage.findUnique({ where: { igId }, select: { tenantId: true } });
      const igLegacy = await this.prisma.messengerConnection.findUnique({ where: { igId }, select: { tenantId: true } });
      if ((igPg && igPg.tenantId !== tenantId) || (igLegacy && igLegacy.tenantId !== tenantId)) igId = null; // keep FB, skip the shared IG
    }
    // The page joins the tenant's page list (one brain, many mouths)…
    const igUsername = igId ? await this.fetchIgUsername(igId, page.access_token) : null;
    if (igId) await this.subscribeIgAccount(igId, page.access_token);
    await this.prisma.messengerPage.upsert({
      where: { pageId: page.id },
      update: { tenantId, igId, igUsername, pageToken: page.access_token, pageName: page.name || null, enabled: true } as never,
      create: { tenantId, pageId: page.id, igId, igUsername, pageToken: page.access_token, pageName: page.name || null, enabled: true } as never,
    });
    // …and the brain row exists with the FIRST page mirrored into the legacy
    // columns, so every pre-multi-page code path keeps working.
    const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId }, select: { pageId: true } });
    if (!cur || !cur.pageId) {
      await this.prisma.messengerConnection.upsert({
        where: { tenantId },
        update: { pageId: page.id, igId, pageToken: page.access_token, pageName: page.name || null, enabled: true },
        create: { tenantId, pageId: page.id, igId, pageToken: page.access_token, pageName: page.name || null, enabled: true },
      });
    } else {
      await this.prisma.messengerConnection.updateMany({ where: { tenantId }, data: { enabled: true } });
    }
    // Subscribe the Page to our app's webhook so messages start flowing.
    await fetch(
      `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,message_echoes&access_token=${encodeURIComponent(page.access_token)}`,
      { method: 'POST' },
    ).catch(() => undefined);
    await this.setupMessengerProfile(page.access_token, greeting);
    await this.audit(tenantId, 'messenger.connected');
    return 'ok';
  }

  /** The parked pages from a multi-page OAuth — names only, tokens stay server-side. */
  async oauthCandidates(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const pages = await this.settings.getMessengerOauthStash(tenantId);
    // At agency scale the grant can hold a hundred client pages. Tell the
    // picker which ones are already spoken for, so staff never taps a page
    // that belongs to another salon and hits the page_in_use error.
    const ids = pages.map((p) => p.id);
    const bound = await this.prisma.messengerPage.findMany({ where: { pageId: { in: ids } }, select: { pageId: true, tenantId: true } }).catch(() => []);
    const legacy = await this.prisma.messengerConnection.findMany({ where: { pageId: { in: ids } }, select: { pageId: true, tenantId: true } }).catch(() => []);
    const owner = new Map<string, string>();
    for (const row of [...bound, ...legacy]) if (row.pageId && !owner.has(row.pageId)) owner.set(row.pageId, row.tenantId);
    // Names of the other salons — shown so staff can see WHERE a page went.
    const otherIds = Array.from(new Set(Array.from(owner.values()).filter((t) => t !== tenantId)));
    const others = otherIds.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true } }).catch(() => [])
      : [];
    const nameOf = new Map(others.map((t) => [t.id, t.name]));
    return pages.map((p) => {
      const own = owner.get(p.id);
      return {
        id: p.id,
        name: p.name || p.id,
        taken: own ? (own === tenantId ? ('this' as const) : ('other' as const)) : null,
        takenBy: own && own !== tenantId ? nameOf.get(own) || null : null,
      };
    });
  }

  /** Staff picked a page — finish the connection with the parked token. */
  async oauthChoose(user: AuthenticatedUser, pageId: string) {
    const tenantId = this.tenantId(user);
    const pages = await this.settings.getMessengerOauthStash(tenantId);
    const page = pages.find((p) => p.id === pageId);
    if (!page) throw new BadRequestException('That page is no longer available — press Connect and run the flow again.');
    const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId }, select: { greeting: true } });
    const res = await this.completeConnect(
      tenantId,
      { id: page.id, name: page.name || '', access_token: page.access_token || '', igId: page.igId ?? null },
      cur?.greeting ?? null,
    );
    if (res === 'page_in_use') throw new BadRequestException('This Page is already connected to another salon in the system. Disconnect it there first.');
    if (res === 'no_page_token') throw new BadRequestException('Meta did not issue a token for this Page — reconnect and grant all permissions.');
    // The stash stays (15-min expiry): an agency connects several pages in a
    // row, one "Use this page" tap each.
    return this.get(user);
  }

  private async audit(tenantId: string, action: string): Promise<void> {
    try { await this.prisma.auditLog.create({ data: { tenantId, action, resourceType: 'messenger' } }); } catch { /* never break */ }
  }

  /** Facebook "Data Deletion Request" callback. Verify the signed_request, delete
   *  the Messenger/Instagram conversation data we hold for that user, and return
   *  the status URL + confirmation code Meta requires. */
  async dataDeletion(signedRequest: string): Promise<{ url: string; confirmation_code: string }> {
    const web = this.webBase();
    const code = crypto.randomBytes(8).toString('hex');
    const parsed = this.parseSignedRequest(signedRequest);
    const userId = parsed?.user_id ? String(parsed.user_id) : '';
    if (userId) {
      // PSID is page-scoped; delete every conversation thread for this sender.
      await this.prisma.messengerThread.deleteMany({ where: { senderId: userId } }).catch(() => undefined);
    }
    return { url: `${web}/data-deletion?id=${code}`, confirmation_code: code };
  }

  private parseSignedRequest(signed: string): { user_id?: string } | null {
    try {
      const [sig, payload] = (signed || '').split('.');
      if (!sig || !payload) return null;
      const expected = crypto.createHmac('sha256', this.appSecret()).update(payload).digest('base64url');
      if (sig !== expected) return null;
      return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { user_id?: string };
    } catch { return null; }
  }

  /** Fully disconnect the salon's Page: unsubscribe our app from its webhook
   *  (best-effort) and delete the stored connection so no token remains. */
  async disconnect(user: AuthenticatedUser, pageId?: string): Promise<{ connected: boolean }> {
    const tenantId = this.tenantId(user);
    if (pageId) {
      // Detach ONE page; the brain and the other pages stay.
      const pg = await this.prisma.messengerPage.findFirst({ where: { tenantId, pageId } });
      if (pg) {
        await fetch(`${GRAPH}/${pg.pageId}/subscribed_apps?access_token=${encodeURIComponent(pg.pageToken)}`, { method: 'DELETE' }).catch(() => undefined);
        await this.prisma.messengerPage.deleteMany({ where: { tenantId, pageId } });
      }
      // If the legacy mirror pointed at this page, repoint it to a survivor.
      const c0 = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
      if (c0?.pageId === pageId) {
        const next = await this.prisma.messengerPage.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
        await this.prisma.messengerConnection.updateMany({
          where: { tenantId },
          data: next
            ? { pageId: next.pageId, igId: next.igId, pageToken: next.pageToken, pageName: next.pageName }
            : { pageId: '', igId: null, pageToken: '', pageName: null },
        });
      }
      await this.audit(tenantId, 'messenger.page_disconnected');
      const left = await this.prisma.messengerPage.count({ where: { tenantId } });
      return { connected: left > 0 };
    }
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (c?.pageId && c?.pageToken) {
      await fetch(`${GRAPH}/${c.pageId}/subscribed_apps?access_token=${encodeURIComponent(c.pageToken)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    const pages = await this.prisma.messengerPage.findMany({ where: { tenantId } });
    for (const pg of pages) {
      await fetch(`${GRAPH}/${pg.pageId}/subscribed_apps?access_token=${encodeURIComponent(pg.pageToken)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await this.prisma.messengerPage.deleteMany({ where: { tenantId } });
    await this.prisma.messengerConnection.deleteMany({ where: { tenantId } });
    await this.audit(tenantId, 'messenger.disconnected');
    return { connected: false };
  }

  async updateSettings(
    user: AuthenticatedUser,
    dto: { pageId?: string; igId?: string; pageToken?: string; enabled?: boolean; greeting?: string; closing?: string; agentName?: string; bizIntro?: string; aiInstruction?: string; botFacts?: BotFact[]; botMode?: 'booking' | 'sales'; leadEmail?: string; humanActiveMins?: number; graceMins?: number },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    const pageId = typeof dto.pageId === 'string' ? dto.pageId.trim() : cur?.pageId ?? '';
    const igId = typeof dto.igId === 'string' ? (dto.igId.trim() || null) : cur?.igId ?? null;
    const pageToken = cleanSecret(dto.pageToken) ?? cur?.pageToken ?? '';
    const data = {
      pageId,
      igId,
      pageToken,
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur?.enabled ?? false,
      greeting: typeof dto.greeting === 'string' ? dto.greeting.slice(0, 500) : cur?.greeting ?? null,
      closing: typeof dto.closing === 'string' ? (dto.closing.trim().slice(0, 500) || null) : ((cur as unknown as { closing?: string | null } | null)?.closing ?? null),
      agentName: typeof dto.agentName === 'string' ? (dto.agentName.trim().slice(0, 80) || null) : ((cur as unknown as { agentName?: string | null } | null)?.agentName ?? null),
      bizIntro: typeof dto.bizIntro === 'string' ? (dto.bizIntro.trim().slice(0, 300) || null) : ((cur as unknown as { bizIntro?: string | null } | null)?.bizIntro ?? null),
      humanActiveMins: Number.isInteger(dto.humanActiveMins) ? Math.min(720, Math.max(1, dto.humanActiveMins as number)) : ((cur as unknown as { humanActiveMins?: number } | null)?.humanActiveMins ?? 15),
      graceMins: Number.isInteger(dto.graceMins) ? Math.min(60, Math.max(0, dto.graceMins as number)) : ((cur as unknown as { graceMins?: number } | null)?.graceMins ?? 5),
      aiInstruction: typeof dto.aiInstruction === 'string' ? dto.aiInstruction.slice(0, 2000) : cur?.aiInstruction ?? null,
      botFacts: (Array.isArray(dto.botFacts) ? dto.botFacts.slice(0, 40) : (cur?.botFacts ?? [])) as unknown as Prisma.InputJsonValue,
      // The mode is a PLATFORM decision (a mis-flip turns a salon's booking bot
      // into a software salesman). Only Lumio hands may change it — the UI hides
      // the switch from salons, and this guard closes the direct-API route too.
      botMode: (user.supportSession === true || user.role === UserRole.SUPER_ADMIN) && (dto.botMode === 'sales' || dto.botMode === 'booking')
        ? dto.botMode
        : ((cur as unknown as { botMode?: string } | null)?.botMode ?? 'booking'),
      leadEmail: (user.supportSession === true || user.role === UserRole.SUPER_ADMIN) && typeof dto.leadEmail === 'string'
        ? (dto.leadEmail.trim().slice(0, 200) || null)
        : ((cur as unknown as { leadEmail?: string | null } | null)?.leadEmail ?? null),
    };
    if (!pageId) throw new BadRequestException('Enter your Facebook Page ID.');
    await this.prisma.messengerConnection.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
    if (data.enabled) {
      // Push the new greeting to EVERY connected page of this tenant — the
      // pre-chat intro screen otherwise keeps showing whatever was set at
      // connect time (a stale greeting the salon thinks they replaced).
      const pages = await this.prisma.messengerPage.findMany({ where: { tenantId }, select: { pageToken: true } }).catch(() => []);
      const tokens = new Set(pages.map((pg) => pg.pageToken).filter(Boolean));
      if (pageToken) tokens.add(pageToken);
      for (const tk of tokens) await this.setupMessengerProfile(tk, data.greeting);
    }
    return this.get(user);
  }

  async listThreads(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.messengerThread.findMany({
      where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 50,
      select: { id: true, senderId: true, senderName: true, lastText: true, handoff: true, updatedAt: true, channel: true },
    });
    return rows;
  }

  async setHandoff(user: AuthenticatedUser, id: string, handoff: boolean) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.messengerThread.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Thread not found');
    await this.prisma.messengerThread.update({ where: { id: row.id }, data: { handoff, handoffAt: handoff ? new Date() : null } as never });
    return { ok: true };
  }

  /** Salon admin labels a conversation with the customer's name (CRM-style).
   *  Used when the Graph profile lookup is unavailable (e.g. pre-approval). */
  async renameThread(user: AuthenticatedUser, id: string, name: string) {
    const tenantId = this.tenantId(user);
    const clean = (name || '').trim().slice(0, 80);
    if (!clean) throw new BadRequestException('Name is required.');
    const row = await this.prisma.messengerThread.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!row) throw new NotFoundException('Thread not found');
    await this.prisma.messengerThread.update({ where: { id: row.id }, data: { senderName: clean } });
    await this.audit(tenantId, 'messenger.thread_renamed');
    return { ok: true as const, name: clean };
  }

  /** Danger zone (salon admin): delete ALL Messenger conversation history for
   *  this tenant — used to start a clean App-Review recording. The Facebook
   *  connection, tokens, webhook subscription and bot settings are untouched. */
  async clearAllConversations(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const res = await this.prisma.messengerThread.deleteMany({ where: { tenantId } });
    await this.audit(tenantId, 'messenger.conversations_cleared');
    return { ok: true as const, removed: res.count };
  }

  /** Remove ONLY Meta-review test turns (content containing "META-REVIEW-") from
   *  this tenant's threads. Real customer messages, threads, tokens and the
   *  Facebook connection are untouched. */
  async clearReviewData(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.messengerThread.findMany({
      where: { tenantId }, select: { id: true, history: true, lastText: true },
    });
    let removed = 0;
    for (const r of rows) {
      const hist = (Array.isArray(r.history) ? r.history : []) as Turn[];
      const kept = hist.filter((t) => !String((t as { content?: unknown }).content ?? '').includes('META-REVIEW-'));
      if (kept.length === hist.length) continue;
      removed += hist.length - kept.length;
      const lastUser = [...kept].reverse().find((t) => t.role === 'user');
      await this.prisma.messengerThread.update({
        where: { id: r.id },
        data: {
          history: kept as unknown as Prisma.InputJsonValue,
          lastText: r.lastText && r.lastText.includes('META-REVIEW-')
            ? (lastUser ? String(lastUser.content).slice(0, 300) : null)
            : r.lastText,
        },
      });
    }
    await this.audit(tenantId, 'messenger.review_data_cleared');
    return { ok: true as const, removed };
  }

  /** Manually send a message from the connected Page to a conversation. The
   *  salon (or a Meta reviewer) triggers a REAL Send API call from the app UI —
   *  this is the user-initiated "live send" the Messenger permission requires. */
  async sendManual(user: AuthenticatedUser, threadId: string | undefined, text: string) {
    const tenantId = this.tenantId(user);
    const body = (text || '').trim();
    if (!body) throw new BadRequestException('Message text is required.');
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (!conn?.pageId || !conn?.pageToken) throw new BadRequestException('Connect a Facebook Page first.');
    const thread = threadId
      ? await this.prisma.messengerThread.findFirst({ where: { id: threadId, tenantId } })
      : await this.prisma.messengerThread.findFirst({ where: { tenantId }, orderBy: { updatedAt: 'desc' } });
    if (!thread) throw new NotFoundException('No conversation yet — the customer must message the Page first (24h messaging window).');

    const pg = await this.prisma.messengerPage.findFirst({ where: { tenantId, pageId: thread.pageId } });
    const sendToken = pg?.pageToken || conn.pageToken;
    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(sendToken)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id: thread.senderId }, messaging_type: 'RESPONSE', message: { text: body.slice(0, 1900) } }),
    });
    const out = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
    this.rememberSentMid(out.message_id);
    if (!res.ok || out.error) {
      // Keep an auditable "Failed" row in the activity log, then surface the error.
      const hist = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
      const failed = [...hist, { role: 'assistant', content: body, manual: true, failed: true, at: new Date().toISOString() }].slice(-MAX_TURNS);
      await this.prisma.messengerThread.update({
        where: { id: thread.id },
        data: { history: failed as unknown as Prisma.InputJsonValue },
      }).catch(() => undefined);
      throw new BadRequestException(out.error?.message || 'Facebook rejected the message (the 24h messaging window may have closed).');
    }
    const sentAtIso = new Date().toISOString(); // single timestamp: history row === API response
    const history = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
    const next = [...history, { role: 'assistant', content: body, manual: true, at: sentAtIso, messageId: out.message_id || null }].slice(-MAX_TURNS);
    await this.prisma.messengerThread.update({
      where: { id: thread.id },
      data: { history: next as unknown as Prisma.InputJsonValue, lastText: thread.lastText ?? null },
    });
    // A human just spoke in this thread — the bot yields immediately (and
    // re-engages per the 15-min/5-min yield rules), so replies never collide.
    await this.prisma.messengerThread.updateMany({
      where: { id: thread.id, tenantId },
      data: { handoff: true, handoffAt: new Date() } as never,
    }).catch(() => undefined);
    await this.audit(tenantId, 'messenger.manual_send');
    const ch = ((thread as unknown as { channel?: string }).channel === 'instagram') ? 'instagram' : 'messenger';
    return { ok: true as const, messageId: out.message_id || null, recipientId: thread.senderId, at: sentAtIso, channel: ch };
  }

  /**
   * Meta only delivers a webhook field when BOTH levels subscribe to it: the
   * APP-level subscription (App Dashboard) and the page-level subscribed_apps.
   * Pages are handled by resubscribeAllPages(); this repairs the APP level —
   * message_echoes was never ticked in the dashboard, so human replies from
   * the Page inbox were invisible and the bot kept talking over staff.
   * Reads the existing subscription (its exact callback_url), unions the
   * fields and re-POSTs with our verify token. Meta re-verifies the callback
   * via GET, which our webhook answers. Cached 10 minutes.
   */
  private appSubCache: { at: number; fields: string[]; echoOk: boolean } | null = null;
  private async ensureAppSubscription(force = false, object: 'page' | 'instagram' = 'page'): Promise<{ fields: string[]; echoOk: boolean; error?: string }> {
    if (object === 'page' && !force && this.appSubCache && Date.now() - this.appSubCache.at < 10 * 60_000) {
      return { fields: this.appSubCache.fields, echoOk: this.appSubCache.echoOk };
    }
    const out: { fields: string[]; echoOk: boolean; error?: string } = { fields: [], echoOk: false };
    try {
      const id = this.appId();
      const secret = this.appSecret();
      if (!id || !secret) { out.error = 'FB_APP_ID/FB_APP_SECRET not set'; return out; }
      const token = `${id}|${secret}`;
      const res = await fetch(`${GRAPH}/${id}/subscriptions?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { object?: string; callback_url?: string; fields?: ({ name?: string } | string)[] }[];
      };
      const sub = (json.data || []).find((d) => d.object === object);
      const names = (sub?.fields || [])
        .map((f) => (typeof f === 'string' ? f : f?.name || ''))
        .filter(Boolean);
      out.fields = names;
      const need = ['messages', 'messaging_postbacks', 'message_echoes'];
      const missing = need.filter((n) => !names.includes(n));
      if (!missing.length) {
        out.echoOk = true;
      } else if (sub?.callback_url || object === 'instagram') {
        // Instagram may have NO subscription yet — reuse the page callback URL,
        // which is the same webhook endpoint.
        const callback = sub?.callback_url
          || (await this.pageCallbackUrl(token, id))
          || `${this.apiBase()}/api/messenger/webhook`;
        const fields = Array.from(new Set([...names, ...need, 'message_reactions'])).join(',');
        const body = new URLSearchParams({
          object,
          callback_url: callback,
          fields,
          verify_token: this.verifyToken(),
          access_token: token,
        });
        const fix = await fetch(`${GRAPH}/${id}/subscriptions`, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
        const fixJson = (await fix.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
        if (fixJson.success) {
          out.fields = fields.split(',');
          out.echoOk = true;
          this.logger.log(`app webhook subscription (${object}) repaired: added ${missing.join(', ')}`);
        } else {
          out.error = String(fixJson.error?.message || 'Meta refused without a message').slice(0, 300);
          this.logger.warn(`app webhook repair refused (${object}): ${out.error}`);
        }
      }
    } catch (e) {
      out.error = String(e).slice(0, 300);
      this.logger.warn(`app subscription check failed: ${out.error}`);
    }
    if (object === 'page') this.appSubCache = { at: Date.now(), fields: out.fields, echoOk: out.echoOk };
    return out;
  }

  /** Read the callback URL Meta already has for this app (any object), so an
   *  Instagram subscription reuses the exact verified endpoint. */
  private async pageCallbackUrl(appToken: string, appId: string): Promise<string | null> {
    try {
      const res = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
      const json = (await res.json().catch(() => ({}))) as { data?: { callback_url?: string }[] };
      return (json.data || []).map((d) => d.callback_url).find(Boolean) || null;
    } catch {
      return null;
    }
  }

  /** Verify the connected Page is subscribed to our app's webhook (the
   *  pages_manage_metadata use case) and return the Page name + subscribed fields.
   *  This reads GET /{page-id}/subscribed_apps straight from the Graph API so the
   *  UI shows the real subscription state, not a hard-coded label. */
  async webhookStatus(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (!c?.pageId || !c?.pageToken) return { connected: false as const };
    let pageName = c.pageName || '';
    let subscribed = false;
    let fields: string[] = [];
    try {
      // Page name is captured at connect (pages_show_list). Only hit the Graph
      // node as a fallback — a direct name read can require pages_read_engagement.
      if (!pageName) {
        const nameRes = await fetch(`${GRAPH}/${c.pageId}?fields=name&access_token=${encodeURIComponent(c.pageToken)}`, { signal: AbortSignal.timeout(8000) });
        const nameJson = (await nameRes.json().catch(() => ({}))) as { name?: string };
        pageName = nameJson.name || '';
      }
      const subRes = await fetch(`${GRAPH}/${c.pageId}/subscribed_apps?access_token=${encodeURIComponent(c.pageToken)}`, { signal: AbortSignal.timeout(8000) });
      const subJson = (await subRes.json().catch(() => ({}))) as { data?: { subscribed_fields?: string[] }[] };
      const app = (subJson.data || [])[0];
      subscribed = Boolean(app);
      fields = app?.subscribed_fields || [];
    } catch (e) {
      this.logger.warn(`webhook status check failed: ${String(e).slice(0, 120)}`);
    }
    const appSub = await this.ensureAppSubscription(true);
    // Instagram diagnostics — surfaced so a blocked DM pipeline can be read
    // from the dashboard instead of guessed at.
    const igOn = process.env.FB_ENABLE_INSTAGRAM === '1' || process.env.FB_ENABLE_INSTAGRAM === 'true';
    let ig: { enabled: boolean; igId: string | null; appObject: string[]; appError?: string; accountSub?: string } | undefined;
    if (igOn) {
      const pg = await this.prisma.messengerPage.findFirst({ where: { tenantId }, select: { igId: true, pageToken: true } }).catch(() => null);
      const igSub = await this.ensureAppSubscription(true, 'instagram');
      let accountSub = 'no Instagram account linked';
      if (pg?.igId && pg.pageToken) {
        try {
          const r = await fetch(`${GRAPH}/${pg.igId}/subscribed_apps?access_token=${encodeURIComponent(pg.pageToken)}`, { signal: AbortSignal.timeout(8000) });
          const j = (await r.json().catch(() => ({}))) as { data?: { subscribed_fields?: string[] }[]; error?: { message?: string } };
          accountSub = j.error?.message ? `ERROR: ${j.error.message}` : (j.data?.length ? `subscribed: ${(j.data[0]?.subscribed_fields || []).join(', ') || '(no fields)'}` : 'NOT subscribed');
        } catch (e) {
          accountSub = `ERROR: ${String(e).slice(0, 120)}`;
        }
      }
      ig = { enabled: true, igId: pg?.igId ?? null, appObject: igSub.fields, appError: igSub.error, accountSub };
    }
    return {
      connected: true as const,
      instagram: ig,
      pageId: c.pageId,
      pageName,
      subscribed,
      fields,
      appFields: appSub.fields,
      echoOk: appSub.echoOk && fields.includes('message_echoes'),
      verifiedAt: new Date().toISOString(),
      webhookUrl: `${this.apiBase()}/api/messenger/webhook`,
    };
  }

  /** Flatten recent conversation turns into a chronological activity log
   *  (incoming customer messages + outgoing app replies, newest first). Powers
   *  the "Messenger Activity" evidence block a reviewer records. */
  async activity(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId }, select: { pageName: true, pageId: true, pageToken: true } });
    // Opportunistic backfill: try to resolve missing customer names for the few
    // most-recent threads (e.g. right after the person accepted a Tester role) —
    // no new inbound message required, just a Refresh.
    if (conn?.pageToken) {
      const nameless = await this.prisma.messengerThread.findMany({
        where: { tenantId, senderName: null, updatedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
        orderBy: { updatedAt: 'desc' }, take: 3,
        select: { id: true, senderId: true },
      });
      for (const t of nameless) {
        // Cooldown: a lookup Meta rejects (pre-approval) would otherwise retry on
        // every 8s poll and spam the logs — try each thread at most every 15 min.
        const last = this.nameLookupTriedAt.get(t.id) ?? 0;
        if (Date.now() - last < 15 * 60 * 1000) continue;
        this.nameLookupTriedAt.set(t.id, Date.now());
        const name = await this.fetchSenderName(conn.pageToken, t.senderId);
        if (name) await this.prisma.messengerThread.update({ where: { id: t.id }, data: { senderName: name } }).catch(() => undefined);
      }
    }
    const rows = await this.prisma.messengerThread.findMany({
      where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 20,
      select: { id: true, senderId: true, senderName: true, history: true, updatedAt: true, channel: true },
    });
    type Ev = { threadId: string; user: string; direction: 'in' | 'out'; text: string; status: string; at: string; manual: boolean; channel: string };
    const events: Ev[] = [];
    for (const r of rows) {
      const hist = (Array.isArray(r.history) ? r.history : []) as (Turn & { manual?: boolean; failed?: boolean; at?: string })[];
      const ch = ((r as unknown as { channel?: string }).channel === 'instagram') ? 'instagram' : 'messenger';
      // Instagram senders are identified by an Instagram-scoped id (IGSID), not a
      // page-scoped id — label it correctly so the log is unambiguous.
      const who = r.senderName || `${ch === 'instagram' ? 'IGSID' : 'PSID'} …${String(r.senderId).slice(-6)}`;
      for (const turn of hist) {
        const isIn = turn.role === 'user';
        events.push({
          threadId: r.id,
          user: who,
          direction: isIn ? 'in' : 'out',
          text: String(turn.content || '').slice(0, 300),
          status: isIn ? 'Received' : (turn.failed ? 'Failed' : 'Sent'),
          at: turn.at || r.updatedAt.toISOString(),
          manual: Boolean(turn.manual),
          channel: ch,
        });
      }
    }
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { page: conn?.pageName || '', pageId: conn?.pageId || '', events: events.slice(0, 60) };
  }

  // ---- webhook -------------------------------------------------------------
  verify(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.verifyToken()) return challenge;
    return null;
  }

  /** Meta POSTs message events here. We ack immediately and process async. */
  async handleWebhook(body: unknown): Promise<void> {
    const b = body as { object?: string; entry?: { id?: string; messaging?: MessagingEvent[] }[] };
    // Instagram Direct and Messenger arrive on the SAME webhook; the object tells
    // them apart. We keep the channel on the conversation so the dashboard (and
    // an App Review reviewer) can see which surface each message came from.
    const channel: Channel = b?.object === 'instagram' ? 'instagram' : 'messenger';
    // "page" = Facebook Messenger, "instagram" = Instagram DMs (same event shape).
    if ((b?.object !== 'page' && b?.object !== 'instagram') || !Array.isArray(b.entry)) return;
    for (const entry of b.entry) {
      const entryId = entry.id || ''; // Page id (Messenger) or IG account id (Instagram)
      for (const ev of entry.messaging || []) {
        const senderId = ev.sender?.id;
        if (!senderId) continue;
        // "Get Started" tap: the customer opened the chat but hasn't typed yet.
        // This is the salon's ONE chance to speak first — greet immediately.
        if (ev.postback?.payload && !ev.message) {
          const payload = ev.postback.payload;
          if (payload.startsWith('ASK_PKG:')) {
            // A package-card button tap = the customer saying "tell me about X".
            const pkg = payload.slice('ASK_PKG:'.length);
            await this.handleMessage(entryId, senderId, `Tôi muốn tư vấn ${pkg}`, ev.timestamp, channel).catch((e) =>
              this.logger.warn(`pkg postback failed: ${String(e).slice(0, 160)}`),
            );
            continue;
          }
          await this.handleGetStarted(entryId, senderId).catch((e) =>
            this.logger.warn(`greeting failed: ${String(e).slice(0, 160)}`),
          );
          continue;
        }
        const text = ev.message?.text;
        // Echo of an outbound message. Ours carry the LUMIO_BOT tag; an echo
        // WITHOUT it means a human typed in the Page inbox — the bot yields
        // that conversation instantly (auto take-over; bot re-engages per the 15-min/5-min yield rules).
        if (ev.message?.is_echo) {
          const ours = ev.message?.metadata === 'LUMIO_BOT' || (ev.message?.mid ? this.sentMids.has(ev.message.mid) : false);
          if (!ours && ev.recipient?.id) {
            await this.pauseForHuman(entryId, ev.recipient.id, ev.message?.text).catch(() => undefined);
          }
          continue;
        }
        if (!text) continue;
        await this.handleMessage(entryId, senderId, text, ev.timestamp, channel).catch((e) =>
          this.logger.warn(`handleMessage failed: ${String(e).slice(0, 160)}`),
        );
      }
    }
  }

  /**
   * Customer tapped "Get Started". Send the salon's configured greeting (the
   * field on the Messenger settings page — until now it was saved but never
   * spoken). Recorded into the thread history so the AI knows the hello already
   * happened and goes straight to booking instead of greeting twice.
   */
  private async handleGetStarted(entryId: string, senderId: string): Promise<void> {
    const page = await this.pageByEntry(entryId);
    if (!page || !page.enabled) return;
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId: page.tenantId } });
    if (!conn || !conn.enabled) return;
    const thread = await this.prisma.messengerThread.upsert({
      where: { pageId_senderId: { pageId: page.pageId, senderId } },
      update: {},
      create: { tenantId: page.tenantId, pageId: page.pageId, senderId, lastText: '👋 (opened chat)' },
    });
    if (thread.handoff) return;
    let greeting = (conn.greeting || '').trim();
    if (!greeting) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: conn.tenantId }, select: { name: true } });
      const cp = conn as unknown as { botMode?: string; agentName?: string | null; bizIntro?: string | null };
      const mode = cp.botMode === 'sales' ? 'sales' : 'booking';
      const who = cp.agentName ? `I'm ${cp.agentName} from` : 'Welcome to';
      greeting = mode === 'sales'
        ? `Hi! 👋 ${who} ${tenant?.name || 'Lumio'}${cp.bizIntro ? ` — ${cp.bizIntro}` : ''}. How can we help your business today?`
        : `Hi! 👋 ${who} ${tenant?.name || 'our salon'}. I can book your appointment right here — which service would you like?`;
    }
    await this.sendText(page.pageToken, senderId, greeting);
    const history = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
    const next = [...history, { role: 'assistant', content: greeting, at: new Date().toISOString() }].slice(-MAX_TURNS);
    await this.prisma.messengerThread.update({
      where: { id: thread.id },
      data: { history: next as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Resolve an incoming entry id (Facebook page id or IG account id) to the
   * page row + its tenant. New pages live in messenger_pages; connections made
   * before the multi-page era fall back to the legacy columns.
   */
  private async pageByEntry(entryId: string): Promise<{ tenantId: string; pageId: string; pageToken: string; enabled: boolean } | null> {
    const pg = await this.prisma.messengerPage.findFirst({ where: { OR: [{ pageId: entryId }, { igId: entryId }] } });
    if (pg) return { tenantId: pg.tenantId, pageId: pg.pageId, pageToken: pg.pageToken, enabled: pg.enabled };
    const legacy = await this.prisma.messengerConnection.findFirst({ where: { OR: [{ pageId: entryId }, { igId: entryId }] } });
    if (legacy?.pageId && legacy.pageToken) return { tenantId: legacy.tenantId, pageId: legacy.pageId, pageToken: legacy.pageToken, enabled: legacy.enabled };
    return null;
  }

  /** A human answered from the Page inbox — the bot steps aside on that thread,
   *  and the human's words go into the SAME history the bot reads. Without this
   *  the bot is blind to everything staff discussed: when the customer returns
   *  weeks later it would greet them like a stranger — the #1 trust killer. */
  private async pauseForHuman(entryId: string, customerId: string, text?: string): Promise<void> {
    const page = await this.pageByEntry(entryId);
    if (!page) return;
    const thread = await this.prisma.messengerThread.findFirst({ where: { pageId: page.pageId, senderId: customerId } });
    if (!thread) return;
    const body = (text || '').trim();
    if (body) {
      const hist = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
      const last = hist[hist.length - 1];
      // sendManual already stored this exact message — its echo must not duplicate it
      if (!(last && last.role === 'assistant' && last.content.slice(0, 1000) === body.slice(0, 1000))) {
        await this.appendTurns(thread.id, hist, this.threadSummary(thread), [
          { role: 'assistant', content: body.slice(0, 1000), manual: true, at: new Date().toISOString() },
        ]);
      }
    }
    await this.prisma.messengerThread.update({
      where: { id: thread.id },
      data: { handoff: true, handoffAt: new Date() } as never,
    }).catch(() => undefined);
  }

  private threadSummary(t: unknown): string | null {
    return (t as { summary?: string | null }).summary ?? null;
  }

  /**
   * Append turns to a thread's short-term history. Anything that falls off the
   * 12-turn window is NOT thrown away: it is distilled (async, best-effort)
   * into the thread's long-term CUSTOMER MEMORY, so a customer returning after
   * months still meets a bot that remembers them.
   */
  private async appendTurns(threadId: string, history: Turn[], summary: string | null, turns: Turn[]): Promise<void> {
    const full = [...history, ...turns];
    const next = full.slice(-MAX_TURNS);
    const dropped = full.slice(0, full.length - next.length);
    await this.prisma.messengerThread.update({
      where: { id: threadId },
      data: { history: next as unknown as Prisma.InputJsonValue },
    }).catch(() => undefined);
    if (dropped.length) {
      void this.distillThreadSummary(threadId, summary, dropped).catch((e) =>
        this.logger.warn(`memory distill failed: ${String(e).slice(0, 120)}`),
      );
    }
  }

  /** Merge soon-to-be-forgotten turns into the permanent customer profile. */
  private async distillThreadSummary(threadId: string, prev: string | null, dropped: Turn[]): Promise<void> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return;
    const lines = dropped.map((t) => `${t.role === 'user' ? 'KHACH' : 'SHOP'}: ${String(t.content).slice(0, 300)}`).join('\n');
    const prompt = `Bạn giữ HỒ SƠ KHÁCH của một hội thoại Messenger dài hạn. Hồ sơ hiện tại:\n${prev || '(trống)'}\n\nCác tin nhắn cũ sắp bị xóa khỏi bộ nhớ ngắn hạn:\n${lines}\n\nViết lại hồ sơ MỚI: gộp cũ + mới, tối đa 120 từ, dạng gạch đầu dòng ngắn — tên khách, SĐT, ngành/tên tiệm, thành phố, gói/dịch vụ đã bàn, thông tin khách đã cung cấp, việc còn dang dở, thái độ/ý định. CHỈ ghi điều đã xuất hiện trong hội thoại, không suy diễn. Trả về đúng nội dung hồ sơ, không lời dẫn.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
    if (text) {
      await this.prisma.messengerThread.update({
        where: { id: threadId },
        data: { summary: text.slice(0, 2000) } as never,
      }).catch(() => undefined);
    }
  }

  private async handleMessage(entryId: string, senderId: string, text: string, eventTs?: number, channel: Channel = 'messenger'): Promise<void> {
    // Route by Facebook Page id OR the linked Instagram account id: any of the
    // tenant's pages leads to the SAME brain — one brain, many mouths.
    const page = await this.pageByEntry(entryId);
    if (!page || !page.enabled) return;
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId: page.tenantId } });
    if (!conn || !conn.enabled) return;
    const pageId = page.pageId;
    const thread = await this.prisma.messengerThread.upsert({
      where: { pageId_senderId: { pageId, senderId } },
      update: { lastText: text.slice(0, 300), channel } as never,
      create: { tenantId: page.tenantId, pageId, senderId, lastText: text.slice(0, 300), channel } as never,
    });
    // Best-effort: resolve the customer's display name once (User Profile API).
    if (!thread.senderName) {
      const name = await this.fetchSenderName(page.pageToken, senderId);
      if (name) await this.prisma.messengerThread.update({ where: { id: thread.id }, data: { senderName: name } }).catch(() => undefined);
    }
    if (thread.handoff) {
      // The customer's message goes into history NOW — if a human handles it,
      // the bot must still remember this exchange when it re-engages later.
      const histNow = (Array.isArray(thread.history) ? thread.history : []) as Turn[];
      const lastNow = histNow[histNow.length - 1];
      if (!(lastNow && lastNow.role === 'user' && lastNow.content === text)) {
        const inIso = eventTs && Number.isFinite(eventTs) ? new Date(eventTs).toISOString() : new Date().toISOString();
        await this.appendTurns(thread.id, histNow, this.threadSummary(thread), [{ role: 'user', content: text, at: inIso }]);
      }
      // Two-tier yielding. The human owns the chat only while they are ACTIVE
      // (typed something in the last 15 minutes). Active → this new customer
      // message gets a 5-minute grace: if no human reply lands in time, the
      // bot answers it. Idle 15+ minutes → the bot takes the thread back NOW.
      // Net effect: a customer never waits more than 5 minutes, ever.
      const at = (thread as unknown as { handoffAt?: Date | null }).handoffAt;
      const activeAgo = at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
      const tune = conn as unknown as { humanActiveMins?: number; graceMins?: number };
      const activeMs = Math.max(1, tune.humanActiveMins ?? 15) * 60_000;
      const graceMs = Math.max(0, tune.graceMins ?? 5) * 60_000;
      if (activeAgo < activeMs && graceMs > 0) {
        this.scheduleGraceReply(thread.id, text, eventTs, at ? new Date(at).getTime() : 0, graceMs);
        return;
      }
      await this.prisma.messengerThread.update({ where: { id: thread.id }, data: { handoff: false, handoffAt: null } as never });
    }

    await this.replyAndRecord({ ...conn, pageToken: page.pageToken }, thread.id, senderId, text, eventTs);
  }

  // Yield windows are per-tenant settings now (humanActiveMins / graceMins on
  // the connection); 15 and 5 minutes are just the defaults.
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  /** Message ids WE sent. Instagram echoes drop the metadata tag, so the tag
   *  alone cannot tell our own message from a human's — the id can. Kept ~10
   *  minutes, which is far longer than an echo takes to arrive. */
  private readonly sentMids = new Map<string, number>();
  private rememberSentMid(mid?: string | null): void {
    if (!mid) return;
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, at] of this.sentMids) if (at < cutoff) this.sentMids.delete(k);
    this.sentMids.set(mid, Date.now());
  }
  /** package-card image availability cache (static files on the web app) */
  private readonly cardImgOk = new Map<string, boolean>();

  /**
   * The human is mid-conversation: hold the bot for GRACE_MS. If the human
   * answers meanwhile (their echo re-stamps handoffAt), the timer sees the
   * newer stamp and stands down. A newer customer message replaces the timer,
   * so the bot answers the LATEST message once, not every queued one.
   */
  private scheduleGraceReply(threadId: string, text: string, eventTs: number | undefined, stampAtSchedule: number, graceMs: number): void {
    const prev = this.graceTimers.get(threadId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.graceTimers.delete(threadId);
      void (async () => {
        const th = await this.prisma.messengerThread.findUnique({ where: { id: threadId } });
        if (!th || !th.handoff) return; // released meanwhile — the normal flow has it
        const at = (th as unknown as { handoffAt?: Date | null }).handoffAt;
        if (at && new Date(at).getTime() > stampAtSchedule) return; // human DID reply — stand down
        const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId: th.tenantId } });
        if (!conn || !conn.enabled) return;
        const pg = await this.prisma.messengerPage.findUnique({ where: { pageId: th.pageId } }).catch(() => null);
        const token = pg?.pageToken || conn.pageToken;
        if (!token) return;
        await this.prisma.messengerThread.update({ where: { id: threadId }, data: { handoff: false, handoffAt: null } as never }).catch(() => undefined);
        await this.replyAndRecord({ ...conn, pageToken: token }, threadId, th.senderId, text, eventTs);
      })().catch((e) => this.logger.warn(`grace reply failed: ${String(e).slice(0, 120)}`));
    }, graceMs);
    timer.unref?.();
    this.graceTimers.set(threadId, timer);
  }

  /** Build the reply with the right brain and persist the exchange. */
  private async replyAndRecord(
    conn: { tenantId: string; pageToken: string; aiInstruction: string | null; botFacts: unknown },
    threadId: string,
    senderId: string,
    text: string,
    eventTs?: number,
  ): Promise<void> {
    const fresh = await this.prisma.messengerThread.findUnique({ where: { id: threadId } });
    if (!fresh) return;
    const history = (Array.isArray(fresh.history) ? fresh.history : []) as Turn[];
    // The customer turn may already be in history (recorded on arrival during a
    // human-handled stretch) — never store it twice.
    const lastTurn = history[history.length - 1];
    const userAlready = Boolean(lastTurn && lastTurn.role === 'user' && lastTurn.content === text);
    // Long-term memory + how long they were away (returning-customer handling).
    const memory = this.threadSummary(fresh);
    const prevTurn = userAlready ? history[history.length - 2] : lastTurn;
    const prevAtMs = prevTurn?.at ? new Date(prevTurn.at).getTime() : 0;
    const gapDays = prevAtMs ? Math.floor((Date.now() - prevAtMs) / 86_400_000) : 0;
    let reply: string;
    try {
      const instruction = [this.factsText(conn.botFacts), conn.aiInstruction || ''].filter(Boolean).join('\n');
      const cx = conn as unknown as { botMode?: string; leadEmail?: string | null };
      // Hard deadline over the WHOLE agent run (model + tools + card images).
      // Whatever stalls, the customer still gets an answer instead of silence.
      reply = await this.withDeadline(this.runAgent(conn.tenantId, instruction, userAlready ? history.slice(0, -1) : history, text, {
        mode: cx.botMode === 'sales' ? 'sales' : 'booking',
        leadEmail: cx.leadEmail ?? null,
        threadId,
        closing: (conn as unknown as { closing?: string | null }).closing ?? null,
        agentName: (conn as unknown as { agentName?: string | null }).agentName ?? null,
        bizIntro: (conn as unknown as { bizIntro?: string | null }).bizIntro ?? null,
        senderId,
        pageToken: conn.pageToken,
        memory,
        gapDays,
      }), 55_000, 'agent');
    } catch (e) {
      this.logger.warn(`agent error: ${String(e).slice(0, 160)}`);
      reply = 'Thanks for your message! A team member will get back to you shortly. 💕';
    }
    // A human may have taken over WHILE we were generating (their echo flips
    // handoff on this thread). Sending now would talk over them — drop the
    // reply, keep only the customer's turn so context survives.
    const guard = await this.prisma.messengerThread.findUnique({ where: { id: threadId }, select: { handoff: true } }).catch(() => null);
    if (guard?.handoff) {
      if (!userAlready) {
        const inAtDrop = eventTs && Number.isFinite(eventTs) ? new Date(eventTs).toISOString() : new Date().toISOString();
        await this.appendTurns(threadId, history, memory, [{ role: 'user', content: text, at: inAtDrop }]);
      }
      return;
    }
    await this.sendText(conn.pageToken, senderId, reply);
    // Inbound = Meta's own webhook timestamp (ms epoch); outbound = when we actually sent.
    const inAt = eventTs && Number.isFinite(eventTs) ? new Date(eventTs).toISOString() : new Date().toISOString();
    const outAt = new Date().toISOString();
    const newTurns: Turn[] = userAlready
      ? [{ role: 'assistant', content: reply, at: outAt }]
      : [{ role: 'user', content: text, at: inAt }, { role: 'assistant', content: reply, at: outAt }];
    await this.appendTurns(threadId, history, memory, newTurns);
  }

  // ---- AI agent (tool use) -------------------------------------------------
  private async runAgent(
    tenantId: string,
    aiInstruction: string,
    history: Turn[],
    userText: string,
    ctx: { mode: 'booking' | 'sales'; leadEmail: string | null; threadId?: string; closing?: string | null; agentName?: string | null; bizIntro?: string | null; senderId?: string; pageToken?: string; memory?: string | null; gapDays?: number } = { mode: 'booking', leadEmail: null },
  ): Promise<string> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return 'Thanks for reaching out! A team member will reply to you shortly. 💕';

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true, contactPhone: true, contactEmail: true } });
    const salonName = tenant?.name || 'our salon';
    const tz = tenant?.timezone || 'America/New_York';
    const infoBlock = await this.systemKnowledge(tenantId, tenant?.contactPhone ?? null, tenant?.contactEmail ?? null);
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const bookingSystem = `You are the booking assistant for "${salonName}", a nail salon, chatting with a customer on Facebook Messenger. Your ONE job: make booking feel effortless. Write like a warm, real receptionist — natural and easy-going, never robotic, never salesy.
Always reply in the SAME language the customer uses. In Vietnamese, be politely warm: use "dạ" and "ạ", and address the customer as "anh/chị" when it fits. Once you know their name, use it naturally.
KEEP IT SIMPLE — these rules beat everything else:
- 1-2 short sentences per message (3 absolute max). A light emoji sometimes; never a wall of text.
- Ask for exactly ONE thing per message. Never stack questions.
- Never re-ask anything already answered in this conversation.
- When they don't know what they want, suggest 2-3 popular services — not the whole menu. Share the full list only if they ask.
- No jargon, no policies, no long explanations unless they ask.
- Off-topic question? Answer in one friendly line, then gently return to the booking.
If the conversation is just starting and the customer hasn't said what they need, greet briefly and ask which service they'd like (if a greeting was already sent, don't greet again — go straight to helping).
To book you need ONLY: name, phone number, service, and a specific date & time. Collect the missing piece one question at a time — nothing more.
Email is OPTIONAL: mention once that a confirmation email is possible; if they skip it, book without it and never bring it up again.
Right before booking, recap in ONE short line ("Gel manicure, Friday 2:00 PM, for Anna — shall I book it?").
Use the get_services tool for what's available and the service ids. When you have name + phone + service + a specific date/time, call create_booking (include email only if given). After it succeeds, confirm warmly in one line and say a confirmation is on the way.
If they ask about an EXISTING appointment (time, changes, cancelling), do not guess or state details from memory — say a staff member will check and follow up shortly.
CRITICAL: Only tell the customer the booking is confirmed if the create_booking tool result starts with "SUCCESS". If the tool returns an error, NEVER claim the booking was made — apologize, briefly explain the problem in plain words, and offer another time or ask for corrected details.
As a kind final touch AFTER the booking is confirmed, mention the salon loves to send a little birthday treat and gently ask if they'd like to share their birthday (just the month and day) — make it clear this is entirely optional. If they share it, call save_birthday with their phone. If they decline, hesitate, or don't answer, that is completely fine — thank them warmly and never push or ask again.
The salon's local time right now is: ${nowLocal} (timezone ${tz}). Interpret "today/tomorrow/this Friday" in that timezone.
${infoBlock ? infoBlock + '\n' : ''}Only state hours, prices, services, address, and contact info that are given to you here; never invent them. Do not book or promise a time outside business hours — if the customer asks for a closed day or time, tell them the salon is closed then and offer the nearest open time. If the customer is upset or asks for a human, tell them a staff member will follow up soon. Do not ask for payment.${aiInstruction ? `\nSalon owner's extra notes: ${aiInstruction}` : ''}`;

    const bookingTools = [
      { name: 'get_services', description: 'List this salon’s bookable services with their id, name, price and duration.', input_schema: { type: 'object', properties: {}, required: [] } },
      {
        name: 'create_booking',
        description: 'Create the appointment. Only call once you have the customer name, phone, a chosen service id, and a specific local date & time.',
        input_schema: {
          type: 'object',
          properties: {
            customerFirstName: { type: 'string' },
            customerPhone: { type: 'string' },
            serviceId: { type: 'string' },
            localDateTime: { type: 'string', description: 'Salon local time in ISO form, e.g. 2026-07-10T14:00' },
            customerEmail: { type: 'string', description: 'Optional. The customer email for an email confirmation; omit entirely if they did not give one.' },
          },
          required: ['customerFirstName', 'customerPhone', 'serviceId', 'localDateTime'],
        },
      },
      {
        name: 'save_birthday',
        description: "Save the customer's birthday so the salon can send a birthday treat. Only call after they willingly share it — it is always optional and asked only after the booking is confirmed.",
        input_schema: {
          type: 'object',
          properties: {
            customerPhone: { type: 'string', description: 'The same phone number used to book, to find the customer.' },
            birthDate: { type: 'string', description: 'Birthday as YYYY-MM-DD. If the year is unknown, use 2000, e.g. 2000-05-20.' },
          },
          required: ['customerPhone', 'birthDate'],
        },
      },
    ];

    // ---- SALES brain: the agency's own page. Same engine, different job —
    // introduce Lumio to salon owners and hand WARM LEADS to the human team.
    // Facts discipline is identical to the booking bot: the model may only
    // state what the owner typed into Bot facts / AI instruction.
    const bizIntro = ctx.bizIntro
      || 'a marketing & technology agency for local businesses — booking software, AI chat, websites and advertising';
    const salesSystem = `You are a sales & customer-care team member of "${salonName}" — ${bizIntro}. You chat on Facebook Messenger with business owners and people asking about the services.
Your ONE job: answer simply, connect the right service to their business's pain, and hand a warm lead to the sales team. Warm and natural — never pushy, never robotic.
Always reply in the SAME language the customer uses. In Vietnamese: xưng "em", gọi khách "anh/chị", dùng "dạ/ạ".
KEEP IT SIMPLE — these rules beat everything else:
- 1-2 short sentences per message (3 max). Ask for exactly ONE thing per message.
- Never re-ask anything already answered in this conversation.
- ONLY state prices, features, policies and links that appear in the FACTS below. If something is not covered: say the team will confirm it, and capture the lead. NEVER invent, never negotiate prices, never take payment in chat.
- Off-topic? One friendly line, then gently back to how Lumio can help their business.
FLOW:
- Start by asking what their business struggles with — or answer their question first if they asked one. If a greeting was already sent, don't greet twice.
- Match their pain to at most TWO services/features from the facts. Share the demo link when it helps.
- Asked about pricing or the packages in general (or comparing them): call send_price_cards IMMEDIATELY — never type the whole list as text, never ask permission first, and never say words like "visual cards" or "carousel" (just send, then speak normally). After it succeeds, send ONE short line asking which one fits their goal.
- Asked about ONE specific package (or they tapped its card): give a mini-pitch from the facts, max 6 short lines in this shape — line 1: what it does for THEIR shop; 2–3 lines starting with "• ": the concrete deliverables; one line: how it differs from the neighbor package (the one cheaper or pricier); last line: the free things included. Then ONE question to move forward. Plain text only.
- Asked to compare Lumio with other agencies / booking software / hiring staff (or "why should I pick you"): answer from the competitor-gap fact — contrast by CATEGORY (typical agency, plain booking software, hiring a receptionist), never name or criticize a specific company, keep it factual, and end with ONE free hook.
- Asked how the packages DIFFER or which to pick: do NOT resend cards. Answer as a short ladder from the facts — one line per package saying what it DOES for their shop (never a feature list), then recommend exactly ONE based on what they told you, and offer the free audit to confirm the fit.
- FREE things are your strongest hook — use them to close and to soften hesitation: the free audit (24–48h, no strings — for EVERYONE), the Booking + AI + POS system given free BY TIER (full system free from Growth Map $279 up; Boost $179 includes the free Booking system; the $45 package includes the free audit only — never promise a free tier the package doesn't include, check the facts), the live demo link, and package gifts from the facts. Mention the free system tiers within your first couple of replies — it's the thing competitors charge for. When a customer hesitates about price, goes quiet, or answers in one word: lead with what's free (audit, free system, demo) as the easy next step — never repeat the same question or push the sale.
- PRICES: before stating ANY price, call quote_price and quote ONLY the currency of the customer's market — Canada → C$, Australia → A$, otherwise USD $. Read their market from anything they said (city, country, "bên Canada/Úc", currency mention); if unknown, use USD. One currency per reply, woven into a natural sentence — never list several currencies unless they ask to compare, never do currency math in your head. If they later reveal a different market, requote in that currency.
- When they show interest, ask for their NAME, then their PHONE (one at a time). Once you have both, call save_lead — include salon name, city and what they care about if mentioned.
- NEVER ask for anything already given or already inside something they shared. A Google Maps / website / Facebook link they sent IS their business identity: pass the link as salonName in save_lead and do NOT ask for the salon name or city afterwards — the team opens the link. Every redundant question makes you feel like a form, not a person.
- BUT the link never replaces their PERSONAL contact: the phone on a Maps/social listing is the shop line and rarely reaches the owner. Always still ask for their name and the number that reaches THEM directly ("số nào gặp trực tiếp anh/chị ạ") — never lift a phone number out of a link or listing.
- LINKS: you cannot open links. Never say you viewed/checked one — say you've received it and the team will look at it. A Maps link + their name + their direct phone number = a COMPLETE audit request, nothing more needed.
- Only say the lead is saved if save_lead returns "SUCCESS". Then confirm warmly: the team will call them soon.
- If they ask for a human, want to negotiate, or ask beyond the facts: promise a callback and call save_lead with note "wants a human".
The current time is ${nowLocal} (timezone ${tz}).
FACTS — the only things you may state as fact:
${aiInstruction || '(no facts loaded yet — capture the lead and let the team answer)'}`;

    const salesTools = [
      {
        name: 'save_lead',
        description: "Save a sales lead for the human team. Call once you have the person's name AND phone number. The team is alerted by email immediately.",
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            salonName: { type: 'string', description: 'Their business name — or the Google Maps/website link they shared, verbatim. A link counts fully; never ask for the name when you have a link.' },
            city: { type: 'string' },
            interest: { type: 'string', description: 'What they asked about: plan, POS, multi-location…' },
            note: { type: 'string', description: 'One-line summary of their situation, or "wants a human".' },
          },
          required: ['name', 'phone'],
        },
      },
      {
        name: 'get_pricing',
        description: 'Re-read the structured fact sheet (plans, prices, links) to double-check before answering.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'quote_price',
        description: 'Compute the EXACT price in USD, CAD and AUD (fixed rates, website-matched rounding). Call this EVERY time you are about to state a price, then quote ONLY the currency of the customer\'s market (USD if unknown) — never convert currencies yourself.',
        input_schema: {
          type: 'object',
          properties: {
            amountUsd: { type: 'number', description: 'Base USD amount: the MONTHLY price for subscriptions, or the one-time price.' },
            billing: { type: 'string', enum: ['once', 'monthly'] },
            months: { type: 'integer', description: 'Monthly billing only: total months. 6 → 5% off, 12 → 10% off, others → no discount.' },
          },
          required: ['amountUsd', 'billing'],
        },
      },
      {
        name: 'send_price_cards',
        description: 'Send the packages as swipeable visual cards (native Messenger carousel) — ALWAYS use this instead of typing a list when the customer asks about pricing or packages in general. After SUCCESS, follow with ONE short line asking which fits.',
        input_schema: {
          type: 'object',
          properties: { category: { type: 'string', enum: ['marketing', 'website', 'all'], description: 'Which set of packages to show.' } },
          required: ['category'],
        },
      },
    ];

    // The goodbye matters as much as the hello: when the chat wraps up (they
    // thank you, say bye, or everything is done), close warmly — the owner can
    // set the spirit of that goodbye, the bot adapts it per language/moment.
    const closingRule = ctx.closing
      ? `\nCLOSING: when the conversation wraps up (thanks, goodbye, or all done), end with ONE warm goodbye in the customer's language, in the spirit of: "${ctx.closing}" — adapt it naturally, never paste it robotically, never add a sales push.`
      : `\nCLOSING: when the conversation wraps up (thanks, goodbye, or all done), end with ONE warm goodbye in the customer's language — thank them and wish them well. No sales push in the goodbye.`;

    // Persona: the owner wants a named colleague, not "the assistant". The bot
    // introduces itself by name and never volunteers being automated; asked
    // point-blank, it does NOT lie — it pivots to "the team is right here" and
    // offers a call, which keeps trust AND platform rules intact.
    const personaRule = `\nPERSONA: ${ctx.agentName ? `Your name is ${ctx.agentName}. Introduce yourself by name, like any team member would — never call yourself an assistant, AI or bot. ` : ''}Never volunteer that this chat is automated. If someone asks point-blank whether you are a bot, do not lie and do not argue: say the ${ctx.mode === 'sales' ? 'team' : 'salon team'} is right behind this chat and offer a quick call back${ctx.mode === 'sales' ? ' (capture the lead)' : ''}.`;

    // Vietnamese small talk is understated — the tell-tale AI openers must go.
    const voiceRule = `\nVOICE: never open or pad replies with exclamations like "Tuyệt vời", "Rất tốt", "Dạ tốt lắm", "Tuyệt quá", "Hoàn hảo", "Chính xác", "Great", "Perfect", "Awesome", "Wonderful". Real Vietnamese chat acknowledges quietly — "Dạ vâng ạ", "Dạ", "Dạ được ạ", "Oke anh/chị" — then gets straight to the point. No hype words, no cheering.`;

    const formatRule = `\nFORMAT: Messenger shows PLAIN TEXT only — markdown is never rendered. Absolutely no **asterisks**, no # headers, no tables. Write prices and options inside natural sentences, not robotic bullet lists; if you must enumerate, short lines with "-" are the maximum.`;

    // Long-term memory: what we know about THIS customer from chats that may be
    // months old — plus, when they return after days away, an explicit order to
    // pick up the thread instead of greeting them like a stranger.
    const memoryBlock = ctx.memory
      ? `\nCUSTOMER MEMORY — facts about THIS customer from earlier conversations (may be days or months old; TRUST it, never re-ask what it already answers):\n${ctx.memory}`
      : '';
    const gapNote = (ctx.gapDays ?? 0) >= 1
      ? `\nRETURNING CUSTOMER: they last spoke ${ctx.gapDays} day(s) ago and just came back. Do NOT restart with a stranger's greeting, do NOT redo discovery, do NOT re-explain at length. Acknowledge them like someone you know, use the memory and the history above, and answer their new message directly — SHORT.`
      : '';
    const system = (ctx.mode === 'sales' ? salesSystem : bookingSystem) + personaRule + voiceRule + formatRule + closingRule + memoryBlock + gapNote;
    const tools = ctx.mode === 'sales' ? salesTools : bookingTools;

    const hist: { role: string; content: unknown }[] = history.map((h) => ({ role: h.role, content: h.content }));
    if (hist.length && hist[0].role === 'assistant') {
      // The thread opened with OUR greeting (Get Started). The API needs a
      // user turn first, so pin a stage direction in front.
      hist.unshift({ role: 'user', content: '(The customer just opened the chat.)' });
    }
    const messages: { role: string; content: unknown }[] = [...hist, { role: 'user', content: userText }];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 500, system, tools, messages }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.logger.warn(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
        return 'Thanks! A team member will get back to you shortly. 💕';
      }
      const data = (await res.json()) as { stop_reason?: string; content?: AnthropicBlock[] };
      const blocks = data.content || [];
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocks });
        const results: unknown[] = [];
        for (const blk of blocks) {
          if (blk.type !== 'tool_use') continue;
          const out = await this.runTool(tenantId, tz, blk.name || '', blk.input || {}, ctx);
          results.push({ type: 'tool_result', tool_use_id: blk.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      return text || 'Got it! How else can I help you book?';
    }
    return 'Thanks! A team member will follow up with you shortly. 💕';
  }

  /**
   * Sales mode: persist the lead and wake the humans. Same phone within 7 days
   * updates the existing row and does NOT re-email — one hot lead, one alert.
   */
  private async saveLead(
    tenantId: string,
    input: Record<string, unknown>,
    ctx?: { leadEmail: string | null; threadId?: string },
  ): Promise<string> {
    const name = String(input.name || '').trim().slice(0, 120);
    const phone = String(input.phone || '').trim().replace(/[^\d+]/g, '');
    if (!name || phone.replace(/\D/g, '').length < 8) {
      return 'ERROR: a real name and a valid phone number are required before saving.';
    }
    const details = {
      salonName: String(input.salonName || '').trim().slice(0, 160) || null,
      city: String(input.city || '').trim().slice(0, 80) || null,
      interest: String(input.interest || '').trim().slice(0, 200) || null,
      note: String(input.note || '').trim().slice(0, 500) || null,
    };
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const existing = await this.prisma.salesLead.findFirst({
      where: { tenantId, phone, createdAt: { gt: since } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.salesLead.update({
        where: { id: existing.id },
        data: { name, ...details, ...(ctx?.threadId ? { threadId: ctx.threadId } : {}) },
      });
      return 'SUCCESS (recent lead updated — the team already has this person).';
    }
    await this.prisma.salesLead.create({
      data: { tenantId, threadId: ctx?.threadId ?? null, name, phone, ...details },
    });
    await this.sendLeadEmail(tenantId, ctx?.leadEmail ?? null, { name, phone, ...details, threadId: ctx?.threadId ?? null })
      .catch((e) => this.logger.warn(`lead email failed: ${String(e).slice(0, 120)}`));
    return 'SUCCESS';
  }

  /** One email to the sales team, with the lead and the last messages for context. */
  private async sendLeadEmail(
    tenantId: string,
    to: string | null,
    lead: { name: string; phone: string; salonName: string | null; city: string | null; interest: string | null; note: string | null; threadId: string | null },
  ): Promise<void> {
    const n = await this.settings.getNotificationSettings(tenantId);
    const recipient = (to || n.adminEmail || n.senderEmail || '').trim();
    if (!recipient) return; // nowhere to send — the Leads tab still has it
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const senderName = n.senderName || tenant?.name || 'Lumio';
    const replyTo = n.replyTo || n.senderEmail || undefined;
    const smtp = n.smtp.user && n.smtp.pass
      ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo, from: `${senderName} <${n.senderEmail || n.smtp.user}>` }
      : undefined;
    const brevo = n.brevo.apiKey && n.senderEmail
      ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo, senderName: n.brevo.senderName || senderName }
      : undefined;
    const gmail = n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
      ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName, replyTo }
      : undefined;
    let transcript = '';
    if (lead.threadId) {
      const th = await this.prisma.messengerThread.findFirst({ where: { id: lead.threadId, tenantId }, select: { history: true } });
      const hist = (Array.isArray(th?.history) ? th!.history : []) as { role: string; content: string }[];
      transcript = hist.slice(-10).map((h) => `${h.role === 'user' ? '👤' : '🤖'} ${h.content}`).join('\n');
    }
    const body = [
      `Name: ${lead.name}`,
      `Phone: ${lead.phone}`,
      lead.salonName ? `Salon: ${lead.salonName}` : '',
      lead.city ? `City: ${lead.city}` : '',
      lead.interest ? `Interested in: ${lead.interest}` : '',
      lead.note ? `Note: ${lead.note}` : '',
      '',
      transcript ? `--- Last messages ---\n${transcript}` : '',
    ].filter(Boolean).join('\n');
    await this.notifications.send({
      tenantId,
      channel: NotificationChannel.EMAIL,
      recipient,
      subject: `🔥 New Messenger lead: ${lead.name} — ${lead.phone}`,
      body,
      smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo,
      relatedType: 'sales_lead', relatedId: lead.phone,
    });
  }

  // ---- Knowledge import (website / fanpage → Bot facts) --------------------

  /**
   * Read the salon's website or its connected Facebook Page and distill the
   * text into Bot-facts rows. IMPORT, not live browsing: the AI proposes rows,
   * a human reviews and saves — the bot still only ever speaks from saved
   * facts, so speed and truthfulness stay under control.
   */
  async importFacts(user: AuthenticatedUser, dto: { source?: string; url?: string }) {
    const tenantId = this.tenantId(user);
    let raw = '';
    if (dto.source === 'paste') {
      raw = String((dto as { text?: string }).text || '').trim().slice(0, 20000);
      if (raw.length < 20) throw new BadRequestException('Paste a bit more content first.');
      return this.classifyContent(raw);
    }
    if (dto.source === 'page') {
      const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
      const firstPg = await this.prisma.messengerPage.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
      const src = (conn?.pageToken && conn.pageId) ? { pageId: conn.pageId, pageToken: conn.pageToken } : firstPg ? { pageId: firstPg.pageId, pageToken: firstPg.pageToken } : null;
      if (!src) throw new BadRequestException('Connect the Facebook Page first.');
      const info = (await fetch(
        `https://graph.facebook.com/v21.0/${src.pageId}?fields=name,about,description,category,website,phone,emails,single_line_address,hours&access_token=${encodeURIComponent(src.pageToken)}`,
      ).then((r) => r.json())) as Record<string, unknown> & { error?: { message?: string } };
      if (info.error) throw new BadRequestException(`Meta: ${info.error.message || 'could not read the page'}`);
      const feed = (await fetch(
        `https://graph.facebook.com/v21.0/${src.pageId}/feed?limit=10&fields=message&access_token=${encodeURIComponent(src.pageToken)}`,
      ).then((r) => r.json()).catch(() => null)) as { data?: { message?: string }[] } | null;
      const posts = (feed?.data || []).map((pp) => pp.message).filter(Boolean).slice(0, 10);
      raw = JSON.stringify({ pageInfo: info, recentPosts: posts }).slice(0, 20000);
    } else {
      const url = String(dto.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new BadRequestException('Enter a full address starting with https://');
      const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
      // No internal addresses: this fetch runs from OUR server.
      if (!host || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
        throw new BadRequestException('That address cannot be read.');
      }
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'LumioBot/1.0 (+https://lumiobooking.com)' } }).catch(() => null);
      if (!res || !res.ok) throw new BadRequestException(`Could not load that page${res ? ` (${res.status})` : ''}.`);
      const html = (await res.text()).slice(0, 400000);
      raw = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20000);
    }
    if (raw.length < 40) throw new BadRequestException('Nothing readable was found at that source.');
    return { facts: await this.distillFacts(raw) };
  }

  /**
   * Freeform paste: the owner dumps whatever they want the bot to carry —
   * promos, price lists, tone notes, a favourite greeting — and the AI sorts
   * it into the right slots. Facts stay verbatim; style goes to instruction;
   * hello/goodbye lines are offered for the greeting/closing fields.
   */
  private async classifyContent(raw: string): Promise<{ facts: BotFact[]; greeting: string | null; closing: string | null; instruction: string | null }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) throw new BadRequestException('AI is not configured on the server.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        system: 'You organize a business owner\'s pasted notes for their chat assistant. Reply with ONLY a JSON object: {"facts": [{"label": string, "value": string}], "greeting": string|null, "closing": string|null, "instruction": string|null}. Rules: facts = up to 15 rows of information customers may be told — VERBATIM-faithful (prices, hours, links, names exactly as written; skip anything unclear; never invent). greeting = only if the notes suggest how to WELCOME customers: one warm line, <=200 chars, in the notes\' language. closing = only if they suggest how to THANK or say goodbye: one warm line, <=200 chars. instruction = only if the notes contain tone/style/selling rules: condensed imperative notes <=400 chars. Use null when a slot has nothing.',
        messages: [{ role: 'user', content: raw }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new BadRequestException('The AI reader is busy — try again in a minute.');
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join(' ');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new BadRequestException('Could not organize that content — try pasting plainer text.');
    try {
      const obj = JSON.parse(m[0]) as { facts?: { label?: unknown; value?: unknown }[]; greeting?: unknown; closing?: unknown; instruction?: unknown };
      const facts = (obj.facts || [])
        .filter((f) => typeof f?.label === 'string' && typeof f?.value === 'string' && (f.label as string).trim() && (f.value as string).trim())
        .slice(0, 15)
        .map((f) => ({ label: (f.label as string).trim().slice(0, 40), value: (f.value as string).trim().slice(0, 300), on: true }));
      const str = (v: unknown, cap: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : null);
      return { facts, greeting: str(obj.greeting, 300), closing: str(obj.closing, 300), instruction: str(obj.instruction, 600) };
    } catch {
      throw new BadRequestException('Could not organize that content — try pasting plainer text.');
    }
  }

  /** Turn raw business text into candidate fact rows. Faithful or nothing. */
  private async distillFacts(raw: string): Promise<BotFact[]> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) throw new BadRequestException('AI is not configured on the server.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'You turn raw business text into a compact fact sheet for a chat assistant. Reply with ONLY a JSON array of {"label": string, "value": string} — no prose. Up to 15 facts. Facts must be VERBATIM-faithful: prices, hours, addresses, links and names exactly as written in the source — never guess, never embellish, skip anything unclear. Prefer: what the business does/sells, plans & prices, key services, address, phone, links, hours, policies. label ≤ 30 chars, value ≤ 200 chars, in the same language as the source.',
        messages: [{ role: 'user', content: raw }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new BadRequestException('The AI reader is busy — try again in a minute.');
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join(' ');
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new BadRequestException('Could not extract facts from that source.');
    try {
      const arr = JSON.parse(m[0]) as { label?: unknown; value?: unknown }[];
      const facts = arr
        .filter((f) => typeof f?.label === 'string' && typeof f?.value === 'string' && (f.label as string).trim() && (f.value as string).trim())
        .slice(0, 15)
        .map((f) => ({ label: (f.label as string).trim().slice(0, 40), value: (f.value as string).trim().slice(0, 300), on: true }));
      if (!facts.length) throw new Error('empty');
      return facts;
    } catch {
      throw new BadRequestException('Could not extract facts from that source.');
    }
  }

  // ---- Leads (sales mode) --------------------------------------------------

  async listLeads(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    return this.prisma.salesLead.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async setLeadStatus(user: AuthenticatedUser, id: string, status: string) {
    const tenantId = this.tenantId(user);
    const ok = ['NEW', 'CONTACTED', 'WON', 'LOST'].includes(status);
    if (!ok) throw new BadRequestException('Unknown status');
    const r = await this.prisma.salesLead.updateMany({ where: { id, tenantId }, data: { status } });
    if (r.count === 0) throw new NotFoundException('Lead not found');
    return { id, status };
  }

  /** Business hours + contact injected into the agent prompt so it can answer
   *  "when are you open?" and never book outside opening times. */
  /**
   * Write the salon's opening line FOR them. Salons stare at an empty greeting
   * box and end up with nothing (or a generic line that sounds like every other
   * shop). This reads what the salon already filled in — services, live
   * discounts, hours, address — plus any keywords they typed, and proposes
   * three ready-to-use greetings. Nothing is saved until they pick one.
   */
  async suggestGreeting(user: AuthenticatedUser, dto: { keywords?: string; lang?: string }): Promise<{ options: string[] }> {
    const tenantId = this.tenantId(user);
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) throw new BadRequestException('AI is not configured on the server.');
    const [tenant, conn] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessType: true, contactPhone: true, contactEmail: true } }),
      this.prisma.messengerConnection.findUnique({ where: { tenantId } }),
    ]);
    // Exactly the same knowledge the live bot uses — one source, never a second
    // copy for the owner to maintain.
    const knowledge = await this.systemKnowledge(tenantId, tenant?.contactPhone ?? null, tenant?.contactEmail ?? null);
    const cp = conn as unknown as { agentName?: string | null; bizIntro?: string | null; botMode?: string } | null;
    const vi = (dto.lang || 'vi') === 'vi';
    const prompt = [
      vi
        ? 'Bạn viết CÂU CHÀO ĐẦU TIÊN cho khung chat Messenger của một doanh nghiệp. Đây là dòng khách đọc trước khi gõ tin đầu tiên.'
        : 'Write the FIRST greeting for a business\'s Messenger chat — the line a customer reads before typing anything.',
      '',
      `TÊN: ${tenant?.name || ''}`,
      `LOẠI HÌNH: ${tenant?.businessType || 'salon'}`,
      cp?.agentName ? `TÊN NHÂN VIÊN TRỰC (xưng tên này): ${cp.agentName}` : '',
      cp?.bizIntro ? `GIỚI THIỆU: ${cp.bizIntro}` : '',
      knowledge ? `DỮ LIỆU THẬT TỪ HỆ THỐNG (dịch vụ, giá, ưu đãi đang chạy, đội ngũ, giờ làm, địa chỉ):\n${knowledge}` : '',
      dto.keywords?.trim() ? `LƯU Ý THÊM CỦA CHỦ TIỆM (bám sát): ${dto.keywords.trim().slice(0, 500)}` : '',
      '',
      vi
        ? 'YÊU CẦU: viết 3 phương án khác nhau, tiếng Việt tự nhiên như người thật nhắn (xưng em, gọi khách anh/chị, có "dạ/ạ"). Mỗi phương án: 2 câu, TỔNG dưới 160 ký tự để vừa màn hình chào của Messenger, kết bằng ĐÚNG MỘT câu hỏi mở. Nêu 1 điểm cụ thể của tiệm (ưu đãi thật, dịch vụ nổi bật, hoặc giờ mở cửa) — không nói chung chung. Tối đa 1 emoji. Không markdown, không dấu **. Không bịa thông tin ngoài dữ liệu trên.'
        : 'REQUIREMENTS: 3 different options, natural English. Each: 2 sentences, UNDER 160 characters total, ending in exactly ONE open question. Mention one concrete thing about this business (a real discount, a signature service, or the hours). Max 1 emoji, no markdown, invent nothing.',
      vi ? 'Trả về JSON: {"options":["...","...","..."]} — không thêm lời dẫn.' : 'Return JSON: {"options":["...","...","..."]} — no preamble.',
    ].filter(Boolean).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    let options: string[] = [];
    try {
      const parsed = JSON.parse(match ? match[0] : text) as { options?: unknown };
      options = Array.isArray(parsed.options) ? parsed.options.filter((o): o is string => typeof o === 'string') : [];
    } catch {
      options = text.split('\n').map((l) => l.replace(/^[\d).\-\s"]+/, '').replace(/"$/, '').trim()).filter((l) => l.length > 20);
    }
    if (!options.length) throw new BadRequestException('AI could not draft a greeting — try again or write it yourself.');
    await this.audit(tenantId, 'messenger.suggest_greeting');
    return { options: options.slice(0, 3).map((o) => o.slice(0, 400)) };
  }

  /**
   * EVERYTHING the bot can learn from the salon's own system — no re-typing.
   * Services with live discounts, staff, hours, address, contact, loyalty and
   * gift cards are read fresh on every conversation, so the bot is never out
   * of date and the owner never maintains a second copy of the same data.
   */
  private async systemKnowledge(tenantId: string, phone: string | null, email: string | null): Promise<string> {
    const out: string[] = [];
    // Plain try/catch instead of `.catch(() => [])` inside Promise.all: that
    // pattern makes TypeScript collapse the row type to `never` and the build
    // fails (learned the hard way).
    type SvcRow = {
      name: string; priceCents: number; durationMinutes: number; discountPercent: number;
      currency: string; description: string | null; category: { name: string } | null;
    };
    type StaffRow = { firstName: string; lastName: string | null };
    let services: SvcRow[] = [];
    let staff: StaffRow[] = [];
    let giftCards = 0;
    try {
      services = await this.prisma.service.findMany({
        where: { tenantId, isActive: true },
        select: { name: true, priceCents: true, durationMinutes: true, discountPercent: true, currency: true, description: true, category: { select: { name: true } } },
        orderBy: [{ discountPercent: 'desc' }, { name: 'asc' }],
        take: 60,
      });
    } catch { /* menu is best-effort */ }
    try {
      staff = await this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true },
        select: { firstName: true, lastName: true },
        orderBy: { firstName: 'asc' }, take: 40,
      });
    } catch { /* team is best-effort */ }
    try {
      giftCards = await this.prisma.giftCard.count({ where: { tenantId } });
    } catch { /* gift cards are best-effort */ }
    if (services.length) {
      const sym = (cur: string) => (cur === 'USD' ? '$' : cur === 'CAD' ? 'C$' : cur === 'AUD' ? 'A$' : '');
      const money = (c: number, cur: string) => `${sym(cur)}${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
      out.push('SERVICES (live from the salon\'s own menu — these prices are authoritative):');
      for (const sv of services) {
        const off = sv.discountPercent > 0;
        const final = Math.round(sv.priceCents * (100 - sv.discountPercent) / 100);
        const price = off
          ? `${money(final, sv.currency)} (was ${money(sv.priceCents, sv.currency)}, −${sv.discountPercent}% ON SALE NOW)`
          : money(sv.priceCents, sv.currency);
        const cat = sv.category?.name ? ` [${sv.category.name}]` : '';
        const desc = sv.description ? ` — ${sv.description.slice(0, 90)}` : '';
        out.push(`- ${sv.name}${cat}: ${price} · ${sv.durationMinutes} min${desc}`);
      }
      const promos = services.filter((sv) => sv.discountPercent > 0);
      out.push(promos.length
        ? `CURRENT PROMOTIONS: ${promos.map((p) => `${p.name} −${p.discountPercent}%`).join(', ')} — mention these when they fit; never invent any other discount.`
        : 'NO promotions are running right now — never invent a discount.');
    }
    if (staff.length) {
      out.push(`TEAM (${staff.length}): ${staff.map((st) => `${st.firstName}${st.lastName ? ' ' + st.lastName : ''}`).join(', ')}.`);
    }
    if (giftCards > 0) out.push('Gift cards are available at this salon.');
    const info = await this.salonInfoBlock(tenantId, phone, email);
    if (info) out.push(info);
    return out.join('\n');
  }

  private async salonInfoBlock(tenantId: string, phone: string | null, email: string | null): Promise<string> {
    const lines: string[] = [];
    try {
      const rules = await this.settings.getBookingRules(tenantId);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hrs = (rules.businessHours || []).map((h, i) =>
        !h || h.closed ? `${dayNames[i]}: Closed` : `${dayNames[i]}: ${this.minToAmPm(h.openMinutes)} – ${this.minToAmPm(h.closeMinutes)}`,
      );
      const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => hrs[i]).filter(Boolean); // Mon..Sun
      if (ordered.length) lines.push('Business hours (only take bookings within these):', ...ordered);
      const lead = rules.minLeadHours ?? 0;
      const adv = rules.maxAdvanceDays ?? 0;
      if (lead || adv) lines.push(`Booking window: at least ${lead}h in advance, up to ${adv} days ahead.`);
    } catch { /* hours are best-effort */ }
    try {
      const extra = await this.settings.getCompanyExtra(tenantId);
      if (extra?.address) lines.push(`Address: ${extra.address}`);
      if (extra?.website) lines.push(`Website: ${extra.website}`);
    } catch { /* address is best-effort */ }
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

  /** Turn the salon's ticked FAQ facts into prompt lines the bot can answer from. */
  private factsText(botFacts: unknown): string {
    if (!Array.isArray(botFacts)) return '';
    return (botFacts as BotFact[])
      .filter((f) => f && f.on && typeof f.value === 'string' && f.value.trim())
      .map((f) => `- ${String(f.label).trim()}: ${f.value.trim()}`)
      .join('\n');
  }

  private async runTool(
    tenantId: string,
    tz: string,
    name: string,
    input: Record<string, unknown>,
    ctx?: { mode: 'booking' | 'sales'; leadEmail: string | null; threadId?: string; closing?: string | null; agentName?: string | null; bizIntro?: string | null; senderId?: string; pageToken?: string },
  ): Promise<string> {
    try {
      if (name === 'save_lead') {
        return await this.saveLead(tenantId, input, ctx);
      }
      if (name === 'get_pricing') {
        const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
        return this.factsText(conn?.botFacts) || 'No facts configured yet — do not state any price.';
      }
      if (name === 'quote_price') {
        // Website-matched maths. Fixed rates, half-up rounding to WHOLE units,
        // conversions computed from the UNROUNDED USD total — exactly how the
        // site does it, so chat and website can never disagree.
        const amount = Number(input.amountUsd);
        if (!Number.isFinite(amount) || amount <= 0) return 'ERROR: amountUsd must be a positive number.';
        const billing = input.billing === 'monthly' ? 'monthly' : 'once';
        const months = billing === 'monthly' ? Math.max(1, Math.round(Number(input.months) || 1)) : 1;
        const factor = billing === 'monthly' ? (months === 12 ? 0.90 : months === 6 ? 0.95 : 1.0) : 1.0;
        const usdRaw = amount * months * factor;
        const half = (x: number) => Math.floor(x + 0.5);
        const fmt = (n: number) => n.toLocaleString('en-US');
        const usd = half(usdRaw);
        const cad = half(usdRaw * 1.40);
        const aud = half(usdRaw * 1.43);
        const term = billing === 'monthly'
          ? ` — ${months} month(s)${factor === 0.9 ? ', 10% off applied' : factor === 0.95 ? ', 5% off applied' : ''}`
          : ' — one-time';
        return `EXACT (matches the website): USD $${fmt(usd)} | CAD C$${fmt(cad)} | AUD A$${fmt(aud)}${term}. Pick ONLY the currency matching the customer's market (USD if unknown) and quote it verbatim in a natural sentence — no re-rounding, no listing all three unless they asked to compare.`;
      }
      if (name === 'send_price_cards') {
        if (!ctx?.pageToken || !ctx?.senderId) return 'ERROR: cards unavailable in this context — answer in short text instead.';
        const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
        const facts = (Array.isArray(conn?.botFacts) ? (conn!.botFacts as unknown as BotFact[]) : []).filter((f) => f && f.on);
        const cat = String(input.category || 'all');
        const rows = facts.filter((f) =>
          cat === 'marketing' ? /^gói/i.test(f.label) : cat === 'website' ? /^website/i.test(f.label) : /^(gói|website)/i.test(f.label),
        );
        if (!rows.length) return 'ERROR: no package facts configured — answer briefly in text.';
        // Card subtitles are ~80 chars in Messenger. A hard slice chops words
        // mid-syllable ("duyệt nội dung, bá") and looks broken — prefer the
        // first full sentence when it fits, otherwise cut at a word boundary
        // and show an ellipsis on purpose.
        const cardLine = (v: string): string => {
          const text = v.trim();
          if (text.length <= 80) return text;
          const dot = text.indexOf('. ');
          if (dot > 15 && dot < 79) return text.slice(0, dot + 1);
          const cut = text.slice(0, 79);
          const sp = cut.lastIndexOf(' ');
          return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:–—-]$/, '') + '…';
        };
        // Each known package gets a designed 1200x628 image hosted on the web
        // app (public/cards/*.png) — the visual difference between "a text
        // list" and "a brochure". HEAD-checked once and cached; a missing
        // image just falls back to the plain text card.
        const webBase = (process.env.WEB_BASE_URL || 'https://lumiobooking.com').replace(/\/$/, '');
        const slugFor = (label: string): string | null => {
          const l = label.toLowerCase();
          if (l.includes('social care')) return 'social-care';
          if (l.includes('website growth')) return 'web-growth';
          if (l.includes('essential')) return 'web-essential';
          if (l.includes('growth map')) return 'growth-map';
          if (l.includes('boost')) return 'boost';
          if (l.includes('scale')) return 'scale';
          return null;
        };
        const imgFor = async (label: string): Promise<string | undefined> => {
          const slug = slugFor(label);
          if (!slug) return undefined;
          // Meta caches card images BY URL — after a redesign it keeps serving
          // the stale cached copy forever. Bump CARD_IMG_VERSION whenever the
          // PNGs change: a new query string = a new URL = a fresh fetch.
          const CARD_IMG_VERSION = '2';
          const url = `${webBase}/cards/${slug}.png?v=${CARD_IMG_VERSION}`;
          if (!this.cardImgOk.has(url)) {
            // HARD timeout. A hanging check would stall the whole reply — the
            // customer would simply never hear back. Pretty cards are optional;
            // answering is not.
            const ok = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) })
              .then((r) => r.ok)
              .catch(() => false);
            this.cardImgOk.set(url, ok);
          }
          return this.cardImgOk.get(url) ? url : undefined;
        };
        const rowsToSend = rows.slice(0, 10);
        // Checked in PARALLEL and behind one overall deadline, so cards never
        // add more than a moment to the reply.
        const images = await Promise.all(rowsToSend.map((f) => imgFor(f.label).catch(() => undefined)));
        const cards: { title: string; subtitle: string; image_url?: string; buttons: unknown[] }[] = rowsToSend.map((f, i) => ({
          title: f.label.slice(0, 80),
          subtitle: cardLine(f.value),
          image_url: images[i],
          buttons: [{ type: 'postback', title: 'Tư vấn gói này', payload: `ASK_PKG:${f.label.slice(0, 80)}` }],
        }));
        await this.sendCards(ctx.pageToken, ctx.senderId, cards);
        return `SUCCESS — ${cards.length} package card(s) sent. Now send ONE short line asking which fits (do NOT repeat the package details).`;
      }
      if (name === 'get_services') {
        const services = await this.prisma.service.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true, priceCents: true, durationMinutes: true, discountPercent: true },
          orderBy: { name: 'asc' }, take: 40,
        });
        if (!services.length) return 'No services are configured.';
        return JSON.stringify(services.map((sv) => {
          const final = Math.round(sv.priceCents * (100 - sv.discountPercent) / 100);
          return {
            id: sv.id,
            name: sv.name,
            price: `$${(final / 100).toFixed(0)}`,
            ...(sv.discountPercent > 0 ? { wasPrice: `$${(sv.priceCents / 100).toFixed(0)}`, discountPercent: sv.discountPercent } : {}),
            minutes: sv.durationMinutes,
          };
        }));
      }
      if (name === 'create_booking') {
        const firstName = String(input.customerFirstName || '').trim();
        const phone = String(input.customerPhone || '').trim();
        const serviceId = String(input.serviceId || '').trim();
        const local = String(input.localDateTime || '').trim();
        const email = String(input.customerEmail || '').trim();
        if (!firstName || !phone || !serviceId || !local) return 'Missing required info; ask the customer for what is missing.';
        const startTime = wallToUtcISO(local, tz);
        const dto = {
          serviceId, startTime, customerFirstName: firstName, customerPhone: phone,
          ...(email && /.+@.+\..+/.test(email) ? { customerEmail: email } : {}),
        } as CreateBookingDto;
        const booking = await this.bookings.createForTenant(tenantId, dto, null, 'messenger');
        const b = booking as { id?: string };
        this.logger.log(`bot booking CREATED id=${b.id} start=${startTime} local="${local}" tz=${tz} service=${serviceId} phone=…${phone.slice(-4)}`);
        // Auto-assign a technician (fair rotation) when the salon runs in auto mode —
        // same as the public web flow — so AI bookings don't land unassigned.
        if (b.id) {
          try {
            const rules = await this.settings.getBookingRules(tenantId);
            if (rules.assignmentMode === 'auto') await this.bookings.autoAssignForTenant(tenantId, b.id);
          } catch { /* best-effort: the booking is already created */ }
        }
        const manageUrl = b.id ? this.bookings.buildApptManageUrl(b.id) : '';
        return `SUCCESS. Appointment created (id ${b.id}). Confirm the service, date and time back to the customer warmly${manageUrl ? `, and share this link so they can view or cancel their appointment: ${manageUrl}` : ''}.`;
      }
      if (name === 'save_birthday') {
        const phone = String(input.customerPhone || '').trim();
        const d = new Date(String(input.birthDate || '').trim());
        if (!phone || isNaN(d.getTime())) return 'Could not save the birthday; gently ask again or simply skip it.';
        await this.prisma.customer.updateMany({ where: { tenantId, phone }, data: { birthDate: d } });
        return 'SUCCESS. Birthday saved — thank the customer warmly and wish them a great day.';
      }
      return `Unknown tool ${name}.`;
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 160);
      this.logger.warn(`bot tool ${name} FAILED: ${msg}`);
      return `ERROR — the "${name}" call failed: ${msg}. Do NOT tell the customer it succeeded. Apologize, explain briefly, and offer another time or ask for corrected details.`;
    }
  }

  /** Best-effort profile lookup (User Profile API): the customer's display name.
   *  Works for app-role users in dev mode and for all users once pages_messaging
   *  is approved. Falls back to null — callers keep showing the PSID. */
  // Per-thread cooldown for profile lookups (in-memory; resets on restart).
  private readonly nameLookupTriedAt = new Map<string, number>();

  private async fetchSenderName(pageToken: string, psid: string): Promise<string | null> {
    try {
      const r = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name,name&access_token=${encodeURIComponent(pageToken)}`);
      const j = (await r.json().catch(() => ({}))) as { first_name?: string; last_name?: string; name?: string; error?: { message?: string; code?: number } };
      if (j.error) {
        // Visible in server logs: usually means the PSID user has no app role yet
        // (User Profile API is role-gated until pages_messaging is approved).
        this.logger.warn(`profile lookup failed for PSID …${psid.slice(-6)}: ${(j.error.message || '').slice(0, 120)}`);
        return null;
      }
      const name = ([j.first_name, j.last_name].filter(Boolean).join(' ').trim()) || (j.name || '').trim();
      return name || null;
    } catch { return null; }
  }

  // ---- Facebook Send API ---------------------------------------------------
  /**
   * Publish the page's Messenger Profile: the intro-screen greeting (visible
   * before any message is sent) and the Get Started button (whose tap is our
   * cue to speak first). Re-run on every settings save — Meta stores it
   * page-side, so it must be pushed, not just kept in our DB. Best-effort.
   */
  private async setupMessengerProfile(pageToken: string, greeting: string | null): Promise<void> {
    // The intro screen allows 160 chars. A hard slice chops mid-sentence and
    // looks broken on the very first thing a customer reads — greedily take
    // WHOLE sentences while they fit, fall back to a word-boundary cut.
    const full = (greeting || '').trim();
    let intro = '';
    if (full) {
      for (const sen of full.split(/(?<=[.!?…ạ!?])\s+/)) {
        const next = intro ? `${intro} ${sen}` : sen;
        if (next.length > 160) break;
        intro = next;
      }
      if (!intro) {
        const cut = full.slice(0, 159);
        const sp = cut.lastIndexOf(' ');
        intro = (sp > 60 ? cut.slice(0, sp) : cut) + '…';
      }
    }
    intro = intro
      || 'Hi {{user_first_name}}! 👋 Tap Get Started and I\'ll book your nail appointment in a few quick messages.';
    const profileUrl = `https://graph.facebook.com/v21.0/me/messenger_profile?access_token=${encodeURIComponent(pageToken)}`;
    await fetch(profileUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ greeting: [{ locale: 'default', text: intro }] }),
    }).then(async (r) => {
      if (!r.ok) this.logger.warn(`messenger_profile ${r.status}: ${(await r.text().catch(() => '')).slice(0, 120)}`);
    }).catch(() => undefined);
    // NO "Get Started" button: it is one extra tap between a curious customer
    // and the conversation. Without it the composer shows immediately under
    // the greeting text — they just type, and the AI answers in seconds.
    // (Meta sends no event on merely opening the chat, so a bot can never
    // truly speak first; the intro-screen greeting is that first word.)
    await fetch(profileUrl, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: ['get_started'] }),
    }).catch(() => undefined);
  }

  /** Native Messenger carousel: one card per package — the polished look a
   *  text wall can never match. Tagged like sendText so the echo is ours. */
  private async sendCards(
    pageToken: string,
    recipientId: string,
    cards: { title: string; subtitle: string; image_url?: string; buttons: unknown[] }[],
  ): Promise<void> {
    try {
      const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: 'RESPONSE',
          message: {
            metadata: 'LUMIO_BOT',
            attachment: { type: 'template', payload: { template_type: 'generic', image_aspect_ratio: 'horizontal', elements: cards.slice(0, 10) } },
          },
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const outCards = (await res.json().catch(() => ({}))) as { message_id?: string };
      this.rememberSentMid(outCards.message_id);
    } catch (e) {
      this.logger.warn(`Send cards failed: ${String(e).slice(0, 120)}`);
    }
  }

  /** Reject after `ms` so one hung network call can never swallow a reply. */
  private withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
      work.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  private async sendText(pageToken: string, recipientId: string, text: string): Promise<void> {
    try {
      // metadata comes back on the Messenger echo; Instagram drops it, so we
      // also remember the message id the Send API returns.
      const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900), metadata: 'LUMIO_BOT' } }),
        signal: AbortSignal.timeout(12_000),
      });
      const out = (await res.json().catch(() => ({}))) as { message_id?: string };
      this.rememberSentMid(out.message_id);
    } catch (e) {
      this.logger.warn(`Send API failed: ${String(e).slice(0, 120)}`);
    }
  }
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { text?: string; is_echo?: boolean; metadata?: string; mid?: string };
  postback?: { payload?: string; title?: string }; // "Get Started" tap and menu buttons
  timestamp?: number; // ms epoch set by Meta on the webhook event
}
