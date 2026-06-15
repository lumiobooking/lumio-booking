# Lumio Booking — Architecture

Multi-tenant SaaS booking platform for nail salons. One deployment serves many
salons (tenants); each salon's data is fully isolated.

---

## 1. High-level shape

```
            ┌──────────────────────┐         ┌───────────────────────────┐
            │  Next.js dashboard    │  HTTPS  │      NestJS API           │
 Salon /    │  (port 3005)          │◄───────►│      (port 8005)          │
 Super /    │  - login              │  JWT    │  - JWT auth + RBAC        │
 Staff      │  - super-admin/*      │         │  - tenant-scoped services │
            │  - salon/*            │         │                           │
            │  - staff/*            │         │            ┌──────────────┤
            └──────────────────────┘         │            │  PostgreSQL  │
                                             │            │  (Prisma)    │
   ┌──────────────────────┐  X-Lumio-Api-Key │            └──────────────┤
   │  WordPress plugin     │◄───────────────►│  - /public/* (API key)    │
   │  [lumio_booking]      │   (server-side)  │  - mock email/SMS/payment │
   └──────────────────────┘                  └───────────────────────────┘
```

- **Backend:** Node.js + NestJS + Prisma → `apps/api` (port **8005**)
- **Frontend:** Next.js App Router → `apps/web` (port **3005**)
- **Database:** PostgreSQL (local Docker, or a cloud Postgres such as Neon)
- **WordPress plugin:** `wordpress-plugin/lumio-booking` (PHP)

---

## 2. Multi-tenancy model

`Tenant` (a salon) is the root entity. Tenant-scoped tables all carry a
`tenantId` and are indexed on it: `services`, `staff_members`,
`staff_working_hours`, `staff_services`, `customers`, `appointments`,
`payments`, `notifications`, `booking_rejections`, `assignment_rules`,
`wordpress_sites`, `api_keys`, `subscriptions`, `settings`, `audit_logs`.
Platform-level tables (`plans`, and `SUPER_ADMIN` rows in `users`) are not
tenant-scoped by design.

### How isolation is enforced (defence in depth)

1. **Signed tenantId.** The JWT carries the user's `tenantId`; the client cannot
   forge it. The WordPress flow derives `tenantId` from the API key instead.
2. **Single choke point.** `src/common/tenant/tenant-context.ts` exposes
   `assertTenantAccess`, `resolveTenantScope`, and `scopeByTenant`. Every
   tenant-scoped query resolves its `tenantId` from the authenticated principal,
   never from client input — a salon user cannot widen a query to another tenant.
3. **404 over 403 on reads.** Reading a resource by an id that belongs to another
   tenant filters on `{ id, tenantId }` and returns `404`.
4. **`updateMany`/`deleteMany` with `tenantId`** in the filter as a second net on
   writes, so a forged id cannot mutate another tenant's row.
5. **Tests.** Cross-tenant isolation is covered by unit tests (see §6).

---

## 3. Roles & access control

| Role | Scope | Can do |
| --- | --- | --- |
| `SUPER_ADMIN` | Platform (no tenant) | Manage all tenants/plans/subscriptions |
| `SALON_ADMIN` | One tenant | Manage that salon's services, staff, bookings, payments, notifications, API keys |
| `STAFF` | One tenant | See/accept/reject their own assigned bookings |
| *(end customer)* | — | Book via the WordPress plugin (API key) |

A global `JwtAuthGuard` authenticates every route unless marked `@Public()`. A
global `RolesGuard` enforces `@Roles(...)`. The WordPress endpoints are `@Public`
+ `ApiKeyGuard`.

---

## 4. Backend modules (`apps/api/src`)

| Module | Responsibility |
| --- | --- |
| `auth` | Login, JWT strategy, password hashing, global guards, decorators |
| `common/tenant` | Tenant-isolation helpers (the choke point) |
| `audit` | Writes `audit_logs` (tenantId, userId, action, resource, metadata) |
| `tenants` | Super Admin: tenant CRUD, suspend/reactivate, plans |
| `services` | Salon Admin: service CRUD (tenant-scoped) |
| `staff` | Salon Admin: staff CRUD + skills + working hours |
| `bookings` | Booking lifecycle, anti-double-booking, accept/reject, reassignment |
| `assignment` | Rule engine: ranks eligible staff for a booking |
| `api-keys` | Salon Admin: create/list/revoke WordPress API keys (hashed) |
| `public` | API-key-authenticated endpoints for the WordPress plugin |
| `notifications` | Email/SMS provider abstraction + mock + delivery history |
| `payments` | Payment provider abstraction + mock + records |

