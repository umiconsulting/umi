# Android downloads

The landing route `/descargas` links to a separate Cloudflare Pages project, `umi-pos-downloads`.
The project serves static files only. It has no Functions, Worker script, R2 binding, or database.
The shared manifest is `src/data/umipos-release.json`. APK files and signing keys stay outside Git.

## Current release

The initial artifact is production build 337, distributed on November 4, 2026.
The package is `co.umiconsulting.umi_pos.estacion`, version 1.0.0, with ARM64 Dart code.
It uses the production API and the existing release signer.
This artifact is not the architecture repair candidate. That build and its emulator acceptance remain separate.
Do not publish an unaccepted emulator, debug, or staging artifact.

## Cost and limits

Cloudflare states that Pages static requests are free and unlimited on free and paid plans.
Cloudflare also lists unlimited bandwidth for Pages. This design does not invoke Functions or other metered services.
The incremental Cloudflare charge for these static downloads is $0 under the current published terms.
It does not change the account plan or the cost of existing services.

Pages limits each file to 25 MiB, or 26,214,400 bytes.
This APK is 24,509,576 bytes, or 23.37 MiB. It fits with 1,704,824 bytes of margin.
The preparation command rejects larger files. It does not switch to a billed service.
Pages Free also limits sites to 20,000 files and 500 builds per month.
Keep each release within these limits. Recheck official terms before changing the distribution method.

R2 was evaluated first. Its Standard allowance includes 10 GB-month and limited monthly operations.
R2 charges after those allowances. It was rejected for this task after Juan required free delivery.
The temporary bucket and its four uploaded objects were removed. The existing backup bucket was preserved.
No download Worker was deployed. No paid plan was enabled.

## Publish an accepted release

Use Node 22.12+, pnpm, Android SDK `apksigner`, and the existing authorized Wrangler account.
Run these commands from `apps/umi-landing-page`.

1. Confirm acceptance, API environment, package, version, architecture, source commit, and compatibility with installed clients.
2. Update the shared manifest in a reviewed change. Keep the signer compatible and increase the Android build number.
3. Prepare the exact signed APK:

```sh
APKSIGNER=/path/to/android-sdk/build-tools/36.0.0/apksigner \
  node downloads/prepare-release.mjs /absolute/path/to/release.apk
```

The command checks the Pages size limit, exact bytes, SHA-256, and signer before it prepares any files.
It writes only generated public files to the ignored `downloads/dist` directory.
The output includes the APK, JSON metadata, checksum, short instructions, download headers, and a real 404 page.
It contains no Functions. Keep it that way to preserve static delivery pricing.

4. Deploy the prepared directory with Wrangler 4.164.0:

```sh
cd downloads
pnpm dlx wrangler@4.164.0 pages deploy dist \
  --project-name umi-pos-downloads --branch main --commit-dirty=true
cd ..
```

Run the deploy command from `downloads`. The landing root has an unrelated contact Function.
A deploy from the landing root can include that Function by mistake.

5. Download the deployed APK and verify SHA-256, signature, size, attachment headers, and range responses.
   The observed Pages response ignored a byte range and returned the full, correct APK with HTTP 200.
   Do not promise resumable downloads from this endpoint.

6. Merge the landing PR through the usual review path. The main workflow publishes `/descargas`.

Each Pages deployment has an immutable deployment URL. Retain that URL with the release record.
The project alias points to the current deployment. Previous version paths can disappear when that alias advances.
Use retained deployment URLs for historical downloads. Do not overwrite a release with different bytes.
A previous APK cannot overwrite a higher installed Android version. A functional rollback requires a higher build number.
Preserve the installed app and its local data. Contact support before any uninstall.

## Official sources

Checked on November 17, 2026:

- Static request pricing: https://developers.cloudflare.com/pages/functions/pricing/#static-asset-requests
- Pages bandwidth: https://www.cloudflare.com/products/pages/
- File and build limits: https://developers.cloudflare.com/pages/platform/limits/
- Direct upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- R2 allowances and overages: https://developers.cloudflare.com/r2/pricing/
- Android signing: https://developer.android.com/studio/publish/app-signing
