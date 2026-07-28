// Barrel: the full contract surface. Consumers that only need paths (and want to
// stay zod-free, e.g. the dashboard bundle) should import from '@umi/contract/routes'
// instead; this entry re-exports the zod schemas and pulls zod in.
export { routes } from './routes';
export type { Routes } from './routes';
export * from './schemas';
export * from './platform';
export * from './device';
export * from './pos-catalog';
export * from './pos-cart';
export * from './catalog';
// Zero-dep entitlement vocabulary. Also published as '@umi/contract/entitlements'
// so the zod-free dashboard bundle can import it without pulling zod.
export * from './entitlements';
