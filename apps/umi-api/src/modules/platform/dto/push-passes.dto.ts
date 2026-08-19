import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * WHICH PASSES TO PUSH. Named cards, whole cafés, or both.
 *
 * ⚠️ NO SLUGS. umi-cash took `tenantSlugs`, because a café was reached by its
 * slug. build-v3 routes by id and `merchant.handle` is designed to stop growing,
 * so a café created after the cutover has no name to be reached by. Ids only.
 */
export class PushPassesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  cardIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  merchantIds?: string[];
}
