import { IsObject } from 'class-validator';

/** Floor map positions: { [tableId]: { x, y, shape } }. Cleaned server-side (tables/floor.ts). */
export class SaveLayoutDto {
  @IsObject()
  layout!: Record<string, unknown>;
}
