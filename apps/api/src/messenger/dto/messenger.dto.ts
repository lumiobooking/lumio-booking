import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMessengerDto {
  @IsOptional() @IsString() @MaxLength(60) pageId?: string;
  @IsOptional() @IsString() @MaxLength(60) igId?: string;
  @IsOptional() @IsString() @MaxLength(400) pageToken?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;
}

export class HandoffDto {
  @IsOptional() @IsBoolean() handoff?: boolean;
}
