import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TableOrderCredential,
  TableOrderCredentialList,
  TableOrderPlaced,
  type IssueTableOrderCredentialRequest,
  type PlaceTableOrderRequest,
  type RevokeTableOrderCredentialRequest,
  type TableOrderMenuItem,
  type TableOrderMenu,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { writeOrder } from '../../shared/orders/order-writer';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { IntegrityService } from '../integrity/integrity.service';
import type { BusinessOutcome, TransactionContext } from '../integrity/integrity.types';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCatalogRepository } from '../pos-catalog/pos-catalog.repository';
import {
  TableOrderRepository,
  hashTableOrderToken,
  type ResolvedTableOrderCredential,
} from './table-order.repository';

/** What `runPlaceOrder` needs that the credential alone does not carry: the label the
 * guest and the kitchen read, and the café's currency. Read once, before the
 * transaction, and passed in so the transaction does not repeat the read. */
interface TableOrderContext {
  tableLabel: string;
  currency: string;
}

/**
 * THE PUBLIC, UNAUTHENTICATED TABLE-ORDER INTAKE (§8I step 2).
 *
 * WHAT THIS IS, in the ADR's words (§9): the table channel ships as ORDER INTAKE. A
 * seated guest reads the menu from a QR at the table and places an order; the order is
 * written by the ONE writer with the channel identity `web`; the till picks it up from
 * the incoming-orders surface it already has; the kitchen receives it because
 * `writeOrder` itself projects the ticket. **Payment stays at the counter.** Nothing in
 * this file takes money, and no response shape offers to.
 *
 * FOUR RULES SHAPE THE WRITE PATH, and each one exists because the alternative is a
 * defect a guest or a café would have to live with:
 *
 *   1. THE PRICE IS NEVER THE GUEST'S. Every line is priced by
 *      `PosCartRepository.price` — the same call the till makes — inside the same
 *      transaction that writes the order. `PlaceTableOrderRequest` is `.strict()`, so a
 *      body that names a price, a discount or a customer id is REJECTED rather than
 *      silently stripped: a request that tried to state a price must be visible.
 *   2. THE TABLE IS NEVER THE GUEST'S EITHER. The table comes from the credential the
 *      token resolved to. There is no code path here that reads a table id from the
 *      body, because the body has no such field.
 *   3. THE TABLE MUST HAVE A PARTY ON IT. Asserted under a row lock in the
 *      transaction, refusing with the same `TABLE_NOT_OCCUPIED` the serve transition
 *      uses — see `table-order.repository.lockTableState` for why testing the state
 *      NAMED `open` would be exactly backwards.
 *   4. A RETRY MUST NOT DOUBLE-ORDER. The command journal (`business_command`) keys on
 *      the guest's `idempotencyKey`: the same body replays the first answer, and a
 *      different body under the same key is refused `IDEMPOTENCY_CONFLICT` rather than
 *      answered. `writeOrder`'s own `externalRef` uniqueness is the second line, so a
 *      race that got past the journal still cannot write two orders.
 *
 * THE REFUSALS ARE ALL RETRYABLE, and that is a deliberate difference from the till's
 * table commands. A guest's refusal is usually caused by state that will change —
 * nobody had seated them yet, the kitchen was out of the dish — and the guest's page
 * retries with the SAME key. `IntegrityRepository.claimCommand` re-runs a recorded
 * failure only when it is marked retryable, so marking these terminal would pin the
 * refusal to the key for ever, and a guest whose table was opened a minute later would
 * keep reading "ask your waiter" until the page minted a new key.
 */
@Injectable()
export class TableOrderService {
  constructor(
    private readonly repo: TableOrderRepository,
    private readonly pg: PgService,
    private readonly catalog: PosCatalogRepository,
    private readonly cart: PosCartRepository,
    private readonly integrity: IntegrityService,
  ) {}

  /** How many products one guest page reads. A café's table menu is far below this; the
   * till paginates and the guest page does not (see {@link menu}). */
  private static readonly MENU_LIMIT = 500;

  // ── The guest's two routes ──────────────────────────────────────────────────

