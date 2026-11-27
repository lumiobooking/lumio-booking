import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateGbrSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(5) autoMinStars?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) alertMaxStars?: number;
  @IsOptional() @IsBoolean() approveFirst?: boolean;
  @IsOptional() @IsString() @MaxLength(200) alertEmail?: string;
  @IsOptional() @IsString() @MaxLength(20) tone?: string;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;
  @IsOptional() @IsString() @MaxLength(200) accountId?: string;
  @IsOptional() @IsString() @MaxLength(200) locationId?: string;
  @IsOptional() @IsString() @MaxLength(4000) refreshToken?: string;
  /** rt246: forget one of the owner's saved rewrites (index in replyExamples), or -1 for all. */
  @IsOptional() @IsInt() @Min(-1) @Max(20) forgetExample?: number;
}

export class RegenerateReplyDto {
  /** rt246: a one-off wish for this reply ("ngắn hơn", "nói sẽ chuyển lời tới team"…). */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class SetLocationDto {
  @IsString() @MaxLength(200) accountId!: string;
  @IsString() @MaxLength(200) locationId!: string;
  @IsOptional() @IsString() @MaxLength(300) locationTitle?: string;
}

export class ApproveReplyDto {
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
}
