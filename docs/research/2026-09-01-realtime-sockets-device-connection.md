# Realtime socket options for device presence and connection

- Date: 2026-09-01
- Question: What are the best realtime socket options, as of August 2026, for device presence/connection on the Umi platform?
- Scope: umi-api (NestJS 11 on Fastify 5, ioredis, BullMQ), umi-dashboard (React + Vite), umiPOS (Flutter), later umi-cash and KDS iPads.
- Method: primary sources only — official docs, package registries, and source code. Each claim carries its source. Versions and dates are the values observed on 2026-09-01.

## 1. Summary and recommendation

Start with **Socket.IO v4 through `@nestjs/websockets` + `@nestjs/platform-socket.io` on the existing Fastify adapter**, with **`@socket.io/redis-adapter` on the existing `ioredis`** for multi-instance fan-out.

Reasons:

1. It gives, out of the box, the three mechanisms we would otherwise build by hand: a server heartbeat (`pingInterval`/`pingTimeout`), client auto-reconnection with jittered exponential backoff, and an `auth` payload in the handshake ([socket.io server-options](https://socket.io/docs/v4/server-options/), [client-options](https://socket.io/docs/v4/client-options/)).
2. It attaches to the raw Node `http.Server` that Fastify already runs on, so no Fastify plugin is needed and the Nest gateway model stays available (IoAdapter source, section 3).
3. Redis fan-out is a documented first-class adapter that explicitly recommends `ioredis` — which umi-api already has ([redis-adapter docs](https://socket.io/docs/v4/redis-adapter/)).
4. All three client platforms are covered: `socket.io-client` 4.8.3 for the dashboard, `socket_io_client` (Dart, 3.1.6, updated 2026-06-13) for umiPOS/umi-cash, and a browser/JS client for KDS iPads later.

Main caveat: the Dart client is a community port with an unverified pub.dev publisher and its stable line is 3.x (README maps it to server v3–v4.6; no stable 4.x client exists on pub.dev). It is actively maintained and widely used (233k weekly downloads). See section 6. If that risk is unacceptable, the fallback is raw WebSocket (`@nestjs/platform-ws` + Dart first-party `web_socket_channel`) at the cost of writing heartbeat, reconnection, auth framing, and Redis fan-out ourselves.

Do not adopt a managed service (Ably, Pusher, Supabase Realtime) now: device counts per merchant are small, presence must be derived from device credentials we already issue, and the API is self-hosted NestJS (section 5).

## 2. Option: raw WebSocket on NestJS (`@nestjs/platform-ws`)

- NestJS supports two WS platforms out of the box: socket.io and ws. "There are two WS platforms supported out-of-the-box: socket.io and ws." — [docs.nestjs.com/websockets/gateways](https://docs.nestjs.com/websockets/gateways).
- The ws adapter is enabled with `app.useWebSocketAdapter(new WsAdapter(app))`. The docs say it "is fully compatible with native browser WebSockets and is far faster than socket.io package", and note that `ws` "does not support namespaces"; multiple gateways can be mounted on different `path`s instead — [docs.nestjs.com/websockets/adapter](https://docs.nestjs.com/websockets/adapter).
- Fastify compatibility: the `WsAdapter` source binds through the generic Node `upgrade` event with `noServer: true` servers routed by pathname (`httpServer.on('upgrade', upgradeListener)`; `new wsPackage.Server({ noServer: true, ...wsOptions })`). It works with any `http.Server`, which is what the Fastify adapter exposes — [ws-adapter.ts source](https://github.com/nestjs/nest/blob/master/packages/platform-ws/adapters/ws-adapter.ts).
- Versions observed on npm (2026-09-01): `@nestjs/platform-ws` latest is 12.0.1 (2026-08-27) for the new Nest 12 line; the Nest 11 line is at **11.2.3**, which bundles `ws` 8.18.3 and peers on `@nestjs/common ^11`. umi-api on Nest 11 must install the 11.x line. `ws` itself is at 8.21.3 (2026-08-07) and targets Node ≥ 18.14 — [ws README](https://github.com/websockets/ws/blob/master/README.md).
- Gotcha: everything above the socket (heartbeat, reconnection, message envelope, auth, multi-instance fan-out) is ours to build. The `ws` README documents the required heartbeat pattern: "Ping messages can be used as a means to verify that the remote endpoint is still responsive", with a ~30 s server ping interval and termination of clients that do not pong — [ws README, "How to detect and close broken connections"](https://github.com/websockets/ws#how-to-detect-and-close-broken-connections).
- Watch item: open issue [nestjs/nest#17613](https://github.com/nestjs/nest/issues/17613) (2026-08-29) reports a WebSocket gateway regression on Nest **12.0.1**. It does not affect the 11.x line, but check it before any Nest 12 upgrade.

### `@fastify/websocket` alternative (bypass Nest gateways)

- `@fastify/websocket` **11.3.0** (published 2026-08-06) is "Built upon ws@8"; its `package.json` develops against `fastify ^5.0.0` and it uses `fastify-plugin ^6`, so the current line matches Fastify 5 — [github.com/fastify/fastify-websocket](https://github.com/fastify/fastify-websocket) and its `package.json`.
- Usage: register the plugin, then add `websocket: true` on a route; the handler gets the socket plus the `FastifyRequest`, and Fastify hooks (`onRequest`, `preValidation`, `preHandler`) run before the upgrade — useful for auth — [README](https://github.com/fastify/fastify-websocket).
- Trade-off: this bypasses Nest gateways, DI-based guards/pipes on gateway handlers, and the Nest lifecycle. It is the right tool only if we decide Nest's websockets layer is in the way. It is not needed for the recommended path.

## 3. Option: Socket.IO on NestJS + Fastify

- How it attaches: `IoAdapter.createIOServer` does `return new Server(this.httpServer, options)` when a port of 0 is used — it mounts Socket.IO on the existing Node `http.Server`, independent of Express vs Fastify — [io-adapter.ts source](https://github.com/nestjs/nest/blob/master/packages/platform-socket.io/adapters/io-adapter.ts). The historical breakage on Fastify ([nestjs/nest#9903](https://github.com/nestjs/nest/issues/9903), Nest 9 + Fastify 4, "Cannot GET /ws/?EIO=4&transport=websocket") was **closed as completed on 2022-08-26**.
- Versions (npm, 2026-09-01): `@nestjs/platform-socket.io@11.2.3` (Nest 11 line) bundles **socket.io 4.8.3**. `socket.io` 4.8.3 and `socket.io-client` 4.8.3 were published 2025-12-23. `engine.io` is at 6.6.9 (last registry activity 2026-06-16). The v4 docs are current and dated June 2026 — [socket.io/docs/v4/](https://socket.io/docs/v4/). Socket.IO v4 is in maintenance-grade but active state: patch releases through Dec 2025, docs updated 2026.
- Transports: "HTTP long-polling, WebSocket, WebTransport", with automatic fallback ("The connection will fall back to HTTP long-polling in case the WebSocket connection cannot be established") — [socket.io/docs/v4/](https://socket.io/docs/v4/). WebTransport is **not production-ready on Node**: it needs the third-party `@fails-components/webtransport` HTTP/3 stack and certificates with ≤ 2-week validity; Safari does not support it — [socket.io/get-started/webtransport](https://socket.io/get-started/webtransport). Treat WebSocket as the transport; WebTransport is a curiosity for now.
- Heartbeat: server sends a ping every `pingInterval` (default 25000 ms) and closes the connection if no pong arrives within `pingTimeout` (default 20000 ms) — [server-options](https://socket.io/docs/v4/server-options/). Both are tunable per server.
- Reconnection: client defaults are `reconnection: true`, `reconnectionAttempts: Infinity`, `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, `randomizationFactor: 0.5` — jittered exponential backoff built in (1st attempt 500–1500 ms, 2nd 1000–3000 ms, ...) — [client-options](https://socket.io/docs/v4/client-options/).
- Auth: the client `auth` option carries credentials in the handshake; the server reads `socket.handshake.auth` — [client-options](https://socket.io/docs/v4/client-options/).
- Redis fan-out: `@socket.io/redis-adapter` 8.3.0 (peer `socket.io-adapter ^2.5.4`, compatible with Socket.IO 4.3.1+) publishes broadcasts over Redis Pub/Sub across instances. The docs support `ioredis` explicitly and warn that the `redis` package "seems to have problems restoring the Redis subscriptions after reconnection … You may want to use the ioredis package instead" — [redis-adapter docs](https://socket.io/docs/v4/redis-adapter/). A sharded variant (`createShardedAdapter`) exists for Redis ≥ 7.0. The NestJS docs show the exact `RedisIoAdapter extends IoAdapter` pattern and add the load-balancer caveat: with multiple instances either set `transports: ['websocket']` on clients or enable sticky (cookie-based) routing — [docs.nestjs.com/websockets/adapter](https://docs.nestjs.com/websockets/adapter).
- `fastify-socket.io` (the direct Fastify plugin) is **not viable**: latest 5.1.0 (2024-08-12) pins peer `fastify: 4.x.x` — incompatible with Fastify 5 (npm registry, 2026-09-01). Not needed anyway, since IoAdapter mounts on the raw server.

## 4. Option: SSE (`@Sse()` on Fastify)

- NestJS `@Sse()` returns an `Observable<MessageEvent>` and, per the current docs, "works identically on both the Express and Fastify platforms" (stated for the `@SseSignal()` decorator on the same page); disconnect cleanup is automatic — [docs.nestjs.com/techniques/server-sent-events](https://docs.nestjs.com/techniques/server-sent-events).
- Browser `EventSource` limits (MDN): the constructor takes only a URL and a `withCredentials` flag — **no custom headers**, so a dashboard JWT must travel as a cookie or query parameter. Over HTTP/1.1 the browser caps SSE at **6 connections per browser + domain** ("specially painful when opening various tabs"); over HTTP/2 the stream limit is negotiated (default 100) — [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource).
- Fit: SSE is one-directional. It could serve need (1) alone — dashboard receives presence pushes while devices keep POSTing heartbeats — but it cannot serve need (2) (device waits for pairing approval) without giving devices their own SSE channel too, and it gives no ping/pong to detect dead devices faster than the HTTP cadence. It is a reasonable dashboard-only stopgap, not the platform mechanism.

## 5. Option: managed services (note only)

- **Supabase Realtime**: Broadcast, Presence ("Track and synchronize user state across clients"), Postgres Changes — [supabase.com/docs/guides/realtime](https://supabase.com/docs/guides/realtime). Pricing: Free 200 concurrent / 2M messages per month; Pro $25/mo, 500 concurrent then $10 per 1000, 5M messages then $2.50/M — [supabase.com/pricing](https://supabase.com/pricing). First-party Dart client exists (`realtime_client` 2.13.0, publisher supabase.io — [pub.dev](https://pub.dev/packages/realtime_client)). But it is designed around a Supabase project and its JWTs, alongside — not inside — a self-hosted NestJS API.
- **Ably**: free 200 concurrent / 6M msgs per month; Standard $29/mo + usage ($2.50/M messages, $1.00/M connection-minutes and channel-minutes); presence on all tiers — [ably.com/pricing](https://ably.com/pricing).
- **Pusher Channels**: Sandbox free 100 concurrent / 200k msgs per day; Startup $49/mo, 500 concurrent / 1M msgs per day; presence channels supported — [pusher.com/channels/pricing](https://pusher.com/channels/pricing/).
- Verdict: all three add a per-connection-minute or per-message bill and a second auth domain for a workload (tens of devices per merchant, 5 s heartbeats) that one Redis-backed Socket.IO server handles trivially. Revisit only if Umi later needs global edge fan-out.

## 6. Flutter clients

- **`web_socket_channel` 3.0.3** — first-party (publisher tools.dart.dev, Dart team repo `dart-lang/http`), all platforms including Web, 9.6M downloads. Last published ~May 2025 (16 months before 2026-09-01): stable, slow-moving. It is a `StreamChannel` wrapper; it has **no automatic reconnection** — the app must run its own retry loop — [pub.dev/packages/web_socket_channel](https://pub.dev/packages/web_socket_channel).
- **`socket_io_client` (Dart)** — latest stable **3.1.6, published 2026-06-13** (pub.dev API), publisher unverified, repo [rikulo/socket.io-client-dart](https://github.com/rikulo/socket.io-client-dart), 233k weekly downloads, all platforms including Web. The README compatibility table maps server "v3.x to v4.6.x → client v3._" and lists a "v4.7._ and later → client v4.*" line, but **no stable 4.x client exists on pub.dev** (all recent releases are 3.1.x). In practice the 3.x client speaks the Socket.IO v4 / Engine.IO v4 protocol; the 4.7+ split concerns newer optional features. Parity lags the JS client — accept this or pin server features to the common set — [pub.dev/packages/socket_io_client](https://pub.dev/packages/socket_io_client).
- **SSE in Flutter**: no first-party EventSource for `dart:io`; community packages such as `flutter_client_sse` 2.0.3 (published ~2024, verified publisher hustlecreatives.dev, 51k downloads, supports custom headers) — usable but thinly maintained — [pub.dev/packages/flutter_client_sse](https://pub.dev/packages/flutter_client_sse).
- **Reconnection/backoff**: with `socket_io_client` the Socket.IO reconnection engine (jittered exponential backoff, section 3) comes for free. With `web_socket_channel` we would implement the equivalent by hand (initial delay ~1 s, factor 2, cap ~30 s, full jitter), mirroring the defaults Socket.IO documents — [client-options](https://socket.io/docs/v4/client-options/).

## 7. Design guidance

- **Heartbeat**: replace the 5 s HTTP heartbeat with the protocol-level ping/pong. Socket.IO defaults (25 s ping / 20 s timeout) are too slow for the current UX thresholds (<10 s live, <20 s slow); configure `pingInterval: 5000, pingTimeout: 10000` to keep the existing semantics, or relax the thresholds now that disconnects are events, not timeouts. The `ws` README documents the same pattern for raw WS — [server-options](https://socket.io/docs/v4/server-options/), [ws README](https://github.com/websockets/ws#how-to-detect-and-close-broken-connections).
- **Presence derivation stays server-side**: connection + recent pong ⇒ `live`; connected but missed pings within the tolerance window ⇒ `slow`; `disconnect` event or ping timeout ⇒ `offline`. Persist last-seen transitions (existing devices tables) so presence survives API restarts; on gateway boot, mark all sessions of this instance offline-pending-reconnect.
- **Auth handshake**: browsers cannot set headers on WebSocket (constructor takes only `url` and `protocols` — [MDN WebSocket()](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)). Options are token-in-query (leaks into logs), `Sec-WebSocket-Protocol` smuggling (a hack), cookie (dashboard only), or token in the first message / handshake payload. Socket.IO resolves this cleanly: clients pass credentials in the `auth` handshake option, the server reads `socket.handshake.auth` in a middleware and rejects before any event flows — [client-options](https://socket.io/docs/v4/client-options/). Use the existing device credential (enrollment flow, `apps/umi-api/src/modules/devices`) for umiPOS sockets and the dashboard JWT for dashboard sockets.
- **Reconnection**: keep Socket.IO client defaults (jittered exponential backoff, infinite attempts) — [client-options](https://socket.io/docs/v4/client-options/).
- **Multi-instance fan-out**: `@socket.io/redis-adapter` with two `ioredis` connections (pub + sub duplicate). With more than one API instance behind a load balancer, set `transports: ['websocket']` on clients or enable sticky routing — [redis-adapter docs](https://socket.io/docs/v4/redis-adapter/), [docs.nestjs.com/websockets/adapter](https://docs.nestjs.com/websockets/adapter).

## 8. Recommended sketch (umiPOS + dashboard + umi-api)

Packages (umi-api, Nest 11 line): `@nestjs/websockets@^11.2.3`, `@nestjs/platform-socket.io@^11.2.3` (bundles socket.io 4.8.3), `@socket.io/redis-adapter@^8.3.0` (reuses `ioredis`). Clients: `socket.io-client@4.8.3` (dashboard), `socket_io_client: ^3.1.6` (umiPOS).

1. **Gateway** `DevicesGateway` on namespace `/rt`, `pingInterval: 5000`, `pingTimeout: 10000`. A `RedisIoAdapter extends IoAdapter` (per the NestJS docs recipe) wires the Redis adapter in `main.ts`.
2. **Handshake middleware**: `auth: { kind: 'device', deviceId, deviceToken }` from umiPOS (credential from the existing enrollment flow) or `auth: { kind: 'dashboard', jwt }` from the browser. Reject unauthenticated sockets before events flow. Join rooms: device sockets → `merchant:{id}:devices`; dashboard sockets → `merchant:{id}:dashboard`.
3. **Presence (need 1)**: on connect/disconnect/ping-timeout, update last-seen state and emit `device.presence` `{deviceId, status, at}` to `merchant:{id}:dashboard`. The /devices screen drops the 8 s poll and subscribes; keep the poll as fallback until the socket path is proven.
4. **Pairing approval (need 2)**: umiPOS connects during enrollment with its provisional credential and listens for `device.approved`. The approval endpoint emits to that device's room — via Redis this reaches whichever instance holds the socket. No polling loop on the device.
5. **Order events (need 3)**: later, emit `order.*` into the same rooms; BullMQ workers publish through the same Redis adapter (`io.serverSideEmit` or an emitter bound to the adapter).
6. **Fallback plan**: if the Dart client ever blocks an upgrade, the wire concepts (rooms → paths, auth payload → first message, ping/pong → ws-level) map onto `@nestjs/platform-ws` + `web_socket_channel` without changing the server-side presence model.

## Surprises worth noting

- NestJS 12 shipped in late August 2026 (12.0.1 on npm 2026-08-27); an open issue ([#17613](https://github.com/nestjs/nest/issues/17613)) reports a gateway regression there. Stay on the 11.x websockets packages until it settles.
- `fastify-socket.io` is dead for Fastify 5 (peer pin `fastify: 4.x.x`, last publish 2024-08-12) — but it is unnecessary because Nest's IoAdapter mounts on the raw `http.Server`.
- The Dart Socket.IO client has no stable 4.x line despite its own compatibility table advertising one; latest stable is 3.1.6 (2026-06-13).
