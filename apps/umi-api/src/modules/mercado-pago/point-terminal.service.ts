import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PointOperatingMode,
  PointStore,
  PointStoreCreateRequest,
  PointTerminal,
  PointTerminalBindRequest,
  PointTerminalList,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { resolveLocationAuthority } from '../auth/location-authority';
import type { MerchantAccess } from '../auth/auth.types';
import { PointCredentialRepository, type PointCredential } from './point-credential.repository';
import {
  PointTerminalClient,
  PointTerminalClientError,
  type VendorOperatingMode,
  type VendorTerminal,
} from './point-terminal.client';
import { PointTerminalRepository, type PointTerminalBinding } from './point-terminal.repository';

/**
 * THE `/devices` TERMINAL CONFIGURATION — plan section 4 phase 5 steps 3 and 4.
 *
 * THE SCREEN'S ONE SENTENCE. "The list is the vendor's, enriched by ours." A terminal we have a
 * row for but the account no longer lists is NOT on the screen, and a terminal the account lists
 * but we have never bound IS — as an unbound row waiting for a register. Everything in `list`
 * follows from that rule, and it is why the merge is a projection over the VENDOR's array rather
 * than over our table.
 *
 * THREE REFUSALS, EACH NAMING ITS OWN PROBLEM, checked cheapest first and none of them a 500:
 *
 *   1. MERCHANT_SCOPE_MISMATCH and LOCATION_REQUIRED — the caller's own membership, before
 *      anything leaves the process. The guard already checked the merchant; this states the
 *      location the write is scoped to, and it refuses rather than defaulting, because a
 *      terminal bound at a branch the operator did not name is a terminal in the wrong place.
 *   2. MP_POINT_CREDENTIAL_ABSENT — the cafe has not connected its own Mercado Pago account
 *      (plan D7). There is no account to ask about terminals, so there is no list and no
 *      binding; the console reads this code and sends the owner through the OAuth flow. It is a
 *      409 with a name, never a 500 and never an empty screen.
 *   3. MP_POINT_TERMINAL_UNKNOWN — the account's own GET /terminals/v1/list does not name this
 *      terminal. Binding a terminal the cafe does not own is the one thing this route must not
 *      allow, and that list is the only authority for ownership.
 *
 * STEP 4 LIVES IN `bind`, AND IT IS HONEST ABOUT WHAT IT CANNOT DO. The plan's step 4 is "create
 * the store and the point of sale per merchant, with that merchant's token", and the two halves
 * are not equally possible today:
 *
 *   - THE POINT OF SALE IS CREATED when the terminal is in PDV mode, has a store, and has no
 *     point of sale yet. The vendor's 403 store_pos_not_found is precisely "the terminal has no
 *     store or no point of sale created" (note 01 section 5.3), and creating the POS clears it.
 *     One per terminal, its external_id derived from the register's own id.
 *   - THE STORE IS NOT CREATED HERE, and that is a decision rather than an omission. The
 *     vendor's store carries the ADDRESS and validates the city against a closed catalogue with
 *     accents (note 01 section 6.2), and it says in its own words that wrong data "can cause
 *     errors in tax calculations". PointTerminalBindRequest carries a register and a location,
 *     not a street, a catalogued city and coordinates, so this service has nothing truthful to
 *     send and would be inventing a fiscal address. What it does instead is take the store id
 *     the ACCOUNT already reports for that terminal — what a seller who paired the terminal in
 *     the Mercado Pago app has (note 08 section 3.2) — and, when there is none, refuse with
 *     MP_POINT_STORE_REQUIRED naming the terminal, so the console can tell a person to attach a
 *     store rather than show a mode switch that cannot work. PointTerminalClient.createStore is
 *     written and shaped for the day the console collects an address; it has no caller today,
 *     and that is stated rather than implied.
 *
 * NOTHING HERE RETURNS A TOKEN. The credential is read, handed to one vendor call, and dropped;
 * responses are built field by field out of the contract's own model, so a value the vendor adds
 * to an answer cannot ride into a response by being spread.
 */
@Injectable()
export class PointTerminalService {
  private readonly logger = new Logger(PointTerminalService.name);
  private readonly client: PointTerminalClient;

