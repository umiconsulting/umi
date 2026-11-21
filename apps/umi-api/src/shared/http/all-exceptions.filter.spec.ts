import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../database/request-context';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface HarnessOptions {
  method?: string;
  url?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { deviceId?: string | null; device_id?: string | null };
}

function harness(options: HarnessOptions = {}) {
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
        method: options.method ?? 'POST',
        url: options.url ?? '/api/v1/pos/merchants/x/cart?operatorSessionId=y',
        ip: options.ip ?? '203.0.113.42',
        headers: options.headers ?? {},
        user: options.user,
      }),
    }),
  };
  return { host, status, send, header };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('logs safe operational context on 401 refusals and never leaks Authorization headers', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const secretBearer = 'Bearer super-secret-jwt-token-do-not-log';
    const { host, status } = harness({
      method: 'POST',
      url: '/api/v1/pos/offline/replay/begin?operatorSessionId=secret-session-123',
      ip: '198.51.100.17',
      headers: {
        authorization: secretBearer,
        'x-umi-pos-build': '2.59.0+342',
        'x-umi-device-id': 'dev-caja-principal',
      },
    });

    new AllExceptionsFilter().catch(
      new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      }),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('statusCode=401');
    expect(logged).toContain('method=POST');
    expect(logged).toContain('path=/api/v1/pos/offline/replay/begin');
    expect(logged).toContain('deviceId=dev-caja-principal');
    expect(logged).toContain('posBuild=2.59.0+342');
    expect(logged).toContain('ip=198.51.100.17');
    expect(logged).toContain('code=AUTHENTICATION_REQUIRED');
    expect(logged).not.toContain('super-secret-jwt-token-do-not-log');
    expect(logged).not.toContain('Bearer');
    expect(logged).not.toContain('secret-session-123');
  });

  it('logs deviceId from request context/user and posBuild on 429 and 403 refusals', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host: rateHost } = harness({
      method: 'POST',
      url: '/api/v1/pos/offline/replay/submit',
      ip: '198.51.100.25',
      headers: {
        authorization: 'Bearer another-secret-token',
        'x-umi-pos-build': '337',
      },
      user: { deviceId: 'dev-barra-02' },
    });

    new AllExceptionsFilter().catch(
      new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Request rate limit exceeded.',
          retryAfterSeconds: 15,
        },
        429,
      ),
      rateHost as never,
    );

    const rateLine = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(rateLine).toContain('statusCode=429');
    expect(rateLine).toContain('deviceId=dev-barra-02');
    expect(rateLine).toContain('posBuild=337');
    expect(rateLine).toContain('ip=198.51.100.25');
    expect(rateLine).toContain('code=RATE_LIMITED');
    expect(rateLine).not.toContain('another-secret-token');

    const { host: forbiddenHost } = harness({
      method: 'POST',
      url: '/api/v1/pos/kds/commands',
      ip: '198.51.100.26',
      headers: { 'x-umi-pos-build': '2.59.0+342' },
    });

    runWithRequestContext(
      {
        merchantId: 'merchant-onca',
        locationId: 'loc-main',
        deviceId: 'dev-kds-01',
        userId: 'user-1',
        requestId: 'req-1',
        correlationId: 'corr-1',
      },
      () => {
        new AllExceptionsFilter().catch(
          new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Missing permission' }),
          forbiddenHost as never,
        );
      },
    );

    const forbiddenLine = String(warnSpy.mock.calls[1]?.[0] ?? '');
    expect(forbiddenLine).toContain('statusCode=403');
    expect(forbiddenLine).toContain('deviceId=dev-kds-01');
    expect(forbiddenLine).toContain('posBuild=2.59.0+342');
    expect(forbiddenLine).toContain('code=PERMISSION_DENIED');
  });
});
