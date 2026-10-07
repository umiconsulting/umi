import {
  cardPolicyFields,
  rewardProfileWithSnapshot,
} from '../../shared/loyalty/reward-policy-presentation';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  WalletPassRepository,
  type AuthenticatedPass,
  type PassRenderData,
} from './wallet-pass.repository';
import { ApplePassBuilder } from './apple-pass.builder';
import { GooglePassService, type GooglePassData } from './google-pass.service';
import { resolveRewardProfile, type RewardProfile } from '../../shared/loyalty/reward-profile';

/** What the customer is called on the pass when the café recorded no name. */
const DEFAULT_CUSTOMER_NAME = 'Cliente';

/**
 * The card's reward profile from the rows the repository read: the café's standard
 * reward (the lower tier a customer may cash out early), its optional upper tier, and
 * this card's own override. One rule, shared with the scan and the register's screens —
 * a pass that resolves a ladder differently from the till is a pass that lies.
 */
function profileOf(data: PassRenderData): RewardProfile {
  const row = (r: PassRenderData['ladder']['standard']) =>
    r && r.stamps_required !== null
      ? {
          id: r.id ?? '',
          visits_required: r.stamps_required,
          reward_name: r.name,
          reward_description: r.description,
        }
      : null;
  return resolveRewardProfile(
    row(data.ladder.standard),
    row(data.ladder.override),
    row(data.ladder.upgrade),
  );
}

/**
 * The lower tier, as both builders take it: the reward a customer may cash out
 * before the cycle completes. Null on a single-reward café, which is every surface
 * that predates the ladder.
 */
function walletBaseReward(profile: RewardProfile) {
  return profile.baseTier
    ? {
        visitsRequired: profile.baseTier.visitsRequired,
        rewardName: profile.baseTier.rewardName,
      }
    : null;
}

@Injectable()
export class WalletPassService {
  private readonly logger = new Logger(WalletPassService.name);

  constructor(
    private readonly repo: WalletPassRepository,
    private readonly builder: ApplePassBuilder,
    private readonly google: GooglePassService,
  ) {}

  isGoogleConfigured(): boolean {
    return this.google.isConfigured();
  }

  /** Where the `/logos/*` brand assets are served from. */
  assetOrigin(): string {
    return this.builder.assetOrigin();
  }

  /** The café's secondary colour, used behind the stamp strip. */
  stripBackgroundForHandle(handle: string): Promise<string | null> {
    return this.repo.secondaryColourForHandle(handle);
  }

  isConfigured(): boolean {
    return this.builder.isConfigured();
  }

  merchantByHandle(handle: string): Promise<{ id: string; name: string } | null> {
    return this.repo.merchantByHandle(handle);
  }

  authenticate(serial: string, token: string): Promise<AuthenticatedPass | null> {
    return this.repo.authenticate(serial, token);
  }

  registerDevice(walletPassId: string, deviceId: string, pushToken: string): Promise<boolean> {
    return this.repo.registerDevice(walletPassId, deviceId, pushToken);
  }

  unregisterDevice(walletPassId: string, deviceId: string): Promise<void> {
    return this.repo.unregisterDevice(walletPassId, deviceId);
  }

  /**
   * The serials this device should re-download, for the merchant in the URL.
   *
   * The handle is resolved here rather than trusted, so a device polling with a
   * handle that no longer exists gets a 404 instead of another café's serials.
   */
  async serialsUpdatedSince(handle: string, deviceId: string, since: Date): Promise<string[]> {
    const merchant = await this.repo.merchantByHandle(handle);
    if (!merchant) throw new NotFoundException();
    return this.repo.serialsUpdatedSince(merchant.id, deviceId, since);
  }

