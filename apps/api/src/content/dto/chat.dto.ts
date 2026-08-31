import { IsString, MaxLength, MinLength } from 'class-validator';

/** One message in the team ↔ salon thread. */
export class SendChatDto {
  /** 'general' | 'ads' | 'week:2026-W36' | 'idea:<id>' — validated in the service. */
  @IsString() @MaxLength(80) subject!: string;

  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
