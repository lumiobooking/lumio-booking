import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /**
   * The seven days, as edited.
   *
   * Deliberately untyped here: the real check is `sanitizeDays`, which rebuilds
   * these on the skeleton the server sent out. A DTO shape would have said
   * "valid" about a week that names days this salon does not have.
   */
  @IsOptional() @IsArray() days?: unknown[];

  /** Which side of the bilingual text the editor was reading and typing into. */
  @IsOptional() @IsIn(['vi', 'en']) lang?: string;

  /** Throw the edit away and go back to the system's own week. */
  @IsOptional() @IsBoolean() reset?: boolean;

  /** A note from the team to the salon, shown above the week. */
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
