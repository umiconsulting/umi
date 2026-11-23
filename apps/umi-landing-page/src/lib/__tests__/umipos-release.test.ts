import productionRelease from '@/data/umipos-release.json';
import stagingRelease from '@/data/umipos-staging-release.json';
import {
  getDownloadChannel,
  getFallbackRelease,
  getReleaseManifestUrl,
  isDownloadRelease,
} from '@/lib/umipos-release';

describe('umipos-release', () => {
  it('defaults to production channel unless explicitly set to staging', () => {
    expect(getDownloadChannel(undefined)).toBe('production');
    expect(getDownloadChannel('production')).toBe('production');
    expect(getDownloadChannel('staging')).toBe('staging');
    expect(getDownloadChannel('preview')).toBe('production');
  });

  it('selects distinct manifest URLs and fallbacks per channel', () => {
    expect(getReleaseManifestUrl('production')).toBe(
      'https://umi-pos-downloads.pages.dev/latest.json',
    );
    expect(getReleaseManifestUrl('staging')).toBe(
      'https://staging.umi-pos-downloads.pages.dev/latest.json',
    );
    expect(getFallbackRelease('staging').artifactFile).toBe(stagingRelease.artifactFile);
    expect(getFallbackRelease('production').artifactFile).toBe(productionRelease.artifactFile);
  });

  it('accepts valid releases only for the matching channel and API origin', () => {
    expect(isDownloadRelease(productionRelease, 'production')).toBe(true);
    expect(isDownloadRelease(stagingRelease, 'staging')).toBe(true);

    expect(isDownloadRelease(stagingRelease, 'production')).toBe(false);
    expect(isDownloadRelease(productionRelease, 'staging')).toBe(false);
    expect(
      isDownloadRelease(
        { ...stagingRelease, apiOrigin: 'https://api.umiconsulting.co' },
        'staging',
      ),
    ).toBe(false);
  });
});
