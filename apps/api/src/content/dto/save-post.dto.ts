import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** One photo or video in the post, in display order. */
export class PostMediaDto {
  @IsString() @MaxLength(2000)
  url!: string;

  @IsIn(['image', 'video'])
  kind!: 'image' | 'video';

  /** The archive copy on Drive, sent back as received; the server keeps it either way. */
  @IsOptional() @IsString() @MaxLength(400)
  driveUrl?: string;
}

/**
 * What a person decided for the TikTok copy of a post. Privacy is required
 * by TikTok's guidelines to be chosen, never defaulted — so it is optional
 * HERE (a draft may not have it yet) and the planner refuses to lock a post
 * without it.
 */
export class TikTokOptionsDto {
  @IsOptional() @IsIn(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'])
  privacy?: string;
  @IsOptional() @IsBoolean() allowComment?: boolean;
  @IsOptional() @IsBoolean() allowDuet?: boolean;
  @IsOptional() @IsBoolean() allowStitch?: boolean;
  @IsOptional() @IsBoolean() disclose?: boolean;
  @IsOptional() @IsBoolean() yourBrand?: boolean;
  @IsOptional() @IsBoolean() brandedContent?: boolean;
  @IsOptional() @IsBoolean() aigc?: boolean;
}

/**
 * What a person decided for the GOOGLE BUSINESS copy of a post: which button
 * Google shows under it, where that button goes, and which policy risks the
 * team has read and accepted.
 *
 * THE BUG THIS CLASS FIXES
 *
 * It did not exist. The composer has sent `google: { button, url }` since the
 * button picker was added, and this DTO never declared the field — so the
 * validator, which runs with `forbidNonWhitelisted`, rejected the WHOLE
 * request with "property google should not exist". Choosing Google Business on
 * a post made that post unsaveable: not a Google error, not a permissions
 * error, a shape check on our own door. The screen showed a red line in
 * English that meant nothing to the person reading it.
 *
 * Every field the service reads must be declared here, or the request never
 * reaches the service at all. See content/gbp-cta.ts for what each one means.
 */
export class GoogleOptionsDto {
  /** book | call | learn | none — the button under the post on Maps. */
  @IsOptional() @IsIn(['book', 'call', 'learn', 'none'])
  button?: 'book' | 'call' | 'learn' | 'none';

  /**
   * The writer's own link for that button. Null is a real value meaning "use
   * the salon's default"; @IsOptional() passes both null and undefined.
   */
  @IsOptional() @IsString() @MaxLength(2048)
  url?: string | null;

  /**
   * Policy risks the team accepted for this post, by code (see gbp-policy.ts).
   * Capped hard: this is a list of short slugs, and anything longer is a bug
   * or an attempt, never a person.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(12)
  @IsString({ each: true }) @MaxLength(40, { each: true })
  ack?: string[];
}

/**
 * One queued post, validated at the door.
 *
 * The real content rules — Instagram cannot take a text-only post, a caption
 * has a 2,200-character ceiling, a carousel holds two to ten — live in
 * social-publish.ts, because they depend on which channels were chosen and on
 * what the tenant has connected. This is only the shape check that stops
 * nonsense reaching that logic.
 */
export class SavePostDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() ideaId?: string | null;

  /** 'google' = the shop's Google Business Profile; 'tiktok' = the shop's TikTok account (tiktok module). */
  @IsArray()
  @IsIn(['facebook', 'instagram', 'google', 'tiktok'], { each: true })
  channels!: ('facebook' | 'instagram' | 'google' | 'tiktok')[];

  /** TikTok's per-post decisions; only read when 'tiktok' is among the channels. */
  @IsOptional() @ValidateNested() @Type(() => TikTokOptionsDto)
  tiktok?: TikTokOptionsDto;

  /** Google Business's per-post decisions; only read when 'google' is among the channels. */
  @IsOptional() @ValidateNested() @Type(() => GoogleOptionsDto)
  google?: GoogleOptionsDto;

  @IsString() @MaxLength(63206)
  message!: string;

  /**
   * Capped at 10 here because that is Instagram's carousel ceiling and there is
   * no post shape above it — a request carrying fifty items is a bug or an
   * attack, and either way it should not reach the database.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => PostMediaDto)
  media?: PostMediaDto[];

  @IsISO8601()
  scheduledAt!: string;

  /** 'draft' keeps it out of the sweep; 'scheduled' is validated before saving. */
  @IsOptional() @IsIn(['draft', 'scheduled'])
  status?: 'draft' | 'scheduled';

  // ---- the team's workflow (see post-workflow.ts) ----
  /** writing | design | ready. Anything but ready forces status to draft. */
  @IsOptional() @IsIn(['writing', 'design', 'ready'])
  stage?: 'writing' | 'design' | 'ready';
  @IsOptional() @IsString() @MaxLength(80)
  writerName?: string;
  @IsOptional() @IsString() @MaxLength(80)
  designerName?: string;
  /** Team-only note. Never shown to the client. */
  @IsOptional() @IsString() @MaxLength(2000)
  teamNote?: string;
}

/** Move a post between stages from the calendar, without re-sending the body. */
export class SetStageDto {
  @IsIn(['writing', 'design', 'ready'])
  stage!: 'writing' | 'design' | 'ready';
  @IsOptional() @IsString() @MaxLength(80)
  writerName?: string;
  @IsOptional() @IsString() @MaxLength(80)
  designerName?: string;
  @IsOptional() @IsString() @MaxLength(2000)
  teamNote?: string;
}