  constructor(
    private readonly credentials: PointCredentialRepository,
    private readonly terminals: PointTerminalRepository,
    config: ConfigService<AppConfig, true>,
  ) {
    // The origin is overridable so a test can point these calls at a stub; a deployment leaves
    // it at the vendor's host (config.schema.ts, MERCADO_PAGO_POINT_API_BASE_URL).
    this.client = new PointTerminalClient({
      baseUrl: config.get('MERCADO_PAGO_POINT_API_BASE_URL', { infer: true }),
    });
  }

  /**
   * THE TERMINALS OF THIS CAFE'S ACCOUNT, each with the register we bound it to.
   *
   * THE PROJECTION RUNS OVER THE VENDOR'S ARRAY, which is the whole of the "must not linger"
   * rule: one of our rows whose terminal the account no longer lists has no entry to be joined
   * onto and therefore no way onto the screen, without a delete and without a filter that could
   * be forgotten. The rows we do hold are looked up by terminal id and joined field by field.
   *
   * WHAT WINS WHEN THE TWO DISAGREE, stated once: the VENDOR wins on existence, on the operating
   * mode and on the store and point of sale the terminal sits on, because those are facts about
   * the merchant's account; WE fill in which register of which location holds it, because that is
   * ours. The one fallback is operating_mode = UNDEFINED — "the configuration that the terminal
   * has is not recognized" (note 01 section 5.3) — where the mode we last confirmed is more
   * useful than the vendor's non-answer, and where an unbound terminal gets STANDALONE because
   * that IS the vendor's documented name for a terminal nobody has put into API mode. The
   * contract's PointOperatingMode has two values and no third, so the unknown one has to land
   * somewhere, and this comment says where.
   */
  async list(access: MerchantAccess, merchantId: string): Promise<PointTerminalList> {
    const merchant = this.scope(access, merchantId, null);
    const credential = await this.requireCredential(merchantId);
    const vendorTerminals = await this.vendor(() =>
      this.client.listTerminals(credential.accessToken),
    );
    const bindings = await this.terminals.list(merchantId, merchant);
    const byTerminal = new Map(bindings.map((binding) => [binding.terminalId, binding]));

    const terminals = vendorTerminals.map((terminal) => {
      const binding = byTerminal.get(terminal.terminalId) ?? null;
      return {
        terminalId: terminal.terminalId,
        operatingMode: this.mergeMode(terminal.operatingMode, binding),
        deviceId: binding?.deviceId ?? null,
        locationId: binding?.locationId ?? null,
        storeId: terminal.storeId ?? binding?.storeId ?? null,
        posId: terminal.posId ?? binding?.posId ?? null,
      };
    });

    // The vendor's page ceiling and the contract's array ceiling are both fifty, so this slice
    // guards a value that arrives from outside rather than expressing a pagination policy: a
    // response that broke its own schema would be a worse answer than a short one.
    return { terminals: terminals.slice(0, 50) };
  }

  /**
   * CREATE THE CAFÉ'S STORE — Phase 5 step 4's first half, and the only call on this surface
   * whose input a PERSON must supply.
   *
   * WHY IT IS A SEPARATE ROUTE AND NOT SOMETHING BINDING DOES QUIETLY. The vendor requires a store
   * before a point of sale, and it validates the address against a closed catalogue of accented
   * city names, refusing the ones it does not know (note 01 §6.2). An address is therefore either
   * something an operator typed or something a program invented, and the second one lands in a
   * fiscal record — the vendor's own words: incorrect location data "can cause errors in tax
   * calculations, directly impacting billing and fiscal compliance". So the address is a request
   * of its own, made once, by a person who knows the counter it belongs to.
   *
   * IT USES THE CAFÉ'S OWN ACCOUNT TWICE OVER: the token that authenticates the call, and the
   * `mp_user_id` in the path. The vendor's own refusal for a mismatch says so — "make sure that
   * the user_id used is the same as your account" — and a store created under the wrong account
   * is this café's income reconciling into someone else's books.
   *
   * THE ID WE PROPOSE IS DERIVED FROM THE MERCHANT, so a retry proposes the same one and the
   * vendor's uniqueness rule turns a second attempt into a refusal rather than a second store.
   * That refusal is the honest answer, and it comes back with the vendor's own code on it.
   */
  async createStore(
    access: MerchantAccess,
    merchantId: string,
    dto: PointStoreCreateRequest,
  ): Promise<PointStore> {
    this.scope(access, merchantId, null);
    const credential = await this.requireCredential(merchantId);
    const externalId = pointStoreExternalId(merchantId);

    const created = await this.vendor(
      () =>
        this.client.createStore(credential.accessToken, {
          userId: credential.mpUserId,
          name: dto.name,
          externalId,
          location: {
            streetName: dto.streetName,
            streetNumber: dto.streetNumber,
            cityName: dto.cityName,
            stateName: dto.stateName,
            latitude: dto.latitude,
            longitude: dto.longitude,
            reference: dto.reference,
          },
        }),
      'store',
    );

    this.logger.log(
      `mercado_pago_point_store_created merchant=${merchantId} store=${created.storeId}`,
    );
    return { storeId: created.storeId, name: dto.name, externalId };
  }

