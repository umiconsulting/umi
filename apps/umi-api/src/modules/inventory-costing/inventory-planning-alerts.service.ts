import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { InventoryPlanningService } from './inventory-planning.service';

@Injectable()
export class InventoryPlanningAlertsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(InventoryPlanningAlertsService.name);
  constructor(
    private readonly pg: PgService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly planning: InventoryPlanningService,
    private readonly email: EmailAdapter,
  ) {}
  onModuleInit() {
    if (!this.config.get('INVENTORY_PLANNING_EMAIL_ENABLED', { infer: true })) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.logger.error('inventory_digest_failed'));
    }, 15 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.busy || !this.config.get('INVENTORY_PLANNING_EMAIL_ENABLED', { infer: true })) return;
    if (
      !this.config.get('SMTP_HOST', { infer: true }) ||
      !this.config.get('EMAIL_FROM', { infer: true })
    )
      return;
    this.busy = true;
    try {
      const owners = await this.pg.query<{
        merchantId: string;
        userId: string;
        email: string;
        name: string;
        timezone: string;
        day: string;
      }>(`
        SELECT DISTINCT m.id::text AS "merchantId",u.id::text AS "userId",u.email,m.name,m.timezone,
          ((now() AT TIME ZONE m.timezone)-m.business_day_start::interval)::date::text AS day
        FROM merchant.merchant m JOIN merchant.staff s ON s.merchant_id=m.id AND s.status='active'
        JOIN umi."user" u ON u.id=s.user_id AND u.status='active' AND u.email IS NOT NULL
        LEFT JOIN merchant.role mr ON mr.id=s.merchant_role_id AND mr.merchant_id=m.id AND mr.status='active'
        LEFT JOIN umi.role_template rt ON rt.id=mr.source_template_id
        LEFT JOIN umi.role r ON r.id=s.role_id
        WHERE m.inventory_planning_email_enabled AND m.status='active' AND s.location_id IS NULL
          AND ((s.merchant_role_id IS NULL AND r.key='owner') OR mr.key='owner' OR rt.key='owner')
          AND EXISTS (SELECT 1 FROM umi.effective_entitlement ee JOIN umi.subscription sub ON sub.merchant_id=ee.merchant_id WHERE ee.merchant_id=m.id AND ee.feature_key='dashboard' AND ee.enabled AND sub.status IN ('active','trialing'))
          AND 'merchant.manage'=ANY(umi.resolve_staff_permissions(s.id))
          AND extract(hour FROM now() AT TIME ZONE m.timezone) >= 9
          AND NOT EXISTS(SELECT 1 FROM merchant.inventory_planning_delivery d WHERE d.merchant_id=m.id AND d.user_id=u.id AND d.business_date=((now() AT TIME ZONE m.timezone)-m.business_day_start::interval)::date)`);
      for (const owner of owners.rows) {
        const plan = await this.planning.plan(
          {
            merchantId: owner.merchantId,
            handle: null,
            name: owner.name,
            timezone: owner.timezone,
            membershipId: null,
            role: 'owner',
            roles: ['owner'],
            permissions: ['merchant.manage', 'location.switch'],
            locationId: null,
          },
          {},
        );
        const shortage = plan.items.filter(
          (item) => item.suggestedQuantity !== null && item.suggestedQuantity > 0,
        );
        if (!plan.complete || !shortage.length) continue;
        // A durable claim precedes SMTP. An ambiguous outcome is never resent automatically.
        const claim = await this.pg.query<{ id: string }>(
          `INSERT INTO merchant.inventory_planning_delivery(merchant_id,user_id,business_date,state) SELECT $1::uuid,$2::uuid,$3::date,'sending' FROM merchant.merchant WHERE id=$1::uuid AND inventory_planning_email_enabled ON CONFLICT DO NOTHING RETURNING id::text`,
          [owner.merchantId, owner.userId, owner.day],
        );
        if (!claim.rows[0]) continue;
        const id = claim.rows[0].id;
        try {
          const base = this.config.get('PUBLIC_DASHBOARD_URL', { infer: true });
          const text = `${owner.name}: hay ${shortage.length} artículos por reponer para el periodo ${plan.from} — ${plan.to}.\nRevisa las cantidades y sus datos antes de comprar.\n${base}/inventory/costos`;
          const result = await this.email.send({
            to: owner.email,
            subject: 'Revisa tu plan de compra',
            text,
            html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
          });
          await this.pg.query(
            `UPDATE merchant.inventory_planning_delivery SET state=$3,provider_message_id=$4,updated_at=clock_timestamp() WHERE merchant_id=$1::uuid AND id=$2::uuid`,
            [owner.merchantId, id, result ? 'sent' : 'unknown', result?.messageId ?? null],
          );
        } catch {
          await this.pg.query(
            `UPDATE merchant.inventory_planning_delivery SET state='unknown',updated_at=clock_timestamp() WHERE merchant_id=$1::uuid AND id=$2::uuid`,
            [owner.merchantId, id],
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
