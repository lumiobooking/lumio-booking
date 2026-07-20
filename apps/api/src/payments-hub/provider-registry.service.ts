import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentConnector } from './connectors/payment-connector.interface';
import { HelcimConnector } from './connectors/helcim.connector';
import { MockConnector } from './connectors/mock.connector';
import { StripeTerminalConnector } from './connectors/stripe-terminal.connector';
import { SquareTerminalConnector } from './connectors/square-terminal.connector';
import { SumUpConnector } from './connectors/sumup.connector';
import { ProviderId } from './connectors/connector.types';

/**
 * Maps a provider id to its connector. Adding a provider = registering one
 * connector here; no other code changes. Only providers registered here are
 * usable — Phase 1 ships Stripe + Mock.
 */
@Injectable()
export class ProviderRegistry {
  private readonly map = new Map<ProviderId, PaymentConnector>();

  constructor(
    helcim: HelcimConnector,
    stripe: StripeTerminalConnector,
    square: SquareTerminalConnector,
    sumup: SumUpConnector,
    mock: MockConnector,
  ) {
    // Order matters: the first entry is the default shown in Payment settings.
    for (const c of [helcim, stripe, square, sumup, mock]) this.map.set(c.id, c);
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
