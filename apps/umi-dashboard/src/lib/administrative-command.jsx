import { useCallback, useRef, useState } from 'react';
import { executeAdministrativeCommand } from '@/data.jsx';
import {
  administrativeRecoveryKey,
  readAdministrativeIdentity,
  removeAdministrativeIdentity,
  writeAdministrativeIdentity,
} from './administrative-command-identity.js';

export function useAdministrativeCommand() {
  const [state, setState] = useState({ pending: false, error: null, result: null });
  const ambiguous = useRef(new Map());

  const execute = useCallback(async (operation, targetAggregateId, options) => {
    setState({ pending: true, error: null, result: null });
    const input = options || {};
    const recoveryKey = administrativeRecoveryKey(operation, targetAggregateId, input);
    const prior =
      ambiguous.current.get(recoveryKey) ||
      readAdministrativeIdentity(window.sessionStorage, recoveryKey);
    const identity = {
      commandId: input.commandId || prior?.commandId || crypto.randomUUID(),
      idempotencyKey: input.idempotencyKey || prior?.idempotencyKey || crypto.randomUUID(),
    };
    ambiguous.current.set(recoveryKey, identity);
    writeAdministrativeIdentity(window.sessionStorage, recoveryKey, identity);
    try {
      const response = await executeAdministrativeCommand(operation, targetAggregateId, {
        ...input,
        ...identity,
      });
      ambiguous.current.delete(recoveryKey);
      removeAdministrativeIdentity(window.sessionStorage, recoveryKey);
      setState({ pending: false, error: null, result: response.result });
      return response;
    } catch (error) {
      if (error?.status && error.status < 500) {
        ambiguous.current.delete(recoveryKey);
        removeAdministrativeIdentity(window.sessionStorage, recoveryKey);
      }
      setState({ pending: false, error, result: null });
      throw error;
    }
  }, []);

  const requestApproval = useCallback(
    (operation, targetAggregateId, options) => execute(operation, targetAggregateId, options),
    [execute],
  );

  const executeApprovedCommand = useCallback(
    async ({
      approvalOperation,
      approvalParameters,
      commitOperation,
      commitOptions,
      managerPin,
      targetAggregateId,
    }) => {
      let approvalId = null;
      if (approvalOperation) {
        const approval = await execute(approvalOperation, targetAggregateId, {
          parameters: { ...approvalParameters, managerPin },
        });
        approvalId = approval.result.approvalId || approval.result.elevationId;
      }
      return execute(commitOperation, targetAggregateId, {
        ...commitOptions,
        approvalId,
        parameters: {
          ...(commitOptions.parameters || {}),
          approvalId,
        },
      });
    },
    [execute],
  );

  const recover = useCallback(
    (commandId, options) => execute('recovery.query_original', commandId, options),
    [execute],
  );

  const reset = useCallback(() => setState({ pending: false, error: null, result: null }), []);
  return {
    ...state,
    execute,
    executeApprovedCommand,
    requestApproval,
    recover,
    reset,
  };
}
