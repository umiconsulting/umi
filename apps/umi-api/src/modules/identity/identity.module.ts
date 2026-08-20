import { Global, Module } from '@nestjs/common';
import { IdentityResolver } from './identity.resolver';

/**
 * The federated identity resolver (tenant.contact / contact_identity / customer).
 * @Global + exported so any module — cash, conversations, customers, lifecycle,
 * kds — injects IdentityResolver without importing this module. PgService is
 * itself @Global, so no imports are needed here.
 */
@Global()
@Module({
  providers: [IdentityResolver],
  exports: [IdentityResolver],
})
export class IdentityModule {}
