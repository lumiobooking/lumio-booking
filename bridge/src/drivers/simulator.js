'use strict';
// Simulator driver — lets the whole Bridge loop be tested end-to-end with no
// hardware. Approves every charge after a short delay. NEVER for real money.
module.exports = {
  name: 'simulator',

  async discover() {
    return [{ id: 'SIM-TERMINAL-1', label: 'Simulated USB Terminal' }];
  },

  async charge({ amountCents, currency, intentId }) {
    // Pretend the customer taps the card.
    await new Promise((r) => setTimeout(r, 3000));
    return { ok: true, reference: `sim_${intentId}`, };
  },

  async cancel() {
    return;
  },
};
