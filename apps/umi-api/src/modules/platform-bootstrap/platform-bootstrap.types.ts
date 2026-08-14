import { z } from 'zod';

export const PlatformBootstrapRequestSchema = z.object({
  commandId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
  merchant: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  }),
  location: z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(2).max(120) }),
  owner: z.object({
    id: z.string().uuid().optional(),
    staffId: z.string().uuid().optional(),
    email: z.string().email().max(320),
    fullName: z.string().trim().min(2).max(160),
    password: z.string().min(12).max(128),
  }),
});

export type PlatformBootstrapRequest = z.infer<typeof PlatformBootstrapRequestSchema>;

export interface PlatformBootstrapResult {
  merchantId: string;
  locationId: string;
  ownerUserId: string;
  commandId: string;
  replayed: boolean;
}
