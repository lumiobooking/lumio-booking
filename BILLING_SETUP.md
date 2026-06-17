# Lumio Booking — Self-serve subscriptions setup

This guide turns on the new flow: visitors see your marketing homepage → pick a
plan → create an account → pay on Stripe/PayPal → their salon **activates
automatically** and renews on its own.

Do these once after deploying.

---

## 1. Render environment variables (service `lumio-api`)

Add these in **Render → lumio-api → Environment**, then redeploy:

| Key | Value |
|-----|-------|
| `APP_URL` | `https://lumiobooking.com` (your web app URL) |
| `STRIPE_SECRET_KEY` | `sk_live_…` from Stripe |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (from step 2) |
| `PAYPAL_ENV` | `live` (or `sandbox` to test) |
| `PAYPAL_CLIENT_ID` | from your PayPal REST app |
| `PAYPAL_SECRET` | from your PayPal REST app |
| `PAYPAL_WEBHOOK_ID` | from step 3 |

You can launch with **Stripe only** and add PayPal later — each provider only
appears at checkout once its keys + plan IDs are set.

---

## 2. Stripe setup

No products/prices to create — the app charges the plan's amount directly via
inline pricing. You only need:

1. **Webhook** — Developers → Webhooks → *Add endpoint*:
   - URL: `https://<your-api>.onrender.com/api/billing/webhook/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`.
   - Copy the **Signing secret** (`whsec_…`) → set as `STRIPE_WEBHOOK_SECRET`.
2. (For self-serve upgrades) enable the **Customer Billing Portal** in Stripe →
   Settings → Billing → Customer portal (turn on plan switching + cancel).

## 3. PayPal setup (optional)

No billing plans to create — the app creates them automatically from the plan
amounts. You only need:

1. **REST app** — developer.paypal.com → Apps & Credentials → create app →
   copy Client ID & Secret.
2. **Webhook** — App → Webhooks → add:
   - URL: `https://<your-api>.onrender.com/api/billing/webhook/paypal`
   - Events: `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`,
     `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`,
     `BILLING.SUBSCRIPTION.SUSPENDED`.
   - Copy the **Webhook ID** → set as `PAYPAL_WEBHOOK_ID`.

---

## 4. Configure your plans (Super Admin)

Sign in as Super Admin → **Plans**. For **Starter** and **Pro**:

1. Set **Price $/month** ($29 / $79) and **Price $/year** (e.g. $290 / $790).
2. Set **Free trial (days)** = 14.
3. Fill the **marketing** tagline + selling points (one per line).
4. Turn on **Show on website** (and **Highlight** on Pro for the "Most popular" badge).

That's it — **no payment IDs to paste.** Stripe charges the amount directly and
PayPal plans are auto-created on first checkout. Save and your homepage pricing
section shows these plans.

---

## 5. Test the flow

1. Open your homepage → **Pricing** → click a plan.
2. Fill in salon + email + password → continue to Stripe/PayPal.
3. Pay (use a Stripe test card in `sandbox`/test mode, e.g. `4242 4242 4242 4242`).
4. You're sent to **/welcome**. Within a few seconds the webhook activates the
   account — sign in at **/login**.

If sign-in says "awaiting payment", the webhook hasn't arrived yet — check the
webhook delivery logs in Stripe/PayPal and that the URL + secret are correct.

---

### How activation & renewal work
- Accounts are created **PENDING** and can't log in until a payment webhook
  flips them to **ACTIVE** — so an abandoned checkout never gives free access.
- During the 14-day trial the salon is fully active. Stripe/PayPal then charge
  automatically each period; renewal webhooks keep the account active, and a
  cancellation/expiry webhook suspends it.
