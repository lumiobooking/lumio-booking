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
