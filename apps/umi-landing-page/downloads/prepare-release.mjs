import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import release from '../src/data/umipos-release.json' with { type: 'json' };

const apk = process.argv[2];
if (!apk)
  throw new Error('Usage: node downloads/prepare-release.mjs /absolute/path/to/release.apk');
const bytes = await readFile(apk);
if (bytes.length > 25 * 1024 * 1024) {
  throw new Error(
    'The APK exceeds the Pages limit of 25 MiB. Stop. Do not switch to a billed service.',
  );
}
const digest = createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== release.bytes || digest !== release.sha256) {
  throw new Error('APK size or SHA-256 differs from the reviewed manifest. Nothing was prepared.');
}
const verification = spawnSync(
  process.env.APKSIGNER || 'apksigner',
  ['verify', '--print-certs', apk],
  { encoding: 'utf8' },
);
if (
  verification.status !== 0 ||
  !verification.stdout.includes(`certificate SHA-256 digest: ${release.signerSha256}`)
) {
  throw new Error('APK signature verification failed or signer differs. Nothing was prepared.');
}
const root = join(dirname(fileURLToPath(import.meta.url)), 'dist');
await rm(root, { recursive: true, force: true });
const destination = join(root, release.objectPrefix);
await mkdir(destination, { recursive: true });
await cp(apk, join(destination, release.artifactFile));
await writeFile(join(destination, release.metadataFile), `${JSON.stringify(release, null, 2)}\n`);
await writeFile(
  join(destination, release.checksumFile),
  `${release.sha256}  ${release.artifactFile}\n`,
);
await writeFile(
  join(destination, release.instructionsFile),
  [
    `UmiPOS ${release.versionName} — build ${release.versionCode}`,
    `Android ${release.minimumAndroid}+ · ARM64`,
    '1. Descarga el APK.',
    '2. Abre el archivo descargado.',
    '3. Pulsa «Instalar».',
    'Si se pide, permite esta instalación.',
    'Actualiza sin desinstalar UmiPOS.',
    'Ayuda: hola@umiconsulting.co',
    '',
  ].join('\n'),
);
await writeFile(
  join(root, '_headers'),
  [
    `/${release.objectPrefix}/*`,
    '  Cache-Control: public, max-age=31536000, immutable',
    '  X-Content-Type-Options: nosniff',
    `/${release.objectPrefix}/${release.artifactFile}`,
    '  Content-Type: application/vnd.android.package-archive',
    `  Content-Disposition: attachment; filename="${release.artifactFile}"`,
    '/*',
    '  X-Robots-Tag: noindex',
    '',
  ].join('\n'),
);
await writeFile(
  join(root, '404.html'),
  '<!doctype html><html lang="es"><meta charset="utf-8"><title>Archivo no disponible</title><h1>Archivo no disponible</h1><a href="https://www.umiconsulting.co/descargas">Descargas UmiPOS</a></html>',
);
await writeFile(
  join(root, 'index.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UmiPOS para Android</title><h1>UmiPOS para Android</h1><h2>v${release.versionName} · Build ${release.versionCode}</h2><a href="/${release.objectPrefix}/${release.artifactFile}">Descargar APK</a><p><a href="https://www.umiconsulting.co/descargas">Instrucciones</a></p></html>`,
);
console.log(
  `Prepared ${root}: ${bytes.length} bytes; SHA-256 and signer verified. No Functions or R2 bindings.`,
);