  /**
   * Issue the signed-in customer's pass, creating it on first download.
   *
   * The serial and token are generated BEFORE the upsert and then discarded if a
   * pass already exists — see `findOrCreateApplePass`. Generating them eagerly
   * costs two random values and keeps the whole operation one round trip, which
   * matters because this runs while the customer waits at the Add-to-Wallet tap.
   */
  async issuePass(merchantId: string, customerId: string): Promise<RenderedPass> {
    const cardId = await this.repo.cardForCustomer(merchantId, customerId);
    if (!cardId) throw new NotFoundException('card_not_found');

    const pass = await this.repo.findOrCreateApplePass(
      cardId,
      this.builder.newSerial(),
      this.builder.newAuthToken(),
    );

    return this.renderPass({
      walletPassId: pass.walletPassId,
      cardId,
      merchantId,
      serialNumber: pass.serialNumber,
      webServiceToken: pass.webServiceToken,
      cardUpdatedAt: new Date(),
    });
  }

  /** The "Add to Google Wallet" link for the signed-in customer's card. */
  async googleSaveUrl(merchantId: string, customerId: string): Promise<string> {
    const cardId = await this.repo.cardForCustomer(merchantId, customerId);
    if (!cardId) throw new NotFoundException('card_not_found');
    // If she already has the object, the save link must carry ITS id — otherwise
    // tapping "add to Wallet" a second time mints a duplicate pass beside the one she
    // already holds, and the duplicate is the one that gets updated from then on.
    //
    // ⚠️ THE ROW IS WRITTEN HERE, because this is the only moment that knows an object
    // is being created. The legacy route did exactly this (`if (!existingPass)
    // prisma.passes.create(...)`) and the port dropped it — so a customer who added her
    // Android pass after the Wallet switch had no row, and every later refresh, per-write
    // and café-wide, skipped her. Her pass simply froze at whatever it showed the day she
    // saved it. A row marked `removed` means the object is gone, so it gets a fresh id.
    const existing = await this.repo.googleRowForCard(cardId);
    const objectId =
      existing?.status === 'active' && existing.objectId
        ? existing.objectId
        : this.google.objectIdFor(cardId);
    await this.repo.upsertGoogleObject(cardId, objectId);
    const data = await this.googlePassData(merchantId, cardId, objectId);
    return this.google.saveUrl(data);
  }

  /**
   * Push the current card state into the object already in the wallet.
   *
   * Google is push-only. There is no callback and no web service, so this
   * service makes a PATCH. If the PATCH does not occur, the Android pass keeps
   * the stamp count of yesterday and shows no error.
   */
  async refreshGoogleObject(cardId: string): Promise<void> {
    if (!this.google.isConfigured()) return;
    const merchantId = await this.repo.merchantForCard(cardId);
    if (!merchantId) return;
    // No Android pass → nothing to patch. Refreshing anyway produced a 404 per write
    // for the ~1 850 cards whose customer never added one.
    const objectId = await this.repo.googleObjectForCard(cardId);
    if (!objectId) return;
    const data = await this.googlePassData(merchantId, cardId, objectId).catch(() => null);
    if (data) await this.google.updateObject(data);
  }

  /**
   * Refresh every Android pass at one café — the other half of the register's
   * "Actualizar pases", and the half that did not exist.
   *
   * It matters today rather than in principle: the Android objects have been stale
   * since the Wallet switch (every refresh 404'd on an invented id), so 155 customers
   * are looking at numbers from before the cutover, and until this runs the only way
   * their pass catches up is a transaction.
   */
  async refreshMerchantGoogleObjects(
    merchantId: string,
  ): Promise<{ total: number; refreshed: number; missing: number; failed: number }> {
    const entries = await this.repo.googleObjectsForMerchant(merchantId);
    return this.google.refreshMerchantObjects(entries, async (cardId, objectId) => {
      const data = await this.googlePassData(merchantId, cardId, objectId).catch(() => null);
      if (!data) return 'failed';
      const outcome = await this.google.updateObject(data);
      // Google does not have this object. Marking the row `removed` is what the status
      // is for, and it stops every future walk from counting a 404 as an outage — 19
      // rows did that on each refresh, for objects that were never there to update.
      if (outcome === 'missing') await this.repo.markGoogleObjectRemoved(cardId);
      return outcome;
    });
  }

