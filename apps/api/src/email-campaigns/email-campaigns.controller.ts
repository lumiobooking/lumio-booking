import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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
class ImportDto {
  @IsString() @MaxLength(200000) list!: string;
}
class ContactDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsBoolean() replied?: boolean;
}
class AutomationDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(7) @Max(180) everyDays?: number;
  @IsOptional() @IsInt() @Min(10) @Max(500) dailyCap?: number;
  @IsOptional() @IsString() @MaxLength(80) fromName?: string;
  @IsOptional() @IsString() @MaxLength(160) replyTo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) steps?: CampaignDto[];
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

  /** Everyone we have ever emailed, folded down to one row per address. */
  @Get('contacts')
  contacts(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.contacts(this.tid(user));
  }

  // ---- the address book ----------------------------------------------------
  @Post('contacts/import')
  importContacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportDto) {
    return this.svc.importContacts(this.tid(user), dto.list);
  }

  @Patch('contacts/:id')
  updateContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ContactDto) {
    return this.svc.updateContact(this.tid(user), id, dto);
  }

  @Delete('contacts/:id')
  deleteContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.deleteContact(this.tid(user), id);
  }

  // ---- the follow-up -------------------------------------------------------
  @Get('automation')
  getAutomation(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getAutomation(this.tid(user));
  }

  @Post('automation')
  saveAutomation(@CurrentUser() user: AuthenticatedUser, @Body() dto: AutomationDto) {
    return this.svc.saveAutomation(this.tid(user), dto);
  }

  @Post('automation/run')
  runAutomation(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.runAutomation(this.tid(user));
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

  @Get('contacts')
  contacts() {
    return this.svc.contacts(null);
  }

  @Post('contacts/import')
  importContacts(@Body() dto: ImportDto) {
    return this.svc.importContacts(null, dto.list);
  }

  @Patch('contacts/:id')
  updateContact(@Param('id') id: string, @Body() dto: ContactDto) {
    return this.svc.updateContact(null, id, dto);
  }

  @Delete('contacts/:id')
  deleteContact(@Param('id') id: string) {
    return this.svc.deleteContact(null, id);
  }

  @Get('automation')
  getAutomation() {
    return this.svc.getAutomation(null);
  }

  @Post('automation')
  saveAutomation(@Body() dto: AutomationDto) {
    return this.svc.saveAutomation(null, dto);
  }

  @Post('automation/run')
  runAutomation() {
    return this.svc.runAutomation(null);
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
