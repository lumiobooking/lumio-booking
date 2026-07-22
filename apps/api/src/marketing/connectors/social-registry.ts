import { Injectable, BadRequestException } from '@nestjs/common';
import { SocialConnector, SocialPlatform } from './social-connector.interface';
import { MetaConnector } from './meta.connector';
import { GbpConnector } from './gbp.connector';
import { TikTokConnector, GoogleAdsConnector } from './scaffold.connectors';

@Injectable()
export class SocialRegistry {
  private readonly all: SocialConnector[] = [new MetaConnector(), new GbpConnector(), new TikTokConnector(), new GoogleAdsConnector()];
  private readonly map = new Map<SocialPlatform, SocialConnector>(this.all.map((c) => [c.platform, c]));

  /** Refuses a disabled connector so an unfinished integration is unreachable. */
  get(platform: string): SocialConnector {
    const c = this.map.get(platform as SocialPlatform);
    if (!c) throw new BadRequestException(`Unknown channel: ${platform}`);
    if (!c.enabled) throw new BadRequestException(`Channel not available yet: ${platform}`);
    return c;
  }

  /** All connectors (incl. scaffolds) for the UI to list with their status. */
  list() {
    return this.all.map((c) => ({ platform: c.platform, label: c.label, enabled: c.enabled, hasSpend: c.hasSpend }));
  }
}
