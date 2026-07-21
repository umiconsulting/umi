import { Injectable, Logger } from '@nestjs/common';
import { EnqueueService } from '../../jobs/enqueue.service';
import { QUEUES } from '../../jobs/queues';
import { JobPriority } from '../../jobs/job-options';
import { LifecycleRepository, type LifecycleTenant } from './lifecycle.repository';
import {
  resolveCronJourneyTemplate,
  renderTemplate,
  formatDateLabel,
  type CronJourneyKey,
} from './lifecycle-copy';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_CUSTOMER_NAME = 'Cliente';

const STREAK_TIERS: { weeks: number; journey: CronJourneyKey }[] = [
  { weeks: 3, journey: 'streak_3w' },
  { weeks: 6, journey: 'streak_6w' },
  { weeks: 12, journey: 'streak_12w' },
];

const WINBACK_TIERS: { days: number; journey: CronJourneyKey }[] = [
  { days: 14, journey: 'winback_14' },
  { days: 30, journey: 'winback_30' },
  { days: 60, journey: 'winback_60' },
];

export interface JourneySummary {
  candidates: number;
  sent: number;
}

/**
 * Scheduled lifecycle journeys (3d-lifecycle) — the WhatsApp half of the legacy
 * `cash-cron.ts`. Each journey iterates active tenants, finds eligible cards on
 * the canonical loyalty schema, renders the tenant's copy, claims the send in
 * `runtime.reminder_sent` (durable dedup), then enqueues `whatsapp.lifecycle`
 * to the outbound queue for delivery. WhatsApp-only — the wallet-push journeys
 * (birthday issuance, expire, goal-proximity) stay in umi-cash.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly repo: LifecycleRepository,
    private readonly enqueue: EnqueueService,
  ) {}

  async runRewardExpiring(): Promise<JourneySummary> {
    let candidates = 0;
    let sent = 0;
    for (const tenant of await this.repo.activeTenants()) {
      const cfg = await this.repo.tenantConfig(tenant.id);
      const tz = tenant.timezone || DEFAULT_TZ;
      const rewards = await this.repo.rewardExpiringCandidates(tenant.id);
      candidates += rewards.length;
      for (const r of rewards) {
        const rewardName = cfg.birthdayRewardName || 'regalo de cumpleaños';
        const message = renderTemplate(
          resolveCronJourneyTemplate(cfg.lifecycleCopy, 'reward_expiring'),
          {
            name: r.name || DEFAULT_CUSTOMER_NAME,
            tenant: tenant.name,
            rewardName,
            date: formatDateLabel(r.expiresAt, tz),
          },
        );
        if (await this.dispatch(tenant, r.cardId, `reward_expiring_${r.year}`, r.phone, message))
          sent++;
      }
    }
    this.logger.log(`reward_expiring complete candidates=${candidates} sent=${sent}`);
    return { candidates, sent };
  }

  async runStreakRecognition(): Promise<JourneySummary> {
    let candidates = 0;
    let sent = 0;
    const tenants = await this.repo.activeTenants();
    for (const tenant of tenants) {
      const cfg = await this.repo.tenantConfig(tenant.id);
      for (const tier of STREAK_TIERS) {
        const cards = await this.repo.streakCandidates(tenant.id, tier.weeks);
        candidates += cards.length;
        for (const c of cards) {
          const message = renderTemplate(
            resolveCronJourneyTemplate(cfg.lifecycleCopy, tier.journey),
            {
              name: c.name || DEFAULT_CUSTOMER_NAME,
              tenant: tenant.name,
              rewardName: cfg.rewardName,
            },
          );
          if (await this.dispatch(tenant, c.cardId, tier.journey, c.phone, message)) sent++;
        }
      }
    }
    this.logger.log(`streak_recognition complete candidates=${candidates} sent=${sent}`);
    return { candidates, sent };
  }

  async runWelcomeNoVisit(): Promise<JourneySummary> {
    let candidates = 0;
    let sent = 0;
    for (const tenant of await this.repo.activeTenants()) {
      const cfg = await this.repo.tenantConfig(tenant.id);
      const cards = await this.repo.welcomeNoVisitCandidates(tenant.id);
      candidates += cards.length;
      for (const c of cards) {
        const message = renderTemplate(
          resolveCronJourneyTemplate(cfg.lifecycleCopy, 'welcome_no_visit'),
          { name: c.name || DEFAULT_CUSTOMER_NAME, tenant: tenant.name },
        );
        if (await this.dispatch(tenant, c.cardId, 'welcome_no_visit', c.phone, message)) sent++;
      }
    }
    this.logger.log(`welcome_no_visit complete candidates=${candidates} sent=${sent}`);
    return { candidates, sent };
  }

  async runWinbackInactive(): Promise<JourneySummary> {
    let candidates = 0;
    let sent = 0;
    const tenants = await this.repo.activeTenants();
    for (const tenant of tenants) {
      const cfg = await this.repo.tenantConfig(tenant.id);
      for (const tier of WINBACK_TIERS) {
        const cards = await this.repo.winbackCandidates(tenant.id, tier.days);
        candidates += cards.length;
        for (const c of cards) {
          const message = renderTemplate(
            resolveCronJourneyTemplate(cfg.lifecycleCopy, tier.journey),
            {
              name: c.name || DEFAULT_CUSTOMER_NAME,
              tenant: tenant.name,
              rewardName: cfg.rewardName,
              visitsThisCycle: c.visitsThisCycle,
              visitsRequired: cfg.visitsRequired,
            },
          );
          if (await this.dispatch(tenant, c.cardId, tier.journey, c.phone, message)) sent++;
        }
      }
    }
    this.logger.log(`winback_inactive complete candidates=${candidates} sent=${sent}`);
    return { candidates, sent };
  }

  /** Claim the send (durable dedup) then enqueue delivery. Returns true if sent. */
  private async dispatch(
    tenant: LifecycleTenant,
    cardId: string,
    journey: string,
    phone: string,
    body: string,
  ): Promise<boolean> {
    const claimed = await this.repo.claimSend(tenant.id, cardId, journey, body);
    if (!claimed) return false; // already sent — silent skip (matches source)
    try {
      await this.enqueue.enqueue(
        QUEUES.outbound,
        'whatsapp.lifecycle',
        { to: phone, body, business_id: tenant.id, card_id: cardId, journey },
        { priority: JobPriority.Background, jobId: `lc:${tenant.id}:${cardId}:${journey}` },
      );
    } catch (err) {
      // The claim is the dedup gate; if enqueue fails the message would be lost
      // forever (the claim blocks every future run). Roll the claim back so the
      // next cron tick retries this card.
      await this.repo.deleteSend(tenant.id, cardId, journey).catch(() => undefined);
      throw err;
    }
    return true;
  }
}
