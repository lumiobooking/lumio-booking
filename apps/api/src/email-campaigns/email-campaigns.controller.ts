import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { EmailCampaignsService, CampaignInput } from './email-campaigns.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

class CampaignDto implements CampaignInput {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsString() @MaxLength(200) subject!: string;
  @IsString() @MaxLength(80) fromName!: string;
  @IsOptional() @IsString() @MaxLength(160) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(200) preheader?: string;
  @IsOptional() @IsString() @MaxLength(200) heading?: string;
  @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MaxLength(500) ctaUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) footerNote?: string;
  @IsOptional() @IsString() @MaxLength(120000) recipients?: string;
}
class TestDto extends CampaignDto {
  @IsEmail() to!: string;
}
class PreviewDto {
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) preheader?: string;
  @IsOptional() @IsString() @MaxLength(200) heading?: string;
  @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MaxLength(500) ctaUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) footerNote?: string;
}

/**
 * Salon-side email marketing. Off by default: the `emailMarketing` feature is
 * 'platform' unless Super Admin switches it to 'salon' for that tenant.
 */
@Roles(UserRole.SALON_ADMIN)
@Caps('marketing')
@UseGuards(FeaturePolicyGuard)
@RequiresFeature('emailMarketing')
@Controller('email-campaigns')
export class EmailCampaignsController {
  constructor(private readonly svc: EmailCampaignsService) {}

  private tid(user: AuthenticatedUser): string {
    return resolveTenantScope(user) as string;
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(this.tid(user));
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getOne(this.tid(user), id);
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewDto) {
    return this.svc.preview(this.tid(user), dto);
  }

  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestDto) {
    return this.svc.sendTest(this.tid(user), user.userId, dto);
  }

  @Post('send')
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CampaignDto) {
    return this.svc.send(this.tid(user), user.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.remove(this.tid(user), id);
  }
}

/** Platform campaigns — Lumio emailing salons. tenantId is null for all of these. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/email-campaigns')
export class AdminEmailCampaignsController {
  constructor(private readonly svc: EmailCampaignsService) {}

  @Get()
  list() {
    return this.svc.list(null);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.svc.getOne(null, id);
  }

  @Post('preview')
  preview(@Body() dto: PreviewDto) {
    return this.svc.preview(null, dto);
  }

  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestDto) {
    return this.svc.sendTest(null, user.userId, dto);
  }

  @Post('send')
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CampaignDto) {
    return this.svc.send(null, user.userId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(null, id);
  }
}

/** One-click unsubscribe. No login — that's the whole point. */
@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly svc: EmailCampaignsService) {}

  @Public()
  @Post(':id')
  unsubscribe(@Param('id') id: string) {
    return this.svc.unsubscribe(id);
  }
}
