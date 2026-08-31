import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What the Lumio team may change about a week.
 *
 * Deliberately narrow. The team edits the WORDS — the focus line, the jobs, a
 * note to the salon. It does not get to rewrite the figures underneath, because
 * those are measurements: an edited number would look exactly like a measured
 * one and nobody downstream could tell them apart.
 */
export class EditWeekDto {
  /** The one line at the top: what this week is for. */
  @IsOptional() @IsString() @MaxLength(300) focus?: string;

  /** The seven days, as edited. Shape is validated by the screen that sends it. */
  @IsOptional() @IsArray() days?: unknown[];

  /** A note from the team to the salon, shown above the week. */
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
