# Manual end-to-end device test

Date: 2026-10-18

## Result

The current interaction model works across the iMin, A11 and A9 with staging
data.

The device run found two recovery defects:

1. Old local state stopped the A11 bootstrap after the build 170 install.
2. The LAN KDS peer kept stale station state. A cloud-only build recovered the
   KDS after I reset the local copy.

The secure device identity and operator session survived both local resets.

## Device state

| Device | Role | Build | Address |
| --- | --- | --- | --- |
| iMin D3 | Main station and fixed POS | 172 | `192.168.0.10:37913` |
| Galaxy Tab A11 | Portable POS peer | 172 | `192.168.0.101:41693` |
| Galaxy Tab A9 | KDS test device | 171 cloud KDS | `192.168.0.102:39115` |

Operator PIN: `0493`.

A11 lock-screen PIN: `0493`.

## Verified flows

### Account and table state on the A11

1. Open Accounts on the A11.
2. The map showed `Mesa 1 · Ocupada · Cuenta 012 · 21 min`.
3. Open Mesa 1.
4. Tap `Marcar servido`.
5. The map showed `Mesa 1 · Servido · Cuenta 012`.

Evidence:

- [A11 account map](evidence/2026-10-18-account-first-interaction/07-a11-account-map.png)
- [A11 served table](evidence/2026-10-18-account-first-interaction/08-a11-table-served.png)

### Kitchen receive and finish on the A9

1. Open KDS on the A9.
2. The board showed 10 open tickets.
3. Open Cuenta 002 on Mesa 4.
4. Tap the Aeropress item.
5. The item showed `Listo`.
6. Tap `Terminar`.
7. The board count fell from 10 to 9.
8. Cuenta 002 left the open board.

Evidence:

- [A9 item ready](evidence/2026-10-18-account-first-interaction/09-kds-item-ready.png)
- [A9 ticket complete](evidence/2026-10-18-account-first-interaction/10-kds-ticket-complete.png)

### Split payment on the iMin

1. Open a table account with one item.
2. Tap `Dividir cuenta`.
3. The partial ledger opened directly.
4. The ledger showed order total, paid, this portion, tip, charge now and
   remaining.
5. A two-way split changed the current portion to `MXN 25.00`.
6. The first payment left `MXN 25.00` open.
7. The second payment closed the account.

Evidence:

- [Split action on the account](evidence/2026-10-18-account-first-interaction/05-split-check-action.png)
- [Split-payment ledger](evidence/2026-10-18-account-first-interaction/06-split-ledger.png)
- [Two-way split](evidence/2026-10-18-account-first-interaction/07-split-2-ways.png)
- [First payment recorded](evidence/2026-10-18-account-first-interaction/08-partial-payment-recorded.png)
- [Account closed](evidence/2026-10-18-account-first-interaction/09-full-payment-complete.png)

## Misalignments

### The A11 needed a local-copy reset after the upgrade

The A11 stayed on `No pudimos terminar la preparación` after build 170 replaced
build 161. The secure session was valid.

I moved aside the local working copy and shared preferences. The app then opened
on the operator PIN screen, accepted `0493`, and reached the Order screen.

**Inference:** the upgrade path needs a local-copy compatibility check. A
working copy that cannot migrate should move aside and rebuild from the cloud.
The secure device identity must stay intact.

### The LAN KDS peer had stale station state

The A9 could read the board. Every KDS write returned `Este dispositivo ya no
está registrado para la cocina`.

The same build 170 also failed after I created the station association in
staging. A build 171 with no LAN-hub URL reached the cloud command route and
completed the item and ticket.

**Inference:** the LAN KDS path must refresh or re-register its peer identity
when the station association changes. The fallback must reach the cloud route
without a new build.

### One operator cannot hold two active POS sessions

The iMin, A11 and A9 share one Admin user. The second device is refused while
the first session is active.

This is correct for financial authority. It is not a good shared-device test
setup. Site deployment needs a separate cook or KDS identity.

## Recovery data

Local copies are retained on the devices:

- A11: `files/bootstrap-backup-20261018/`
- A9: `files/bootstrap-backup-20261018/`

Each backup contains `umipos-working-copy.sqlite` and
`FlutterSharedPreferences.xml`.

No secure credential or device key was removed.

## Remaining test gap

- Prove a LAN KDS write with no WAN on build 171.
- Prove the local-copy migration without manual file removal.
- Run the fresh account to payment path with three distinct operator identities.

## Replay recovery after the device run

The iMin kept two local sales after the operator signed out. Recovery showed
`0%`, and the server returned `offline replay operator authority invalid`.

The API now separates original attribution from the live replay authority. See
[the replay authority report](2026-10-18-offline-replay-authority.md).

After the staging API update, the same queue reached:

```text
Server: 3 · accepted: 3 · conflicts: 0 · queue: 0
```

The iMin returned to `Online` with no unsynced badge.

## Artifacts

| Artifact | SHA-256 |
| --- | --- |
| `app-staging-lan-host-b172.apk` | `391256b5f0c076dda9ee58f986f387b9cc03e576b8b8990e8bdff067ba3b47e0` |
| `app-staging-lan-peer-192.168.0.10-b172.apk` | `dbd54ff23abcc45a729dd29abbc5133f4292844f40cebfa6bfc2d4e9936fff66` |
| `app-staging-kds-cloud-b171.apk` | `f79ba2f3a2272052f8a1c8fa57786efb47bc9c2035eb6ff1564321a1fcf1b4af` |

