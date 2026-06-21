/**
 * Dynamic strip image generator for Apple Wallet passes.
 * Generates stamp-card style strips showing visit progress.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const STRIP_W = 1125; // @3x width
const STRIP_H = 369;  // @3x height

function hexToBg(hex?: string): { r: number; g: number; b: number; alpha: number } {
  if (!hex) return { r: 0, g: 0, b: 0, alpha: 0 }; // transparent — inherits pass primary color
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, alpha: 1 };
}

/**
 * Load a stamp image — tries filesystem first, then HTTP.
 */
async function loadStampImage(url: string): Promise<Buffer> {
  // Try filesystem first (works locally, may not work on Vercel)
  if (url.startsWith('/')) {
    const filePath = path.join(process.cwd(), 'public', url);
    try {
      const buf = fs.readFileSync(filePath);
      console.log(`[StampStrip] Loaded ${url} from filesystem (${buf.length} bytes)`);
      return buf;
    } catch {
      // Not available on filesystem (Vercel), fall through to HTTP
    }
  }

  // HTTP fetch — resolves relative URLs against NEXT_PUBLIC_APP_URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const fullUrl = url.startsWith('/') ? `${appUrl}${url}` : url;
  console.log(`[StampStrip] Fetching ${fullUrl} via HTTP`);
  const res = await fetch(fullUrl);
  if (!res.ok) {
    throw new Error(`[StampStrip] Failed to fetch ${fullUrl}: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[StampStrip] Fetched ${fullUrl} (${buf.length} bytes)`);
  return buf;
}

/**
 * Generate a dynamic stamp-card strip image.
 * Shows filled stamps (with mascot) for completed visits, empty circles for remaining.
 */
export async function generateStampStrip(
  visitsThisCycle: number,
  visitsRequired: number,
  filledStampUrl: string,
  emptyStampUrl: string,
  stripBgColor?: string | null,
  welcomeStampUrl?: string | null,
): Promise<Buffer> {
  console.log(`[StampStrip] Generating strip: ${visitsThisCycle}/${visitsRequired} visits, bgColor=${stripBgColor}`);

  const [filledBuf, emptyBuf] = await Promise.all([
    loadStampImage(filledStampUrl),
    loadStampImage(emptyStampUrl),
  ]);
  // Welcome stamp is optional — only show on slot 0 when the customer hasn't used it yet
  let welcomeBuf: Buffer | null = null;
  if (welcomeStampUrl && visitsThisCycle === 0) {
    try { welcomeBuf = await loadStampImage(welcomeStampUrl); } catch { welcomeBuf = null; }
  }

  // Layout: arrange stamps in rows
  // For 10 stamps: 2 rows of 5
  // For other counts: single row if <=6, else 2 rows
  const cols = visitsRequired <= 6 ? visitsRequired : Math.ceil(visitsRequired / 2);
  const rows = visitsRequired <= 6 ? 1 : 2;

  const stampSize = Math.min(
    Math.floor((STRIP_W - 40) / cols) - 10, // horizontal fit
    Math.floor((STRIP_H - 20) / rows) - 10, // vertical fit
    180, // max size
  );

  const totalW = cols * (stampSize + 10) - 10;
  const totalH = rows * (stampSize + 10) - 10;
  const startX = Math.floor((STRIP_W - totalW) / 2);
  const startY = Math.floor((STRIP_H - totalH) / 2);

  // Resize stamp images
  const filledStamp = await sharp(filledBuf).resize(stampSize, stampSize).png().toBuffer();
  const emptyStamp = await sharp(emptyBuf).resize(stampSize, stampSize).png().toBuffer();
  const welcomeStamp = welcomeBuf
    ? await sharp(welcomeBuf).resize(stampSize, stampSize).png().toBuffer()
    : null;

  // Build composite operations
  const composites: sharp.OverlayOptions[] = [];
  const lastRowCols = visitsRequired > cols ? visitsRequired - cols : cols;
  for (let i = 0; i < visitsRequired; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // Center the last row if it has fewer stamps
    const rowColCount = row === rows - 1 ? lastRowCols : cols;
    const rowW = rowColCount * (stampSize + 10) - 10;
    const rowStartX = Math.floor((STRIP_W - rowW) / 2);
    const x = rowStartX + col * (stampSize + 10);
    const y = startY + row * (stampSize + 10);
    const stampInput =
      i === 0 && welcomeStamp
        ? welcomeStamp
        : i < visitsThisCycle
          ? filledStamp
          : emptyStamp;
    composites.push({ input: stampInput, left: x, top: y });
  }

  console.log(`[StampStrip] Compositing ${composites.length} stamps (${stampSize}px each, ${cols}x${rows})`);

  // Create background and composite stamps
  return sharp({
    create: {
      width: STRIP_W,
      height: STRIP_H,
      channels: 4,
      background: hexToBg(stripBgColor ?? undefined),
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
