/**
 * A QUÉ ESTACIÓN VA CADA PLATILLO — la misma regla que aplica el servidor.
 *
 * The owner's question when a plate lands on the wrong screen is not "which rule did I
 * write" but "where does THIS go", and the answer has to be the one the kitchen will
 * actually get. So the rule is stated once here, in the same shape as the API's resolver
 * (`apps/umi-api/src/modules/kds/kitchen-projector.ts`, `resolveKitchenRoutes`): a
 * product's own route wins over its category's, the category's wins over the general
 * one, ties break by priority and then by id, and an INACTIVE route is not a route.
 *
 * The twin is pinned by `kitchen-routing-model.spec.js` on this side and by the API's own
 * spec on the other, so the preview the owner reads and the station the cook gets cannot
 * drift apart silently.
 */

/** The route kinds, in the order they win. */
export const ROUTE_PRODUCT = 0;
export const ROUTE_CATEGORY = 1;
export const ROUTE_DEFAULT = 2;

export function routePrecedence(route, { categoryId, productId }) {
  if (route.productId && route.productId === productId) return ROUTE_PRODUCT;
  if (route.categoryId && route.categoryId === categoryId) return ROUTE_CATEGORY;
  return ROUTE_DEFAULT;
}

/** Every active route that could claim this line, best first. */
export function candidatesFor(target, routes) {
  return routes
    .filter((route) => route.active !== false)
    .filter(
      (route) =>
        (route.productId && route.productId === target.productId) ||
        (!route.productId && route.categoryId && route.categoryId === target.categoryId) ||
        (!route.productId && !route.categoryId),
    )
    .sort((left, right) => {
      const precedence = routePrecedence(left, target) - routePrecedence(right, target);
      if (precedence !== 0) return precedence;
      const priority = (left.routePriority ?? 100) - (right.routePriority ?? 100);
      if (priority !== 0) return priority;
      return String(left.id).localeCompare(String(right.id));
    });
}

/**
 * The route a line will take, or null when NOTHING claims it.
 *
 * Null is the interesting answer: it is the same state the kitchen stores as
 * `exception`/`missing_route`, where the plate is on nobody's screen and nobody is told
 * to make it. The screen shows it in red and names the fix (assign the category, or the
 * general route).
 */
export function routeFor(target, routes) {
  return candidatesFor(target, routes)[0] ?? null;
}

/** The general route — the "predeterminada" every kitchen should have. */
export function defaultRoute(routes) {
  return (
    routes.find((route) => !route.productId && !route.categoryId && route.active !== false) ?? null
  );
}

/** The route that assigns a whole category, if any. */
export function categoryRoute(categoryId, routes) {
  return (
    routes.find(
      (route) => !route.productId && route.categoryId === categoryId && route.active !== false,
    ) ?? null
  );
}

/** The route that overrides one product, if any. */
export function productRoute(productId, routes) {
  return routes.find((route) => route.productId === productId && route.active !== false) ?? null;
}

/**
 * Rows for the workspace: every category with its route, and every product with the
 * route it will actually take — its own override, its category's, or the general one
 * (`source` says which, so the screen can tell "heredado" from "propio").
 */
export function routingRows({ categories, products, routes }) {
  return categories.map((category) => {
    const own = categoryRoute(category.id, routes);
    return {
      category,
      categoryRoute: own,
      products: products
        .filter((product) => product.categoryId === category.id)
        .map((product) => {
          const override = productRoute(product.id, routes);
          const resolved = routeFor({ categoryId: category.id, productId: product.id }, routes);
          return {
            product,
            override,
            resolved,
            source: override
              ? 'product'
              : resolved && resolved.categoryId === category.id
                ? 'category'
                : resolved
                  ? 'default'
                  : 'none',
          };
        }),
    };
  });
}
