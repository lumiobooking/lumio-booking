import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class OpenShiftDto {
  @IsOptional() @IsInt() @Min(0) openingCents?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ShiftMovementDto {
  @IsIn(['IN', 'OUT']) kind!: 'IN' | 'OUT';
  @IsInt() @Min(1) amountCents!: number;
  @IsString() @MaxLength(200) reason!: string;
}

export class CloseShiftDto {
  @IsInt() @Min(0) countedCents!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
