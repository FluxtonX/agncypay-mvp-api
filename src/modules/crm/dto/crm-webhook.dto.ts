import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CrmWebhookDto {
  @IsString()
  @IsNotEmpty()
  event: string; // e.g. 'talent.sync', 'talent.created', 'payable.created', 'deal.closed'

  @IsOptional()
  @IsString()
  agencyId?: string;

  @IsObject()
  data: Record<string, any>;
}

export class CsvRosterImportDto {
  @IsNotEmpty()
  roster: Array<{
    externalTalentId?: string;
    fullName: string;
    email?: string;
    phone?: string;
    country?: string;
    category?: string;
    splitShare?: number;
    metadata?: Record<string, any>;
  }>;
}
