import { Global, Module } from '@nestjs/common';
import { ReleaseIdentityService } from './release-identity.service';

@Global()
@Module({
  providers: [ReleaseIdentityService],
  exports: [ReleaseIdentityService],
})
export class ReleaseModule {}
