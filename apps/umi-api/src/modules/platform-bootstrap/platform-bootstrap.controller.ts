import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PlatformBootstrapService } from './platform-bootstrap.service';
import type { PlatformBootstrapRequest, PlatformBootstrapResult } from './platform-bootstrap.types';

@Public()
@Controller('api/platform/bootstrap')
export class PlatformBootstrapController {
  constructor(private readonly service: PlatformBootstrapService) {}

  @Post('initial-merchant')
  execute(
    @Headers('x-umi-bootstrap-token') token: string | undefined,
    @Body() request: PlatformBootstrapRequest,
  ): Promise<PlatformBootstrapResult> {
    return this.service.execute(token, request);
  }
}
