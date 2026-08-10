import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

@Injectable()
export class AdministrativeCommandRepository {
  constructor(private readonly pg: PgService) {}

  async assertDashboardSession(userId: string, sessionId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM runtime.dashboard_session
          WHERE id=$1::uuid AND user_id=$2::uuid AND is_active AND expires_at>clock_timestamp()
       ) AS active`,
      [sessionId, userId],
    );
    return rows[0]?.active === true;
  }

  async findCommand(
    merchantId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<{ fingerprint: string; status: string; result: unknown } | null> {
    const { rows } = await this.pg.query<{ fingerprint: string; status: string; result: unknown }>(
      `SELECT fingerprint,status,result
         FROM merchant.administrative_command
        WHERE merchant_id=$1::uuid AND (command_id=$2::uuid OR idempotency_key=$3::uuid)
        LIMIT 1`,
      [merchantId, commandId, idempotencyKey],
    );
    return rows[0] ?? null;
  }
}
