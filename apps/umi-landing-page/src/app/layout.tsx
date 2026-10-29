import './globals.css';
import { Inter_Tight, JetBrains_Mono, Source_Sans_3 } from 'next/font/google';

const interTight = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter-tight',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-sans',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const metadata = {
  title: 'Umi — Una sola operación para tu restaurante',
  description:
    'Pedidos, cocina, cobro y clientes en una sola operación. Conoce cómo Umi conecta el trabajo diario de tu restaurante.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${interTight.variable} ${sourceSans.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
