import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: string;

  // Branch resolution (Phase 2): owner-curated nicknames the bot matches a
  // customer's branch mention against (e.g. ["chapu"] for "Chapultepec"). Capped
  // here because forbidNonWhitelisted is off and the bot reads these without
  // re-validating length.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  descriptor?: string;
}
