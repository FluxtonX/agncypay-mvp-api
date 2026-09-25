import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('KYB Verification & Bank Link')
@ApiBearerAuth()
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({ summary: 'Get full KYB & verification progress state' })
  @UseGuards(JwtAuthGuard)
  @Get('state')
  async getVerificationState(@CurrentUser('id') userId: string) {
    return this.verificationService.getVerificationState(userId);
  }

  @ApiOperation({ summary: 'Create Plaid Link token for bank verification' })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('plaid/link-token')
  async createPlaidLinkToken(@CurrentUser('id') userId?: string) {
    return this.verificationService.createPlaidLinkToken(userId);
  }

  @ApiOperation({ summary: 'Exchange Plaid public token for access token and link bank' })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('plaid/exchange-token')
  async exchangePlaidPublicToken(
    @CurrentUser('id') userId: string | undefined,
    @Body() body: { publicToken?: string; public_token?: string; institution?: any },
  ) {
    const token = body.publicToken || body.public_token;
    return this.verificationService.exchangePlaidPublicToken(userId, token || '', body.institution);
  }

  @ApiOperation({ summary: 'Get all linked Plaid bank accounts for current user' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('plaid/accounts')
  async getPlaidAccounts(@CurrentUser('id') userId?: string) {
    return this.verificationService.getLinkedAccounts(userId);
  }

  @ApiOperation({ summary: 'Disconnect linked bank account' })
  @UseGuards(OptionalJwtAuthGuard)
  @Delete('plaid/accounts/:id')
  async disconnectPlaidAccount(
    @CurrentUser('id') userId: string | undefined,
    @Param('id') accountId: string,
  ) {
    return this.verificationService.disconnectAccount(userId, accountId);
  }

  @ApiOperation({ summary: 'Link Plaid sandbox test bank account directly' })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('plaid/sandbox-link')
  async linkPlaidSandboxAccount(
    @CurrentUser('id') userId?: string,
    @Body('institutionId') institutionId?: string,
  ) {
    return this.verificationService.linkPlaidSandboxAccount(userId, institutionId);
  }

  @ApiOperation({ summary: 'Create Plaid processor token for ACH payment gateways' })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('plaid/processor-token')
  async createPlaidProcessorToken(
    @CurrentUser('id') userId: string | undefined,
    @Body('processor') processor?: string,
  ) {
    return this.verificationService.createPlaidProcessorToken(userId || 'MB-USER-AGENCY-001', processor);
  }

  @ApiOperation({ summary: 'Update business profile information' })
  @UseGuards(JwtAuthGuard)
  @Patch('business-profile')
  async updateBusinessProfile(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateBusinessProfile(userId, data);
  }

  @ApiOperation({ summary: 'Update corporate representative information' })
  @UseGuards(JwtAuthGuard)
  @Patch('representative')
  async updateRepresentative(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateRepresentative(userId, data);
  }

  @ApiOperation({ summary: 'Update corporate authorization and beneficial ownership' })
  @UseGuards(JwtAuthGuard)
  @Patch('authorization')
  async updateAuthorization(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateAuthorization(userId, data);
  }

  @ApiOperation({ summary: 'Update bank details manually' })
  @UseGuards(JwtAuthGuard)
  @Patch('bank-details')
  async updateBankDetails(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.verificationService.updateBankDetails(userId, data);
  }

  @ApiOperation({ summary: 'Submit Agency Legal Entity info for KYB verification' })
  @UseGuards(JwtAuthGuard)
  @Post('legal-entity')
  async submitLegalEntity(@CurrentUser('id') userId: string) {
    return this.verificationService.submitLegalEntity(userId);
  }

  @ApiOperation({ summary: 'Setup Brand funding account' })
  @UseGuards(JwtAuthGuard)
  @Post('brand/funding-account')
  async setupBrandFundingAccount(
    @CurrentUser('id') userId: string,
    @Body('accountNumber') accountNumber: string,
    @Body('routingNumber') routingNumber: string,
    @Body('bankName') bankName?: string,
  ) {
    return this.verificationService.setupBrandFundingAccount(userId, accountNumber, routingNumber, bankName);
  }
}
