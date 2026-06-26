import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class TopupDto {
  @IsString()
  cardId!: string;

  @IsInt()
  @Min(100, { message: 'El monto mínimo es $1.00' })
  amountCentavos!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  // Client-supplied, stable per user action: a retry with the same key is a
  // no-op rather than a double credit (deduped on points_ledger.idempotency_key).
  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}

export class PurchaseDto {
  @IsString()
  cardId!: string;

  @IsInt()
  @Min(1, { message: 'El monto mínimo es $0.01' })
  amountCentavos!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}

export class GiftCardCreateDto {
  @IsInt()
  @Min(100, { message: 'El monto mínimo es $1.00' })
  amountCentavos!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  // At least one recipient channel — enforced by the two ValidateIf rules.
  @ValidateIf((o) => !o.recipientPhone)
  @IsEmail({}, { message: 'Se requiere email o teléfono del destinatario' })
  recipientEmail?: string;

  @ValidateIf((o) => !o.recipientEmail)
  @IsString({ message: 'Se requiere email o teléfono del destinatario' })
  @MaxLength(20)
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientName?: string;
}
