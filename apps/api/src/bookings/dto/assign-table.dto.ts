import { IsString } from 'class-validator';

export class AssignTableDto {
  @IsString()
  tableId!: string;
}
