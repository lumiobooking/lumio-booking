import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX = 10_000_000_000;

export class EntryDto {
  @IsOptional() @IsIn(['IN', 'OUT']) direction?: 'IN' | 'OUT';
  @IsOptional() @IsInt() @Min(1) @Max(MAX) amountCents?: number;
  @IsOptional() @IsString() @MaxLength(64) fundId?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(64) categoryId?: string | null;
  @IsOptional() @Matches(DAY) day?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120) payee?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(300) note?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) receiptUrl?: string | null;
  @IsOptional() @IsBoolean() countsInPl?: boolean;
  @IsOptional() @IsString() @MaxLength(12) approvalPin?: string;
}

export class VoidDto {
  @IsString() @MaxLength(300) reason!: string;
}

export class TransferDto {
  @IsString() @MaxLength(64) fromFundId!: string;
  @IsString() @MaxLength(64) toFundId!: string;
  @IsInt() @Min(1) @Max(MAX) amountCents!: number;
  @IsOptional() @Matches(DAY) day?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PayPayrollDto {
  @IsOptional() @Matches(DAY) day?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX) cashCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX) bankCents?: number;
  @IsOptional() @IsString() @MaxLength(64) bankFundId?: string;
}

export class PayStockDto {
  @IsString() @MaxLength(64) fundId!: string;
  @IsOptional() @Matches(DAY) day?: string;
}

export class DrawerCategoryDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(64) categoryId?: string | null;
}

export class FundDto {
  @IsOptional() @IsIn(['BANK', 'OTHER']) kind?: 'BANK' | 'OTHER';
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(4) last4?: string | null;
  @IsOptional() @IsInt() @Min(-MAX) @Max(MAX) openingCents?: number;
  @IsOptional() @Matches(DAY) openingDate?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class CategoryDto {
  @IsOptional() @IsIn(['IN', 'OUT']) direction?: 'IN' | 'OUT';
  @IsOptional() @IsIn(['INCOME', 'COGS', 'STAFF', 'OPS', 'MARKETING', 'OTHER', 'NON_PL']) group?: string;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX) budgetCents?: number | null;
  @IsOptional() @IsBoolean() hidden?: boolean;
}

export class RecurringDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(64) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(64) fundId?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX) amountCents?: number | null;
  @IsOptional() @IsIn(['WEEKLY', 'MONTHLY', 'YEARLY']) cadence?: string;
  @IsOptional() @Matches(DAY) anchorDay?: string;
  @IsOptional() @Matches(DAY) nextDue?: string;
  @IsOptional() @IsIn(['REMIND', 'AUTO']) mode?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120) payee?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class PayRecurringDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX) amountCents?: number;
  @IsOptional() @Matches(DAY) day?: string;
  @IsOptional() @IsString() @MaxLength(64) fundId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(12) approvalPin?: string;
}

export class FinanceSettingsDto {
  @IsInt() @Min(0) @Max(MAX) approvalOverCents!: number;
}
