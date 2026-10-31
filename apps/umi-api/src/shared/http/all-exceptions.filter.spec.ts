import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function harness() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const header = vi.fn();
  // The real `ArgumentsHost` carries the REQUEST too, and the filter reads its
  // method and URL for the refusal line. A double that offers only the response
  // is not a smaller host — it is a different one, and the filter crashed on it
  // in CI while a fresh `http.getRequest` was being added.
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => ({ status, header }),
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/pos/merchants/x/cart?operatorSessionId=y',
      }),
    }),
  };
  return { host, status, send, header };
}

describe('AllExceptionsFilter public contract', () => {
  it('publishes count lock contention as a retryable conflict', () => {
    const { host, status, send } = harness();
    new AllExceptionsFilter().catch(
      new ConflictException({ code: 'INVENTORY_COUNT_BUSY', retryable: true }),
      host as never,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INVENTORY_COUNT_BUSY', retryable: true }),
      }),
    );
  });

  it.each([
    'CART_ACTOR_BUSY',
    'CART_ACCOUNT_BUSY',
    'CART_VERSION_CONFLICT',
    'CART_PAYMENT_UNRESOLVED',
    'CART_TABLE_ACCOUNT_EXISTS',
    'CART_ALREADY_ASSIGNED',
    'TABLE_HAS_OPEN_ACCOUNT',
    'KITCHEN_PREPARATION_STARTED',
  ])('preserves the actionable open-account refusal %s in the HTTP envelope', (code) => {
    const { host, status, send } = harness();
    new AllExceptionsFilter().catch(new ConflictException({ code }), host as never);

    expect(status).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: expect.objectContaining({ code, retryable: false }),
      }),
    );
  });

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

  it('states the wait a rate limit asks the client to observe', () => {
    const { host, status, send, header } = harness();
    new AllExceptionsFilter().catch(
      new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Request rate limit exceeded.',
          retryAfterSeconds: 42,
        },
        429,
      ),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(header).toHaveBeenCalledWith('retry-after', '42');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        error: expect.objectContaining({
          code: 'RATE_LIMITED',
          retryable: true,
          details: { retryAfterSeconds: 42 },
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