  /**
   * The menu a guest at this table may order from: the LOCATION's catalog, with the
   * location's availability already applied by the till's own availability expression,
   * plus each product's modifier groups so the page can build the choices the write
   * path will validate.
   *
   * A product sold in variants is included but flagged (`hasVariants`), because the
   * honest answer for "the large latte" is "order it with your waiter" rather than a
   * base price with the variant silently missing.
   */
  async menu(credential: ResolvedTableOrderCredential): Promise<TableOrderMenu> {
    const context = await this.repo.context(credential.merchantId, credential.locationId);
    const tableLabel = await this.repo.tableLabel(
      credential.merchantId,
      credential.locationId,
      credential.tableId,
    );
    // A credential whose table is no longer in the served plan is stale — the table was
    // removed from the layout. Fail closed, and say what the guest can do.
    if (!context || tableLabel === null) throw credentialInvalid();

    const items = await this.catalog.products({
      merchantId: credential.merchantId,
      locationId: credential.locationId,
      limit: TableOrderService.MENU_LIMIT,
    });
    const productIds = items.map((item) => item.id);
    // One set-based read for the whole menu, alongside the other two (§8.5): the list is
    // DERIVED from each product's recipe (D8), so it must be read when the menu is read
    // and never stored on a row.
    const [groups, variantProducts, allergens] = await Promise.all([
      this.optionGroups(credential.merchantId, productIds),
      this.variantProducts(credential.merchantId, productIds),
      this.repo.allergensByProduct(credential.merchantId, productIds),
    ]);

    return {
      merchantName: context.merchantName,
      locationName: context.locationName,
      tableLabel,
      currency: context.currency,
      paymentAtCounter: true,
      items: items.map((item) => ({
        productId: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        allergens: allergens.get(item.id) ?? [],
        availability: item.availability,
        hasVariants: variantProducts.has(item.id),
        optionGroups: groups.get(item.id) ?? [],
      })),
    };
  }

  /**
   * Place the order. Returns the order and what the counter will call it.
   *
   * The whole thing is ONE command on ONE transaction: the journal claim, the table
   * lock, the pricing, the order, its lines, its opening event, its kitchen ticket and
   * the intake link either all commit or none do. That is not ceremony — a committed
   * order that lost its kitchen ticket is a guest who waits for food nobody is cooking,
   * and a kitchen ticket whose order rolled back is a cook cooking for a table that
   * never ordered.
   */
  async placeOrder(
    credential: ResolvedTableOrderCredential,
    dto: PlaceTableOrderRequest,
  ): Promise<TableOrderPlaced> {
    const context = await this.repo.context(credential.merchantId, credential.locationId);
    const tableLabel = await this.repo.tableLabel(
      credential.merchantId,
      credential.locationId,
      credential.tableId,
    );
    if (!context || tableLabel === null) throw credentialInvalid();
    const orderContext: TableOrderContext = { tableLabel, currency: context.currency };

    const outcome = await this.integrity.execute<TableOrderPlaced>(
      {
        merchantId: credential.merchantId,
        locationId: credential.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'table_order.place',
        // The credential and the table are IN the fingerprint on purpose: the same key
        // used at a different table is a different command, and answering it with the
        // other table's order would be the worst possible replay.
        payload: { ...dto, credentialId: credential.credentialId, tableId: credential.tableId },
      },
      (transaction) => this.runPlaceOrder(transaction, credential, dto, orderContext),
    );

    if (outcome.status === 'succeeded' && outcome.result) {
      return TableOrderPlaced.parse(outcome.result);
    }
    // The refusal was recorded by the journal with its own code; re-raise it as the
    // HTTP failure a guest can read. A recorded refusal is not a 500.
    throw refusal(outcome.failureCode);
  }

