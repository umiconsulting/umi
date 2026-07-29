import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  CartItem,
  CartLineInput,
  CheckoutCommand,
  CheckoutResult,
  PaymentOutcome,
  PaymentStatusQuery,
  ReceiptSnapshot,
  TaxBreakdown,
  TotalsConfirmation,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository, type PricedSelection } from '../pos-cart/pos-cart.repository';
import { PosCheckoutRepository, type CheckoutCart } from './pos-checkout.repository';

@Injectable()
export class PosCheckoutService {
  constructor(
    private readonly repo: PosCheckoutRepository,
    private readonly carts: PosCartRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async checkout(user: AuthUser, tenantId: string, dto: CheckoutCommand) {
    const authorization = await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    const result = await this.integrity.execute<CheckoutResult>(
      {
        tenantId,
        branchId: dto.branchId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.checkout',
        payload: dto,
      },
      async (context) => {
        const cart = await this.repo.lockCart(
          context.client,
          tenantId,
          dto.branchId,
          dto.operatorSessionId,
          dto.cartId,
          dto.expectedCartVersion,
          authorization.operatorName,
        );
        if (!cart) {
          return {
            ok: false,
            code: 'OPTIMISTIC_VERSION_CONFLICT',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        const confirmation = await this.reprice(context.client, cart, dto.idempotencyKey);
        if (!confirmation) {
          return {
            ok: false,
            code: 'CHECKOUT_CART_CHANGED',
            failureClass: 'validation',
            retryable: false,
          };
        }
        if (dto.totalsFingerprint !== confirmation.public.fingerprint) {
          const code =
            dto.totalsFingerprint === null
              ? 'CHECKOUT_CONFIRMATION_REQUIRED'
              : 'CHECKOUT_CART_CHANGED';
          return {
            ok: true,
            value: {
              status: 'confirmation_required',
              confirmation: confirmation.public,
              payment: null,
              reservation: null,
              sale: null,
              receipt: null,
              failure: {
                code,
                retryable: false,
                operatorGuidance: 'confirm_totals',
                correlationId: context.correlationId,
              },
            },
          };
        }
        const confirmed: TotalsConfirmation = {
          ...confirmation.public,
          confirmedAt: new Date().toISOString(),
        };
        const reservation = await this.repo.reserve(
          context.client,
          cart,
          confirmation.lineSnapshot,
        );
        const payment = await this.repo.payment(
          context.client,
          cart,
          dto.paymentMethod,
          confirmed,
          context.correlationId,
        );
        if (payment.attempt.status !== 'succeeded') {
          await context.appendAudit({
            eventType: 'payment.unknown',
            entityType: 'payment_attempt',
            entityId: payment.attempt.id,
            outcome: 'failure',
            reasonCode: 'PAYMENT_UNKNOWN',
            publicData: { queryOnly: true },
          });
          return {
            ok: true,
            value: this.unknownResult(confirmed, payment, reservation, context.correlationId),
          };
        }
        const receipt = this.receipt(cart, confirmed, payment, confirmation.lineSnapshot);
        const sale = await this.repo.commit(
          context.client,
          cart,
          confirmed,
          payment,
          reservation,
          receipt,
        );
        await context.appendFinancial(
          {
            aggregateType: 'pos_sale',
            aggregateId: sale.id,
            eventType: 'sale.committed',
            amountMinorUnits: confirmed.totals.grandTotal.minorUnits,
            currency: confirmed.totals.grandTotal.currency,
            publicData: { receiptRef: receipt.receiptRef, paymentMethod: dto.paymentMethod },
          },
          0,
        );
        await context.appendAudit({
          eventType: 'checkout.completed',
          entityType: 'pos_sale',
          entityId: sale.id,
          outcome: 'success',
          publicData: { receiptRef: receipt.receiptRef },
        });
        return {
          ok: true,
          value: {
            status: 'completed',
            confirmation: confirmed,
            payment,
            reservation,
            sale,
            receipt,
            failure: null,
          },
        };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({
        code: result.failureCode ?? 'CHECKOUT_CART_CHANGED',
      });
    }
    return result.result;
  }

  async paymentStatus(
    user: AuthUser,
    tenantId: string,
    paymentId: string,
    query: PaymentStatusQuery,
  ) {
    await this.authorize(user, tenantId, query.branchId, query.operatorSessionId);
    const value = await this.repo.paymentStatus(tenantId, query.branchId, paymentId);
    if (!value) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return value;
  }

  private async reprice(
    client: Parameters<Parameters<IntegrityService['execute']>[1]>[0]['client'],
    cart: CheckoutCart,
    idempotencyKey: string,
  ): Promise<{
    public: TotalsConfirmation;
    lineSnapshot: CartItem[];
  } | null> {
    const fresh: Array<{ line: CheckoutCart['lines'][number]; priced: PricedSelection }> = [];
    for (const line of cart.lines) {
      const input: CartLineInput = {
        cartId: cart.id,
        branchId: cart.branchId,
        operatorSessionId: cart.operatorSessionId,
        productId: line.productId,
        variantId: line.variantId,
        modifierSelections: line.modifiers,
        quantity: line.quantity,
        note: line.note,
        expectedVersion: cart.version,
        idempotencyKey,
      };
      const priced = await this.carts.price(client, cart.tenantId, cart.branchId, input);
      if (!priced) return null;
      fresh.push({ line, priced });
    }
    const currency = fresh[0].priced.currency;
    let subtotal = 0;
    let taxTotal = 0;
    const taxGroups = new Map<number, { taxable: number; tax: number }>();
    const items: CartItem[] = fresh.map(({ line, priced }) => {
      const modifierTotal = priced.modifiers.reduce(
        (sum, modifier) => sum + modifier.priceDelta * modifier.quantity,
        0,
      );
      const unit = priced.basePrice + priced.variantDelta + modifierTotal;
      const lineTotal = unit * line.quantity;
      const tax = Math.round(
        (lineTotal * priced.taxRateBasisPoints) / (10000 + priced.taxRateBasisPoints),
      );
      subtotal += lineTotal;
      taxTotal += tax;
      const group = taxGroups.get(priced.taxRateBasisPoints) ?? { taxable: 0, tax: 0 };
      group.taxable += lineTotal;
      group.tax += tax;
      taxGroups.set(priced.taxRateBasisPoints, group);
      return {
        id: line.id,
        productId: priced.productId,
        productName: priced.productName,
        quantity: line.quantity,
        variant: priced.variantId
          ? {
              variantId: priced.variantId,
              name: priced.variantName!,
              attributes: priced.variantAttributes,
            }
          : null,
        modifiers: priced.modifiers.map((modifier) => ({
          modifierId: modifier.modifierId,
          groupId: modifier.groupId,
          name: modifier.name,
          quantity: modifier.quantity,
          priceDelta: { minorUnits: modifier.priceDelta, currency },
        })),
        note: line.note,
        price: {
          unitPrice: { minorUnits: unit, currency },
          lineSubtotal: { minorUnits: lineTotal, currency },
          tax: { minorUnits: tax, currency },
          lineTotal: { minorUnits: lineTotal, currency },
          taxRateBasisPoints: priced.taxRateBasisPoints,
        },
      };
    });
    const taxes: TaxBreakdown = {
      total: { minorUnits: taxTotal, currency },
      entries: [...taxGroups.entries()].map(([rateBasisPoints, value]) => ({
        rateBasisPoints,
        taxableAmount: { minorUnits: value.taxable, currency },
        taxAmount: { minorUnits: value.tax, currency },
      })),
    };
    const totals = {
      subtotal: { minorUnits: subtotal, currency },
      tax: { minorUnits: taxTotal, currency },
      discounts: { total: { minorUnits: 0, currency }, entries: [] },
      grandTotal: { minorUnits: subtotal, currency },
      businessDate: cart.businessDate,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ cartVersion: cart.version, items, totals, taxes }))
      .digest('hex');
    const snapshotAt = new Date().toISOString();
    return {
      lineSnapshot: items,
      public: {
        cartVersion: cart.version,
        fingerprint,
        totals,
        taxes,
        discounts: totals.discounts,
        catalogVersion: fingerprint,
        pricingVersion: fingerprint,
        taxVersion: fingerprint,
        snapshotAt,
        confirmedAt: null,
      },
    };
  }

  private receipt(
    cart: CheckoutCart,
    confirmation: TotalsConfirmation,
    payment: PaymentOutcome,
    lineSnapshot: CartItem[],
  ): ReceiptSnapshot {
    const now = new Date().toISOString();
    return {
      receiptRef: `POS-${payment.attempt.id}`,
      tenantId: cart.tenantId,
      branchId: cart.branchId,
      issuedAt: now,
      businessDate: cart.businessDate,
      lines: lineSnapshot.map((item) => ({
        lineRef: item.id,
        description: item.productName,
        quantity: item.quantity,
        unitPrice: item.price.unitPrice,
        lineTotal: item.price.lineTotal,
        variantName: item.variant?.name ?? null,
        modifiers: item.modifiers.map((modifier) => modifier.name),
        tax: item.price.tax,
        note: item.note,
      })),
      subtotal: confirmation.totals.subtotal,
      taxTotal: confirmation.totals.tax,
      grandTotal: confirmation.totals.grandTotal,
      discountTotal: confirmation.discounts.total,
      currency: confirmation.totals.grandTotal.currency,
      version: 1,
      tenantName: cart.tenantName,
      branchName: cart.branchName,
      operatorName: cart.operatorName,
      payment: {
        method: payment.attempt.method,
        status: 'succeeded',
        reference: payment.attempt.id,
        amount: payment.attempt.amount,
      },
    };
  }

  private unknownResult(
    confirmation: TotalsConfirmation,
    payment: PaymentOutcome,
    reservation: NonNullable<CheckoutResult['reservation']>,
    correlationId: string,
  ): CheckoutResult {
    return {
      status: 'payment_unknown',
      confirmation,
      payment,
      reservation,
      sale: null,
      receipt: null,
      failure: {
        code: 'PAYMENT_UNKNOWN',
        retryable: false,
        operatorGuidance: 'query_payment',
        correlationId,
      },
    };
  }

  private async authorize(
    user: AuthUser,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      tenantId,
      branchId,
      operatorSessionId,
    );
    if (!authorization) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return authorization;
  }
}
