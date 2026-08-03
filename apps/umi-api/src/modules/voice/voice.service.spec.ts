import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceService } from './voice.service';

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

  it('persists the tone preset', async () => {
    await h.svc.updateVoice('t1', { tone_preset: 'casual' });
    expect(h.repo.write).toHaveBeenCalledWith('t1', { tone_preset: 'casual' });
  });

  it('maps a blank assistant_name to null', async () => {
    await h.svc.updateVoice('t1', { assistant_name: '  ' });
    expect(h.repo.write).toHaveBeenCalledWith('t1', { assistant_name: null });
  });

  it('persists both knobs together', async () => {
    await h.svc.updateVoice('t1', { assistant_name: 'Sofía', tone_preset: 'formal' });
    expect(h.repo.write).toHaveBeenCalledWith('t1', {
      assistant_name: 'Sofía',
      tone_preset: 'formal',
    });
  });

  it('does not write for an empty dto', async () => {
    await h.svc.updateVoice('t1', {});
    expect(h.repo.write).not.toHaveBeenCalled();
  });
});

describe('VoiceService.getVoiceSettings', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('shapes a stored voice row: preset + name + merchant-name default', async () => {
    h.repo.read.mockResolvedValue({
      businessName: 'Kalala',
      voice: { assistant_name: 'Kala', tone_preset: 'formal' },
    });
    const r = await h.svc.getVoiceSettings('t1');
    expect(r.voice.tone_preset).toBe('formal');
    expect(r.voice.assistant_name).toBe('Kala');
    expect(r.defaults.assistant_name).toBe('Kalala');
    expect(r.presets).toHaveLength(3);
  });

  it('falls back to the friendly preset for an empty voice', async () => {
    h.repo.read.mockResolvedValue({ businessName: 'Kalala', voice: null });
    const r = await h.svc.getVoiceSettings('t1');
    expect(r.voice.tone_preset).toBe('friendly');
    expect(r.voice.assistant_name).toBeNull();
  });
});
