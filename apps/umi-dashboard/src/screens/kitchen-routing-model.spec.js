import { describe, expect, it } from 'vitest';
import { defaultRoute, routeFor, routingRows } from './kitchen-routing-model.js';

const BARRA = { id: 'barra', name: 'Barra' };
const COCINA = { id: 'cocina', name: 'Cocina' };

const categoryRoute = (categoryId, stationId, extra = {}) => ({
  id: `route-cat-${categoryId}`,
  categoryId,
  productId: null,
  stationId,
  routePriority: 100,
  active: true,
  ...extra,
});
const productRoute = (productId, stationId, extra = {}) => ({
  id: `route-prod-${productId}`,
  categoryId: null,
  productId,
  stationId,
  routePriority: 100,
  active: true,
  ...extra,
});
const generalRoute = (stationId, extra = {}) => ({
  id: 'route-general',
  categoryId: null,
  productId: null,
  stationId,
  routePriority: 100,
  active: true,
  ...extra,
});

describe('a qué estación va un platillo', () => {
  it('el producto manda sobre su categoría', () => {
    const routes = [categoryRoute('bebidas', BARRA.id), productRoute('capuccino', COCINA.id)];
    const route = routeFor({ categoryId: 'bebidas', productId: 'capuccino' }, routes);
    expect(route.stationId).toBe(COCINA.id);
  });

  it('la categoría manda sobre la predeterminada', () => {
    const routes = [generalRoute(COCINA.id), categoryRoute('bebidas', BARRA.id)];
    const route = routeFor({ categoryId: 'bebidas', productId: 'capuccino' }, routes);
    expect(route.stationId).toBe(BARRA.id);
  });

  it('la predeterminada recoge lo que nadie reclamó', () => {
    const routes = [categoryRoute('bebidas', BARRA.id), generalRoute(COCINA.id)];
    const route = routeFor({ categoryId: 'postres', productId: 'pay' }, routes);
    expect(route.stationId).toBe(COCINA.id);
  });

  it('sin ninguna ruta que lo reclame, no hay estación — el caso que la cocina guarda como excepción', () => {
    const routes = [categoryRoute('bebidas', BARRA.id)];
    expect(routeFor({ categoryId: 'postres', productId: 'pay' }, routes)).toBeNull();
  });

  it('una ruta apagada no es una ruta', () => {
    const routes = [categoryRoute('bebidas', BARRA.id, { active: false }), generalRoute(COCINA.id)];
    const route = routeFor({ categoryId: 'bebidas', productId: 'capuccino' }, routes);
    expect(route.stationId).toBe(COCINA.id);
  });

  it('un empate se rompe por prioridad', () => {
    const routes = [
      categoryRoute('bebidas', BARRA.id, { id: 'route-b', routePriority: 200 }),
      categoryRoute('bebidas', COCINA.id, { id: 'route-a', routePriority: 100 }),
    ];
    const route = routeFor({ categoryId: 'bebidas', productId: 'capuccino' }, routes);
    expect(route.stationId).toBe(COCINA.id);
  });

  it('encuentra la predeterminada aunque esté apagada en la lista', () => {
    expect(defaultRoute([categoryRoute('bebidas', BARRA.id)])).toBeNull();
    expect(defaultRoute([generalRoute(COCINA.id)]).stationId).toBe(COCINA.id);
  });
});

describe('las filas del panel', () => {
  const categories = [{ id: 'bebidas', name: 'Bebidas' }];
  const products = [
    { id: 'capuccino', name: 'Capuccino', categoryId: 'bebidas' },
    { id: 'latte', name: 'Latte', categoryId: 'bebidas' },
  ];

  it('dice de dónde viene la estación de cada platillo', () => {
    const routes = [categoryRoute('bebidas', BARRA.id), productRoute('capuccino', COCINA.id)];
    const [row] = routingRows({ categories, products, routes });
    const capuccino = row.products.find((entry) => entry.product.id === 'capuccino');
    const latte = row.products.find((entry) => entry.product.id === 'latte');
    expect(capuccino.source).toBe('product');
    expect(capuccino.resolved.stationId).toBe(COCINA.id);
    expect(latte.source).toBe('category');
    expect(latte.resolved.stationId).toBe(BARRA.id);
  });

  it('marca como sin destino lo que no tiene a dónde ir', () => {
    const [row] = routingRows({ categories, products, routes: [] });
    expect(row.products.every((entry) => entry.source === 'none')).toBe(true);
    expect(row.products.every((entry) => entry.resolved === null)).toBe(true);
  });
});
