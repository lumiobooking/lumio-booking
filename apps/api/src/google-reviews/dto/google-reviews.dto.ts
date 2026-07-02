import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateGbrSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(5) autoMinStars?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) alertMaxStars?: number;
  @IsOptional() @IsBoolean() approveFirst?: boolean;
  @IsOptional() @IsString() @MaxLength(200) alertEmail?: string;
  @IsOptional() @IsString() @MaxLength(20) tone?: string;
  @IsOptional() @IsString() @MaxLength(200) accountId?: string;
  @IsOptional() @IsString() @MaxLength(200) locationId?: string;
  @IsOptional() @IsString() @MaxLength(4000) refreshToken?: string;
}

export class SetLocationDto {
  @IsString() @MaxLength(200) accountId!: string;
  @IsString() @MaxLength(200) locationId!: string;
}

export class ApproveReplyDto {
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
}
