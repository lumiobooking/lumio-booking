import { BadRequestException, Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
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

  /**
   * The same file, in pieces — see ./chunk-store for why.
   *
   * `uploadId` is minted by the phone (a UUID) so a resume after the app was
   * closed can name the upload it is continuing. It is scoped under the tenant
   * on disk, so one salon's id can never touch another's pieces.
   */
  @Roles(UserRole.SALON_ADMIN)
  @Post('media/chunk')
  @UseInterceptors(FileInterceptor('chunk', { limits: { fileSize: 9_000_000 } }))
  async mediaChunk(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() chunk: { buffer: Buffer } | undefined,
    @Body() body: { uploadId?: string; index?: string },
  ) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    if (!chunk?.buffer) throw new BadRequestException('Mảnh rỗng.');
    return this.uploads.receiveChunk(tenantId, { uploadId: String(body?.uploadId ?? ''), index: Number(body?.index), buf: chunk.buffer });
  }

  @Roles(UserRole.SALON_ADMIN)
  @Get('media/chunk/:uploadId')
  mediaChunkStatus(@CurrentUser() user: AuthenticatedUser, @Param('uploadId') uploadId: string) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    return this.uploads.chunkStatus(tenantId, uploadId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('media/finish')
  mediaFinish(@CurrentUser() user: AuthenticatedUser, @Body() body: { uploadId?: string; total?: number; mime?: string; name?: string }) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    return this.uploads.finishChunks(tenantId, {
      uploadId: String(body?.uploadId ?? ''), total: Number(body?.total), mime: String(body?.mime ?? ''), name: body?.name,
    });
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
