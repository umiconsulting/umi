import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Email-provider callback (POST /api/leads/webhook/email-response). Port of the
 * landing `WebhookData` shape. Signature-verified in LeadsService.
 */
export class EmailResponseWebhookDto {
  @IsIn(['email_reply', 'meeting_scheduled', 'unsubscribe'])
  type!: 'email_reply' | 'meeting_scheduled' | 'unsubscribe';

  @IsString()
  leadId!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['email', 'phone', 'meeting'])
  responseType?: 'email' | 'phone' | 'meeting';
}
