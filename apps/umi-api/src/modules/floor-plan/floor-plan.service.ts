import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  PublishedFloorPlan,
  type FloorPlanState,
  type PosFloorPlanQuery,
  type PublishFloorPlanRequest,
  type SaveFloorPlanRequest,
  type InitializePosTablesRequest,
  type AddPosTableRequest,
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

  async bootstrapTables(user: AuthUser, merchantId: string, dto: InitializePosTablesRequest) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    await this.repo.authorizeBootstrap(user, merchantId, dto);
    const result = await this.integrity.execute<PublishedFloorPlan>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: dto.idempotencyKey,
        idempotencyKey: dto.idempotencyKey,
        commandType: 'floor_plan.bootstrap_tables',
        payload: dto,
        expectedVersion: dto.expectedPublishedVersion,
      },
      async (context) => {
        const state = await this.repo.bootstrapTables(context.client, user, merchantId, dto);
        await context.appendAudit({
          eventType: 'floor_plan.tables_initialized',
          entityType: 'floor_plan',
          entityId: dto.locationId,
          outcome: 'success',
          publicData: {
            publishedVersion: state.publishedVersion,
            tableCount: dto.slots.length,
            slots: [...dto.slots].sort((a, b) => a - b),
          },
        });
        return { ok: true, value: state };
      },
    );
    if (result.status !== 'succeeded' || !result.result)
      throw new ConflictException({ code: result.failureCode ?? 'FLOOR_PLAN_COMMAND_FAILED' });
    return PublishedFloorPlan.parse(result.result);
  }

  async addTable(user: AuthUser, merchantId: string, dto: AddPosTableRequest) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    await this.repo.authorizeBootstrap(user, merchantId, dto);
    const result = await this.integrity.execute<PublishedFloorPlan>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: dto.idempotencyKey,
        idempotencyKey: dto.idempotencyKey,
        commandType: 'floor_plan.add_table',
        payload: dto,
        expectedVersion: dto.expectedPublishedVersion,
      },
      async (context) => {
        const state = await this.repo.addTable(context.client, user, merchantId, dto);
        await context.appendAudit({
          eventType: 'floor_plan.table_added',
          entityType: 'floor_plan',
          entityId: dto.locationId,
          outcome: 'success',
          publicData: {
            publishedVersion: state.publishedVersion,
            areaId: dto.areaId,
            label: dto.label,
          },
        });
        return { ok: true, value: state };
      },
    );
    if (result.status !== 'succeeded' || !result.result)
      throw new ConflictException({ code: result.failureCode ?? 'FLOOR_PLAN_COMMAND_FAILED' });
    return PublishedFloorPlan.parse(result.result);
  }
}
