import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getRequestContext } from '../../shared/database/request-context';
import { commandFingerprint } from './canonical-json';
import { IntegrityRepository } from './integrity.repository';
import type {
  BusinessOutcome,
  CommandInput,
  CommandResult,
  TransactionContext,
} from './integrity.types';

@Injectable()
export class IntegrityService {
  constructor(private readonly repository: IntegrityRepository) {}

  async execute<T>(
    input: Omit<CommandInput, 'correlationId'> & { correlationId?: string },
    operation: (context: TransactionContext) => Promise<BusinessOutcome<T>>,
  ): Promise<CommandResult<T>> {
    const command: CommandInput = {
      ...input,
      correlationId: input.correlationId ?? getRequestContext()?.correlationId ?? randomUUID(),
    };
    const fingerprint = commandFingerprint(command.commandType, command.payload);
    return this.repository.transaction(async (client) => {
      const claim = await this.repository.claimCommand(client, command, fingerprint);
      if (!claim.owner) return this.repository.result<T>(claim.row, true);

      const context: TransactionContext = {
        client,
        commandId: command.commandId,
        correlationId: command.correlationId,
        claimVersion: (aggregateType, aggregateId, expectedVersion) =>
          this.repository.claimVersion(
            client,
            command.merchantId,
            aggregateType,
            aggregateId,
            expectedVersion,
          ),
        appendAudit: (event) =>
          this.repository.appendAudit(client, command, getRequestContext()?.userId ?? null, event),
        appendFinancial: async (event, expectedVersion) => {
          const version = await this.repository.claimVersion(
            client,
            command.merchantId,
            event.aggregateType,
            event.aggregateId,
            expectedVersion,
          );
          return this.repository.appendFinancial(client, command, event, version);
        },
      };
      const outcome = await operation(context);
      if (!outcome.ok) {
        await this.repository.fail(
          client,
          command.merchantId,
          command.idempotencyKey,
          outcome.code,
          outcome.failureClass,
          outcome.retryable,
        );
      } else {
        await this.repository.succeed(
          client,
          command.merchantId,
          command.idempotencyKey,
          outcome.value,
        );
      }
      const completed = await this.repository.getCommand(
        client,
        command.merchantId,
        command.idempotencyKey,
      );
      return this.repository.result<T>(completed, false);
    });
  }
}
