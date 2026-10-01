import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProviderMappingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../core/interfaces/payment-provider.interface';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { encryptText } from '../common/utils/crypto.util';

interface TalentKycInput {
  legalFullName: string;
  dateOfBirth: string;
  country: string;
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  nationalIdLast4?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async organizationForUser(userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        status: 'active',
        deletedAt: null,
        type: { in: ['brand', 'agency'] },
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!organization) {
      throw new ForbiddenException(
        'An active Brand or Agency organization is required',
      );
    }
    return organization;
  }

  async getVerificationState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accountType: true,
        kybStatus: true,
        businessProfile: true,
        representative: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const participantLink = await this.prisma.participantUser.findUnique({
      where: { userId },
      include: {
        participant: {
          include: {
            organizations: {
              where: { status: 'active' },
              include: {
                organization: {
                  include: {
                    providerParties: {
                      where: { provider: this.paymentProvider.name },
                    },
                    financialAccounts: { where: { deletedAt: null } },
                  },
                },
              },
            },
          },
        },
      },
    });
    return {
      accountType: user.accountType,
      verificationStatus: user.kybStatus || 'not_started',
      businessProfile: user.businessProfile,
      representative: user.representative,
      organizations:
        participantLink?.participant.organizations.map(({ organization }) => ({
          id: organization.id,
          name: organization.name,
          type: organization.type,
          providerMappings: organization.providerParties.map((mapping) => ({
            provider: mapping.provider,
            status: mapping.status,
          })),
          financialAccounts: organization.financialAccounts.map((account) => ({
            id: account.id,
            type: account.type,
            status: account.status,
            currency: account.currency,
            institutionName: account.institutionName,
            lastFour: account.lastFour,
          })),
        })) || [],
    };
  }

  getOnboardingRequirements(country = 'USA') {
    return this.paymentProvider.discoverOnboardingRequirements(country);
  }

  async submitOrganizationOnboarding(userId: string) {
    const organization = await this.organizationForUser(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const [business, representative] = await Promise.all([
      this.prisma.businessProfile.findUnique({ where: { userId } }),
      this.prisma.representative.findUnique({ where: { userId } }),
    ]);
    if (!business?.legalName || !business.country || !business.taxId) {
      throw new BadRequestException(
        'Legal name, country, and tax ID are required before provider onboarding',
      );
    }
    if (!representative?.fullName || !representative.email) {
      throw new BadRequestException(
        'An authorized representative is required before provider onboarding',
      );
    }
    const result = await this.paymentProvider.submitOnboarding({
      clientReferenceId: organization.id,
      customerType: 'business',
      businessInfo: {
        legalName: business.legalName,
        tradeName: business.brandName || business.legalName,
        taxId: business.taxId,
        country: business.country,
        website: business.website,
        industry: business.industry,
        email: business.email || user.email,
        phone: business.phone,
        address: {
          line1: business.addressLine1 || business.address,
          line2: business.addressLine2,
          city: business.city,
          state: business.stateOrProvince || business.businessState,
          postalCode: business.postalCode || business.zipCode,
          country: business.country,
        },
      },
      ownership: {
        representative: {
          fullName: representative.fullName,
          email: representative.email,
          phone: representative.phone,
          dateOfBirth: representative.dob,
        },
      },
      metadata: { organizationId: organization.id },
    });
    const providerStatus: ProviderMappingStatus =
      result.status === 'approved' || result.status === 'active'
        ? 'active'
        : 'pending';
    const externalId = result.customerId || result.id;
    const existing = await this.prisma.providerPartyMap.findFirst({
      where: {
        organizationId: organization.id,
        provider: this.paymentProvider.name,
      },
    });
    const mapping = existing
      ? await this.prisma.providerPartyMap.update({
          where: { id: existing.id },
          data: {
            externalId,
            status: providerStatus,
            metadata: { onboardingId: result.id },
          },
        })
      : await this.prisma.providerPartyMap.create({
          data: {
            organizationId: organization.id,
            provider: this.paymentProvider.name,
            partyType: 'business',
            externalId,
            status: providerStatus,
            metadata: { onboardingId: result.id },
          },
        });
    const verificationStatus =
      providerStatus === 'active' ? 'approved' : 'pending';
    await this.prisma.user.update({
      where: { id: userId },
      data: { kybStatus: verificationStatus },
    });
    await this.auditLogsService.log({
      userId,
      action: 'PROVIDER_ONBOARDING_SUBMITTED',
      entityType: 'ProviderPartyMap',
      entityId: mapping.id,
      details: {
        provider: this.paymentProvider.name,
        organizationId: organization.id,
      },
    });
    return {
      provider: this.paymentProvider.name,
      organizationId: organization.id,
      status: mapping.status,
    };
  }

  async provisionDepositAccount(userId: string) {
    const organization = await this.organizationForUser(userId);
    const party = await this.prisma.providerPartyMap.findFirst({
      where: {
        organizationId: organization.id,
        provider: this.paymentProvider.name,
        status: 'active',
      },
    });
    if (!party)
      throw new BadRequestException('Provider onboarding is not active');
    const existing = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: organization.id,
        type: 'virtual_account',
        status: 'ready',
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
    });
    if (existing) {
      return {
        id: existing.id,
        currency: existing.currency,
        status: existing.status,
        institutionName: existing.institutionName,
        lastFour: existing.lastFour,
      };
    }
    const result = await this.paymentProvider.createDepositAccount({
      partyId: party.externalId,
      currency: 'USD',
      accountType: 'collection',
      idempotencyKey: `organization-deposit-${organization.id}-USD`,
      metadata: { organizationId: organization.id },
    });
    const fundingInstructions = {
      accountNumber: result.accountNumber,
      routingNumber: result.routingNumber,
      bankName: result.bankName,
      beneficiaryName: result.beneficiaryName,
      currency: result.currency,
    };
    const account = await this.prisma.financialAccount.create({
      data: {
        organizationId: organization.id,
        type: 'virtual_account',
        status:
          result.status === 'active' || result.status === 'ready'
            ? 'ready'
            : 'pending',
        currency: result.currency,
        displayName: `${result.currency} collection account`,
        institutionName: result.bankName,
        lastFour: result.accountNumber?.slice(-4),
        metadata: {
          fundingInstructionsEncrypted: encryptText(
            JSON.stringify(fundingInstructions),
          ),
        },
        providerAccounts: {
          create: {
            provider: this.paymentProvider.name,
            accountType: 'collection',
            externalId: result.id,
            status:
              result.status === 'active' || result.status === 'ready'
                ? 'active'
                : 'pending',
          },
        },
      },
    });
    await this.auditLogsService.log({
      userId,
      action: 'PROVIDER_DEPOSIT_ACCOUNT_CREATED',
      entityType: 'FinancialAccount',
      entityId: account.id,
      details: {
        provider: this.paymentProvider.name,
        organizationId: organization.id,
      },
    });
    return {
      id: account.id,
      currency: account.currency,
      status: account.status,
      fundingInstructions,
    };
  }

  async submitTalentKyc(userId: string, data: TalentKycInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const address = [data.street, data.city, data.state, data.postalCode]
      .filter(Boolean)
      .join(', ');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { fullName: data.legalFullName, kybStatus: 'pending' },
      }),
      this.prisma.representative.upsert({
        where: { userId },
        update: {
          fullName: data.legalFullName,
          dob: data.dateOfBirth,
          nationality: data.country,
          address,
          status: 'processing',
        },
        create: {
          userId,
          fullName: data.legalFullName,
          dob: data.dateOfBirth,
          nationality: data.country,
          address,
          status: 'processing',
        },
      }),
    ]);
    await this.auditLogsService.log({
      userId,
      action: 'TALENT_KYC_SUBMITTED',
      entityType: 'Participant',
      entityId: userId,
      details: {
        country: data.country,
        hasNationalIdLast4: Boolean(data.nationalIdLast4),
      },
    });
    return { success: true, status: 'pending' };
  }

  async skipVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.auditLogsService.log({
      userId,
      action: 'VERIFICATION_DEFERRED',
      entityType: 'Participant',
      entityId: userId,
      details: { previousStatus: user.kybStatus },
    });
    return { success: true, status: 'deferred' };
  }
}
