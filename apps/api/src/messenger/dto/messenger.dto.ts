import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateMessengerDto {
  @IsOptional() @IsString() @MaxLength(60) pageId?: string;
  @IsOptional() @IsString() @MaxLength(60) igId?: string;
  @IsOptional() @IsString() @MaxLength(400) pageToken?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsString() @MaxLength(500) closing?: string;
  @IsOptional() @IsString() @MaxLength(80) agentName?: string;
  @IsOptional() @IsString() @MaxLength(300) bizIntro?: string;
  // Yield tuning: how long a human "owns" the chat, and the grace the bot
  // gives them per new customer message. grace 0 = bot never waits.
  @IsOptional() @IsInt() @Min(1) @Max(720) humanActiveMins?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) graceMins?: number;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;
  // Structured FAQ facts [{ label, value, on }] the salon ticks; loose array
  // validation (nested shape is sanitized in the service).
  @IsOptional() @IsArray() botFacts?: { label: string; value: string; on: boolean }[];
  // 'booking' (salon appointment bot) or 'sales' (agency sales/CS bot).
  @IsOptional() @IsIn(['booking', 'sales']) botMode?: 'booking' | 'sales';
  @IsOptional() @IsString() @MaxLength(200) leadEmail?: string;
  // Sales bot: 'sales' = never states a price (a person quotes), 'facts' = may
  // quote from the facts list. Sent by the Bot page on every save; missing
  // here, every save (the AI on/off switch too) failed with
  // "property quotePolicy should not exist".
  @IsOptional() @IsIn(['sales', 'facts']) quotePolicy?: 'sales' | 'facts';
  // Staff distribution of chats. The screen sends its whole form on every
  // save, and the global pipe forbids any field this class does not name —
  // so when these three landed in the form without landing here, EVERY save
  // on the Bot page (greeting, facts, the on/off switch) answered "property
  // chatAssignMode should not exist". Ranges mirror the service's clamps.
  @IsOptional() @IsIn(['off', 'round-robin']) chatAssignMode?: 'off' | 'round-robin';
  @IsOptional() @IsInt() @Min(0) @Max(50) chatMaxOpenPerAgent?: number;
  @IsOptional() @IsBoolean() chatPreferUsualTech?: boolean;
}

const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUOTED', 'CLOSING', 'WON', 'LOST'] as const;

export class LeadStatusDto {
  @IsIn(LEAD_STAGES) status!: (typeof LEAD_STAGES)[number];
}

/** What the person answering may correct about a lead, from the inbox's customer panel. */
export class ThreadLeadDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) salonName?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(200) interest?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(LEAD_STAGES) status?: (typeof LEAD_STAGES)[number];
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

export class SuggestGreetingDto {
  @IsOptional() @IsString() @MaxLength(500) keywords?: string;
  @IsOptional() @IsIn(['vi', 'en']) lang?: string;
}
