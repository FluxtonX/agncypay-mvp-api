import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class TalentActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class TalentWithdrawalDto {
  @Type(() => Number)
  @IsPositive()
  amount!: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsUUID()
  destinationFinancialAccountId!: string;
}
