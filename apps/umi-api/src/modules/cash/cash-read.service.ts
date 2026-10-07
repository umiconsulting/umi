import {
  cardPolicyFields,
  rewardProfileWithSnapshot,
} from '../../shared/loyalty/reward-policy-presentation';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatMxn, formatMxn2, iso } from '../../shared/format/money';
import { CashRepository } from './cash.repository';
import { CashCardRepository } from './cash-card.repository';
import { DEFAULT_LIFECYCLE_COPY, LIFECYCLE_JOURNEYS, LIFECYCLE_VARIABLES } from './lifecycle-copy';
import { cardRewardFields } from '../../shared/loyalty/reward-tiers';
import { resolveRewardProfile } from '../../shared/loyalty/reward-profile';

/** A repository list that may be absent on a partial read. */
const rowsOf = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const EXPORT_HEADERS = [
  'Nombre',
  'Teléfono',
  'Email',
  'Tarjeta',
  'Saldo MXN',
  'Visitas totales',
  'Visitas ciclo',
  'Recompensas pendientes',
  'Registrado',
];

/**
 * One CSV field. Quote when the value carries a comma, a quote or a newline,
 * and double an embedded quote — RFC 4180, and the reason a customer named
 * "Ana, la del 5" does not silently become two columns.
 */
