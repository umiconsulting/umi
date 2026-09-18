import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONTRACT_VERSION } from '@umi/contract';
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
      // The contract's OWN version, not a value handed in at build time.
      //
      // `CONTRACT_VERSION` is an environment variable that at least three places
      // maintain by hand — this package's Dockerfile, the dashboard's, and the
      // POS AppImage script — and they had drifted: the generated contract was
      // 2.19.0 while the running API reported 2.13.0 from its `.env`. A release
      // identity that can disagree with the contract the process actually speaks
      // is worse than no field: a client reads it to decide whether it can talk
      // to us. The generated constant is compiled into the same artifact, so it
      // cannot drift from it. (Defect D46.)
      contractVersion: CONTRACT_VERSION,
      expectedSchemaVersion:
        this.config.get('EXPECTED_SCHEMA_VERSION', { infer: true }) ?? 'unavailable',
      configurationSchemaVersion: this.config.get('CONFIG_SCHEMA_VERSION', { infer: true }),
      minimumPosVersion: this.config.get('MINIMUM_POS_VERSION', { infer: true }),
      minimumDashboardVersion: this.config.get('MINIMUM_DASHBOARD_VERSION', { infer: true }),
    };
  }
}
