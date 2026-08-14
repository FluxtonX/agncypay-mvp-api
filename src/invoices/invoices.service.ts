import { Injectable, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoiceRepository } from '../infrastructure/database/repositories/invoice.repository';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { WalletsService } from '../modules/wallets/wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus, PayoutStatus } from '@prisma/client';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly userRepo: UserRepository,
    private readonly modernTreasuryProvider: ModernTreasuryProvider,
    private readonly auditLogsService: AuditLogsService,
    private readonly walletsService: WalletsService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getInvoices() {
    return this.invoiceRepo.findMany();
  }

  async getInvoiceById(id: string) {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  async createInvoice(data: {
    campaign: string;
    agencyName: string;
    agencyEmail: string;
    brandName: string;
    brandEmail: string;
    amount: number;
    due: string;
    splits?: any[];
  }) {
    let agencyUser = await this.userRepo.findByEmail(data.agencyEmail);
    if (!agencyUser) {
      agencyUser = await this.userRepo.create({
        email: data.agencyEmail,
        password: 'Password123!',
        fullName: data.agencyName,
        accountType: 'agency',
        agncyId: `AGY-${Math.floor(100000 + Math.random() * 900000)}`,
      });
    }
    const agencyWallet = await this.walletsService.getOrCreateWalletForUser(agencyUser.id, 'agency');

    let brandUser = await this.userRepo.findByEmail(data.brandEmail);
    if (!brandUser) {
      brandUser = await this.userRepo.create({
        email: data.brandEmail,
        password: 'Password123!',
        fullName: data.brandName,
        accountType: 'brand',
        agncyId: `BRND-${Math.floor(100000 + Math.random() * 900000)}`,
      });
    }
    const brandWallet = await this.walletsService.getOrCreateWalletForUser(brandUser.id, 'brand');

    const agencyName = data.agencyName || (agencyUser ? agencyUser.fullName : '') || data.agencyEmail || 'Agency Workspace';
    const brandName = data.brandName || (brandUser ? brandUser.fullName : '') || data.brandEmail || 'Brand Partner';

    const invNum = `W-INV-${Math.floor(1000 + Math.random() * 9000)}`;

    const createdInvoice = await this.invoiceRepo.create({
      id: invNum,
      invoiceNumber: invNum,
      campaign: data.campaign || 'Services Rendered',
      agencyId: agencyUser.id,
      agencyEmail: data.agencyEmail,
      agencyWalletId: agencyWallet.id,
      brandId: brandUser.id,
      brandName: brandName,
      brandEmail: data.brandEmail,
      brandWalletId: brandWallet.id,
      amount: data.amount,
      due: data.due || 'Net-30',
      status: 'pending',
      payoutStatus: 'pending',
      createdDate: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      payerId: agencyUser.agncyId,
      payerEmail: data.brandEmail,
      payerAddress: ['One Bowerman Drive', 'Beaverton, OR 97005'],
      splits: data.splits || [],
    });

    await this.auditLogsService.log({
      userId: agencyUser.id,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: createdInvoice.id,
      details: {
        amount: data.amount,
        campaign: data.campaign,
        brandEmail: data.brandEmail,
        agencyWalletId: agencyWallet.walletId,
        brandWalletId: brandWallet.walletId,
      },
    });

    this.eventEmitter.emit('invoice.created', createdInvoice);

    return createdInvoice;
  }

  async updateInvoiceStatus(id: string, status: string, payoutStatus?: string, userId?: string) {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    const updated = await this.invoiceRepo.update(id, {
      status: status as InvoiceStatus,
      payoutStatus: (payoutStatus || invoice.payoutStatus) as PayoutStatus,
    });

    await this.auditLogsService.log({
      userId,
      action: 'INVOICE_STATUS_UPDATED',
      entityType: 'Invoice',
      entityId: id,
      details: { previousStatus: invoice.status, newStatus: status, payoutStatus: updated.payoutStatus },
    });

    // Handle Modern Treasury ACH Payment Execution and Wallet Ledger entry if marked paid or processing
    if (status === 'paid' && invoice.status !== 'paid') {
      const brandUser = await this.prisma.user.findUnique({ where: { id: invoice.brandId } });
      const agencyUser = await this.prisma.user.findUnique({ where: { id: invoice.agencyId } });
      const recipientBank = await this.prisma.bankDetails.findUnique({
        where: { userId: invoice.agencyId },
      });

      const achResponse = await this.modernTreasuryProvider.processACHPayment({
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: 'USD',
        payerUserId: invoice.brandId,
        recipientUserId: invoice.agencyId,
        originatingAccountId: brandUser?.modernTreasuryCounterpartyId || undefined,
        receivingAccountId: agencyUser?.modernTreasuryInternalAccountId || undefined,
        accountNumber: recipientBank?.accountNumber,
        routingNumber: recipientBank?.routingNumber,
      });

      const brandWallet = await this.walletsService.getOrCreateWalletForUser(invoice.brandId, 'brand');
      const agencyWallet = await this.walletsService.getOrCreateWalletForUser(invoice.agencyId, 'agency');

      // Double-entry ledger reference
      await this.walletsService.recordTransaction({
        walletId: brandWallet.walletId,
        type: 'debit',
        amount: invoice.amount,
        referenceType: 'INVOICE_PAYMENT',
        referenceId: invoice.id,
        description: `ACH Payment for Invoice ${invoice.invoiceNumber}`,
      });

      await this.walletsService.recordTransaction({
        walletId: agencyWallet.walletId,
        type: 'credit',
        amount: invoice.amount,
        referenceType: 'INVOICE_PAYMENT',
        referenceId: invoice.id,
        description: `ACH Settlement received for Invoice ${invoice.invoiceNumber}`,
      });

      await this.auditLogsService.log({
        userId: invoice.brandId,
        action: 'ACH_PAYMENT_INITIATED',
        entityType: 'Invoice',
        entityId: invoice.id,
        details: achResponse,
      });

      this.eventEmitter.emit('invoice.paid', { invoice: updated, achResponse });
    }

    return updated;
  }

  async handleModernTreasuryWebhook(eventPayload: any, rawBody: string, signature: string) {
    const isValid = this.modernTreasuryProvider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Rejected Modern Treasury webhook: Invalid signature');
      throw new UnauthorizedException('Invalid Modern Treasury webhook signature');
    }

    const eventId = eventPayload?.id || eventPayload?.event_id || `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const eventType = eventPayload?.event || eventPayload?.type;
    const data = eventPayload?.data || eventPayload;

    // Webhook Idempotency Check
    const existingEvent = await this.prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existingEvent) {
      this.logger.log(`Ignoring duplicate Modern Treasury webhook event ID: ${eventId}`);
      return { status: 'acknowledged', reason: 'Duplicate event' };
    }

    await this.prisma.webhookEvent.create({
      data: {
        eventId,
        eventType: eventType || 'unknown',
        status: 'processed',
        payload: eventPayload,
      },
    });

    const invoiceId = data?.metadata?.invoiceId || data?.payment_order?.metadata?.invoiceId;
    const payoutId = data?.metadata?.payoutId || data?.payment_order?.metadata?.payoutId;

    this.logger.log(`Processing Modern Treasury webhook event: ${eventType} (Invoice: ${invoiceId || 'N/A'}, Payout: ${payoutId || 'N/A'})`);

    if (payoutId) {
      const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (payout) {
        if (eventType === 'payment_order.completed') {
          await this.prisma.payout.update({ where: { id: payoutId }, data: { status: 'disbursed' } });
        } else if (eventType === 'payment_order.failed' || eventType === 'payment_order.denied') {
          await this.prisma.payout.update({ where: { id: payoutId }, data: { status: 'failed' } });
        } else if (eventType === 'payment_order.returned') {
          await this.prisma.payout.update({ where: { id: payoutId }, data: { status: 'returned' } });
        }
      }
    }

    if (!invoiceId) {
      await this.auditLogsService.log({
        action: 'MODERN_TREASURY_WEBHOOK_RECEIVED',
        entityType: 'WebhookEvent',
        entityId: eventId,
        details: { eventType, unmapped: true, payload: data },
      });
      return { status: 'acknowledged', reason: 'No invoiceId in metadata' };
    }

    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (!invoice) {
      this.logger.warn(`Webhook invoice not found: ${invoiceId}`);
      return { status: 'acknowledged', reason: `Invoice ${invoiceId} not found` };
    }

    switch (eventType) {
      case 'payment_order.completed': {
        if (invoice.status !== 'paid') {
          await this.invoiceRepo.update(invoice.id, {
            status: 'paid',
            payoutStatus: 'disbursed',
          });

          const brandWallet = await this.walletsService.getOrCreateWalletForUser(invoice.brandId, 'brand');
          const agencyWallet = await this.walletsService.getOrCreateWalletForUser(invoice.agencyId, 'agency');

          await this.walletsService.recordTransaction({
            walletId: brandWallet.walletId,
            type: 'debit',
            amount: invoice.amount,
            referenceType: 'INVOICE_PAYMENT_SETTLED',
            referenceId: invoice.id,
            description: `Settled ACH Payment for Invoice ${invoice.invoiceNumber}`,
          });

          await this.walletsService.recordTransaction({
            walletId: agencyWallet.walletId,
            type: 'credit',
            amount: invoice.amount,
            referenceType: 'INVOICE_PAYMENT_SETTLED',
            referenceId: invoice.id,
            description: `Settled ACH Disbursement for Invoice ${invoice.invoiceNumber}`,
          });

          await this.auditLogsService.log({
            userId: invoice.brandId,
            action: 'ACH_PAYMENT_COMPLETED',
            entityType: 'Invoice',
            entityId: invoice.id,
            details: { webhookEvent: eventType, data },
          });

          this.eventEmitter.emit('invoice.paid', { invoice, data });
        }
        break;
      }

      case 'payment_order.failed':
      case 'payment_order.denied': {
        await this.invoiceRepo.update(invoice.id, {
          status: 'pending',
          payoutStatus: 'pending',
        });

        await this.auditLogsService.log({
          userId: invoice.brandId,
          action: 'ACH_PAYMENT_FAILED',
          entityType: 'Invoice',
          entityId: invoice.id,
          details: { webhookEvent: eventType, data },
        });

        this.eventEmitter.emit('invoice.payment_failed', { invoice, data });
        break;
      }

      case 'payment_order.returned': {
        await this.invoiceRepo.update(invoice.id, {
          status: 'overdue',
          payoutStatus: 'pending',
        });

        const agencyWallet = await this.walletsService.getOrCreateWalletForUser(invoice.agencyId, 'agency');
        const brandWallet = await this.walletsService.getOrCreateWalletForUser(invoice.brandId, 'brand');

        // Reverse ledger entries if returned after initial credit
        await this.walletsService.recordTransaction({
          walletId: agencyWallet.walletId,
          type: 'debit',
          amount: invoice.amount,
          referenceType: 'INVOICE_PAYMENT_RETURNED',
          referenceId: invoice.id,
          description: `ACH Return reversal for Invoice ${invoice.invoiceNumber}`,
        });

        await this.walletsService.recordTransaction({
          walletId: brandWallet.walletId,
          type: 'credit',
          amount: invoice.amount,
          referenceType: 'INVOICE_PAYMENT_RETURNED',
          referenceId: invoice.id,
          description: `ACH Return refund credit for Invoice ${invoice.invoiceNumber}`,
        });

        await this.auditLogsService.log({
          userId: invoice.brandId,
          action: 'ACH_PAYMENT_RETURNED',
          entityType: 'Invoice',
          entityId: invoice.id,
          details: { webhookEvent: eventType, data },
        });

        this.eventEmitter.emit('invoice.payment_returned', { invoice, data });
        break;
      }

      default: {
        this.logger.log(`Received unhandled Modern Treasury event: ${eventType}`);
        await this.auditLogsService.log({
          action: 'MODERN_TREASURY_WEBHOOK_RECEIVED',
          entityType: 'Invoice',
          entityId: invoice.id,
          details: { eventType, data },
        });
        break;
      }
    }

    return { status: 'success', eventType, invoiceId: invoice.id };
  }

  async getBrands() {
    return this.userRepo.findMany({ accountType: 'brand' });
  }
}


