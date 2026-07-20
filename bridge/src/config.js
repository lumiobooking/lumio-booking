'use strict';
// Local config for the Bridge. Stored under %PROGRAMDATA%\LumioBridge on Windows.
// Holds the API URL, the paired agent token and the chosen terminal driver.
// SECURITY: the agent token is a credential — the file is created with 0600 and
// must never be logged. (For production hardening, wrap it with Windows DPAPI.)
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR =
  process.env.LUMIO_BRIDGE_DIR ||
  (process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'LumioBridge')
    : path.join(os.homedir(), '.lumio-bridge'));

const FILE = path.join(DIR, 'config.json');

const DEFAULTS = {
  apiUrl: process.env.LUMIO_API_URL || 'https://lumio-api.onrender.com/api',
  agentToken: null,
  // Which provider the registered terminals belong to (must already be connected
  // in the salon's Lumio payment settings). 'mock' works with the simulator.
  provider: process.env.LUMIO_BRIDGE_PROVIDER || 'mock',
  driver: process.env.LUMIO_BRIDGE_DRIVER || 'simulator',
  pollMs: 2000,
};

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* windows ignores */ }
  return cfg;
}

module.exports = { load, save, FILE, DIR };
