// Barrel: the full contract surface. Consumers that only need paths (and want to
// stay zod-free, e.g. the dashboard bundle) should import from '@umi/contract/routes'
// instead; this entry re-exports the zod schemas and pulls zod in.
export { routes } from './routes';
export type { Routes } from './routes';
// The single author of every path in the platform. Zero-dependency, so the zod-free
// surfaces can import it directly.
export { ROUTE_TABLE, route, routePath, buildPath, merchantBase } from './route-table';
export type { RouteDef, RouteContract, RouteId, HttpMethod, AuthMode } from './route-table';
// The one rule for a customer-typed phone number, shared by the zod schema here and
// the class-validator DTO in umi-api so the two cannot drift.
export { nationalDigitsAreValid, splitPhone, phoneLengthMessage } from './phone';
export type { PhoneParts } from './phone';
export * from './schemas';
// Cross-cutting vocabulary (money, ids, pagination, errors, tenancy) shared by every
// surface. Also published as '@umi/contract/platform'.
export * from './platform';
// Device trust and the POS surfaces.
export * from './device';
export * from './pos-catalog';
export * from './pos-cart';
export * from './pos-checkout';
export * from './pos-offline';
// The generated-artifact manifest: versions, error/route/model/invariant catalogues.
export * from './catalog';
// Zero-dep entitlement vocabulary. Also published as '@umi/contract/entitlements'
// so the zod-free dashboard bundle can import it without pulling zod.
export * from './entitlements';
