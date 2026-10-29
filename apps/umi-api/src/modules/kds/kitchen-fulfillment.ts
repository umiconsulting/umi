import type { KitchenOrderProjection } from '@umi/contract';

/** Normalize the commercial order type without guessing missing context. */
export function kitchenFulfillmentType(value: unknown): KitchenOrderProjection['fulfillmentType'] {
  switch (value) {
    case 'pickup':
    case 'takeout':
      return 'takeout';
    case 'dine_in':
    case 'delivery':
      return value;
    default:
      return null;
  }
}