---

## 5. Key flows

### Booking + anti double-booking
Statuses: `pending → assigned → accepted → confirmed → completed`, plus
`rejected`, `cancelled`, `no_show`. When a staff is assigned, creation/assignment
runs in a transaction that takes a PostgreSQL `pg_advisory_xact_lock` keyed by
`(tenantId, staffId)`, checks for an overlapping `ASSIGNED/ACCEPTED/CONFIRMED`
appointment, then writes. The lock serialises concurrent requests so two clients
cannot double-book the same slot. Back-to-back bookings are allowed.

### Assignment engine
Hard eligibility (active, has the skill, working at that local time, no overlap,
not a prior rejecter), then a rule-based score: preferred-staff bonus, base
performance score, exclusion over rejection/no-response thresholds, and
fair-distribution. Rules come from each tenant's `assignment_rules` rows or
sensible defaults. On reject/no-response a `booking_rejections` row is written and
the engine reassigns to the next best staff, or returns the booking to `PENDING`.

### Two customer booking environments
End customers can book through either channel, both backed by the same
`BookingsService.createForTenant` core (a booking starts `PENDING`):

1. **WordPress plugin** (`/api/public/*`, API-key auth). The plugin stores the
   API base URL + key in WordPress options (never hard-coded). The form calls the
   plugin's own same-origin REST proxy (`/wp-json/lumio/v1/*`); PHP forwards to
   the backend with `X-Lumio-Api-Key`. The key is server-side only, never exposed
   to visitors. Keys are SHA-256 hashed and revocable.

2. **Hosted online booking link** (`/api/public/salons/:slug/*`, slug-based, no
   key). A shareable per-salon URL `/book/<slug>` renders a public booking page
   (only ACTIVE salons are reachable). Salon Admin → Integrations surfaces the
   link. Future hardening for this open endpoint: rate-limiting / CAPTCHA.

### Notifications & payments
Both are provider abstractions with a mock implementation, selected by env
(`EMAIL_PROVIDER`, `SMS_PROVIDER`, `PAYMENT_PROVIDER`, default `mock`). Real
providers (SendGrid/Twilio/Stripe) plug into the factory switch later, reading
secrets from env — no business-logic changes, no secrets in code.

---

## 6. Testing

Run from the repo root:

```bash
npm run test --workspace=apps/api
```

67 unit tests across 12 files, including:

- **Tenant isolation** — `tenant-context`, `services`, `staff`, `bookings`,
  `payments`: a salon cannot read/modify/pay another salon's data.
- **RBAC** — `roles.guard`: wrong role is rejected.
- **Anti double-booking** — `booking.util`, `bookings.service`: overlap maths and
  lock-before-check-before-create ordering, conflict rejection.
- **Assignment engine** — `assignment.util`: preferred boost, rejection/no-response
  exclusion, fair-distribution and performance ordering, working-hours helpers.
- **API keys** — `api-key.util`, `api-key.guard`: hashing/verification and
  valid/missing/unknown/revoked/expired/suspended-salon cases.
- **Adapters** — `notifications`, `payments`: mock providers, recording, and
  online-vs-later payment status.

---

## 7. Security checklist

- No secrets in source — all from environment variables (`.env`, git-ignored).
- Passwords hashed with bcrypt; API/license keys stored as SHA-256, revocable.
- Role-based access control + tenant isolation enforced at the service layer.
- All API input validated (global `ValidationPipe`, whitelist on).
- Important actions written to `audit_logs`.
- WordPress API key used server-side only; never exposed to the browser.

---

## 8. Roadmap status

1–9 complete (structure, multi-tenant DB, auth+roles, Super Admin portal, Salon
Admin services/staff, booking foundation, assignment engine, WordPress connector,
notification/payment adapters). Step 10 (consolidated tests + docs) — this
document. Future hardening: real provider integrations, Redis-backed queues for
the no-response timeout sweep, a PostgreSQL `EXCLUDE` constraint as an extra
double-booking guard, and white-label branding per tenant.
