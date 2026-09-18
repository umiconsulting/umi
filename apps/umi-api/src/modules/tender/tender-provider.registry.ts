import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { TenderFamily, TenderProviderList, TenderProviderOption } from '@umi/contract';
import { TENDER_PROVIDER_PORTS, type TenderProviderPort } from './tender-provider.port';

/**
 * WHICH PROVIDERS EXIST, AND WHETHER THIS DEPLOYMENT CAN REACH THEM.
 *
 * This is what makes §8G step 6 true rather than aspirational: a second terminal brand is
 * a new entry in the list, and nothing in checkout, the attempt table or the contract
 * changes. The list is also a READ — `pos.tenderProviders` — so the till can offer a
 * method only when it will work, instead of offering a button that fails after the
 * customer has decided.
 */
@Injectable()
export class TenderProviderRegistry {
  private readonly byId: Map<string, TenderProviderPort>;

  constructor(@Inject(TENDER_PROVIDER_PORTS) providers: TenderProviderPort[]) {
    this.byId = new Map(providers.map((provider) => [provider.id, provider]));
  }

  resolve(id: string): TenderProviderPort | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * The provider, or a typed refusal. `TENDER_PROVIDER_UNAVAILABLE` is deliberately
   * distinct from "no such provider": the operator's sentence is different ("no
   * credentials for the card terminal" versus "this till cannot take that tender"), and
   * the second is our bug rather than a deployment gap.
   */
  require(id: string): TenderProviderPort {
    const provider = this.byId.get(id);
    if (!provider) {
      throw new ConflictException({
        code: 'TENDER_PROVIDER_UNAVAILABLE',
        details: { provider: id, reason: 'not_registered' },
      });
    }
    if (!provider.available) {
      throw new ConflictException({
        code: 'TENDER_PROVIDER_UNAVAILABLE',
        details: { provider: id, reason: provider.unavailableReason ?? 'unavailable' },
      });
    }
    return provider;
  }

  familyOf(id: string | null): TenderFamily | null {
    if (!id) return null;
    return this.byId.get(id)?.family ?? null;
  }

  /**
   * WHICH METHODS THIS CAFÉ CAN ACTUALLY USE (plan D7, D8).
   *
   * The merchant is required, not optional, and that is the whole point of the change: a card
   * reader's answer depends on whose account is behind it, so "which providers exist" and
   * "which of them will work for this café" stopped being the same question the moment the
   * credential became per-merchant (`tender.module.ts`). A provider that has no
   * merchant-specific answer — the drawer, an operator's terminal, a scripted fake — is asked
   * its deployment-level one, which is exactly what it used to be.
   */
  async list(merchantId: string): Promise<TenderProviderList> {
    const providers: TenderProviderOption[] = await Promise.all(
      [...this.byId.values()].map(async (provider) => {
        const availability = provider.availabilityFor
          ? await provider.availabilityFor(merchantId)
          : { available: provider.available, unavailableReason: provider.unavailableReason };
        return { id: provider.id, family: provider.family, ...availability };
      }),
    );
    providers.sort((left, right) => left.id.localeCompare(right.id));
    return { providers };
  }
}