function csvField(value: string | null | undefined): string {
  const str = value ?? '';
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** How much history the customer detail screen shows. */
const DETAIL_LIMIT = 10;

/**
 * The ranges the analytics screen offers, and the parser that agrees with it.
 * Kept identical to umi-cash `lib/analytics-range.ts`: 7/30/90/365, and anything
 * unrecognised (including absent) falls back to 30 rather than erroring — a bad
 * query string must not blank the manager's screen.
 */
const ANALYTICS_RANGES = [7, 30, 90, 365] as const;
function resolveAnalyticsRangeDays(param: unknown): number {
  const n = Number(param);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? n : 30;
}

/** `YYYY-MM-DD` from a DATE column, without going through a timezone. */
function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Cash analytics/reads for the dashboard (D11 read side — always live). All
 * money is integer centavos; date math mirrors server.js exactly. Admin-config
 * writes (settings branding, reward-config) live here too — they are NOT the
 * inert customer-facing path (see cash-write.service / preflight §4).
 */
@Injectable()
export class CashReadService {
  constructor(
    private readonly repo: CashRepository,
    // The card reads are shared with the customer's own page: the same visits and
    // the same ledger, shown to the barista instead of to her.
    private readonly cards: CashCardRepository,
  ) {}

  async getSettings(merchantId: string): Promise<Row> {
    const t = await this.repo.branding(merchantId);
    if (!t) throw new NotFoundException({ error: 'Merchant no encontrado' });
    return {
      name: t.name,
      city: t.city,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      logoUrl: t.logoUrl,
      stripImageUrl: t.stripImageUrl,
      passStyle: t.passStyle,
      promoMessage: t.promoMessage,
      promoStartsAt: t.promoStartsAt ?? null,
      promoEndsAt: t.promoEndsAt ?? null,
      promoDays: t.promoDays,
      selfRegistration: t.selfRegistration,
      birthdayRewardEnabled: t.birthdayRewardEnabled,
      birthdayRewardName: t.birthdayRewardName,
      cardPrefix: t.cardPrefix,
      handle: t.handle,
      // The Settings screen reads `slug`, not `handle`. It is the same value under
      // the name the frozen client was written against; the panel was never told
      // the name changed, and `handle` cannot be removed because the Dashboard's
      // merchant model reads it.
      slug: t.handle,
      // The lifecycle-copy editor: the café's overrides, plus the three registries
      // that make the screen renderable. All four come from one module, which is a
      // byte-for-byte port of umi-cash's — see lifecycle-copy.ts.
      lifecycleCopy: t.lifecycleCopy ?? {},
      lifecycleDefaults: DEFAULT_LIFECYCLE_COPY,
      lifecycleJourneys: LIFECYCLE_JOURNEYS,
      lifecycleVariables: LIFECYCLE_VARIABLES,
    };
  }

  async updateSettings(merchantId: string, d: Row): Promise<void> {
    if (d.name !== undefined) {
      await this.repo.updateMerchantName(merchantId, d.name);
    }
    // Column-keyed patch (see CashRepository.updateProgram): only keys present here
    // change; a present key with null clears the column. card_prefix/pass_style keep the
    // old "set only when a value is given, never clear" behavior.
    const patch: Record<string, unknown> = {};
    if (d.cardPrefix != null) patch.card_prefix = d.cardPrefix;
    if (d.passStyle != null) patch.pass_style = d.passStyle;
    if (d.primaryColor !== undefined) patch.primary_color = d.primaryColor || null;
    if (d.secondaryColor !== undefined) patch.secondary_color = d.secondaryColor || null;
    if (d.logoUrl !== undefined) patch.logo_url = d.logoUrl || null;
    if (d.stripImageUrl !== undefined) patch.strip_image_url = d.stripImageUrl || null;
    if (d.promoMessage !== undefined) patch.promo_message = d.promoMessage || null;
    if (d.promoStartsAt !== undefined) patch.promo_starts_at = d.promoStartsAt || null;
    if (d.promoEndsAt !== undefined) patch.promo_ends_at = d.promoEndsAt || null;
    if (d.promoDays !== undefined) patch.promo_days = d.promoDays || null;
    if (d.birthdayRewardEnabled !== undefined)
      patch.birthday_reward_enabled = d.birthdayRewardEnabled;
    if (d.birthdayRewardName !== undefined)
      patch.birthday_reward_name = d.birthdayRewardName || null;
    if (d.lifecycleCopy !== undefined) patch.lifecycle_copy = d.lifecycleCopy ?? null;

    if (Object.keys(patch).length > 0) {
      await this.repo.updateProgram(merchantId, patch);
    }
  }

  async getStats(merchantId: string, role: string | null = null): Promise<Row> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { visits, topups, pending } = await this.repo.stats(merchantId, dayStart);
    return {
      // The till's own role, in the till's vocabulary. umi-cash sent `staff.role`;
      visitsToday: Number(visits?.n ?? 0),
      topupsTodayCount: Number(topups?.n ?? 0),
      topupsTodayMXN: formatMxn(Number(topups?.sum ?? 0)),
      pendingRewards: Number(pending?.sum ?? 0),
      role,
    };
  }

  /**
   * The analytics screen, for the range its chips select.
   *
   * `?days=` drives the visit chart, the canjes tile and the canjes bitácora; the
   * retention figure stays a fixed 30-day metric so its meaning does not drift
   * when someone looks at the 365-day view. The agreement on which ranges exist
   * lives in umi-cash `lib/analytics-range.ts` — 7/30/90/365, anything else 30 —
   * and the panel sends the parameter on every chip.
   */
  async getAnalytics(merchantId: string, query: Row = {}): Promise<Row> {
    const now = new Date();
    const days = resolveAnalyticsRangeDays(query.days);

    // Midnight `days - 1` ago, so the window covers exactly the same calendar
    // dates the chart renders (today included).
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - (days - 1));
    rangeStart.setHours(0, 0, 0, 0);
    // The adjacent, equal-length window before it, for the vs-previous delta.
    const prevRangeStart = new Date(rangeStart);
    prevRangeStart.setDate(prevRangeStart.getDate() - days);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const eightWeeksAgo = new Date(now);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
    eightWeeksAgo.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const d = await this.repo.analytics(merchantId, {
      thirtyDaysAgo,
      eightWeeksAgo,
      monthStart,
      rangeStart,
      prevRangeStart,
    });

    const visitCountByDay: Record<string, number> = {};
    for (const v of d.recentVisits as Row[]) {
      const ds = new Date(v.scannedAt).toISOString().slice(0, 10);
      visitCountByDay[ds] = (visitCountByDay[ds] ?? 0) + 1;
    }
    const visitsByDay: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - i);
      const ds = dt.toISOString().slice(0, 10);
      visitsByDay.push({ date: ds, count: visitCountByDay[ds] ?? 0 });
    }

    const topCustomers = (d.topCards as Row[]).map((c) => ({
      id: c.userId,
      name: c.name ?? 'Sin nombre',
      cardNumber: c.cardNumber,
      totalVisits: Number(c.totalVisits ?? 0),
      balanceMXN: formatMxn(Number(c.balanceCentavos ?? 0)),
    }));

    const todayDow = now.getDay();
    const daysToMon = todayDow === 0 ? 6 : todayDow - 1;
    const thisWeekMon = new Date(now);
    thisWeekMon.setDate(now.getDate() - daysToMon);
    thisWeekMon.setHours(0, 0, 0, 0);
    const weekBuckets: { weekStart: Date; label: string }[] = [];
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(thisWeekMon);
      ws.setDate(thisWeekMon.getDate() - i * 7);
      weekBuckets.push({ weekStart: ws, label: `${MONTHS[ws.getMonth()]} ${ws.getDate()}` });
    }
    const recentUsers = d.recentUsers as Row[];
    const newCustomersByWeek = weekBuckets.map(({ weekStart, label }, idx) => {
      const next =
        idx < weekBuckets.length - 1
          ? weekBuckets[idx + 1].weekStart
          : new Date(now.getTime() + 86400000);
      const count = recentUsers.filter(
        (u) => new Date(u.createdAt) >= weekStart && new Date(u.createdAt) < next,
      ).length;
      return { week: label, count };
    });

    const totalsRow = (d.totalsRow as Row[])[0];
    const totalCustomers = Number(totalsRow?.totalCustomers ?? 0);
    const totalBalanceCentavos = Number((d.balanceRow as Row[])[0]?.sum ?? 0);
    const totalAllTimeVisits = Number(totalsRow?.totalAllTimeVisits ?? 0);
    const activeCustomersLast30 = Number((d.activeRow as Row[])[0]?.n ?? 0);
    const trueAvg =
      totalCustomers > 0 ? Math.round((totalAllTimeVisits / totalCustomers) * 10) / 10 : 0;
    const retentionRate =
      totalCustomers > 0 ? Math.round((activeCustomersLast30 / totalCustomers) * 100) : 0;
    const totalRevenueCentavos = Math.abs(Number(totalsRow?.totalRevenueCentavos ?? 0));
    const avgTicketCentavos =
      totalAllTimeVisits > 0 ? Math.round(totalRevenueCentavos / totalAllTimeVisits) : 0;
    const cfg = (d.activeRewardConfigRow as Row[])[0];
    const visitsRequired = Number(cfg?.visitsRequired ?? 10);
    const rewardCostCentavos = Number(cfg?.rewardCostCentavos ?? 0);
    const revenuePerCycle = avgTicketCentavos * visitsRequired;
    const marginPerCycle = revenuePerCycle - rewardCostCentavos;
    const marginPercent =
      revenuePerCycle > 0 ? Math.round((marginPerCycle / revenuePerCycle) * 100) : null;

    // Member panel (the dashboard overview reads these; before, it read them off
    // an object that never carried them, so the headline count showed a dash).
    const memberHistory = newCustomersByWeek.map((w) => w.count);
    const newThisWeek = memberHistory[memberHistory.length - 1] ?? 0;
    // Membership growth over the 8-week window: members added in the window as a
    // share of the base that predated it. Non-negative, so it matches the up-arrow
    // the overview renders — a week-over-week delta on migrated data swings
    // negative and would render "↑ -95%".
    const windowNew = memberHistory.reduce((a, b) => a + b, 0);
    const baseBeforeWindow = Math.max(0, totalCustomers - windowNew);
    const memberDeltaPct =
      baseBeforeWindow > 0
        ? Math.round((windowNew / baseBeforeWindow) * 100)
        : windowNew > 0
          ? 100
          : null;
    const highBalanceCount = Number((d.highBalanceRow as Row[])[0]?.n ?? 0);
    const birthdayActivatable = Number((d.birthdayRow as Row[])[0]?.n ?? 0);

    return {
      visitsByDay,
      prevPeriodVisits: Number(rowsOf(d.prevPeriodVisits)[0]?.n ?? 0),
      topCustomers,
      newCustomersByWeek,
      totalCustomers,
      activeCustomersLast30,
      memberHistory,
      newThisWeek,
      memberDeltaPct,
      highBalanceCount,
      birthdayActivatable,
      totalBalance: formatMxn(totalBalanceCentavos),
      topupsThisMonth: formatMxn(Number((d.topupsRow as Row[])[0]?.sum ?? 0)),
      rewardsRedeemedThisMonth: Number((d.rewardsRow as Row[])[0]?.n ?? 0),
      // The range-scoped counterparts of the two figures above. umi-cash sent
      // both: the tile follows the chips even where the monthly figure does not.
      rewardsRedeemedInRange: Number(rowsOf(d.rewardsInRange)[0]?.n ?? 0),
      redemptions: rowsOf(d.redemptionLog).map((r) => ({
        id: r.id,
        redeemedAt: r.redeemedAt ? new Date(r.redeemedAt).toISOString() : null,
        name: r.name ?? null,
        customerId: r.customerId ?? null,
        cardNumber: r.cardNumber ?? null,
        revertedAt: r.revertedAt ? new Date(r.revertedAt).toISOString() : null,
      })),
      avgVisitsPerCustomer: trueAvg,
      retentionRate,
      profitability: {
        avgTicketMXN: formatMxn(avgTicketCentavos),
        revenuePerCycleMXN: formatMxn(revenuePerCycle),
        rewardCostMXN: formatMxn(rewardCostCentavos),
        marginPerCycleMXN: formatMxn(marginPerCycle),
        marginPercent,
        visitsRequired,
        rewardCostConfigured: rewardCostCentavos > 0,
      },
    };
  }

  async getCustomers(merchantId: string, query: Row): Promise<Row> {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const search = String(query.search || '')
      .trim()
      .slice(0, 50);
    const sort = query.sort || 'recent';
    const skip = (page - 1) * limit;

    const { rows, total } = await this.repo.adminCustomers(merchantId, {
      search,
      sort,
      limit,
      skip,
    });
    const customers = rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      // Display only. Null for a customer a barista enrolled by hand — which is
      // what the screen already renders as a dash.
      device: r.device ?? null,
      os: r.os ?? null,
      cardNumber: r.cardNumber ?? '',
      cardId: r.cardId ?? '',
      balanceMXN: formatMxn(Number(r.balanceCentavos ?? 0)),
      balanceCentavos: Number(r.balanceCentavos ?? 0),
      totalVisits: Number(r.totalVisits ?? 0),
      visitsThisCycle: Number(r.visitsThisCycle ?? 0),
      pendingRewards: Number(r.pendingRewards ?? 0),
      ...cardPolicyFields(r),
      lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      ltvCentavos: Number(r.ltvCentavos ?? 0),
      ltvMXN: formatMxn(Number(r.ltvCentavos ?? 0)),
    }));
    return { customers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async getRewardConfig(merchantId: string): Promise<Row> {
    // `upgrade` is the second rung of the café's ladder, and the Rewards screen
    // reads `data.upgrade` to draw it. See CashRepository.rewardConfig.
    const { active, upgrade, history } = await this.repo.rewardConfig(merchantId);
    return { active: active[0] || null, upgrade: upgrade[0] || null, history };
  }

  async updateRewardConfig(merchantId: string, body: Row): Promise<Row> {
    const { visitsRequired, rewardName, rewardDescription, rewardCostCentavos, upgrade } = body;
    if (!visitsRequired || !rewardName) {
      throw new BadRequestException('visitsRequired and rewardName are required');
    }
    // parseInt('abc') === NaN passes the truthiness check above but would persist
    // a NaN visit target — require a positive integer.
    const visits = parseInt(visitsRequired, 10);
    if (!Number.isInteger(visits) || visits <= 0) {
      throw new BadRequestException('visitsRequired must be a positive integer');
    }

    // The optional upper tier. `null`/absent means a single reward, which is how a
    // café turns an existing ladder off, so its absence is meaningful and is passed
    // through rather than defaulted.
    let upgradeTier: {
      visitsRequired: number;
      rewardName: string;
      rewardDescription: string | null;
      rewardCostCentavos: number;
    } | null = null;
    if (upgrade !== null && upgrade !== undefined) {
      if (!upgrade || typeof upgrade !== 'object' || !upgrade.rewardName) {
        throw new BadRequestException('upgrade.rewardName is required');
      }
      const upgradeVisits = parseInt(upgrade.visitsRequired, 10);
      if (!Number.isInteger(upgradeVisits) || upgradeVisits <= 0) {
        throw new BadRequestException('upgrade.visitsRequired must be a positive integer');
      }
      // The ladder only has a lower rung to cash out early against when the upper
      // one sits above it. umi-cash rejected this with 400 and the Rewards screen
      // renders that message verbatim.
      if (upgradeVisits <= visits) {
        throw new BadRequestException('El segundo nivel debe requerir más visitas que el primero');
      }
      upgradeTier = {
        visitsRequired: upgradeVisits,
        rewardName: upgrade.rewardName,
        rewardDescription: upgrade.rewardDescription ?? null,
        rewardCostCentavos: Number(upgrade.rewardCostCentavos ?? 0),
      };
    }

    const programId = await this.programId(merchantId);
    if (!programId) throw new BadRequestException('merchant has no loyalty program');
    const newConfig = await this.repo.upsertRewardConfig(merchantId, programId, {
      visitsRequired: visits,
      rewardName,
      rewardDescription: rewardDescription ?? null,
      rewardCostCentavos: Number(rewardCostCentavos ?? 0),
      upgrade: upgradeTier,
    });
    return { ok: true, newConfig };
  }

  async getGiftCards(merchantId: string, query: Row): Promise<Row> {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const skip = (page - 1) * limit;
    const { rows, total } = await this.repo.giftCards(merchantId, limit, skip);
    const giftCards = rows.map((g) => ({
      id: g.id,
      code: g.code,
      amountCentavos: Number(g.amountCentavos ?? 0),
      amountMXN: formatMxn(Number(g.amountCentavos ?? 0)),
      senderName: g.senderName,
      recipientName: g.recipientName,
      recipientEmail: g.recipientEmail,
      recipientPhone: g.recipientPhone,
      message: g.message,
      isRedeemed: g.isRedeemed,
      redeemedAt: g.redeemedAt ? new Date(g.redeemedAt).toISOString() : null,
      expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null,
      createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : null,
    }));
    const pages = Math.max(1, Math.ceil(total / limit));
    // `pages` is the name the frozen panel reads; `totalPages` is what the port
    // shipped. Both are sent: nothing reads the second one today (the screen is a
    // stub), and dropping it would be a second, silent rename.
    return { giftCards, total, page, pages, totalPages: pages };
  }

  /** Program id for the merchant (reward-config write needs it). */
  async programId(merchantId: string): Promise<string | null> {
    const t = await this.repo.branding(merchantId);
    return (t?.programId as string) ?? null;
  }

  /**
   * One customer, for the staff detail screen.
   *
   * NOT FOUND covers two cases and answers them the same way, exactly as
   * umi-cash does: no such customer, and a customer holding no card. The screen
   * is a card screen — there is nothing to show for the second.
   *
   * `device` and `os` are always null. umi-cash reads them off
   * `people.metadata`, written from the User-Agent at sign-up; build-v3 drops
   * that column and umi-api's registration already discards the header. Null is
   * the honest answer, and the gap is tracked rather than papered over.
   */
  async getCustomer(
    merchantId: string,
    customerId: string,
    role: string | null = null,
  ): Promise<Row> {
    const detail = await this.repo.adminCustomerDetail(merchantId, customerId);
    if (!detail) throw new NotFoundException({ error: 'Cliente no encontrado' });

    const [state, totals, visits, ledger, rewardRows, redemptions] = await Promise.all([
      this.cards.cardState(merchantId, detail.cardId),
      this.repo.cardMoneyTotals(merchantId, detail.cardId),
      this.cards.recentVisits(merchantId, detail.cardId, DETAIL_LIMIT),
      this.cards.recentLedger(merchantId, detail.cardId, DETAIL_LIMIT),
      this.repo.rewardProfileRows(merchantId, detail.cardId),
      this.repo.cardRedemptions(merchantId, detail.cardId, DETAIL_LIMIT),
    ]);
    if (!state) throw new NotFoundException({ error: 'Cliente no encontrado' });

    const profile = rewardProfileWithSnapshot(
      resolveRewardProfile(
        rewardRows.defaultConfig,
        rewardRows.overrideConfig,
        rewardRows.upgradeConfig,
      ),
      state,
    );
    const ltvCentavos = Number(totals.ltvCentavos ?? 0);
    const totalTopupCentavos = Number(totals.topupCentavos ?? 0);

    return {
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      email: detail.email,
      device: detail.device ?? null,
      os: detail.os ?? null,
      // A date, not an instant. `merchant.customer.birthday` is a DATE, and
      // rendering it through an ISO timestamp would move it a day in some zones.
      birthDate: detail.birthday ? isoDate(detail.birthday) : null,
      cardNumber: detail.cardNumber,
      cardId: detail.cardId,
      balanceMXN: formatMxn2(state.balance_cents),
      balanceCentavos: state.balance_cents,
      totalVisits: state.total_visits,
      visitsThisCycle: state.visits_this_cycle,
      pendingRewards: state.pending_rewards,
      ...cardPolicyFields(state),
      // The cycle's threshold and reward name, plus the ladder: `baseReward` is
      // the lower rung and `pendingRewardName` which tier a banked redemption
      // would hand over right now. The screen's last line — "Puede canjear
      // Capuccino ya, o seguir hasta 9 visitas" — reads exactly these.
      ...cardRewardFields(profile, {
        visitsThisCycle: state.visits_this_cycle,
        pendingTier1: state.pending_tier1,
        rewardPolicy: state.reward_policy,
        cycleRewardAvailable: state.cycle_reward_available,
        baseRewardBlockedByHistory: state.base_reward_blocked_by_history,
        availableRewards: state.available_rewards,
      }),
      rewardsRedeemed: redemptions.total,
      // This customer's own reward, if the café gave her one. The override row is
      // inactive by design, so it is found through the card's column and not by an
      // "active" lookup.
      customReward: rewardRows.overrideConfig
        ? {
            name: rewardRows.overrideConfig.reward_name,
            description: rewardRows.overrideConfig.reward_description,
          }
        : null,
      lastVisit: visits[0] ? visits[0].occurred_at.toISOString() : null,
      createdAt: iso(detail.createdAt ?? detail.cardCreatedAt),
      ltvCentavos,
      ltvMXN: formatMxn2(ltvCentavos),
      totalTopupCentavos,
      totalTopupMXN: formatMxn2(totalTopupCentavos),
      recentVisits: visits.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
      recentRedemptions: redemptions.rows.map((r) => ({
        id: r.id,
        redeemedAt: new Date(r.redeemedAt).toISOString(),
        note: r.note ?? null,
        revertedAt: r.revertedAt ? new Date(r.revertedAt).toISOString() : null,
      })),
      recentTransactions: ledger.map((t) => ({
        id: t.id,
        type: t.reason,
        amountCentavos: t.delta,
        description: t.note,
        createdAt: t.created_at.toISOString(),
      })),
      // The revert button is ADMIN-only ("solo a mí"); the page needs to know who
      // is looking, and the role lives on the request, not on the customer.
      viewerIsAdmin: role === 'ADMIN',
    };
  }

  /**
   * Every customer, as the CSV a cafe downloads.
   *
   * "Visitas totales" is SUM(stamps), not a row count. umi-cash counts
   * `visit_events` rows here, which reads a 16-stamp catch-up credit as one
   * visit — the same undercount that cost a real customer 20 stamps down to 5,
   * exported into a file the cafe keeps. The list and the detail already report
   * the summed figure; the export now agrees with them.
   *
   * The dates arrive already rendered in the cafe's timezone (see the repository).
   */
  async exportCustomersCsv(merchantId: string, timezone: string): Promise<string> {
    const rows = await this.repo.adminExportRows(merchantId, timezone);
    const lines = rows.map((r) =>
      [
        csvField(r.name),
        csvField(r.phone),
        csvField(r.email),
        csvField(r.cardNumber),
        csvField(formatMxn2(Number(r.balanceCentavos ?? 0))),
        String(Number(r.totalVisits ?? 0)),
        String(Number(r.visitsThisCycle ?? 0)),
        String(Number(r.pendingRewards ?? 0)),
        csvField(r.registeredOn),
      ].join(','),
    );
    return [EXPORT_HEADERS.join(','), ...lines].join('\n');
  }
}
