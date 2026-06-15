# Lumio Booking — Admin design (information architecture)

A reference for what a salon booking SaaS admin should contain, why, and what is
built today. Modelled on best practice (Amelia, Booksy, Fresha) adapted to the
multi-tenant Lumio architecture.

## Design principles

1. **Daily-use first.** The things a salon touches every day (today's schedule,
   incoming bookings) are one click away; configuration lives deeper.
2. **Catalog vs operations.** "What we sell" (services, add-ons, staff) is set up
   once and changes rarely; "what's happening" (calendar, bookings, payments)
   is live. Keep them separate in the nav.
3. **Settings drive the product.** Configuration must actually change behavior
   (e.g. slot step + business hours reshape the public booking page), not be
   decorative.
4. **Tenant-scoped everywhere.** Every screen shows only this salon's data.

## Recommended admin sections

| Section | Purpose | Status |
| --- | --- | --- |
| **Overview** | KPIs at a glance: today's bookings, pending, revenue, counts | ✅ |
| **Calendar** | Month/week/day view of appointments | ✅ (month) |
| **Bookings** | List + manage: assign, accept/reject, complete, cancel, payment | ✅ |
| **Customers** | Client list, contact info, booking history, search | ✅ |
| **Services (Catalog)** | Services + **add-ons (extras)**, price, duration, active | ✅ |
| **Staff (Employees)** | Technicians, skills, working hours, **avatar**, performance | ✅ |
| **Payments (Finance)** | Payment history, collected total, online/at-salon | ✅ |
| **Notifications** | Sent email/SMS history (mock provider today) | ✅ |
| **Settings** | Company profile, **booking rules**, **branding** | ✅ |
| **Integrations** | WordPress API keys + the hosted online booking link | ✅ |
| Locations | Multi-location / multi-branch | ⬜ roadmap (plan-gated) |
| Custom fields | Extra questions on the booking form | ⬜ roadmap |
| Coupons / promotions | Discount codes | ⬜ roadmap |
| Reports / analytics | Revenue charts, staff utilisation, no-show rate | ⬜ roadmap |
| Roles & permissions | Fine-grained sub-roles within a salon | ⬜ roadmap |

## Settings — streamlined (what to keep vs cut)

Modelled on Amelia but trimmed to what a 1-on-1 nail salon actually needs. Each
setting must change real behavior on the booking page, or it's not worth a field.

**Keep (implemented):**
- **Company** — name, contact email/phone, **address**, website, timezone.
- **Business hours** — per-weekday open/close + closed toggle. Slots are only
  offered within these hours; closed days are greyed out on the calendar.
- **Days off** — specific closed dates (holidays); no slots on them.
- **Booking rules** — time slot step (10–60 min), min hours before booking,
  booking window (days ahead), **let customers choose technician** (off = always
  auto-assign), and **enable pay-online / pay-at-salon** toggles.
- **Branding** — accent color (drives the booking page theme via a CSS variable)
  and logo URL; groundwork for white-label.

**Cut on purpose (unnecessary for this product):**
- WP license activation (we're SaaS), capacity / people-counting (no group
  events), currency symbol/separator/decimals formatting, languages, items-per-
  page, redirect URL, client-timezone display, ICS files, mail-service config
  (handled centrally via env adapters), and fine-grained roles & permissions
  (three fixed roles cover it).

All settings persist in the existing `settings` table (JSON) + `tenant.branding`
— no schema migration. The public booking page reads them via
`GET /api/public/salons/:slug` and applies them live.

The customer booking page (`/book/:slug`) reads these via
`GET /api/public/salons/:slug` and applies them, so a salon can self-serve its
look and scheduling behavior with no developer involvement.

## Two customer environments (recap)

1. **WordPress plugin** — API-key authenticated embed.
2. **Hosted booking link** — `/book/:slug`, no key, multi-step wizard with
   service → add-ons → date/time → info → payment.

## Suggested next optimisations

- Calendar: add week/day views and click-to-open a booking.
- Reports: revenue over time, staff utilisation, no-show/cancellation rates.
- Custom fields + coupons for richer booking forms and promotions.
- Real provider integrations (Stripe / Twilio / SendGrid) behind the existing
  adapters.
- Per-staff working hours editor in the Staff screen (model already supports it).
