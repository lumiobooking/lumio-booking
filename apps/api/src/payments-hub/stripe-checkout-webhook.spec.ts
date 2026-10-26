/**
 * Stripe Checkout (online deposits): the signed "paid" event names the
 * session the booking holds, so the deposit is recorded even when the
 * customer never comes back to the page.
 */
import Stripe from 'stripe';
import { StripeTerminalConnector } from './connectors/stripe-terminal.connector';

const secret = 'whsec_test_secret';
function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { body: Buffer.from(payload), header };
}
const session = (o: Record<string, unknown>) => ({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_1', ...o } } });

describe('Stripe Checkout webhook', () => {
  const c = new StripeTerminalConnector();
  it('paid session → SUCCEEDED on the session id, with the payment id', () => {
    const { body, header } = signed(session({}));
    const r = c.verifyWebhook(body, header, secret);
    expect(r).toMatchObject({ intentExternalId: 'cs_test_1', status: 'SUCCEEDED', raw: { paymentId: 'pi_1' } });
  });
  it('completed but not yet paid (bank debit) stays PROCESSING; expired is CANCELED', () => {
    const a = signed(session({ payment_status: 'unpaid' }));
    expect(c.verifyWebhook(a.body, a.header, secret).status).toBe('PROCESSING');
    const b = signed({ ...session({ payment_status: 'unpaid' }), type: 'checkout.session.expired' });
    expect(c.verifyWebhook(b.body, b.header, secret).status).toBe('CANCELED');
  });
  it('a forged signature is refused', () => {
    const { body } = signed(session({}));
    expect(() => c.verifyWebhook(body, 't=1,v1=deadbeef', secret)).toThrow();
  });
});
