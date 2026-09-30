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

  /**
   * How many devices of MINE will ring, and a way to prove it.
   *
   * "Bật thông báo" used to be the end of the story: a person pressed it, the
   * browser said yes, and nothing ever confirmed that a real notification
   * could reach the lock screen. The first customer message at 9pm was the
   * test — and when the phone stayed silent (iPhone still in Safari, Focus
   * mode, a battery saver), nobody could tell which link had failed. A test
   * push while the person is holding the phone answers that in five seconds.
   */
  @Get('mine')
  async mine(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    const devices = tenantId ? await this.push.countForUser(tenantId, user.userId) : { web: 0, native: 0 };
    return { ...devices, enabled: this.push.enabled(), native: this.push.nativeEnabled() };
  }

  @Post('test')
  async test(@CurrentUser() user: AuthenticatedUser, @Body() dto: { vi?: boolean }) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return { sent: 0 };
    const vi = dto?.vi !== false;
    const sent = await this.push.sendToUser(tenantId, user.userId, {
      title: vi ? 'Lumio: thông báo thử 🔔' : 'Lumio: test notification 🔔',
      body: vi ? 'Điện thoại này sẽ báo như vậy mỗi khi khách nhắn tin.' : 'This phone will ring like this whenever a customer writes.',
      url: '/salon/inbox', tag: 'lumio-test',
    });
    return { sent };
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
