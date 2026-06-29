import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateVoiceDto } from './dto/update-voice.dto';

function check(body: Record<string, unknown>) {
  return validateSync(plainToInstance(UpdateVoiceDto, body), {
    whitelist: true,
  });
}

describe('UpdateVoiceDto validation', () => {
  it('accepts a valid preset', () => {
    expect(check({ tone_preset: 'formal' })).toHaveLength(0);
  });

  it('accepts an empty dto (all fields optional)', () => {
    expect(check({})).toHaveLength(0);
  });

  it('rejects an unknown preset (@IsIn)', () => {
    const errors = check({ tone_preset: 'snarky' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('tone_preset');
  });

  it('rejects an over-long assistant_name (@MaxLength 60)', () => {
    const errors = check({ assistant_name: 'x'.repeat(61) });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('assistant_name');
  });

  it('rejects more than 8 style notes (@ArrayMaxSize)', () => {
    const errors = check({ style_notes: Array.from({ length: 9 }, () => 'n') });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('style_notes');
  });

  it('rejects non-string style-note entries (@IsString each)', () => {
    const errors = check({ style_notes: [123] });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('style_notes');
  });
});
