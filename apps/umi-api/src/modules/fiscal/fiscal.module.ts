import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FiscalController } from './fiscal.controller';
import { FISCAL_PAC_PORT } from './fiscal-pac.port';
import { FiscalRepository } from './fiscal.repository';
import { FiscalService } from './fiscal.service';
import { FacturapiPacProvider } from './providers/facturapi-pac.provider';
import { ScriptedPacProvider } from './providers/scripted-pac.provider';

/**
 * The fiscal record (plan §8G step 5).
 *
 * ONE PAC, CHOSEN AT BOOT. `FISCAL_PAC_PORT` is a factory, not a class: which PAC a
 * deployment talks to is configuration, exactly as which terminal a till uses is. The
 * facts it needs live in `ConfigService` (`FACTURAPI_USER_KEY` and
 * `FACTURAPI_ORGANIZATION_SECRET`), and when either is missing the port reports itself
 * unavailable with a sentence naming the variable rather than failing at the counter.
 *
 * THE SCRIPTED PAC IS REGISTERED ONLY WHEN `TENDER_SCRIPTED_PROVIDERS` IS ON — and it
 * is CONDITIONALLY PROVIDED rather than conditionally SELECTED, so a deployment that
 * takes real money has no instance of the fake in its container at all. It is the
 * acceptance suite's instrument (§8G step 7): a PAC that can be made to refuse on
 * demand is how "a PAC refusal leaves the document in error" is provable without a
 * merchant account, and the fake's call counts are how "the PAC was asked exactly once"
 * is a fact rather than a reading.
 *
 * `FiscalService` is exported because `pos.saleCancel` calls `cancelForSale` inside its
 * own transaction, and `FISCAL_PAC_PORT` because a future fiscal job (the period
 * roll-up) will need the same PAC.
 */

/** The flag as the config schema reads it: the same four spellings, and no coercion. */
const scriptedProvidersEnabled = (raw: string | undefined): boolean =>
  raw !== undefined && ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase().trim());

const scripted: Provider[] = scriptedProvidersEnabled(process.env.TENDER_SCRIPTED_PROVIDERS)
  ? [ScriptedPacProvider]
  : [];

@Module({
  imports: [AuthModule],
  controllers: [FiscalController],
  providers: [
    FiscalRepository,
    FiscalService,
    FacturapiPacProvider,
    ...scripted,
    {
      provide: FISCAL_PAC_PORT,
      inject: [
        ConfigService,
        FacturapiPacProvider,
        // Optional, so this module boots in a deployment that holds no fake at all.
        { token: ScriptedPacProvider, optional: true },
      ],
      useFactory: (
        config: ConfigService,
        facturapi: FacturapiPacProvider,
        scriptedPac: ScriptedPacProvider | null,
      ) => {
        const enabled = config.get('TENDER_SCRIPTED_PROVIDERS', { infer: true });
        return enabled && scriptedPac ? scriptedPac : facturapi;
      },
    },
  ],
  exports: [FiscalService, FISCAL_PAC_PORT],
})
export class FiscalModule {}
