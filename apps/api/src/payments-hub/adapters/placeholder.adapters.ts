import { Injectable } from '@nestjs/common';
import {
  AdapterCredentials,
  ConnectionType,
  CreatePaymentInput,
  PaymentResult,
  RefundPaymentInput,
  TerminalAdapter,
  TerminalHealth,
  VoidPaymentInput,
} from './terminal-adapter.interface';
import { ConnectResult, ConnectorCapabilities, ProviderId } from '../connectors/connector.types';

/**
 * Scaffolded adapters for phases 2 and 3.
 *
 * They exist so the adapter contract is proven against more than one shape of
 * integration, and so adding USB or Bluetooth later is a drop-in rather than a
 * refactor. Every one of them is `enabled: false`: the registry refuses to
 * return a disabled adapter and the salon UI never lists it, so an unfinished
 * integration cannot reach a paying salon.
 *
 * Deliberately no logic here. A half-working charge path is worse than none.
 */

const NOT_READY = 'This terminal type is not available yet';

abstract class NotImplementedAdapter implements TerminalAdapter {
  abstract readonly id: ProviderId;
  abstract readonly connectionType: ConnectionType;
  readonly enabled = false;

  protected fail(): never {
    throw new Error(`${NOT_READY} (${this.id} / ${this.connectionType})`);
  }

  getCapabilities(): ConnectorCapabilities {
    return { terminal: true, online: false, tapToPay: false, interac: false, partialRefund: false, currencies: [] };
  }
  async connect(_cred: AdapterCredentials): Promise<ConnectResult> {
    return { ok: false, capabilities: this.getCapabilities(), error: NOT_READY };
  }
  async disconnect(): Promise<void> {
    /* nothing held */
  }
  async testConnection(): Promise<TerminalHealth> {
    return { online: false, message: NOT_READY };
  }
  async createPayment(_c: AdapterCredentials, _i: CreatePaymentInput): Promise<PaymentResult> {
    this.fail();
  }
  async getPaymentStatus(): Promise<PaymentResult> {
    this.fail();
  }
  async cancelPayment(): Promise<PaymentResult> {
    this.fail();
  }
  async voidPayment(_c: AdapterCredentials, _i: VoidPaymentInput): Promise<PaymentResult> {
    this.fail();
  }
  async refundPayment(_c: AdapterCredentials, _i: RefundPaymentInput): Promise<PaymentResult> {
    this.fail();
  }
}

/**
 * Phase 2 — terminals reached over a USB cable through the Lumio Payment
 * Bridge running on the salon's Windows PC. Only models with an official
 * vendor SDK will be supported.
 */
@Injectable()
export class UsbTerminalAdapter extends NotImplementedAdapter {
  readonly id: ProviderId = 'usb';
  readonly connectionType: ConnectionType = 'USB';
}

/**
 * Phase 3 — terminals paired over Bluetooth to the Lumio Payment Companion
 * app, for technicians taking payment at the chair.
 */
@Injectable()
export class BluetoothTerminalAdapter extends NotImplementedAdapter {
  readonly id: ProviderId = 'bluetooth';
  readonly connectionType: ConnectionType = 'BLUETOOTH';
}
