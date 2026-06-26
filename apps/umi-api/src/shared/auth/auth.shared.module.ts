import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { JwtService } from './jwt.service';
import { QrService } from './qr.service';

/**
 * Cross-cutting auth primitives (one auth layer, §4.3). Global so guards in any
 * module — and the worker context — can inject JwtService/PasswordService
 * without re-importing. Domain auth (controller, repository, guards) lives in
 * `modules/auth`.
 */
@Global()
@Module({
  providers: [PasswordService, JwtService, QrService],
  exports: [PasswordService, JwtService, QrService],
})
export class SharedAuthModule {}
