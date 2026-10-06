import { Injectable, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

/**
 * The global class-validator pipe, restricted to what class-validator can validate:
 * a parameter whose runtime metatype is a CLASS.
 *
 * Two validation styles share this API. build-v3's DTOs are classes and go through
 * class-validator here; the UmiPOS routes declare their shapes in `@umi/contract`
 * as zod schemas and validate them in the handler with `ZodValidationPipe`. A
 * zod-validated parameter is typed as the schema's inferred type — and the schema's
 * CONST shares that name. What lands in `design:paramtypes` for it therefore
 * depends on the compiler: tsc emits `Object` (a type-only reference); SWC, which
 * vitest uses for decorator metadata, emits the schema object itself. Nest's stock
 * `ValidationPipe` excludes only the primitives and `Object` from validation, so
 * under SWC it hands a `ZodObject` instance to class-transformer, which reads
 * `.prototype.constructor` off it and throws — every POS route 500s in the
 * integration suites while answering correctly in the tsc build.
 *
 * Deciding by "is it a function" (a constructor) instead of "is it not a primitive"
 * is the rule class-validator actually needs, and it holds under either compiler.
 */
@Injectable()
export class ClassValidationPipe extends ValidationPipe {
  protected override toValidate(metadata: ArgumentMetadata): boolean {
    return typeof metadata.metatype === 'function' && super.toValidate(metadata);
  }
}
