import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { PrintService } from './print.service';

interface ApiKeyRequest { apiTenantId: string }

/**
 * Receipt printing queue. Salon staff (JWT) enqueue receipts; the reception-desk
 * print agent (API key) polls + reports results. Both are tenant-scoped.
 */
@Controller('print-jobs')
export class PrintController {
  constructor(private readonly print: PrintService) {}

  // ---- Salon side (JWT) ----
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos')
  @Post()
  enqueue(@CurrentUser() user: AuthenticatedUser, @Body() dto: { title?: string; text: string; copies?: number }) {
    return this.print.enqueue(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos')
  @Get('recent')
  recent(@CurrentUser() user: AuthenticatedUser) {
    return this.print.recent(user);
  }

  // ---- Reception agent (API-key authenticated) ----
  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('agent/pending')
  pending(@Req() req: ApiKeyRequest) {
    return this.print.pending(req.apiTenantId);
  }

  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('agent/:id/result')
  result(@Req() req: ApiKeyRequest, @Param('id') id: string, @Body() dto: { ok?: boolean; error?: string }) {
    return this.print.result(req.apiTenantId, id, !!dto.ok, dto.error);
  }
}
