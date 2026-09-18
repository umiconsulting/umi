import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { MercadoPagoPointModule } from '../mercado-pago/mercadopago-point.module';
import { PointCredentialRepository } from '../mercado-pago/point-credential.repository';
import { PosCheckoutModule } from '../pos-checkout/pos-checkout.module';
import { OperationsModule } from '../../shared/operations/operations.module';
import { UnconfiguredPointTransport, type PointTransport } from './point-transport.port';
import { MercadoPagoPointProvider } from './providers/mercado-pago-point.provider';
import { MercadoPagoPointTransport } from './providers/mercado-pago-point.transport';
import { CashProvider } from './providers/cash.provider';
import { ManualTerminalProvider } from './providers/manual-terminal.provider';
import { ScriptedTerminalProvider } from './providers/scripted-terminal.provider';
import { TenderController } from './tender.controller';
import { TENDER_PROVIDER_PORTS, type TenderProviderPort } from './tender-provider.port';
import { TenderProviderRegistry } from './tender-provider.registry';
import { TenderRepository } from './tender.repository';
import { TenderService } from './tender.service';
import { PointAttemptHealthService } from './point-attempt-health.service';

/**
 * The provider registry is built ONCE, from config, and it is the only place a provider
 * is chosen. Two decisions live here and nowhere else.
 *
 * THE LIVE TERMINAL TRANSPORT IS NOW WRITTEN (`providers/mercado-pago-point.transport.ts`,
 * plan §4 phase 1), so the only thing that decides whether card-present exists is the
 * CONFIGURATION. With both credentials present this builds the live transport; with either
 * missing it builds `UnconfiguredPointTransport` — the provider stays registered,
 * `available` is false, and the reason names exactly what is missing, so
 * `pos.tenderProviders` lets the till offer only the methods that will work. A button that
 * fails after the customer has already decided is worse than no button.
 *
 * THE SCRIPTED PROVIDERS ARE BEHIND A FLAG. They are the instrument §8G step 7 needs
 * (success, failure, silence, and an answer that exists only on the query), and they must
 * never be reachable in a deployment that takes real money, so they are registered only
 * when `TENDER_SCRIPTED_PROVIDERS` is on. The integration suite turns it on; the example
 * file says it is for tests.
 */
export const buildTenderProviders = (
  config: ConfigService<AppConfig, true>,
  credentials: PointCredentialRepository,
): TenderProviderPort[] => {
  const accessToken = config.get('MERCADO_PAGO_POINT_ACCESS_TOKEN', { infer: true });
  const terminalId = config.get('MERCADO_PAGO_POINT_TERMINAL_ID', { infer: true });

  // THE DEVICE IS THE DEPLOYMENT'S; THE ACCOUNT IS THE MERCHANT'S (D7).
  //
  // Before Phase 5 both credentials narrowed together: a token without a terminal id could
  // not address a device, and a terminal id without a token had no account behind it. The
  // second half of that is no longer true. The register this deployment owns is still
  // required — there is no device to address without it — but the TOKEN now comes from the
  // merchant the order is for, resolved per request, and the deployment token is only the
  // "own account" mode the earlier phases ran in. A café that has connected its own account
  // charges through that account even when the deployment has no token of its own.
  const pointTransport: PointTransport = terminalId
    ? new MercadoPagoPointTransport({
        accessToken,
        accessTokenFor: async (merchantId: string) =>
          (await credentials.readForMerchant(merchantId))?.accessToken ?? null,
        terminalId,
        // The origin is overridable so a test can point the transport at a stub; a
        // deployment leaves it at the vendor's host (config.schema.ts).
        baseUrl: config.get('MERCADO_PAGO_POINT_API_BASE_URL', { infer: true }),
      })
    : new UnconfiguredPointTransport(
        'The card terminal is not configured in this deployment: missing MERCADO_PAGO_POINT_TERMINAL_ID.',
      );

  const providers: TenderProviderPort[] = [
    new CashProvider(),
    new ManualTerminalProvider(),
    new MercadoPagoPointProvider(pointTransport),
  ];

  if (config.get('TENDER_SCRIPTED_PROVIDERS', { infer: true })) {
    providers.push(
      new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']),
      new ScriptedTerminalProvider('scripted_card_not_present', ['succeed'], 'card_not_present'),
    );
  }
  return providers;
};

@Module({
  /**
   * `OperationsModule` IS IMPORTED EXPLICITLY, and not because it is not `@Global()`.
   *
   * A global module's exports reach a module graph only once that module is registered in the root
   * that is being bootstrapped. The API root imports it; the WORKER root does not — it has no
   * controllers, so nothing in it had ever needed the metric registry before §7 item 3's counter
   * arrived, and the counter is provided here and called by the worker's `SystemProcessor`. Naming
   * the dependency at the module that uses it is what makes this module's graph complete in both
   * roots instead of in one. The boot probe is what found it: `Nest can't resolve dependencies of
   * the PointAttemptHealthService (TenderRepository, ?)`.
   */
  imports: [
    AuthModule,
    IntegrityModule,
    MercadoPagoPointModule,
    OperationsModule,
    PosCheckoutModule,
  ],
  controllers: [TenderController],
  providers: [
    TenderRepository,
    TenderService,
    TenderProviderRegistry,
    {
      provide: TENDER_PROVIDER_PORTS,
      inject: [ConfigService, PointCredentialRepository],
      useFactory: buildTenderProviders,
    },
    // §7 item 3's counter. PROVIDED here because its caller is the worker's `SystemProcessor`, and
    // EXPORTED for the same reason: the job that owns the clock lives outside this module.
    PointAttemptHealthService,
  ],
  exports: [
    TenderService,
    TenderProviderRegistry,
    TENDER_PROVIDER_PORTS,
    PointAttemptHealthService,
  ],
})
export class TenderModule {}
