import { Global, Module } from '@nestjs/common';
import { PgService } from './pg.service';

/**
 * Global data-access module. Provides the one `PgService` (two pg pools).
 * The RequestContextMiddleware is applied in AppModule (web only) so the
 * worker's application context stays HTTP-free.
 */
@Global()
@Module({
  providers: [PgService],
  exports: [PgService],
})
export class DatabaseModule {}
