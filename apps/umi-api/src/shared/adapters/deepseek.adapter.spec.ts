import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepseekAdapter } from './deepseek.adapter';

const CFG = {
  DEEPSEEK_API_KEY: 'sk-x',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_MODEL: 'deepseek-chat',
};

function make(cfg: Record<string, unknown>) {
  const config = { get: vi.fn((k: string) => cfg[k]) };
  return new DeepseekAdapter(config as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DeepseekAdapter.createCompletion', () => {
  it('returns null and never calls the API when no key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const a = make({ ...CFG, DEEPSEEK_API_KEY: undefined });
    expect(await a.createCompletion({ system: 's', userMessage: 'u' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an OpenAI-compatible body and maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hola' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = make(CFG);
    const r = await a.createCompletion({ system: 'sys', userMessage: 'usr', maxTokens: 100 });

    expect(r).toEqual({ text: 'hola', inputTokens: 12, outputTokens: 3 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(opts.headers.authorization).toBe('Bearer sk-x');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.max_tokens).toBe(100);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('honours a per-call model override', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }], usage: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const a = make(CFG);
    await a.createCompletion({ system: 's', userMessage: 'u', model: 'deepseek-flash' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-flash');
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }),
    );
    const a = make(CFG);
    expect(await a.createCompletion({ system: 's', userMessage: 'u' })).toBeNull();
  });

  it('returns null when fetch throws (network / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation timed out')));
    const a = make(CFG);
    expect(await a.createCompletion({ system: 's', userMessage: 'u' })).toBeNull();
  });
});
