import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  AssignHardwareRequest,
  ControlledReprintRequest,
  HardwareCommandRequest,
  HardwareCommandTransitionRequest,
  HardwareDiagnosticRequest,
  HardwareRecoveryQuery,
  HardwareRegistryQuery,
  RegisterHardwareRequest,
  UpdateHardwareRequest,
  UpdateHardwarePolicyRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosHardwareService } from './pos-hardware.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/hardware')
export class PosHardwareController {
  constructor(private readonly hardware: PosHardwareService) {}

  @Get()
  registry(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(HardwareRegistryQuery)) query: HardwareRegistryQuery,
  ) {
    return this.hardware.registry(user, merchantId, query);
  }

  @Post()
  register(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(RegisterHardwareRequest)) dto: RegisterHardwareRequest,
  ) {
    return this.hardware.register(user, merchantId, dto);
  }

  @Patch('policy')
  updatePolicy(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(UpdateHardwarePolicyRequest)) dto: UpdateHardwarePolicyRequest,
  ) {
    return this.hardware.updatePolicy(user, merchantId, dto);
  }

  @Patch(':hardwareId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('hardwareId') hardwareId: string,
    @Body(new ZodValidationPipe(UpdateHardwareRequest)) dto: UpdateHardwareRequest,
  ) {
    return this.hardware.update(user, merchantId, hardwareId, dto);
  }

  @Post(':hardwareId/assignment')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('hardwareId') hardwareId: string,
    @Body(new ZodValidationPipe(AssignHardwareRequest)) dto: AssignHardwareRequest,
  ) {
    return this.hardware.assign(user, merchantId, hardwareId, dto);
  }

  @Post('commands')
  command(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(HardwareCommandRequest)) dto: HardwareCommandRequest,
  ) {
    return this.hardware.command(user, merchantId, dto);
  }

  @Post('commands/:commandId/transition')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandId') commandId: string,
    @Body(new ZodValidationPipe(HardwareCommandTransitionRequest))
    dto: HardwareCommandTransitionRequest,
  ) {
    return this.hardware.transition(user, merchantId, commandId, dto);
  }

  @Post('print-jobs/:jobId/reprint')
  reprint(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(ControlledReprintRequest)) dto: ControlledReprintRequest,
  ) {
    return this.hardware.reprint(user, merchantId, jobId, dto);
  }

  @Get('print-jobs/:jobId/command')
  printJobCommand(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('jobId') jobId: string,
    @Query(new ZodValidationPipe(HardwareRecoveryQuery)) query: HardwareRecoveryQuery,
  ) {
    return this.hardware.printJobCommand(user, merchantId, jobId, query);
  }

  @Post('diagnostics')
  diagnostic(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(HardwareDiagnosticRequest)) dto: HardwareDiagnosticRequest,
  ) {
    return this.hardware.diagnostic(user, merchantId, dto);
  }

  @Get('runtime')
  runtime(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(HardwareRegistryQuery)) query: HardwareRegistryQuery,
  ) {
    return this.hardware.registry(user, merchantId, query);
  }

  @Get('recovery')
  recovery(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(HardwareRecoveryQuery)) query: HardwareRecoveryQuery,
  ) {
    return this.hardware.recovery(user, merchantId, query);
  }
}
