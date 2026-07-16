import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { UploadsService } from './uploads.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

class UploadDto {
  @IsString() @MaxLength(4_500_000) dataUrl!: string; // compressed image, base64 data URL
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Any salon admin may upload a photo (goes to platform-configured storage). */
  @Roles(UserRole.SALON_ADMIN)
  @Post('service-photo')
  async servicePhoto(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadDto) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    const url = await this.uploads.uploadDataUrl(tenantId, dto.dataUrl);
    return { url };
  }

  /** Frontend asks whether storage exists — if not, it keeps the inline fallback. */
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  @Get('storage/status')
  status() {
    return this.uploads.status();
  }

  /** Super Admin: test the FTP credentials. */
  @Roles(UserRole.SUPER_ADMIN)
  @Post('storage/test')
  test() {
    return this.uploads.test();
  }
}
