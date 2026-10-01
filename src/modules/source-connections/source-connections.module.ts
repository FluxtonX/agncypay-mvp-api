import { Global, Module } from '@nestjs/common';
import { SourceConnectionsService } from './source-connections.service';

@Global()
@Module({
  providers: [SourceConnectionsService],
  exports: [SourceConnectionsService],
})
export class SourceConnectionsModule {}
