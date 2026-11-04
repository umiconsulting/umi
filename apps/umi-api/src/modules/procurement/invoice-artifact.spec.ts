import { describe, expect, it } from 'vitest';
import { decodeInvoiceArtifact } from './invoice-artifact';

describe('invoice artifact byte limits', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  it('sniffs image bytes and keeps the legacy photo limit', () => {
    const bytes = Buffer.alloc(700 * 1024 + 1);
    png.copy(bytes);
    expect(decodeInvoiceArtifact(bytes.toString('base64')).contentType).toBe('image/png');
    expect(() => decodeInvoiceArtifact(bytes.toString('base64'), 700 * 1024)).toThrowError(
      expect.objectContaining({ response: { code: 'SUPPLIER_INVOICE_ARTIFACT_TOO_LARGE' } }),
    );
  });
  it('accepts exactly 700 KiB for direct entry', () => {
    const bytes = Buffer.alloc(700 * 1024);
    png.copy(bytes);
    const decoded = decodeInvoiceArtifact(
      `data:image/jpeg;base64,${bytes.toString('base64')}`,
      700 * 1024,
    );
    expect(decoded.contentType).toBe('image/png');
    expect(decoded.bytes.equals(bytes)).toBe(true);
  });
  it('refuses SVG and empty images', () => {
    for (const raw of [Buffer.from('<svg/>').toString('base64'), '']) {
      expect(() => decodeInvoiceArtifact(raw)).toThrowError(
        expect.objectContaining({ response: { code: 'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED' } }),
      );
    }
  });
});
