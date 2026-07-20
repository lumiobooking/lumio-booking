'use strict';
/**
 * Lumio Payment Bridge — Windows local service.
 *
 * POS Web -> Lumio Backend -> [this Bridge] -> provider SDK -> USB/LAN terminal
 *
 * Pairs to one tenant/location with a one-time code, then polls the backend for
 * queued payment commands, runs them on the terminal through a driver, and posts
 * the result back. Provider-agnostic: only `src/drivers/*` is provider-specific.
 *
 * SECURITY: never stores or logs card numbers, CVV, PIN or track data, and never
 * logs the agent token or provider secrets.
 */
const { load, save, FILE } = require('./config');
const api = require('./api');
const { getDriver } = require('./drivers');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerTerminals(cfg, driver) {
  const terminals = await driver.discover();
  for (const t of terminals) {
    await api.registerReader(cfg, cfg.provider, t.id, t.label);
    log(`terminal registered: ${t.label} (${t.id})`);
  }
  if (!terminals.length) log('no terminals found by driver', driver.name);
}

async function handleCommand(cfg, driver, command) {
  const { intentId, amountCents, currency, externalReaderId } = command;
  log(`charge ${(amountCents / 100).toFixed(2)} ${currency} on ${externalReaderId || 'default'} (intent ${intentId})`);
  try {
    const r = await driver.charge({ amountCents, currency, readerId: externalReaderId, intentId });
    if (r && r.ok) {
      await api.result(cfg, intentId, 'SUCCEEDED', r.reference);
      log('=> SUCCEEDED');
    } else {
      const msg = (r && r.error) || 'declined';
      await api.result(cfg, intentId, 'FAILED', undefined, msg);
      log('=> FAILED:', msg);
    }
  } catch (e) {
    await api.result(cfg, intentId, 'FAILED', undefined, e.message).catch(() => {});
    log('=> ERROR:', e.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cfg = load();

  // ---- Pairing mode: npm run pair -- <CODE> ----
  const i = args.indexOf('--pair');
  if (i !== -1) {
    const code = (args[i + 1] || process.env.LUMIO_PAIRING_CODE || '').trim().toUpperCase();
    if (!code) {
      console.error('Usage: npm run pair -- <PAIRING_CODE>');
      process.exit(1);
    }
    const r = await api.pair(cfg, code);
    cfg.agentToken = r.agentToken;
    save(cfg);
    log(`paired OK (agent ${r.agentId}, kind ${r.kind}). config: ${FILE}`);
    if (args.includes('--exit')) return;
  }

  if (!cfg.agentToken) {
    console.error('Not paired yet.');
    console.error('In Lumio: Card terminals -> Devices & Agents -> "+ Bridge (USB)" to get a code, then run:');
    console.error('   npm run pair -- <PAIRING_CODE>');
    process.exit(1);
  }

  const driver = getDriver(cfg.driver);
  log(`bridge starting — driver=${driver.name} provider=${cfg.provider} api=${cfg.apiUrl}`);

  await registerTerminals(cfg, driver).catch((e) => log('register failed:', e.message));

  let stop = false;
  const shutdown = () => { stop = true; log('shutting down'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let backoff = 1000;
  let wasOffline = false;

  while (!stop) {
    try {
      const res = await api.poll(cfg);
      if (wasOffline) { log('reconnected'); wasOffline = false; registerTerminals(cfg, driver).catch(() => {}); }
      backoff = 1000;
      if (res && res.command) await handleCommand(cfg, driver, res.command);
      else await sleep(cfg.pollMs);
    } catch (e) {
      if (e.status === 401) {
        log('agent token rejected — re-pair with a new code. Exiting.');
        process.exit(1);
      }
      wasOffline = true;
      log('offline:', e.message, `— retry in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
