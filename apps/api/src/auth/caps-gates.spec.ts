/**
 * Screens a technician login must not reach: publishing / deleting the
 * salon's social posts, approving ad money, the salon-wide activity feed, and
 * charging a card terminal.
 */
jest.mock('../content/content.service', () => ({ ContentService: class {} }));
jest.mock('../content/content-chat.service', () => ({ ContentChatService: class {} }));
jest.mock('../content/social-publish.service', () => ({ SocialPublishService: class {} }));
jest.mock('../content/content-admin.service', () => ({ ContentAdminService: class {} }));
jest.mock('../content/trends/trend-feed.service', () => ({ TrendFeedService: class {} }));
jest.mock('../content/post-review.service', () => ({ PostReviewService: class {} }));
jest.mock('../content/suggestions.service', () => ({ SuggestionsService: class {} }));
jest.mock('../activity/activity.service', () => ({ ActivityService: class {} }));
jest.mock('../payments-hub/payment-orchestrator.service', () => ({ PaymentOrchestrator: class {} }));
import 'reflect-metadata';
import { CAPS_KEY } from './decorators/caps.decorator';
import { ContentController } from '../content/content.controller';
import { ActivityController } from '../activity/activity.controller';
import { PaymentsHubController } from '../payments-hub/payments-hub.controller';

const capsOf = (target: object) => Reflect.getMetadata(CAPS_KEY, target) as string[] | undefined;

describe('capability gates', () => {
  it('posting, deleting, publishing, ad approval and the review link need the marketing screen', () => {
    const p = ContentController.prototype as unknown as Record<string, object>;
    for (const m of ['publishPost', 'removePost', 'savePost', 'cancelPost', 'approveAds', 'reviewLink', 'revokeReviewLink', 'saveFooter', 'setSeoTier']) {
      expect([m, capsOf(p[m])]).toEqual([m, ['marketing']]);
    }
  });
  it('the salon-wide activity feed needs the bookings screen', () => {
    expect(capsOf(ActivityController)).toEqual(['bookings']);
  });
  it('charging a terminal needs the till', () => {
    const p = PaymentsHubController.prototype as unknown as Record<string, object>;
    expect(capsOf(p.charge)).toEqual(['pos']);
    expect(capsOf(p.connectionToken)).toEqual(['pos']);
  });
});
