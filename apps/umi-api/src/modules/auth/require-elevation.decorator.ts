import { SetMetadata } from '@nestjs/common';

export const ELEVATION_KEY = 'umi:elevation';

export interface ElevationPolicy {
  permission: string;
  method: 'manager_approval' | 'operator_pin';
}

export const RequireElevation = (permission: string, method: ElevationPolicy['method']) =>
  SetMetadata(ELEVATION_KEY, { permission, method } satisfies ElevationPolicy);
