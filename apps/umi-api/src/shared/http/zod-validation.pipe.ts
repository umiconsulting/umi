import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '$';
      (fieldErrors[path] ??= []).push(issue.message);
    }
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request does not match the public contract.',
      fieldErrors,
    });
  }
}
