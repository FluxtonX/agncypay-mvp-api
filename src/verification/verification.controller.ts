import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import {
  AccountTypes,
  OrganizationRoles,
} from '../auth/decorators/authorization.decorator';
import { CurrentUser } from '../common/decorators';
import { VerificationService } from './verification.service';

class TalentKycDto {
  @IsString()
  @IsNotEmpty()
  legalFullName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsString()
  @Length(2, 3)
  country!: string;

  @IsString()
  @IsNotEmpty()
  street!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  @IsNotEmpty()
  postalCode!: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  nationalIdLast4?: string;
}

@ApiTags('Identity Verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({
    summary: 'Get provider-independent identity and onboarding state',
  })
  @Get('state')
  getVerificationState(@CurrentUser('id') userId: string) {
    return this.verificationService.getVerificationState(userId);
  }

  @ApiOperation({
    summary: 'Discover configured payment-provider onboarding requirements',
  })
  @AccountTypes('agency')
  @Get('provider/requirements')
  getProviderRequirements(@Query('country') country?: string) {
    return this.verificationService.getOnboardingRequirements(country || 'USA');
  }

  @ApiOperation({
    summary:
      'Submit the authenticated organization to the configured payment provider',
  })
  @AccountTypes('agency')
  @OrganizationRoles('agency_owner')
  @Post('provider/onboarding')
  submitProviderOnboarding(@CurrentUser('id') userId: string) {
    return this.verificationService.submitOrganizationOnboarding(userId);
  }

  @ApiOperation({
    summary: 'Provision a provider-independent organization deposit account',
  })
  @AccountTypes('agency')
  @OrganizationRoles('agency_owner')
  @Post('provider/deposit-account')
  provisionDepositAccount(@CurrentUser('id') userId: string) {
    return this.verificationService.provisionDepositAccount(userId);
  }

  @ApiOperation({ summary: 'Submit Talent identity details for review' })
  @AccountTypes('talent')
  @Post('talent-kyc')
  submitTalentKyc(
    @CurrentUser('id') userId: string,
    @Body() data: TalentKycDto,
  ) {
    return this.verificationService.submitTalentKyc(userId, data);
  }

  @ApiOperation({ summary: 'Defer Talent identity verification' })
  @AccountTypes('talent')
  @Post('skip')
  skipVerification(@CurrentUser('id') userId: string) {
    return this.verificationService.skipVerification(userId);
  }
}