  /**
   * BIND ONE TERMINAL TO ONE REGISTER — phase 5 step 3's write, and step 4's point of sale.
   *
   * THE ORDER OF THE FOUR THINGS THAT CAN REFUSE is the order of their cost: the caller's
   * membership, the credential, the vendor's list, then the vendor's own setup call. Nothing is
   * written to our table before the account has answered, and nothing is written at all if the
   * account refuses — a row that says PDV for a terminal the vendor refused to configure would
   * be a screen lying about the counter.
   *
   * THE PATH AND THE BODY MUST NAME THE SAME TERMINAL. The route carries the terminal in its
   * path and the contract's body carries it again; two places for one value is one place to
   * disagree, so a mismatch is refused as a validation failure rather than resolved in favour of
   * either. The vendor's list then decides whether that terminal exists at all.
   */
  async bind(
    access: MerchantAccess,
    merchantId: string,
    terminalId: string,
    dto: PointTerminalBindRequest,
  ): Promise<PointTerminal> {
    if (dto.terminalId !== terminalId) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', field: 'terminalId' });
    }
    const locationId = this.writeLocation(access, merchantId, dto.locationId);
    const credential = await this.requireCredential(merchantId);

    const vendorTerminals = await this.vendor(() =>
      this.client.listTerminals(credential.accessToken),
    );
    const vendorTerminal = vendorTerminals.find((t) => t.terminalId === terminalId) ?? null;
    if (vendorTerminal === null) throw this.unknownTerminal(terminalId, merchantId);

    // The row this merchant already holds for the terminal, wherever it sits: binding a terminal
    // that serves another register of the same cafe is a MOVE, and the point of sale belongs to
    // the terminal rather than to the branch it happens to sit at today.
    const existing = await this.terminals.find(merchantId, terminalId);
    const storeId =
      vendorTerminal.storeId ??
      existing?.storeId ??
      (await this.terminals.merchantStoreId(merchantId));
    const posId = await this.resolvePointOfSale(credential, dto, vendorTerminal, existing, storeId);

    // The mode is set BEFORE the row is written, so the row can only state a mode the account
    // confirmed: `setOperatingMode` returns the vendor's own echo of it.
    const operatingMode = await this.vendor(() =>
      this.client.setOperatingMode(credential.accessToken, {
        terminalId,
        operatingMode: dto.operatingMode,
      }),
    );
    const binding = await this.terminals.bind({
      merchantId,
      locationId,
      deviceId: dto.deviceId,
      terminalId,
      storeId,
      posId,
      operatingMode,
    });

