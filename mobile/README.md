# Lumio Payment Companion — Bluetooth bridge (FOUNDATION)

Minimal native **payment bridge** — **NOT a full Mobile POS**. Its only job: connect a
**Bluetooth card reader** and execute payment requests that come **from the Lumio
backend** (the cashier still rings up the sale on POS Web). It does **not** handle
orders, booking, customers or staff.

Architecture (v2): `POS Web -> Lumio Backend -> Lumio Payment Companion -> Provider
Mobile SDK -> Bluetooth Reader`. Card data is captured on the reader (P2PE) — never on
Lumio's servers (PCI SAQ A).

> ⚠️ **Foundation, not store-ready.** The current scaffold shows login + reader connect.
> It will be reframed into a **command listener** (the amount comes from the backend over
> a secure channel, not typed in the app). Tap to Pay is out of scope for the early phase.
> See `docs/Lumio-Payment-Terminal-Architecture-v2.md`.

## How it fits Lumio
- **Auth:** staff signs in (`POST /auth/login`) → JWT held in memory.
- **Connection token:** the SDK asks Lumio (`POST /payments-hub/connection-token/stripe`),
  which signs it with the salon's own Stripe key (backend already built).
- **Charge:** `POST /payments-hub/charge` **without a reader** → backend returns a
  PaymentIntent + `clientSecret`; the SDK then collects + confirms on-device over
  Bluetooth / Tap to Pay.

## Prerequisites
1. **Node 18+** and the **Expo** toolchain.
2. A **development build** (NOT Expo Go — Stripe Terminal has native modules):
   `npx expo prebuild`, then `npx expo run:ios` / `run:android` (or EAS Build).
3. The salon's **Stripe account** with **Terminal** enabled and a **Location** created.
4. **Tap to Pay on iPhone**: Apple entitlement (request via Stripe) + physical device
   (iPhone XS+). **Android Tap to Pay**: NFC device + Google approval.
5. Bluetooth + Location permissions (declared in `app.json`).

## Configure (env)
- `EXPO_PUBLIC_LUMIO_API` = `https://lumio-api.onrender.com/api` (default)
- `EXPO_PUBLIC_STRIPE_LOCATION` = the salon's Stripe **Location id** (`tml_…` / `loc_…`)

## Run
```
cd mobile
npm install
npx expo prebuild
npx expo run:ios        # or: npx expo run:android  (real device)
```

## Status — done vs TODO
**Done (foundation):** login → JWT, connection-token proxy, Bluetooth scan/connect,
Tap to Pay path, server-created PaymentIntent + on-device collect/confirm, basic UI.

**TODO before production (your side):**
- Pin `@stripe/stripe-terminal-react-native` to a version and align method signatures
  (a couple vary by version — see comments in `PayScreen.tsx`).
- Secure JWT storage (expo-secure-store) + refresh; link payment to a POS order;
  print/SMS receipt; robust reader lifecycle; auto-fetch Location; icons/splash;
  EAS build profiles; device QA.
- Only Stripe is wired for mobile; SumUp/Square mobile SDKs are separate integrations.

## Security
- Card data is captured by the reader / Tap to Pay (P2PE) — never sent to Lumio.
- The app holds only a short-lived connection token + the staff JWT.
- The salon's Stripe secret key stays on the Lumio backend (encrypted), never in the app.
