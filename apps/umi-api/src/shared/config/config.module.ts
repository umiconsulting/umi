import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateConfig } from './config.schema';

/**
 * Global typed configuration. Inject `ConfigService<AppConfig, true>` anywhere
 * and read with `config.get('KEY', { infer: true })`.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateConfig,
    }),
  ],
})
export class AppConfigModule {}
