import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/cart/cart_command_queue.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_optimism.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/kitchen/lan_kds_store.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_checkout_service.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/offline_policy.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';
import 'package:umi_pos/features/offline/sqlite_journal_store.dart';
import 'package:umi_pos/features/tables/local_first_table_state_repository.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

import '../support/fakes.dart';

/// Tier 3 Real End-to-End Offline-First Smoke Test:
///
///   Real Dart POS client (BoundedApiClient, SqliteJournalStore,
///   SqliteLocalDatabase, CartController, OfflineCheckoutService,
///   LocalFirstTableStateRepository, LanKdsStore, OfflineRecoveryController)
///     -> Controllable loopback HTTP reverse proxy (cuts WAN, simulates 2.49,
///        counts every 401 and replay request on the wire)
///     -> Real NestJS `umi-api` process
///     -> Real PostgreSQL 17 + Redis 7
///
/// Skipped automatically during plain `flutter test` when `UMI_E2E_API_URL` is
/// unset; executed by `scripts/ci-pos-api-offline-smoke.sh` locally and in CI.
final class _ControllableProxy {
  _ControllableProxy._(this._server, this._upstream);

  final HttpServer _server;
  final Uri _upstream;
  final HttpClient _client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10);

  bool online = true;
  bool stripApiMajorVersion = false;
  final List<({String method, String path, int status})> log = [];

  Uri get baseUri => Uri.parse('http://127.0.0.1:${_server.port}');

  static Future<_ControllableProxy> start(Uri upstream) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final proxy = _ControllableProxy._(server, upstream);
    server.listen(proxy._handle);
    return proxy;
  }

  Future<void> _handle(HttpRequest req) async {
    if (!online) {
      log.add((method: req.method, path: req.uri.path, status: 503));
      req.response
        ..statusCode = HttpStatus.serviceUnavailable
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'code': 'WAN_DOWN_SIMULATED'}));
      await req.response.close();
      return;
    }

    final target = _upstream.replace(
      path: req.uri.path,
      query: req.uri.hasQuery ? req.uri.query : null,
    );
    final upstreamReq = await _client.openUrl(req.method, target);
    req.headers.forEach((name, values) {
      if (name.toLowerCase() == 'host') return;
      for (final value in values) {
        upstreamReq.headers.add(name, value);
      }
    });
    final bodyBytes = await req.fold<List<int>>(
      <int>[],
      (acc, chunk) => acc..addAll(chunk),
    );
    if (bodyBytes.isNotEmpty) {
      upstreamReq.add(bodyBytes);
    }
    final upstreamRes = await upstreamReq.close();
    final resBytes = await upstreamRes.fold<List<int>>(
      <int>[],
      (acc, chunk) => acc..addAll(chunk),
    );

    List<int> finalBytes = resBytes;
    if (stripApiMajorVersion &&
        req.uri.path == '/health/release' &&
        upstreamRes.statusCode == 200) {
      final decoded = jsonDecode(utf8.decode(resBytes)) as Map<String, Object?>;
      decoded.remove('apiMajorVersion');
      finalBytes = utf8.encode(jsonEncode(decoded));
    }

    log.add((
      method: req.method,
      path: req.uri.path,
      status: upstreamRes.statusCode,
    ));

    req.response.statusCode = upstreamRes.statusCode;
    upstreamRes.headers.forEach((name, values) {
      final lower = name.toLowerCase();
      if (lower == 'transfer-encoding' || lower == 'content-length') return;
      for (final value in values) {
        req.response.headers.add(name, value);
      }
    });
    req.response.headers.contentLength = finalBytes.length;
    req.response.add(finalBytes);
    await req.response.close();
  }

  Future<void> close() async {
    _client.close(force: true);
    await _server.close(force: true);
  }
}

final class _MutableCipherStore implements JournalCipherStore {
  String? _key;
  String? _ciphertext;

  @override
  Future<String?> readKey() async => _key;

  @override
  Future<void> writeKey(String value) async => _key = value;

