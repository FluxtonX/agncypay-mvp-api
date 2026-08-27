import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoiceRepository } from '../infrastructure/database/repositories/invoice.repository';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
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

    // Handle internal double-entry wallet ledger entry if marked paid
    if (status === 'paid' && invoice.status !== 'paid') {
      const brandWallet = await this.walletsService.getOrCreateWalletForUser(invoice.brandId, 'brand');
      const agencyWallet = await this.walletsService.getOrCreateWalletForUser(invoice.agencyId, 'agency');

      await this.walletsService.recordTransaction({
        walletId: brandWallet.walletId,
        type: 'debit',
        amount: invoice.amount,
        referenceType: 'INVOICE_PAYMENT',
        referenceId: invoice.id,
        description: `Payment for Invoice ${invoice.invoiceNumber}`,
      });

      await this.walletsService.recordTransaction({
        walletId: agencyWallet.walletId,
        type: 'credit',
        amount: invoice.amount,
        referenceType: 'INVOICE_PAYMENT',
        referenceId: invoice.id,
        description: `Settlement received for Invoice ${invoice.invoiceNumber}`,
      });

      await this.auditLogsService.log({
        userId: invoice.brandId,
        action: 'PAYMENT_INITIATED',
        entityType: 'Invoice',
        entityId: invoice.id,
        details: { amount: invoice.amount },
      });

      this.eventEmitter.emit('invoice.paid', { invoice: updated });
    }

    return updated;
  }

  async getBrands() {
    return this.userRepo.findMany({ accountType: 'brand' });
  }
}
