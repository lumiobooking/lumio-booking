import { Module } from '@nestjs/common';
import { PaymentsHubController } from './payments-hub.controller';
import { PaymentsHubWebhookController } from './payments-hub-webhook.controller';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { ProviderRegistry } from './provider-registry.service';
import { CredentialStore } from './credential-store.service';
import { MockConnector } from './connectors/mock.connector';
import { StripeTerminalConnector } from './connectors/stripe-terminal.connector';
import { SquareTerminalConnector } from './connectors/square-terminal.connector';
import { SumUpConnector } from './connectors/sumup.connector';

/**
 * POS Payment Hub (Phase 1). Inert until a salon connects a provider and the
 * PAYMENTS_HUB_ENABLED flag is on, so it cannot affect existing flows.
 */
@Module({
  controllers: [PaymentsHubController, PaymentsHubWebhookController],
  providers: [PaymentOrchestrator, ProviderRegistry, CredentialStore, MockConnector, StripeTerminalConnector, SquareTerminalConnector, SumUpConnector],
  exports: [PaymentOrchestrator],
})
export class PaymentsHubModule {}
