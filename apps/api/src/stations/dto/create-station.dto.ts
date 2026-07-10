import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export type StationKindDto = 'PEDI' | 'MANI' | 'NAIL' | 'OTHER';
export const STATION_KINDS: StationKindDto[] = ['PEDI', 'MANI', 'NAIL', 'OTHER'];

export class CreateStationDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsOptional() @IsIn(STATION_KINDS) kind?: StationKindDto;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BulkCreateStationDto {
  @IsOptional() @IsIn(STATION_KINDS) kind?: StationKindDto;
  @IsInt() count!: number;
  @IsOptional() @IsString() @MaxLength(20) prefix?: string;
}
