# KDS Architecture

The existing SwiftUI iPad app is the pilot KDS client.
The UMI API owns all kitchen state.

## Data path

The data path is:

1. A committed sale creates one kitchen projection.
2. The API applies the route snapshot to each preparation line.
3. The KDS reads one exact station snapshot.
4. The KDS sends a command with a stable command identity.
5. The API validates the state, version, device, station, and permission.
6. The KDS reads the new authoritative snapshot.

The KDS does not change sale, payment, inventory, customer, or receipt facts.

## API endpoints

The KDS uses these UMI API endpoints:

- `POST /api/kds/pairing`
- `POST /api/kds/board`
- `POST /api/kds/command`
- `POST /api/kds/heartbeat`

The board endpoint returns a snapshot or ordered events.
The command endpoint accepts canonical kitchen commands.

## Device scope

The dashboard creates a short pairing PIN.
The API returns one device token after approval.
The app stores the token in Keychain.

Each device binds to one merchant, one location, and one station.
A disabled or reassigned device fails closed.

## Reconnect

The app polls the ordered event feed.
Each event has a sequence and an aggregate version.

The app ignores a duplicate or stale event.
The app fetches a full station snapshot after a gap or reconnect.
The app does not accept a state command while disconnected.

## Recovery

Each command keeps these values across a response loss:

- command ID;
- idempotency key;
- correlation ID;
- expected version.

The app retries the same command identity after an uncertain response.
The API returns the original command result or a typed conflict.

## Privacy

The KDS receives preparation data only.
It does not receive payment data, customer contact, stored-value data, or internal credentials.

## Configuration

Use these `Info.plist` keys:

- `KDSBackendURL`;
- `KDSLocalBaseURL` for local development;
- `KDSPairingURL`, `KDSCommandURL`, `KDSBoardURL`, and `KDSHeartbeatURL` for optional overrides;
- `KDSPollingIntervalSeconds`;
- `KDSHeartbeatIntervalSeconds`.

Production must use the UMI API HTTPS base URL.

## Scope boundary

This app remains the existing pilot KDS.
Gate 4A does not build a replacement Flutter KDS.
Future replacement work must keep the same server authority and canonical contract.
