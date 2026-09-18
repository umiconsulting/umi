import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { WorkerModule } from './worker.module';

/**
 * DOES THE APPLICATION STILL BOOT?
 *
 * One assertion, and it exists because nothing else in this repository could make it. The
 * unit and contract suites build their subjects by hand — `new TenderService(repo, …)` — so
 * a module that forgets an import is invisible to all of them; the request-level integration
 * suites instantiate the same services directly for the same reason. What is left unproved by
 * every one of them is the thing Nest actually does at startup: resolve the MODULE graph.
 *
 * THAT IS NOT A HYPOTHETICAL. The Mercado Pago Point module registered two controllers whose
 * guards come from `AuthModule`, and did not import it. Every test in the repository passed,
 * `tsc` was clean, and the API could not start at all: Nest answered
 * `Nest can't resolve dependencies of the MerchantAccessGuard` and exited. A failure that
 * takes the whole process down is worth one test that pays for itself the first time a module
 * is added.
 *
 * WHY `createApplicationContext` AND NOT `NestFactory.create`. The question here is the graph,
 * not HTTP, and a context starts every provider the way the server does without binding a
 * port — so this can run beside anything else.
 *
 * IT NEEDS A DATABASE, and nothing more than that: `PgService` opens its pool on module init,
 * so this is an integration test rather than a unit one, and it belongs to the same family and
 * the same command as `smoke.integration.ts`.
 */
describe('the application graph boots', () => {
  it('resolves every module, controller and provider AppModule declares', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    expect(app).toBeTruthy();
    await app.close();
  }, 120_000);

  /**
   * THE WORKER IS A SECOND NEST ROOT, AND IT IS THE ONE THE JOBS LIVE IN.
   *
   * It shares the infrastructure but not the module list: `TenderModule` and
   * `MercadoPagoPointModule` are imported there for the notification job and the D8 renewal
   * sweep, and a provider this file does not exercise could still be missing from that root. The
   * web app booting is therefore NOT evidence that the worker can start, and a scheduler whose
   * dependency cannot be resolved takes the whole worker down at boot rather than at 3 a.m.
   */
  it('resolves the WORKER root too, which is the process the schedulers run in', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    expect(app).toBeTruthy();
    await app.close();
  }, 120_000);
});
