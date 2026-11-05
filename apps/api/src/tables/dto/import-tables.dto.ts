import { ArrayMaxSize, IsArray } from 'class-validator';
import { MAX_TABLE_IMPORT } from '../table-import';

/** Rows from the floor-plan sheet; each one is checked and cleaned in table-import.ts. */
export class ImportTablesDto {
  @IsArray()
  @ArrayMaxSize(MAX_TABLE_IMPORT)
  tables!: unknown[];
}
