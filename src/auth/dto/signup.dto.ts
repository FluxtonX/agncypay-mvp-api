import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicSignupDto {
  @ApiProperty({ enum: ['agency', 'brand', 'talent'] })
  @IsEnum(['agency', 'brand', 'talent'])
  accountType!: 'agency' | 'brand' | 'talent';

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @ApiPropertyOptional({
    description: 'Required for Agency and Brand public signup',
  })
  @ValidateIf((dto: PublicSignupDto) => dto.accountType !== 'talent')
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  organizationName?: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}
