import initialRelease from '@/data/umipos-release.json';
import stagingRelease from '@/data/umipos-staging-release.json';

export type DownloadChannel = 'production' | 'staging';
export type Release = Omit<typeof initialRelease, 'channel'> & {
  channel: DownloadChannel;
};

export function getDownloadChannel(
  value: string | undefined = process.env.NEXT_PUBLIC_UMIPOS_CHANNEL,
): DownloadChannel {
  return value === 'staging' ? 'staging' : 'production';
}

export function getReleaseManifestUrl(channel: DownloadChannel): string {
  return channel === 'staging'
    ? 'https://staging.umi-pos-downloads.pages.dev/latest.json'
    : 'https://umi-pos-downloads.pages.dev/latest.json';
}

export function getFallbackRelease(channel: DownloadChannel): {
  versionCode: number;
  artifactFile: string;
  url: string;
} {
  if (channel === 'staging') {
    return {
      versionCode: stagingRelease.versionCode,
      artifactFile: stagingRelease.artifactFile,
      url: `${stagingRelease.downloadOrigin}/${stagingRelease.objectPrefix}/${stagingRelease.artifactFile}`,
    };
  }
  return {
    versionCode: initialRelease.versionCode,
    artifactFile: initialRelease.artifactFile,
    url: `${initialRelease.downloadOrigin}/${initialRelease.objectPrefix}/${initialRelease.artifactFile}`,
  };
}

// Treat the remotely hosted pointer as data. Do not accept arbitrary download URLs.
export function isDownloadRelease(
  value: unknown,
  expectedChannel: DownloadChannel = 'production',
): value is Release {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const expectedApiOrigin =
    expectedChannel === 'staging'
      ? 'https://api-staging.umiconsulting.co'
      : 'https://api.umiconsulting.co';
  if (r.schemaVersion !== 1 || r.product !== 'UmiPOS' || r.channel !== expectedChannel)
    return false;
  if (r.apiOrigin !== expectedApiOrigin) return false;
  if (
    r.packageName !== 'co.umiconsulting.umi_pos.estacion' ||
    r.architecture !== 'arm64-v8a' ||
    r.minimumSdk !== 24
  )
    return false;
  if (r.signerSha256 !== '14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051')
    return false;
  if (typeof r.versionName !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.versionName)) return false;
  if (
    typeof r.versionCode !== 'number' ||
    !Number.isSafeInteger(r.versionCode) ||
    r.versionCode < 1 ||
    r.versionCode > 2100000000
  )
    return false;
  if (
    typeof r.bytes !== 'number' ||
    !Number.isSafeInteger(r.bytes) ||
    r.bytes < 1 ||
    r.bytes > 25 * 1024 * 1024
  )
    return false;
  if (
    typeof r.releaseDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate) ||
    Number.isNaN(Date.parse(r.releaseDate))
  )
    return false;
  if (
    typeof r.downloadOrigin !== 'string' ||
    !/^https:\/\/(?:[a-z0-9-]+\.)?umi-pos-downloads\.pages\.dev$/.test(r.downloadOrigin)
  )
    return false;
  if (
    r.objectPrefix !== `umipos/android/${r.versionCode}` ||
    r.artifactFile !==
      `UmiPOS-${r.versionName}-${expectedChannel}-release-build${r.versionCode}.apk`
  )
    return false;
  return (
    r.checksumFile === 'SHA256SUMS.txt' &&
    r.metadataFile === 'release.json' &&
    r.instructionsFile === 'LEEME.txt'
  );
}
