import { z } from 'zod';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
export const CatalogAvailability = z.enum([
  'enabled',
  'disabled',
  'temporarily_unavailable',
  'out_of_assortment',
  'future_availability',
]);
export const CatalogMoney = z
  .object({ minorUnits: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) })
  .strict();
export const CatalogCategory = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    displayOrder: z.number().int(),
    enabled: z.boolean(),
  })
  .strict();
export const ProductMedia = z
  .object({
    url: z.string().url().max(2048),
    altText: z.string().max(240).nullable(),
    width: z.number().int().positive().max(8192).nullable(),
    height: z.number().int().positive().max(8192).nullable(),
    displayOrder: z.number().int(),
  })
  .strict();
export const CatalogModifier = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    priceDelta: CatalogMoney,
    available: z.boolean(),
  })
  .strict();
export const CatalogOptionGroup = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    required: z.boolean(),
    minSelections: z.number().int().nonnegative(),
    maxSelections: z.number().int().positive().nullable(),
    modifiers: z.array(CatalogModifier).max(100),
  })
  .strict();
export const CatalogVariant = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    attributes: z.record(z.string().max(120)).refine((value) => Object.keys(value).length <= 12),
    priceDelta: CatalogMoney,
    availability: CatalogAvailability,
  })
  .strict();
export const CatalogProductSummary = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(240),
    description: z.string().max(2000).nullable(),
    sku: z.string().max(120).nullable(),
    hasBarcode: z.boolean(),
    category: CatalogCategory.nullable(),
    price: CatalogMoney,
    taxRateBasisPoints: z.number().int().min(0).max(10000),
    availability: CatalogAvailability,
    availableFrom: Timestamp.nullable(),
    primaryMedia: ProductMedia.nullable(),
    hasVariants: z.boolean(),
    hasModifiers: z.boolean(),
    updatedAt: Timestamp,
  })
  .strict();
export const CatalogProductDetail = CatalogProductSummary.extend({
  barcode: z.string().max(160).nullable(),
  media: z.array(ProductMedia).max(24),
  variants: z.array(CatalogVariant).max(100),
  optionGroups: z.array(CatalogOptionGroup).max(50),
}).strict();
export const CatalogPage = z
  .object({
    items: z.array(CatalogProductSummary).max(100),
    nextCursor: z.string().min(1).max(256).nullable(),
    catalogVersion: z.string().min(1).max(128),
    updatedAt: Timestamp,
  })
  .strict();
export const CatalogCategoriesResponse = z
  .object({
    items: z.array(CatalogCategory).max(200),
    catalogVersion: z.string().min(1).max(128),
    updatedAt: Timestamp,
  })
  .strict();
export const CatalogQuery = z
  .object({
    locationId: Uuid,
    categoryId: Uuid.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    barcode: z.string().trim().min(1).max(160).optional(),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
    locale: z.enum(['es', 'en']).default('es'),
  })
  .strict();
export type CatalogQuery = z.infer<typeof CatalogQuery>;
export type CatalogProductSummary = z.infer<typeof CatalogProductSummary>;
export type CatalogProductDetail = z.infer<typeof CatalogProductDetail>;
export type CatalogCategory = z.infer<typeof CatalogCategory>;

export const posCatalogModels = {
  CatalogAvailability,
  CatalogMoney,
  CatalogCategory,
  ProductMedia,
  CatalogModifier,
  CatalogOptionGroup,
  CatalogVariant,
  CatalogProductSummary,
  CatalogProductDetail,
  CatalogPage,
  CatalogCategoriesResponse,
  CatalogQuery,
};
