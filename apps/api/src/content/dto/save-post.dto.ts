import { IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * One queued post, validated at the door.
 *
 * The real content rules — Instagram cannot take a text-only post, a caption
 * has a 2,200-character ceiling — live in social-publish.ts, because they
 * depend on which channels were chosen and on what the tenant has connected.
 * This is only the shape check that stops nonsense reaching that logic.
 */
export class SavePostDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() ideaId?: string | null;

  @IsArray()
  @IsIn(['facebook', 'instagram'], { each: true })
  channels!: ('facebook' | 'instagram')[];

  @IsString() @MaxLength(63206)
  message!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  imageUrl?: string | null;

  @IsISO8601()
  scheduledAt!: string;

  /** 'draft' keeps it out of the sweep; 'scheduled' is validated before saving. */
  @IsOptional() @IsIn(['draft', 'scheduled'])
  status?: 'draft' | 'scheduled';
}
