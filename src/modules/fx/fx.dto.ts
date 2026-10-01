import { Type } from 'class-transformer';
import { IsPositive, Matches } from 'class-validator';

export class CreateFxQuoteDto {
  @Matches(/^[A-Z]{3}$/)
  sourceCurrency!: string;

  @Matches(/^[A-Z]{3}$/)
  destinationCurrency!: string;

  @Type(() => Number)
  @IsPositive()
  sourceAmount!: number;
}
