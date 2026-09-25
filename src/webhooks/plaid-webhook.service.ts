import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { decryptText } from '../common/utils/crypto.util';

@Injectable()
export class PlaidWebhookService {
  private readonly logger = new Logger(PlaidWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Process incoming Plaid Webhook event
   * Plaid event structure: { webhook_type, webhook_code, item_id, error?, new_transactions?, ... }
   */
  async processWebhook(payload: any, verificationHeader?: string) {
    const webhookType = payload?.webhook_type || 'UNKNOWN';
    const webhookCode = payload?.webhook_code || 'EVENT';
    const itemId = payload?.item_id || 'no_item_id';
    const eventId = `plaid_${itemId}_${webhookCode}_${Date.now()}`;

    this.logger.log(`[Plaid Webhook] Ingested event [${webhookType}] ${webhookCode} for item: ${itemId}`);

    // Store in webhook_events table for compliance audit & idempotency
    const webhookRecord = await this.prisma.webhookEvent.create({
      data: {
        eventId,
        eventType: `PLAID_${webhookType}_${webhookCode}`,
        payload: payload || {},
        status: 'processed',
      },
    });

    // Locate linked BankDetails if item_id exists
    let matchedBank = null;
    if (itemId && itemId !== 'no_item_id') {
      const allBanks = await this.prisma.bankDetails.findMany({
        where: { plaidItemId: { not: null } },
      });
      matchedBank = allBanks.find((b) => {
        if (!b.plaidItemId) return false;
        try {
          return decryptText(b.plaidItemId) === itemId || b.plaidItemId === itemId;
        } catch {
          return b.plaidItemId === itemId;
        }
      });
    }

    // Handle event by category
    switch (webhookType) {
      case 'ITEM':
        await this.handleItemEvent(webhookCode, payload, matchedBank);
        break;
      case 'AUTH':
        await this.handleAuthEvent(webhookCode, payload, matchedBank);
        break;
      case 'TRANSACTIONS':
        await this.handleTransactionsEvent(webhookCode, payload, matchedBank);
        break;
      case 'SANDBOX':
        this.logger.log(`[Plaid Webhook] Sandbox simulated event validated successfully: ${webhookCode}`);
        break;
      default:
        this.logger.log(`[Plaid Webhook] Unhandled category: ${webhookType} - ${webhookCode}`);
    }

    if (matchedBank?.userId) {
      await this.auditLogsService.log({
        userId: matchedBank.userId,
        action: `PLAID_WEBHOOK_${webhookCode}`,
        entityType: 'BankDetails',
        entityId: matchedBank.id,
        details: { webhookType, webhookCode, itemId },
      });
    }

    return {
      success: true,
      eventId,
      webhookType,
      webhookCode,
      status: 'processed',
      matchedBankId: matchedBank?.id || null,
      timestamp: new Date().toISOString(),
    };
  }

  private async handleItemEvent(code: string, payload: any, bank: any) {
    if (code === 'ERROR') {
      const err = payload?.error;
      this.logger.warn(`Plaid Item Error: ${err?.error_code} - ${err?.error_message}`);
      if (bank) {
        await this.prisma.bankDetails.update({
          where: { id: bank.id },
          data: { status: 'rejected' },
        });
      }
    } else if (code === 'DEFAULT_UPDATE' || code === 'INITIAL_UPDATE') {
      this.logger.log(`Plaid Item state refreshed for bank: ${bank?.bankName || 'N/A'}`);
      if (bank && bank.status !== 'approved') {
        await this.prisma.bankDetails.update({
          where: { id: bank.id },
          data: { status: 'approved' },
        });
      }
    }
  }

  private async handleAuthEvent(code: string, payload: any, bank: any) {
    if (code === 'AUTOMATICALLY_VERIFIED') {
      this.logger.log(`Plaid microdeposits / instant auth completed for bank: ${bank?.id}`);
      if (bank) {
        await this.prisma.bankDetails.update({
          where: { id: bank.id },
          data: { status: 'approved' },
        });
      }
    } else if (code === 'VERIFICATION_EXPIRED') {
      this.logger.warn(`Plaid verification expired for bank: ${bank?.id}`);
      if (bank) {
        await this.prisma.bankDetails.update({
          where: { id: bank.id },
          data: { status: 'rejected' },
        });
      }
    }
  }

  private async handleTransactionsEvent(code: string, payload: any, bank: any) {
    this.logger.log(`Plaid transactions event [${code}]: ${payload?.new_transactions ?? 0} new records`);
  }

  /**
   * Return recent Plaid webhook events for audit inspection
   */
  async getRecentEvents(limit = 25) {
    return this.prisma.webhookEvent.findMany({
      where: { eventType: { startsWith: 'PLAID_' } },
      orderBy: { processedAt: 'desc' },
      take: limit,
    });
  }
}
