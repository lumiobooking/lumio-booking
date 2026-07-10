import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { StationKindDto, STATION_KINDS } from './create-station.dto';

export class UpdateStationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsIn(STATION_KINDS) kind?: StationKindDto;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
