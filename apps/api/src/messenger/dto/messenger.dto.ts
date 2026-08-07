import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, IsIn } from 'class-validator';

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
  // 'booking' (salon appointment bot) or 'sales' (agency sales/CS bot).
  @IsOptional() @IsIn(['booking', 'sales']) botMode?: 'booking' | 'sales';
  @IsOptional() @IsString() @MaxLength(200) leadEmail?: string;
}

export class LeadStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'WON', 'LOST']) status!: 'NEW' | 'CONTACTED' | 'WON' | 'LOST';
}

export class RenameThreadDto {
  @IsString() @MaxLength(80) name!: string;
}

export class SendTestDto {
  @IsOptional() @IsString() @MaxLength(60) threadId?: string;
  @IsString() @MaxLength(1900) text!: string;
}

export class HandoffDto {
  @IsOptional() @IsBoolean() handoff?: boolean;
}
