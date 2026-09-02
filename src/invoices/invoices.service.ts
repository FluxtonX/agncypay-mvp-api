import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
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

  async getInvoices(userId?: string) {
    if (userId) {
      return this.prisma.invoice.findMany({
        where: {
          OR: [{ agencyId: userId }, { brandId: userId }],
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.invoiceRepo.findMany();
  }

  async getInvoiceById(id: string, userId?: string) {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    if (userId && invoice.agencyId !== userId && invoice.brandId !== userId) {
      throw new ForbiddenException('Access denied to this invoice record');
    }

    return invoice;
  }

  async createInvoice(data: {
    currentUserId?: string;
    campaign: string;
    agencyName?: string;
    agencyEmail: string;
    brandName?: string;
    brandEmail: string;
    amount: number;
    due: string;
    splits?: any[];
  }) {
    let agencyUser = await this.userRepo.findByEmail(data.agencyEmail);
    if (!agencyUser) {
      const hashedPassword = await bcrypt.hash('AgncyPayTempPass123!', 12);
      agencyUser = await this.userRepo.create({
        email: data.agencyEmail,
        password: hashedPassword,
        fullName: data.agencyName || 'Agency Workspace',
        accountType: 'agency',
        agncyId: `AGY-${Math.floor(100000 + Math.random() * 900000)}`,
      });
    }
    const agencyWallet = await this.walletsService.getOrCreateWalletForUser(agencyUser.id, 'agency');

    let brandUser = await this.userRepo.findByEmail(data.brandEmail);
    if (!brandUser) {
      const hashedPassword = await bcrypt.hash('AgncyPayTempPass123!', 12);
      brandUser = await this.userRepo.create({
        email: data.brandEmail,
        password: hashedPassword,
        fullName: data.brandName || 'Brand Partner',
        accountType: 'brand',
        agncyId: `BRND-${Math.floor(100000 + Math.random() * 900000)}`,
      });
    }
    const brandWallet = await this.walletsService.getOrCreateWalletForUser(brandUser.id, 'brand');

    const agencyName = data.agencyName || agencyUser.fullName || data.agencyEmail || 'Agency Workspace';
    const brandName = data.brandName || brandUser.fullName || data.brandEmail || 'Brand Partner';

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
      amount: data.amount as any,
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
      userId: data.currentUserId || agencyUser.id,
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

    if (userId && invoice.agencyId !== userId && invoice.brandId !== userId) {
      throw new ForbiddenException('Access denied to update this invoice');
    }

    const updated = await this.invoiceRepo.update(id, {
      status: status as InvoiceStatus,
      payoutStatus: (payoutStatus || invoice.payoutStatus) as PayoutStatus,
    });

    await this.auditLogsService.log({
      userId: userId || invoice.agencyId,
      action: 'INVOICE_STATUS_UPDATED',
      entityType: 'Invoice',
      entityId: id,
      details: { previousStatus: invoice.status, newStatus: status, payoutStatus: updated.payoutStatus },
    });

    if (status === 'paid' && invoice.status !== 'paid') {
      this.eventEmitter.emit('invoice.paid', { invoice: updated });
    }

    return updated;
  }

  async getBrands() {
    return this.userRepo.findMany({ accountType: 'brand' });
  }
}
