# Android downloads

The landing route `/descargas` links to a separate Cloudflare Pages project, `umi-pos-downloads`.
The project serves static files only. It has no Functions, Worker script, R2 binding, or database.
The live version pointer is `latest.json`; `src/data/umipos-release.json` retains the bootstrap identity. APK files and signing keys stay outside Git.

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

## Automatic publication

After this PR is merged, the release coordinator calls one command on the exact signed APK after independent acceptance:

```sh
# From apps/umi-landing-page, with the existing authenticated gh CLI:
APKSIGNER=/path/to/build-tools/36.0.0/apksigner \
AAPT=/path/to/build-tools/36.0.0/aapt2 \
node downloads/create-release.mjs /absolute/path/release.apk /absolute/path/acceptance.json 2.49.0
```

The contract version comes from the accepted build record. This command reads Android metadata, verifies the pinned signer, generates the public manifest, uploads the exact APK and acceptance summary to a stable GitHub Release, and starts the publisher workflow on `main`. It does not rebuild the APK or sign a different binary. The existing Android builder and emulator acceptance remain responsible for build quality.

The acceptance record is written by the independent verifier and has this shape:

```json
{
  "schemaVersion": 1,
  "verdict": "PASS",
  "apkSha256": "<64-character SHA-256 of the accepted APK>",
  "sourceCommit": "<40-character accepted source commit>",
  "reviewedBy": "umi-verifier",
  "evidenceUrl": "https://<retained evidence or release-review record>",
  "checks": {
    "androidEmulator": "PASS",
    "kdsDelivery": "PASS",
    "paymentRecovery": "PASS"
  }
}
```

A machine-readable PASS is an admission record, not proof that tests executed. The reviewer and retained evidence remain the trust boundary. Do not manufacture this record from a successful compile. Do not publish raw lab logs, access tokens, customer data or signing material. The helper uploads only this acceptance summary, a sanitized manifest and the signed APK.

`.github/workflows/publish-umipos-download.yml` also reacts to stable `umipos-android-BUILD` releases. It ignores drafts, prereleases and unrelated tags. The helper explicitly dispatches the default-branch workflow as well, so a source tag predating the workflow, or a release created with `GITHUB_TOKEN`, can still be published. Identical duplicate events are no-ops. A failed dispatch leaves the release intact; retry the existing tag with the workflow's `release_tag` input.

The publisher:

1. Downloads the stable release assets and resolves its tag to a source commit.
2. Checks acceptance identity, actual APK version/application ID, release signature, exact size/hash and the 25 MiB cap.
3. Rejects downgrade attempts and replacement of an existing build number with different bytes/source.
4. Uploads static assets to a preview deployment and downloads the full APK to verify its hash.
5. Publishes `latest.json` on the production alias with the verified immutable deployment URL. It then verifies the public pointer and APK again.

Only the production alias promotion changes the current release. Failure before promotion leaves it unchanged. A post-promotion verification failure reports an unconfirmed publication for investigation; it does not pretend the old pointer is still current. Workflow jobs are serialized, and the current version is rechecked before promotion. Manual publishers must not run concurrently with this workflow.

The landing page fetches `https://umi-pos-downloads.pages.dev/latest.json` when opened, with no-store caching and an allowlisted download origin. It no longer needs a code change, landing build or PR for each version. Until metadata loads it disables downloading; a failure shows one short instruction and a Retry button rather than an old APK. Android still asks the operator to install an update. This is distribution automation, not silent device installation.

The bootstrap manifest in `src/data/umipos-release.json` records build 337; it is no longer the live page's version selector. The initial `latest.json` is bootstrapped from that already-distributed APK, without inventing a new acceptance result for the architecture candidate. Future promotions require the independent acceptance contract above.

### Hosting and workflow boundaries

Use only the existing Pages project, Cloudflare account and `CLOUDFLARE_API_TOKEN` repository secret. No new secret, subscription, Function, Worker or R2 bucket is created. The publisher runs from `downloads`, because the landing root has an unrelated contact Function. Standard `ubuntu-latest` GitHub runners are free for this currently public repository. Do not switch to larger runners or make the repository private while assuming the same pricing.

No workflow artifact storage is used by this pipeline. The publisher uses GitHub Release assets and two static Pages deployments for a new release. An identical published identity does not deploy again. Existing account charges are outside this pipeline. The workflow becomes operational only after merge; local/bootstrap verification is not an executed GitHub production run.

Retain immutable deployment URLs and GitHub Release assets. Do not delete historical deployments still referenced by clients. The observed Pages server ignored a byte range and returned the full correct APK with HTTP 200; resumable downloads are not promised. A previous APK cannot overwrite a higher installed Android version. A functional rollback requires a higher build number; never tell a client to uninstall and lose local data.

### Bootstrap / recovery preparation

With Node 22.12+, pnpm, the Android SDK and existing authorized Wrangler account:

```sh
APKSIGNER=/path/to/apksigner AAPT=/path/to/aapt2 \
node downloads/prepare-release.mjs /absolute/path/release.apk /absolute/path/release.json
cd downloads
pnpm dlx wrangler@4.164.0 pages deploy dist --project-name umi-pos-downloads --branch main --commit-dirty=true
```

Direct preparation verifies the signed binary but does not substitute for independent release acceptance. It is for controlled bootstrap/recovery. For normal publication use the automatic path above, with no concurrent manual deploy.

## Official sources

Checked on November 17, 2026:

- Static request pricing: https://developers.cloudflare.com/pages/functions/pricing/#static-asset-requests
- Pages bandwidth: https://www.cloudflare.com/products/pages/
- File and build limits: https://developers.cloudflare.com/pages/platform/limits/
- Direct upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- R2 allowances and overages: https://developers.cloudflare.com/r2/pricing/
- Android signing: https://developer.android.com/studio/publish/app-signing

- GitHub public-runner pricing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Release events: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release
- Events created with GITHUB_TOKEN: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
