import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Edit an in-flight visit. All three parts are optional and applied together:
 * add services, drop stored line items by position, and nudge the duration.
 */
export class EditLinesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addServiceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  removeIndexes?: number[];

  // Manual minutes on top of the services (negative shortens the visit).
  @IsOptional()
  @IsInt()
  @Min(-600)
  @Max(600)
  extraMinutes?: number;
}
