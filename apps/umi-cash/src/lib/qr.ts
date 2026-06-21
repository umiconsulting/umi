import QRCode from 'qrcode';

export async function generateQRDataURL(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    width: 300,
    margin: 2,
    color: {
      dark: '#1F1410',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });
}

export async function generateQRBuffer(content: string): Promise<Buffer> {
  const dataURL = await generateQRDataURL(content);
  const base64 = dataURL.split(',')[1];
  return Buffer.from(base64, 'base64');
}

export function generateCardNumber(prefix = 'LYL'): string {
  const num = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
  return `${prefix}-${num}`;
}
