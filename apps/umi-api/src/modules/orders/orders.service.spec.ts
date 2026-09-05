import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService, isCommercialTransition } from './orders.service';

describe('isCommercialTransition', () => {
  it('advances the commercial spine', () => {
    expect(isCommercialTransition('placed', 'preparing')).toBe(true);
    expect(isCommercialTransition('preparing', 'ready')).toBe(true);
    expect(isCommercialTransition('ready', 'completed')).toBe(true);
  });

  it('allows a cancel from any non-terminal state', () => {
    expect(isCommercialTransition('placed', 'canceled')).toBe(true);
    expect(isCommercialTransition('preparing', 'canceled')).toBe(true);
    expect(isCommercialTransition('ready', 'canceled')).toBe(true);
  });

  it('refuses to go backwards or jump states', () => {
    expect(isCommercialTransition('placed', 'ready')).toBe(false);
    expect(isCommercialTransition('completed', 'ready')).toBe(false);
    expect(isCommercialTransition('canceled', 'placed')).toBe(false);
    expect(isCommercialTransition('ready', 'placed')).toBe(false);
  });

  it('refuses a terminal state advancing', () => {
    expect(isCommercialTransition('completed', 'in_preparation')).toBe(false);
    expect(isCommercialTransition('canceled', 'preparing')).toBe(false);
  });
});

describe('OrdersService', () => {
  function make() {
    const repo = {
      listOrders: vi.fn(),
      loadOrderStatus: vi.fn(),
      setStatus: vi.fn(),
    };
    return { repo, service: new OrdersService(repo as never) };
  }

  it('maps the derived order row to the dashboard contract (cents -> pesos)', async () => {
    const { repo, service } = make();
    repo.listOrders.mockResolvedValue({
      rows: [
        {
          id: 'o1',
          publicReference: 'EXT-1',
          source: 'whatsapp',
          status: 'preparing',
          fulfillmentType: 'pickup',
          customerName: 'Ana',
          customerPhone: '+5255',
          totalCents: 12500,
          placedAt: '2026-01-01T12:00:00.000Z',
          updatedAt: '2026-01-01T12:05:00.000Z',
          locationId: 'l1',
          items: [
            {
              id: 'i1',
              name: 'Latte',
              variantName: null,
              quantity: 2,
              unitPriceCents: 6000,
              notes: null,
            },
          ],
        },
      ],
    });
    const result = await service.listForDashboard('m1', 'active', 'whatsapp', null);
    expect(result.orders[0].order_id).toBe('o1');
    expect(result.orders[0].source).toBe('whatsapp');
    expect(result.orders[0].customer_name).toBe('Ana');
    expect(result.orders[0].total_amount).toBe(125);
    expect(result.orders[0].total_cents).toBe(12500);
    expect(result.orders[0].items[0].unit_price).toBe(60);
  });

  it('ignores an unknown channel (does not filter by it)', async () => {
    const { repo, service } = make();
    repo.listOrders.mockResolvedValue({ rows: [] });
    await service.listForDashboard('m1', 'all', 'bogus', null);
    expect(repo.listOrders).toHaveBeenCalledWith('m1', {
      filter: 'all',
      channel: null,
      locationId: null,
      limit: 200,
    });
  });

  it('rejects an invalid transition with BAD_REQUEST', async () => {
    const { repo, service } = make();
    repo.loadOrderStatus.mockResolvedValue({ id: 'o1', status: 'completed', version: '3' });
    await expect(service.transitionFromDashboard('m1', 'o1', 'ready')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('advances a valid transition', async () => {
    const { repo, service } = make();
    repo.loadOrderStatus.mockResolvedValue({ id: 'o1', status: 'placed', version: '1' });
    repo.setStatus.mockResolvedValue(true);
    const result = await service.transitionFromDashboard('m1', 'o1', 'preparing');
    expect(result).toEqual({ ok: true, orderId: 'o1', status: 'preparing' });
    expect(repo.setStatus).toHaveBeenCalledWith('m1', 'o1', 'preparing');
  });

  it('throws NOT_FOUND when the order does not exist', async () => {
    const { repo, service } = make();
    repo.loadOrderStatus.mockResolvedValue(null);
    await expect(service.transitionFromDashboard('m1', 'nope', 'preparing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
