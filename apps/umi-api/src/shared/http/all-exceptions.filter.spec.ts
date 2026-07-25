import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function harness() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  };
  return { host, status, send };
}

describe('AllExceptionsFilter public contract', () => {
  it('emits a canonical validation error and keeps compatibility metadata', () => {
    const { host, status, send } = harness();
    new AllExceptionsFilter().catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        fieldErrors: { email: ['Invalid email'] },
      }),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: expect.objectContaining({
          code: 'VALIDATION_FAILED',
          message: 'Invalid request',
          retryable: false,
          fieldErrors: { email: ['Invalid email'] },
        }),
      }),
    );
  });

  it('does not expose an internal exception message', () => {
    const { host, send } = harness();
    new AllExceptionsFilter().catch(
      new InternalServerErrorException('database password leaked'),
      host as never,
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          retryable: true,
        }),
      }),
    );
  });
});
