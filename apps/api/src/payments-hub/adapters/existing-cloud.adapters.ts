import { Injectable } from '@nestjs/common';
import { ConnectionType, TerminalAdapter } from './terminal-adapter.interface';
import { LegacyConnectorAdapter } from './legacy-connector.adapter';
import { StripeTerminalConnector } from '../connectors/stripe-terminal.connector';
import { SquareTerminalConnector } from '../connectors/square-terminal.connector';
import { ProviderId } from '../connectors/connector.types';

/**
 * Stripe and Square already have working cloud connectors from earlier phases.
 * Rather than stub them out and lose that, these adapters expose the existing
 * connectors through the new TerminalAdapter contract, so the whole system
 * speaks one vocabulary.
 *
 * They are `enabled: false` for now on purpose: phase 1 ships Dejavoo only, and
 * a salon should not be offered a path that has not been re-tested end to end
 * against the new adapter layer.
 */

@Injectable()
export class StripeTerminalAdapter extends LegacyConnectorAdapter implements TerminalAdapter {
  readonly id: ProviderId = 'stripe';
  readonly connectionType: ConnectionType = 'CLOUD';
  readonly enabled = false;
  constructor(connector: StripeTerminalConnector) {
    super(connector);
  }
}

@Injectable()
export class SquareTerminalAdapter extends LegacyConnectorAdapter implements TerminalAdapter {
  readonly id: ProviderId = 'square';
  readonly connectionType: ConnectionType = 'CLOUD';
  readonly enabled = false;
  constructor(connector: SquareTerminalConnector) {
    super(connector);
  }
}
