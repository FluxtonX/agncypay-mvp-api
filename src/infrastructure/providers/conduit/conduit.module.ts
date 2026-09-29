import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConduitProvider } from './conduit.provider';

@Module({
  imports: [ConfigModule],
  providers: [ConduitProvider],
  exports: [ConduitProvider],
})
export class ConduitModule {}