  private async runPlaceOrder(
    transaction: TransactionContext,
    credential: ResolvedTableOrderCredential,
    dto: PlaceTableOrderRequest,
    orderContext: TableOrderContext,
  ): Promise<BusinessOutcome<TableOrderPlaced>> {
    const { client } = transaction;
    const { merchantId, locationId } = credential;

    // ── 1. The table must have a party on it, and it must still have one at COMMIT.
    const table = await this.repo.lockTableState(
      client,
      merchantId,
      locationId,
      credential.tableId,
    );
    if (!table || table.seatedAt === null) {
      return { ok: false, code: 'TABLE_NOT_OCCUPIED', failureClass: 'conflict', retryable: true };
    }

    // ── 2. Price every line from the server's catalog, and refuse the ones the
    //       product's own rules do not allow.
    const lines: Array<{
      productId: string;
      name: string;
      quantity: number;
      unitPriceCents: number;
      note: string | null;
      modifiers: Array<{
        modifierId: string;
        name: string;
        quantity: number;
        priceDeltaCents: number;
      }>;
    }> = [];
    for (const line of dto.lines) {
      const priced = await this.cart.price(client, merchantId, locationId, {
        productId: line.productId,
        variantId: null,
        modifierSelections: line.modifiers,
      });
      if (!priced) return this.lineRefusal(merchantId, locationId, line.productId);
      const modifierTotal = priced.modifiers.reduce(
        (sum, modifier) => sum + modifier.priceDelta * modifier.quantity,
        0,
      );
      lines.push({
        productId: priced.productId,
        name: priced.productName,
        quantity: line.quantity,
        // Variant delta is always zero here (no variant is accepted), and it is added
        // rather than assumed away so that this arithmetic stays the till's.
        unitPriceCents: priced.basePrice + priced.variantDelta + modifierTotal,
        note: line.note,
        modifiers: priced.modifiers.map((modifier) => ({
          modifierId: modifier.modifierId,
          name: modifier.name,
          quantity: modifier.quantity,
          priceDeltaCents: modifier.priceDelta,
        })),
      });
    }

    // ── 3. A product sold in variants cannot be ordered from here (see the contract).
    const variantIds = await this.variantProducts(
      merchantId,
      lines.map((line) => line.productId),
    );
    if (lines.some((line) => variantIds.has(line.productId))) {
      return {
        ok: false,
        code: 'VARIANT_NOT_AVAILABLE',
        failureClass: 'validation',
        retryable: true,
      };
    }

    // ── 4. THE order, through THE writer. Idempotent on `externalRef` as well as on
    //       the journal, so even a race cannot produce two orders for one submission.
    const reference = tableOrderReference(orderContext.tableLabel, dto.idempotencyKey);
    const unitCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const written = await writeOrder(client, {
      merchantId,
      source: 'web',
      fulfillmentType: 'dine_in',
      locationId,
      // No `customerId`: a phone typed into a public form is an unverified identity,
      // and matching it to a customer record would let one guest attach an order to
      // another person's history. The guest's own name travels as the pickup person.
      customerId: null,
      externalRef: reference,
      notes: dto.note,
      pickupPerson: dto.guestName,
      lines: lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        notes: line.note,
        modifiers: line.modifiers,
      })),
    });

    if (!written.created) {
      // The journal did not own this key but the order already exists — a race, or a
      // journal row collected past its retention. Answer with the order that exists
      // rather than writing a second one.
      const total = await this.repo.orderTotal(client, written.orderId);
      return {
        ok: true,
        value: {
          orderId: written.orderId,
          reference,
          status: 'placed',
          total: { minorUnits: total, currency: orderContext.currency },
          unitCount,
          placedAt: new Date().toISOString(),
          created: false,
        },
      };
    }

    await this.repo.insertLink(client, {
      orderId: written.orderId,
      merchantId,
      locationId,
      tableId: credential.tableId,
      credentialId: credential.credentialId,
      guestName: dto.guestName,
      guestPhone: dto.guestPhone,
    });

    const total = await this.repo.orderTotal(client, written.orderId);

    // The actor is NULL, and that is the fact worth recording: nobody authenticated
    // this write. The credential is what authorised it, so it is named instead.
    await transaction.appendAudit({
      eventType: 'table_order.placed',
      entityType: 'customer_order',
      entityId: written.orderId,
      outcome: 'success',
      publicData: {
        credentialId: credential.credentialId,
        tableId: credential.tableId,
        lineCount: lines.length,
        unitCount,
      },
    });

    return {
      ok: true,
      value: {
        orderId: written.orderId,
        reference,
        status: 'placed',
        total: { minorUnits: total, currency: orderContext.currency },
        unitCount,
        placedAt: new Date().toISOString(),
        created: true,
      },
    };
  }

  /**
   * WHY a line could not be priced, said in the guest's terms.
   *
   * `PosCartRepository.price` collapses several refusals into `null` — the product is
   * not orderable at this location, or the modifier selection is not allowed — and the
   * till lives with that because a barista can see the product on their own screen.
   * A guest cannot, so the two are separated here WITHOUT re-implementing the pricing
   * rules: the same query the till's catalog uses (`PosCatalogRepository.products`,
   * with its availability and stock expression) decides whether the product is
   * orderable at all. If it is, and `price` still refused, the problem is the modifier
   * selection — which is a thing the page can ask the guest to change.
   */
  private async lineRefusal(
    merchantId: string,
    locationId: string,
    productId: string,
  ): Promise<BusinessOutcome<TableOrderPlaced>> {
    const [row] = await this.catalog.products({ merchantId, locationId, productId, limit: 1 });
    const code =
      row && row.availability === 'enabled'
        ? ('MODIFIER_SELECTION_INVALID' as const)
        : ('PRODUCT_UNAVAILABLE' as const);
    return { ok: false, code, failureClass: 'validation', retryable: true };
  }

  /** Each product's option groups, with their modifiers, in one read. */
  private async optionGroups(
    merchantId: string,
    productIds: string[],
  ): Promise<Map<string, TableOrderMenuItem['optionGroups']>> {
    const result = new Map<string, TableOrderMenuItem['optionGroups']>();
    if (productIds.length === 0) return result;
    const { rows } = await this.pg.tquery<{
      productId: string;
      groupId: string;
      groupName: string;
      minSelect: number;
      maxSelect: number | null;
      modifierId: string | null;
      modifierName: string | null;
      priceDelta: string | null;
    }>(
      merchantId,
      `SELECT g.product_id::text AS "productId", g.id::text AS "groupId",
              g.name AS "groupName", g.min_select AS "minSelect", g.max_select AS "maxSelect",
              m.id::text AS "modifierId", m.name AS "modifierName",
              m.price_delta::text AS "priceDelta"
         FROM merchant.product_option_group g
         LEFT JOIN merchant.product_modifier m ON m.option_group_id = g.id
        WHERE g.product_id = ANY($1::uuid[])
        ORDER BY g.product_id, g.name, g.id, m.name, m.id`,
      [productIds],
    );
    for (const row of rows) {
      const groups = result.get(row.productId) ?? [];
      let group = groups.find((item) => item.id === row.groupId);
      if (!group) {
        group = {
          id: row.groupId,
          name: row.groupName,
          minSelect: row.minSelect,
          maxSelect: row.maxSelect,
          modifiers: [],
        };
        groups.push(group);
        result.set(row.productId, groups);
      }
      if (row.modifierId) {
        group.modifiers.push({
          id: row.modifierId,
          name: row.modifierName ?? '',
          priceDelta: { minorUnits: Number(row.priceDelta ?? 0), currency: 'MXN' },
        });
      }
    }
    return result;
  }

  /** The products among `productIds` that are sold in active variants. */
  private async variantProducts(merchantId: string, productIds: string[]): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const { rows } = await this.pg.tquery<{ productId: string }>(
      merchantId,
      `SELECT DISTINCT product_id::text AS "productId" FROM merchant.product_variant
        WHERE product_id = ANY($1::uuid[]) AND active`,
      [productIds],
    );
    return new Set(rows.map((row) => row.productId));
  }

  // ── The owner's door: issue, revoke, list ───────────────────────────────────

  /**
   * Mint the credential for one table, and return the raw token ONCE.
   *
   * The token is `randomBytes(32)` base64url — 256 bits of entropy, URL-safe because it
   * travels in a path segment — and only its sha256 is stored. The plaintext exists in
   * this response and nowhere else, which is what makes a database read insufficient to
   * reproduce a table's QR.
   */
  async issueCredential(
    user: AuthUser,
    access: MerchantAccess,
    dto: IssueTableOrderCredentialRequest,
  ): Promise<TableOrderCredential> {
    const locationId = resolveLocationAuthority(access, dto.locationId);
    if (!locationId) throw new ConflictException({ code: 'LOCATION_REQUIRED' });

    const label = await this.repo.tableLabel(access.merchantId, locationId, dto.tableId);
    if (label === null) {
      throw new ConflictException({
        code: 'TABLE_NOT_IN_PLAN',
        message: 'That table is not in this location’s floor plan.',
      });
    }

    const token = randomBytes(32).toString('base64url');
    const credentialId = randomUUID();
    const outcome = await this.integrity.execute<{ createdAt: string }>(
      {
        merchantId: access.merchantId,
        locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'table_order.credential.issue',
        payload: { locationId, tableId: dto.tableId },
      },
      async (transaction) => {
        const inserted = await this.repo.insertCredential(transaction.client, {
          credentialId,
          merchantId: access.merchantId,
          locationId,
          tableId: dto.tableId,
          tokenHash: hashTableOrderToken(token),
          createdByUserId: user.id,
        });
        if (!inserted) {
          // The partial unique index refused: this table already has a live code.
          // Typed, because the alternative is a bare 23505 and the owner needs to be
          // told to revoke the old one first.
          const refused: BusinessOutcome<{ createdAt: string }> = {
            ok: false,
            code: 'TABLE_ORDER_CREDENTIAL_ALREADY_LIVE',
            failureClass: 'conflict',
            retryable: false,
          };
          return refused;
        }
        await transaction.appendAudit({
          eventType: 'table_order.credential.issued',
          entityType: 'table_order_credential',
          entityId: credentialId,
          outcome: 'success',
          publicData: { tableId: dto.tableId, locationId },
        });
        return { ok: true, value: { createdAt: inserted.createdAt } };
      },
    );

    if (outcome.status !== 'succeeded' || !outcome.result) throw refusal(outcome.failureCode);
    return TableOrderCredential.parse({
      credentialId,
      locationId,
      tableId: dto.tableId,
      tableLabel: label,
      token,
      createdAt: outcome.result.createdAt,
      revokedAt: null,
    });
  }

  /**
   * Kill one table's code. The other tables keep working — that is the whole reason
   * revocation lives on the row (ADR §9).
   */
  async revokeCredential(
    user: AuthUser,
    access: MerchantAccess,
    credentialId: string,
    locationId: string,
    dto: RevokeTableOrderCredentialRequest,
  ): Promise<{ credentialId: string; revokedAt: string }> {
    const scoped = resolveLocationAuthority(access, locationId);
    if (!scoped) throw new ConflictException({ code: 'LOCATION_REQUIRED' });
    const outcome = await this.integrity.execute<{ revokedAt: string }>(
      {
        merchantId: access.merchantId,
        locationId: scoped,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'table_order.credential.revoke',
        payload: { credentialId },
      },
      async (transaction) => {
        const revoked = await this.repo.revokeCredential(
          transaction.client,
          access.merchantId,
          scoped,
          credentialId,
          user.id,
        );
        if (!revoked || !revoked.revokedAt) {
          const refused: BusinessOutcome<{ revokedAt: string }> = {
            ok: false,
            code: 'TABLE_ORDER_CREDENTIAL_INVALID',
            failureClass: 'validation',
            retryable: false,
          };
          return refused;
        }
        await transaction.appendAudit({
          eventType: 'table_order.credential.revoked',
          entityType: 'table_order_credential',
          entityId: credentialId,
          outcome: 'success',
          publicData: { tableId: revoked.tableId, locationId: scoped },
        });
        return { ok: true, value: { revokedAt: revoked.revokedAt } };
      },
    );
    if (outcome.status !== 'succeeded' || !outcome.result) throw refusal(outcome.failureCode);
    return { credentialId, revokedAt: outcome.result.revokedAt };
  }

  async listCredentials(
    access: MerchantAccess,
    locationId: string,
  ): Promise<TableOrderCredentialList> {
    const scoped = resolveLocationAuthority(access, locationId);
    if (!scoped) throw new ConflictException({ code: 'LOCATION_REQUIRED' });
    const rows = await this.repo.listCredentials(access.merchantId, scoped);
    return TableOrderCredentialList.parse({
      credentials: rows.map((row) => ({
        credentialId: row.credentialId,
        locationId: row.locationId,
        tableId: row.tableId,
        tableLabel: row.tableLabel,
        token: null,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
      })),
    });
  }
}

