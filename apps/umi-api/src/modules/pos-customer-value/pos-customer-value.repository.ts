import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  CreateCustomerRequest,
  CustomerHistoryQuery,
  CustomerHistoryPage,
  CustomerMergeRequest,
  CustomerProfile,
  CustomerSearchRequest,
  CustomerSearchResult,
  CustomerValuePreview,
  CustomerValuePreviewRequest,
  CustomerValueRecoveryQuery,
  CustomerValueRecoveryResult,
  GiftCard,
  GiftCardActivation,
  GiftCardIssuanceRequest,
  GiftCardIssuancePreview,
  GiftCardIssuanceResult,
  GiftCardLookupRequest,
  GiftCardLookupResult,
  GiftCardSecretRevealRequest,
  GiftCardSecretRevealResult,
  PointsAdjustmentPreview,
  PointsAdjustmentRequest,
  PointsAdjustmentResult,
  RewardAuthorization,
  RewardAuthorizationRequest,
  StoredValueAuthorization,
  StoredValueAuthorizationRequest,
  ValueReleaseRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { commandFingerprint } from '../integrity/canonical-json';
import {
  calculatePointsEarn,
  evaluateRewardEligibility,
  normalizeCustomerContact,
} from './customer-value-domain';

export interface CustomerValueAuthorization {
  commandContextType: 'pos_device' | 'dashboard_administrative';
  operatorId: string;
  deviceId: string | null;
  durableSessionId: string | null;
  dashboardSessionId: string | null;
  credentialVersion: number | null;
  permissions: string[];
}

