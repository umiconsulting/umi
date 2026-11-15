# Staging Wallet updates: delivery and evidence

Date: 2026-11-05. Scope: official protocol research. No push, deployment, or application change occurred during this research.

## Tools and evidence

- **Local evidence:** Cloudflare Wrangler `4.157.0` is installed under `apps/umi-cash/node_modules/wrangler`. Its license is `MIT OR Apache-2.0`.
- **Local evidence:** `wrangler tail --help` supports `--env`, `--format json`, `--version-id`, and request filters. It offers no historical-time argument.
- **Documented fact:** Wrangler is Cloudflare's supported tool for live Worker logs. Adoption needs no package installation here. [Cloudflare commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#tail)
- **Method:** The research used vendor documentation, then Apple engineer responses. Apple HTML returned a JavaScript shell. Its `.md` and documentation JSON routes returned HTTP 200. JSON supplied endpoint details absent from Markdown. The web reader rejected Markdown content types; Python `3.14.7` retrieved those official routes. Cloudflare's attempted `workers-logs/index.md` returned 403; its normal documentation page worked.
- **Limit:** This research inspected package metadata and command help. It did not open a live tail or inspect credentials.

## APNs authentication, topic, and payload

**Documented fact:** Apple's Wallet instructions require the original pass signing certificate and private key, the registered push token, and payload `{}`. Wallet update pushes work only through APNs production. Umi staging therefore still needs `api.push.apple.com`, with staging-owned pass identities and registrations. [Wallet update service](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)

