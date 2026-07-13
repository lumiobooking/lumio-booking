import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { InvoicesScheduler } from './invoices.scheduler';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/** Public hosted-invoice page: view details, start payment, confirm on return. */
@Public()
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.svc.getPublic(token);
  }

  @Post(':token/checkout')
  checkout(@Param('token') token: string) {
    return this.svc.startCheckout(token);
  }

  @Post(':token/confirm')
  confirm(@Param('token') token: string, @Body() body: { sessionId?: string }) {
    return this.svc.confirm(token, body?.sessionId ?? '');
  }
}

/** Salon owner: their own invoices (shown in the Billing → Invoices tab). */
@Roles(UserRole.SALON_ADMIN)
@Controller('billing')
export class SalonInvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get('invoices')
  mine(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    return tenantId ? this.svc.listForTenant(tenantId) : [];
  }
}

/** Super Admin: platform-wide invoice management. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private readonly svc: InvoicesService, private readonly scheduler: InvoicesScheduler) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Post(':id/resend')
  resend(@Param('id') id: string) {
    return this.svc.sendInvoiceEmail(id, true).then((sent) => ({ sent }));
  }

  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.svc.voidInvoice(id);
  }

  /** Run the month-end + renewal sweep immediately (idempotent). For testing/support. */
  @Post('run-now')
  runNow() {
    return this.scheduler.runOnce();
  }

  /** Send a sample invoice email to confirm the platform email is configured. */
  @Post('test-email')
  testEmail(@Body() body: { email?: string }) {
    return this.svc.sendTestEmail(body?.email || '');
  }

  /** Ask Brevo what is actually wrong when a test doesn't arrive. */
  @Post('email-diagnose')
  diagnose() {
    return this.svc.diagnoseEmail();
  }
}
