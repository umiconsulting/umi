import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatMxn, formatMxn2, iso } from '../../shared/format/money';
import { CashRepository } from './cash.repository';
import { CashCardRepository } from './cash-card.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** How much history the customer detail screen shows. */
const DETAIL_LIMIT = 10;

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

  async getStats(merchantId: string): Promise<Row> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { visits, topups, pending } = await this.repo.stats(merchantId, dayStart);
    return {
      visitsToday: Number(visits?.n ?? 0),
      topupsTodayCount: Number(topups?.n ?? 0),
      topupsTodayMXN: formatMxn(Number(topups?.sum ?? 0)),
      pendingRewards: Number(pending?.sum ?? 0),
    };
  }

  async getAnalytics(merchantId: string): Promise<Row> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const eightWeeksAgo = new Date(now);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
    eightWeeksAgo.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const d = await this.repo.analytics(merchantId, { thirtyDaysAgo, eightWeeksAgo, monthStart });

    const visitCountByDay: Record<string, number> = {};
    for (const v of d.recentVisits as Row[]) {
      const ds = new Date(v.scannedAt).toISOString().slice(0, 10);
      visitCountByDay[ds] = (visitCountByDay[ds] ?? 0) + 1;
    }
    const visitsByDay: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
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

    return {
      visitsByDay,
      topCustomers,
      newCustomersByWeek,
      totalBalance: formatMxn(totalBalanceCentavos),
      topupsThisMonth: formatMxn(Number((d.topupsRow as Row[])[0]?.sum ?? 0)),
      rewardsRedeemedThisMonth: Number((d.rewardsRow as Row[])[0]?.n ?? 0),
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
      cardNumber: r.cardNumber ?? '',
      cardId: r.cardId ?? '',
      balanceMXN: formatMxn(Number(r.balanceCentavos ?? 0)),
      balanceCentavos: Number(r.balanceCentavos ?? 0),
      totalVisits: Number(r.totalVisits ?? 0),
      visitsThisCycle: Number(r.visitsThisCycle ?? 0),
      pendingRewards: Number(r.pendingRewards ?? 0),
      lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      ltvCentavos: Number(r.ltvCentavos ?? 0),
      ltvMXN: formatMxn(Number(r.ltvCentavos ?? 0)),
    }));
    return { customers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async getRewardConfig(merchantId: string): Promise<Row> {
    const { active, history } = await this.repo.rewardConfig(merchantId);
    return { active: active[0] || null, history };
  }

  async updateRewardConfig(merchantId: string, body: Row): Promise<Row> {
    const { visitsRequired, rewardName, rewardDescription, rewardCostCentavos } = body;
    if (!visitsRequired || !rewardName) {
      throw new BadRequestException('visitsRequired and rewardName are required');
    }
    // parseInt('abc') === NaN passes the truthiness check above but would persist
    // a NaN visit target — require a positive integer.
    const visits = parseInt(visitsRequired, 10);
    if (!Number.isInteger(visits) || visits <= 0) {
      throw new BadRequestException('visitsRequired must be a positive integer');
    }
    const programId = await this.programId(merchantId);
    if (!programId) throw new BadRequestException('merchant has no loyalty program');
    const newConfig = await this.repo.upsertRewardConfig(merchantId, programId, {
      visitsRequired: visits,
      rewardName,
      rewardDescription: rewardDescription ?? null,
      rewardCostCentavos: rewardCostCentavos ?? 0,
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
    return { giftCards, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
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
  async getCustomer(merchantId: string, customerId: string): Promise<Row> {
    const detail = await this.repo.adminCustomerDetail(merchantId, customerId);
    if (!detail) throw new NotFoundException({ error: 'Cliente no encontrado' });

    const [state, totals, visits, ledger] = await Promise.all([
      this.cards.cardState(merchantId, detail.cardId),
      this.repo.cardMoneyTotals(merchantId, detail.cardId),
      this.cards.recentVisits(merchantId, detail.cardId, DETAIL_LIMIT),
      this.cards.recentLedger(merchantId, detail.cardId, DETAIL_LIMIT),
    ]);
    if (!state) throw new NotFoundException({ error: 'Cliente no encontrado' });

    const ltvCentavos = Number(totals.ltvCentavos ?? 0);
    const totalTopupCentavos = Number(totals.topupCentavos ?? 0);

    return {
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      email: detail.email,
      device: null,
      os: null,
      // A date, not an instant. `merchant.customer.birthday` is a DATE, and
      // rendering it through an ISO timestamp would move it a day in some zones.
      birthDate: detail.birthday ? isoDate(detail.birthday) : null,
      cardNumber: detail.cardNumber,
      cardId: detail.cardId,
      balanceMXN: formatMxn2(state.balance_cents),
      balanceCentavos: state.balance_cents,
      totalVisits: state.total_visits,
      visitsThisCycle: state.visits_this_cycle,
      visitsRequired: state.visits_required,
      pendingRewards: state.pending_rewards,
      lastVisit: visits[0] ? visits[0].occurred_at.toISOString() : null,
      createdAt: iso(detail.createdAt ?? detail.cardCreatedAt),
      ltvCentavos,
      ltvMXN: formatMxn2(ltvCentavos),
      totalTopupCentavos,
      totalTopupMXN: formatMxn2(totalTopupCentavos),
      recentVisits: visits.map((v) => ({ id: v.id, scannedAt: v.occurred_at.toISOString() })),
      recentTransactions: ledger.map((t) => ({
        id: t.id,
        type: t.reason,
        amountCentavos: t.delta,
        description: t.note,
        createdAt: t.created_at.toISOString(),
      })),
    };
  }
}
