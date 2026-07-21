import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentConnector } from './connectors/payment-connector.interface';
import { AdyenConnector } from './connectors/adyen.connector';
import { HelcimConnector } from './connectors/helcim.connector';
import { MockConnector } from './connectors/mock.connector';
import { StripeTerminalConnector } from './connectors/stripe-terminal.connector';
import { SquareTerminalConnector } from './connectors/square-terminal.connector';
import { SumUpConnector } from './connectors/sumup.connector';
import { ProviderId } from './connectors/connector.types';
import { DejavooSpinCloudAdapter } from './adapters/dejavoo-spin-cloud.adapter';
import { TerminalAdapter } from './adapters/terminal-adapter.interface';
import { UsbTerminalAdapter, BluetoothTerminalAdapter } from './adapters/placeholder.adapters';
import { StripeTerminalAdapter, SquareTerminalAdapter } from './adapters/existing-cloud.adapters';

/**
 * Maps a provider id to its connector. Adding a provider = registering one
 * connector here; no other code changes. Only providers registered here are
 * usable — Phase 1 ships Stripe + Mock.
 */
@Injectable()
export class ProviderRegistry {
  private readonly map = new Map<ProviderId, PaymentConnector>();

  /** Every adapter, including the ones that are not finished yet. */
  private readonly adapters = new Map<ProviderId, TerminalAdapter>();

  constructor(
    helcim: HelcimConnector,
    stripe: StripeTerminalConnector,
    square: SquareTerminalConnector,
    sumup: SumUpConnector,
    adyen: AdyenConnector,
    dejavoo: DejavooSpinCloudAdapter,
    mock: MockConnector,
    usbAdapter: UsbTerminalAdapter,
    btAdapter: BluetoothTerminalAdapter,
    stripeAdapter: StripeTerminalAdapter,
    squareAdapter: SquareTerminalAdapter,
  ) {
    // Order matters: the first entry is the default shown in Payment settings.
    for (const c of [stripe, dejavoo, helcim, square, sumup, adyen, mock]) this.map.set(c.id, c);
    for (const a of [dejavoo, stripeAdapter, squareAdapter, usbAdapter, btAdapter]) this.adapters.set(a.id, a);
  }

  /**
   * Adapters are gated on their own `enabled` flag, so an unfinished
   * integration cannot be reached even if someone calls the API directly with
   * its provider id.
   */
  adapter(provider: string): TerminalAdapter {
    const a = this.adapters.get(provider as ProviderId);
    if (!a) throw new BadRequestException(`Unknown terminal adapter: ${provider}`);
    if (!a.enabled) throw new BadRequestException(`Terminal type not available yet: ${provider}`);
    return a;
  }

  /** Only the adapters a salon is allowed to see and pick. */
  enabledAdapters(): TerminalAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.enabled);
  }

  get(provider: string): PaymentConnector {
    const c = this.map.get(provider as ProviderId);
    if (!c) throw new BadRequestException(`Payment provider not enabled: ${provider}`);
    return c;
  }

  supported(): ProviderId[] {
    return Array.from(this.map.keys());
  }
}
