import sharp from 'sharp';

/**
 * The stamp-card strip image drawn on an Apple Wallet pass.
 *
 * Ported from umi-cash `strip-generator.ts` with the geometry unchanged. The
 * layout is what the customer recognises as their card, so the arithmetic below
 * is deliberately identical: same canvas, same gaps, same maximum stamp size,
 * same centring of a short last row.
 *
 * ONE DIFFERENCE FROM THE ORIGINAL. umi-cash tried the local filesystem before
 * HTTP, because its `public/` directory holds the brand assets. umi-api has no
 * such directory — the assets stay in umi-cash and are fetched over HTTP — so the
 * filesystem branch is gone and the fetched buffers are cached in process
 * instead. These are static brand images; refetching them for every pass render
 * would put N requests on a path Apple calls once per device per update.
 */

const STRIP_W = 1125; // @3x width
const STRIP_H = 369; // @3x height
const GAP = 10;
const MAX_STAMP = 180;

/** Brand assets change when a café is re-branded, which is rare and manual. */
const assetCache = new Map<string, Buffer>();

function hexToBackground(hex?: string | null): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  // No colour means transparent, which lets the pass background show through.
  if (!hex) return { r: 0, g: 0, b: 0, alpha: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

/** Fetch a brand asset, resolving a leading `/` against the wallet origin. */
export async function loadAsset(url: string, assetBase: string): Promise<Buffer> {
  const fullUrl = url.startsWith('/') ? `${assetBase}${url}` : url;
  const cached = assetCache.get(fullUrl);
  if (cached) return cached;

  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`asset fetch failed: ${res.status} ${fullUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assetCache.set(fullUrl, buf);
  return buf;
}

export interface StampStripInput {
  visitsThisCycle: number;
  visitsRequired: number;
  filledStampUrl: string;
  emptyStampUrl: string;
  welcomeStampUrl?: string | null;
  backgroundColor?: string | null;
  assetBase: string;
}

/**
 * Draw the strip: a filled stamp for each visit in this cycle, an empty one for
 * each visit still to come. The first slot shows the welcome stamp instead, but
 * only on a fresh cycle — once the customer has one visit the slot is theirs.
 */
export async function generateStampStrip(input: StampStripInput): Promise<Buffer> {
  const { visitsThisCycle, visitsRequired, assetBase } = input;

  const [filledBuf, emptyBuf] = await Promise.all([
    loadAsset(input.filledStampUrl, assetBase),
    loadAsset(input.emptyStampUrl, assetBase),
  ]);

  let welcomeBuf: Buffer | null = null;
  if (input.welcomeStampUrl && visitsThisCycle === 0) {
    // A café that never uploaded a welcome stamp is normal, not an error.
    welcomeBuf = await loadAsset(input.welcomeStampUrl, assetBase).catch(() => null);
  }

  // Ten stamps become two rows of five. Six or fewer stay on one row.
  const cols = visitsRequired <= 6 ? visitsRequired : Math.ceil(visitsRequired / 2);
  const rows = visitsRequired <= 6 ? 1 : 2;

  const stampSize = Math.min(
    Math.floor((STRIP_W - 40) / cols) - GAP,
    Math.floor((STRIP_H - 20) / rows) - GAP,
    MAX_STAMP,
  );

  const totalH = rows * (stampSize + GAP) - GAP;
  const startY = Math.floor((STRIP_H - totalH) / 2);

  const [filledStamp, emptyStamp, welcomeStamp] = await Promise.all([
    sharp(filledBuf).resize(stampSize, stampSize).png().toBuffer(),
    sharp(emptyBuf).resize(stampSize, stampSize).png().toBuffer(),
    welcomeBuf ? sharp(welcomeBuf).resize(stampSize, stampSize).png().toBuffer() : null,
  ]);

  const composites: sharp.OverlayOptions[] = [];
  const lastRowCols = visitsRequired > cols ? visitsRequired - cols : cols;
  for (let i = 0; i < visitsRequired; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // A last row with fewer stamps is centred on its own width, not the full one.
    const rowColCount = row === rows - 1 ? lastRowCols : cols;
    const rowW = rowColCount * (stampSize + GAP) - GAP;
    const rowStartX = Math.floor((STRIP_W - rowW) / 2);
    const stamp =
      i === 0 && welcomeStamp ? welcomeStamp : i < visitsThisCycle ? filledStamp : emptyStamp;
    composites.push({
      input: stamp,
      left: rowStartX + col * (stampSize + GAP),
      top: startY + row * (stampSize + GAP),
    });
  }

  return sharp({
    create: {
      width: STRIP_W,
      height: STRIP_H,
      channels: 4,
      background: hexToBackground(input.backgroundColor),
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
