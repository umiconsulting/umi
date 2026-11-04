import { BadRequestException } from '@nestjs/common';

/** The column's own bound: 12 MB of bytes, which is the binary of 20 MB of base64. */
const MAX_INVOICE_ARTIFACT_BYTES = 12_582_912;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Determine the image type from its bytes. Accept browser FileReader data URLs. */
export function decodeInvoiceArtifact(
  raw: string,
  maxBytes = MAX_INVOICE_ARTIFACT_BYTES,
): { bytes: Buffer; contentType: string } {
  const base64 = raw.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0)
    throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED' });
  if (bytes.byteLength > maxBytes)
    throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_TOO_LARGE' });

  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC))
    return { bytes, contentType: 'image/png' };
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { bytes, contentType: 'image/jpeg' };
  if (
    bytes.byteLength >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return { bytes, contentType: 'image/webp' };

  throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED' });
}
