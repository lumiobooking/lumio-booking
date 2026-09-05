import { BadRequestException, Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  /**
   * A photo or a clip straight off a phone.
   *
   * SALON_ADMIN, deliberately: the shop that just filmed the thing the team
   * asked for is the one uploading it, and the alternative is a file in a group
   * chat at eleven at night with nothing saying which suggestion it answers.
   * Multipart rather than a data URL because a thirty-second clip is thirty to
   * eighty megabytes and base64 makes it a third bigger again.
   */
  @Roles(UserRole.SALON_ADMIN)
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 130_000_000 } }))
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; originalname?: string } | undefined,
  ) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    if (!file) throw new BadRequestException('Chưa chọn được file.');
    return this.uploads.uploadFile(tenantId, file);
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