  private async googlePassData(
    merchantId: string,
    cardId: string,
    objectId: string | null,
  ): Promise<GooglePassData> {
    const d = await this.repo.renderData(merchantId, cardId);
    if (!d) throw new NotFoundException('card_not_found');
    const profile = rewardProfileWithSnapshot(profileOf(d), d.state);
    return {
      cardId,
      cardNumber: d.cardNumber,
      customerName: d.customerName ?? DEFAULT_CUSTOMER_NAME,
      merchantName: d.merchantName,
      merchantHandle: d.merchantHandle,
      balanceCentavos: d.state.balance_cents,
      visitsThisCycle: d.state.visits_this_cycle,
      pendingRewards: d.state.pending_rewards,
      totalVisits: d.state.total_visits,
      // THE CYCLE'S values, from the resolved profile — not the standard row's. On a
      // ladder the cycle runs to the UPPER tier, and a pass that draws 9 slots while
      // naming the lower reward (or vice versa) is how the ladder disappeared from
      // the customer's phone in the first place.
      visitsRequired: profile.visitsRequired,
      rewardName: profile.rewardName,
      baseReward: walletBaseReward(profile),
      pendingTier1: d.state.pending_tier1,
      ...cardPolicyFields(d.state),
      // Both builders read this. Drop it here and the reward line
      // disappears from the pass, with no error anywhere.
      birthdayRewardName: d.birthdayRewardName,
      // The id the object already has. Patching the constructed one 404s.
      objectId,
      memberSince: d.memberSince,
      topupEnabled: d.topupEnabled,
      lifecycleMessage: d.lifecycleMessage,
      lifecycleMessageAt: d.lifecycleMessageAt,
    };
  }

  /**
   * Rebuild and re-sign one pass.
   *
   * Nothing pre-signed is stored anywhere: every request produces a fresh
   * `.pkpass`. That is why rotating the signing certificate never disturbed an
   * installed pass, and it is also why every render must reproduce the same
   * field keys — see the builder's comment.
   */
  async renderPass(pass: AuthenticatedPass): Promise<RenderedPass> {
    const data = await this.repo.renderData(pass.merchantId, pass.cardId);
    if (!data) throw new NotFoundException();
    const profile = rewardProfileWithSnapshot(profileOf(data), data.state);

    const buffer = await this.builder.build({
      serial: pass.serialNumber,
      // The SAME token the caller just presented, signed back in. See the note on
      // AuthenticatedPass.webServiceToken: a new token here breaks every pass.
      authToken: pass.webServiceToken,
      cardNumber: data.cardNumber,
      customerName: data.customerName ?? DEFAULT_CUSTOMER_NAME,
      merchantName: data.merchantName,
      merchantHandle: data.merchantHandle,
      balanceCentavos: data.state.balance_cents,
      visitsThisCycle: data.state.visits_this_cycle,
      visitsRequired: profile.visitsRequired,
      totalVisits: data.state.total_visits,
      rewardName: profile.rewardName,
      baseReward: walletBaseReward(profile),
      pendingTier1: data.state.pending_tier1,
      ...cardPolicyFields(data.state),
      birthdayRewardName: data.birthdayRewardName,
      passStyle: data.passStyle,
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      logoUrl: data.logoUrl,
      stripImageUrl: data.stripImageUrl,
      promoMessage: data.promoMessage,
      lifecycleMessage: data.lifecycleMessage,
      topupEnabled: data.topupEnabled,
      locations: data.locations,
    });

    return {
      buffer,
      lastModified: data.cardUpdatedAt,
      handle: data.merchantHandle ?? 'umi',
    };
  }
}

export interface RenderedPass {
  buffer: Buffer;
  lastModified: Date;
  /** Used only for the download filename. */
  handle: string;
}
