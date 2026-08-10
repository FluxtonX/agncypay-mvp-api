import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('KYB Verification & Bank Link')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({ summary: 'Get full KYB & verification progress state' })
  @Get('state')
  async getVerificationState(@CurrentUser('id') userId: string) {
    return this.verificationService.getVerificationState(userId);
  }

  @ApiOperation({ summary: 'Create Plaid Link token for bank verification' })
  @Post('plaid/link-token')
  async createPlaidLinkToken(@CurrentUser('id') userId: string) {
    return this.verificationService.createPlaidLinkToken(userId);
  }

  @ApiOperation({ summary: 'Exchange Plaid public token for access token and link bank' })
  @Post('plaid/exchange-token')
  async exchangePlaidPublicToken(
    @CurrentUser('id') userId: string,
    @Body('publicToken') publicToken: string,
  ) {
    return this.verificationService.exchangePlaidPublicToken(userId, publicToken);
  }

  @ApiOperation({ summary: 'Create Plaid processor token for ACH payment gateways (e.g. Modern Treasury)' })
  @Post('plaid/processor-token')
  async createPlaidProcessorToken(
    @CurrentUser('id') userId: string,
    @Body('processor') processor?: string,
  ) {
    return this.verificationService.createPlaidProcessorToken(userId, processor);
  }

  @ApiOperation({ summary: 'Update business profile information' })
  @Patch('business-profile')
  async updateBusinessProfile(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateBusinessProfile(userId, data);
  }

  @ApiOperation({ summary: 'Update corporate representative information' })
  @Patch('representative')
  async updateRepresentative(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateRepresentative(userId, data);
  }

  @ApiOperation({ summary: 'Update corporate authorization and beneficial ownership' })
  @Patch('authorization')
  async updateAuthorization(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateAuthorization(userId, data);
  }

  @ApiOperation({ summary: 'Update bank details manually' })
  @Patch('bank-details')
  async updateBankDetails(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateBankDetails(userId, data);
  }
}

