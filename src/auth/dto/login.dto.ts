import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'agency@elite.com', description: 'Registered account email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!', description: 'Account password' })
  @IsString()
  @MinLength(6)
  password!: string;
}

