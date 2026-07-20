'use strict';
/**
 * Terminal driver registry.
 *
 * A driver is the ONLY provider-specific part of the Bridge. Everything else
 * (pairing, polling, results, reconnect) is provider-agnostic.
 *
 * Implement this shape to add a real terminal (Adyen Local Terminal API, PAX,
 * Verifone, Datacap…), drop the file in this folder and register it below:
 *
 *   module.exports = {
 *     name: 'adyen',
 *     async discover()                      -> [{ id, label }]
 *     async charge({ amountCents, currency, readerId, intentId })
 *                                           -> { ok, reference?, error? }
 *     async cancel(readerId)                -> void
 *   };
 *
 * The driver must NEVER return or log PAN / CVV / PIN / track data — only the
 * provider's transaction reference.
 */
const simulator = require('./simulator');

const DRIVERS = { simulator };

function getDriver(name) {
  const d = DRIVERS[name];
  if (!d) {
    throw new Error(`Unknown terminal driver "${name}". Available: ${Object.keys(DRIVERS).join(', ')}`);
  }
  return d;
}

module.exports = { getDriver, DRIVERS };
