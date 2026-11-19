import { describe, expect, it } from 'vitest';
import { ClassValidationPipe } from '../../../shared/http/class-validation.pipe';
import { UpdateSettingsDto } from './update-settings.dto';

/**
 * Reproduces the merchant-settings half of the Cash settings gap.
 *
 * The dashboard Settings screen saves Cash-only fields (`primaryColor`,
 * `passStyle`, `promoMessage`, `selfRegistration`, the birthday fields) through
 * `PATCH /api/merchants/:merchantId/settings`. That route validates with
 * `UpdateSettingsDto`, and the global pipe runs with `whitelist: true`. The DTO
 * has no Cash fields, so the pipe removes them before the service sees them.
 *
 * This is a proof of the current contract, not a fix. The correct owner is the
 * Cash settings route (`PATCH /api/{ref}/admin/settings`), which already writes
 * `merchant.loyalty_program`; the merchant settings repository writes
 * `merchant.merchant` and cannot persist these columns. The next slice must route
 * the screen to the Cash settings path (dashboard writer) and then retire the
 * duplicated fields from the merchant payload.
 */
describe('merchant settings do not accept Cash-only fields', () => {
  const pipe = new ClassValidationPipe({ whitelist: true, transform: true });
  const body = {
    name: 'Café Centro',
    primaryColor: '#123456',
    secondaryColor: '#abcdef',
    passStyle: 'stamps',
    promoMessage: 'Dos por uno',
    selfRegistration: true,
    birthdayRewardEnabled: true,
    birthdayRewardName: 'Pastel',
  };

  it('strips every Cash-only field before the service can persist it', async () => {
    const parsed = (await pipe.transform(body, {
      type: 'body',
      metatype: UpdateSettingsDto,
    })) as Record<string, unknown>;

    expect(parsed.name).toBe('Café Centro');
    for (const key of [
      'primaryColor',
      'secondaryColor',
      'passStyle',
      'promoMessage',
      'selfRegistration',
      'birthdayRewardEnabled',
      'birthdayRewardName',
    ]) {
      expect(parsed, `${key} must be stripped`).not.toHaveProperty(key);
    }
  });
});
