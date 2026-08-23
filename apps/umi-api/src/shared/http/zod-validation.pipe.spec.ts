import { BadRequestException } from '@nestjs/common';
import { LoginRequest } from '@umi/contract';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(LoginRequest);

  it('returns the canonical parsed request', () => {
    expect(pipe.transform({ username: 'owner', password: 'secret', remember: true })).toEqual({
      username: 'owner',
      password: 'secret',
      remember: true,
    });
  });

  it('returns the shared validation error code and field errors', () => {
    const error = (() => {
      try {
        pipe.transform({ username: 'owner' });
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: { password: expect.any(Array) },
    });
  });
});
