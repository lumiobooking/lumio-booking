import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterCredentials,
  CreatePaymentInput,
  PaymentResult,
  RefundPaymentInput,
  TerminalAdapter,
  TerminalHealth,
  VoidPaymentInput,
} from './terminal-adapter.interface';
import {
  ChargeInput,
  ConnectResult,
  ConnectorCapabilities,
  IntentResult,
  ProviderId,
  ReaderInfo,
  RefundResult,
  WebhookResult,
} from '../connectors/connector.types';
import { PaymentConnector } from '../connectors/payment-connector.interface';

/**
 * Dejavoo / iPOSpays "SPIn" Cloud REST adapter.
 *
 * Spec transcribed from the public docs into
 * docs/Lumio-Dejavoo-SPIn-API-Reference.md. Points that drive this code:
 *
 *  - Credentials live in the JSON BODY on POST (`Tpn`, `Authkey`, `RegisterId`)
 *    and in the QUERY STRING on GET (`request.tpn`, `request.authkey`, ...).
 *    Note the casing: `Authkey` in the body, `request.authkey` in the query.
 *  - Amounts are DOLLARS as JSON numbers, not cents.
 *  - Business failures come back as HTTP 200 with `GeneralResponse.ResultCode`
 *    != "0", so never trust the HTTP status alone.
 *  - `StatusCode` "0000" = Approved, "0001" = Partial approval.
 *  - `ReferenceId` is the merchant-generated transaction id, max 50 alphanumeric
 *    chars, unique within a batch. Re-using one returns 1011 Duplicate — which
 *    is exactly the idempotency guarantee we want.
 *  - Void refers to the ORIGINAL ReferenceId. Return (refund) does NOT: it is a
 *    standalone transaction needing a NEW ReferenceId, and it can be partial.
 *
 * Cardholder data never reaches this code: the P1 terminal captures and
 * encrypts the card itself, and we only ever read brand / last 4.
 */

const BASE_PRODUCTION = 'https://spinpos.net';
const BASE_SANDBOX = 'https://test.spinpos.net';

/** Terminal default is 120s; stay under it so our own abort fires first. */
const DEFAULT_TIMEOUT_MS = 125_000;
const HEALTH_TIMEOUT_MS = 15_000;

/**
 * Whether `Amount` on a Sale already includes the tip.
 *
 * The docs call the request field "Total amount of the transaction" and the
 * response mirrors that (`Amounts.Amount` = "Amount with tip"), so we send the
 * tip-inclusive total. VERIFY THIS AGAINST A SANDBOX TPN BEFORE GOING LIVE:
 * if it turns out the terminal adds the tip on top, flip this to false or every
 * tipped sale overcharges by the tip.
 */
const AMOUNT_INCLUDES_TIP = true;

type SpinResponse = {
  GeneralResponse?: {
    ResultCode?: string;
    StatusCode?: string;
    Message?: string;
    DetailedMessage?: string;
    HostResponseCode?: string;
    HostResponseMessage?: string;
    DelayBeforeNextRequest?: number;
  };
  AuthCode?: string;
  ReferenceId?: string;
  InvoiceNumber?: string;
  BatchNumber?: string;
  TransactionNumber?: string;
  RRN?: string;
  PNReferenceId?: string;
  Voided?: boolean;
  TransactionType?: string;
  Amounts?: { TotalAmount?: number; Amount?: number; TipAmount?: number; FeeAmount?: number; TaxAmount?: number };
  CardData?: { CardType?: string; CardBrand?: string; Last4?: string; EntryType?: string };
  [k: string]: unknown;
};

