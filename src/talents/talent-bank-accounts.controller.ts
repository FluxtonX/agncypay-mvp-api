import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TalentBankAccountsService, TalentBankAccountDto } from './talent-bank-accounts.service';

@ApiTags('Talent Bank Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('talent/bank-accounts')
export class TalentBankAccountsController {
  constructor(private readonly bankAccountsService: TalentBankAccountsService) {}

  @ApiOperation({ summary: '1. Create Plaid Link Token for Talent' })
  @ApiResponse({ status: 200, description: 'Plaid Link Token generated' })
  @Post('link-token')
  @HttpCode(HttpStatus.OK)
  async createLinkToken(@CurrentUser('id') userId: string) {
    return this.bankAccountsService.createLinkToken(userId);
  }

  @ApiOperation({ summary: '2. Complete Plaid Link with public_token and accountId' })
  @ApiResponse({ status: 201, description: 'Bank account linked and Cybrid EBA provisioned' })
  @Post('plaid/complete')
  async completePlaidLink(
    @CurrentUser('id') userId: string,
    @Body() body: { publicToken: string; accountId?: string; institutionName?: string },
  ): Promise<TalentBankAccountDto> {
    return this.bankAccountsService.completePlaidLink(userId, body);
  }

  @ApiOperation({ summary: '3. List all linked bank accounts for Talent' })
  @ApiResponse({ status: 200, description: 'List of linked accounts' })
  @Get()
  async getBankAccounts(@CurrentUser('id') userId: string): Promise<TalentBankAccountDto[]> {
    return this.bankAccountsService.getBankAccounts(userId);
  }

  @ApiOperation({ summary: '4. Get single bank account by ID' })
  @ApiResponse({ status: 200, description: 'Bank account details' })
  @Get(':id')
  async getBankAccountById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<TalentBankAccountDto> {
    return this.bankAccountsService.getBankAccountById(userId, id);
  }

  @ApiOperation({ summary: '5. Set default bank account for payouts' })
  @ApiResponse({ status: 200, description: 'Default bank account updated' })
  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  async setDefaultBankAccount(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.bankAccountsService.setDefaultBankAccount(userId, id);
  }

  @ApiOperation({ summary: '6. Remove a linked bank account' })
  @ApiResponse({ status: 200, description: 'Bank account removed' })
  @Delete(':id')
  async deleteBankAccount(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.bankAccountsService.deleteBankAccount(userId, id);
  }

  @ApiOperation({ summary: '7. 1-Tap Sandbox Connect (Plaid Sandbox API)' })
  @ApiResponse({ status: 201, description: 'Sandbox test bank account linked directly' })
  @Post('sandbox-connect')
  async linkSandboxAccount(
    @CurrentUser('id') userId: string,
    @Body('institutionId') institutionId?: string,
  ): Promise<TalentBankAccountDto> {
    return this.bankAccountsService.linkSandboxAccount(userId, institutionId);
  }
}