/**
 * What the counter and the kitchen board call this order.
 *
 * The kitchen ticket's `public_reference` is `COALESCE(external_ref, order id)`
 * (`kitchen-projector.ts`), so this string is what a cook reads on the board and what
 * the till reads on its incoming-orders card. It therefore LEADS WITH THE TABLE — a
 * dine-in ticket that does not name its table is a ticket somebody has to decode — and
 * carries six characters of the guest's retry key so that two orders at one table are
 * distinct rows, which the `(merchant_id, external_ref)` unique index requires and a
 * bare "MESA 7" would violate on the second round of drinks.
 */
export function tableOrderReference(tableLabel: string, idempotencyKey: string): string {
  return `MESA ${tableLabel} (${idempotencyKey.replace(/-/g, '').slice(0, 6).toUpperCase()})`;
}

/** The one refusal a bad token earns, wherever it is raised. Uniform on purpose: the
 * guest cannot act on the difference between unknown and revoked, and saying "revoked"
 * where a token was mistyped tells an attacker the token was once real. */
function credentialInvalid(): NotFoundException {
  return new NotFoundException({
    code: 'TABLE_ORDER_CREDENTIAL_INVALID',
    message:
      'Este código de mesa ya no está activo. Pídele a tu mesero un código nuevo o haz tu pedido en la caja.',
  });
}

