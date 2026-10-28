# Sources

## Local artifacts

| Source | Evidence |
| --- | --- |
| Parrot POS `2.27.5` APK | Static observation. Package `io.parrotsoftware.parrotpos`. SHA-256 `fdc0492cd7ea3107ec6e74bb520d21a0cc602ac015fba2f7aea449f8dc07d1c3`. |
| Parrot Room schema strings | Static observation from DEX. Operational tables and `dbSyncStatus` columns. |
| Parrot `DBSyncStatus` | Static observation. Values `DONE`, `PROCESSING`, `SENDING`, `SYNC_REQUIRED`, `VERIFY_UPDATED_AT`. |
| Parrot `DBSyncObject` | Static observation. Methods `getSyncId`, `getSyncStatus`, `getSyncUpdatedAt`. |
| Parrot `SyncRepositoryImpl` | Static observation. Merges 23 sync flows. A sync state selects a worker. |
| Parrot `UploadWorker` | Static observation. Runs a channel task and maps result to WorkManager success or failure. |
| Parrot `UploadTask` | Static observation. Chunks records and runs chunk uploads concurrently. This is a risk when order matters. |
| Parrot `NetworkService` and `DiscoveryManager` | Static observation. NSD discovery, device sync, device status, and role data. |
| Parrot `TrueTime` classes | Static observation. NTP host pool, timekeeper, cache, event receiver, and verification worker. |
| Parrot manifest | Static observation. Ktor resources, foreground service, sync status activity, diagnostic activity, device overview, Datadog and Firebase components. |
| Flutter POS `3.1.0` APK | Public MIT release. SHA-256 `bc5ebd52e4157b0494333fc71aa5e1ad7839d5cbf552ee1d196e1c6191773d4c`. |
| gPOS Mobile `0.1.0-beta` APK | Public MIT release. SHA-256 `d0d627126ba8b3fc1e8b6a2fd37383c220f50ac17edfe0b3bd3f7996d1900dc3`. |

## Public source examples

- FloCafe, MIT, commit `e6759de80b35690f4a1471f431678d5c0f1166e4`:
  [repository](https://github.com/FreeOpenSourcePOS/FloCafe).
- FloCafe
  [offline-first decision](https://github.com/FreeOpenSourcePOS/FloCafe/blob/main/docs/decisions/0001-offline-first-core.md).
- FloCafe
  [data and migrations](https://github.com/FreeOpenSourcePOS/FloCafe/blob/main/docs/architecture/data-and-migrations.md).
- FloCafe
  [cloud integrations](https://github.com/FreeOpenSourcePOS/FloCafe/blob/main/docs/architecture/cloud-integrations.md).
- FloCafe
  [cloud outbox code](https://github.com/FreeOpenSourcePOS/FloCafe/blob/main/main/services/cloud-sync.ts).
- Flutter POS, MIT, commit `3b61e52815cd5c9150c97cb71ab135896216ee40`:
  [repository](https://github.com/elrizwiraswara/flutter_pos).
- Flutter POS
  [queued-action repository](https://github.com/elrizwiraswara/flutter_pos/blob/main/lib/data/repositories/queued_action_repository_impl.dart).
- gPOS Mobile, MIT:
  [repository](https://github.com/kouzen-neo/gposmobile).
- Odoo POS `20.0`:
  [module README](https://github.com/odoo/odoo/blob/20.0/addons/point_of_sale/README.md).

## Vendor behavior

- Toast,
  [Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html).
- Square,
  [Android offline payments](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments).
- Lightspeed,
  [Offline POS functionality](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality).
- Toast,
  [Offline payments overview](https://doc.toasttab.com/doc/platformguide/platformOfflinePaymentsOverview.html).

## Engineering and research

- M. Kleppmann, A. Wiggins, P. van Hardenberg, and M. McGranaghan,
  [Local-first software](https://www.inkandswitch.com/essay/local-first/),
  2019. Seven ideals include no spinners, multi-device access, optional
  network, collaboration, long-term preservation, privacy, and ownership.
- H. Garcia-Molina and K. Salem,
  [Sagas](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf),
  1987. Long transactions can use compensating transactions instead of one
  atomic transaction.
- Chris Richardson,
  [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html).
  Store the event in the same transaction as the business write. A relay sends
  it later. Consumers must handle duplicate delivery.
- Stripe,
  [Idempotent requests](https://docs.stripe.com/api/idempotent_requests).
  A client-generated key makes retries return the original result.
- Android Developers,
  [WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started).
- Android Developers,
  [Define work requests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work).
  The API provides constraints, retry, and linear or exponential backoff.
- SQLite,
  [Write-ahead logging](https://www.sqlite.org/wal.html). WAL permits concurrent
  readers and one writer, and keeps transaction end marks per reader.

## Evidence limits

- Static APK analysis does not establish runtime behavior.
- The APK signature was not verified.
- Vendor documentation describes supported behavior, not every failure path.
- Public open-source examples are not production certification.
- The clean architecture is a Umi inference. It is not a claim that Parrot uses
  the same design.
