'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, Smartphone, ArrowUpRight } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import { isDownloadRelease, type Release } from '@/lib/umipos-release';
import styles from './downloads.module.css';

export default function DownloadContent() {
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setFailed(false);
    fetch('https://umi-pos-downloads.pages.dev/latest.json', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Release unavailable');
        const value: unknown = await response.json();
        if (!isDownloadRelease(value)) throw new Error('Invalid release');
        setRelease(value);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => window.clearTimeout(timeout));
    let disposed = false;
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);
  const fileUrl = (name: string) =>
    release ? `${release.downloadOrigin}/${release.objectPrefix}/${name}` : '#';
  const size = release
    ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(release.bytes / 1e6)
    : '';
  const date = release
    ? new Intl.DateTimeFormat('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${release.releaseDate}T12:00:00Z`))
    : '';
  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <div className={`site-width ${styles.layout}`}>
          <section className={styles.card} aria-labelledby="download-title">
            <Smartphone className={styles.icon} size={38} aria-hidden="true" />
            <h1 id="download-title">UmiPOS para Android</h1>
            <h2 className={styles.requirements}>Android 7.0+ · ARM64</h2>
            <noscript>
              <style>{'#download-state { display: none; }'}</style>
              <h3 className={styles.version}>Versión de respaldo · Build 337</h3>
              <a
                className={styles.download}
                href="https://dea44d87.umi-pos-downloads.pages.dev/umipos/android/337/UmiPOS-1.0.0-production-release-build337.apk"
                download="UmiPOS-1.0.0-production-release-build337.apk"
              >
                Descargar APK
              </a>
            </noscript>
            <div id="download-state" aria-live="polite" aria-busy={!release && !failed}>
              {release ? (
                <>
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
                </>
              ) : failed ? (
                <>
                  <p className={styles.version}>No se pudo cargar la descarga.</p>
                  <button
                    className={styles.download}
                    type="button"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    Reintentar
                  </button>
                </>
              ) : (
                <>
                  <h3 className={styles.version}>Buscando la versión vigente…</h3>
                  <button className={styles.download} type="button" disabled>
                    Preparando descarga…
                  </button>
                </>
              )}
            </div>
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
            {release && (
              <details className={styles.verification}>
                <summary>Datos del archivo</summary>
                <nav aria-label="Archivos técnicos">
                  <a href={fileUrl(release.checksumFile)}>Verificar APK</a>
                  <a href={fileUrl(release.metadataFile)}>Ficha técnica</a>
                  <a href={fileUrl(release.instructionsFile)}>Instrucciones TXT</a>
                </nav>
              </details>
            )}
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
