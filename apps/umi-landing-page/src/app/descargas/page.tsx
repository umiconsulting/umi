import type { Metadata } from 'next';
import { ArrowDownToLine, Smartphone, ArrowUpRight } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import release from '@/data/umipos-release.json';
import styles from './downloads.module.css';

export const metadata: Metadata = {
  title: 'Descargar UmiPOS para Android — Umi',
  description: 'Instala UmiPOS en tu tablet o terminal Android.',
  alternates: { canonical: 'https://www.umiconsulting.co/descargas' },
};
const fileUrl = (name: string) => `${release.downloadOrigin}/${release.objectPrefix}/${name}`;
const size = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(
  release.bytes / 1e6,
);
const date = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${release.releaseDate}T12:00:00Z`));

export default function DownloadsPage() {
  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <div className={`site-width ${styles.layout}`}>
          <section className={styles.card} aria-labelledby="download-title">
            <Smartphone className={styles.icon} size={38} aria-hidden="true" />
            <h1 id="download-title">UmiPOS para Android</h1>
            <h2 className={styles.requirements}>Android {release.minimumAndroid}+ · ARM64</h2>
            <h3 className={styles.version}>
              v{release.versionName} · Build {release.versionCode}
            </h3>
            <h3 className={styles.facts}>
              {size} MB · {date}
            </h3>
            <a
              className={styles.download}
              href={fileUrl(release.artifactFile)}
              download={release.artifactFile}
            >
              Descargar APK <ArrowDownToLine size={23} aria-hidden="true" />
            </a>
          </section>

          <section className={styles.install} aria-labelledby="install-title">
            <h2 id="install-title">Instala en tres pasos</h2>
            <ol>
              <li>
                <span aria-hidden="true">1</span>Descarga el APK.
              </li>
              <li>
                <span aria-hidden="true">2</span>Abre el archivo descargado.
              </li>
              <li>
                <span aria-hidden="true">3</span>Pulsa «Instalar».
              </li>
            </ol>
            <div className={styles.notes}>
              <p>Si se pide, permite esta instalación.</p>
              <p>Actualiza sin desinstalar UmiPOS.</p>
            </div>
            <a
              className={styles.support}
              href="mailto:hola@umiconsulting.co?subject=Instalaci%C3%B3n%20de%20UmiPOS"
            >
              Ayuda con la instalación <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <details className={styles.verification}>
              <summary>Datos del archivo</summary>
              <nav aria-label="Archivos técnicos">
                <a href={fileUrl(release.checksumFile)}>Verificar APK</a>
                <a href={fileUrl(release.metadataFile)}>Ficha técnica</a>
                <a href={fileUrl(release.instructionsFile)}>Instrucciones TXT</a>
              </nav>
            </details>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <a href="/privacidad-umipos">Privacidad</a>
        <a href="/terminos-umipos">Términos</a>
      </footer>
    </>
  );
}
