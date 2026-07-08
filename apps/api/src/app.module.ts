import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { TenantsModule } from './tenants/tenants.module';
import { ServicesModule } from './services/services.module';
import { StaffModule } from './staff/staff.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';
import { BookingsModule } from './bookings/bookings.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicModule } from './public/public.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { CustomersModule } from './customers/customers.module';
import { OverviewModule } from './overview/overview.module';
import { SettingsModule } from './settings/settings.module';
import { PosModule } from './pos/pos.module';
import { BillingModule } from './billing/billing.module';
import { ReviewsModule } from './reviews/reviews.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { WalkinsModule } from './walkins/walkins.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ReferralModule } from './referral/referral.module';
import { SuppliesModule } from './supplies/supplies.module';
import { BranchesModule } from './branches/branches.module';
import { PrintModule } from './print/print.module';
import { GiftCardsModule } from './gift-cards/gift-cards.module';
import { DisplayModule } from './display/display.module';
import { GoogleReviewsModule } from './google-reviews/google-reviews.module';
import { MessengerModule } from './messenger/messenger.module';
import { VoiceModule } from './voice/voice.module';
import { InvoicesModule } from './invoices/invoices.module';
import { FeaturePolicyModule } from './feature-policy/feature-policy.module';

@Module({
  imports: [
    // Loads .env and makes ConfigService available app-wide.
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuditModule,
    HealthModule,
    // AuthModule registers global JWT + Roles guards, so every route is
    // authenticated by default unless marked @Public().
    AuthModule,
    MeModule,
    // Super Admin tenant management.
    TenantsModule,
    // Salon Admin: services & staff (tenant-scoped).
    ServicesModule,
    StaffModule,
    TablesModule,
    MenuModule,
    // Booking foundation (anti double-booking, race-condition safe).
    BookingsModule,
    // WordPress plugin connector: API keys + public (API-key-authenticated)
    // endpoints the plugin calls.
    ApiKeysModule,
    PublicModule,
    // Notification + payment adapters (mock providers; real ones plug in via
    // env without business-logic changes).
    NotificationsModule,
    PaymentsModule,
    // Salon Admin dashboard: customers list + overview stats + settings.
    CustomersModule,
    OverviewModule,
    SettingsModule,
    // Point of sale: counter checkout (tickets, products, tips, receipts).
    PosModule,
    GiftCardsModule,
    // Self-serve SaaS billing: public signup, Stripe/PayPal checkout + webhooks.
    BillingModule,
    // Review-reward program: customer feedback → staff & customer points.
    ReviewsModule,
    // Waitlist: fill slots freed by cancellations.
    WaitlistModule,
    // Walk-in queue + fair turn rotation ("lượt").
    WalkinsModule,
    // Automated marketing campaigns: win-back, reactivation, birthday SMS/email.
    CampaignsModule,
    // Customer referral program (refer-a-friend → both rewarded).
    ReferralModule,
    // Back-of-house supplies inventory (polish, tips, powder…).
    SuppliesModule,
    // Multi-branch (chain) accounts: branch switcher + consolidated report +
    // global active-branch interceptor.
    BranchesModule,
    // Receipt print queue + reception-desk print agent.
    PrintModule,
    // Customer-facing display relay: pair a wireless iPad to mirror the register
    // and take after-payment QR tips over the network (tenant-scoped).
    DisplayModule,
    // Google review auto-reply: draft replies to positive reviews for one-tap
    // approval; hold negative/neutral ones and email the manager (tenant-scoped).
    GoogleReviewsModule,
    // Messenger booking bot: AI receptionist on the salon's Facebook Page that
    // chats with customers and books appointments (tenant-scoped).
    MessengerModule,
    // AI voice hotline: the salon forwards its own number (on no-answer) to a
    // Lumio number; Twilio speech + the booking agent answer and book by phone.
    VoiceModule,
    // Automatic invoices: month-end usage overage + plan renewal, emailed with a
    // hosted pay page. Idempotent daily sweep (INVOICES_ENABLED).
    InvoicesModule,
    // Feature access policy: Super Admin decides per salon which features are
    // salon-managed vs platform-managed (hidden + write-blocked). Global.
    FeaturePolicyModule,
  ],
})
export class AppModule {}
