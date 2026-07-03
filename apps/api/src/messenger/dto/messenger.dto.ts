import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMessengerDto {
  @IsOptional() @IsString() @MaxLength(60) pageId?: string;
  @IsOptional() @IsString() @MaxLength(60) igId?: string;
  @IsOptional() @IsString() @MaxLength(400) pageToken?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;
  // Structured FAQ facts [{ label, value, on }] the salon ticks; loose array
  // validation (nested shape is sanitized in the service).
  @IsOptional() @IsArray() botFacts?: { label: string; value: string; on: boolean }[];
}

export class HandoffDto {
  @IsOptional() @IsBoolean() handoff?: boolean;
}
