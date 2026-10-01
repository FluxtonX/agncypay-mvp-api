import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateBrandPaymentDto {
  @IsUUID()
  agencyOrganizationId!: string;

  @Type(() => Number)
  @IsPositive()
  amount!: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsUUID()
  commercialDocumentVersionId!: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ProvisionAgencyRailsDto {
  @IsString()
  @IsNotEmpty()
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsString()
  @MinLength(4)
  @Matches(/^\d+$/)
  accountNumber!: string;

  @IsString()
  @Matches(/^\d{9}$/)
  routingNumber!: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
