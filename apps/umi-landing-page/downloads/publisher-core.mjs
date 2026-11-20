import { validateRelease, validateAcceptance, assertPromotion, tagFor } from './release-policy.mjs';

// Dependencies are explicit so the real promotion order can be tested without cloud mutations.
export async function publishAccepted({
  release,
  acceptance,
  tag,
  commit,
  current,
  prepare,
  deploy,
  verify,
  setPointer,
}) {
  validateRelease(release);
  validateAcceptance(acceptance, release);
  if (tag && tag !== tagFor(release)) throw new Error('Release tag differs from the manifest.');
  if (commit && commit !== release.sourceCommit)
    throw new Error('Release tag points to a different source commit.');
  const previous = await current();
  assertPromotion(release, previous);
  // Even a no-op must authenticate the supplied binary; retries cannot bypass APK admission.
  await prepare();
  if (
    previous.versionCode === release.versionCode &&
    /^https:\/\/[a-f0-9]{8}\.umi-pos-downloads\.pages\.dev$/.test(previous.downloadOrigin)
  ) {
    await verify(previous.downloadOrigin);
    return { unchanged: true, versionOrigin: previous.downloadOrigin };
  }
  const versionOrigin = await deploy(`release-${release.versionCode}`);
  await verify(versionOrigin);
  const published = { ...release, downloadOrigin: versionOrigin };
  await setPointer(published);
  assertPromotion(release, await current());
  const productionOrigin = await deploy('main');
  const actual = validateRelease(await current());
  if (
    actual.sha256 !== release.sha256 ||
    actual.sourceCommit !== release.sourceCommit ||
    actual.versionCode !== release.versionCode ||
    actual.downloadOrigin !== versionOrigin
  )
    throw new Error('Current pointer was not confirmed. Check the deployment before retrying.');
  await verify(actual.downloadOrigin);
  return { unchanged: false, versionOrigin, productionOrigin };
}
