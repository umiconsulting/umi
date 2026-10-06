import { IsObject, IsOptional, IsString } from 'class-validator';

// Permissive by design — the service does server.js-identical coercion and
// emits the exact error messages. Fields are validated for type only.
export class CreateStaffDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, boolean>;

  @IsOptional()
  @IsString()
  operatorPin?: string | null;
}

export class UpdateStaffDto extends CreateStaffDto {}
