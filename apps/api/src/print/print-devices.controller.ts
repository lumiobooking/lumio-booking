import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/security/rate-limit.guard';
import { PrintDevicesService } from './print-devices.service';

export class UpdatePrintDeviceDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsObject() routes?: Record<string, unknown>;
}
export class TestPrintDto {
  @IsOptional() @IsString() @MaxLength(20) route?: string;
  @IsOptional() @IsBoolean() drawer?: boolean;
}
export class PairDto {
  @IsString() @MaxLength(20) code!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsArray() printers?: unknown[];
  @IsOptional() @IsString() @MaxLength(200) defaultPrinter?: string;
}
export class HelloDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsArray() printers?: unknown[];
  @IsOptional() @IsString() @MaxLength(200) defaultPrinter?: string;
  @IsOptional() @IsString() @MaxLength(40) version?: string;
}
export class JobResultDto {
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) error?: string;
}

/** The owner's printers screen (Settings › Printed receipt › Printers). Owner only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('print-devices')
export class PrintDevicesController {
  constructor(private readonly svc: PrintDevicesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.svc.list(user); }

  @Post('installer')
  installer(@CurrentUser() user: AuthenticatedUser, @Headers() headers: Record<string, unknown>) { return this.svc.installer(user, headers); }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePrintDeviceDto) { return this.svc.update(user, id, dto); }

  @Post(':id/test')
  test(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: TestPrintDto) { return this.svc.test(user, id, dto?.route, dto?.drawer === true); }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.revoke(user, id); }
}

/**
 * The shop's printing computer. No login: setup trades a one-time code for the
 * computer's own token (header X-Lumio-Device), which names one business.
 */
@Public()
@Controller('print-agent')
export class PrintAgentController {
  constructor(private readonly svc: PrintDevicesService) {}

  @RateLimit(20, 60_000)
  @Get('i/:code')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  install(@Param('code') code: string, @Headers() headers: Record<string, unknown>) { return this.svc.install(code, headers); }

  @RateLimit(30, 60_000)
  @Get('agent.ps1')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  agent() { return this.svc.agent(); }

  @RateLimit(10, 60_000)
  @Post('pair')
  @HttpCode(200)
  pair(@Body() dto: PairDto) { return this.svc.pair(dto); }

  @RateLimit(30, 60_000)
  @Post('hello')
  @HttpCode(200)
  hello(@Headers() headers: Record<string, unknown>, @Body() dto: HelloDto) { return this.svc.hello(headers, dto); }

  @RateLimit(120, 60_000)
  @Get('jobs')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  jobs(@Headers() headers: Record<string, unknown>) { return this.svc.jobs(headers); }

  @RateLimit(240, 60_000)
  @Post('jobs/:id/result')
  @HttpCode(200)
  result(@Headers() headers: Record<string, unknown>, @Param('id') id: string, @Body() dto: JobResultDto) { return this.svc.result(headers, id, dto.ok, dto.error); }
}
