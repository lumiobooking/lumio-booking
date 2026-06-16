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
import { BookingsModule } from './bookings/bookings.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicModule } from './public/public.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { CustomersModule } from './customers/customers.module';
import { OverviewModule } from './overview/overview.module';
import { SettingsModule } from './settings/settings.module';
import { PosModule } from './pos/pos.module';

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
  ],
})
export class AppModule {}
