import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { generateStampStrip } from './stamp-strip';

afterEach(() => vi.unstubAllGlobals());

it('renders different empty and earned states when a new café has no stamp artwork', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  const input = {
    visitsRequired: 9,
    filledStampUrl: '/new-test-filled.png',
    emptyStampUrl: '/new-test-empty.png',
    assetBase: 'https://example.invalid',
  };
  const empty = await generateStampStrip({ ...input, visitsThisCycle: 0 });
  const earned = await generateStampStrip({ ...input, visitsThisCycle: 1 });
  expect(await sharp(empty).metadata()).toMatchObject({ width: 1125, height: 369, format: 'png' });
  expect(earned.equals(empty)).toBe(false);
});
