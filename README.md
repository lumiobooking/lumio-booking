# Lumio Booking

Multi-tenant SaaS booking platform for nail salons. One codebase serves many
salons (tenants); each salon's data, settings, staff, services, customers,
bookings, payments, notifications and WordPress connection are fully isolated.

> **Ports (important):** the dashboard runs on **3005**, the API on **8005**.
> Port 3000 is intentionally **not** used by this project.

---

## Terminology

| Term | Meaning |
| --- | --- |
| **Tenant / Salon / Business Customer** | A nail salon that buys and uses the software |
| **End Customer / Client** | The salon's customer who books an appointment |
| **Staff / Technician** | A salon employee / nail technician |
| **Super Admin** | The Lumio platform team managing all tenants |
| **Salon Admin** | The owner/manager of one salon |

---

## Tech stack

- **Backend / API:** Node.js + NestJS + Prisma ORM → http://localhost:8005
- **Frontend / Admin dashboard:** Next.js (App Router) → http://localhost:3005
- **Database:** PostgreSQL
- **Queue (later):** Redis
- **WordPress plugin (later):** lightweight PHP plugin calling the API with a
  tenant-specific, revocable API/license key

---

## Repository structure

```
lumio-booking/
├── apps/
│   ├── api/                 # NestJS backend (port 8005)
│   │   ├── prisma/
│   │   │   ├── schema.prisma # Multi-tenant database schema
│   │   │   └── seed.ts       # Baseline plans + demo tenant
│   │   └── src/
│   │       ├── main.ts       # Bootstrap, listens on 8005
│   │       ├── app.module.ts
│   │       ├── prisma/       # PrismaService / PrismaModule
│   │       └── health/       # GET /api/health
│   └── web/                 # Next.js admin dashboard (port 3005)
│       └── src/app/          # App Router pages
├── packages/                # Shared code (added later)
├── wordpress-plugin/        # PHP plugin (added later)
├── docs/
├── docker-compose.yml       # PostgreSQL + Redis for local dev
└── package.json             # npm workspaces (monorepo root)
```

---

## Multi-tenant design (how isolation is enforced)

- `Tenant` is the **root entity**. One row = one salon.
- Every tenant-scoped table carries a **`tenantId`** column and is indexed on it:
  `services`, `staff_members`, `staff_working_hours`, `staff_services`,
  `customers`, `appointments`, `payments`, `notifications`,
  `booking_rejections`, `assignment_rules`, `wordpress_sites`, `api_keys`,
  `subscriptions`, `settings`, `audit_logs`.
- Platform-level tables (`plans`, and `SUPER_ADMIN` rows in `users`) are not
  tenant-scoped, by design.
- The backend has its **own user system** (`users` table) — it does **not** rely
  on WordPress users. Roles: `SUPER_ADMIN`, `SALON_ADMIN`, `STAFF`.
- API/license keys for the WordPress plugin are stored **hashed** (`keyHash`)
  and are **revocable**; no plaintext secrets live in the database or the plugin.
- A tenant-isolation guard/middleware (Step 3) injects the authenticated
  `tenantId` into every request, and all tenant-scoped queries are filtered by
  it so Tenant A can never read or modify Tenant B's data.

---

## Local setup

### 1. Prerequisites

- Node.js >= 20
- Docker (for PostgreSQL + Redis) — or your own local PostgreSQL

### 2. Start the database

```bash
docker compose up -d
```

This starts PostgreSQL on host port **5433** and Redis on **6380** (offset to
avoid clashing with anything already on 5432 / 6379).

### 3. Install dependencies (from the repo root)

```bash
npm install
```

### 4. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The defaults already match `docker-compose.yml`. Generate a real `JWT_SECRET`
before building auth (Step 3), e.g. `openssl rand -base64 48`.

### 5. Create the database schema

```bash
npm run db:generate     # generate Prisma client
npm run db:migrate      # create tables from schema.prisma
npm run db:seed         # optional: 2 plans + 1 demo tenant
```

### 6. Run the apps

```bash
# Terminal 1 - backend API on 8005
npm run dev:api

# Terminal 2 - dashboard on 3005
npm run dev:web
```

Then open:

- **Dashboard:** http://localhost:3005
- **API health:** http://localhost:8005/api/health

The dashboard home page shows live status for the web app, the API and the
database, so you can confirm everything is wired correctly.

---

