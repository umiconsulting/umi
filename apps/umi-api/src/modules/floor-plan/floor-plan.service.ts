import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  PublishedFloorPlan,
  type FloorPlanState,
  type PosFloorPlanQuery,
  type PublishFloorPlanRequest,
  type SaveFloorPlanRequest,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { IntegrityService } from '../integrity/integrity.service';
import { FloorPlanRepository } from './floor-plan.repository';

@Injectable()
export class FloorPlanService {
  constructor(
    private readonly repo: FloorPlanRepository,
    private readonly integrity: IntegrityService,
  ) {}

  read(access: MerchantAccess, locationId: string) {
    resolveLocationAuthority(access, locationId);
    return this.repo.read(access.merchantId, locationId);
  }

  async readForPos(user: AuthUser, merchantId: string, query: PosFloorPlanQuery) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    return PublishedFloorPlan.parse(await this.repo.readForPos(user, merchantId, query));
  }

  async change(access: MerchantAccess, dto: SaveFloorPlanRequest | PublishFloorPlanRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const document = 'document' in dto ? dto.document : undefined;
    const result = await this.integrity.execute<FloorPlanState>(
      {
        merchantId: access.merchantId,
        locationId: dto.locationId,
        commandId: dto.idempotencyKey,
        idempotencyKey: dto.idempotencyKey,
        commandType: document ? 'floor_plan.save' : 'floor_plan.publish',
        payload: dto,
        expectedVersion: dto.expectedVersion,
      },
      async (context) => {
        const state = await this.repo.change(
          context.client,
          access.merchantId,
          dto.locationId,
          dto.expectedVersion,
          document,
        );
        await context.appendAudit({
          eventType: document ? 'floor_plan.saved' : 'floor_plan.published',
          entityType: 'floor_plan',
          entityId: dto.locationId,
          outcome: 'success',
          publicData: {
            version: state.version,
            ...(document ? {} : { document: state.published }),
          },
        });
        return { ok: true, value: state };
      },
    );
    if (result.status !== 'succeeded' || !result.result)
      throw new ConflictException({ code: result.failureCode ?? 'FLOOR_PLAN_COMMAND_FAILED' });
    return result.result;
  }
}
