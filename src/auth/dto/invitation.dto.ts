import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';

export class CreateInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['brand', 'agency', 'talent'] })
  @IsEnum(['brand', 'agency', 'talent'])
  accountType!: 'brand' | 'agency' | 'talent';

  @ApiProperty({ example: 'talent' })
  @IsString()
  @IsOptional()
  relationshipType?: string;

  @IsString()
  @IsOptional()
  @IsEnum(OrganizationRole)
  organizationRole?: OrganizationRole;

  @IsString()
  @IsOptional()
  organizationName?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  expiresInHours?: number;
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(12)
  @IsOptional()
  password?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  fullName?: string;
}
