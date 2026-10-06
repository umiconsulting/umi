import { z } from 'zod';

const Id = z.string().uuid();
const Label = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^<>\u0000-\u001f]+$/);
const Dimension = z.number().finite().min(8).max(5000);

export const FloorPlanElement = z
  .object({
    id: Id,
    kind: z.enum(['table', 'wall', 'counter', 'door', 'label']),
    shape: z.enum(['rectangle', 'round', 'square']),
    label: Label,
    capacity: z.number().int().min(0).max(100),
    x: z.number().finite().min(0).max(5000),
    y: z.number().finite().min(0).max(5000),
    width: Dimension,
    height: Dimension,
    rotation: z.number().finite().min(0).lt(360),
  })
  .strict();

export const FloorPlanArea = z
  .object({
    id: Id,
    name: Label,
    width: z.number().int().min(200).max(5000),
    height: z.number().int().min(200).max(5000),
    elements: z.array(FloorPlanElement).max(500),
  })
  .strict();

export function floorElementBounds(
  element: Pick<z.infer<typeof FloorPlanElement>, 'width' | 'height' | 'rotation'>,
) {
  const angle = (element.rotation * Math.PI) / 180;
  return {
    halfWidth:
      (Math.abs(Math.cos(angle)) * element.width + Math.abs(Math.sin(angle)) * element.height) / 2,
    halfHeight:
      (Math.abs(Math.sin(angle)) * element.width + Math.abs(Math.cos(angle)) * element.height) / 2,
  };
}

export const FloorPlanDocument = z
  .object({
    schemaVersion: z.literal(1),
    areas: z.array(FloorPlanArea).min(1).max(20),
  })
  .strict()
  .superRefine((document, ctx) => {
    const ids = new Set<string>();
    const areaNames = new Set<string>();
    let count = 0;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    document.areas.forEach((area, areaIndex) => {
      const base = ['areas', areaIndex];
      const name = area.name.toLocaleLowerCase('en-US');
      if (ids.has(area.id)) issue([...base, 'id'], 'Duplicate identity');
      ids.add(area.id);
      if (areaNames.has(name)) issue([...base, 'name'], 'Duplicate area name');
      areaNames.add(name);
      const labels = new Set<string>();
      area.elements.forEach((element, elementIndex) => {
        count += 1;
        const path = [...base, 'elements', elementIndex];
        if (ids.has(element.id)) issue([...path, 'id'], 'Duplicate identity');
        ids.add(element.id);
        if (element.kind === 'table') {
          const label = element.label.toLocaleLowerCase('en-US');
          if (labels.has(label)) issue([...path, 'label'], 'Duplicate table label');
          labels.add(label);
          if (element.capacity < 1) issue([...path, 'capacity'], 'A table needs capacity');
        } else if (element.capacity !== 0)
          issue([...path, 'capacity'], 'Only tables have capacity');
        if (element.shape !== 'rectangle' && element.width !== element.height)
          issue([...path, 'height'], 'Round and square shapes need equal dimensions');
        const bounds = floorElementBounds(element);
        if (
          element.x < bounds.halfWidth - 0.001 ||
          element.y < bounds.halfHeight - 0.001 ||
          element.x + bounds.halfWidth > area.width + 0.001 ||
          element.y + bounds.halfHeight > area.height + 0.001
        ) {
          issue(path, 'Element lies outside the area');
        }
      });
    });
    if (count > 1000) issue(['areas'], 'A layout supports at most 1000 elements');
  });

export const FloorPlanQuery = z.object({ locationId: Id }).strict();
export const PosFloorPlanQuery = FloorPlanQuery.extend({ operatorSessionId: Id }).strict();
export const SaveFloorPlanRequest = z
  .object({
    locationId: Id,
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: Id,
    document: FloorPlanDocument,
  })
  .strict();
export const PublishFloorPlanRequest = SaveFloorPlanRequest.omit({ document: true }).strict();
export const FloorPlanState = z
  .object({
    locationId: Id,
    version: z.number().int().nonnegative(),
    draft: FloorPlanDocument.nullable(),
    publishedVersion: z.number().int().nonnegative(),
    published: FloorPlanDocument.nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export const PublishedFloorPlan = FloorPlanState.omit({ version: true, draft: true }).strict();

export type FloorPlanElement = z.infer<typeof FloorPlanElement>;
export type FloorPlanArea = z.infer<typeof FloorPlanArea>;
export type FloorPlanDocument = z.infer<typeof FloorPlanDocument>;
export type FloorPlanState = z.infer<typeof FloorPlanState>;
export type SaveFloorPlanRequest = z.infer<typeof SaveFloorPlanRequest>;
export type PublishFloorPlanRequest = z.infer<typeof PublishFloorPlanRequest>;
export type PosFloorPlanQuery = z.infer<typeof PosFloorPlanQuery>;
export const floorPlanModels = {
  FloorPlanElement,
  FloorPlanArea,
  FloorPlanDocument,
  FloorPlanQuery,
  PosFloorPlanQuery,
  SaveFloorPlanRequest,
  PublishFloorPlanRequest,
  FloorPlanState,
  PublishedFloorPlan,
};