const APPROVED_CODES = new Set(['0000', '0001']);
/** Statuses that mean "the card was definitely NOT charged". Safe to retry. */
const DEFINITELY_NOT_CHARGED = new Set([
  '1009', // Authentication failed
  '1010', // Missing reference id
  '1013', // Bad request
  '1017', // Incorrect merchant id
  '2001', // Terminal not connected to proxy
  '2002', // Active AuthKey not found
  '2003', // Register (TPN) not found
  '2004', // Route not found
  '2005', // Active route not found
  '2006', // Could not parse request
  '2011', // Terminal not available
  '2201', // Invalid request data
]);

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function cents(amount: unknown): number | undefined {
  const n = typeof amount === 'string' ? Number(amount) : (amount as number);
  if (typeof n !== 'number' || !isFinite(n)) return undefined;
  return Math.round(n * 100);
}

/**
 * Derive the provider ReferenceId from our idempotency key.
 *
 * Deterministic on purpose: replaying the same Lumio reference produces the
 * same ReferenceId, so Dejavoo answers 1011 Duplicate instead of taking a
 * second payment. Alphanumeric only, capped at the documented 50 chars.
 */
export function toReferenceId(reference: string): string {
  const clean = String(reference || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!clean) throw new Error('Dejavoo: empty payment reference');
  return clean.slice(0, 50);
}

/** Credentials are packed into the connector `secret` by CredentialStore. */
export function parseDejavooSecret(secret: string): Required<Pick<AdapterCredentials, 'secret'>> & AdapterCredentials {
  try {
    const o = JSON.parse(secret);
    if (o && typeof o === 'object' && (o.k || o.secret)) {
      return {
        secret: String(o.k ?? o.secret ?? ''),
        tpn: o.t ?? o.tpn ?? undefined,
        registerId: o.r ?? o.registerId ?? undefined,
        environment: o.e ?? o.environment ?? 'production',
      };
    }
  } catch {
    /* not packed — treat the whole string as the Authkey */
  }
  return { secret, environment: 'production' };
}

export function packDejavooSecret(c: AdapterCredentials): string {
  return JSON.stringify({ k: c.secret, t: c.tpn, r: c.registerId, e: c.environment ?? 'production' });
}

@Injectable()
export class DejavooSpinCloudAdapter implements TerminalAdapter, PaymentConnector {
  readonly id: ProviderId = 'dejavoo';
  readonly connectionType = 'CLOUD' as const;
  readonly enabled = true;

  private readonly logger = new Logger('DejavooSPIn');

  // ---------------------------------------------------------------- plumbing

  private base(cred: AdapterCredentials): string {
    return cred.environment === 'sandbox' ? BASE_SANDBOX : BASE_PRODUCTION;
  }

  /** Auth block shared by every POST body. */
  private auth(cred: AdapterCredentials, terminalId?: string) {
    return {
      Tpn: terminalId || cred.tpn || '',
      RegisterId: cred.registerId || '',
      Authkey: cred.secret,
    };
  }

