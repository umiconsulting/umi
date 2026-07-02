// Barrel: the full contract surface. Consumers that only need paths (and want to
// stay zod-free, e.g. the dashboard bundle) should import from '@umi/contract/routes'
// instead; this entry re-exports the zod schemas and pulls zod in.
export { routes } from './routes';
export type { Routes } from './routes';
export * from './schemas';
