import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PgService } from '../../src/shared/database/pg.service';
import { ProcurementRepository } from '../../src/modules/procurement/procurement.repository';

/** Pause each command after its first real stock post, while its balance lock remains held. */
export class PurchasingPostingGate extends ProcurementRepository {
  private readonly pids = new Map<string, number>();

  private constructor(
    pg: PgService,
    private readonly controller: PoolClient,
    private readonly key: number,
    private readonly commands: Set<string>,
  ) {
    super(pg);
  }

  static async open(pg: PgService, commandIds: string[]): Promise<PurchasingPostingGate> {
    const controller = await pg.worker.connect();
    const key = randomInt(1, 2_000_000_000);
    try {
      await controller.query('SELECT pg_advisory_lock($1::bigint)', [key]);
      return new PurchasingPostingGate(pg, controller, key, new Set(commandIds));
    } catch (error) {
      controller.release();
      throw error;
    }
  }

  override async sendPurchaseOrder(
    ...args: Parameters<ProcurementRepository['sendPurchaseOrder']>
  ) {
    const [client, merchantId, dto, userId, fingerprint, correlationId] = args;
    if (!this.commands.has(dto.commandId)) return super.sendPurchaseOrder(...args);
    const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    this.pids.set(dto.commandId, pid.rows[0].pid);
    let paused = false;
    const query = async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values);
      if (!paused && sql.includes('FROM merchant.append_stock_ledger(')) {
        paused = true;
        await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)', [this.key]);
      }
      return result;
    };
    const scheduled = new Proxy(client, {
      get(target, property, receiver) {
        return property === 'query' ? query : Reflect.get(target, property, receiver);
      },
    });
    return super.sendPurchaseOrder(scheduled, merchantId, dto, userId, fingerprint, correlationId);
  }

  async waitForBothBlocked(): Promise<string[]> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (this.pids.size === this.commands.size) {
        const waiting = await this.controller.query<{ pid: number; locktype: string }>(
          `SELECT pid,locktype FROM pg_locks WHERE pid=ANY($1::integer[]) AND NOT granted`,
          [[...this.pids.values()]],
        );
        if (new Set(waiting.rows.map((row) => row.pid)).size === this.commands.size)
          return waiting.rows.map((row) => row.locktype).sort();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Both purchasing transactions did not reach the controlled lock wait.');
  }

  async release(): Promise<void> {
    try {
      await this.controller.query('SELECT pg_advisory_unlock($1::bigint)', [this.key]);
    } finally {
      this.controller.release();
    }
  }
}
