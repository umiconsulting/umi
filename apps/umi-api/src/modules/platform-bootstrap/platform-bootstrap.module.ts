import { Module } from '@nestjs/common';
import { PlatformBootstrapController } from './platform-bootstrap.controller';
import { PlatformBootstrapRepository } from './platform-bootstrap.repository';
import { PlatformBootstrapService } from './platform-bootstrap.service';

@Module({
  controllers: [PlatformBootstrapController],
  providers: [PlatformBootstrapRepository, PlatformBootstrapService],
})
export class PlatformBootstrapModule {}