    this.logger.log(
      `mercado_pago_point_terminal_bound merchant=${merchantId} terminal=${terminalId} device=${dto.deviceId} mode=${operatingMode} pos=${posId ?? '-'}`,
    );
    return this.toTerminal(binding, vendorTerminal);
  }

  /**
   * RELEASE THIS CAFE'S CLAIM ON ONE TERMINAL — phase 5 step 3's other half.
   *
   * IDEMPOTENT, AND THE ANSWER SAYS WHAT WAS THERE. The vendor's list still has to name the
   * terminal: unbinding a device the account has never heard of is the same mistake as binding
   * one, and answering "done" for a terminal that does not exist would be a screen agreeing with
   * a typo. What was released is returned as an unbound terminal, so the caller still sees the
   * store and point of sale the binding carried even though our row is gone.
   *
   * THE ACCOUNT'S OPERATING MODE IS NOT TOUCHED. Whether a terminal is in PDV belongs to the
   * merchant's account, not to one register's screen; switching the counter's mode because a
   * register stopped offering the card method would be a change nobody asked for, on a device
   * sitting in front of customers.
   */
  async unbind(
    access: MerchantAccess,
    merchantId: string,
    terminalId: string,
  ): Promise<PointTerminal> {
    this.scope(access, merchantId, null);
    const credential = await this.requireCredential(merchantId);
    const vendorTerminals = await this.vendor(() =>
      this.client.listTerminals(credential.accessToken),
    );
    const vendorTerminal = vendorTerminals.find((t) => t.terminalId === terminalId) ?? null;
    if (vendorTerminal === null) throw this.unknownTerminal(terminalId, merchantId);

    const released = await this.terminals.unbind(merchantId, terminalId);
    return {
      terminalId,
      operatingMode: this.mergeMode(vendorTerminal.operatingMode, released),
      deviceId: null,
      locationId: null,
      storeId: vendorTerminal.storeId ?? released?.storeId ?? null,
      posId: vendorTerminal.posId ?? released?.posId ?? null,
    };
  }

  /**
   * THE POINT OF SALE A PDV TERMINAL NEEDS, or null in STANDALONE — step 4's second half, and
   * the one place this service creates something at the vendor.
   *
   * WHAT IS REUSED BEFORE ANYTHING IS CREATED. A point of sale already reported by the account
   * for this terminal, then the one our own row for this terminal remembers. Only when both are
   * absent is a new one created, because a second point of sale for one terminal is the vendor's
   * 412 ("each point of sale allows only one associated terminal in POS mode", note 01 section
   * 5.3) and, before that, a second pos_id we would have to explain.
   *
   * STANDALONE CREATES NOTHING, BUT IT STILL RECORDS. A person drives the terminal in that mode
   * and the vendor documents no point of sale for it, so nothing is required and nothing is
   * asked for — which matters, because the mode switch has to be available to a cafe whose
   * account has no POS yet, exactly the cafe troubleshooting a broken order flow (note 01
   * section 5.2's documented workaround is to switch to STANDALONE and switch back when the
   * service is restored). What the account DOES report is still stored: switching a terminal to
   * STANDALONE does not delete its point of sale, and a row that forgot the id would make the
   * next switch back to PDV create a second one, which is the vendor's 412.
   *
   * AND PDV WITHOUT A STORE IS NAMED, NOT GUESSED — see the class comment for why the address
   * the store needs is not ours to invent.
   */
  private async resolvePointOfSale(
    credential: PointCredential,
    dto: PointTerminalBindRequest,
    vendorTerminal: VendorTerminal,
    existing: PointTerminalBinding | null,
    storeId: string | null,
  ): Promise<string | null> {
    const known = vendorTerminal.posId ?? existing?.posId ?? null;
    if (dto.operatingMode !== 'PDV') return known;
    if (known !== null) return known;

    if (storeId === null) {
      this.logger.warn(
        `mercado_pago_point_store_required terminal=${dto.terminalId}: the account lists no store for this terminal and we hold none, so a point of sale cannot be created`,
      );
      throw new ConflictException({
        code: 'MP_POINT_STORE_REQUIRED',
        details: { terminalId: dto.terminalId },
      });
    }

    const created = await this.vendor(() =>
      this.client.createPointOfSale(credential.accessToken, {
        storeId,
        // The vendor allows alphanumerics only, forty characters; a canonical UUID is neither.
        // The register's own id with its hyphens removed is the derivation note 01 section 6.3
        // calls for, and it is what makes the vendor's pos_already_exists recoverable.
        externalId: dto.deviceId.replace(/-/gu, ''),
        // The idempotency name is the register and the terminal, so a retry of THIS bind reuses
        // one vendor key rather than creating a second point of sale (plan D3's rule, applied to
        // the one other endpoint that takes a key).
        idempotencyName: `${dto.deviceId}:${dto.terminalId}`,
      }),
    );
    return created.posId;
  }

  /**
   * THE CREDENTIAL, OR THE NAMED REFUSAL THAT SAYS THERE IS NONE (plan D7).
   *
   * readForMerchant returns the DECRYPTED token or null, and null here means the cafe has not
   * authorized Umi — or authorized under a row whose cipher is empty, which the migration says
   * is the same thing: the phases that charge through the deployment token leave both `_cipher`
   * columns NULL. Either way there is no account to ask, and the console's answer is the OAuth
   * flow rather than a list of nobody's terminals.
   */
  private async requireCredential(merchantId: string): Promise<PointCredential> {
    const credential = await this.credentials.readForMerchant(merchantId);
    if (credential === null) {
      throw new ConflictException({ code: 'MP_POINT_CREDENTIAL_ABSENT' });
    }
    return credential;
  }

  /**
   * THE MERCHANT AND THE LOCATION THIS CALL MAY ACT ON. The path carries the merchant id and
   * MerchantAccessGuard has already checked the caller's membership against it; comparing them
   * here is what makes the id used for every statement below the MEMBERSHIP's rather than the
   * path's, so a typed merchant id cannot become somebody else's scope.
   *
   * resolveLocationAuthority is the repo's own answer for "may this session act at that branch":
   * it returns the location to scope by and refuses a session pinned to another one. `bind`
   * passes the body's location; the two reads pass null, because a terminal list is a
   * merchant-level fact that the RLS policy narrows for whoever is pinned to one branch.
   */
  private scope(
    access: MerchantAccess,
    merchantId: string,
    locationId: string | null,
  ): string | null {
    if (access.merchantId !== merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_SCOPE_MISMATCH' });
    }
    return resolveLocationAuthority(access, locationId);
  }

  /**
   * THE LOCATION A WRITE IS SCOPED TO, which `bind` cannot do without: the write names a register
   * and a register belongs to a branch. The route declares LOCATION_REQUIRED, so a session that
   * resolves to no location at all is refused with that name rather than defaulted to the
   * merchant's first branch — a terminal bound at a branch nobody named is a terminal in the
   * wrong place, and "we chose one for you" is how that happens.
   */
  private writeLocation(access: MerchantAccess, merchantId: string, locationId: string): string {
    const scoped = this.scope(access, merchantId, locationId);
    if (scoped === null) throw new ForbiddenException({ code: 'LOCATION_REQUIRED' });
    return scoped;
  }

  /** The terminal is not in the ACCOUNT's own list, which is the only ownership proof we have. */
  private unknownTerminal(terminalId: string, merchantId: string): ConflictException {
    this.logger.warn(
      `mercado_pago_point_terminal_unknown merchant=${merchantId} terminal=${terminalId}: not in this account's terminal list`,
    );
    return new ConflictException({ code: 'MP_POINT_TERMINAL_UNKNOWN' });
  }

  /**
   * EVERY VENDOR CALL GOES THROUGH HERE, so one place decides how a vendor failure reads to the
   * console (plan D9: provider errors are typed, and one of them is a configuration error).
   *
   * The mapping is by the vendor's own CODE, never by its message:
   *   - unauthorized -> MP_POINT_CREDENTIAL_REJECTED: the token we hold is not accepted, so the
   *     owner has to authorize again (D8's territory) and not a terminal problem.
   *   - store_pos_not_found -> MP_POINT_STORE_REQUIRED: no store or no point of sale, a step a
   *     person completes in the Mercado Pago panel.
   *   - terminal_not_allowed_action -> MP_POINT_TERMINAL_NOT_ALLOWED: the vendor's own list of
   *     the terminals configurable from the API ("PAX_A910 and NEWLAND_N950").
   *   - anything else -> MP_POINT_TERMINAL_SETUP_FAILED, carrying the vendor's code so the
   *     console and its logs can tell two failures apart without parsing a message.
   *
   * A retryable failure — 429, 5xx, a dead socket, a socket that never answered — is a 503
   * MP_POINT_TERMINAL_UNAVAILABLE: asking again is coherent, and a 409 would say the cafe's
   * configuration is wrong when the truth is that we could not ask.
   *
   * The vendor's message text is deliberately NOT carried into a response, only its code: a
   * vendor string is data we do not audit, and D9's whole point is that the code is the part
   * that means something.
   */
  private async vendor<T>(
    work: () => Promise<T>,
    /**
     * WHICH OPERATION WAS REFUSED, because the fallback has to name the right thing. A refused
     * store creation reported as `MP_POINT_TERMINAL_SETUP_FAILED` would send whoever reads it to
     * the wrong screen: there is no terminal involved in creating a store, and the fix (the
     * address, the city catalogue) is somewhere else entirely.
     */
    operation: 'terminal' | 'store' = 'terminal',
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof PointTerminalClientError)) throw error;
      throw this.translate(error, operation);
    }
  }

  private translate(error: PointTerminalClientError, operation: 'terminal' | 'store'): Error {
    if (error.retryable) {
      this.logger.warn(
        `mercado_pago_point_terminal_unavailable vendor_code=${error.code} status=${error.status}`,
      );
      return new ServiceUnavailableException({
        code: 'MP_POINT_TERMINAL_UNAVAILABLE',
        details: { vendorCode: error.code, status: error.status },
      });
    }
    if (error.code === 'unauthorized') {
      this.logger.warn('mercado_pago_point_credential_rejected: the stored token was refused');
      return new ConflictException({ code: 'MP_POINT_CREDENTIAL_REJECTED' });
    }
    if (error.code === 'terminal_not_allowed_action') {
      return new ConflictException({
        code: 'MP_POINT_TERMINAL_NOT_ALLOWED',
        details: { vendorCode: error.code },
      });
    }
    if (error.code === 'store_pos_not_found') {
      return new ConflictException({
        code: 'MP_POINT_STORE_REQUIRED',
        details: { vendorCode: error.code },
      });
    }
    this.logger.warn(
      `mercado_pago_point_${operation === 'store' ? 'store_refused' : 'terminal_setup_failed'} vendor_code=${error.code} status=${error.status}`,
    );
    return new ConflictException({
      code: operation === 'store' ? 'MP_POINT_STORE_REFUSED' : 'MP_POINT_TERMINAL_SETUP_FAILED',
      details: { vendorCode: error.code, status: error.status },
    });
  }

  /**
   * ONE ROW, SHAPED AS THE CONTRACT'S MODEL — field by field, never spread.
   *
   * A spread of the row would carry whatever a later migration adds to device_point_terminal
   * into an API response, and PointTerminal is `.strict()`: the extra key would not be silently
   * dropped, it would refuse the response. Building the object key by key makes this function
   * the statement of what a screen may see, which is the discipline PointCredentialRepository
   * keeps for the credential.
   */
  private toTerminal(binding: PointTerminalBinding, vendorTerminal: VendorTerminal): PointTerminal {
    return {
      terminalId: binding.terminalId,
      operatingMode: binding.operatingMode,
      deviceId: binding.deviceId,
      locationId: binding.locationId,
      storeId: vendorTerminal.storeId ?? binding.storeId,
      posId: vendorTerminal.posId ?? binding.posId,
    };
  }

  /**
   * The mode the screen shows, from the two sources that can disagree. See `list` for why the
   * vendor wins, why UNDEFINED falls back, and why an unbound unconfigured terminal reads
   * STANDALONE: that is the vendor's own name for what a terminal is before anyone puts it into
   * API mode, and it is the only one of the contract's two values that is true of it.
   */
  private mergeMode(
    vendorMode: VendorOperatingMode,
    binding: PointTerminalBinding | null,
  ): PointOperatingMode {
    if (vendorMode === 'PDV' || vendorMode === 'STANDALONE') return vendorMode;
    return binding?.operatingMode ?? 'STANDALONE';
  }
}

/**
 * OUR OWN ID FOR THE CAFÉ'S STORE, DERIVED AND NEVER RANDOM.
 *
 * The vendor requires `external_id` to be alphanumeric — a canonical UUID is not, because of its
 * hyphens — and unique, and that uniqueness is what makes a RETRY a refusal rather than a second
 * store: the same café always proposes the same id, so a duplicate attempt collides at the vendor
 * instead of creating a second store with a second fiscal address. The `umi` prefix is for
 * whoever is looking at the Mercado Pago panel and has to tell our rows apart from ones a person
 * made there by hand.
 */
function pointStoreExternalId(merchantId: string): string {
  return `umi${merchantId.replace(/-/gu, '')}`;
}
