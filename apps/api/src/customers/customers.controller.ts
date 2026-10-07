import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsISO8601, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CustomersService } from './customers.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

class UpdateCustomerDto {
  // birthDate accepts an ISO date string or null to clear it.
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() birthDate?: string | null;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(80) lastName?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsEmail() email?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(2000) notes?: string | null;
  // The line-of-business record; keys and values are checked against the
  // salon's industry in the service (common/industry-fields).
  @IsOptional() @IsObject() industryFields?: Record<string, unknown>;
  // History from the salon's previous system, entered by hand.
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) pastSpentCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) pastVisits?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() lastVisitAt?: string | null;
}

class ImportCustomersDto {
  // Rows keyed by the canonical names (customers/import-rows.ts); the server reads each value.
  @IsArray() @ArrayMaxSize(1000) rows!: Record<string, unknown>[];
  @IsOptional() @IsString() @MaxLength(40) source?: string;
  // The owner confirms the clients marked "yes" agreed to marketing texts from this salon.
  @IsOptional() @IsBoolean() consentAttested?: boolean;
}

class AdjustPointsDto {
  @IsInt() @Min(-1_000_000) @Max(1_000_000) points!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class CreateCustomerDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  // Optional birthday (YYYY-MM-DD) for remarketing. Never required.
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsISO8601() birthDate?: string;
}

@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.list(user);
  }

  // NOTE: declared before ':id' so "/customers/search" isn't captured as an id.
  // Which record fields this salon's line of business keeps (dental history,
  // a lead's stage…). Declared before ':id' so it is not read as an id.
  @Get('industry-fields')
  industryFields(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.industryFieldDefs(user);
  }

  // A real-estate office's call-backs that are due (today or overdue).
  @Get('follow-ups')
  followUps(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.followUps(user);
  }

  // A dental clinic's recall list ("Đến hạn tái khám").
  @Get('recalls')
  recalls(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.recalls(user);
  }

  @Post('recalls/:id/contacted')
  recallContacted(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.markRecallContacted(user, id);
  }

  // The desk (bookings capability) sees ⚠ allergies / dietary needs while booking and on arrivals.
  @Caps('bookings')
  @Get('record-alerts')
  recordAlerts(@CurrentUser() user: AuthenticatedUser, @Query('phone') phone?: string, @Query('ids') ids?: string) {
    return this.customers.recordAlerts(user, { phone, ids });
  }

  // Bring the client list over from the old system (CSV mapped on the page). Owner only.
  @Roles(UserRole.SALON_ADMIN)
  @Post('import')
  importCustomers(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportCustomersDto) {
    return this.customers.importCustomers(user, dto);
  }

  @Get('search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') q: string) {
    return this.customers.search(user, q ?? '');
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customers.quickCreate(user, dto);
  }

  // Add or remove loyalty points by hand, with a reason. Owner only.
  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/points')
  adjustPoints(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AdjustPointsDto) {
    return this.customers.adjustPoints(user, id, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.getById(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user, id, dto);
  }

  // Deleting a client erases their history; the owner decides who may.
  @Caps('customers.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.remove(user, id);
  }
}
