import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Landing-page contact form (POST /api/leads/contact, alias /api/contact).
 * Port of the `ContactFormData` shape in `umi-landing-page/.../api/contact`.
 * Only name + email are required (matches the original validation).
 */
export class ContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  @Equals(true)
  privacyAccepted?: boolean;

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
