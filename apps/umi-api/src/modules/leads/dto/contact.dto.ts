import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Landing-page contact form (POST /api/leads/contact, alias /api/contact).
 * Port of the `ContactFormData` shape in `umi-landing-page/.../api/contact`.
 * Only name + email are required (matches the original validation).
 */
export class ContactDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  // Product interest key (conversaflow|kds|cash|suite|indeciso) or free text.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  need?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;
}