type Row = QueryResultRow;
const masks = (type: string, value: string): string => {
  if (type === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  return `••••${value.slice(-4)}`;
};

@Injectable()
export class PosCustomerValueRepository {
  constructor(
    private readonly pg: PgService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  authorize(
    userId: string,
    durableSessionId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    deviceId: string,
    permission: string,
  ): Promise<CustomerValueAuthorization | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<CustomerValueAuthorization>(
          `SELECT 'pos_device'::text AS "commandContextType",
                  os.user_id::text AS "operatorId",os.device_id::text AS "deviceId",
                  os.durable_session_id::text AS "durableSessionId",
                  NULL::text AS "dashboardSessionId",
                  d.credential_version AS "credentialVersion",os.permissions
             FROM runtime.operator_session os
             JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
            WHERE os.id=$5::uuid AND os.durable_session_id=$2::uuid
              AND os.user_id=$1::uuid AND os.merchant_id=$3::uuid
              AND os.location_id=$4::uuid AND os.device_id=$6::uuid
              AND os.state='active' AND os.expires_at>clock_timestamp()
              AND d.status='active' AND d.credential_version>0
              AND ($7=ANY(os.permissions) OR '*'=ANY(os.permissions))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
                WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))`,
          [
            userId,
            durableSessionId,
            merchantId,
            locationId,
            operatorSessionId,
            deviceId,
            permission,
          ],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  administrativeAuthorization(input: {
    actorUserId: string;
    dashboardSessionId: string;
    permissions: string[];
  }): CustomerValueAuthorization {
    return {
      commandContextType: 'dashboard_administrative',
      operatorId: input.actorUserId,
      deviceId: null,
      durableSessionId: null,
      dashboardSessionId: input.dashboardSessionId,
      credentialVersion: null,
      permissions: input.permissions,
    };
  }

  async expireAllAuthorizations(batchSize = 100): Promise<number> {
    const merchants = await this.pg.query<{ id: string }>(
      `SELECT DISTINCT merchant_id::text AS id
         FROM merchant.customer_value_authorization
        WHERE status='authorized' AND expires_at<=clock_timestamp()
        ORDER BY merchant_id LIMIT 500`,
    );
    let expired = 0;
    for (const merchant of merchants.rows) {
      const result = await this.pg.tquery<{ count: number }>(
        merchant.id,
        `SELECT merchant.expire_customer_value_authorizations($1::uuid,$2)::int AS count`,
        [merchant.id, batchSize],
      );
      expired += Number(result.rows[0]?.count ?? 0);
    }
    return expired;
  }

  search(
    userId: string,
    merchantId: string,
    query: CustomerSearchRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<CustomerSearchResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const exact = query.query.trim().toLowerCase();
        let exactContact = exact;
        try {
          if (exact.includes('@')) {
            exactContact = normalizeCustomerContact('email', exact).normalizedValue;
          } else if (/^[+\d\s().-]+$/.test(exact) && /\d/.test(exact)) {
            exactContact = normalizeCustomerContact('phone', exact).normalizedValue;
          }
        } catch {
          exactContact = exact;
        }
        const canReadContact =
          authorization.permissions.includes('*') ||
          authorization.permissions.includes('customer.contact.read');
        const { rows } = await client.query<Row>(
          `SELECT c.id::text,c.public_reference AS "publicReference",coalesce(c.name,'Cliente') AS "displayName",
                  c.status,c.preferred_language AS "preferredLanguage",c.version,
                  c.privacy_state AS privacy,c.created_at::text AS "createdAt",c.updated_at::text AS "updatedAt",
                  coalesce(jsonb_agg(jsonb_build_object(
                    'id',ct.id,'type',ct.contact_type,'displayValue',
                      case when $5 then coalesce(ct.raw_value,ct.raw_phone_number,'') else '' end,
                    'maskedValue',coalesce(ct.normalized_value,''),'verification',ct.verification_status,
                    'primary',ct.is_primary
                  ) order by ct.is_primary desc,ct.id) filter(where ct.id is not null),'[]') contacts
             FROM merchant.customer c
             LEFT JOIN merchant.contact ct ON ct.customer_id=c.id AND ct.merchant_id=c.merchant_id
            WHERE c.merchant_id=$1::uuid AND c.status NOT IN ('merged','anonymized')
              AND ($2='' OR lower(coalesce(c.name,'')) LIKE $2||'%' OR lower(c.public_reference)=$2
                OR exists(select 1 from merchant.contact x where x.customer_id=c.id
                  and x.merchant_id=c.merchant_id and x.normalized_value=$6))
              AND ($3::text IS NULL OR (c.updated_at,c.id)<(
                split_part(convert_from(decode($3,'base64'),'utf8'),'|',1)::timestamptz,
                split_part(convert_from(decode($3,'base64'),'utf8'),'|',2)::uuid))
            GROUP BY c.id ORDER BY c.updated_at DESC,c.id DESC LIMIT $4`,
          [merchantId, exact, query.cursor ?? null, query.limit + 1, canReadContact, exactContact],
        );
        const page = rows.slice(0, query.limit);
        const customers = page.map((row) => this.profile(row, canReadContact));
        const last = page.at(-1);
        return {
          customers,
          ambiguous: exact.length > 0 && customers.length > 1,
          nextCursor:
            rows.length > query.limit && last
              ? Buffer.from(`${last.updatedAt}|${last.id}`).toString('base64')
              : null,
        };
      },
      query.locationId,
    );
  }

  async create(
    client: PoolClient,
    merchantId: string,
    dto: CreateCustomerRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<CustomerProfile> {
    const duplicate = await this.duplicateCandidates(client, merchantId, dto);
    const created = await client.query<Row>(
      `INSERT INTO merchant.customer(merchant_id,name,public_reference,status,preferred_language,privacy_state)
       VALUES($1::uuid,$2,'CUS-'||gen_random_uuid()::text,'active',$3,
         '{"dataMinimized":true,"contactVisibility":"limited"}'::jsonb)
       RETURNING id::text,public_reference AS "publicReference",name AS "displayName",status,
         preferred_language AS "preferredLanguage",version,privacy_state AS privacy,
         created_at::text AS "createdAt",updated_at::text AS "updatedAt"`,
      [merchantId, dto.displayName, dto.preferredLanguage],
    );
    const customer = created.rows[0];
    const contacts: Row[] = [];
    for (const input of dto.contacts) {
      const normalized = normalizeCustomerContact(input.type, input.value);
      const channel = await client.query<{ id: string }>(
        `SELECT id::text FROM umi.channel_type WHERE key=$1 LIMIT 1`,
        [input.type],
      );
      if (!channel.rows[0]) throw new ConflictException({ code: 'CUSTOMER_CONTACT_INVALID' });
      const inserted = await client.query<Row>(
        `INSERT INTO merchant.contact(
          merchant_id,customer_id,channel_id,raw_phone_number,raw_value,normalized_value,
          is_primary,verified,contact_type,verification_status)
         VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,false,$8,'unverified')
         RETURNING id::text,contact_type AS type,coalesce(raw_value,raw_phone_number) AS "displayValue",
          normalized_value AS "normalizedValue",verification_status AS verification,
          is_primary AS primary`,
        [
          merchantId,
          customer.id,
          channel.rows[0].id,
          input.type === 'phone' ? normalized.displayValue : null,
          input.type === 'email' ? normalized.displayValue : null,
          normalized.normalizedValue,
          input.primary,
          input.type,
        ],
      );
      contacts.push(inserted.rows[0]);
    }
    const consents: Row[] = [];
    for (const consent of dto.consents) {
      const inserted = await client.query<Row>(
        `SELECT id::text,consent_type AS type,status,granted_at::text AS "grantedAt",
          revoked_at::text AS "revokedAt",source,policy_version AS "policyVersion"
         FROM merchant.append_customer_consent(
          $1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid)`,
        [
          merchantId,
          customer.id,
          consent.type,
          consent.status,
          consent.policyVersion,
          authorization.operatorId,
          dto.commandId,
        ],
      );
      await client.query(
        `INSERT INTO merchant.customer_consent_current(merchant_id,customer_id,consent_type,history_id,status)
         VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5)
         ON CONFLICT(merchant_id,customer_id,consent_type) DO UPDATE SET
           history_id=excluded.history_id,status=excluded.status,version=merchant.customer_consent_current.version+1,
           updated_at=clock_timestamp()`,
        [merchantId, customer.id, consent.type, inserted.rows[0].id, consent.status],
      );
      consents.push({
        id: inserted.rows[0].id,
        type: inserted.rows[0].type,
        status: inserted.rows[0].status,
        grantedAt: inserted.rows[0].grantedAt,
        revokedAt: inserted.rows[0].revokedAt,
        evidence: {
          source: inserted.rows[0].source,
          policyVersion: inserted.rows[0].policyVersion,
          reference: null,
        },
      });
    }
    return {
      ...this.profile({ ...customer, contacts, consents }, true),
      duplicateCandidates: duplicate,
    } as CustomerProfile;
  }

  history(
    userId: string,
    merchantId: string,
    customerId: string,
    query: CustomerHistoryQuery,
    authorization: CustomerValueAuthorization,
  ): Promise<CustomerHistoryPage> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const found = await client.query(
          `SELECT 1 FROM merchant.customer WHERE id=$1::uuid AND merchant_id=$2::uuid`,
          [customerId, merchantId],
        );
        if (!found.rows[0]) throw new ConflictException({ code: 'CUSTOMER_MERCHANT_SCOPE' });
        if (query.eventLocationId && query.eventLocationId !== query.locationId) {
          throw new ConflictException({ code: 'CUSTOMER_HISTORY_LOCATION_SCOPE' });
        }
        const loyalty = await client.query<Row>(
          `SELECT a.id::text,a.customer_id::text AS "customerId",a.program_reference AS "programReference",
                  a.status,a.ledger_sequence AS "ledgerSequence",a.version,a.enrolled_at::text AS "enrolledAt",
                  coalesce(b.pending,0) AS pending,coalesce(b.available,0) AS available,
                  coalesce(b.authorized,0) AS authorized,coalesce(b.redeemed,0) AS redeemed,
                  coalesce(b.reversed,0) AS reversed,coalesce(b.expired,0) AS expired,
                  coalesce(b.adjusted,0) AS adjusted,
                  coalesce(b.projection_version,1) AS "projectionVersion",
                  coalesce(b.calculated_at,a.enrolled_at)::text AS "calculatedAt"
             FROM merchant.loyalty_points_account a
             LEFT JOIN merchant.loyalty_points_balance b ON b.account_id=a.id
            WHERE a.merchant_id=$1::uuid AND a.customer_id=$2::uuid
              AND a.status IN ('active','suspended','restricted')
            ORDER BY a.enrolled_at DESC LIMIT 1`,
          [merchantId, customerId],
        );
        const scope = {
          merchantId,
          customerId,
          category: query.category,
          eventLocationId: query.locationId,
          businessDateFrom: query.businessDateFrom ?? null,
          businessDateTo: query.businessDateTo ?? null,
          contactAccess:
            authorization.permissions.includes('*') ||
            authorization.permissions.includes('customer.consent.read'),
          globalAccess:
            authorization.permissions.includes('*') ||
            authorization.permissions.includes('customer.history.global'),
          administrativeAccess:
            authorization.permissions.includes('*') ||
            authorization.permissions.includes('customer.history.admin'),
        };
        const cursor = query.cursor ? this.decodeHistoryCursor(query.cursor, scope) : null;
        const { rows } = await client.query<Row>(
          `SELECT event_id::text AS id,event_type AS "sortType",
             case
               when event_type in ('sale') then 'sale'
               when event_type='receipt' then 'receipt'
               when event_type in ('refund','void') then event_type
               when event_type like 'points_%' or event_type='manual_points_adjustment' then 'points_earn'
               when event_type like 'reward_%' then 'reward'
               when event_type like 'wallet_%' then 'wallet'
               when event_type like 'gift_card_%' then 'gift_card'
               when event_type like 'consent_%' then 'consent'
               else 'merge' end AS type,
             public_reference AS "publicReference",location_id::text AS "locationId",
             origin_location_id::text AS "originLocationId",visibility,permission_class AS "permissionClass",
             business_date::text AS "businessDate",
             case when safe_data ? 'amountMinorUnits' then jsonb_build_object(
               'minorUnits',(safe_data->>'amountMinorUnits')::bigint,
               'currency',coalesce(safe_data->>'currency','MXN')) else null end AS total,
             case when safe_data ? 'points' then (safe_data->>'points')::bigint else null end AS points,
             nullif(safe_data->>'saleId','')::text AS "relatedSaleId",
             nullif(safe_data->>'refundId','')::text AS "relatedExceptionId",
             null::text AS "correlationReference",coalesce(safe_data->>'status','committed') AS status,
             occurred_at::text AS "occurredAt"
           FROM merchant.read_customer_history_event_scoped(
             $1::uuid,$2::uuid,$14::uuid)
          WHERE true
            AND ($3='all' OR
              ($3='sale' AND event_type='sale') OR ($3='receipt' AND event_type='receipt') OR
              ($3='exception' AND event_type IN ('refund','void')) OR
              ($3='loyalty' AND (event_type LIKE 'points_%' OR event_type='manual_points_adjustment')) OR
              ($3='reward' AND event_type LIKE 'reward_%') OR
              ($3='wallet' AND event_type LIKE 'wallet_%') OR
              ($3='gift_card' AND event_type LIKE 'gift_card_%') OR
              ($3='consent' AND event_type LIKE 'consent_%'))
            AND (
              (visibility IN ('location_attributed','origin_location') AND location_id=$4::uuid)
              OR visibility='customer_visible_foundation'
              OR ($12 AND visibility='merchant_global')
              OR ($13 AND visibility='restricted_administrative')
            )
            AND ($5::date IS NULL OR business_date>=$5::date)
            AND ($6::date IS NULL OR business_date<=$6::date)
            AND ($7::timestamptz IS NULL OR
              (occurred_at,event_type,event_id)<($7::timestamptz,$8::text,$9::uuid))
            AND ($10 OR event_type NOT LIKE 'consent_%')
          ORDER BY occurred_at DESC,event_type DESC,event_id DESC LIMIT $11`,
          [
            merchantId,
            customerId,
            query.category,
            query.locationId,
            query.businessDateFrom ?? null,
            query.businessDateTo ?? null,
            cursor?.occurredAt ?? null,
            cursor?.eventType ?? null,
            cursor?.eventId ?? null,
            scope.contactAccess,
            query.limit + 1,
            scope.globalAccess,
            scope.administrativeAccess,
            query.operatorSessionId,
          ],
        );
        const pageRows = rows.slice(0, query.limit);
        const page = pageRows.map(
          ({ sortType: _sortType, ...entry }) => entry,
        ) as CustomerHistoryPage['entries'];
        const last = pageRows.at(-1);
        return {
          entries: page,
          loyaltyAccount: loyalty.rows[0] ? this.account(loyalty.rows[0]) : null,
          pointsBalance: loyalty.rows[0] ? this.points(loyalty.rows[0]) : null,
          nextCursor:
            rows.length > query.limit && last
              ? this.encodeHistoryCursor(scope, {
                  occurredAt: last.occurredAt,
                  eventType: last.sortType,
                  eventId: last.id,
                })
              : null,
        };
      },
      query.locationId,
    );
  }

  async preview(
    userId: string,
    merchantId: string,
    dto: CustomerValuePreviewRequest,
  ): Promise<CustomerValuePreview> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const cart = await client.query<Row>(
          `SELECT c.id::text,c.customer_id::text AS "customerId",c.version,c.currency,
             c.business_date::text AS "businessDate",
             coalesce(sum(l.quantity*(l.base_price+l.variant_delta+l.modifier_total)),0)::bigint AS total,
             coalesce(d.payment_summary,'{}'::jsonb) AS "paymentSummary"
           FROM merchant.pos_cart c LEFT JOIN merchant.pos_cart_line l ON l.cart_id=c.id
           LEFT JOIN merchant.pos_checkout_draft d ON d.cart_id=c.id AND d.merchant_id=c.merchant_id
          WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid
          GROUP BY c.id,d.payment_summary`,
          [dto.saleId, merchantId, dto.locationId],
        );
        const row = cart.rows[0];
        if (
          !row ||
          row.customerId !== dto.customerId ||
          Number(row.version) !== dto.checkoutVersion
        ) {
          throw new ConflictException({ code: 'CUSTOMER_UNAVAILABLE' });
        }
        const lines = await client.query<Row>(
          `SELECT l.id::text,l.product_id::text AS "productId",p.category_id::text AS "categoryId",
             l.variant_id::text AS "variantId",
             coalesce((select array_agg(m.modifier_id::text) from merchant.pos_cart_line_modifier m
               where m.line_id=l.id),'{}') AS "modifierIds",
             (l.quantity*(l.base_price+l.variant_delta+l.modifier_total))::bigint AS amount
           FROM merchant.pos_cart_line l JOIN merchant.product p ON p.id=l.product_id
          WHERE l.cart_id=$1::uuid AND l.merchant_id=$2::uuid ORDER BY l.id LIMIT 501`,
          [dto.saleId, merchantId],
        );
        const policy = await client.query<Row>(
          `SELECT merchant_id::text AS id,program_reference AS "programReference",enabled,
             points_per_money_unit AS "pointsPerUnit",money_unit_minor_units AS "moneyUnit",
             points_rounding AS rounding,earn_timing AS "earnTiming",policy_version AS "policyVersion",
             policy_fingerprint AS fingerprint,policy_expires_at::text AS "expiresAt",
             include_tax AS "includeTax",include_tip AS "includeTip",
             discount_interaction AS "discountInteraction",reward_interaction AS "rewardInteraction",
             excluded_product_ids::text[] AS "excludedProductIds",
             excluded_category_ids::text[] AS "excludedCategoryIds",
             excluded_tender_types AS "excludedTenderTypes",pending_days AS "pendingDays",
             expiration_days AS "expirationDays",authorization_ttl_seconds AS "authorizationTtlSeconds"
           FROM merchant.loyalty_program WHERE merchant_id=$1::uuid`,
          [merchantId],
        );
        const customer = dto.customerId
          ? await this.customerSummary(client, merchantId, dto.customerId)
          : null;
        const account = dto.customerId
          ? ((
              await client.query<Row>(
                `SELECT a.id::text,a.customer_id::text AS "customerId",a.program_reference AS "programReference",
                 a.status,a.points_scale AS "pointsScale",a.ledger_sequence::int AS "ledgerSequence",
                 a.version,a.enrolled_at::text AS "enrolledAt",
                 coalesce(b.pending,0)::int pending,coalesce(b.available,0)::int available,
                 coalesce(b.authorized,0)::int authorized,coalesce(b.redeemed,0)::int redeemed,
                 coalesce(b.reversed,0)::int reversed,coalesce(b.expired,0)::int expired,
                 coalesce(b.adjusted,0)::int adjusted,coalesce(b.projection_version,1) AS "projectionVersion",
                 coalesce(b.calculated_at,clock_timestamp())::text AS "calculatedAt"
               FROM merchant.loyalty_points_account a LEFT JOIN merchant.loyalty_points_balance b ON b.account_id=a.id
              WHERE a.merchant_id=$1::uuid AND a.customer_id=$2::uuid AND a.status='active' LIMIT 1`,
                [merchantId, dto.customerId],
              )
            ).rows[0] ?? null)
          : null;
        const p = policy.rows[0];
        const payment = row.paymentSummary ?? {};
        const discountMinorUnits = Number(payment.discounts?.total?.minorUnits ?? 0);
        const taxMinorUnits = Number(
          payment.tax?.minorUnits ?? payment.totals?.tax?.minorUnits ?? 0,
        );
        const tipMinorUnits = Number(payment.tip?.amount?.minorUnits ?? 0);
        const tenderTypes = Array.isArray(payment.tenders)
          ? payment.tenders.map((tender: Row) => String(tender.type))
          : [];
        const earnCalculation = p?.enabled
          ? calculatePointsEarn({
              lines: lines.rows.map((line) => ({
                amountMinorUnits: Number(line.amount),
                productId: line.productId,
                categoryId: line.categoryId,
              })),
              discountMinorUnits,
              taxMinorUnits,
              tipMinorUnits,
              tenderTypes,
              rewardBenefitMinorUnits: 0,
              policy: {
                moneyUnitMinorUnits: Number(p.moneyUnit),
                pointsPerUnit: Number(p.pointsPerUnit),
                rounding: p.rounding,
                excludedProductIds: p.excludedProductIds ?? [],
                excludedCategoryIds: p.excludedCategoryIds ?? [],
                excludedTenderTypes: p.excludedTenderTypes ?? [],
                includeTax: p.includeTax,
                includeTip: p.includeTip,
                discountInteraction: p.discountInteraction,
                rewardInteraction: p.rewardInteraction,
                earnTiming: p.earnTiming,
              },
            })
          : null;
        const inputFingerprint = commandFingerprint('pos.customer-value.earn-input', {
          merchantId,
          locationId: dto.locationId,
          saleId: dto.saleId,
          checkoutVersion: dto.checkoutVersion,
          customerId: dto.customerId,
          checkoutFingerprint: dto.checkoutFingerprint,
          lines: lines.rows,
          discountMinorUnits,
          taxMinorUnits,
          tipMinorUnits,
          tenderTypes,
          policyVersion: p?.policyVersion ?? 'disabled',
          policyFingerprint: p?.fingerprint ?? null,
          businessDate: row.businessDate,
        });
        const fingerprint = commandFingerprint('pos.customer-value.preview', {
          merchantId,
          locationId: dto.locationId,
          saleId: dto.saleId,
          checkoutVersion: dto.checkoutVersion,
          customerId: dto.customerId,
          checkoutFingerprint: dto.checkoutFingerprint,
          policyVersion: p?.policyVersion ?? 'disabled',
          policyFingerprint: p?.fingerprint ?? null,
          inputFingerprint,
          businessDate: row.businessDate,
        });
        const previewExpiresAt = new Date(
          Math.min(new Date(p?.expiresAt ?? Date.now() + 300_000).getTime(), Date.now() + 300_000),
        ).toISOString();
        if (account && p?.enabled && dto.customerId && earnCalculation) {
          await client.query(
            `INSERT INTO merchant.loyalty_earn_preview(
              merchant_id,location_id,cart_id,customer_id,account_id,checkout_version,
              customer_attachment_version,loyalty_program_id,loyalty_policy_version,
              loyalty_policy_fingerprint,checkout_fingerprint,preview_fingerprint,input_fingerprint,
              gross_eligible_minor_units,excluded_minor_units,final_eligible_minor_units,
              expected_points,earn_status,explanation_codes,effective_rules,business_date,expires_at)
             VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,$9,$10,$11,$12,$13,
               $14,$15,$16,$17,$18,$19::text[],$20::jsonb,$21::date,$22::timestamptz)
             ON CONFLICT(merchant_id,preview_fingerprint) DO NOTHING`,
            [
              merchantId,
              dto.locationId,
              dto.saleId,
              dto.customerId,
              account.id,
              dto.checkoutVersion,
              Number(row.version),
              p.id,
              p.policyVersion,
              p.fingerprint,
              dto.checkoutFingerprint,
              fingerprint,
              inputFingerprint,
              earnCalculation.grossEligibleMinorUnits,
              earnCalculation.excludedMinorUnits,
              earnCalculation.finalEligibleMinorUnits,
              earnCalculation.points,
              earnCalculation.status,
              earnCalculation.explanationCodes,
              JSON.stringify({
                includeTax: p.includeTax,
                includeTip: p.includeTip,
                discountInteraction: p.discountInteraction,
                rewardInteraction: p.rewardInteraction,
                excludedProductIds: p.excludedProductIds,
                excludedCategoryIds: p.excludedCategoryIds,
                excludedTenderTypes: p.excludedTenderTypes,
                pendingDays: p.pendingDays,
                expirationDays: p.expirationDays,
                rounding: p.rounding,
                moneyUnitMinorUnits: Number(p.moneyUnit),
                pointsPerUnit: Number(p.pointsPerUnit),
              }),
              row.businessDate,
              previewExpiresAt,
            ],
          );
        }
        const wallet = dto.customerId
          ? ((
              await client.query<Row>(
                `SELECT c.id::text AS "accountId",c.currency,
                 coalesce(b.issued,0)::int issued,coalesce(b.loaded,0)::int loaded,
                 coalesce(b.available,0)::int available,coalesce(b.authorized,0)::int authorized,
                 coalesce(b.redeemed,0)::int redeemed,coalesce(b.refunded,0)::int refunded,
                 coalesce(b.reversed,0)::int reversed,coalesce(b.adjusted,0)::int adjusted,
                 coalesce(b.ledger_sequence,0)::int AS "ledgerSequence",
                 coalesce(b.projection_version,1)::int AS "projectionVersion",
                 coalesce(b.calculated_at,clock_timestamp())::text AS "calculatedAt"
               FROM merchant.loyalty_card c
               LEFT JOIN merchant.loyalty_stored_value_balance b ON b.card_id=c.id
              WHERE c.merchant_id=$1::uuid AND c.customer_id=$2::uuid AND c.status='active'
              LIMIT 1`,
                [merchantId, dto.customerId],
              )
            ).rows[0] ?? null)
          : null;
        const giftCards = dto.customerId
          ? (
              await client.query<Row>(
                `SELECT g.id::text,g.public_reference AS "publicReference",g.masked_code AS "maskedCode",
                 g.status,g.currency,g.amount_cents::int AS "initialValue",
                 g.activated_at::text AS "activatedAt",g.expires_at::text AS "expiresAt",
                 g.customer_id::text AS "customerId",g.version,
                 coalesce(b.available,0)::int available,coalesce(b.authorized,0)::int authorized,
                 coalesce(b.redeemed,0)::int redeemed,coalesce(b.refunded,0)::int refunded,
                 coalesce(b.ledger_sequence,0)::int sequence,
                 coalesce(b.projection_version,1)::int AS "projectionVersion",
                 coalesce(b.calculated_at,clock_timestamp())::text AS "calculatedAt"
               FROM merchant.loyalty_gift_card g
               LEFT JOIN merchant.loyalty_gift_card_balance b ON b.gift_card_id=g.id
              WHERE g.merchant_id=$1::uuid AND g.customer_id=$2::uuid
              ORDER BY g.created_at DESC,g.id DESC LIMIT 20`,
                [merchantId, dto.customerId],
              )
            ).rows
          : [];
        const rewards =
          account && p?.enabled
            ? (
                await client.query<Row>(
                  `SELECT id::text,public_reference AS "publicReference",name AS "displayName",
                 reward_type AS type,points_cost::int AS "pointsCost",active,
                 valid_from::text AS "validFrom",valid_until::text AS "validUntil",version,
                 value::int AS "benefitMinorUnits",location_ids::text[] AS "locationIds",
                 product_ids::text[] AS "productIds",category_ids::text[] AS "categoryIds",
                 variant_ids::text[] AS "variantIds",modifier_ids::text[] AS "modifierIds",
                 minimum_spend_minor_units::bigint AS "minimumSpendMinorUnits",
                 maximum_benefit_minor_units::bigint AS "maximumBenefitMinorUnits",
                 allowed_tender_types AS "allowedTenderTypes",
                 combinable_with_discounts AS "combinableWithDiscounts",
                 combinable_with_rewards AS "combinableWithRewards",
                 combinable_with_tips AS "combinableWithTips",
                 usage_per_sale AS "usagePerSale",usage_per_customer AS "usagePerCustomer",
                 usage_per_business_date AS "usagePerBusinessDate",
                 approval_permission AS "approvalPermission",policy_fingerprint AS "policyFingerprint",
                 (SELECT count(*)::int FROM merchant.loyalty_points_ledger u
                    WHERE u.reward_id=loyalty_reward.id AND u.customer_id=$2::uuid
                      AND u.entry_type='points_redeemed') AS "customerUsageCount",
                 (SELECT count(*)::int FROM merchant.loyalty_points_ledger u
                    WHERE u.reward_id=loyalty_reward.id AND u.customer_id=$2::uuid
                      AND u.entry_type='points_redeemed' AND u.business_date=$3::date) AS "businessDateUsageCount"
                 ,(SELECT count(*)::int FROM merchant.customer_value_authorization u
                    WHERE u.reward_id=loyalty_reward.id AND u.sale_id=$4::uuid
                      AND u.status IN ('authorized','committed')) AS "saleUsageCount"
                 ,(SELECT count(*)::int FROM merchant.customer_value_authorization u
                    WHERE u.reward_id<>loyalty_reward.id AND u.sale_id=$4::uuid
                      AND u.status='authorized') AS "otherRewardCount"
               FROM merchant.loyalty_reward
              WHERE merchant_id=$1::uuid AND active
                AND valid_from<=clock_timestamp()
                AND (valid_until IS NULL OR valid_until>clock_timestamp())
              ORDER BY points_cost,id LIMIT 50`,
                  [merchantId, dto.customerId, row.businessDate, dto.saleId],
                )
              ).rows
            : [];
        return {
          summary: {
            customer,
            loyaltyAccount: account ? this.account(account) : null,
            points: account ? this.points(account) : null,
            wallet: wallet ? this.wallet(wallet) : null,
            giftCards: giftCards.map((giftCard) => this.giftCard(giftCard)),
          },
          earn:
            account && p?.enabled
              ? {
                  customerId: dto.customerId!,
                  accountId: account.id,
                  programReference: p.programReference,
                  grossEligibleMinorUnits: earnCalculation!.grossEligibleMinorUnits,
                  eligibleMinorUnits: earnCalculation!.finalEligibleMinorUnits,
                  excludedMinorUnits: earnCalculation!.excludedMinorUnits,
                  expectedPoints: earnCalculation!.points,
                  status: earnCalculation!.points === 0 ? 'none' : p.earnTiming,
                  policyVersion: p.policyVersion,
                  fingerprint,
                  inputFingerprint,
                  previewVersion: 1,
                  checkoutVersion: dto.checkoutVersion,
                  customerAttachmentVersion: Number(row.version),
                  expiresAt: previewExpiresAt,
                  explanationCodes:
                    earnCalculation!.points > 0
                      ? [...earnCalculation!.explanationCodes, 'eligible_sale']
                      : [...earnCalculation!.explanationCodes, 'zero_earn'],
                }
              : null,
          rewards: rewards.map((reward) => {
            const locationAllowed =
              reward.locationIds.length === 0 || reward.locationIds.includes(dto.locationId);
            const productScoped =
              reward.productIds.length === 0 ||
              lines.rows.some((line) => reward.productIds.includes(line.productId));
            const categoryScoped =
              reward.categoryIds.length === 0 ||
              lines.rows.some(
                (line) => line.categoryId && reward.categoryIds.includes(line.categoryId),
              );
            const variantScoped =
              reward.variantIds.length === 0 ||
              lines.rows.some(
                (line) => line.variantId && reward.variantIds.includes(line.variantId),
              );
            const modifierScoped =
              reward.modifierIds.length === 0 ||
              lines.rows.some((line) =>
                line.modifierIds.some((id: string) => reward.modifierIds.includes(id)),
              );
            const usageLimitReached =
              (reward.usagePerCustomer !== null &&
                Number(reward.customerUsageCount) >= Number(reward.usagePerCustomer)) ||
              (reward.usagePerBusinessDate !== null &&
                Number(reward.businessDateUsageCount) >= Number(reward.usagePerBusinessDate));
            const eligibility = evaluateRewardEligibility({
              accountActive: account?.status === 'active',
              availablePoints: Number(account?.available ?? 0),
              authorizedPoints: Number(account?.authorized ?? 0),
              customerActive: customer?.status === 'active',
              rewardActive:
                reward.active &&
                locationAllowed &&
                productScoped &&
                categoryScoped &&
                variantScoped &&
                modifierScoped &&
                Number(row.total) >= Number(reward.minimumSpendMinorUnits),
              pointsCost: Number(reward.pointsCost),
              existingDiscount: discountMinorUnits > 0,
              anotherReward: Number(reward.otherRewardCount) > 0,
              tenderTypes,
              allowedTenderTypes: reward.allowedTenderTypes,
              combinableWithDiscount: reward.combinableWithDiscounts,
              combinableWithRewards: reward.combinableWithRewards,
              usageCount: usageLimitReached ? 1 : 0,
              usageLimit: 1,
            });
            const reasonCodes = [...eligibility.reasonCodes];
            if (!locationAllowed) reasonCodes.push('blocked_by_location');
            if (!productScoped || !categoryScoped || !variantScoped || !modifierScoped) {
              reasonCodes.push('blocked_by_product_scope');
            }
            if (Number(reward.saleUsageCount) >= Number(reward.usagePerSale)) {
              reasonCodes.push('usage_limit_reached');
            }
            if (tipMinorUnits > 0 && !reward.combinableWithTips) reasonCodes.push('blocked_by_tip');
            const eligible = reasonCodes.length === 0;
            const replacementRequired =
              reasonCodes.length === 1 && reasonCodes[0] === 'blocked_by_another_reward';
            const approvalRequired = eligible && Boolean(reward.approvalPermission);
            const benefitMinorUnits = Math.min(
              Number(reward.benefitMinorUnits),
              Number(reward.maximumBenefitMinorUnits ?? reward.benefitMinorUnits),
              Number(row.total),
            );
            return {
              reward: {
                id: reward.id,
                publicReference: reward.publicReference,
                displayName: reward.displayName,
                type: reward.type,
                pointsCost: Number(reward.pointsCost),
                active: reward.active,
                validFrom: reward.validFrom,
                validUntil: reward.validUntil,
                version: Number(reward.version),
              },
              eligible: eligible && !approvalRequired,
              state: replacementRequired
                ? 'replacement_confirmation_required'
                : approvalRequired
                  ? 'approval_required'
                  : eligible
                    ? 'eligible'
                    : 'ineligible',
              pointsCost: Number(reward.pointsCost),
              benefit: { minorUnits: benefitMinorUnits, currency: row.currency },
              remainingPoints: Math.max(
                0,
                Number(account?.available ?? 0) - Number(reward.pointsCost),
              ),
              approvalPermission: reward.approvalPermission,
              affectedLineIds: lines.rows
                .filter(
                  (line) =>
                    (reward.productIds.length === 0 ||
                      reward.productIds.includes(line.productId)) &&
                    (reward.categoryIds.length === 0 ||
                      reward.categoryIds.includes(line.categoryId)) &&
                    (reward.variantIds.length === 0 ||
                      reward.variantIds.includes(line.variantId)) &&
                    (reward.modifierIds.length === 0 ||
                      line.modifierIds.some((id: string) => reward.modifierIds.includes(id))),
                )
                .map((line) => line.id),
              taxConsequenceMinorUnits: 0,
              authorizationExpiresAt: previewExpiresAt,
              explanationCodes: eligible ? ['eligible'] : [...new Set(reasonCodes)],
              fingerprint: commandFingerprint('pos.reward.eligibility', {
                previewFingerprint: fingerprint,
                rewardId: reward.id,
                rewardVersion: reward.version,
                rewardPolicyFingerprint: reward.policyFingerprint,
              }),
              policyVersion: p.policyVersion,
            };
          }),
          selectedReward: null,
          storedValueAuthorizations: [],
          remainingBalance: { minorUnits: Number(row.total), currency: row.currency },
          policyVersions: { loyalty: p?.policyVersion ?? 'disabled' },
          fingerprint,
        };
      },
      dto.locationId,
    );
  }

  async authorizeReward(
    client: PoolClient,
    merchantId: string,
    dto: RewardAuthorizationRequest,
    authorization: CustomerValueAuthorization,
    correlationId: string,
  ): Promise<RewardAuthorization> {
    const reward = await client.query<Row>(
      `SELECT r.id::text,r.points_cost::int AS "pointsCost",r.value::bigint AS benefit,
         r.version,p.policy_version AS "policyVersion",p.policy_fingerprint AS "policyFingerprint",
         a.id::text AS "accountId",
         coalesce(b.available,0)::bigint AS available,coalesce(b.authorized,0)::bigint AS authorized,
         c.currency,c.business_date::text AS "businessDate",
         coalesce(d.payment_summary,'{}'::jsonb) AS "paymentSummary",
         coalesce((select sum(l.quantity*(l.base_price+l.variant_delta+l.modifier_total))
           from merchant.pos_cart_line l where l.cart_id=c.id),0)::bigint AS "cartTotal",
         r.location_ids::text[] AS "locationIds",r.product_ids::text[] AS "productIds",
         r.category_ids::text[] AS "categoryIds",r.variant_ids::text[] AS "variantIds",
         r.modifier_ids::text[] AS "modifierIds",
         r.minimum_spend_minor_units::bigint AS "minimumSpendMinorUnits",
         r.maximum_benefit_minor_units::bigint AS "maximumBenefitMinorUnits",
         r.allowed_tender_types AS "allowedTenderTypes",
         r.combinable_with_discounts AS "combinableWithDiscounts",
         r.combinable_with_rewards AS "combinableWithRewards",
         r.combinable_with_tips AS "combinableWithTips",
         r.approval_permission AS "approvalPermission",
         r.usage_per_sale AS "usagePerSale",r.usage_per_customer AS "usagePerCustomer",
         r.usage_per_business_date AS "usagePerBusinessDate",
         (select array_agg(distinct l.product_id::text) from merchant.pos_cart_line l
           where l.cart_id=c.id) AS "cartProductIds",
         (select array_agg(distinct pr.category_id::text) from merchant.pos_cart_line l
           join merchant.product pr on pr.id=l.product_id where l.cart_id=c.id) AS "cartCategoryIds",
         (select array_agg(distinct l.variant_id::text) from merchant.pos_cart_line l
           where l.cart_id=c.id and l.variant_id is not null) AS "cartVariantIds",
         (select array_agg(distinct m.modifier_id::text) from merchant.pos_cart_line l
           join merchant.pos_cart_line_modifier m on m.line_id=l.id where l.cart_id=c.id)
           AS "cartModifierIds",
         (select count(*)::int from merchant.loyalty_points_ledger u
           where u.reward_id=r.id and u.customer_id=$2::uuid and u.entry_type='points_redeemed')
           AS "customerUsageCount",
         (select count(*)::int from merchant.loyalty_points_ledger u
           where u.reward_id=r.id and u.customer_id=$2::uuid and u.entry_type='points_redeemed'
             and u.business_date=c.business_date) AS "businessDateUsageCount",
         (select count(*)::int from merchant.customer_value_authorization u
           where u.reward_id=r.id and u.sale_id=c.id and u.status in ('authorized','committed'))
           AS "saleUsageCount",
         (select count(*)::int from merchant.customer_value_authorization u
           where u.reward_id<>r.id and u.sale_id=c.id and u.status='authorized')
           AS "otherRewardCount"
       FROM merchant.loyalty_reward r JOIN merchant.loyalty_program p ON p.merchant_id=r.merchant_id
       JOIN merchant.loyalty_points_account a ON a.merchant_id=r.merchant_id AND a.customer_id=$2::uuid
       JOIN merchant.loyalty_points_balance b ON b.account_id=a.id
       JOIN merchant.pos_cart c ON c.id=$3::uuid AND c.merchant_id=r.merchant_id AND c.customer_id=$2::uuid
       LEFT JOIN merchant.pos_checkout_draft d ON d.cart_id=c.id AND d.merchant_id=c.merchant_id
       JOIN merchant.loyalty_earn_preview ep ON ep.cart_id=c.id AND ep.customer_id=$2::uuid
         AND ep.preview_fingerprint=$5 AND ep.checkout_version=$6 AND ep.expires_at>clock_timestamp()
      WHERE r.id=$1::uuid AND r.merchant_id=$4::uuid AND r.active AND r.points_cost>0
        AND r.valid_from<=clock_timestamp()
        AND (r.valid_until IS NULL OR r.valid_until>clock_timestamp())
        AND p.policy_version=ep.loyalty_policy_version
        AND p.policy_fingerprint=ep.loyalty_policy_fingerprint FOR UPDATE OF a,b,r`,
      [
        dto.rewardId,
        dto.customerId,
        dto.saleId,
        merchantId,
        dto.previewFingerprint,
        dto.checkoutVersion,
      ],
    );
    const row = reward.rows[0];
    const payment = row?.paymentSummary ?? {};
    const tenderTypes = Array.isArray(payment.tenders)
      ? payment.tenders.map((tender: Row) => String(tender.type))
      : [];
    const discountMinorUnits = Number(payment.discounts?.total?.minorUnits ?? 0);
    const tipMinorUnits = Number(payment.tip?.amount?.minorUnits ?? 0);
    const locationAllowed = row
      ? row.locationIds.length === 0 || row.locationIds.includes(dto.locationId)
      : false;
    const productScoped = row
      ? row.productIds.length === 0 ||
        row.productIds.some((id: string) => (row.cartProductIds ?? []).includes(id))
      : false;
    const categoryScoped = row
      ? row.categoryIds.length === 0 ||
        row.categoryIds.some((id: string) => (row.cartCategoryIds ?? []).includes(id))
      : false;
    const variantScoped = row
      ? row.variantIds.length === 0 ||
        row.variantIds.some((id: string) => (row.cartVariantIds ?? []).includes(id))
      : false;
    const modifierScoped = row
      ? row.modifierIds.length === 0 ||
        row.modifierIds.some((id: string) => (row.cartModifierIds ?? []).includes(id))
      : false;
    const usageLimitReached = row
      ? (row.usagePerCustomer !== null &&
          Number(row.customerUsageCount) >= Number(row.usagePerCustomer)) ||
        (row.usagePerBusinessDate !== null &&
          Number(row.businessDateUsageCount) >= Number(row.usagePerBusinessDate))
      : false;
    const eligibility = row
      ? evaluateRewardEligibility({
          accountActive: true,
          availablePoints: Number(row.available),
          authorizedPoints: Number(row.authorized),
          customerActive: true,
          rewardActive:
            locationAllowed &&
            productScoped &&
            categoryScoped &&
            variantScoped &&
            modifierScoped &&
            Number(row.cartTotal) >= Number(row.minimumSpendMinorUnits) &&
            (tipMinorUnits === 0 || row.combinableWithTips),
          pointsCost: Number(row.pointsCost),
          existingDiscount: discountMinorUnits > 0,
          anotherReward: Number(row.otherRewardCount) > 0,
          tenderTypes,
          allowedTenderTypes: row.allowedTenderTypes,
          combinableWithDiscount: row.combinableWithDiscounts,
          combinableWithRewards: row.combinableWithRewards,
          usageCount: usageLimitReached ? 1 : 0,
          usageLimit: 1,
        })
      : { eligible: false, reasonCodes: ['reward_unavailable'] };
    if (!row || !eligibility.eligible || Number(row.saleUsageCount) >= Number(row.usagePerSale)) {
      throw new ConflictException({ code: 'REWARD_INELIGIBLE' });
    }
    const approvalFingerprint = commandFingerprint('pos.reward.approval.v1', {
      merchantId,
      locationId: dto.locationId,
      customerId: dto.customerId,
      loyaltyAccountId: row.accountId,
      rewardId: dto.rewardId,
      rewardVersion: Number(row.version),
      pointsCost: Number(row.pointsCost),
      financialBenefitMinorUnits: Math.min(
        Number(row.benefit),
        Number(row.maximumBenefitMinorUnits ?? row.benefit),
        Number(row.cartTotal),
      ),
      checkoutVersion: dto.checkoutVersion,
      rewardPreviewFingerprint: dto.previewFingerprint,
      storedValueFingerprint: dto.storedValueFingerprint ?? null,
    });
    if (row.approvalPermission) {
      if (!dto.storedValueFingerprint) {
        throw new ConflictException({ code: 'STORED_VALUE_PREVIEW_REQUIRED' });
      }
      if (!dto.approvalId || dto.approvalFingerprint !== approvalFingerprint) {
        throw new ConflictException({
          code: 'APPROVAL_REQUIRED',
          fieldErrors: {
            approvalPermission: [row.approvalPermission],
            approvalFingerprint: [approvalFingerprint],
          },
        });
      }
      await this.consumeApproval(
        client,
        merchantId,
        {
          ...dto,
          approvalId: dto.approvalId,
          approvalFingerprint: dto.approvalFingerprint,
        },
        authorization,
        row.approvalPermission,
        approvalFingerprint,
      );
    }
    const id = randomUUID();
    const fingerprint = commandFingerprint('pos.reward.authorize', dto);
    const inserted = await client.query<Row>(
      `INSERT INTO merchant.customer_value_authorization(
        id,merchant_id,location_id,account_type,account_id,customer_id,reward_id,sale_id,
        checkout_version,points,benefit_minor_units,checkout_fingerprint,policy_version,reward_version,command_id,
        idempotency_key,command_fingerprint,status,expires_at,correlation_id,policy_fingerprint,
        reward_policy_snapshot,operator_id,device_id,credential_version,approval_id,
        approval_fingerprint,stored_value_fingerprint,approval_tender_fingerprint)
       VALUES($1::uuid,$2::uuid,$3::uuid,'loyalty_reward',$4::uuid,$5::uuid,$6::uuid,$7::uuid,
        $8,$9,$10,$11,$12,$13,$14::uuid,$15::uuid,$16,'authorized',clock_timestamp()+interval '5 minutes',$17,
        $18,jsonb_build_object('rewardVersion',$13,'policyVersion',$12),$19::uuid,$20::uuid,$21,
        $22::uuid,$23,$24,$25)
       RETURNING created_at::text AS "createdAt",expires_at::text AS "expiresAt"`,
      [
        id,
        merchantId,
        dto.locationId,
        row.accountId,
        dto.customerId,
        dto.rewardId,
        dto.saleId,
        dto.checkoutVersion,
        row.pointsCost,
        Math.min(
          Number(row.benefit),
          Number(row.maximumBenefitMinorUnits ?? row.benefit),
          Number(row.cartTotal),
        ),
        dto.previewFingerprint,
        row.policyVersion,
        row.version,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
        correlationId,
        row.policyFingerprint ?? createHash('sha256').update(row.policyVersion).digest('hex'),
        authorization.operatorId,
        authorization.deviceId,
        authorization.credentialVersion,
        dto.approvalId ?? null,
        row.approvalPermission ? approvalFingerprint : null,
        null,
        row.approvalPermission ? dto.storedValueFingerprint : null,
      ],
    );
    await client.query(
      `SELECT merchant.append_loyalty_points($1::uuid,$2::uuid,$3::uuid,'points_authorized','hold',$4,
        'reward_authorization',$5::uuid,null,null,$6::uuid,$5::uuid,$7::uuid,$8::uuid,$9::uuid,$10::uuid,
        $11,current_date)`,
      [
        merchantId,
        dto.customerId,
        row.accountId,
        row.pointsCost,
        id,
        dto.rewardId,
        authorization.operatorId,
        authorization.deviceId,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
      ],
    );
    return {
      id,
      customerId: dto.customerId,
      accountId: row.accountId,
      rewardId: dto.rewardId,
      saleId: dto.saleId,
      checkoutVersion: dto.checkoutVersion,
      points: Number(row.pointsCost),
      benefit: {
        minorUnits: Math.min(
          Number(row.benefit ?? 0),
          Number(row.maximumBenefitMinorUnits ?? row.benefit ?? 0),
          Number(row.cartTotal),
        ),
        currency: row.currency,
      },
      rewardVersion: Number(row.version),
      policyVersion: row.policyVersion,
      fingerprint,
      status: 'authorized',
      createdAt: inserted.rows[0].createdAt,
      expiresAt: inserted.rows[0].expiresAt,
    };
  }

  async authorizeStoredValue(
    client: PoolClient,
    merchantId: string,
    dto: StoredValueAuthorizationRequest,
    authorization: CustomerValueAuthorization,
    correlationId: string,
  ): Promise<StoredValueAuthorization> {
    const table = dto.accountType === 'wallet' ? 'loyalty_card' : 'loyalty_gift_card';
    const key = dto.accountType === 'wallet' ? 'card_id' : 'gift_card_id';
    const ledger =
      dto.accountType === 'wallet' ? 'loyalty_stored_value_ledger' : 'loyalty_gift_card_ledger';
    const account = await client.query<Row>(
      `SELECT a.id::text,a.currency,a.status,a.version,
         a.customer_id::text AS "customerId",
         coalesce((select sum(l.delta) from merchant.${ledger} l where l.${key}=a.id),0)::bigint
         -coalesce((select sum(v.amount_minor_units) from merchant.customer_value_authorization v
           where v.account_type=$2 and v.account_id=a.id and v.status='authorized' and v.expires_at>clock_timestamp()),0)::bigint AS available
       FROM merchant.${table} a WHERE a.id=$1::uuid AND a.merchant_id=$3::uuid FOR UPDATE`,
      [dto.accountId, dto.accountType, merchantId],
    );
    const row = account.rows[0];
    if (!row || row.status !== 'active')
      throw new ConflictException({ code: 'GIFT_CARD_INACTIVE' });
    if (dto.accountType === 'wallet' && row.customerId !== dto.customerId) {
      throw new ConflictException({ code: 'CUSTOMER_MERCHANT_SCOPE' });
    }
    if (row.currency !== dto.amount.currency)
      throw new ConflictException({ code: 'STORED_VALUE_CURRENCY_MISMATCH' });
    if (Number(row.available) < dto.amount.minorUnits)
      throw new ConflictException({ code: 'STORED_VALUE_INSUFFICIENT_BALANCE' });
    const id = randomUUID();
    const fingerprint = commandFingerprint('pos.stored-value.authorize', dto);
    const inserted = await client.query<Row>(
      `INSERT INTO merchant.customer_value_authorization(
        id,merchant_id,location_id,account_type,account_id,customer_id,sale_id,checkout_version,
        amount_minor_units,currency,checkout_fingerprint,policy_version,command_id,idempotency_key,
        command_fingerprint,status,expires_at,correlation_id,policy_fingerprint,operator_id,device_id,
        credential_version,allocation_id,allocation_order,allocation_fingerprint,
        remaining_balance_minor_units,optimistic_version)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,
        'pilot-deny-v1',$12::uuid,$13::uuid,$14,'authorized',clock_timestamp()+interval '5 minutes',$15,
        $16,$17::uuid,$18::uuid,$19,$20::uuid,$21,$14,$22,$23)
       RETURNING created_at::text AS "createdAt",expires_at::text AS "expiresAt"`,
      [
        id,
        merchantId,
        dto.locationId,
        dto.accountType,
        dto.accountId,
        dto.customerId,
        dto.saleId,
        dto.checkoutVersion,
        dto.amount.minorUnits,
        dto.amount.currency,
        dto.checkoutFingerprint,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
        correlationId,
        createHash('sha256').update(`pilot-deny-v1:${dto.accountType}`).digest('hex'),
        authorization.operatorId,
        authorization.deviceId,
        authorization.credentialVersion,
        dto.allocationId,
        dto.allocationOrder,
        Number(row.available) - dto.amount.minorUnits,
        Number(row.version),
      ],
    );
    if (dto.accountType === 'wallet') {
      await client.query(
        `SELECT merchant.append_stored_value_fact($1::uuid,$2::uuid,jsonb_build_object(
          'delta',0,'amountMinorUnits',$3,'reason','authorized','idempotencyKey',$4::text,
          'entryType','authorized','currency',$5,'direction','hold','authorizationId',$6::text,
          'commandId',$7::text,'fingerprint',$8,'operatorId',$9::text,'deviceId',$10::text,
          'businessDate',current_date,'sourceType','stored_value_authorization','sourceId',$6::text))`,
        [
          merchantId,
          dto.accountId,
          dto.amount.minorUnits,
          dto.idempotencyKey,
          dto.amount.currency,
          id,
          dto.commandId,
          fingerprint,
          authorization.operatorId,
          authorization.deviceId,
        ],
      );
    } else {
      await client.query(
        `SELECT merchant.append_gift_card_fact($1::uuid,$2::uuid,jsonb_build_object(
          'delta',0,'amountMinorUnits',$3,'reason','authorized','entryType','authorized',
          'currency',$4,'direction','hold','authorizationId',$5::text,'commandId',$6::text,
          'idempotencyKey',$7::text,'fingerprint',$8,'operatorId',$9::text,'deviceId',$10::text,
          'businessDate',current_date,'sourceType','stored_value_authorization','sourceId',$5::text))`,
        [
          merchantId,
          dto.accountId,
          dto.amount.minorUnits,
          dto.amount.currency,
          id,
          dto.commandId,
          dto.idempotencyKey,
          fingerprint,
          authorization.operatorId,
          authorization.deviceId,
        ],
      );
    }
    return {
      id,
      accountType: dto.accountType,
      accountId: dto.accountId,
      customerId: dto.customerId,
      currency: dto.amount.currency,
      saleId: dto.saleId,
      checkoutVersion: dto.checkoutVersion,
      amountMinorUnits: dto.amount.minorUnits,
      fingerprint,
      status: 'authorized',
      remainingBalanceMinorUnits: Number(row.available) - dto.amount.minorUnits,
      allocationId: dto.allocationId,
      allocationOrder: dto.allocationOrder,
      allocationFingerprint: fingerprint,
      createdAt: inserted.rows[0].createdAt,
      expiresAt: inserted.rows[0].expiresAt,
      correlationId,
    };
  }

  async release(
    client: PoolClient,
    merchantId: string,
    dto: ValueReleaseRequest,
    type: 'reward' | 'stored_value',
    authorization: CustomerValueAuthorization,
  ) {
    const found = await client.query<Row>(
      `SELECT * FROM merchant.customer_value_authorization
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          AND status='authorized' AND command_fingerprint=$4 FOR UPDATE`,
      [dto.authorizationId, merchantId, dto.locationId, dto.fingerprint],
    );
    const row = found.rows[0];
    if (!row) throw new ConflictException({ code: 'STORED_VALUE_AUTHORIZATION_EXPIRED' });
    if (row.account_type !== dto.accountType) {
      throw new ConflictException({ code: 'CUSTOMER_VALUE_ACCOUNT_TYPE_INVALID' });
    }
    if (type === 'reward') {
      await client.query(
        `SELECT merchant.append_loyalty_points($1::uuid,$2::uuid,$3::uuid,'points_released','release',$4,
          'reward_authorization',$5::uuid,null,null,$6::uuid,$5::uuid,$7::uuid,$8::uuid,$9::uuid,$10::uuid,
          $11,current_date)`,
        [
          merchantId,
          row.customer_id,
          row.account_id,
          row.points,
          row.id,
          row.reward_id,
          authorization.operatorId,
          authorization.deviceId,
          dto.commandId,
          dto.idempotencyKey,
          dto.fingerprint,
        ],
      );
    } else if (row.account_type === 'wallet') {
      await client.query(
        `SELECT merchant.append_stored_value_fact($1::uuid,$2::uuid,jsonb_build_object(
          'delta',0,'amountMinorUnits',$3,'reason','authorization_released',
          'idempotencyKey',$4::text,'entryType','authorization_released','currency',$5,
          'direction','release','authorizationId',$6::text,'commandId',$7::text,
          'fingerprint',$8,'operatorId',$9::text,'deviceId',$10::text,
          'businessDate',current_date,'sourceType','stored_value_authorization','sourceId',$6::text))`,
        [
          merchantId,
          row.account_id,
          row.amount_minor_units,
          dto.idempotencyKey,
          row.currency,
          row.id,
          dto.commandId,
          dto.fingerprint,
          authorization.operatorId,
          authorization.deviceId,
        ],
      );
    } else {
      await client.query(
        `SELECT merchant.append_gift_card_fact($1::uuid,$2::uuid,jsonb_build_object(
          'delta',0,'amountMinorUnits',$3,'reason','authorization_released',
          'entryType','authorization_released','currency',$4,'direction','release',
          'authorizationId',$5::text,'commandId',$6::text,'idempotencyKey',$7::text,
          'fingerprint',$8,'operatorId',$9::text,'deviceId',$10::text,
          'businessDate',current_date,'sourceType','stored_value_authorization','sourceId',$5::text))`,
        [
          merchantId,
          row.account_id,
          row.amount_minor_units,
          row.currency,
          row.id,
          dto.commandId,
          dto.idempotencyKey,
          dto.fingerprint,
          authorization.operatorId,
          authorization.deviceId,
        ],
      );
    }
    const released = await client.query<{ releasedAt: string }>(
      `UPDATE merchant.customer_value_authorization SET status='released',released_at=clock_timestamp()
        WHERE id=$1::uuid AND status='authorized' RETURNING released_at::text AS "releasedAt"`,
      [dto.authorizationId],
    );
    return {
      authorizationId: dto.authorizationId,
      status: 'released' as const,
      releasedAt: released.rows[0].releasedAt,
    };
  }

  async giftCardLookup(
    userId: string,
    merchantId: string,
    dto: GiftCardLookupRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<GiftCardLookupResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const codeHash = createHash('sha256').update(dto.code).digest();
        const bucket = (dimension: string) =>
          createHmac('sha256', this.customerValueKey()).update(dimension).digest();
        const bucketHashes = [
          bucket(`device:${merchantId}:${dto.locationId}:${authorization.deviceId}`),
          bucket(`operator:${merchantId}:${authorization.operatorId}`),
          bucket(`code:${merchantId}:${codeHash.subarray(0, 4).toString('hex')}`),
        ];
        const budget = await client.query<{ allowed: boolean; retryAfterSeconds: number }>(
          `SELECT bool_and(result.allowed) AS allowed,
                  max(result.retry_after_seconds)::int AS "retryAfterSeconds"
             FROM unnest($3::bytea[]) key(bucket_hash)
             CROSS JOIN LATERAL merchant.consume_gift_card_lookup_budget(
               $1::uuid,$2::uuid,key.bucket_hash) result`,
          [merchantId, dto.locationId, bucketHashes],
        );
        if (!budget.rows[0]?.allowed) {
          return {
            found: false,
            retryAfterSeconds: Number(budget.rows[0]?.retryAfterSeconds ?? 30),
            card: null,
            reasonCode: 'temporarily_locked',
          };
        }
        const { rows } = await client.query<Row>(
          `SELECT g.id::text,g.public_reference AS "publicReference",g.masked_code AS "maskedCode",
          g.status,g.currency,g.amount_cents::int AS "initialValue",g.activated_at::text AS "activatedAt",
          g.expires_at::text AS "expiresAt",g.customer_id::text AS "customerId",g.version,
          coalesce(sum(l.delta),0)::int AS available,max(coalesce(l.sequence,0))::int AS sequence
         FROM merchant.loyalty_gift_card g LEFT JOIN merchant.loyalty_gift_card_ledger l ON l.gift_card_id=g.id
        WHERE g.merchant_id=$1::uuid AND g.code_hash=extensions.digest($2,'sha256')
        GROUP BY g.id LIMIT 1`,
          [merchantId, dto.code],
        );
        if (!rows[0]) {
          return { found: false, retryAfterSeconds: 0, card: null, reasonCode: 'unavailable' };
        }
        return {
          found: true,
          retryAfterSeconds: 0,
          card: this.giftCard(rows[0]),
          reasonCode: 'available',
        };
      },
      dto.locationId,
    );
  }

  async previewPointsAdjustment(
    userId: string,
    merchantId: string,
    dto: PointsAdjustmentRequest,
  ): Promise<PointsAdjustmentPreview> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const fingerprint = this.approvalFingerprint('pos.points.adjust', dto);
        const { rows } = await client.query<Row>(
          `SELECT merchant.preview_points_adjustment($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7) value`,
          [
            merchantId,
            dto.customerId,
            dto.accountId,
            dto.direction,
            dto.points,
            dto.reason,
            fingerprint,
          ],
        );
        const value = rows[0].value;
        return {
          accountId: dto.accountId,
          currentAvailable: Number(value.currentPoints),
          projectedAvailable: Number(value.projectedPoints),
          approvalPermission: value.approvalRequired ? 'loyalty.adjust.approve' : null,
          fingerprint,
        };
      },
      dto.locationId,
    );
  }

  async pointsAccountCustomer(
    userId: string,
    merchantId: string,
    locationId: string,
    accountId: string,
  ): Promise<string> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const result = await client.query<{ customerId: string }>(
          `SELECT customer_id::text AS "customerId"
             FROM merchant.loyalty_points_account
            WHERE merchant_id=$1::uuid AND id=$2::uuid AND status='active'`,
          [merchantId, accountId],
        );
        if (!result.rows[0]) throw new ConflictException({ code: 'LOYALTY_ACCOUNT_NOT_FOUND' });
        return result.rows[0].customerId;
      },
      locationId,
    );
  }

  async commitPointsAdjustment(
    client: PoolClient,
    merchantId: string,
    dto: PointsAdjustmentRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<PointsAdjustmentResult> {
    const fingerprint = this.approvalFingerprint('pos.points.adjust', dto);
    if (dto.points > 500) {
      await this.consumeApproval(
        client,
        merchantId,
        dto,
        authorization,
        'loyalty.adjust.approve',
        fingerprint,
      );
    }
    const result = await client.query<{ id: string }>(
      `SELECT merchant.commit_points_adjustment(
        $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11,current_date
      )::text id`,
      [
        merchantId,
        dto.customerId,
        dto.accountId,
        dto.direction,
        dto.points,
        dto.reason,
        authorization.operatorId,
        authorization.deviceId,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
      ],
    );
    const { rows } = await client.query<Row>(
      `SELECT l.id::text,l.account_id::text AS "accountId",l.customer_id::text AS "customerId",
        l.sequence::int,l.entry_type AS type,l.points::int,l.direction,l.sale_id::text AS "saleId",
        l.refund_id::text AS "refundId",l.reward_id::text AS "rewardId",l.command_id::text AS "commandId",
        l.business_date::text AS "businessDate",l.occurred_at::text AS "occurredAt",
        b.pending::int,b.available::int,b.authorized::int,b.redeemed::int,b.reversed::int,
        b.expired::int,b.adjusted::int,b.ledger_sequence::int AS "ledgerSequence",
        b.projection_version::int AS "projectionVersion",b.calculated_at::text AS "calculatedAt"
       FROM merchant.loyalty_points_ledger l
       JOIN merchant.loyalty_points_balance b ON b.account_id=l.account_id
       WHERE l.id=$1::uuid`,
      [result.rows[0].id],
    );
    const row = rows[0];
    return {
      ledgerEntry: {
        id: row.id,
        accountId: row.accountId,
        customerId: row.customerId,
        sequence: Number(row.sequence),
        type: row.type,
        points: Number(row.points),
        direction: row.direction,
        saleId: row.saleId,
        refundId: row.refundId,
        rewardId: row.rewardId,
        commandId: row.commandId,
        businessDate: row.businessDate,
        occurredAt: row.occurredAt,
      },
      balance: {
        accountId: row.accountId,
        earned: Number(row.available) + Number(row.redeemed),
        pending: Number(row.pending),
        available: Number(row.available),
        authorized: Number(row.authorized),
        redeemed: Number(row.redeemed),
        reversed: Number(row.reversed),
        expired: Number(row.expired),
        adjusted: Number(row.adjusted),
        ledgerSequence: Number(row.ledgerSequence),
        projectionVersion: Number(row.projectionVersion),
        calculatedAt: row.calculatedAt,
      },
      recovered: false,
    };
  }

  async issueGiftCard(
    client: PoolClient,
    merchantId: string,
    dto: GiftCardIssuanceRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<Omit<GiftCardIssuanceResult, 'deliveryToken'>> {
    const fingerprint = this.approvalFingerprint('pos.gift-card.issue', dto);
    if (dto.source !== 'development') {
      await this.consumeApproval(
        client,
        merchantId,
        dto,
        authorization,
        'gift_card.issue.approve',
        fingerprint,
      );
    } else if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ConflictException({ code: 'GIFT_CARD_DEVELOPMENT_ISSUANCE_DISABLED' });
    }
    if (dto.source === 'sale' && (!dto.saleId || !dto.saleLineId)) {
      throw new ConflictException({ code: 'GIFT_CARD_FUNDING_REQUIRED' });
    }
    if (dto.source === 'sale') {
      const product = await client.query(
        `SELECT 1 FROM merchant.pos_cart_line line
          JOIN merchant.product product ON product.id=line.product_id
            AND product.merchant_id=$1::uuid AND product.active
            AND product.sale_action='gift_card'
         WHERE line.cart_id=$2::uuid AND line.id=$3::uuid`,
        [merchantId, dto.saleId, dto.saleLineId],
      );
      if (product.rowCount !== 1) {
        throw new ConflictException({ code: 'GIFT_CARD_PRODUCT_REQUIRED' });
      }
    }
    const id = randomUUID();
    const fundingAssignmentId = dto.source === 'sale' ? randomUUID() : null;
    const fundingFingerprint =
      dto.source === 'sale'
        ? commandFingerprint('pos.gift-card.sale-funding.v1', {
            assignmentId: fundingAssignmentId,
            giftCardId: id,
            merchantId,
            locationId: dto.locationId,
            cartId: dto.saleId,
            saleLineId: dto.saleLineId,
            purchasedValue: {
              minorUnits: dto.initialValueMinorUnits,
              currency: dto.currency,
            },
            policyId: 'gift-card-sale-funding',
            policyVersion: 'pilot-v1',
          })
        : null;
    const code = `UMI-${randomBytes(18).toString('base64url')}`;
    const deliveryToken = this.giftCardDeliveryToken(dto.commandId);
    const active = dto.source === 'promotion' || dto.source === 'development';
    const card = await client.query<Row>(
      `INSERT INTO merchant.loyalty_gift_card(
        id,merchant_id,code,public_reference,status,currency,amount_cents,customer_id,location_id,
        issuance_command_id,issuance_fingerprint,issuance_policy_version,issuer_operator_id,
        issuer_device_id,issuance_source,activated_at,pending_funding_cart_id,
        pending_funding_minor_units,pending_funding_assignment_id,pending_funding_line_id,
        pending_funding_fingerprint)
       VALUES($1::uuid,$2::uuid,$3,'GFT-'||$1::text,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,$10,
        'pilot-v1',$11::uuid,$12::uuid,$13,
        case when $4='active' then clock_timestamp() end,$14::uuid,$15,$16::uuid,$17::uuid,$18)
       RETURNING id::text,public_reference AS "publicReference",masked_code AS "maskedCode",status,
        currency,amount_cents::int AS "initialValue",activated_at::text AS "activatedAt",
        expires_at::text AS "expiresAt",customer_id::text AS "customerId",version`,
      [
        id,
        merchantId,
        code,
        active ? 'active' : 'inactive',
        dto.currency,
        dto.initialValueMinorUnits,
        dto.customerId,
        dto.locationId,
        dto.commandId,
        fingerprint,
        authorization.operatorId,
        authorization.deviceId,
        dto.source,
        dto.source === 'sale' ? dto.saleId : null,
        dto.source === 'sale' ? dto.initialValueMinorUnits : null,
        fundingAssignmentId,
        dto.source === 'sale' ? dto.saleLineId : null,
        fundingFingerprint,
      ],
    );
    if (active) {
      await client.query(
        `SELECT merchant.append_gift_card_fact($1::uuid,$2::uuid,jsonb_build_object(
          'delta',$3::bigint,'amountMinorUnits',$3::bigint,'reason','issued',
          'entryType','issued','currency',$4::text,
          'direction','credit','commandId',$5::text,'idempotencyKey',$6::text,
          'fingerprint',$7::text,
          'operatorId',$8::text,'deviceId',$9::text,'businessDate',current_date,
          'sourceType','gift_card_issuance','sourceId',$2::text,'saleId',$10::text))`,
        [
          merchantId,
          id,
          dto.initialValueMinorUnits,
          dto.currency,
          dto.commandId,
          dto.idempotencyKey,
          fingerprint,
          authorization.operatorId,
          authorization.deviceId,
          dto.saleId,
        ],
      );
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.customerValueKey(), nonce);
    const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const deliveryExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await client.query(
      `SELECT merchant.store_gift_card_secret_delivery(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6::bytea,$7::bytea,$8::bytea,
        $9::uuid,$10::uuid,$11::timestamptz)`,
      [
        merchantId,
        dto.locationId,
        id,
        dto.commandId,
        createHash('sha256').update(deliveryToken).digest(),
        ciphertext,
        nonce,
        tag,
        authorization.operatorId,
        authorization.deviceId,
        deliveryExpiresAt,
      ],
    );
    return {
      card: this.giftCard({
        ...card.rows[0],
        available: active ? dto.initialValueMinorUnits : 0,
        sequence: active ? 1 : 0,
      }),
      deliveryExpiresAt,
      recovered: false,
      fundingAssignment:
        dto.source === 'sale'
          ? {
              assignmentId: fundingAssignmentId!,
              giftCardId: id,
              saleLineId: dto.saleLineId!,
              purchasedValue: {
                minorUnits: dto.initialValueMinorUnits,
                currency: dto.currency,
              },
              policyId: 'gift-card-sale-funding',
              policyVersion: 'pilot-v1',
              fingerprint: fundingFingerprint!,
            }
          : null,
    };
  }

  giftCardDeliveryToken(commandId: string): string {
    return createHmac('sha256', this.customerValueKey())
      .update(`gift-card-delivery:${commandId}`)
      .digest('base64url');
  }

  previewGiftCardIssuance(dto: GiftCardIssuanceRequest): GiftCardIssuancePreview {
    const maximumValueMinorUnits = 10_000_000;
    if (dto.initialValueMinorUnits > maximumValueMinorUnits) {
      throw new ConflictException({ code: 'GIFT_CARD_VALUE_LIMIT' });
    }
    return {
      currency: dto.currency,
      valueMinorUnits: dto.initialValueMinorUnits,
      maximumValueMinorUnits,
      approvalPermission: dto.source === 'development' ? null : 'gift_card.issue.approve',
      fingerprint: this.approvalFingerprint('pos.gift-card.issue', dto),
    };
  }

  async revealGiftCardSecret(
    userId: string,
    merchantId: string,
    dto: GiftCardSecretRevealRequest,
    authorization: CustomerValueAuthorization,
  ): Promise<GiftCardSecretRevealResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const tokenHash = createHash('sha256').update(dto.deliveryToken).digest();
        const { rows } = await client.query<Row>(
          `SELECT public_reference,ciphertext,nonce,auth_tag,expires_at::text AS "expiresAt"
           FROM merchant.reveal_gift_card_secret_delivery(
             $1::uuid,$2::uuid,$3::bytea,$4::uuid,$6::uuid,$5::uuid)`,
          [
            merchantId,
            dto.locationId,
            tokenHash,
            authorization.operatorId,
            dto.commandId,
            authorization.deviceId,
          ],
        );
        if (!rows[0]) throw new ConflictException({ code: 'GIFT_CARD_SECRET_UNAVAILABLE' });
        const decipher = createDecipheriv('aes-256-gcm', this.customerValueKey(), rows[0].nonce);
        decipher.setAuthTag(rows[0].auth_tag);
        const code = Buffer.concat([
          decipher.update(rows[0].ciphertext),
          decipher.final(),
        ]).toString('utf8');
        return { maskedReference: rows[0].public_reference, code, expiresAt: rows[0].expiresAt };
      },
      dto.locationId,
    );
  }

  command(
    userId: string,
    merchantId: string,
    commandId: string,
    query: CustomerValueRecoveryQuery,
    authorization: CustomerValueAuthorization,
  ): Promise<CustomerValueRecoveryResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{
          status: 'processing' | 'succeeded' | 'failed';
          response: unknown;
          failureCode: string | null;
          correlationId: string;
          commandType: string;
        }>(
          `SELECT status,response_data AS response,failure_code AS "failureCode",
                  command_type AS "commandType",
                  correlation_id AS "correlationId"
             FROM merchant.business_command
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND command_id=$3::uuid
              AND (command_type LIKE 'pos.customer%'
                OR command_type IN ('pos.reward.authorize','pos.reward.release',
                  'pos.stored-value.authorize','pos.stored-value.release','pos.gift-card.activate',
                  'pos.gift-card.issue','pos.points.adjust'))
            LIMIT 1`,
          [merchantId, query.locationId, commandId],
        );
        const row = rows[0];
        if (
          row?.commandType === 'pos.gift-card.issue' &&
          !authorization.permissions.includes('*') &&
          !authorization.permissions.includes('gift_card.issue')
        ) {
          throw new ConflictException({ code: 'PERMISSION_DENIED' });
        }
        const responseStatus =
          row?.response && typeof row.response === 'object' && 'status' in row.response
            ? String(row.response.status)
            : null;
        return {
          commandId,
          state: !row
            ? ('none' as const)
            : row.status === 'processing'
              ? ('pending' as const)
              : row.status === 'failed'
                ? ('support_required' as const)
                : responseStatus === 'released'
                  ? ('released' as const)
                  : ('committed' as const),
          result: row?.response ?? null,
          conflict:
            row?.status === 'failed'
              ? {
                  code: 'command_failed' as const,
                  actionCode: row.failureCode ?? 'review_original_command',
                  requiredPermission: null,
                  correlationId: row.correlationId,
                }
              : null,
          recoveredAt: new Date().toISOString(),
        };
      },
      query.locationId,
    );
  }

  async activateGiftCard(
    client: PoolClient,
    merchantId: string,
    dto: GiftCardActivation,
    authorization: CustomerValueAuthorization,
  ): Promise<GiftCard> {
    await this.consumeApproval(
      client,
      merchantId,
      dto,
      authorization,
      'gift_card.activate.approve',
      this.approvalFingerprint('pos.gift-card.activate', dto),
    );
    const card = await client.query<Row>(
      `UPDATE merchant.loyalty_gift_card SET status='active',activated_at=clock_timestamp(),
        amount_cents=$3,version=version+1 WHERE id=$1::uuid AND merchant_id=$2::uuid
        AND status IN ('created','inactive') AND currency=$4
       RETURNING id::text,public_reference AS "publicReference",masked_code AS "maskedCode",status,
        currency,amount_cents::int AS "initialValue",activated_at::text AS "activatedAt",
        expires_at::text AS "expiresAt",customer_id::text AS "customerId",version,ledger_sequence`,
      [dto.giftCardId, merchantId, dto.initialValue.minorUnits, dto.initialValue.currency],
    );
    if (!card.rows[0]) throw new ConflictException({ code: 'GIFT_CARD_INACTIVE' });
    await client.query(
      `SELECT merchant.append_gift_card_fact($1::uuid,$2::uuid,jsonb_build_object(
        'delta',$3,'amountMinorUnits',$3,'reason','issued','entryType','issued','currency',$4,
        'direction','credit','commandId',$5::text,'idempotencyKey',$6::text,'fingerprint',$7,
        'operatorId',$8::text,'deviceId',$9::text,'businessDate',current_date,
        'sourceType','gift_card_activation','sourceId',$2::text))`,
      [
        merchantId,
        dto.giftCardId,
        dto.initialValue.minorUnits,
        dto.initialValue.currency,
        dto.commandId,
        dto.idempotencyKey,
        commandFingerprint('pos.gift-card.activate', dto),
        authorization.operatorId,
        authorization.deviceId,
      ],
    );
    return this.giftCard({ ...card.rows[0], available: dto.initialValue.minorUnits, sequence: 1 });
  }

  async merge(
    client: PoolClient,
    merchantId: string,
    dto: CustomerMergeRequest,
    authorization: CustomerValueAuthorization,
  ) {
    const customers = await client.query(
      `SELECT id FROM merchant.customer
       WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND status='active'
       ORDER BY id FOR UPDATE`,
      [merchantId, [dto.sourceCustomerId, dto.targetCustomerId]],
    );
    if (customers.rowCount !== 2) {
      throw new ConflictException({ code: 'CUSTOMER_MERCHANT_SCOPE' });
    }
    await client.query(
      `SELECT id FROM merchant.loyalty_points_account
       WHERE merchant_id=$1::uuid AND customer_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [merchantId, [dto.sourceCustomerId, dto.targetCustomerId]],
    );
    await client.query(
      `SELECT id FROM merchant.loyalty_card
       WHERE merchant_id=$1::uuid AND customer_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [merchantId, [dto.sourceCustomerId, dto.targetCustomerId]],
    );
    await client.query(
      `SELECT id FROM merchant.loyalty_gift_card
       WHERE merchant_id=$1::uuid AND customer_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [merchantId, [dto.sourceCustomerId, dto.targetCustomerId]],
    );
    await client.query(
      `SELECT customer_id,consent_type FROM merchant.customer_consent_current
       WHERE merchant_id=$1::uuid AND customer_id=ANY($2::uuid[])
       ORDER BY customer_id,consent_type FOR UPDATE`,
      [merchantId, [dto.sourceCustomerId, dto.targetCustomerId]],
    );
    const value = await client.query(
      `SELECT exists(select 1 from merchant.loyalty_points_account where merchant_id=$1::uuid and customer_id in ($2::uuid,$3::uuid))
        or exists(select 1 from merchant.loyalty_card where merchant_id=$1::uuid and customer_id in ($2::uuid,$3::uuid))
        or exists(select 1 from merchant.loyalty_gift_card where merchant_id=$1::uuid
          and customer_id in ($2::uuid,$3::uuid))
        or (select coalesce(jsonb_object_agg(consent_type,status),'{}'::jsonb)
              from merchant.customer_consent_current where merchant_id=$1::uuid and customer_id=$2::uuid)
           is distinct from
           (select coalesce(jsonb_object_agg(consent_type,status),'{}'::jsonb)
              from merchant.customer_consent_current where merchant_id=$1::uuid and customer_id=$3::uuid)
        AS conflict`,
      [merchantId, dto.sourceCustomerId, dto.targetCustomerId],
    );
    if (value.rows[0]?.conflict) {
      return {
        sourceCustomerId: dto.sourceCustomerId,
        targetCustomerId: dto.targetCustomerId,
        status: 'value_reconciliation_required' as const,
        recovered: false,
        correlationId: 'value-reconciliation-required',
      };
    }
    const fingerprint = this.approvalFingerprint('pos.customer.merge', dto);
    await this.consumeApproval(
      client,
      merchantId,
      dto,
      authorization,
      'customer.merge.approve',
      fingerprint,
    );
    const merged = await client.query(
      `UPDATE merchant.customer SET merged_into_id=$3::uuid,status='merged',version=version+1
        WHERE id=$2::uuid AND merchant_id=$1::uuid AND status='active'
          AND EXISTS(SELECT 1 FROM merchant.customer target
            WHERE target.id=$3::uuid AND target.merchant_id=$1::uuid AND target.status='active')
        RETURNING id`,
      [merchantId, dto.sourceCustomerId, dto.targetCustomerId],
    );
    if (merged.rowCount !== 1) {
      throw new ConflictException({ code: 'CUSTOMER_MERCHANT_SCOPE' });
    }
    await client.query(
      `INSERT INTO merchant.customer_merge_mapping(
        merchant_id,source_customer_id,target_customer_id,status,command_id,
        command_fingerprint,approval_id,committed_at)
       VALUES($1::uuid,$2::uuid,$3::uuid,'committed',$4::uuid,$5,$6::uuid,clock_timestamp())`,
      [
        merchantId,
        dto.sourceCustomerId,
        dto.targetCustomerId,
        dto.commandId,
        fingerprint,
        dto.approvalId,
      ],
    );
    return {
      sourceCustomerId: dto.sourceCustomerId,
      targetCustomerId: dto.targetCustomerId,
      status: 'merged' as const,
      recovered: false,
      correlationId: 'customer-merged',
    };
  }

  private approvalFingerprint(
    operation: string,
    dto: { approvalId: string | null; approvalFingerprint: string | null },
  ) {
    const { approvalId: _approvalId, approvalFingerprint: _approvalFingerprint, ...command } = dto;
    return commandFingerprint(operation, command);
  }

  private async consumeApproval(
    client: PoolClient,
    merchantId: string,
    dto: {
      locationId: string;
      commandId: string;
      approvalId: string | null;
      approvalFingerprint: string | null;
    },
    authorization: CustomerValueAuthorization,
    permission: string,
    expectedFingerprint: string,
  ) {
    if (dto.approvalFingerprint !== expectedFingerprint) {
      throw new ConflictException({ code: 'APPROVAL_FINGERPRINT_MISMATCH' });
    }
    const consumed = await client.query(
      `UPDATE runtime.elevation_grant
          SET consumed_at=clock_timestamp(),consumed_by_command_id=$6::uuid
        WHERE id=$1::uuid
          AND (
            ($2::uuid IS NOT NULL AND session_id=$2::uuid AND dashboard_session_id IS NULL)
            OR ($9::uuid IS NOT NULL AND dashboard_session_id=$9::uuid AND session_id IS NULL)
          )
          AND merchant_id=$3::uuid
          AND location_id=$4::uuid AND permission_key=$5
          AND command_fingerprint=$7 AND method='manager_approval'
          AND approved_by<>$8::uuid AND expires_at>clock_timestamp()
          AND consumed_at IS NULL`,
      [
        dto.approvalId,
        authorization.durableSessionId,
        merchantId,
        dto.locationId,
        permission,
        dto.commandId,
        expectedFingerprint,
        authorization.operatorId,
        authorization.dashboardSessionId,
      ],
    );
    if (consumed.rowCount !== 1) {
      throw new ConflictException({ code: 'APPROVAL_INVALID' });
    }
  }

  private async duplicateCandidates(
    client: PoolClient,
    merchantId: string,
    dto: CreateCustomerRequest,
  ) {
    const values = dto.contacts.map(
      (contact) => normalizeCustomerContact(contact.type, contact.value).normalizedValue,
    );
    if (values.length === 0) return [];
    const { rows } = await client.query<{ publicReference: string }>(
      `SELECT DISTINCT c.public_reference AS "publicReference" FROM merchant.customer c
       JOIN merchant.contact ct ON ct.customer_id=c.id AND ct.merchant_id=c.merchant_id
       WHERE c.merchant_id=$1::uuid AND ct.normalized_value=any($2::text[]) LIMIT 10`,
      [merchantId, values],
    );
    return rows;
  }

  private async customerSummary(client: PoolClient, merchantId: string, customerId: string) {
    const { rows } = await client.query<Row>(
      `SELECT id::text,public_reference AS "publicReference",coalesce(name,'Cliente') AS "displayName",
        status,preferred_language AS "preferredLanguage",version,privacy_state AS privacy,
        created_at::text AS "createdAt",updated_at::text AS "updatedAt",'[]'::jsonb contacts,'[]'::jsonb consents
       FROM merchant.customer WHERE id=$1::uuid AND merchant_id=$2::uuid`,
      [customerId, merchantId],
    );
    if (!rows[0]) throw new ConflictException({ code: 'CUSTOMER_MERCHANT_SCOPE' });
    return this.profile(rows[0], false);
  }

  private profile(row: Row, showContact: boolean): CustomerProfile {
    const privacy = row.privacy ?? {};
    return {
      id: row.id,
      publicReference: row.publicReference,
      displayName: row.displayName,
      status: row.status,
      preferredLanguage: row.preferredLanguage,
      version: Number(row.version),
      contacts: (row.contacts ?? []).map((contact: Row) => {
        const maskedValue = masks(
          contact.type,
          contact.normalizedValue ?? contact.maskedValue ?? contact.displayValue,
        );
        return {
          id: contact.id,
          type: contact.type,
          displayValue: showContact ? contact.displayValue : maskedValue,
          maskedValue,
          verification: contact.verification,
          primary: contact.primary,
        };
      }),
      consents: row.consents ?? [],
      privacy: {
        dataMinimized: privacy.dataMinimized ?? true,
        contactVisibility: privacy.contactVisibility ?? 'limited',
        version: Number(privacy.version ?? 1),
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private account(row: Row) {
    return {
      id: row.id,
      customerId: row.customerId,
      programReference: row.programReference,
      status: row.status,
      pointsScale: 0 as const,
      ledgerSequence: Number(row.ledgerSequence),
      version: Number(row.version),
      enrolledAt: row.enrolledAt,
    };
  }

  private points(row: Row) {
    return {
      accountId: row.id,
      earned: Number(row.available) + Number(row.redeemed),
      pending: Number(row.pending),
      available: Number(row.available),
      authorized: Number(row.authorized),
      redeemed: Number(row.redeemed),
      reversed: Number(row.reversed),
      expired: Number(row.expired),
      adjusted: Number(row.adjusted),
      ledgerSequence: Number(row.ledgerSequence),
      projectionVersion: Number(row.projectionVersion),
      calculatedAt: row.calculatedAt,
    };
  }

  private wallet(row: Row) {
    return {
      accountId: row.accountId,
      currency: row.currency,
      issued: Number(row.issued),
      loaded: Number(row.loaded),
      available: Number(row.available),
      authorized: Number(row.authorized),
      redeemed: Number(row.redeemed),
      refunded: Number(row.refunded),
      reversed: Number(row.reversed),
      adjusted: Number(row.adjusted),
      ledgerSequence: Number(row.ledgerSequence),
      projectionVersion: Number(row.projectionVersion),
      calculatedAt: row.calculatedAt,
    };
  }

  private giftCard(row: Row): GiftCard {
    return {
      id: row.id,
      publicReference: row.publicReference,
      maskedCode: row.maskedCode,
      status: row.status,
      currency: row.currency,
      initialValue: { minorUnits: Number(row.initialValue), currency: row.currency },
      balance: {
        accountId: row.id,
        currency: row.currency,
        issued: Number(row.initialValue),
        loaded: 0,
        available: Number(row.available),
        authorized: Number(row.authorized ?? 0),
        redeemed: Number(
          row.redeemed ?? Math.max(0, Number(row.initialValue) - Number(row.available)),
        ),
        refunded: Number(row.refunded ?? 0),
        reversed: 0,
        adjusted: 0,
        ledgerSequence: Number(row.sequence),
        projectionVersion: Number(row.projectionVersion ?? 1),
        calculatedAt: row.calculatedAt ?? new Date().toISOString(),
      },
      activatedAt: row.activatedAt,
      expiresAt: row.expiresAt,
      customerId: row.customerId,
      version: Number(row.version),
    };
  }

  private customerValueKey(): Buffer {
    const secret =
      this.config.get('CUSTOMER_VALUE_SECRET', { infer: true }) ??
      this.config.get('APP_QR_SECRET', { infer: true }) ??
      this.config.get('JWT_ACCESS_SECRET', { infer: true });
    if (!secret) throw new ConflictException({ code: 'CUSTOMER_VALUE_SECRET_UNAVAILABLE' });
    return createHash('sha256').update(`umi-customer-value:${secret}`).digest();
  }

  private encodeHistoryCursor(
    scope: object,
    position: { occurredAt: string; eventType: string; eventId: string },
  ) {
    const body = Buffer.from(JSON.stringify({ version: 2, scope, ...position }), 'utf8').toString(
      'base64url',
    );
    const signature = createHmac('sha256', this.customerValueKey())
      .update(body)
      .digest('base64url');
    return `${body}.${signature}`;
  }

  private decodeHistoryCursor(cursor: string, scope: object) {
    const [body, signature, extra] = cursor.split('.');
    if (!body || !signature || extra) {
      throw new ConflictException({ code: 'CUSTOMER_HISTORY_CURSOR_INVALID' });
    }
    const expected = createHmac('sha256', this.customerValueKey()).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ConflictException({ code: 'CUSTOMER_HISTORY_CURSOR_INVALID' });
    }
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        version: number;
        scope: object;
        occurredAt: string;
        eventType: string;
        eventId: string;
      };
      if (
        parsed.version !== 2 ||
        JSON.stringify(parsed.scope) !== JSON.stringify(scope) ||
        !/^\d{4}-\d{2}-\d{2}T/.test(parsed.occurredAt) ||
        typeof parsed.eventType !== 'string' ||
        parsed.eventType.length === 0 ||
        parsed.eventType.length > 80 ||
        !/^[0-9a-f-]{36}$/i.test(parsed.eventId)
      ) {
        throw new Error('scope');
      }
      return parsed;
    } catch {
      throw new ConflictException({ code: 'CUSTOMER_HISTORY_CURSOR_INVALID' });
    }
  }
}
