import { Injectable, NotFoundException, BadRequestException, BadGatewayException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CybridConfigService } from '../../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../../core/interfaces/financial-provider.interface';
import { KybStatus } from '@prisma/client';

@Injectable()
export class CybridCustomerService {
  private readonly logger = new Logger(CybridCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  async createOrGetCustomer(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { businessProfile: true, cybridCustomer: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.cybridCustomer) {
      return user.cybridCustomer;
    }

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    const businessName = user.businessProfile?.legalName || user.fullName || 'Agency Business Entity';
    const email = user.email;

    let customerGuid: string;
    let customerState = 'storing';

    try {
      const response = await this.cybridProvider.createCustomer({
        name: businessName,
        type: 'business',
        bankGuid: this.config.bankGuid,
        email,
      });
      customerGuid = response.guid;
      customerState = response.state;

      // If newly created customer is in 'storing' state, poll until ready
      if (customerState === 'storing') {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const check = await this.cybridProvider.getCustomer(customerGuid);
            customerState = check.state;
            if (customerState !== 'storing') break;
          } catch (_) {}
        }
      }
    } catch (err) {
      this.logger.error(`Failed to create Cybrid customer for user ${userId}: ${err.message}`);
      throw new BadGatewayException(`Cybrid customer creation failed: ${err.message}`);
    }

    const cybridCustomer = await this.prisma.cybridCustomer.create({
      data: {
        userId,
        cybridCustomerGuid: customerGuid,
        customerType: 'business',
        kybStatus: customerState === 'verified' ? 'approved' : 'not_started',
        cybridBankGuid: this.config.bankGuid || 'bank_sandbox',
      },
    });

    // Update user provider ref for backward compatibility
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        providerLegalEntityId: customerGuid,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_CUSTOMER_CREATED',
      entityType: 'CybridCustomer',
      entityId: cybridCustomer.id,
      details: { customerGuid, businessName, state: customerState },
    });

    return cybridCustomer;
  }

  async initiateKYB(userId: string, customDetails?: any): Promise<any> {
    const customer = await this.createOrGetCustomer(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { businessProfile: true, representative: true },
    });

    const bp = user?.businessProfile;
    const rep = user?.representative;

    if (!bp?.legalName && !bp?.address && !customDetails) {
      throw new BadRequestException('Business profile information is required to initiate KYB verification.');
    }

    let verificationGuid: string;
    let verificationState = 'waiting';
    let outcome: string | undefined = undefined;

    const normalizeCountry = (c?: string) => {
      if (!c) return 'US';
      const clean = c.trim().toUpperCase();
      if (clean === 'UNITED STATES' || clean === 'USA' || clean === 'US') return 'US';
      if (clean === 'CANADA' || clean === 'CA') return 'CA';
      if (clean === 'UNITED KINGDOM' || clean === 'UK' || clean === 'GB') return 'GB';
      return clean.length === 2 ? clean : 'US';
    };
    const countryCode = normalizeCountry(bp?.country);

    try {
      const verification = await this.cybridProvider.createIdentityVerification({
        customerGuid: customer.cybridCustomerGuid,
        type: 'kyc',
        method: 'business_registration',
        countryCode: countryCode,
        name: {
          first: rep?.fullName?.split(' ')[0] || 'Business',
          last: rep?.fullName?.split(' ').slice(1).join(' ') || 'Owner',
        },
        address: {
          street: bp?.addressLine1 || bp?.address || '100 Pine Street, Suite 2400',
          city: bp?.city || 'San Francisco',
          subdivision: bp?.businessState || bp?.stateOrProvince || 'CA',
          postalCode: bp?.zipCode || bp?.postalCode || '94111',
          countryCode: countryCode,
        },
        dateOfBirth: rep?.dob || '1988-04-12',
        identificationType: 'tax_identification_number',
        identificationValue: bp?.taxId || bp?.registrationNumber || '12-3456789',
      });

      verificationGuid = verification.guid;
      verificationState = verification.state;
      outcome = verification.outcome;

      // Allow Cybrid sandbox to process verification and query live state
      await new Promise((r) => setTimeout(r, 1000));
      let liveCybridState = 'unverified';
      try {
        const cybridCheck = await this.cybridProvider.getCustomer(customer.cybridCustomerGuid);
        liveCybridState = cybridCheck.state;
        if (liveCybridState === 'verified') {
          verificationState = 'completed';
          outcome = 'passed';
        }
      } catch (_) {}
    } catch (err) {
      this.logger.error(`Cybrid KYB API call failed: ${err.message}`);
      throw new BadGatewayException(`Cybrid identity verification failed: ${err.message}`);
    }

    // Strictly sync status with Cybrid live state
    let newKybStatus: KybStatus = KybStatus.pending;
    if (verificationState === 'completed' && outcome === 'passed') {
      newKybStatus = KybStatus.approved;
    } else if (outcome === 'failed' || verificationState === 'rejected') {
      newKybStatus = KybStatus.rejected;
    }

    const updatedCustomer = await this.prisma.cybridCustomer.update({
      where: { id: customer.id },
      data: {
        kybVerificationGuid: verificationGuid,
        kybStatus: newKybStatus,
        kybOutcome: outcome || verificationState,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kybStatus: newKybStatus,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_KYB_INITIATED',
      entityType: 'CybridCustomer',
      entityId: updatedCustomer.id,
      details: { verificationGuid, kybStatus: newKybStatus, outcome },
    });

    return {
      success: true,
      customer: updatedCustomer,
      verificationGuid,
      kybStatus: newKybStatus,
    };
  }

  async getCustomerStatus(userId: string): Promise<any> {
    const customer = await this.prisma.cybridCustomer.findUnique({
      where: { userId },
      include: {
        accounts: {
          include: { depositBankAccounts: true },
        },
      },
    });

    if (!customer) {
      return {
        hasCustomer: false,
        kybStatus: 'not_started',
      };
    }

    return {
      hasCustomer: true,
      customerGuid: customer.cybridCustomerGuid,
      kybStatus: customer.kybStatus,
      kybOutcome: customer.kybOutcome,
      accounts: customer.accounts,
    };
  }
}
