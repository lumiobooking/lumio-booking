import {
  AdapterCredentials,
  ConnectionType,
  CreatePaymentInput,
  PaymentOutcome,
  PaymentResult,
  RefundPaymentInput,
  TerminalAdapter,
  TerminalHealth,
  VoidPaymentInput,
} from './terminal-adapter.interface';
import { PaymentConnector } from '../connectors/payment-connector.interface';
import { ConnectResult, ConnectorCapabilities, IntentResult, ProviderId } from '../connectors/connector.types';

/**
 * Wraps a pre-existing PaymentConnector so it satisfies TerminalAdapter.
 *
 * This is the migration bridge: connectors written before the adapter layer
 * (Stripe, Square, SumUp, Helcim, Adyen) keep working untouched, while callers
 * can move to the single adapter vocabulary at their own pace.
 */
export abstract class LegacyConnectorAdapter implements TerminalAdapter {
  abstract readonly id: ProviderId;
  abstract readonly connectionType: ConnectionType;
  abstract readonly enabled: boolean;

  protected constructor(protected readonly connector: PaymentConnector) {}

  private static outcome(status: IntentResult['status']): PaymentOutcome {
    switch (status) {
      case 'SUCCEEDED':
        return 'APPROVED';
      case 'CANCELED':
        return 'CANCELED';
      case 'PROCESSING':
      case 'REQUIRES_PAYMENT':
        return 'PENDING';
      default:
        return 'DECLINED';
    }
  }

  private static toResult(r: IntentResult): PaymentResult {
    return { outcome: LegacyConnectorAdapter.outcome(r.status), externalId: r.externalId, message: r.error, raw: r.raw };
  }

  getCapabilities(): ConnectorCapabilities {
    return this.connector.capabilities();
  }

  connect(cred: AdapterCredentials): Promise<ConnectResult> {
    return this.connector.verifyCredential(cred.secret, { locationId: cred.locationId, region: cred.region });
  }

  async disconnect(): Promise<void> {
    /* legacy connectors are stateless */
  }

  async testConnection(cred: AdapterCredentials, terminalId?: string): Promise<TerminalHealth> {
    // When the caller asks about a SPECIFIC terminal and the connector can
    // check pairing (Square device codes), report the device's real state —
    // a valid account token alone does not mean the terminal can take cards.
    if (terminalId && typeof (this.connector as any).checkReader === 'function') {
      const h = await (this.connector as any).checkReader(cred.secret, terminalId);
      return { online: !!h.online, terminalId, message: h.message };
    }
    const res = await this.connector.verifyCredential(cred.secret, { locationId: cred.locationId, region: cred.region });
    return { online: res.ok, terminalId, message: res.error };
  }

  async createPayment(cred: AdapterCredentials, input: CreatePaymentInput): Promise<PaymentResult> {
    const r = await this.connector.charge(cred.secret, {
      amountCents: input.amountCents,
      currency: input.currency,
      reference: input.reference,
      readerExternalId: input.terminalId,
      description: input.description,
    });
    return LegacyConnectorAdapter.toResult(r);
  }

  async getPaymentStatus(cred: AdapterCredentials, reference: string): Promise<PaymentResult> {
    return LegacyConnectorAdapter.toResult(await this.connector.getIntent(cred.secret, reference));
  }

  async cancelPayment(cred: AdapterCredentials, reference: string): Promise<PaymentResult> {
    return LegacyConnectorAdapter.toResult(await this.connector.cancelIntent(cred.secret, reference));
  }

  async voidPayment(cred: AdapterCredentials, input: VoidPaymentInput): Promise<PaymentResult> {
    // Providers without a distinct void treat it as a full refund.
    const r = await this.connector.refund(cred.secret, input.reference, input.amountCents);
    return { outcome: r.status === 'SUCCEEDED' ? 'APPROVED' : r.status === 'PENDING' ? 'PENDING' : 'DECLINED', externalId: r.externalId, message: r.error, raw: r.raw };
  }

  async refundPayment(cred: AdapterCredentials, input: RefundPaymentInput): Promise<PaymentResult> {
    const r = await this.connector.refund(cred.secret, input.originalReference || input.reference, input.amountCents);
    return { outcome: r.status === 'SUCCEEDED' ? 'APPROVED' : r.status === 'PENDING' ? 'PENDING' : 'DECLINED', externalId: r.externalId, message: r.error, raw: r.raw };
  }
}
