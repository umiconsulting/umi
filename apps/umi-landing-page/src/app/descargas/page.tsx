import type { Metadata } from 'next';
import DownloadContent from './DownloadContent';

export const metadata: Metadata = {
  title: 'Descargar UmiPOS para Android — Umi',
  description: 'Instala UmiPOS en tu tablet o terminal Android.',
  alternates: { canonical: 'https://www.umiconsulting.co/descargas' },
};
export default function DownloadsPage() {
  return <DownloadContent />;
}
