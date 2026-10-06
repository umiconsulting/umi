import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Diagnostic quiz submission (POST /api/leads/diagnostic, alias /api/diagnostic).
 * `responses` is the raw question-id → answer map; scoring happens server-side
 * in DiagnosticService (port of the landing `calculateDiagnostic`).
 */
export class DiagnosticDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsObject()
  responses!: Record<string, string | number>;
}
