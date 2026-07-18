import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Umi Cash — Plataforma de Lealtad',
  description: 'Sistema de lealtad y saldo para cafeterías',
  manifest: '/manifest.json',
  // Declared so the browser resolves these from the advertised links instead of
  // probing the root and 404ing (favicon.ico / apple-touch-icon.png used to). The
  // files live in /public at these exact paths.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-MX">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Rye&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
