import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/security/rate-limit.guard';
import { ClientFormsService } from './client-forms.service';

/** A built-in client form, or one of the salon's own ("c_…"). */
const CLIENT_KIND_RE = /^(intake|cupping|hot_stone|c_[a-z0-9]{6,16})$/;

export class SignDto {
  @Matches(CLIENT_KIND_RE) kind!: string;
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

export class StaffNoteDto extends SoapDto {
  @Matches(/^(soap|c_[a-z0-9]{6,16})$/) kind!: string;
}

export class LinkDto {
  @IsOptional() @IsString() @MaxLength(64) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) walkInId?: string;
  @IsOptional() @IsString() @MaxLength(64) customerId?: string;
  @IsOptional() @IsArray() @Matches(CLIENT_KIND_RE, { each: true }) kinds?: string[];
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
  /** Sent back by the screen with the rest; ignored — the salon's own forms have their own endpoints. */
  @IsOptional() @IsArray() customForms?: unknown[];
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
  lastSoap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('kind') kind?: string) {
    return this.forms.lastSoap(user, id, kind);
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

  /** A technician's record after the visit: the SOAP note or one of the salon's own staff forms. */
  @Post('staff-notes')
  staffNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: StaffNoteDto) {
    const { kind, ...rest } = dto;
    return this.forms.createStaffNote(user, kind, rest);
  }

  // ---- the salon's own forms (owner / manager edit; the service checks) ----

  @Get('custom')
  customForms(@CurrentUser() user: AuthenticatedUser) {
    return this.forms.customFormsView(user);
  }

  @Post('custom')
  createCustom(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) {
    return this.forms.createCustomForm(user, { starter: dto?.starter });
  }

  @Patch('custom/:kind')
  updateCustom(@CurrentUser() user: AuthenticatedUser, @Param('kind') kind: string, @Body() dto: Record<string, unknown>) {
    return this.forms.updateCustomForm(user, kind, dto);
  }

  @Delete('custom/:kind')
  deleteCustom(@CurrentUser() user: AuthenticatedUser, @Param('kind') kind: string) {
    return this.forms.deleteCustomForm(user, kind);
  }
}