  private async post(cred: AdapterCredentials, path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const doFetch: any = (globalThis as any).fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${this.base(cred)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: SpinResponse = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { GeneralResponse: { ResultCode: '2', StatusCode: '2006', Message: text.slice(0, 300) } };
      }
      return { httpStatus: res.status as number, json };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Translate a SPIn envelope into our normalised result.
   *
   * The distinction that matters most is APPROVED / DECLINED (we know the
   * answer) versus UNKNOWN (we do not, and must never retry blindly).
   */
  private map(json: SpinResponse): PaymentResult {
    const g = json.GeneralResponse ?? {};
    const code = String(g.StatusCode ?? '');
    const message = g.DetailedMessage || g.Message || g.HostResponseMessage || '';
    const a = json.Amounts ?? {};
    const card = json.CardData ?? {};

    const common: PaymentResult = {
      outcome: 'ERROR',
      externalId: json.ReferenceId,
      approvalCode: json.AuthCode,
      cardBrand: card.CardBrand || card.CardType,
      last4: card.Last4,
      entryType: card.EntryType,
      amountCents: cents(a.Amount),
      tipCents: cents(a.TipAmount),
      totalCents: cents(a.TotalAmount),
      batchNumber: json.BatchNumber,
      transactionNumber: json.TransactionNumber,
      rrn: json.RRN || json.PNReferenceId,
      code,
      message,
      raw: json,
    };

    if (APPROVED_CODES.has(code)) return { ...common, outcome: 'APPROVED' };
    if (code === '1012') return { ...common, outcome: 'CANCELED' };
    if (code === '1015' || code === '1016') return { ...common, outcome: 'DECLINED' };
    if (code === '2008') {
      // Terminal busy with a previous request — nothing was charged.
      return { ...common, outcome: 'ERROR', retryAfterSeconds: g.DelayBeforeNextRequest };
    }
    if (code === '2007' || code === '1030' || code === '2010' || code === '1014') {
      // Timed out / disconnected mid-flight: the card may or may not have been
      // charged. Caller must resolve with getPaymentStatus().
      return { ...common, outcome: 'UNKNOWN' };
    }
    if (DEFINITELY_NOT_CHARGED.has(code)) return { ...common, outcome: 'ERROR' };
    if (g.ResultCode === '0') return { ...common, outcome: 'APPROVED' };
    // Anything unrecognised is treated as unknown rather than failed, because
    // guessing "failed" is what causes double charges.
    return { ...common, outcome: code ? 'UNKNOWN' : 'ERROR' };
  }

  // ------------------------------------------------------- TerminalAdapter

  getCapabilities(): ConnectorCapabilities {
    return {
      terminal: true,
      online: false, // SPIn drives a physical terminal only.
      tapToPay: false,
      interac: true, // Dejavoo is certified on Canadian processors.
      partialRefund: true, // "You may do return on any amount."
      currencies: ['USD', 'CAD'],
    };
  }

  async connect(cred: AdapterCredentials): Promise<ConnectResult> {
    if (!cred.secret || cred.secret.length < 6) {
      return { ok: false, capabilities: this.getCapabilities(), error: 'Auth Key is missing' };
    }
    if (!cred.tpn && !cred.registerId) {
      return { ok: false, capabilities: this.getCapabilities(), error: 'TPN is required' };
    }
    const health = await this.testConnection(cred);
    return {
      ok: health.online,
      accountId: cred.tpn,
      capabilities: this.getCapabilities(),
      error: health.online ? undefined : health.message || 'Terminal is not reachable',
    };
  }

  async disconnect(): Promise<void> {
    // Cloud REST holds no session, socket or lease. Nothing to tear down.
  }

  async testConnection(cred: AdapterCredentials, terminalId?: string): Promise<TerminalHealth> {
    const doFetch: any = (globalThis as any).fetch;
    const q = new URLSearchParams({
      'request.tpn': terminalId || cred.tpn || '',
      'request.registerId': cred.registerId || '',
      'request.authkey': cred.secret,
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await doFetch(`${this.base(cred)}/v2/Common/TerminalStatus?${q.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { ErrorDescription: text.slice(0, 200) };
      }
      const status = String(json.TerminalStatus ?? '');
      return {
        online: status === 'Online',
        terminalId: json.Tpn || terminalId || cred.tpn,
        message: json.ErrorDescription || status || `HTTP ${res.status}`,
        raw: json,
      };
    } catch (err) {
      return { online: false, terminalId: terminalId || cred.tpn, message: `Cannot reach Dejavoo: ${String(err)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async createPayment(cred: AdapterCredentials, input: CreatePaymentInput): Promise<PaymentResult> {
    const referenceId = toReferenceId(input.reference);
    const tip = input.tipCents ?? 0;
    const chargeCents = AMOUNT_INCLUDES_TIP ? input.amountCents + tip : input.amountCents;

    const body: Record<string, unknown> = {
      Amount: dollars(chargeCents),
      PaymentType: 'Credit',
      ReferenceId: referenceId,
      PrintReceipt: 'No',
      GetReceipt: 'No',
      CaptureSignature: false,
      GetExtendedData: true,
      IsReadyForIS: false,
      ...this.auth(cred, input.terminalId),
    };
    if (tip > 0) body.TipAmount = dollars(tip);
    if (input.invoiceNumber) body.InvoiceNumber = String(input.invoiceNumber).slice(0, 50);

    try {
      const { json } = await this.post(cred, '/v2/Payment/Sale', body);
      const result = this.map(json);

      // A duplicate reference means this exact charge was already sent. Resolve
      // it by reading the existing transaction instead of charging again.
      if (result.code === '1011') {
        this.logger.warn(`Duplicate ReferenceId ${referenceId} — resolving via Status`);
        return this.getPaymentStatus(cred, input.reference, input.terminalId);
      }
      return result;
    } catch (err) {
      // Network abort / socket error: the terminal may still have taken the
      // card. Never report this as a failure — report UNKNOWN so the caller
      // runs the status check.
      this.logger.warn(`Sale ${referenceId} did not return cleanly: ${String(err)}`);
      return { outcome: 'UNKNOWN', externalId: referenceId, message: String(err) };
    }
  }

  async getPaymentStatus(cred: AdapterCredentials, reference: string, terminalId?: string): Promise<PaymentResult> {
    const referenceId = toReferenceId(reference);
    try {
      const { json } = await this.post(
        cred,
        '/v2/Payment/Status',
        { PaymentType: 'Credit', ReferenceId: referenceId, GetExtendedData: true, ...this.auth(cred, terminalId) },
        HEALTH_TIMEOUT_MS * 2,
      );
      const result = this.map(json);
      // 1001 / 2009 = no such transaction in the batch, i.e. the card was never
      // charged. This is the ONE state where retrying a sale is safe.
      if (result.code === '1001' || result.code === '2009') {
        return { ...result, outcome: 'ERROR', message: 'No transaction found for this reference' };
      }
      return result;
    } catch (err) {
      return { outcome: 'UNKNOWN', externalId: referenceId, message: String(err) };
    }
  }

  async cancelPayment(cred: AdapterCredentials, reference: string, terminalId?: string): Promise<PaymentResult> {
    try {
      const { json } = await this.post(
        cred,
        '/v2/Payment/AbortTransaction',
        { ReferenceId: toReferenceId(reference), ...this.auth(cred, terminalId) },
        HEALTH_TIMEOUT_MS,
      );
      const result = this.map(json);
      return result.outcome === 'APPROVED' ? { ...result, outcome: 'CANCELED' } : result;
    } catch (err) {
      return { outcome: 'UNKNOWN', message: String(err) };
    }
  }

  async voidPayment(cred: AdapterCredentials, input: VoidPaymentInput): Promise<PaymentResult> {
    // Void needs the ORIGINAL ReferenceId and the original amount.
    const { json } = await this.post(cred, '/v2/Payment/Void', {
      Amount: dollars(input.amountCents),
      PaymentType: 'Credit',
      ReferenceId: toReferenceId(input.reference),
      PrintReceipt: 'No',
      GetReceipt: 'No',
      GetExtendedData: true,
      ...this.auth(cred, input.terminalId),
    });
    return this.map(json);
  }

  async refundPayment(cred: AdapterCredentials, input: RefundPaymentInput): Promise<PaymentResult> {
    // Return is standalone: it needs its OWN new ReferenceId and can be partial.
    // The customer has to present the card on the terminal again.
    const { json } = await this.post(cred, '/v2/Payment/Return', {
      Amount: dollars(input.amountCents),
      PaymentType: 'Credit',
      ReferenceId: toReferenceId(input.reference),
      PrintReceipt: 'No',
      GetReceipt: 'No',
      GetExtendedData: true,
      ...(input.originalReference ? { InvoiceNumber: toReferenceId(input.originalReference).slice(0, 50) } : {}),
      ...this.auth(cred, input.terminalId),
    });
    return this.map(json);
  }

  // ------------------------------------------- PaymentConnector bridge layer
  // Lets Dejavoo drop into the existing orchestrator, registry and POS screen
  // with no changes anywhere else.

  private cred(secret: string): AdapterCredentials {
    return parseDejavooSecret(secret);
  }

  capabilities(): ConnectorCapabilities {
    return this.getCapabilities();
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    const c = this.cred(secret);
    if (opts?.tpn) c.tpn = opts.tpn;
    if (opts?.registerId) c.registerId = opts.registerId;
    if (opts?.environment) c.environment = opts.environment as 'sandbox' | 'production';
    return this.connect(c);
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    // SPIn has no "list my terminals" endpoint — a merchant knows their TPNs.
    // We report the default one so the UI is never empty after connecting.
    const c = this.cred(secret);
    if (!c.tpn) return [];
    const h = await this.testConnection(c);
    return [{ externalId: c.tpn, label: 'Dejavoo terminal', status: h.online ? 'ONLINE' : 'OFFLINE' }];
  }

  async registerReader(secret: string, code: string, label?: string, locationId?: string): Promise<ReaderInfo> {
    // `code` is the TPN of the terminal being added.
    const c = this.cred(secret);
    const tpn = String(code || '').trim();
    if (!tpn) throw new Error('TPN is required');
    const h = await this.testConnection(c, tpn);
    if (!h.online) throw new Error(h.message || 'Terminal is offline — check its network cable and the arrow icon');
    return { externalId: tpn, label: label || `Dejavoo ${tpn}`, status: 'ONLINE', locationId };
  }

  async createConnectionToken(): Promise<string | null> {
    return null; // Not applicable: no client-side SDK.
  }

  private toIntent(r: PaymentResult): IntentResult {
    const status =
      r.outcome === 'APPROVED'
        ? 'SUCCEEDED'
        : r.outcome === 'CANCELED'
          ? 'CANCELED'
          : r.outcome === 'PENDING' || r.outcome === 'UNKNOWN'
            ? 'PROCESSING'
            : 'FAILED';
    return {
      externalId: r.externalId,
      status,
      error: status === 'FAILED' || status === 'PROCESSING' ? r.message || r.code : undefined,
      raw: r.raw ?? r,
    };
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    const r = await this.createPayment(this.cred(secret), {
      amountCents: input.amountCents,
      tipCents: (input as any).tipCents,
      currency: input.currency,
      reference: input.reference,
      terminalId: input.readerExternalId,
      invoiceNumber: (input as any).invoiceNumber,
      description: input.description,
    });
    return this.toIntent(r);
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    return this.toIntent(await this.getPaymentStatus(this.cred(secret), externalId));
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    return this.toIntent(await this.cancelPayment(this.cred(secret), externalId));
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    const c = this.cred(secret);
    if (!amountCents || amountCents <= 0) {
      return { status: 'FAILED', error: 'Refund amount is required for Dejavoo' };
    }
    // Dejavoo Return is independent, so mint a fresh reference derived from the
    // original — deterministic, so a retried refund cannot double-refund.
    const reference = toReferenceId(`R${intentExternalId}${amountCents}`);
    const r = await this.refundPayment(c, { originalReference: intentExternalId, reference, amountCents });
    return {
      externalId: r.externalId,
      status: r.outcome === 'APPROVED' ? 'SUCCEEDED' : r.outcome === 'UNKNOWN' ? 'PENDING' : 'FAILED',
      error: r.outcome === 'APPROVED' ? undefined : r.message || r.code,
      raw: r.raw ?? r,
    };
  }

  verifyWebhook(): WebhookResult {
    // SPIn pushes results to a CallbackInfo.Url rather than signing webhooks;
    // Phase 1 polls instead, so nothing to verify here.
    throw new Error('Dejavoo does not use signed webhooks');
  }
}
