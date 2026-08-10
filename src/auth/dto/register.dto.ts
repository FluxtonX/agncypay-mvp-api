import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'agency@elite.com', description: 'User email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!', description: 'Account password (minimum 6 characters)' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: 'Elite Talent Agency', description: 'Full name or Business entity name' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ example: 'agency', enum: ['brand', 'agency'], description: 'Account user role type' })
  @IsEnum(['brand', 'agency'])
  accountType!: 'brand' | 'agency';

  @ApiProperty({ example: 'Elite Workspace', required: false, description: 'Optional custom workspace name' })
  @IsString()
  @IsOptional()
  workspaceName?: string;
}

