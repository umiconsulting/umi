import './globals.css';
import { Fraunces, Nunito_Sans, Source_Code_Pro } from 'next/font/google';
import ShaderBackground from '@/components/background/ShaderBackground';

const nunito = Nunito_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito',
  weight: ['400', '500', '600', '700', '800'],
});

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

const sourceCode = Source_Code_Pro({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-code',
  weight: ['400', '500', '600'],
});

export const metadata = {
  title: 'Umi — Sistema operativo para restaurantes conectados',
  description:
    'Umi conecta pedidos por WhatsApp, cocina, lealtad, monedero, tableros y observabilidad en una sola capa operativa para restaurantes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${nunito.variable} ${fraunces.variable} ${sourceCode.variable}`}>
      <body className="font-sans">
        <ShaderBackground />
        {children}
      </body>
    </html>
  );
}
