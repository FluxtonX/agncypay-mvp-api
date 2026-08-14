import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { InvoicesModule } from './invoices/invoices.module';
import { TransactionsModule } from './transactions/transactions.module';
import { VerificationModule } from './verification/verification.module';
import { TreasuryModule } from './treasury/treasury.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { QuickBooksModule } from './modules/quickbooks/quickbooks.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PayoutsModule } from './payouts/payouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditLogsModule,
    FeatureFlagsModule,
    WalletsModule,
    QuickBooksModule,
    WebhooksModule,
    PayoutsModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    InvoicesModule,
    TransactionsModule,
    VerificationModule,
    TreasuryModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}



