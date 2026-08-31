import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * The new menu order, as a list.
 *
 * The array IS the order — no per-row position is accepted. A client that
 * computes its own numbers will eventually send two rows the same one, and then
 * the displayed order falls back to the tie-break, which is the bug this whole
 * endpoint exists to fix.
 */
export class ReorderDto {
  @IsArray()
  @ArrayNotEmpty()
  // A salon menu is tens of items. Five hundred is somebody's script, not a
  // person dragging rows, and a transaction that size is worth refusing.
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
