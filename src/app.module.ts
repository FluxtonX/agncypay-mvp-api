import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { WebhooksModule } from './webhooks/webhooks.module';

import { LedgerModule } from './modules/ledger/ledger.module';
import { TalentModule } from './talents/talent.module';
import { PaymentModule } from './modules/payments/payment.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { CrmModule } from './modules/crm/crm.module';
import { SourceConnectionsModule } from './modules/source-connections/source-connections.module';
import { CommercialDocumentsModule } from './modules/commercial-documents/commercial-documents.module';
import { PaymentOrchestrationModule } from './modules/payment-orchestration/payment-orchestration.module';
import { TalentBalancesModule } from './modules/talent-balances/talent-balances.module';
import { FxModule } from './modules/fx/fx.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    HealthModule,
    SourceConnectionsModule,
    CommercialDocumentsModule,
    PaymentOrchestrationModule,
    TalentBalancesModule,
    FxModule,
    AuditLogsModule,
    FeatureFlagsModule,
    LedgerModule,
    TalentModule,
    PaymentModule,
    WebhooksModule,
    ReconciliationModule,
    AuthModule,
    UsersModule,
    VerificationModule,
    IntegrationsModule,
    CrmModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
