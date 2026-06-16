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

1. **Create products & prices** — Stripe Dashboard → Products. For each plan
   (Starter, Pro) add a **recurring** price for **Monthly** and one for **Yearly**.
   Copy each price id (looks like `price_1AbC…`).
2. **Webhook** — Developers → Webhooks → *Add endpoint*:
   - URL: `https://lumio-api.onrender.com/api/billing/webhook/stripe`
     *(use your API URL; it ends in `/api/billing/webhook/stripe`)*
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`.
   - Copy the **Signing secret** (`whsec_…`) → set as `STRIPE_WEBHOOK_SECRET`.

## 3. PayPal setup (optional)

1. **REST app** — developer.paypal.com → Apps & Credentials → create app →
   copy Client ID & Secret.
2. **Billing plans** — create a subscription **Plan** for each plan + interval
   (Monthly, Yearly). Copy each plan id (looks like `P-….`).
3. **Webhook** — App → Webhooks → add:
   - URL: `https://lumio-api.onrender.com/api/billing/webhook/paypal`
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
5. Paste the **Stripe price IDs** and/or **PayPal plan IDs** (monthly + yearly)
   you created above.

Save. Your homepage pricing section now shows these plans.

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
