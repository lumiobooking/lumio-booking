import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/security/rate-limit.guard';
import { ClientFormsService } from './client-forms.service';

export class SignDto {
  @IsIn(['intake', 'cupping', 'hot_stone']) kind!: string;
  @IsObject() answers!: Record<string, unknown>;
  @IsString() @MaxLength(400_000) signatureData!: string;
  @IsOptional() @IsString() @MaxLength(120) signedName?: string;
  @IsOptional() @IsIn(['vi', 'en']) lang?: string;
}

export class SoapDto {
  @IsOptional() @IsString() @MaxLength(64) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) walkInId?: string;
  @IsObject() answers!: Record<string, unknown>;
  @IsString() @MaxLength(400_000) signatureData!: string;
  @IsOptional() @IsString() @MaxLength(120) signedName?: string;
  @IsOptional() @IsIn(['vi', 'en']) lang?: string;
}

export class LinkDto {
  @IsOptional() @IsString() @MaxLength(64) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) walkInId?: string;
  @IsOptional() @IsString() @MaxLength(64) customerId?: string;
  @IsOptional() @IsArray() @IsIn(['intake', 'cupping', 'hot_stone'], { each: true }) kinds?: string[];
  @IsOptional() @IsBoolean() send?: boolean;
  @IsOptional() @IsIn(['vi', 'en']) lang?: string;
}

export class AddendumDto {
  @IsString() @MaxLength(1000) text!: string;
}

class ConsentRuleDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) serviceIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) categoryIds?: string[];
}
class ConsentsDto {
  @IsOptional() @ValidateNested() @Type(() => ConsentRuleDto) cupping?: ConsentRuleDto;
  @IsOptional() @ValidateNested() @Type(() => ConsentRuleDto) hot_stone?: ConsentRuleDto;
}
class AutoSendDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(72) hoursBefore?: number;
}
class ExtraQuestionDto {
  @IsOptional() @IsString() @MaxLength(24) id?: string;
  @IsOptional() @IsString() @MaxLength(160) vi?: string;
  @IsOptional() @IsString() @MaxLength(160) en?: string;
  @IsOptional() @IsBoolean() flag?: boolean;
}
export class FormSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() intakeRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(60) intakeValidMonths?: number;
  @IsOptional() @ValidateNested() @Type(() => ConsentsDto) consents?: ConsentsDto;
  @IsOptional() @IsInt() @Min(0) @Max(60) consentValidMonths?: number;
  @IsOptional() @IsBoolean() soapRequired?: boolean;
  @IsOptional() @ValidateNested() @Type(() => AutoSendDto) autoSend?: AutoSendDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExtraQuestionDto) extraQuestions?: ExtraQuestionDto[];
}

/**
 * The client's side. No login: the per-link token IS the credential and the
 * salon is resolved from it, never from the request.
 */
@Public()
@Controller('public/client-forms')
export class PublicClientFormsController {
  constructor(private readonly forms: ClientFormsService) {}

  @RateLimit(60, 60_000)
  @Get(':token')
  context(@Param('token') token: string) {
    return this.forms.publicContext(token);
  }

  @RateLimit(12, 60_000)
  @Post(':token')
  sign(@Param('token') token: string, @Body() dto: SignDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.forms.publicSubmit(token, dto, { ip, userAgent: ua ?? null });
  }
}

/**
 * The salon's side. Who may read what is decided in the service
 * (accessOf): owner and managers everything, a technician their own clients,
 * the front desk only signed / missing.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('client-forms')
export class ClientFormsController {
  constructor(private readonly forms: ClientFormsService) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.forms.settingsView(user);
  }

  @Patch('settings')
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: FormSettingsDto) {
    return this.forms.updateSettings(user, dto);
  }

  @Get('templates')
  templates(@CurrentUser() user: AuthenticatedUser) {
    return this.forms.templates(user);
  }

  @Get('visit')
  visit(@CurrentUser() user: AuthenticatedUser, @Query('appointmentId') appointmentId?: string, @Query('walkInId') walkInId?: string, @Query('lang') lang?: string) {
    return this.forms.visitStatus(user, { appointmentId: appointmentId || undefined, walkInId: walkInId || undefined, lang });
  }

  @Get('recent')
  recent(@CurrentUser() user: AuthenticatedUser, @Query('kind') kind?: string) {
    return this.forms.recent(user, { kind });
  }

  @Get('customers/:id')
  customer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.forms.customerForms(user, id, lang);
  }

  @Get('customers/:id/last-soap')
  lastSoap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forms.lastSoap(user, id);
  }

  @Get('entries/:id')
  entry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forms.entry(user, id);
  }

  @Post('entries/:id/addendum')
  addendum(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddendumDto) {
    return this.forms.addendum(user, id, dto.text);
  }

  @RateLimit(20, 60_000)
  @Post('links')
  link(@CurrentUser() user: AuthenticatedUser, @Body() dto: LinkDto) {
    return this.forms.createLink(user, dto);
  }

  @Post('soap')
  soap(@CurrentUser() user: AuthenticatedUser, @Body() dto: SoapDto) {
    return this.forms.createSoap(user, dto);
  }
}
