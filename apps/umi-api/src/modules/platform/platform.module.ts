import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { PlatformWalletController } from './platform-wallet.controller';

/**
 * Routes for a UMI OPERATOR rather than a café — the things that have no
 * merchant in their path because they act across all of them.
 *
 * It lives apart from `WalletModule` on purpose. That module "owns no guard and
 * no RLS context", because Apple's web service authenticates with a token signed
 * into the pass and has no session at all. These routes are the opposite: a
 * person, with a session, holding a platform grant. Putting them there would
 * have made that sentence untrue.
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [PlatformWalletController],
})
export class PlatformModule {}
