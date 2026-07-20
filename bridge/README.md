# Lumio Payment Bridge (Windows)

Local service that lets Lumio POS charge a **USB / LAN card terminal** sitting at the
counter.

```
POS Web  ->  Lumio Backend  ->  [ Lumio Payment Bridge ]  ->  provider SDK  ->  USB terminal
```

The Bridge is **provider-agnostic**: pairing, polling, results, reconnect and security
are done here; only `src/drivers/*` knows a specific terminal. A **simulator driver**
ships so the whole loop can be tested today without hardware.

## Requirements
- Windows PC at the counter with **Node.js 18+**.
- The salon has already connected a payment provider in Lumio (Card terminals).

## Install & pair
1. Copy this `bridge/` folder onto the Windows PC.
2. In Lumio: **Card terminals → Devices & Agents → “+ Bridge (USB)”** → copy the code.
3. On the PC:
   ```
   cd bridge
   npm run pair -- ABC123
   npm start
   ```
   You should see `paired OK`, then `terminal registered`, then it waits for sales.

The terminal now appears in POS; paying by CARD sends the amount to it automatically.

## Auto-start with Windows
**Task Scheduler (simplest)**
- Create Task → Trigger: *At startup* → Action: `node` with arguments `C:\lumio\bridge\src\index.js`,
  Start in `C:\lumio\bridge` → check *Run whether user is logged on or not*.

**As a real service (NSSM)**
```
nssm install LumioBridge "C:\Program Files\nodejs\node.exe" "C:\lumio\bridge\src\index.js"
nssm set LumioBridge AppDirectory C:\lumio\bridge
nssm start LumioBridge
```

## Configuration
Stored at `%PROGRAMDATA%\LumioBridge\config.json` (created on pairing):

| Field | Meaning |
|---|---|
| `apiUrl` | Lumio API base (default production) |
| `agentToken` | Pairing credential — **never share or log** |
| `provider` | Provider the terminals belong to (must be connected in Lumio) |
| `driver` | Terminal driver: `simulator` today |
| `pollMs` | Poll interval (default 2000) |

## Adding a real terminal (Adyen Local / PAX / Verifone…)
Create `src/drivers/<name>.js`:
```js
module.exports = {
  name: 'adyen',
  async discover() { return [{ id, label }]; },
  async charge({ amountCents, currency, readerId, intentId }) {
    return { ok: true, reference: '<provider txn id>' };
  },
  async cancel(readerId) {},
};
```
Register it in `src/drivers/index.js`, then set `"driver": "adyen"` in the config.
**The driver must never return or log PAN / CVV / PIN / track data** — only the
provider's transaction reference.

## Status
- ✅ Pairing, auto-start, polling, result reporting, online/offline, auto-reconnect,
  token stored with restricted permissions, no card data, no secrets in logs.
- ⏳ Real USB provider driver — pending the provider choice (Adyen Local / PAX).
  Everything else is done; the driver is a drop-in file.

## Security
- Card data is captured by the terminal (P2PE) — it never reaches the Bridge or Lumio.
- Only amounts + intent ids cross the Bridge↔backend channel (HTTPS, agent token).
- Token file is written 0600. For extra hardening wrap it with Windows **DPAPI**.
- Unpair any time from Lumio (Devices & Agents) — the token stops working immediately.