## Useful scripts (run from repo root)

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Start the NestJS API (port 8005, watch mode) |
| `npm run dev:web` | Start the Next.js dashboard (port 3005) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed baseline data |
| `npm run db:studio` | Open Prisma Studio to inspect the database |
| `npm run build` | Build both apps |

---

## Security baseline

- No secrets in source code — everything comes from environment variables.
- API/license keys are hashed before storage and can be revoked.
- Role-based access control (`SUPER_ADMIN`, `SALON_ADMIN`, `STAFF`).
- All API input is validated (NestJS global `ValidationPipe`, whitelist on).
- Cross-tenant access is blocked at the service/guard layer and covered by tests.
- Important actions are written to `audit_logs` (tenant_id, user_id, action,
  resource_type, resource_id, metadata, created_at).

---

## Authentication & roles (Step 3)

The backend has its own JWT-based auth. Every route is protected by a global
`JwtAuthGuard`; mark a route `@Public()` to opt out (only `POST /auth/login` is
public). A global `RolesGuard` enforces `@Roles(...)`.

Login and inspect the current principal:

```bash
# Get a token (salon A admin)
curl -X POST http://localhost:8005/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@salon-a.test","password":"Password123!"}'

# Use the token
curl http://localhost:8005/api/auth/me -H "Authorization: Bearer <accessToken>"
curl http://localhost:8005/api/me/tenant -H "Authorization: Bearer <accessToken>"
```

Demo accounts created by the seed (local dev only — password `Password123!`):

| Email | Role | Tenant |
| --- | --- | --- |
| superadmin@lumio.test | SUPER_ADMIN | (none / platform) |
| admin@salon-a.test | SALON_ADMIN | Salon A |
| staff@salon-a.test | STAFF | Salon A |
| admin@salon-b.test | SALON_ADMIN | Salon B |

**How tenant isolation is enforced:** the JWT carries the user's `tenantId`
(signed, so the client cannot forge it). Helpers in
`src/common/tenant/tenant-context.ts` (`assertTenantAccess`, `resolveTenantScope`,
`scopeByTenant`) are the single choke point every tenant-scoped query goes
through, so a salon user can never read or widen a query to another tenant.

### Running tests

```bash
# from repo root
npm install                 # installs the new auth packages first
npm run test --workspace=apps/api
```

