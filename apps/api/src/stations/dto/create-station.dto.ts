import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStationDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsOptional() @IsString() stationTypeId?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BulkCreateStationDto {
  @IsOptional() @IsString() stationTypeId?: string;
  @IsInt() count!: number;
  @IsOptional() @IsString() @MaxLength(20) prefix?: string;
}

export class CreateStationTypeDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsOptional() @IsString() @MaxLength(300) keywords?: string;
}

export class UpdateStationTypeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsString() @MaxLength(300) keywords?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
