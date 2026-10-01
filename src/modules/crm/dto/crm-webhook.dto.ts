import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsISO8601,
} from 'class-validator';

export class CrmWebhookDto {
  @IsString()
  @IsNotEmpty()
  event: string; // e.g. 'talent.sync', 'invoice.created', 'payable.created', 'deal.closed'

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

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
    metadata?: Record<string, any>;
  }>;
}