  @override
  Future<String?> readCiphertext() async => _ciphertext;

  @override
  Future<void> writeCiphertext(String value) async => _ciphertext = value;
}

String _uuidV4(int seed) {
  final hex = seed.toRadixString(16).padLeft(12, '0');
  return '00000000-0000-4000-8000-$hex';
}

void main() {
  final apiUrl = Platform.environment['UMI_E2E_API_URL'];
  final fixtureRaw = Platform.environment['UMI_E2E_FIXTURE_JSON'];
  final skipReason = (apiUrl == null || apiUrl.isEmpty || fixtureRaw == null)
      ? 'Set UMI_E2E_API_URL and UMI_E2E_FIXTURE_JSON (via scripts/ci-pos-api-offline-smoke.sh) to run Tier 3 real-API E2E'
      : null;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  test(
    'Tier 3 real-API offline-first E2E: boot compat, offline cycle, SQLite reopen, 0-401 lock, idempotent replay, cancelled-cart conflict',
    () async {
      final fixture = jsonDecode(fixtureRaw!) as Map<String, Object?>;
      final merchantId = fixture['merchantId']! as String;
      final locationId = fixture['locationId']! as String;
      final deviceId = fixture['deviceId']! as String;
      final devicePublicId = fixture['devicePublicId']! as String;
      final installationId = fixture['installationId']! as String;
      final deviceCredential = fixture['deviceCredential']! as String;
      final pin = fixture['pin']! as String;
      final registerId = fixture['registerId']! as String;
      final productId = fixture['productId']! as String;
      final unitPrice = (fixture['unitPriceMinorUnits']! as num).toInt();
      final tableId = fixture['tableId']! as String;
      final cancelledCartId = fixture['cancelledCartId']! as String;
      final businessDate = fixture['businessDate']! as String;

      final proxy = await _ControllableProxy.start(Uri.parse(apiUrl!));
      addTearDown(proxy.close);

      final tempDir = await Directory.systemTemp.createTemp('umi_pos_e2e_');
      addTearDown(() => tempDir.delete(recursive: true));

      final localDb = SqliteLocalDatabase(
        factory: databaseFactoryFfi,
        path: '${tempDir.path}/local.sqlite',
      );
      addTearDown(localDb.close);

      final journalPath = '${tempDir.path}/journal.sqlite';
      final cipherStore = _MutableCipherStore();
      var sqliteJournalStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: journalPath,
      );
      var journal = EncryptedOfflineJournal(
        cipherStore,
        web: false,
        sqliteStore: sqliteJournalStore,
      );

      final secureStorage = MemorySecureStorage();
      secureStorage.values['device.installation_id'] = installationId;
      final vault = CredentialVault(secureStorage);
      await vault.saveDevice(
        id: deviceId,
        publicId: devicePublicId,
        credential: deviceCredential,
        credentialVersion: 1,
        state: 'active',
        merchantId: merchantId,
        locationId: locationId,
      );

      final config = AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: proxy.baseUri,
        telemetryEnabled: true,
        developmentDiagnostics: false,
        featureBootstrapMode: FeatureBootstrapMode.disabled,
        hardwareSimulatorEnabled: true,
        localFirstFastPathEnabled: true,
        realtimeEnrollmentEnabled: false,
        release: ReleaseIdentity(
          application: 'umi-pos',
          version: '0.1.0-e2e',
          gitCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          buildTimestamp: '2026-11-21T12:00:00.000Z',
          contractVersion: contractVersion,
          configurationSchemaVersion: '1',
        ),
      );

      final telemetryExporter = BufferedTelemetryExporter(
        deviceIdProvider: () => deviceId,
        buildVersionProvider: () => config.release.version,
      );
      final telemetry = SafeTelemetry(
        enabled: true,
        context: TelemetryContext.current(config),
        exporter: telemetryExporter,
      );

      final apiClient = BoundedApiClient(
        config: config,
        telemetry: telemetry,
        tokenProvider: vault,
        deviceCredentialProvider: vault,
      );

      // ── 1. Boot compatibility against BOTH simulated 2.49.0 and live API ──
      final releaseGateway = ApiReleaseCompatibilityGateway(
        api: apiClient,
        config: config,
      );
      proxy.stripApiMajorVersion = true;
      expect(
        await releaseGateway.check(),
        ReleaseCompatibility.compatible,
        reason:
            'POS 2.58+ must boot against deployed API 2.49.0 without apiMajorVersion',
      );
      proxy.stripApiMajorVersion = false;
      expect(
        await releaseGateway.check(),
        ReleaseCompatibility.compatible,
        reason: 'POS must boot against live API with apiMajorVersion',
      );

      // ── 2. Real online PIN login, operator session, cash shift, & policy ──
      final entryGateway = ApiEntryGateway(apiClient, vault);
      final login1 = await entryGateway.pinLogin(
        pin: pin,
        merchantId: merchantId,
        locationId: locationId,
      );
      await vault.saveTokens(
        login1.tokens['accessToken']! as String,
        login1.tokens['refreshToken']! as String,
      );
      final operator1 = await entryGateway.startOperator(
        merchantId,
        locationId,
      );

      // Open a real cash shift on the register so offline cash checkout has a live shift.
      final cashRepo = ApiCashRepository(apiClient);
      final shiftOpen = await cashRepo.open(
        merchantId,
        OpenCashShiftRequest(
          commandId: _uuidV4(101),
          locationId: locationId,
          operatorSessionId: operator1.id,
          registerId: registerId,
          openingFloat: const {'minorUnits': 100000, 'currency': 'MXN'},
          denominations: const [],
          businessDate: businessDate,
          note: 'E2E opening float',
          expectedRegisterVersion: 1,
          idempotencyKey: _uuidV4(102),
        ),
      );
      final cashShiftId = shiftOpen.shift['id']! as String;

      // Cache real offline policy & initial table state while online.
      final replayGateway = ApiReplayGateway(apiClient);
      final livePolicy = await replayGateway.policy(
        ReplayScope(
          merchantId: merchantId,
          locationId: locationId,
          operatorSessionId: operator1.id,
          deviceId: deviceId,
          credentialVersion: 1,
        ),
      );
      final policyCache = OfflinePolicyCache(journal, web: false);
      await policyCache.save(livePolicy, DateTime.now().toUtc());

      final connectivity = ConnectivityController();
      addTearDown(connectivity.dispose);
      connectivity.apiReachable(authorityValid: true);

      final lanStore = LanKdsStore(localDb, journal: journal);
      final tableRepo = LocalFirstTableStateRepository(
        cloud: ApiTableStateRepository(apiClient),
        local: localDb,
        journal: journal,
        identity: () =>
            TableDeviceIdentity(deviceId: deviceId, credentialVersion: 1),
        replay: (_) async {},
      );
      final onlineTables = await tableRepo.read(
        merchantId,
        PosTableStateQuery(
          locationId: locationId,
          operatorSessionId: operator1.id,
        ),
      );
      expect(onlineTables.states, isNotNull);

      // ── 3. Cut WAN (real proxy down) -> Offline service cycle + SQLite reopen ──
      proxy.online = false;
      connectivity.networkDown();

      // Seat Mesa 1 offline (journaled `pos.table.command`).
      final seated = await tableRepo.seat(
        merchantId,
        SeatTableRequest(
          locationId: locationId,
          operatorSessionId: operator1.id,
          tableId: tableId,
          partySize: 2,
          idempotencyKey: _uuidV4(201),
        ),
      );
      expect(
        seated.changed.firstWhere((t) => t['tableId'] == tableId)['state'],
        'seated',
      );

      // Open cart, add 2 distinct lines of Cafe Americano, and fire offline.
      final cartRepo = ApiCartRepository(apiClient);
      final cartController = CartController(
        repository: cartRepo,
        telemetry: telemetry,
        offlineJournal: journal,
        deviceIdentity: () =>
            CartDeviceIdentity(deviceId: deviceId, credentialVersion: 1),
        connectivity: connectivity,
        workingCopy: localDb,
      );
      addTearDown(cartController.dispose);

      await cartController.open(merchantId, locationId, operator1.id);
      final lineTemplate = ProvisionalLine(
        productId: productId,
        productName: 'Cafe Americano',
        saleAction: 'merchandise',
        unitMinorUnits: unitPrice,
        currency: 'MXN',
        taxRateBasisPoints: 0,
      );
      expect(
        await cartController.add(
          productId: productId,
          quantity: 1,
          note: 'caliente',
          provisional: lineTemplate,
        ),
        isTrue,
      );
      expect(
        await cartController.add(
          productId: productId,
          quantity: 1,
          note: 'en las rocas',
          provisional: lineTemplate,
        ),
        isTrue,
      );
      final firedResult = await cartController.fire();
      expect(firedResult, isNotNull);

      // Prove PR #252 fix: offline fire is IMMEDIATELY visible on LanKdsStore
      // even though predicted carts are not written to SQLite `carts`.
      final localBoard = await lanStore.snapshot(merchantId, locationId);
      expect(
        localBoard,
        isNotEmpty,
        reason:
            'Offline pos.cart.fire must project into LanKdsStore immediately',
      );

      // Commit offline cash sale into real SQLite WAL journal.
      final currentCart = cartController.state.cart!;
      final totalMinorUnits = unitPrice * 2;
      final totalsMap = <String, Object?>{
        'subtotal': {'minorUnits': totalMinorUnits, 'currency': 'MXN'},
        'tax': {'minorUnits': 0, 'currency': 'MXN'},
        'discounts': {
          'total': {'minorUnits': 0, 'currency': 'MXN'},
          'entries': <Map<String, Object?>>[],
        },
        'grandTotal': {'minorUnits': totalMinorUnits, 'currency': 'MXN'},
        'businessDate': businessDate,
      };
      final taxesMap = <String, Object?>{
        'total': {'minorUnits': 0, 'currency': 'MXN'},
        'entries': <Map<String, Object?>>[],
      };
      final fingerprint = sha256
          .convert(
            utf8.encode(
              jsonEncode({
                'cartVersion': currentCart.version,
                'items': currentCart.items,
                'totals': totalsMap,
                'taxes': taxesMap,
              }),
            ),
          )
          .toString();
      final now = DateTime.now().toUtc();
      final checkoutCommandId = _uuidV4(301);
      final checkoutIdempotencyKey = _uuidV4(302);
      final offlineCheckout = OfflineCheckoutService(
        journal: journal,
        policyCache: policyCache,
        eligibility: const OfflineCheckoutEligibilityEngine(),
        telemetry: telemetry,
      );
      await offlineCheckout.checkout(
        OfflineCheckoutRequest(
          commandId: checkoutCommandId,
          idempotencyKey: checkoutIdempotencyKey,
          localCommitId: _uuidV4(303),
          authority: OfflineAuthorityContext(
            merchantId: merchantId,
            locationId: locationId,
            operatorSessionId: operator1.id,
            deviceId: deviceId,
            credentialVersion: 1,
            permissions: operator1.permissions.toSet(),
            entitlements: const {'pos', 'pos.offline_cash'},
            currency: 'MXN',
            deviceTrusted: true,
          ),
          checkoutCommand: CheckoutCommand(
            commandId: checkoutCommandId,
            cartId: currentCart.id,
            locationId: locationId,
            operatorSessionId: operator1.id,
            expectedCartVersion: currentCart.version,
            paymentMethod: 'cash',
            totalsFingerprint: fingerprint,
            idempotencyKey: checkoutIdempotencyKey,
            customerValueFingerprintCommandId: _uuidV4(304),
            tenderDrafts: [
              {
                'id': _uuidV4(305),
                'type': 'cash',
                'amount': {'minorUnits': totalMinorUnits, 'currency': 'MXN'},
                'amountReceived': {
                  'minorUnits': totalMinorUnits,
                  'currency': 'MXN',
                },
              },
            ],
            tipDraft: null,
            discountDrafts: const [],
            approvalIds: const [],
            receiptDelivery: const {
              'destination': 'display',
              'channel': null,
              'customerContactId': null,
            },
            cashShiftId: cashShiftId,
            customerValue: null,
          ),
          cart: currentCart,
          totals: TotalsConfirmation(
            cartVersion: currentCart.version,
            fingerprint: fingerprint,
            totals: totalsMap,
            taxes: taxesMap,
            discounts: const {
              'total': {'minorUnits': 0, 'currency': 'MXN'},
              'entries': <Map<String, Object?>>[],
            },
            catalogVersion: fingerprint,
            pricingVersion: fingerprint,
            taxVersion: fingerprint,
            snapshotAt: now.toIso8601String(),
            confirmedAt: now.toIso8601String(),
          ),
          catalogVersion: fingerprint,
          pricingVersion: fingerprint,
          taxVersion: fingerprint,
          catalogSnapshotAt: now,
          pricingSnapshotAt: now,
          taxSnapshotAt: now,
          amountReceivedMinorUnits: totalMinorUnits,
          businessDate: businessDate,
        ),
        facts: OfflineCheckoutFacts(
          amountMinorUnits: totalMinorUnits,
          catalogSnapshotAt: now,
          pricingSnapshotAt: now,
          taxSnapshotAt: now,
          connectivity: PosConnectivity.offline,
          paymentMethod: 'cash',
        ),
        now: now,
      );

      final preReopenSnapshot = await journal.load();
      expect(preReopenSnapshot.pendingCount, greaterThanOrEqualTo(5));

      // Simulate hard restart: close SQLite WAL journal and reopen fresh instance.
      await sqliteJournalStore.close();
      sqliteJournalStore = SqliteJournalStore(
        factory: databaseFactoryFfi,
        path: journalPath,
      );
      addTearDown(sqliteJournalStore.close);
      journal = EncryptedOfflineJournal(
        cipherStore,
        web: false,
        sqliteStore: sqliteJournalStore,
        telemetry: telemetry,
      );
      final reopenedSnapshot = await journal.load();
      expect(
        reopenedSnapshot.pendingCount,
        preReopenSnapshot.pendingCount,
        reason:
            'SQLite WAL journal must preserve every pending command across restart',
      );
      expect(
        reopenedSnapshot.lastTrustedServerTime,
        isNotNull,
        reason:
            'SQLite WAL journal must preserve trusted server time across restart',
      );

      // ── 4. Lock while offline -> Restore WAN -> Assert ZERO 401 replay storm ──
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: replayGateway,
        connectivity: connectivity,
        telemetry: telemetry,
      );
      addTearDown(recovery.dispose);
      // Seed an active scope (as an unlocked terminal would have), then lock.
      unawaited(
        recovery.recover(
          ReplayScope(
            merchantId: merchantId,
            locationId: locationId,
            operatorSessionId: operator1.id,
            deviceId: deviceId,
            credentialVersion: 1,
          ),
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // Lock terminal (clears scope & Bearer tokens).
      recovery.clearScope();
      await vault.clearSession();
      proxy.log.clear();

      // Restore WAN and tick heartbeat 3x while locked.
      proxy.online = true;
      for (var i = 0; i < 3; i += 1) {
        await apiClient.request(method: ApiMethod.get, path: '/health/live');
        connectivity.apiReachable(authorityValid: true);
        await recovery.replayIfPending();
      }
      final unauthorizedHits = proxy.log.where((e) => e.status == 401).toList();
      final replayBeginHitsWhileLocked = proxy.log
          .where((e) => e.path.contains('/offline/replay/begin'))
          .toList();
      expect(
        unauthorizedHits,
        isEmpty,
        reason: 'Locked terminal must emit ZERO 401 responses when WAN returns',
      );
      expect(
        replayBeginHitsWhileLocked,
        isEmpty,
        reason: 'Locked terminal must emit ZERO /offline/replay/begin calls',
      );

      // ── 5. Fresh real PIN unlock -> Automatic replay -> Real wire idempotency ──
      final login2 = await entryGateway.pinLogin(
        pin: pin,
        merchantId: merchantId,
        locationId: locationId,
      );
      await vault.saveTokens(
        login2.tokens['accessToken']! as String,
        login2.tokens['refreshToken']! as String,
      );
      final operator2 = await entryGateway.startOperator(
        merchantId,
        locationId,
      );
      final freshScope = ReplayScope(
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operator2.id,
        deviceId: deviceId,
        credentialVersion: 1,
      );
      await recovery.recover(freshScope);

      final afterReplay = await journal.load();
      final conflictEntries = afterReplay.entries
          .where((e) => e.status == JournalStatus.conflict)
          .toList();
      expect(
        afterReplay.pendingCount,
        0,
        reason:
            'Every queued command (table, cart, lines, fire, cash checkout) must land cleanly on real NestJS + Postgres; conflicts=${conflictEntries.map((c) => '${c.command.commandType}:${c.failure?['guidanceCode'] ?? c.lastSafeErrorCategory}').toList()}',
      );
      expect(conflictEntries, isEmpty);
      final recordedTelemetryNames = telemetryExporter.events
          .map((e) => e.name)
          .toSet();
      expect(
        recordedTelemetryNames,
        containsAll([
          'offline.checkout.committed',
          'offline.replay.auth_blocked',
          'offline.replay.started',
          'offline.replay.completed',
        ]),
        reason:
            'Real offline telemetry must emit checkout, auth-block, replay start, and replay completion events; got=$recordedTelemetryNames',
      );

      // Real wire idempotency: re-submit the exact accepted cash checkout command
      // to real /offline/replay/submit and verify duplicate acceptance (still 1 sale).
      final cashEntry = afterReplay.entries.firstWhere(
        (entry) => entry.command.commandType == 'pos.checkout.cash',
      );
      final dupBegin = await replayGateway.begin(freshScope);
      final dupResult = await replayGateway.submit(
        freshScope,
        ReplayBatch(
          replaySessionId: dupBegin.replaySessionId,
          commands: [cashEntry.command.toJson()],
        ),
      );
      expect(dupResult.results, hasLength(1));
      final dupVerdict = ReplayResult.fromJson(dupResult.results.single);
      expect(
        dupVerdict.status,
        anyOf('accepted', 'duplicate'),
        reason:
            'Duplicate wire replay of accepted cash command must answer idempotently',
      );

      // ── 6. Cancelled-cart cash replay conflict over real HTTP wire (P0 proof) ──
      final step6Now = DateTime.now().toUtc();
      final cancelledCheckoutCmdId = _uuidV4(401);
      final cancelledIdempotencyKey = _uuidV4(402);
      final cancelledCart = Cart(
        id: cancelledCartId,
        merchantId: merchantId,
        locationId: locationId,
        operatorSessionId: operator2.id,
        status: 'draft',
        version: 2,
        firedOrderId: null,
        fulfillmentType: 'dine_in',
        items: const [],
        totals: {
          'subtotal': {'minorUnits': unitPrice, 'currency': 'MXN'},
          'tax': {'minorUnits': 0, 'currency': 'MXN'},
          'discounts': {
            'total': {'minorUnits': 0, 'currency': 'MXN'},
            'entries': <Map<String, Object?>>[],
          },
          'grandTotal': {'minorUnits': unitPrice, 'currency': 'MXN'},
          'businessDate': businessDate,
        },
        checkoutEnabled: true,
        checkoutMessageCode: 'CHECKOUT_READY',
        updatedAt: step6Now.toIso8601String(),
      );
      final reopenedOfflineCheckout = OfflineCheckoutService(
        journal: journal,
        policyCache: OfflinePolicyCache(journal, web: false),
        eligibility: const OfflineCheckoutEligibilityEngine(),
      );
      await reopenedOfflineCheckout.checkout(
        OfflineCheckoutRequest(
          commandId: cancelledCheckoutCmdId,
          idempotencyKey: cancelledIdempotencyKey,
          localCommitId: _uuidV4(403),
          authority: OfflineAuthorityContext(
            merchantId: merchantId,
            locationId: locationId,
            operatorSessionId: operator2.id,
            deviceId: deviceId,
            credentialVersion: 1,
            permissions: operator2.permissions.toSet(),
            entitlements: const {'pos', 'pos.offline_cash'},
            currency: 'MXN',
            deviceTrusted: true,
          ),
          checkoutCommand: CheckoutCommand(
            commandId: cancelledCheckoutCmdId,
            cartId: cancelledCartId,
            locationId: locationId,
            operatorSessionId: operator2.id,
            expectedCartVersion: 2,
            paymentMethod: 'cash',
            totalsFingerprint: fingerprint,
            idempotencyKey: cancelledIdempotencyKey,
            customerValueFingerprintCommandId: _uuidV4(405),
            tenderDrafts: [
              {
                'id': _uuidV4(406),
                'type': 'cash',
                'amount': {'minorUnits': unitPrice, 'currency': 'MXN'},
                'amountReceived': {'minorUnits': unitPrice, 'currency': 'MXN'},
              },
            ],
            tipDraft: null,
            discountDrafts: const [],
            approvalIds: const [],
            receiptDelivery: const {
              'destination': 'display',
              'channel': null,
              'customerContactId': null,
            },
            cashShiftId: cashShiftId,
            customerValue: null,
          ),
          cart: cancelledCart,
          totals: TotalsConfirmation(
            cartVersion: 2,
            fingerprint: fingerprint,
            totals: cancelledCart.totals,
            taxes: taxesMap,
            discounts: const {
              'total': {'minorUnits': 0, 'currency': 'MXN'},
              'entries': <Map<String, Object?>>[],
            },
            catalogVersion: fingerprint,
            pricingVersion: fingerprint,
            taxVersion: fingerprint,
            snapshotAt: step6Now.toIso8601String(),
            confirmedAt: step6Now.toIso8601String(),
          ),
          catalogVersion: fingerprint,
          pricingVersion: fingerprint,
          taxVersion: fingerprint,
          catalogSnapshotAt: step6Now,
          pricingSnapshotAt: step6Now,
          taxSnapshotAt: step6Now,
          amountReceivedMinorUnits: unitPrice,
          businessDate: businessDate,
        ),
        facts: OfflineCheckoutFacts(
          amountMinorUnits: unitPrice,
          catalogSnapshotAt: step6Now,
          pricingSnapshotAt: step6Now,
          taxSnapshotAt: step6Now,
          connectivity: PosConnectivity.offline,
          paymentMethod: 'cash',
        ),
        now: step6Now,
      );
      final cancelledSnapshot = await journal.load();
      final cancelledCommand = cancelledSnapshot.entries
          .firstWhere((e) => e.command.commandId == cancelledCheckoutCmdId)
          .command;
      final cancelBegin = await replayGateway.begin(freshScope);
      final cancelSubmit = await replayGateway.submit(
        freshScope,
        ReplayBatch(
          replaySessionId: cancelBegin.replaySessionId,
          commands: [cancelledCommand.toJson()],
        ),
      );
      expect(cancelSubmit.results, hasLength(1));
      final cancelVerdict = ReplayResult.fromJson(cancelSubmit.results.single);
      expect(
        cancelVerdict.status,
        'conflict',
        reason:
            'P0 invariant: cash checkout on cancelled cart MUST return conflict, NEVER silent accepted',
      );
      expect(
        cancelVerdict.failure?['guidanceCode'],
        'cart_cancelled_after_cash_taken',
      );
    },
    skip: skipReason,
    timeout: const Timeout(Duration(seconds: 90)),
  );
}
