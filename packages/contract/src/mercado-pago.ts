import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

/**
 * THE MERCHANT'S LINK TO MERCADO PAGO — Phase 5 of
 * `docs/plans/2026-09-17-mercadopago-point-integration-plan.md`.
 *
 * WHY THIS IS NOT PART OF `tender.ts`. A tender is an attempt at taking money, and the tender
 * path's models are about what a provider ANSWERED. This is about who the merchant IS to the
 * vendor: the account that receives the money, the OAuth token that lets us act for it, and how
 * long that token has left. They change on different clocks — an attempt resolves in seconds, a
 * credential lasts 180 days — and a screen that shows one is not the screen that shows the other.
 *
 * TOKENS NEVER TRAVEL. There is no model in this file that carries an access token or a refresh
 * token, and that is a deliberate absence rather than an oversight: the credential is stored
 * encrypted (`merchant.mp_point_credential`, whose `_cipher` columns `readonly` may not even
 * select) and is decrypted for exactly one caller — the transport, on its way to the vendor.
 * The most a client is told is the account and the token's HEALTH.
 */

/**
 * Where to send a seller to authorize Umi, and when that invitation stops being valid.
 *
 * The URL carries a signed, short-lived state that names the merchant and the operator who
 * started the flow; the vendor returns it verbatim to the callback, which is how the callback
 * knows whose credential it is holding without trusting anything in the query string.
 */
export const PointAuthorization = z
  .object({
    /** The vendor's authorization URL. It contains the state; nothing else needs it. */
    url: z.string().url(),
    /** When the state stops being accepted. A flow older than this must be started again. */
    expiresAt: IsoTimestamp,
  })
  .strict();
export type PointAuthorization = z.infer<typeof PointAuthorization>;

/**
 * What a screen may know about a merchant's credential. `connected` is the only thing that
 * decides whether the card terminal can be offered at all.
 */
export const PointCredentialStatus = z
  .object({
    connected: z.boolean(),
    /** The Mercado Pago account that receives the money, once one is bound. */
    mpUserId: z.string().min(1).max(120).nullable(),
    /** When the access token expires. The vendor's clock, not ours. */
    expiresAt: IsoTimestamp.nullable(),
    /**
     * Whole days left, floored, computed by the server so two screens cannot disagree about
     * what "14 days" means. Null when there is no expiry to speak of.
     */
    daysUntilExpiry: z.number().int().nullable(),
    /** When the last renewal FAILED, and how many times it has failed in a row. */
    refreshFailedAt: IsoTimestamp.nullable(),
    refreshAttempts: z.number().int().nonnegative(),
  })
  .strict();
export type PointCredentialStatus = z.infer<typeof PointCredentialStatus>;

/**
 * WHICH SIDE DRIVES THE TERMINAL (note 08, Phase 5 step 3).
 *
 * `PDV` is the point of sale driving the register — the mode this whole workstream needs, because
 * the till creates the order. `STANDALONE` is a person operating the terminal itself, which the
 * vendor also supports and which is why the value is stored rather than assumed. The vendor lists
 * both as expected practice; a deployment that guessed one would be guessing at the counter.
 */
export const PointOperatingMode = z.enum(['PDV', 'STANDALONE']);
export type PointOperatingMode = z.infer<typeof PointOperatingMode>;

/**
 * ONE TERMINAL OF THIS CAFÉ'S ACCOUNT, as the vendor lists it and as we have bound it.
 *
 * The two halves are deliberately together. `terminalId` and `operatingMode` come from the
 * vendor's `GET /terminals/v1/list` with this merchant's own token — they are facts about the
 * account, and a terminal that disappeared from that list must disappear from the screen rather
 * than linger in our table. `deviceId`, `locationId`, `storeId` and `posId` are OURS: which
 * register of which location owns this terminal, and the two vendor ids the order needs, which
 * the vendor requires to be created per merchant with that merchant's token (step 4).
 */
