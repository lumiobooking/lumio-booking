import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsIn, IsObject, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { PushService } from './push.service';

class SubscribeDto {
  @IsString() endpoint!: string;
  @IsObject() keys!: { p256dh: string; auth: string };
}

class UnsubscribeDto {
  @IsString() endpoint!: string;
}

class NativeTokenDto {
  @IsString() token!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
}

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The client needs the VAPID public key to subscribe the browser. */
  @Get('public-key')
  key() {
    return { key: this.push.publicKey(), enabled: this.push.enabled(), native: this.push.nativeEnabled() };
  }

  /** The store app's device token (FCM on both platforms). */
  @Post('native')
  async native(@CurrentUser() user: AuthenticatedUser, @Body() dto: NativeTokenDto) {
    const tenantId = resolveTenantScope(user);
    if (tenantId) await this.push.saveNativeToken(tenantId, user.userId, dto.token, dto.platform);
    return { ok: true };
  }

  @Post('native/remove')
  async nativeRemove(@Body() dto: { token: string }) {
    await this.push.removeNativeToken(dto?.token);
    return { ok: true };
  }

  @Post('subscribe')
  async subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    const tenantId = resolveTenantScope(user);
    if (tenantId) {
      await this.push.saveSubscription(tenantId, user.userId, { endpoint: dto.endpoint, keys: dto.keys });
    }
    return { ok: true };
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() dto: UnsubscribeDto) {
    await this.push.removeSubscription(dto.endpoint);
    return { ok: true };
  }
}