The suite includes cross-tenant isolation tests (Tenant A cannot reach Tenant
B's data), RBAC tests (wrong role is rejected), and slug generation tests.

---

## Super Admin tenant portal (Step 4)

Web portal (after `npm run dev:web`): open http://localhost:3005/login, sign in
as `superadmin@lumio.test`, then manage salons at
http://localhost:3005/super-admin/tenants (list, create, suspend, reactivate).

API (all `SUPER_ADMIN` only):

| Method & path | Purpose |
| --- | --- |
| `GET /api/tenants` | List salons (filter `?status=` / `?search=`) |
| `GET /api/tenants/plans` | Plans for the create form |
| `GET /api/tenants/:id` | Get one salon |
| `POST /api/tenants` | Create salon + its first Salon Admin |
| `PATCH /api/tenants/:id` | Edit salon |
| `POST /api/tenants/:id/suspend` | Suspend (blocks salon login) |
| `POST /api/tenants/:id/reactivate` | Reactivate |
| `DELETE /api/tenants/:id` | Soft delete (status CANCELLED) |

Every create/update/suspend/reactivate/delete writes an `audit_logs` row
(tenant_id, user_id, action, resource_type, resource_id, metadata). A
`SALON_ADMIN` token calling any `/api/tenants` route gets `403 Forbidden`.

---

## Salon Admin portal (Step 5)

Web portal: sign in as a `SALON_ADMIN` (e.g. `admin@salon-a.test` /
`Password123!`) → routed to http://localhost:3005/salon/services. Tabs:
Services and Staff. Each salon only ever sees its own data.

API (all `SALON_ADMIN` only, scoped to the caller's tenant from the token):

| Method & path | Purpose |
| --- | --- |
| `GET/POST /api/services` | List / create services |
| `GET/PATCH/DELETE /api/services/:id` | Read / edit / delete a service |
| `GET/POST /api/staff` | List / create staff (with skills + working hours) |
| `GET/PATCH/DELETE /api/staff/:id` | Read / edit / delete a staff member |

Tenant isolation: every query filters by the authenticated `tenantId`. Reading
or editing a resource by an id that belongs to another tenant returns `404`,
and writes use `updateMany/deleteMany` with `tenantId` in the filter as a second
safety net. Staff skills can only reference services from the same tenant.

---

## Booking foundation (Step 6)

Web portal: the Salon Admin **Bookings** tab (http://localhost:3005/salon/bookings)
lists appointments and creates new ones (service, customer, date/time, optional
staff). Pending bookings can be assigned; active bookings can be completed or
cancelled.

API (`SALON_ADMIN`, tenant-scoped):

| Method & path | Purpose |
| --- | --- |
| `GET /api/bookings` | List (filters: `status`, `staffId`, `from`, `to`) |
| `POST /api/bookings` | Create (finds/creates the customer in this tenant) |
| `GET /api/bookings/:id` | Read one |
| `POST /api/bookings/:id/assign` | Assign to a staff member (race-safe) |
| `POST /api/bookings/:id/cancel` · `/complete` · `/no-show` | Status changes |

**Anti double-booking & race safety.** Booking status flow:
`pending → assigned → accepted → confirmed → completed`, plus `rejected`,
`cancelled`, `no_show`. When a booking is assigned to a staff member, the create/
assign runs inside a transaction that first takes a PostgreSQL
`pg_advisory_xact_lock` keyed by `(tenantId, staffId)`, then checks for an
overlapping `ASSIGNED/ACCEPTED/CONFIRMED` appointment, then writes. The advisory
lock serializes concurrent requests for the same staff so two clients cannot both
pass the overlap check and double-book the same slot. Back-to-back bookings
(one ends exactly when the next starts) are allowed.

Tests cover the overlap math, the lock-before-check-before-create ordering, the
conflict rejection, and tenant isolation.

---

## Staff accept/reject + assignment engine (Step 7)

**Staff portal:** a technician signs in (e.g. `staff@salon-a.test` /
`Password123!`, linked to "Tina") and lands on
http://localhost:3005/staff/bookings, where they **Accept** or **Reject** the
bookings assigned to them.

**Assignment engine** (`src/assignment`): ranks eligible staff for a booking.
Hard eligibility first (active, has the skill, working at that local time, no
overlapping booking, not already a rejecter), then a configurable rule-based
score:

- customer's **preferred** technician gets a large bonus;
- **performance score** is the base;
- staff over the **rejection** threshold (default ≥3 in 7 days) or **no-response**
  threshold (default ≥3 in 7 days) are excluded;
- **fair distribution** penalises busier staff so load is spread.

Rules come from each tenant's `assignment_rules` rows, falling back to sensible
defaults. Weights/thresholds live in `assignment.util.ts` so they are easy to
unit-test and extend.

**Reassignment flow.** When a staff **rejects** (or **no-responds** past the
deadline), a `booking_rejections` row is written and the engine reassigns to the
next best staff, excluding everyone who already rejected that booking. If nobody
qualifies, the booking returns to `PENDING` for manual handling.

API:

| Method & path | Role | Purpose |
| --- | --- | --- |
| `GET /api/bookings/my` | STAFF | The technician's own assigned bookings |
| `POST /api/bookings/:id/accept` | STAFF | Accept an assigned booking |
| `POST /api/bookings/:id/reject` | STAFF | Reject → auto-reassign |
| `POST /api/bookings/:id/auto-assign` | SALON_ADMIN | Run the engine on a pending booking |
| `POST /api/bookings/process-timeouts` | SALON_ADMIN | No-response sweep + reassign |

In the Salon Admin **Bookings** tab, pending bookings now have an **Auto-assign**
button, and the header has a **Process timeouts** action. (In production the
timeout sweep is driven by a scheduled job/queue rather than a button.)

Tests cover the scoring rules (preferred boost, rejection/no-response exclusion,
fair-distribution and performance ordering) and the working-hours helpers.

---

## WordPress plugin connector (Step 8)

A salon connects its WordPress site to its Lumio account with a **tenant-specific
API key** — no tenant id, key or secret is ever hard-coded in the plugin.

**API key management** (Salon Admin → Integrations tab, http://localhost:3005/salon/integrations):

| Method & path | Purpose |
| --- | --- |
| `GET /api/api-keys` | List this salon's keys (prefix + last 4 only) |
| `POST /api/api-keys` | Generate a key — the plaintext is returned **once** |
| `DELETE /api/api-keys/:id` | Revoke a key |

Keys are stored as a **SHA-256 hash** (never plaintext) and are revocable. Only
`keyPrefix` + `lastFour` are kept for display.

### Two customer booking environments

The same booking core powers both:

1. **WordPress plugin** — authenticated by the API key (the salon controls which
   site embeds the form).
2. **Hosted online booking link** — a public per-salon URL,
   `http://localhost:3005/book/<slug>` (e.g. `/book/salon-a`), that customers
   open directly. No WordPress, no key; the salon is identified by its slug.
   Salon Admin → Integrations shows the link with a Copy button.

**Public (plugin) endpoints** — authenticated by the `X-Lumio-Api-Key` header
via `ApiKeyGuard`, which resolves the tenant and scopes everything to that one
salon (no JWT, no user):

| Method & path | Purpose |
| --- | --- |
| `GET /api/public/services` | Active services for the salon |
| `GET /api/public/staff` | Technicians a customer can request |
| `POST /api/public/bookings` | End-customer booking (starts PENDING) |

**Public (hosted link) endpoints** — identified by salon `slug`, no key, only
ACTIVE salons reachable:

| Method & path | Purpose |
| --- | --- |
| `GET /api/public/salons/:slug` | Public salon info (name, timezone) |
| `GET /api/public/salons/:slug/services` | Active services |
| `GET /api/public/salons/:slug/staff` | Technicians |
| `POST /api/public/salons/:slug/bookings` | End-customer booking (PENDING) |

**The plugin** lives in `wordpress-plugin/lumio-booking/`. Install it on a
WordPress site, then under **Settings → Lumio Booking** enter the API base URL
(`http://localhost:8005/api` in dev) and the API key. Add `[lumio_booking]` to a
page to render the booking form.

Security: the API key is used **server-side only**. The form calls the plugin's
own same-origin REST proxy (`/wp-json/lumio/v1/*`), and PHP forwards to the Lumio
backend with the key attached — so the key is never exposed to site visitors.
Tests cover key hashing/verification and the `ApiKeyGuard` (valid / missing /
unknown / revoked / expired / suspended-salon).

---

## Notification & payment adapters (Step 9)

Both are **provider abstractions with a mock implementation** so real services
plug in later via env, with no business-logic changes and no secrets in code.

**Notifications** (`src/notifications`): `EmailProvider` / `SmsProvider`
interfaces, a `MockEmailProvider` / `MockSmsProvider`, and a factory that reads
`EMAIL_PROVIDER` / `SMS_PROVIDER` (default `mock`; the switch is where
SendGrid/Resend/SES/Twilio go). `NotificationsService.send()` delivers via the
provider AND records every message in the `notifications` table (tenant-scoped,
status `SENT`/`FAILED`). Creating a booking fires a confirmation
(email → else SMS) as fire-and-forget, so it never blocks the booking.

`GET /api/notifications` lists a salon's delivery history (Salon Admin).

**Payments** (`src/payments`): a `PaymentProvider` interface, `MockPaymentProvider`,
and a factory reading `PAYMENT_PROVIDER` (default `mock`; Stripe goes here later,
reading `STRIPE_SECRET_KEY` from env).

| Method & path | Purpose |
| --- | --- |
| `GET /api/payments` | List the salon's payments |
| `POST /api/payments` | Create a payment for a booking (`PAY_ONLINE` / `PAY_LATER`) |
| `POST /api/payments/:id/mark-paid` | Settle a pay-later payment |

`PAY_ONLINE` runs an immediate (mock) charge and is marked `PAID`; `PAY_LATER`
is recorded `PENDING`. In the Salon Admin **Bookings** tab each row has a Payment
column with **Online** / **Later** actions and **Mark paid**.

Tests cover the mock providers, recording, online-vs-later status, and tenant
isolation (a salon cannot pay another salon's booking).

---

## Roadmap (incremental steps)

1. ✅ Project structure + environment config
2. ✅ Multi-tenant database schema / migrations
3. ✅ Authentication + roles + tenant-isolation guards
4. ✅ Super Admin tenant management (API + web portal)
5. ✅ Salon Admin: services & staff (API + web portal)
6. ✅ Booking foundation (anti double-booking, race-condition safe)
7. ✅ Staff assignment accept/reject workflow + rule engine
8. ✅ WordPress plugin connector (API keys + plugin)
9. ✅ Notification / payment adapters (mock providers)
10. ✅ Tests + documentation (67 unit tests; see `docs/ARCHITECTURE.md`)
```
