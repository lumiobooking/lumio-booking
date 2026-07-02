// ===========================================================================
// Seed script - baseline platform data for local development.
// Run with: npm run db:seed  (after `npm run db:migrate`)
//
// Creates: 2 plans, 2 demo tenants (to exercise cross-tenant isolation),
// 1 SUPER_ADMIN, and for each tenant a SALON_ADMIN + a STAFF user.
//
// Demo passwords (LOCAL DEV ONLY - change in production):
//   super admin   : superadmin@lumio.test     / Password123!
//   salon A admin : admin@salon-a.test         / Password123!
//   salon A staff : staff@salon-a.test         / Password123!
//   salon B admin : admin@salon-b.test         / Password123!
// ===========================================================================
import { PrismaClient, BillingInterval, UserRole, AppointmentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // --- Subscription plans (platform-level). Flat per-location, unlimited staff. ---
  // (Production sets these via the pricing_plans migration; kept here in sync for
  // fresh/local databases. maxStaff null = unlimited — the key nail-salon selling point.)
  const starter = await prisma.plan.upsert({
    where: { id: 'plan_starter' },
    update: { name: 'Starter', priceMonthlyCents: 4900, priceYearlyCents: 49000, publicVisible: true, sortOrder: 0 },
    create: {
      id: 'plan_starter',
      name: 'Starter',
      description: 'New salon getting started',
      priceCents: 4900,
      priceMonthlyCents: 4900,
      priceYearlyCents: 49000,
      billingInterval: BillingInterval.MONTHLY,
      tagline: 'For a new salon getting started',
      featuresJson: [
        'Unlimited staff — no per-tech fees',
        'Online booking + reminders',
        'Basic POS checkout',
        'Loyalty points + Google review boost',
        'Walk-in list',
        'Keep your own card processor — no % on your sales',
        '1 location',
      ],
      publicVisible: true,
      sortOrder: 0,
      maxStaff: null,
      posEnabled: true,
      onlinePaymentEnabled: true,
    },
  });

  await prisma.plan.upsert({
    where: { id: 'plan_growth' },
    update: { name: 'Growth', priceMonthlyCents: 9900, priceYearlyCents: 99000, publicVisible: true, highlighted: true, sortOrder: 1 },
    create: {
      id: 'plan_growth',
      name: 'Growth',
      description: 'Most popular — the full marketing engine',
      priceCents: 9900,
      priceMonthlyCents: 9900,
      priceYearlyCents: 99000,
      billingInterval: BillingInterval.MONTHLY,
      tagline: 'Most popular — the full marketing engine',
      featuresJson: [
        'Everything in Starter',
        'Full marketing: SMS/email, birthday, referral, weekday deals',
        'Customer display + tipping',
        'Walk-in queue with fair turn rotation',
        'Payroll with tip tracking',
        'Inventory + gift cards',
        'Unlimited staff',
      ],
      publicVisible: true,
      highlighted: true,
      sortOrder: 1,
      maxStaff: null,
      posEnabled: true,
      onlinePaymentEnabled: true,
    },
  });

  await prisma.plan.upsert({
    where: { id: 'plan_pro' },
    update: { name: 'Pro', priceMonthlyCents: 14900, priceYearlyCents: 149000, publicVisible: true, sortOrder: 2, multiLocationEnabled: true, whiteLabelEnabled: true },
    create: {
      id: 'plan_pro',
      name: 'Pro',
      description: 'For chains & advanced',
      priceCents: 14900,
      priceMonthlyCents: 14900,
      priceYearlyCents: 149000,
      billingInterval: BillingInterval.MONTHLY,
      tagline: 'For chains — per location, volume discounts',
      featuresJson: [
        'Everything in Growth',
        'Multiple locations + consolidated reporting',
        'Advanced payroll + tax export',
        'Priority support + white-label',
        '$149 per location · discount at 5+ · 10+ contact us',
      ],
      publicVisible: true,
      sortOrder: 2,
      maxStaff: null,
      posEnabled: true,
      onlinePaymentEnabled: true,
      multiLocationEnabled: true,
      whiteLabelEnabled: true,
    },
  });

  // --- Platform super admin (no tenant) ---
  await prisma.user.upsert({
    where: { email: 'superadmin@lumio.test' },
    update: {},
    create: {
      email: 'superadmin@lumio.test',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      firstName: 'Lumio',
      lastName: 'Admin',
      tenantId: null,
    },
  });

  // --- Tenant A (Demo Nail Salon) ---
  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'salon-a' },
    update: {},
    create: {
      name: 'Salon A - Demo Nails',
      slug: 'salon-a',
      timezone: 'America/New_York',
      contactEmail: 'owner@salon-a.test',
      planId: starter.id,
      subscriptions: { create: { planId: starter.id, status: 'TRIALING' } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@salon-a.test' },
    update: {},
    create: {
      email: 'admin@salon-a.test',
      passwordHash,
      role: UserRole.SALON_ADMIN,
      firstName: 'Anna',
      lastName: 'Owner',
      tenantId: tenantA.id,
    },
  });

  const staffUserA = await prisma.user.upsert({
    where: { email: 'staff@salon-a.test' },
    update: {},
    create: {
      email: 'staff@salon-a.test',
      passwordHash,
      role: UserRole.STAFF,
      firstName: 'Tina',
      lastName: 'Technician',
      tenantId: tenantA.id,
    },
  });

  // --- Tenant B (a second salon, to prove isolation) ---
  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'salon-b' },
    update: {},
    create: {
      name: 'Salon B - Glamour Nails',
      slug: 'salon-b',
      timezone: 'America/Los_Angeles',
      contactEmail: 'owner@salon-b.test',
      planId: starter.id,
      subscriptions: { create: { planId: starter.id, status: 'TRIALING' } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@salon-b.test' },
    update: {},
    create: {
      email: 'admin@salon-b.test',
      passwordHash,
      role: UserRole.SALON_ADMIN,
      firstName: 'Bella',
      lastName: 'Owner',
      tenantId: tenantB.id,
    },
  });

  // =========================================================================
  // Demo data so every fresh setup looks realistic (services, staff with
  // skills, customers, and a few bookings). Idempotent via deterministic ids.
  // =========================================================================
  await seedSalonDemoData(tenantA.id, {
    services: [
      { id: 'svc_a_gel', name: 'Gel Manicure', durationMinutes: 45, priceCents: 3500 },
      { id: 'svc_a_pedi', name: 'Classic Pedicure', durationMinutes: 50, priceCents: 4000 },
      { id: 'svc_a_acrylic', name: 'Acrylic Full Set', durationMinutes: 90, priceCents: 6500 },
      { id: 'svc_a_art', name: 'Nail Art Add-on', durationMinutes: 30, priceCents: 2000 },
    ],
    staff: [
      // Tina is linked to the staff@salon-a.test login so you can test the
      // staff accept/reject portal as her. Avatars use pravatar.cc (demo).
      { id: 'staff_a_tina', firstName: 'Tina', lastName: 'Nguyen', email: 'tina@salon-a.test', phone: '+1-555-0101', skills: ['svc_a_gel', 'svc_a_pedi', 'svc_a_art'], userId: staffUserA.id, avatarUrl: 'https://i.pravatar.cc/150?img=47' },
      { id: 'staff_a_mary', firstName: 'Mary', lastName: 'Tran', email: 'mary@salon-a.test', phone: '+1-555-0102', skills: ['svc_a_acrylic', 'svc_a_gel'], avatarUrl: 'https://i.pravatar.cc/150?img=32' },
      { id: 'staff_a_lucy', firstName: 'Lucy', lastName: 'Pham', email: 'lucy@salon-a.test', phone: '+1-555-0103', skills: ['svc_a_pedi', 'svc_a_art'], avatarUrl: 'https://i.pravatar.cc/150?img=44' },
    ],
    addons: [
      { id: 'addon_a_art', serviceId: 'svc_a_gel', name: 'Nail art (per nail)', durationMinutes: 15, priceCents: 1500 },
      { id: 'addon_a_french', serviceId: 'svc_a_gel', name: 'French tips', durationMinutes: 10, priceCents: 1000 },
      { id: 'addon_a_gelcolor', serviceId: 'svc_a_acrylic', name: 'Gel color upgrade', durationMinutes: 10, priceCents: 1200 },
      { id: 'addon_a_paraffin', serviceId: 'svc_a_pedi', name: 'Paraffin treatment', durationMinutes: 15, priceCents: 1800 },
    ],
    customers: [
      { firstName: 'Emma', lastName: 'Wilson', email: 'emma.wilson@example.com', phone: '+1-555-0201' },
      { firstName: 'Olivia', lastName: 'Brown', email: 'olivia.brown@example.com', phone: '+1-555-0202' },
      { firstName: 'Sophia', lastName: 'Davis', email: 'sophia.davis@example.com', phone: '+1-555-0203' },
      { firstName: 'Ava', lastName: 'Martinez', email: 'ava.martinez@example.com', phone: '+1-555-0204' },
      { firstName: 'Isabella', lastName: 'Garcia', email: 'isabella.garcia@example.com', phone: '+1-555-0205' },
    ],
    bookings: [
      { id: 'appt_a_1', customerEmail: 'emma.wilson@example.com', serviceId: 'svc_a_gel', staffId: 'staff_a_tina', dayOffset: 1, hour: 10, minute: 0, status: AppointmentStatus.ASSIGNED },
      { id: 'appt_a_2', customerEmail: 'olivia.brown@example.com', serviceId: 'svc_a_acrylic', staffId: 'staff_a_mary', dayOffset: 1, hour: 13, minute: 30, status: AppointmentStatus.CONFIRMED },
      { id: 'appt_a_3', customerEmail: 'sophia.davis@example.com', serviceId: 'svc_a_pedi', staffId: null, dayOffset: 2, hour: 11, minute: 0, status: AppointmentStatus.PENDING },
    ],
  });

  // A smaller, clearly different demo set for Salon B (helps see isolation).
  await seedSalonDemoData(tenantB.id, {
    services: [
      { id: 'svc_b_dip', name: 'Dip Powder', durationMinutes: 60, priceCents: 5000 },
      { id: 'svc_b_spa', name: 'Spa Pedicure', durationMinutes: 60, priceCents: 5500 },
    ],
    staff: [
      { id: 'staff_b_kim', firstName: 'Kim', lastName: 'Le', email: 'kim@salon-b.test', phone: '+1-555-0301', skills: ['svc_b_dip', 'svc_b_spa'] },
    ],
    customers: [
      { firstName: 'Mia', lastName: 'Anderson', email: 'mia.anderson@example.com', phone: '+1-555-0401' },
      { firstName: 'Charlotte', lastName: 'Thomas', email: 'charlotte.thomas@example.com', phone: '+1-555-0402' },
    ],
    bookings: [
      { id: 'appt_b_1', customerEmail: 'mia.anderson@example.com', serviceId: 'svc_b_dip', staffId: 'staff_b_kim', dayOffset: 1, hour: 9, minute: 0, status: AppointmentStatus.ASSIGNED },
    ],
  });

  console.log('Seed completed:');
  console.log('  - 2 plans (Basic, Pro)');
  console.log('  - 2 tenants (salon-a, salon-b)');
  console.log('  - 1 SUPER_ADMIN, 2 SALON_ADMIN, 1 STAFF login');
  console.log('  - Salon A: 4 services, 3 staff, 5 customers, 3 bookings');
  console.log('  - Salon B: 2 services, 1 staff, 2 customers, 1 booking');
  console.log(`  - demo password for all users: ${DEMO_PASSWORD}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DemoServiceInput {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
}
interface DemoStaffInput {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  skills: string[];
  userId?: string; // optional linked login account
  avatarUrl?: string;
}

interface DemoAddonInput {
  id: string;
  serviceId: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
}
interface DemoCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}
interface DemoBookingInput {
  id: string;
  customerEmail: string;
  serviceId: string;
  staffId: string | null;
  dayOffset: number; // days from today
  hour: number;
  minute: number;
  status: AppointmentStatus;
}

/** Returns a Date at midnight today + dayOffset days, at hour:minute (local). */
function futureSlot(dayOffset: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function seedSalonDemoData(
  tenantId: string,
  data: {
    services: DemoServiceInput[];
    staff: DemoStaffInput[];
    customers: DemoCustomerInput[];
    bookings: DemoBookingInput[];
    addons?: DemoAddonInput[];
  },
) {
  // Services
  for (const s of data.services) {
    await prisma.service.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        tenantId,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents,
        currency: 'USD',
        isActive: true,
      },
    });
  }

  // Service add-ons (extras)
  for (const a of data.addons ?? []) {
    await prisma.serviceAddon.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        tenantId,
        serviceId: a.serviceId,
        name: a.name,
        durationMinutes: a.durationMinutes,
        priceCents: a.priceCents,
        currency: 'USD',
        isActive: true,
      },
    });
  }

  // Staff + skills + working hours
  for (const st of data.staff) {
    await prisma.staffMember.upsert({
      where: { id: st.id },
      // Keep the login link + avatar in sync on re-seed.
      update: { userId: st.userId ?? undefined, avatarUrl: st.avatarUrl ?? undefined },
      create: {
        id: st.id,
        tenantId,
        userId: st.userId ?? null,
        firstName: st.firstName,
        lastName: st.lastName,
        email: st.email,
        phone: st.phone,
        avatarUrl: st.avatarUrl ?? null,
        isActive: true,
        performanceScore: 100,
      },
    });
    for (const serviceId of st.skills) {
      await prisma.staffService.upsert({
        where: { staffMemberId_serviceId: { staffMemberId: st.id, serviceId } },
        update: {},
        create: { tenantId, staffMemberId: st.id, serviceId },
      });
    }
    // Working hours are REQUIRED by the assignment engine. For the demo we give
    // wide availability (every day) so auto-assign works regardless of the
    // server timezone; a salon can refine these later in the UI.
    const existingHours = await prisma.staffWorkingHour.count({
      where: { staffMemberId: st.id },
    });
    if (existingHours === 0) {
      await prisma.staffWorkingHour.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          tenantId,
          staffMemberId: st.id,
          dayOfWeek,
          startTime: '00:00',
          endTime: '23:59',
          isActive: true,
        })),
      });
    }
  }

  // Customers (unique per tenant by email)
  const customerIdByEmail: Record<string, string> = {};
  for (const c of data.customers) {
    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: c.email } },
      update: {},
      create: {
        tenantId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
      },
    });
    customerIdByEmail[c.email] = customer.id;
  }

  // Bookings
  for (const b of data.bookings) {
    const service = data.services.find((s) => s.id === b.serviceId);
    const customerId = customerIdByEmail[b.customerEmail];
    if (!service || !customerId) continue;
    const start = futureSlot(b.dayOffset, b.hour, b.minute);
    const end = new Date(start.getTime() + service.durationMinutes * 60_000);
    await prisma.appointment.upsert({
      where: { id: b.id },
      update: {},
      create: {
        id: b.id,
        tenantId,
        customerId,
        serviceId: b.serviceId,
        assignedStaffId: b.staffId,
        preferredStaffId: b.staffId,
        status: b.status,
        startTime: start,
        endTime: end,
        priceCents: service.priceCents,
        currency: 'USD',
        assignedAt: b.staffId ? new Date() : null,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