**Documented fact:** An Apple DTS engineer repeated these requirements in response to a developer who used `.p8` authentication and received APNs 200. [Apple DTS response, August 2025](https://developer.apple.com/forums/thread/775951)

**Source-backed inference:** The expected `apns-topic` is the pass's `passTypeIdentifier`, such as `pass.com.example.staging`. Wallet identifies update requests through that identifier. APNs requires a provisioned topic; token authentication needs an explicit topic. The Team ID belongs in JWT `iss`. It is not a prefix for the pass topic. [Wallet protocol](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes), [APNs topic rules](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CommunicatingwithAPNs.html)

**UNVERIFIED:** The reviewed official sources do not explicitly establish that `.p8` token authentication delivers Wallet updates. They also do not explicitly state that every such request fails. General APNs documentation supports ES256 JWT authentication. An Apple engineer answered another Wallet/JWT report with request-format advice, without a JWT prohibition. Preserve this distinction when assessing the current sender. [APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns), [Apple engineer response](https://developer.apple.com/forums/thread/792314)

**Documented fact:** General `background` pushes use priority `5`. Wallet's dedicated instructions specify `{}`, with no `aps.alert`, `content-available`, serial number, or message text. **Inference:** Do not replace the Wallet payload with an app notification payload. The reviewed Wallet instructions do not prescribe an `apns-push-type` value. [APNs request reference](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [Wallet instructions](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)

## Certificate fallback

**Documented fact:** Certificate authentication presents the certificate and matching private key during TLS connection setup. Individual requests need no bearer token. Apple's command-line example uses HTTP/2, separate certificate and private-key files, and `/3/device/{token}`. [Certificate authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-certificate-based-connection-to-apns), [Apple command-line procedure](https://developer.apple.com/documentation/usernotifications/sending-push-notifications-using-command-line-tools)

**Implementation inference; not executed:** For the existing Node HTTP/2 sender, the certificate fallback has this connection shape:

```js
http2.connect('https://api.push.apple.com', {
  cert: passCertificateChainPem,
  key: matchingPassPrivateKeyPem,
  // passphrase: secretValue, // only for an encrypted private key
});
```

Use `POST /3/device/{registeredPushToken}`, `apns-topic: {passTypeIdentifier}`, and body `{}`. Omit JWT authorization for this mode. Keep normal server certificate verification enabled. Node's `cert` value contains the leaf certificate followed by required intermediates. The root belongs in the trust configuration. Use the original pass certificate, as the Wallet instructions require. [Node HTTP/2 options](https://nodejs.org/docs/latest-v24.x/api/http2.html#http2connectauthority-options-listener), [Node TLS options](https://nodejs.org/docs/latest-v24.x/api/tls.html#tlscreatesecurecontextoptions), [Wallet certificate requirement](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)

## Expected phone sequence

All paths below are relative to the pass's `webServiceURL`.

| Stage    | Documented request or result                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register | `POST /v1/devices/{device}/registrations/{passType}/{serial}` with `Authorization: ApplePass {authenticationToken}` and a push token. Return 201 for new registration; 200 for existing registration. [Registration](https://developer.apple.com/documentation/walletpasses/register-a-pass-for-update-notifications)                                                                                                                             |
| Update   | Persist changed pass information and advance its update tag before the push. Select registered devices for that pass. [Update sequence](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html)                                                                                                                                                                                             |
| Poll     | Phone requests `GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince={tag}`. Return 200 with `serialNumbers` and `lastUpdated`, or 204 for no changes. The device identifier authenticates this request. [Poll endpoint](https://developer.apple.com/documentation/walletpasses/get-the-list-of-updatable-passes), [Authentication](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) |
| Download | Phone requests `GET /v1/passes/{passType}/{serial}` with `Authorization: ApplePass {authenticationToken}`. Return signed pass bytes and `application/vnd.apple.pkpass` with 200. [Download endpoint](https://developer.apple.com/documentation/walletpasses/send-an-updated-pass)                                                                                                                                                                 |

**Documented fact:** Keep the pass type identifier, serial number, and authentication token stable during an update. The archived guide specifies `Last-Modified`, conditional `If-Modified-Since`, and 304 for unchanged content. Pushes can coalesce or fail delivery. [Wallet update guide](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html)

**Umi-specific inference:** Registration and an earlier download with 200 prove only those exchanges. Verify the push response, subsequent poll, subsequent download, and changed phone content separately. APNs acceptance alone does not establish a completed refresh.

## Refresh versus visible notification

**Documented fact:** A field's `changeMessage` supplies visible update text. Its format must contain `%@`, which the new field value replaces. It does not apply to watchOS. [Field reference](https://developer.apple.com/documentation/walletpasses/passfieldcontent) ([complete official JSON](https://developer.apple.com/tutorials/data/documentation/walletpasses/passfieldcontent.json))

**Umi-specific inference:** Test refresh with a changed field value first. Test a visible message separately with a stable field key and a suitable `changeMessage`. An unchanged field value does not prove the visible-message path.

**Documented fact:** Apple reserves change messages for time-critical information. Location/time relevance can separately suggest a pass on the Lock Screen. [Wallet design guidance](https://developer.apple.com/design/human-interface-guidelines/wallet), [Lock Screen relevance](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen)

## Staging isolation and logs

**Umi-specific inference:** Keep isolated mode as the default. Permit a push only after the backend confirms the synthetic merchant, synthetic pass identity, and newly registered test device. Apply that restriction to target selection and retry paths. Copied live registrations must remain excluded. This is an application boundary; APNs production has no knowledge of Umi's staging merchant.

**Documented fact:** `wrangler tail` streams new Worker events. It does not store history. High traffic can cause sampling and dropped messages. Use Workers Logs for stored events that were collected under its configuration. A new tail cannot reconstruct an earlier test. [Real-time limits](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

**Umi-specific inference:** Start a scoped staging tail before the synthetic action. Correlate its timestamps with Nest API logs. A Worker proxy log does not establish the downstream APNs result or device behavior. Preserve only redacted evidence; paths and headers can expose device identifiers or authentication data.

**UNVERIFIED:** This research does not establish current APNs acceptance, phone refresh, visible notification, or historical-log availability for this deployment.

## GHCR authentication for the staging deployment

**Documented fact:** GitHub supports `GITHUB_TOKEN` for package upload and download from an authorized workflow repository. Package Write permission includes download. Verify the package's repository access when permissions are separate. [Package permissions](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [Workflow authentication](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions)

**Documented fact:** A reusable workflow automatically receives `github.token` and `secrets.GITHUB_TOKEN`. It can reduce the caller's permissions, but cannot increase them. The token expires when its job ends or reaches its maximum lifetime. [Reusable workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), [Token lifetime](https://docs.github.com/en/actions/concepts/security/github_token)

**Documented fact:** GitHub's GHCR workflow example uses `github.actor` as the username and `secrets.GITHUB_TOKEN` as the password. Docker supports `login ghcr.io --username USER --password-stdin`. Docker stores credentials in its configured helper or configuration file. [GitHub example](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions), [Docker login](https://docs.docker.com/reference/cli/docker/login/)

**Documented fact:** `DOCKER_CONFIG` selects a separate configuration directory. `docker --config DIR` overrides that variable for the command. [Docker configuration](https://docs.docker.com/reference/cli/docker/#change-the-docker-directory)

**Umi-specific inference:** Pass the current deployment job's token to the staging SSH session through standard input. Use `docker login --password-stdin` remotely. Use one private temporary configuration directory for login and every pull or Compose command. Install cleanup in that remote shell before login. Remove the directory when the deployment ends. Keep the token out of command arguments, traces, and deployment artifacts. Supply the remote script independently, so it does not consume the token's standard input.

**Source-backed tradeoff:** Docker can automatically select `pass` or `secretservice` on Linux. A temporary configuration directory alone does not establish file-only credential storage. Verify the storage method. If a helper receives the token, perform logout with the same configuration before cleanup. Such a helper can share the host's registry entry. [Docker credential storage](https://docs.docker.com/reference/cli/docker/login/#default-behavior)

**Local evidence:** The research host has Docker CLI `29.8.2` and OpenSSH `10.5p1`. Remote versions and helper configuration remain **UNVERIFIED**. No registry login or remote command occurred during this research. A successful runner login does not establish credentials for a separate VPS Docker client.
