import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

export interface ReleaseIdentity {
  application: 'umi-api';
  version: string;
  gitCommit: string;
  buildTimestamp: string;
  environment: AppConfig['UMI_ENVIRONMENT'];
  contractVersion: string;
  expectedSchemaVersion: string;
  configurationSchemaVersion: string;
  minimumPosVersion: string;
  minimumDashboardVersion: string;
}

@Injectable()
export class ReleaseIdentityService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  current(): ReleaseIdentity {
    return {
      application: 'umi-api',
      version: this.config.get('RELEASE_VERSION', { infer: true }) ?? 'development',
      gitCommit: this.config.get('RELEASE_GIT_COMMIT', { infer: true }) ?? 'unavailable',
      buildTimestamp: this.config.get('RELEASE_BUILD_TIMESTAMP', { infer: true }) ?? 'unavailable',
      environment: this.config.get('UMI_ENVIRONMENT', { infer: true }),
      contractVersion: this.config.get('CONTRACT_VERSION', { infer: true }) ?? 'unavailable',
      expectedSchemaVersion:
        this.config.get('EXPECTED_SCHEMA_VERSION', { infer: true }) ?? 'unavailable',
      configurationSchemaVersion: this.config.get('CONFIG_SCHEMA_VERSION', { infer: true }),
      minimumPosVersion: this.config.get('MINIMUM_POS_VERSION', { infer: true }),
      minimumDashboardVersion: this.config.get('MINIMUM_DASHBOARD_VERSION', { infer: true }),
    };
  }
}
