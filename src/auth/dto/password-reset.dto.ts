import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'agency@elite.com', description: 'Account email to receive reset token' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-xyz-123', description: 'Password reset token received via email' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'NewPassword123!', description: 'New account password' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
