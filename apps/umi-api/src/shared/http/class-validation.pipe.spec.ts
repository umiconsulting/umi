import { describe, expect, it } from 'vitest';
import { IsInt } from 'class-validator';
import { z } from 'zod';
import { ClassValidationPipe } from './class-validation.pipe';

class IntDto {
  @IsInt()
  n!: number;
}

const QuerySchema = z.object({ domain: z.string().default('organization') });

describe('ClassValidationPipe', () => {
  const pipe = new ClassValidationPipe({ whitelist: true, transform: true });

  it('validates a class DTO exactly as the stock pipe does', async () => {
    await expect(pipe.transform({ n: 'x' }, { type: 'body', metatype: IntDto })).rejects.toThrow();
    await expect(pipe.transform({ n: 3 }, { type: 'body', metatype: IntDto })).resolves.toEqual(
      expect.objectContaining({ n: 3 }),
    );
  });

  it('passes a zod-typed parameter through untouched, whatever the compiler emitted', async () => {
    // Under SWC (vitest) the metatype of `q: DashboardOperationsQuery` is the schema
    // object; under tsc it is `Object`. Neither is a class, and neither must reach
    // class-transformer. The handler's ZodValidationPipe owns this parameter.
    const value = {};
    await expect(
      pipe.transform(value, { type: 'query', metatype: QuerySchema as never }),
    ).resolves.toBe(value);
    await expect(pipe.transform(value, { type: 'query', metatype: Object })).resolves.toBe(value);
  });
});
