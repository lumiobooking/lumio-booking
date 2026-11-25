import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { oauthBase } from '../common/public-url.util';
import { CredentialStore, type Credential } from './credential-store.service';
import { encryptSecret } from './crypto.util';
import { cloverHosts } from './connectors/clover-device';
import { authorizeUrl, cloverAppConfig, needsRefresh, readTokens, signState, verifyState, type CloverAppConfig } from './clover-oauth';

const doFetch: any = (...a: unknown[]) => (globalThis as any).fetch(...a);

/**
 * rt233 — "Connect with Clover" (driving the salon's Clover device).
 * Tokens are stored encrypted per salon in the same CredentialStore as every
 * other payment key, under provider `clover_device`, and refreshed here before
 * they expire. Inert until CLOVER_APP_ID / CLOVER_APP_SECRET are set (Clover
 * has to approve Lumio's app first).
 */
@Injectable()
export class CloverOAuthService implements OnModuleInit {
  private readonly logger = new Logger('CloverOAuth');
  constructor(private readonly prisma: PrismaService, private readonly creds: CredentialStore) {}

  onModuleInit() {
    // The credential store asks us for a fresh token before handing it to the connector.
    this.creds.setRefresher('clover_device', (tenantId, cred) => this.fresh(tenantId, cred));
  }

  private cfg(): CloverAppConfig | null { return cloverAppConfig(process.env, oauthBase()); }
  private secret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-clover-signing-dev'; }
  private webBase(): string { return (process.env.PUBLIC_WEB_URL || 'https://lumiobooking.com').replace(/\/+$/, ''); }

  /** Is the Clover app configured (approved and its keys set)? */
  available(): boolean { return !!this.cfg(); }

  /** rt233: while on Clover's sandbox, only the salons in CLOVER_TEST_TENANTS (ids or slugs). */
  private async isTester(tenantId: string): Promise<boolean> {
    const list = String(process.env.CLOVER_TEST_TENANTS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!list.length) return false;
    if (list.includes(tenantId)) return true;
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }).catch(() => null);
    return !!t?.slug && list.includes(t.slug);
  }

  async connectUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const c = this.cfg();
    if (!c) throw new ServiceUnavailableException('Clover device connection is not available yet');
    if (!user.tenantId) throw new BadRequestException('Open a salon first');
    if (c.env === 'sandbox' && !(await this.isTester(user.tenantId))) throw new ServiceUnavailableException('Clover device connection is not available yet');
    return { url: authorizeUrl(c, signState({ tenantId: user.tenantId, userId: user.userId }, this.secret())) };
  }

  /** Clover's redirect lands here; returns where to send the browser. */
  async callback(code: string, merchantId: string, state: string): Promise<string> {
    const back = (q: string) => `${this.webBase()}/salon/payment-terminals?${q}`;
    const c = this.cfg();
    if (!c) return back('clover=error&msg=not_configured');
    const who = verifyState(state, this.secret());
    if (!who) return back('clover=error&msg=state');
    if (!code || !merchantId) return back('clover=error&msg=cancelled');
    try {
      const r = await doFetch(`${cloverHosts(c.env).api}/oauth/v2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = await r.json().catch(() => ({}));
      const t = readTokens(json);
      if (!r.ok || !t) {
        this.logger.warn(`Clover token exchange failed for ${who.tenantId}: HTTP ${r.status}`);
        return back('clover=error&msg=token');
      }
      const cred: Credential = { secret: t.access, publicId: merchantId, environment: c.env, refreshToken: t.refresh, accessExp: t.accessExp, refreshExp: t.refreshExp };
      await this.creds.save(who.tenantId, 'clover_device', cred, {
        ok: true, accountId: merchantId, currency: 'USD',
        capabilities: { terminal: true, online: false, tapToPay: false, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] },
      }, 'Clover');
      await this.audit(who.tenantId, who.userId, 'payment.connect', { provider: 'clover_device', via: 'oauth', merchant: merchantId.slice(-4) });
      return back('clover=connected');
    } catch (e) {
      this.logger.warn(`Clover callback failed: ${String(e).slice(0, 160)}`);
      return back('clover=error&msg=network');
    }
  }

  /** A token good for the next few minutes; refreshed and re-saved when needed. */
  async fresh(tenantId: string, cred: Credential): Promise<Credential> {
    if (!needsRefresh(cred.accessExp) || !cred.refreshToken) return cred;
    const c = this.cfg();
    if (!c) return cred;
    try {
      const r = await doFetch(`${cloverHosts(cred.environment === 'sandbox' ? 'sandbox' : 'production').api}/oauth/v2/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: c.clientId, refresh_token: cred.refreshToken }),
        signal: AbortSignal.timeout(15_000),
      });
      const t = readTokens(await r.json().catch(() => ({})));
      if (!r.ok || !t) { this.logger.warn(`Clover refresh failed for ${tenantId}: HTTP ${r.status}`); return cred; }
      const next: Credential = { ...cred, secret: t.access, refreshToken: t.refresh || cred.refreshToken, accessExp: t.accessExp, refreshExp: t.refreshExp };
      // Only this salon's own row is touched.
      await this.prisma.paymentConnection.updateMany({ where: { tenantId, provider: 'clover_device', status: 'ACTIVE' }, data: { credentialEnc: encryptSecret(JSON.stringify(next)), lastCheckedAt: new Date() } });
      return next;
    } catch (e) {
      this.logger.warn(`Clover refresh error for ${tenantId}: ${String(e).slice(0, 120)}`);
      return cred;
    }
  }

  private async audit(tenantId: string, userId: string | null, action: string, meta: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { tenantId, userId: userId ?? undefined, action, resourceType: 'payment', metadata: meta as never } }).catch(() => undefined);
  }
}
