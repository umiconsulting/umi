import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  CreateCustomerRequest,
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
  GiftCardLookupRequest,
  RewardAuthorization,
  RewardAuthorizationRequest,
  StoredValueAuthorization,
  StoredValueAuthorizationRequest,
  ValueReleaseRequest,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { commandFingerprint } from '../integrity/canonical-json';
import { calculateEarnedPoints, normalizeCustomerContact } from './customer-value-domain';

export interface CustomerValueAuthorization {
  operatorId: string;
  deviceId: string;
  durableSessionId: string;
  credentialVersion: number;
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
  constructor(private readonly pg: PgService) {}

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
          `SELECT os.user_id::text AS "operatorId",os.device_id::text AS "deviceId",
                  os.durable_session_id::text AS "durableSessionId",
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
    query: CustomerSearchRequest,
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
        const { rows } = await client.query<Row>(
          `SELECT o.id::text,'sale' type,coalesce(o.external_ref,o.id::text) AS "publicReference",
             o.location_id::text AS "locationId",o.business_date::text AS "businessDate",
             jsonb_build_object('minorUnits',coalesce(sum(p.amount),0),'currency',coalesce(max(p.currency),'MXN')) total,
             o.status,o.placed_at::text AS "occurredAt"
           FROM merchant.customer_order o LEFT JOIN merchant.payment p ON p.order_id=o.id
          WHERE o.merchant_id=$1::uuid AND o.customer_id=$2::uuid
          GROUP BY o.id ORDER BY o.placed_at DESC,o.id DESC LIMIT $3`,
          [merchantId, customerId, query.limit],
        );
        return { entries: rows as CustomerHistoryPage['entries'], nextCursor: null };
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
             coalesce(sum(l.quantity*l.unit_price),0)::bigint AS total
           FROM merchant.pos_cart c LEFT JOIN merchant.pos_cart_line l ON l.cart_id=c.id
          WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid
          GROUP BY c.id`,
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
        const policy = await client.query<Row>(
          `SELECT enabled,points_per_money_unit AS "pointsPerUnit",money_unit_minor_units AS "moneyUnit",
             points_rounding AS rounding,earn_timing AS "earnTiming",policy_version AS "policyVersion",
             policy_fingerprint AS fingerprint,policy_expires_at::text AS "expiresAt"
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
        const expectedPoints = p?.enabled
          ? calculateEarnedPoints(
              Number(row.total),
              Number(p.moneyUnit),
              Number(p.pointsPerUnit),
              p.rounding,
            )
          : 0;
        const fingerprint = commandFingerprint('pos.customer-value.preview', {
          merchantId,
          locationId: dto.locationId,
          saleId: dto.saleId,
          checkoutVersion: dto.checkoutVersion,
          customerId: dto.customerId,
          checkoutFingerprint: dto.checkoutFingerprint,
          policyVersion: p?.policyVersion ?? 'disabled',
        });
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
                 value::int AS "benefitMinorUnits"
               FROM merchant.loyalty_reward
              WHERE merchant_id=$1::uuid AND active
                AND valid_from<=clock_timestamp()
                AND (valid_until IS NULL OR valid_until>clock_timestamp())
              ORDER BY points_cost,id LIMIT 50`,
                  [merchantId],
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
                  eligibleMinorUnits: Number(row.total),
                  excludedMinorUnits: 0,
                  expectedPoints,
                  status: p.earnTiming,
                  policyVersion: p.policyVersion,
                  fingerprint,
                  explanationCodes: expectedPoints > 0 ? ['eligible_sale'] : ['zero_earn'],
                }
              : null,
          rewards: rewards.map((reward) => {
            const eligible = Number(account?.available ?? 0) >= Number(reward.pointsCost);
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
              eligible,
              pointsCost: Number(reward.pointsCost),
              benefit: { minorUnits: Number(reward.benefitMinorUnits), currency: row.currency },
              remainingPoints: Math.max(
                0,
                Number(account?.available ?? 0) - Number(reward.pointsCost),
              ),
              approvalPermission: null,
              explanationCodes: [eligible ? 'eligible' : 'insufficient_points'],
              fingerprint,
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
         r.version,p.policy_version AS "policyVersion",a.id::text AS "accountId",
         coalesce(b.available,0)::bigint AS available,c.currency
       FROM merchant.loyalty_reward r JOIN merchant.loyalty_program p ON p.merchant_id=r.merchant_id
       JOIN merchant.loyalty_points_account a ON a.merchant_id=r.merchant_id AND a.customer_id=$2::uuid
       JOIN merchant.loyalty_points_balance b ON b.account_id=a.id
       JOIN merchant.pos_cart c ON c.id=$3::uuid AND c.merchant_id=r.merchant_id AND c.customer_id=$2::uuid
      WHERE r.id=$1::uuid AND r.merchant_id=$4::uuid AND r.active AND r.points_cost>0
        AND (r.valid_until IS NULL OR r.valid_until>clock_timestamp()) FOR UPDATE OF a,b,r`,
      [dto.rewardId, dto.customerId, dto.saleId, merchantId],
    );
    const row = reward.rows[0];
    if (!row || Number(row.available) < Number(row.pointsCost)) {
      throw new ConflictException({ code: 'REWARD_INELIGIBLE' });
    }
    const id = randomUUID();
    const fingerprint = commandFingerprint('pos.reward.authorize', dto);
    const inserted = await client.query<Row>(
      `INSERT INTO merchant.customer_value_authorization(
        id,merchant_id,location_id,account_type,account_id,customer_id,reward_id,sale_id,
        checkout_version,points,benefit_minor_units,checkout_fingerprint,policy_version,reward_version,command_id,
        idempotency_key,command_fingerprint,status,expires_at,correlation_id)
       VALUES($1::uuid,$2::uuid,$3::uuid,'loyalty_reward',$4::uuid,$5::uuid,$6::uuid,$7::uuid,
        $8,$9,$10,$11,$12,$13,$14::uuid,$15::uuid,$16,'authorized',clock_timestamp()+interval '5 minutes',$17)
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
        row.benefit,
        dto.previewFingerprint,
        row.policyVersion,
        row.version,
        dto.commandId,
        dto.idempotencyKey,
        fingerprint,
        correlationId,
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
      benefit: { minorUnits: Number(row.benefit ?? 0), currency: row.currency },
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
      `SELECT a.id::text,a.currency,a.status,${dto.accountType === 'wallet' ? 'a.customer_id::text AS "customerId"' : 'a.customer_id::text AS "customerId"'},
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
        command_fingerprint,status,expires_at,correlation_id)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,
        'pilot-deny-v1',$12::uuid,$13::uuid,$14,'authorized',clock_timestamp()+interval '5 minutes',$15)
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
  ): Promise<GiftCard> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
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
        if (!rows[0]) throw new ConflictException({ code: 'GIFT_CARD_NOT_FOUND' });
        return this.giftCard(rows[0]);
      },
      dto.locationId,
    );
  }

  command(
    userId: string,
    merchantId: string,
    commandId: string,
    query: CustomerValueRecoveryQuery,
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
        }>(
          `SELECT status,response_data AS response,failure_code AS "failureCode",
                  correlation_id AS "correlationId"
             FROM merchant.business_command
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND command_id=$3::uuid
              AND (command_type LIKE 'pos.customer%'
                OR command_type IN ('pos.reward.authorize','pos.reward.release',
                  'pos.stored-value.authorize','pos.stored-value.release','pos.gift-card.activate'))
            LIMIT 1`,
          [merchantId, query.locationId, commandId],
        );
        const row = rows[0];
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
    const value = await client.query(
      `SELECT exists(select 1 from merchant.loyalty_points_account where merchant_id=$1::uuid and customer_id in ($2::uuid,$3::uuid))
        or exists(select 1 from merchant.loyalty_card where merchant_id=$1::uuid and customer_id in ($2::uuid,$3::uuid)) AS conflict`,
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
        WHERE id=$1::uuid AND session_id=$2::uuid AND merchant_id=$3::uuid
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
}
