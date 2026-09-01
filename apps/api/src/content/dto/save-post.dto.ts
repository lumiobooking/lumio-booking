import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** One photo or video in the post, in display order. */
export class PostMediaDto {
  @IsString() @MaxLength(2000)
  url!: string;

  @IsIn(['image', 'video'])
  kind!: 'image' | 'video';
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

  @IsArray()
  @IsIn(['facebook', 'instagram'], { each: true })
  channels!: ('facebook' | 'instagram')[];

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
}