export const PointTerminal = z
  .object({
    terminalId: z.string().min(1).max(104),
    operatingMode: PointOperatingMode,
    /** The register that owns it, or null while it is unbound. */
    deviceId: Uuid.nullable(),
    locationId: Uuid.nullable(),
    /** The vendor's store and point-of-sale ids for THIS merchant, once created. */
    storeId: z.string().min(1).max(120).nullable(),
    posId: z.string().min(1).max(120).nullable(),
  })
  .strict();
export type PointTerminal = z.infer<typeof PointTerminal>;

export const PointTerminalList = z.object({ terminals: z.array(PointTerminal).max(50) }).strict();
export type PointTerminalList = z.infer<typeof PointTerminalList>;

/**
 * Binding a terminal to a register, and choosing which side drives it.
 *
 * The register and its location are named by US rather than inferred: a terminal bound to the
 * wrong register takes money at the wrong counter, and the database's `unique (device_id)` means
 * the binding is a move rather than an addition — one register, one terminal.
 */
export const PointTerminalBindRequest = z
  .object({
    deviceId: Uuid,
    locationId: Uuid,
    terminalId: z.string().min(1).max(104),
    operatingMode: PointOperatingMode,
  })
  .strict();
export type PointTerminalBindRequest = z.infer<typeof PointTerminalBindRequest>;

/**
 * CREATING THE CAFÉ'S STORE AT THE VENDOR — Phase 5 step 4, and the one place an address is
 * typed by a person rather than derived by us.
 *
 * IT IS ASKED FOR BECAUSE THE VENDOR NEEDS IT AND WE MUST NOT INVENT IT. The reference states the
 * stake in its own words: incorrect location data "can cause errors in tax calculations, directly
 * impacting billing and fiscal compliance of your company". So the address comes from the
 * operator, who knows the counter it belongs to — never from a default, a city guessed from a
 * postal code, or a blank field the vendor would accept into a fiscal record.
 *
 * `cityName` IS FREE TEXT ON PURPOSE, AND IT IS THE FIELD MOST LIKELY TO BE REFUSED. The vendor
 * validates it against a closed catalogue with accents — `Culiacan` is refused where `Culiacán` is
 * accepted (note 01 §6.2, observed live) — and its refusal lists the valid cities of the state. A
 * picker of our own would be a copy of that catalogue that goes stale; the field is therefore what
 * the operator knows, and the vendor's own answer is what corrects it.
 */
export const PointStoreCreateRequest = z
  .object({
    /** The vendor refuses a name with digits or special characters, so the café's own name is the honest input. */
    name: z.string().min(1).max(120),
    streetName: z.string().min(1).max(120),
    /** A STRING, not a number: the vendor types it as a string (note 01 §6.2). */
    streetNumber: z.string().min(1).max(20),
    cityName: z.string().min(1).max(80),
    stateName: z.string().min(1).max(80),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** A landmark, when the operator gives one. */
    reference: z.string().max(160).nullable(),
  })
  .strict();
export type PointStoreCreateRequest = z.infer<typeof PointStoreCreateRequest>;

/**
 * The store the vendor created, as much of it as a console needs: which store, what it is called,
 * and OUR own id for it. `externalId` is derived from the merchant rather than randomized, so a
 * retry names the same store and the vendor's `external_id` uniqueness bounds a duplicate to a
 * refusal rather than a second store with a second fiscal address.
 */
export const PointStore = z
  .object({
    storeId: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    externalId: z.string().min(1).max(60),
  })
  .strict();
export type PointStore = z.infer<typeof PointStore>;

export const mercadoPagoModels = {
  PointAuthorization,
  PointCredentialStatus,
  PointOperatingMode,
  PointStore,
  PointStoreCreateRequest,
  PointTerminal,
  PointTerminalList,
  PointTerminalBindRequest,
} as const;

/** The route parameters of the two merchant-scoped reads, kept beside the models they shape. */
export const PointMerchantQuery = z.object({ merchantId: Uuid }).strict();
export type PointMerchantQuery = z.infer<typeof PointMerchantQuery>;

/** The route parameter of the terminal routes; the terminal id is the vendor's own string. */
export const PointTerminalQuery = z.object({ merchantId: Uuid, terminalId: z.string().min(1) });
export type PointTerminalQuery = z.infer<typeof PointTerminalQuery>;