/**
 * A recorded refusal, re-raised as the HTTP failure it is. The codes here are the
 * journal's, not invented at the edge, so the guest sees the same reason the database
 * recorded. Messages are Spanish because the reader is a guest, and each one names what
 * to do next — a refusal with no recovery action is the thing the plan's §4 forbids.
 */
function refusal(code: string | null): ConflictException | NotFoundException {
  switch (code) {
    case 'TABLE_NOT_OCCUPIED':
      return new ConflictException({
        code: 'TABLE_NOT_OCCUPIED',
        message:
          'Esta mesa todavía no está abierta para pedir. Pídele a tu mesero que la abra y vuelve a enviar tu pedido.',
      });
    case 'PRODUCT_UNAVAILABLE':
      return new ConflictException({
        code: 'PRODUCT_UNAVAILABLE',
        message:
          'Uno de los productos de tu pedido ya no está disponible. Actualiza el menú e inténtalo de nuevo.',
      });
    case 'VARIANT_NOT_AVAILABLE':
      return new ConflictException({
        code: 'VARIANT_NOT_AVAILABLE',
        message: 'Uno de los productos se pide en presentaciones. Ordénalo con tu mesero.',
      });
    case 'MODIFIER_SELECTION_INVALID':
      return new ConflictException({
        code: 'MODIFIER_SELECTION_INVALID',
        message:
          'Las opciones elegidas para un producto no son válidas. Revísalas e inténtalo de nuevo.',
      });
    case 'TABLE_ORDER_CREDENTIAL_ALREADY_LIVE':
      return new ConflictException({
        code: 'TABLE_ORDER_CREDENTIAL_ALREADY_LIVE',
        message:
          'Esta mesa ya tiene un código activo. Revócalo antes de generar uno nuevo, para que no quede un código que creas muerto y siga funcionando.',
      });
    case 'TABLE_ORDER_CREDENTIAL_INVALID':
      return new NotFoundException({
        code: 'TABLE_ORDER_CREDENTIAL_INVALID',
        message: 'Ese código de mesa no existe.',
      });
    default:
      // A `null` code is not "no reason": it is the one shape the journal produces for a
      // command that is STILL PROCESSING — a second submission of the same key that
      // arrived while the first was in flight, read as a not-yet-succeeded row. Naming it
      // COMMAND_IN_PROGRESS (the platform's code for exactly that) rather than an
      // anonymous CONFLICT is what tells the page to wait and retry rather than to ask the
      // guest to start over.
      if (code === null) {
        return new ConflictException({
          code: 'COMMAND_IN_PROGRESS',
          message: 'Tu pedido se está registrando. Espera unos segundos y vuelve a enviarlo.',
        });
      }
      return new ConflictException({
        code,
        message: 'El pedido no se pudo registrar. Inténtalo de nuevo.',
      });
  }
}
