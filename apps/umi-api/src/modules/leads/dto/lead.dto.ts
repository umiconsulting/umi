import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Direct lead upsert + sequence trigger (POST /api/leads). Port of the landing
 * `/api/leads` POST. The frontend does not call this — it's an internal/admin
 * entry that mirrors what a diagnostic submission does.
 */
export class CreateLeadDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  // Diagnostic payload (score/level/recommendations). Loosely typed — the
  // service normalizes it into the canonical diagnostic_data jsonb.
  @IsObject()
  diagnosticData!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  triggerSequence?: boolean;
}

/**
 * Lead lifecycle actions (PUT /api/leads). Port of the landing `/api/leads` PUT.
 */
export class UpdateLeadDto {
  @IsString()
  leadId!: string;

  @IsIn(['pause_sequence', 'resume_sequence', 'mark_responded'])
  action!: 'pause_sequence' | 'resume_sequence' | 'mark_responded';

  @IsOptional()
  @IsObject()
  data?: { reason?: string; responseType?: string };
}
