import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatMxn } from '../../shared/format/money';
import { CashRepository } from './cash.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * Cash analytics/reads for the dashboard (D11 read side — always live). All
 * money is integer centavos; date math mirrors server.js exactly. Admin-config
 * writes (settings branding, reward-config) live here too — they are NOT the
 * inert customer-facing path (see cash-write.service / preflight §4).
 */
@Injectable()
export class CashReadService {
  constructor(private readonly repo: CashRepository) {}

  async getSettings(tenantId: string): Promise<Row> {
    const t = await this.repo.branding(tenantId);
    if (!t) throw new NotFoundException({ error: 'Tenant no encontrado' });
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
      slug: t.slug,
    };
  }

  async updateSettings(tenantId: string, d: Row): Promise<void> {
    if (d.name !== undefined) {
      await this.repo.updateTenantName(tenantId, d.name);
    }
    const brandingPatch: Record<string, unknown> = {};
    if (d.primaryColor !== undefined) brandingPatch.primary_color = d.primaryColor;
    if (d.secondaryColor !== undefined) brandingPatch.secondary_color = d.secondaryColor || null;
    if (d.logoUrl !== undefined) brandingPatch.logo_url = d.logoUrl || null;
    if (d.stripImageUrl !== undefined) brandingPatch.strip_image_url = d.stripImageUrl || null;
    if (d.promoMessage !== undefined) brandingPatch.promo_message = d.promoMessage || null;
    if (d.promoStartsAt !== undefined) brandingPatch.promo_starts_at = d.promoStartsAt || null;
    if (d.promoEndsAt !== undefined) brandingPatch.promo_ends_at = d.promoEndsAt || null;
    if (d.promoDays !== undefined) brandingPatch.promo_days = d.promoDays || null;
    if (d.birthdayRewardEnabled !== undefined) brandingPatch.birthday_reward_enabled = d.birthdayRewardEnabled;
    if (d.birthdayRewardName !== undefined) brandingPatch.birthday_reward_name = d.birthdayRewardName;

    const updatesProgram =
      d.cardPrefix !== undefined || d.passStyle !== undefined ||
      Object.keys(brandingPatch).length > 0;
    if (updatesProgram) {
      await this.repo.updateProgram(tenantId, {
        cardPrefix: d.cardPrefix,
        passStyle: d.passStyle,
        brandingPatch,
      });
    }
  }

  async getStats(tenantId: string): Promise<Row> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { visits, topups, pending } = await this.repo.stats(tenantId, dayStart);
    return {
      visitsToday: Number(visits?.n ?? 0),
      topupsTodayCount: Number(topups?.n ?? 0),
      topupsTodayMXN: formatMxn(Number(topups?.sum ?? 0)),
      pendingRewards: Number(pending?.sum ?? 0),
    };
  }

  async getAnalytics(tenantId: string): Promise<Row> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); thirtyDaysAgo.setHours(0, 0, 0, 0);
    const eightWeeksAgo = new Date(now); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56); eightWeeksAgo.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const d = await this.repo.analytics(tenantId, { thirtyDaysAgo, eightWeeksAgo, monthStart });

    const visitCountByDay: Record<string, number> = {};
    for (const v of d.recentVisits as Row[]) {
      const ds = new Date(v.scannedAt).toISOString().slice(0, 10);
      visitCountByDay[ds] = (visitCountByDay[ds] ?? 0) + 1;
    }
    const visitsByDay: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(now); dt.setDate(dt.getDate() - i);
      const ds = dt.toISOString().slice(0, 10);
      visitsByDay.push({ date: ds, count: visitCountByDay[ds] ?? 0 });
    }

    const topCustomers = (d.topCards as Row[]).map((c) => ({
      id: c.userId, name: c.name ?? 'Sin nombre', cardNumber: c.cardNumber,
      totalVisits: Number(c.totalVisits ?? 0), balanceMXN: formatMxn(Number(c.balanceCentavos ?? 0)),
    }));

    const todayDow = now.getDay();
    const daysToMon = todayDow === 0 ? 6 : todayDow - 1;
    const thisWeekMon = new Date(now); thisWeekMon.setDate(now.getDate() - daysToMon); thisWeekMon.setHours(0, 0, 0, 0);
    const weekBuckets: { weekStart: Date; label: string }[] = [];
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(thisWeekMon); ws.setDate(thisWeekMon.getDate() - i * 7);
      weekBuckets.push({ weekStart: ws, label: `${MONTHS[ws.getMonth()]} ${ws.getDate()}` });
    }
    const recentUsers = d.recentUsers as Row[];
    const newCustomersByWeek = weekBuckets.map(({ weekStart, label }, idx) => {
      const next = idx < weekBuckets.length - 1 ? weekBuckets[idx + 1].weekStart : new Date(now.getTime() + 86400000);
      const count = recentUsers.filter((u) => new Date(u.createdAt) >= weekStart && new Date(u.createdAt) < next).length;
      return { week: label, count };
    });

    const totalsRow = (d.totalsRow as Row[])[0];
    const totalCustomers = Number(totalsRow?.totalCustomers ?? 0);
    const totalBalanceCentavos = Number((d.balanceRow as Row[])[0]?.sum ?? 0);
    const totalAllTimeVisits = Number(totalsRow?.totalAllTimeVisits ?? 0);
    const activeCustomersLast30 = Number((d.activeRow as Row[])[0]?.n ?? 0);
    const trueAvg = totalCustomers > 0 ? Math.round((totalAllTimeVisits / totalCustomers) * 10) / 10 : 0;
    const retentionRate = totalCustomers > 0 ? Math.round((activeCustomersLast30 / totalCustomers) * 100) : 0;
    const totalRevenueCentavos = Math.abs(Number(totalsRow?.totalRevenueCentavos ?? 0));
    const avgTicketCentavos = totalAllTimeVisits > 0 ? Math.round(totalRevenueCentavos / totalAllTimeVisits) : 0;
    const cfg = (d.activeRewardConfigRow as Row[])[0];
    const visitsRequired = Number(cfg?.visitsRequired ?? 10);
    const rewardCostCentavos = Number(cfg?.rewardCostCentavos ?? 0);
    const revenuePerCycle = avgTicketCentavos * visitsRequired;
    const marginPerCycle = revenuePerCycle - rewardCostCentavos;
    const marginPercent = revenuePerCycle > 0 ? Math.round((marginPerCycle / revenuePerCycle) * 100) : null;

    return {
      visitsByDay, topCustomers, newCustomersByWeek,
      totalBalance: formatMxn(totalBalanceCentavos),
      topupsThisMonth: formatMxn(Number((d.topupsRow as Row[])[0]?.sum ?? 0)),
      rewardsRedeemedThisMonth: Number((d.rewardsRow as Row[])[0]?.n ?? 0),
      avgVisitsPerCustomer: trueAvg,
      retentionRate,
      profitability: {
        avgTicketMXN: formatMxn(avgTicketCentavos), revenuePerCycleMXN: formatMxn(revenuePerCycle),
        rewardCostMXN: formatMxn(rewardCostCentavos), marginPerCycleMXN: formatMxn(marginPerCycle),
        marginPercent, visitsRequired, rewardCostConfigured: rewardCostCentavos > 0,
      },
    };
  }

  async getCustomers(tenantId: string, query: Row): Promise<Row> {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const search = String(query.search || '').trim().slice(0, 50);
    const sort = query.sort || 'recent';
    const skip = (page - 1) * limit;

    const { rows, total } = await this.repo.adminCustomers(tenantId, { search, sort, limit, skip });
    const customers = rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phone, email: r.email,
      cardNumber: r.cardNumber ?? '', cardId: r.cardId ?? '',
      balanceMXN: formatMxn(Number(r.balanceCentavos ?? 0)), balanceCentavos: Number(r.balanceCentavos ?? 0),
      totalVisits: Number(r.totalVisits ?? 0), visitsThisCycle: Number(r.visitsThisCycle ?? 0),
      pendingRewards: Number(r.pendingRewards ?? 0),
      lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      ltvCentavos: Number(r.ltvCentavos ?? 0), ltvMXN: formatMxn(Number(r.ltvCentavos ?? 0)),
    }));
    return { customers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async getRewardConfig(tenantId: string): Promise<Row> {
    const { active, history } = await this.repo.rewardConfig(tenantId);
    return { active: active[0] || null, history };
  }

  async updateRewardConfig(tenantId: string, body: Row): Promise<Row> {
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
    const programId = await this.programId(tenantId);
    if (!programId) throw new BadRequestException('tenant has no loyalty program');
    const newConfig = await this.repo.upsertRewardConfig(tenantId, programId, {
      visitsRequired: visits,
      rewardName,
      rewardDescription: rewardDescription ?? null,
      rewardCostCentavos: rewardCostCentavos ?? 0,
    });
    return { ok: true, newConfig };
  }

  async getGiftCards(tenantId: string, query: Row): Promise<Row> {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const skip = (page - 1) * limit;
    const { rows, total } = await this.repo.giftCards(tenantId, limit, skip);
    const giftCards = rows.map((g) => ({
      id: g.id, code: g.code,
      amountCentavos: Number(g.amountCentavos ?? 0), amountMXN: formatMxn(Number(g.amountCentavos ?? 0)),
      senderName: g.senderName, recipientName: g.recipientName, recipientEmail: g.recipientEmail,
      recipientPhone: g.recipientPhone, message: g.message, isRedeemed: g.isRedeemed,
      redeemedAt: g.redeemedAt ? new Date(g.redeemedAt).toISOString() : null,
      expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null,
      createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : null,
    }));
    return { giftCards, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Program id for the tenant (reward-config write needs it). */
  async programId(tenantId: string): Promise<string | null> {
    const t = await this.repo.branding(tenantId);
    return (t?.programId as string) ?? null;
  }
}
