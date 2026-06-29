import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceService } from './voice.service';
import type { UpdateVoiceDto } from './dto/update-voice.dto';

function make() {
  const repo = {
    read: vi.fn().mockResolvedValue({ businessName: null, voice: null }),
    write: vi.fn().mockResolvedValue(undefined),
  };
  return { svc: new VoiceService(repo as never), repo };
}

describe('VoiceService.updateVoice', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('clears a freeform override (empty tone → null) while keeping the preset', async () => {
    await h.svc.updateVoice('t1', { tone_preset: 'casual', tone: '' } as UpdateVoiceDto);
    expect(h.repo.write).toHaveBeenCalledWith('t1', {
      tone_preset: 'casual',
      tone: null,
    });
  });

  it('maps a blank assistant_name to null', async () => {
    await h.svc.updateVoice('t1', { assistant_name: '  ' } as UpdateVoiceDto);
    expect(h.repo.write).toHaveBeenCalledWith('t1', { assistant_name: null });
  });

  it('trims + drops blank style notes', async () => {
    await h.svc.updateVoice('t1', { style_notes: ['a', '  ', 'b'] } as UpdateVoiceDto);
    expect(h.repo.write).toHaveBeenCalledWith('t1', { style_notes: ['a', 'b'] });
  });

  it('does not write for an empty dto', async () => {
    await h.svc.updateVoice('t1', {} as UpdateVoiceDto);
    expect(h.repo.write).not.toHaveBeenCalled();
  });
});

describe('VoiceService.getVoiceSettings', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('shapes a legacy voice row: default preset, freeform tone preserved, business-name default', async () => {
    h.repo.read.mockResolvedValue({
      businessName: 'Kalala',
      voice: { assistant_name: 'Kala', tone: 'cordial' },
    });
    const r = await h.svc.getVoiceSettings('t1');
    expect(r.voice.tone_preset).toBe('friendly'); // legacy row has no preset → default chip
    expect(r.voice.tone).toBe('cordial');
    expect(r.voice.assistant_name).toBe('Kala');
    expect(r.defaults.assistant_name).toBe('Kalala');
    expect(r.presets).toHaveLength(3);
  });

  it('falls back to the friendly preset + es-MX locale for an empty voice', async () => {
    h.repo.read.mockResolvedValue({ businessName: 'Kalala', voice: null });
    const r = await h.svc.getVoiceSettings('t1');
    expect(r.voice.tone_preset).toBe('friendly');
    expect(r.voice.locale).toBe('es-MX');
    expect(r.voice.assistant_name).toBeNull();
    expect(r.voice.style_notes).toEqual([]);
  });
});
