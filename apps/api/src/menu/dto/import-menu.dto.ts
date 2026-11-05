import { ArrayMaxSize, IsArray } from 'class-validator';
import { MAX_MENU_IMPORT } from '../menu-import';

/** Rows from the menu sheet; each one is checked and cleaned in menu-import.ts. */
export class ImportMenuDto {
  @IsArray()
  @ArrayMaxSize(MAX_MENU_IMPORT)
  items!: unknown[];
}
