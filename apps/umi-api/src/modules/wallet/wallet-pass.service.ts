import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WalletPassRepository, type AuthenticatedPass } from './wallet-pass.repository';
import { ApplePassBuilder } from './apple-pass.builder';
import { GooglePassService, type GooglePassData } from './google-pass.service';

/** What the customer is called on the pass when the café recorded no name. */
const DEFAULT_CUSTOMER_NAME = 'Cliente';
/** The stamps threshold used when a café has published no reward. */
const DEFAULT_REWARD_NAME = 'Recompensa';

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
    const data = await this.googlePassData(merchantId, cardId);
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
    const data = await this.googlePassData(merchantId, cardId).catch(() => null);
    if (data) await this.google.updateObject(data);
  }

  private async googlePassData(merchantId: string, cardId: string): Promise<GooglePassData> {
    const d = await this.repo.renderData(merchantId, cardId);
    if (!d) throw new NotFoundException('card_not_found');
    return {
      cardId,
      cardNumber: d.cardNumber,
      customerName: d.customerName ?? DEFAULT_CUSTOMER_NAME,
      merchantName: d.merchantName,
      merchantHandle: d.merchantHandle,
      balanceCentavos: d.state.balance_cents,
      visitsThisCycle: d.state.visits_this_cycle,
      visitsRequired: d.state.visits_required,
      pendingRewards: d.state.pending_rewards,
      totalVisits: d.state.total_visits,
      rewardName: d.rewardName ?? DEFAULT_REWARD_NAME,
      // Both builders read this. Drop it here and the reward line
      // disappears from the pass, with no error anywhere.
      birthdayRewardName: d.birthdayRewardName,
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
      visitsRequired: data.state.visits_required,
      totalVisits: data.state.total_visits,
      rewardName: data.rewardName ?? DEFAULT_REWARD_NAME,
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
