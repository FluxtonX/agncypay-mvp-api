import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @ApiOperation({ summary: 'Trigger safety reconciliation run between Cybrid and AgncyPay' })
  @Post('run')
  async triggerReconciliation() {
    return this.reconciliationService.runReconciliation();
  }

  @ApiOperation({ summary: 'List all open reconciliation discrepancies' })
  @Get('issues')
  async getOpenIssues() {
    return this.reconciliationService.getOpenIssues();
  }

  @ApiOperation({ summary: 'Resolve a reconciliation record with audit notes' })
  @Post('resolve/:id')
  async resolveIssue(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliationService.resolveIssue(id, notes, userId);
  }
}
