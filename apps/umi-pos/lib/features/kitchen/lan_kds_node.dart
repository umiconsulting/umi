import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:umi_contract/umi_contract.dart';

import '../../core/network/lan_discovery.dart';
import '../../core/network/lan_node_identity.dart';
import '../../core/storage/local_working_copy.dart';
import '../offline/offline_journal.dart';
import '../offline/operational_fire.dart';
import 'hub_command_forwarder.dart';
import 'lan_kds_store.dart';

/// The process clock for LAN trust.
///
/// [monotonicNow] must not jump backwards while the process runs. [wallNow]
/// detects a wall-clock rollback. Tests replace this clock with a controlled
/// one to exercise the 300-second boundary.
abstract interface class LanNodeClock {
  DateTime wallNow();
  Duration monotonicNow();
}

final class _SystemLanNodeClock implements LanNodeClock {
  const _SystemLanNodeClock();
  static final Stopwatch _process = Stopwatch()..start();

  @override
  DateTime wallNow() => DateTime.now();

  @override
  Duration monotonicNow() => _process.elapsed;
}

/// The last successful cloud validation of one peer and credential.
final class _LanTrust {
  const _LanTrust({
    required this.credentialHash,
    required this.merchantId,
    required this.locationId,
    required this.monotonicAt,
    required this.wallAt,
  });

  final String credentialHash;
  final String merchantId;
  final String locationId;
  final Duration monotonicAt;
  final DateTime wallAt;
}

/// One admitted identity tuple. Membership survives for the node process.
final class _LanAdmission {
  _LanAdmission({
    required this.key,
    required this.headers,
    required this.credentialHash,
    required this.deviceId,
    required this.merchantId,
    required this.locationId,
  });

  final String key;
  final Map<String, String> headers;
  final String credentialHash;
  final String deviceId;
  final String? merchantId;
  final String? locationId;
  bool demand = false;
  Duration? lastStart;
}

/// The local API of the main station.
///
/// It serves the kitchen surface only. A peer is trusted by the hash of the
/// device credential it presents. Cloud validation pairs a new peer and writes
/// a bounded persisted admission lease (12 hours) so already-admitted peers
/// keep working across extended WAN outages (>300 s) and hub restarts. The hub
/// still probes the cloud every 30 seconds while online so explicit revocations
/// take effect promptly; a clock rollback or lease expiry fails closed.
final class LanKdsNode {
  LanKdsNode({
    required LocalWorkingCopy local,
    required EncryptedOfflineJournal journal,
    required LanKdsStore store,
    required Future<LanNodeIdentity?> Function() identity,
    required Uri cloudBase,
    Future<int> Function(String commandId)? resolveConflict,
    this.port = lanNodePort,
    http.Client? client,
    LanNodeClock? clock,
  }) : _local = local,
       _journal = journal,
       _store = store,
       _identity = identity,
       _cloudBase = cloudBase,
       _resolveConflict = resolveConflict,
       _client = client ?? http.Client(),
       _clock = clock ?? const _SystemLanNodeClock();

  final LocalWorkingCopy _local;
  final EncryptedOfflineJournal _journal;
  final LanKdsStore _store;
  final Future<LanNodeIdentity?> Function() _identity;
  final Uri _cloudBase;
  final Future<int> Function(String commandId)? _resolveConflict;
  final http.Client _client;
  final LanNodeClock _clock;
  final int port;

  static const Duration _trustPeriod = Duration(hours: 12);
  static const Duration _probePeriod = Duration(seconds: 30);
  static const String _leaseNamespace = 'lan_peer_lease';

  HttpServer? _server;
  StreamSubscription<HttpRequest>? _requests;
  final StreamController<void> _changed = StreamController<void>.broadcast();
  final Map<String, _LanTrust> _trusted = {};
  final HubAccountSequencer _accountSequencer = HubAccountSequencer();
  static const int _maxAdmissions = 257;
  static const int _maxSnapshotBytes = 4096;
  static const int _maxResponseBytes = 65536;
  static const Duration _minStartSpacing = Duration(seconds: 2);

  final Map<String, _LanAdmission> _admissions = {};
  final List<String> _ring = [];
  int _cursor = 0;
  bool _probeActive = false;
  Duration? _nextStartNotBefore;
  Timer? _probeTimer;
  int _generation = 0;

  _LanAdmission _admit({
    required String key,
    required Map<String, String> headers,
    required String credentialHash,
    required String deviceId,
    required String? merchantId,
    required String? locationId,
    required int snapshotBytes,
  }) {
    final existing = _admissions[key];
    if (existing != null) {
      existing.demand = true;
      return existing;
    }
    if (snapshotBytes > _maxSnapshotBytes) {
      throw const _LanRefusal(
        'PAYLOAD_TOO_LARGE',
        HttpStatus.requestEntityTooLarge,
      );
    }
    if (_admissions.length >= _maxAdmissions) {
      // Exact admission is full. No record, no cloud request, no turn change.
      throw const _LanRefusal(
        'LAN_PROBE_CAPACITY_EXCEEDED',
        HttpStatus.serviceUnavailable,
      );
    }
    final admission = _LanAdmission(
      key: key,
      headers: headers,
      credentialHash: credentialHash,
      deviceId: deviceId,
      merchantId: merchantId,
      locationId: locationId,
    )..demand = true;
    _admissions[key] = admission;
    _ring.add(key);
    return admission;
  }

  _LanAdmission? _selectNext(Duration now) {
    if (_ring.isEmpty) return null;
    for (var offset = 0; offset < _ring.length; offset += 1) {
      final index = (_cursor + offset) % _ring.length;
      final admission = _admissions[_ring[index]];
      if (admission == null || !admission.demand) continue;
      final last = admission.lastStart;
      if (last != null && now - last < _probePeriod) continue;
      _cursor = (index + 1) % _ring.length;
      admission
        ..demand = false
        ..lastStart = now;
      return admission;
    }
    return null;
  }

  void _scheduleProbe() {
    if (_probeActive || _probeTimer?.isActive == true) return;
    final now = _clock.monotonicNow();
    final next = _nextStartNotBefore;
    final delay = next != null && next > now ? next - now : Duration.zero;
    _probeTimer = Timer(delay, () {
      _probeTimer = null;
      final at = _clock.monotonicNow();
      final earliest = _nextStartNotBefore;
      if (earliest != null && at < earliest) {
        _scheduleProbe();
        return;
      }
      final admission = _selectNext(at);
      if (admission == null) return;
      _probeActive = true;
      _nextStartNotBefore = at + _minStartSpacing;
      unawaited(
        _runProbe(admission).whenComplete(() {
          _probeActive = false;
          _scheduleProbe();
        }),
      );
    });
  }

  Future<bool> _tryProbeTurn(String requesterKey) async {
    final now = _clock.monotonicNow();
    final earliest = _nextStartNotBefore;
    if (_probeActive || (earliest != null && now < earliest)) {
      _scheduleProbe();
      return false;
    }
    final admission = _selectNext(now);
    if (admission == null) return false;
    _probeActive = true;
    _nextStartNotBefore = now + _minStartSpacing;
    if (admission.key == requesterKey) {
      try {
        await _runProbe(admission);
      } finally {
        _probeActive = false;
        _scheduleProbe();
      }
      return true;
    }
    unawaited(
      _runProbe(admission).whenComplete(() {
        _probeActive = false;
        _scheduleProbe();
      }),
    );
    return false;
  }

  Future<void> _runProbe(_LanAdmission admission) async {
    final generation = _generation;
    final abort = Completer<void>();
    final deadline = Timer(const Duration(seconds: 2), abort.complete);
    try {
      final request = http.AbortableRequest(
        'GET',
        _cloudBase.resolve('/api/v1/devices/status'),
        abortTrigger: abort.future,
      );
      request.headers.addAll(admission.headers);
      final response = await _client
          .send(request)
          .timeout(const Duration(seconds: 2));
      final body = BytesBuilder(copy: false);
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 2),
      )) {
        body.add(chunk);
        if (body.length > _maxResponseBytes) {
          throw StateError('response_too_large');
        }
      }
      if (generation != _generation) return;
      final status = response.statusCode;
      if (status >= 200 && status < 300) {
        final device = DeviceSummary.fromJson(
          jsonDecode(utf8.decode(body.takeBytes())) as Map<String, Object?>,
        );
        final mismatch =
            device.state != 'active' ||
            device.locationId == null ||
            (admission.merchantId != null &&
                admission.merchantId != device.merchantId) ||
            (admission.locationId != null &&
                admission.locationId != device.locationId);
        if (mismatch) {
          _trusted.remove(admission.deviceId);
          await _deletePeerLease(
            admission.merchantId,
            admission.locationId,
            admission.deviceId,
          );
          final known =
              admission.merchantId == null || admission.locationId == null
              ? null
              : await _local.readNetworkDevice(
                  admission.merchantId!,
                  admission.locationId!,
                  admission.deviceId,
                );
          if (known != null) {
            await _local.deleteNetworkDevice(
              known.merchantId,
              known.locationId,
              known.deviceId,
            );
          }
          _generation += 1;
          return;
        }
        final seenAt = _now();
        final wallNow = _clock.wallNow().toUtc();
        final known =
            admission.merchantId == null || admission.locationId == null
            ? null
            : await _local.readNetworkDevice(
                admission.merchantId!,
                admission.locationId!,
                admission.deviceId,
              );
        await _local.writeNetworkDevice(
          LocalNetworkDevice(
            merchantId: device.merchantId,
            locationId: device.locationId!,
            deviceId: device.id,
            role: device.type,
            stationId: null,
            address: null,
            port: null,
            credentialHash: admission.credentialHash,
            pairedAt: known?.pairedAt ?? seenAt,
            lastSeenAt: seenAt,
            status: 'active',
          ),
        );
        await _writePeerLease(
          merchantId: device.merchantId,
          locationId: device.locationId!,
          deviceId: device.id,
          credentialHash: admission.credentialHash,
          validatedAt: wallNow,
        );
        _trusted[admission.deviceId] = _LanTrust(
          credentialHash: admission.credentialHash,
          merchantId: device.merchantId,
          locationId: device.locationId!,
          monotonicAt: _clock.monotonicNow(),
          wallAt: wallNow,
        );
        return;
      }
      if (status >= 400 && status < 500) {
        _trusted.remove(admission.deviceId);
        await _deletePeerLease(
          admission.merchantId,
          admission.locationId,
          admission.deviceId,
        );
        if (admission.merchantId != null && admission.locationId != null) {
          final known = await _local.readNetworkDevice(
            admission.merchantId!,
            admission.locationId!,
            admission.deviceId,
          );
          if (known != null) {
            await _local.deleteNetworkDevice(
              known.merchantId,
              known.locationId,
              known.deviceId,
            );
          }
          _generation += 1;
        }
      }
    } on _LanRefusal {
      rethrow;
    } catch (error) {
      debugPrint(
        '[umipos] lan_peer_validation_unavailable '
        'type=${error.runtimeType}',
      );
    } finally {
      deadline.cancel();
    }
  }

  bool _stopped = false;

  Uri? get boundUri {
    final server = _server;
    return server == null
        ? null
        : Uri(scheme: 'http', host: server.address.address, port: server.port);
  }

  Future<Uri> start() async {
    if (_server != null) return boundUri!;
    final server = await HttpServer.bind(
      InternetAddress.anyIPv4,
      port,
      shared: false,
    );
    server.autoCompress = false;
    _server = server;
    _requests = server.listen(_handle, onError: (_) {});
    return boundUri!;
  }

  Future<void> stop() async {
    _stopped = true;
    await _requests?.cancel();
    _requests = null;
    await _server?.close(force: true);
    _server = null;
    _client.close();
    await _changed.close();
  }

  Future<void> _handle(HttpRequest request) async {
    try {
      _recordClock(request);
      final path = request.uri.path;
      if (path == '/health/live' && request.method == 'GET') {
        await _json(request, HttpStatus.ok, {
          'status': 'ok',
          'state': 'Healthy',
          'serverTime': _now(),
          'lanNode': true,
        });
        return;
      }
      if (path == '/api/kds/board' && request.method == 'POST') {
        await _legacyBoard(request);
        return;
      }
      if (path == '/api/kds/command' && request.method == 'POST') {
        await _legacyCommand(request);
        return;
      }
      final segments = request.uri.pathSegments;
      if (segments.length == 7 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'cart-command' &&
          request.method == 'POST') {
        await _posCartCommand(request, segments[4]);
        return;
      }
      if (segments.length == 7 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'table-command' &&
          request.method == 'POST') {
        await _posTableCommand(request, segments[4]);
        return;
      }
      if (segments.length == 8 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'cart-command' &&
          request.method == 'GET') {
        await _posCartCommandStatus(request, segments[4], segments[7]);
        return;
      }
      if (segments.length == 8 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'table-command' &&
          request.method == 'GET') {
        await _posTableCommandStatus(request, segments[4], segments[7]);
        return;
      }
      if (segments.length == 9 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'cart-command' &&
          segments[8] == 'resolve' &&
          request.method == 'POST') {
        await _posHubConflictResolve(
          request,
          segments[4],
          segments[7],
          group: false,
        );
        return;
      }
      if (segments.length == 9 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'table-command' &&
          segments[8] == 'resolve' &&
          request.method == 'POST') {
        await _posTableConflictResolve(request, segments[4], segments[7]);
        return;
      }
      if (segments.length == 9 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'command-group' &&
          segments[8] == 'resolve' &&
          request.method == 'POST') {
        await _posHubConflictResolve(
          request,
          segments[4],
          segments[7],
          group: true,
        );
        return;
      }
      if (segments.length == 8 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'command-group' &&
          request.method == 'GET') {
        await _posCommandGroupStatus(request, segments[4], segments[7]);
        return;
      }
      if (segments.length == 7 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'lan' &&
          segments[6] == 'command-group' &&
          request.method == 'POST') {
        await _posCommandGroup(request, segments[4]);
        return;
      }
      if (segments.length == 7 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'kitchen') {
        final merchantId = segments[4];
        if (segments[6] == 'board' && request.method == 'GET') {
          await _posBoard(request, merchantId);
          return;
        }
        if (segments[6] == 'command' && request.method == 'POST') {
          await _posCommand(request, merchantId);
          return;
        }
        if (segments[6] == 'stations' && request.method == 'GET') {
          await _posStations(request, merchantId);
          return;
        }
        if (segments[6] == 'board' && request.method == 'GET') {
          await _posBoard(request, merchantId);
          return;
        }
      }
      if (segments.length == 8 &&
          segments[0] == 'api' &&
          segments[1] == 'v1' &&
          segments[2] == 'pos' &&
          segments[3] == 'merchants' &&
          segments[5] == 'kitchen' &&
          segments[6] == 'board' &&
          segments[7] == 'watch' &&
          request.method == 'GET') {
        await _posWatch(request, segments[4]);
        return;
      }
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    } on _LanRefusal catch (error) {
      await _error(request, error.status, error.code);
    } catch (_) {
      if (!_stopped) {
        await _error(request, HttpStatus.internalServerError, 'INTERNAL_ERROR');
      }
    }
  }

  Future<void> _legacyBoard(HttpRequest request) async {
    final body = await _readObject(request);
    final peer = await _authenticate(request);
    final action = body['action'];
    final List<Map<String, Object?>> data;
    if (action == 'snapshot') {
      data = await _store.snapshot(peer.merchantId, peer.locationId);
    } else if (action == 'events') {
      final afterSequence = (body['afterSequence'] as num?)?.toInt();
      final limit = (body['limit'] as num?)?.toInt();
      if (afterSequence == null || limit == null) {
        throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
      }
      data = await _store.events(
        peer.merchantId,
        peer.locationId,
        afterSequence: afterSequence,
        limit: limit,
      );
    } else {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    await _json(request, HttpStatus.ok, {'ok': true, 'data': data});
  }

  Future<void> _legacyCommand(HttpRequest request) async {
    final body = await _readObject(request);
    final parsed = _parseCommand(body);
    final peer = await _authenticate(request);
    final result = await _journalCommand(
      request,
      peer,
      parsed,
      operatorSessionId:
          request.headers.value('x-umi-operator-session-id') ??
          (await _identity())?.operatorSessionId,
    );
    await _json(request, HttpStatus.ok, {'ok': true, 'data': result});
  }

  Future<void> _posBoard(HttpRequest request, String merchantId) async {
    final query = request.uri.queryParameters;
    final locationId = query['locationId'];
    if (locationId == null) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(
      request,
      merchantId: merchantId,
      locationId: locationId,
    );
    final data = await _store.snapshot(peer.merchantId, peer.locationId);
    await _json(request, HttpStatus.ok, {'ok': true, 'data': data});
  }

  Future<void> _posCommand(HttpRequest request, String merchantId) async {
    final body = await _readObject(request);
    final PosKitchenCommandRequest parsed;
    try {
      parsed = PosKitchenCommandRequest.fromJson(body);
    } catch (_) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(
      request,
      merchantId: merchantId,
      locationId: parsed.locationId,
    );
    final legacy = KitchenCommandRequest(
      action: 'command',
      commandId: parsed.commandId,
      idempotencyKey: parsed.idempotencyKey,
      correlationId: parsed.correlationId,
      expectedVersion: parsed.expectedVersion,
      kitchenOrderId: parsed.kitchenOrderId,
      commandType: parsed.commandType,
      itemIds: parsed.itemIds,
      reasonCode: parsed.reasonCode,
      reasonNote: parsed.reasonNote,
      priority: parsed.priority,
      courseNumber: parsed.courseNumber,
    );
    final result = await _journalCommand(
      request,
      peer,
      legacy,
      operatorSessionId: parsed.operatorSessionId,
      posRequest: parsed,
    );
    await _json(request, HttpStatus.ok, {'ok': true, 'data': result});
  }

  /// Accept one peer intent into the main station's durable outbox.
  ///
  /// The hub creates its own command identity and sequence. The peer identity
  /// stays in the payload for attribution. Delivery uses the host replay lane,
  /// so one peer does not open a second cloud command stream.
  Future<void> _posCommandGroup(HttpRequest request, String merchantId) async {
    final body = await _readObject(request);
    final OfflineCommandGroupPayload group;
    try {
      group = OfflineCommandGroupPayload.fromJson(body);
    } catch (_) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    if (group.effects.length != 1 ||
        group.effects.single['type'] != 'open_table_account') {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    await _accountSequencer.run(
      _groupAccountKey(group),
      () => _appendCommandGroup(request, merchantId, body, group),
    );
  }

  Future<void> _appendCommandGroup(
    HttpRequest request,
    String merchantId,
    Map<String, Object?> body,
    OfflineCommandGroupPayload group,
  ) async {
    final peer = await _authenticate(request, merchantId: merchantId);
    final host = await _identity();
    if (host == null ||
        host.merchantId != peer.merchantId ||
        host.locationId != peer.locationId) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final originOperatorSessionId = request.headers.value(
      'x-umi-operator-session-id',
    );
    if (originOperatorSessionId == null || !_isUuid(originOperatorSessionId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final commandId = _uuidFrom('hub-group:${peer.deviceId}:${group.groupId}');
    final journal = await _journal.load();
    final existing = journal.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (existing.isNotEmpty) {
      await _json(request, HttpStatus.ok, {
        'ok': true,
        'data': {
          'queued': true,
          'duplicate': true,
          'groupId': group.groupId,
          'commandId': commandId,
          'deviceSequence': existing.single.command.deviceSequence,
        },
      });
      return;
    }
    final command = await _journal.append(
      commandId: commandId,
      deviceId: host.deviceId,
      credentialVersion: host.credentialVersion,
      merchantId: peer.merchantId,
      locationId: peer.locationId,
      operatorSessionId: host.operatorSessionId,
      // The cloud validates that a command-group idempotency key equals the
      // group ID. The peer-generated UUID is already unique.
      idempotencyKey: group.groupId,
      commandType: 'pos.command.group',
      payload: {
        ...body,
        'originDeviceId': peer.deviceId,
        'originOperatorSessionId': originOperatorSessionId,
        'hubReceivedAt': _now(),
      },
    );
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'queued': true,
        'duplicate': false,
        'groupId': group.groupId,
        'commandId': command.commandId,
        'deviceSequence': command.deviceSequence,
      },
    });
  }

  Future<void> _posCommandGroupStatus(
    HttpRequest request,
    String merchantId,
    String groupId,
  ) async {
    if (!_isUuid(groupId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final host = await _identity();
    if (host == null ||
        host.merchantId != peer.merchantId ||
        host.locationId != peer.locationId) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final commandId = _uuidFrom('hub-group:${peer.deviceId}:$groupId');
    final journal = await _journal.load();
    JournalEntry? entry;
    for (final value in journal.entries) {
      if (value.command.commandId == commandId) {
        entry = value;
        break;
      }
    }
    if (entry == null) {
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    }
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'groupId': groupId,
        'commandId': commandId,
        'deviceSequence': entry.command.deviceSequence,
        'status': entry.status.name,
        'errorCode': entry.lastSafeErrorCategory,
        'officialId': entry.officialId,
        'officialCommit': entry.officialCommit,
        'failure': entry.failure,
      },
    });
  }

  Future<void> _posCartCommand(HttpRequest request, String merchantId) async {
    final body = await _readObject(request);
    final clientCommandId = body['commandId'];
    final clientIdempotencyKey = body['idempotencyKey'];
    final commandType = body['commandType'];
    final rawPayload = body['payload'];
    const allowed = {
      'pos.cart.open',
      'pos.cart.line.add',
      'pos.cart.line.update',
      'pos.cart.line.remove',
      'pos.cart.clear',
      'pos.cart.prepare',
      'pos.cart.fire',
      'pos.cart.fulfillment.set',
      'pos.cart.table.set',
    };
    if (clientCommandId is! String ||
        !_isUuid(clientCommandId) ||
        clientIdempotencyKey is! String ||
        !_isUuid(clientIdempotencyKey) ||
        commandType is! String ||
        !allowed.contains(commandType) ||
        rawPayload is! Map<String, Object?>) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    await _accountSequencer.run(
      _cartAccountKey(clientCommandId, rawPayload),
      () => _appendPosCartCommand(
        request,
        merchantId,
        clientCommandId,
        clientIdempotencyKey,
        commandType,
        rawPayload,
      ),
    );
  }

  Future<void> _appendPosCartCommand(
    HttpRequest request,
    String merchantId,
    String clientCommandId,
    String clientIdempotencyKey,
    String commandType,
    Map<String, Object?> rawPayload,
  ) async {
    final originOperatorSessionId = request.headers.value(
      'x-umi-operator-session-id',
    );
    if (originOperatorSessionId == null || !_isUuid(originOperatorSessionId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final host = await _identity();
    if (host == null ||
        host.merchantId != peer.merchantId ||
        host.locationId != peer.locationId) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final commandId = _uuidFrom(
      'hub-command:${peer.deviceId}:$clientCommandId',
    );
    final operational = rawPayload[operationalFireKey];
    final cleanPayload = Map<String, Object?>.from(rawPayload)
      ..remove(operationalFireKey);
    final journal = await _journal.load();
    final existing = journal.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (existing.isNotEmpty) {
      final current = existing.single;
      final projected =
          operational is Map<String, Object?> && commandType == 'pos.cart.fire';
      if (projected) {
        // A retried forward may have lost the host projection in a crash. The
        // command already exists; restoring the ticket is idempotent.
        await OperationalFireStore(_local).record(
          merchantId: peer.merchantId,
          locationId: peer.locationId,
          commandId: commandId,
          operational: operational,
        );
      }
      await _json(request, HttpStatus.ok, {
        'ok': true,
        'data': {
          'queued': true,
          'duplicate': true,
          'commandId': commandId,
          'deviceSequence': current.command.deviceSequence,
          // A duplicate forward does not append or project again. The revision
          // still names the durable work the peer's ticket is derived from.
          'projectionRevision': current.command.deviceSequence,
          'requestId': current.command.idempotencyKey,
          'originRequestId': clientIdempotencyKey,
          'attempts': current.attempts,
          'projected': projected,
        },
      });
      return;
    }
    final projected =
        operational is Map<String, Object?> && commandType == 'pos.cart.fire';
    if (projected) {
      // The ticket is durable before the command that justifies it. A crash
      // between the two leaves an orphan the board ignores; a crash after the
      // append leaves a recoverable ticket.
      await OperationalFireStore(_local).record(
        merchantId: peer.merchantId,
        locationId: peer.locationId,
        commandId: commandId,
        operational: operational,
      );
    }
    final command = await _journal.append(
      commandId: commandId,
      deviceId: host.deviceId,
      credentialVersion: host.credentialVersion,
      merchantId: peer.merchantId,
      locationId: peer.locationId,
      operatorSessionId: host.operatorSessionId,
      idempotencyKey: _uuidFrom(
        'hub-command-key:${peer.deviceId}:$clientIdempotencyKey',
      ),
      commandType: commandType,
      originDeviceId: peer.deviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: _now(),
      payload: {
        ...cleanPayload,
        'operatorSessionId': host.operatorSessionId,
        'locationId': peer.locationId,
      },
    );
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'queued': true,
        'duplicate': false,
        'commandId': command.commandId,
        'deviceSequence': command.deviceSequence,
        // The receipt means "host journal + projection input accepted", never
        // "the cook saw it". The board derives the ticket from this revision.
        'projectionRevision': command.deviceSequence,
        'requestId': command.idempotencyKey,
        'originRequestId': clientIdempotencyKey,
        'attempts': 0,
        'projected': projected,
      },
    });
  }

  Future<void> _posCartCommandStatus(
    HttpRequest request,
    String merchantId,
    String clientCommandId,
  ) async {
    if (!_isUuid(clientCommandId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final host = await _identity();
    if (host == null ||
        host.merchantId != peer.merchantId ||
        host.locationId != peer.locationId) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final commandId = _uuidFrom(
      'hub-command:${peer.deviceId}:$clientCommandId',
    );
    final journal = await _journal.load();
    final matches = journal.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (matches.isEmpty) {
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    }
    final entry = matches.single;
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'commandId': clientCommandId,
        'hubCommandId': entry.command.commandId,
        'deviceSequence': entry.command.deviceSequence,
        'status': entry.status.name,
        'errorCode': entry.lastSafeErrorCategory,
        'officialId': entry.officialId,
        'officialCommit': entry.officialCommit,
        'failure': entry.failure,
      },
    });
  }

  Future<void> _posTableCommand(HttpRequest request, String merchantId) async {
    final body = await _readObject(request);
    final clientCommandId = body['commandId'];
    final clientIdempotencyKey = body['idempotencyKey'];
    final action = body['action'];
    final tableRequest = body['request'];
    const actions = {
      'seat',
      'move',
      'merge',
      'split',
      'clear',
      'open',
      'ordered',
      'served',
      'awaiting_payment',
    };
    if (clientCommandId is! String ||
        !_isUuid(clientCommandId) ||
        clientIdempotencyKey is! String ||
        !_isUuid(clientIdempotencyKey) ||
        action is! String ||
        !actions.contains(action) ||
        tableRequest is! Map<String, Object?>) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final originOperatorSessionId = request.headers.value(
      'x-umi-operator-session-id',
    );
    if (originOperatorSessionId == null || !_isUuid(originOperatorSessionId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    await _accountSequencer.run(
      _tableAccountKey(clientCommandId, tableRequest),
      () async {
        final peer = await _authenticate(request, merchantId: merchantId);
        final host = await _identity();
        if (host == null ||
            host.merchantId != peer.merchantId ||
            host.locationId != peer.locationId) {
          throw const _LanRefusal(
            'AUTHENTICATION_REQUIRED',
            HttpStatus.unauthorized,
          );
        }
        final commandId = _uuidFrom(
          'hub-table:${peer.deviceId}:$clientCommandId',
        );
        final journal = await _journal.load();
        final existing = journal.entries.where(
          (entry) => entry.command.commandId == commandId,
        );
        if (existing.isNotEmpty) {
          await _json(request, HttpStatus.ok, {
            'ok': true,
            'data': {
              'queued': true,
              'duplicate': true,
              'commandId': commandId,
              'deviceSequence': existing.single.command.deviceSequence,
            },
          });
          return;
        }
        final command = await _journal.append(
          commandId: commandId,
          deviceId: host.deviceId,
          credentialVersion: host.credentialVersion,
          merchantId: peer.merchantId,
          locationId: peer.locationId,
          operatorSessionId: host.operatorSessionId,
          idempotencyKey: _uuidFrom(
            'hub-table-key:${peer.deviceId}:$clientIdempotencyKey',
          ),
          commandType: 'pos.table.command',
          originDeviceId: peer.deviceId,
          originOperatorSessionId: originOperatorSessionId,
          hubReceivedAt: _now(),
          payload: {
            'action': action,
            'request': {
              ...tableRequest,
              'operatorSessionId': host.operatorSessionId,
              'locationId': peer.locationId,
            },
          },
        );
        await _json(request, HttpStatus.ok, {
          'ok': true,
          'data': {
            'queued': true,
            'duplicate': false,
            'commandId': command.commandId,
            'deviceSequence': command.deviceSequence,
          },
        });
      },
    );
  }

  Future<void> _posTableCommandStatus(
    HttpRequest request,
    String merchantId,
    String clientCommandId,
  ) async {
    if (!_isUuid(clientCommandId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final commandId = _uuidFrom('hub-table:${peer.deviceId}:$clientCommandId');
    final journal = await _journal.load();
    final matches = journal.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (matches.isEmpty) {
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    }
    final entry = matches.single;
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'commandId': clientCommandId,
        'hubCommandId': entry.command.commandId,
        'deviceSequence': entry.command.deviceSequence,
        'status': entry.status.name,
        'errorCode': entry.lastSafeErrorCategory,
        'officialId': entry.officialId,
        'officialCommit': entry.officialCommit,
        'failure': entry.failure,
      },
    });
  }

  Future<void> _posTableConflictResolve(
    HttpRequest request,
    String merchantId,
    String clientCommandId,
  ) async {
    if (!_isUuid(clientCommandId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final commandId = _uuidFrom('hub-table:${peer.deviceId}:$clientCommandId');
    final before = await _journal.load();
    final matches = before.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (matches.isEmpty) {
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    }
    final current = matches.single;
    if (current.status == JournalStatus.conflict) {
      final resolve = _resolveConflict;
      if (resolve == null) {
        throw const _LanRefusal(
          'RESOLUTION_UNAVAILABLE',
          HttpStatus.serviceUnavailable,
        );
      }
      await resolve(commandId);
    }
    final after = await _journal.load();
    final updated = after.entries.singleWhere(
      (entry) => entry.command.commandId == commandId,
    );
    final resolved =
        updated.status == JournalStatus.resolved ||
        updated.status == JournalStatus.accepted ||
        updated.status == JournalStatus.duplicate;
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'resolved': resolved,
        'commandId': clientCommandId,
        'hubCommandId': commandId,
        'deviceSequence': updated.command.deviceSequence,
        'status': updated.status.name,
      },
    });
  }

  Future<void> _posHubConflictResolve(
    HttpRequest request,
    String merchantId,
    String originalId, {
    required bool group,
  }) async {
    if (!_isUuid(originalId)) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(request, merchantId: merchantId);
    final host = await _identity();
    if (host == null ||
        host.merchantId != peer.merchantId ||
        host.locationId != peer.locationId) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final commandId = _uuidFrom(
      group
          ? 'hub-group:${peer.deviceId}:$originalId'
          : 'hub-command:${peer.deviceId}:$originalId',
    );
    final before = await _journal.load();
    final matches = before.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (matches.isEmpty) {
      throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
    }
    final current = matches.single;
    if (current.status == JournalStatus.conflict) {
      final resolve = _resolveConflict;
      if (resolve == null) {
        throw const _LanRefusal(
          'RESOLUTION_UNAVAILABLE',
          HttpStatus.serviceUnavailable,
        );
      }
      await resolve(commandId);
    }
    final after = await _journal.load();
    final updated = after.entries.singleWhere(
      (entry) => entry.command.commandId == commandId,
    );
    final resolved =
        updated.status == JournalStatus.resolved ||
        updated.status == JournalStatus.accepted ||
        updated.status == JournalStatus.duplicate;
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': {
        'resolved': resolved,
        'commandId': originalId,
        'hubCommandId': commandId,
        'deviceSequence': updated.command.deviceSequence,
        'status': updated.status.name,
      },
    });
  }

  Future<void> _posStations(HttpRequest request, String merchantId) async {
    final locationId = request.uri.queryParameters['locationId'];
    if (locationId == null) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    final peer = await _authenticate(
      request,
      merchantId: merchantId,
      locationId: locationId,
    );
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'data': await _store.stations(peer.merchantId, peer.locationId),
    });
  }

  Future<void> _posWatch(HttpRequest request, String merchantId) async {
    final locationId = request.uri.queryParameters['locationId'];
    if (locationId == null) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    await _authenticate(
      request,
      merchantId: merchantId,
      locationId: locationId,
    );
    var changed = false;
    try {
      await _changed.stream.first.timeout(const Duration(seconds: 5));
      changed = true;
    } on TimeoutException {
      changed = false;
    }
    await _json(request, HttpStatus.ok, {
      'ok': true,
      'changed': changed,
      'waitedMs': changed ? 0 : 5000,
    });
  }

  Future<Map<String, Object?>> _journalCommand(
    HttpRequest request,
    _LanPeer peer,
    KitchenCommandRequest command, {
    required String? operatorSessionId,
    PosKitchenCommandRequest? posRequest,
  }) async {
    final host = await _identity();
    if (host == null) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final journal = await _journal.load();
    final existing = journal.entries.where(
      (entry) => entry.command.commandId == command.commandId,
    );
    if (existing.isNotEmpty) {
      var current = await _store.commandResult(
        peer.merchantId,
        peer.locationId,
        command.kitchenOrderId,
      );
      if (current == null) {
        throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
      }
      // A previous attempt could have appended the command and died before the
      // board write. The command is the durable fact; re-apply its transition
      // instead of returning an older board version and leaving the bump lost.
      final version = (current['version'] as num? ?? 0).toInt();
      if (version <= command.expectedVersion) {
        try {
          final prepared = await _store.prepareCommand(
            peer.merchantId,
            peer.locationId,
            command,
          );
          current = await _store.commitCommand(
            peer.merchantId,
            peer.locationId,
            prepared,
          );
        } on LanKdsRefusal catch (error) {
          if (error.code != 'KITCHEN_VERSION_CONFLICT') rethrow;
        }
      }
      if (current == null) {
        throw const _LanRefusal('RESOURCE_NOT_FOUND', HttpStatus.notFound);
      }
      return current;
    }
    final sourceReference = await _store.sourceReferenceFor(
      peer.merchantId,
      peer.locationId,
      command.kitchenOrderId,
    );
    final lineMap = sourceReference == null
        ? null
        : await _store.itemOrderFor(
            peer.merchantId,
            peer.locationId,
            command.kitchenOrderId,
            command.itemIds ?? const [],
          );
    final sessionId = operatorSessionId ?? host.operatorSessionId;
    final replayCommand =
        posRequest ??
        PosKitchenCommandRequest(
          action: command.action,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          expectedVersion: command.expectedVersion,
          kitchenOrderId: command.kitchenOrderId,
          commandType: command.commandType,
          itemIds: command.itemIds ?? const [],
          reasonCode: command.reasonCode,
          reasonNote: command.reasonNote,
          priority: command.priority,
          courseNumber: command.courseNumber,
          locationId: peer.locationId,
          operatorSessionId: sessionId,
        );
    // Compute first, journal second, board third. The board must never show a
    // transition that has no replayable command behind it.
    final prepared = await _store.prepareCommand(
      peer.merchantId,
      peer.locationId,
      command,
    );
    final payload = <String, Object?>{
      ...replayCommand.toJson(),
      'actorDeviceId': peer.deviceId,
      'sourceReference': ?sourceReference,
      'lineMap': ?lineMap,
      'hubReceivedAt': _now(),
    };
    await _journal.append(
      commandId: command.commandId,
      deviceId: host.deviceId,
      credentialVersion: host.credentialVersion,
      merchantId: peer.merchantId,
      locationId: peer.locationId,
      // The journal belongs to the station whose device cursor is being
      // advanced. The cook's session stays in the payload as attribution.
      operatorSessionId: host.operatorSessionId,
      idempotencyKey: _uuidFrom(
        '${command.commandId}:${command.idempotencyKey}',
      ),
      payload: payload,
      commandType: 'pos.kds.command',
    );
    final result = await _store.commitCommand(
      peer.merchantId,
      peer.locationId,
      prepared,
    );
    if (!_changed.isClosed) _changed.add(null);
    return result;
  }

  Future<_LanPeer> _authenticate(
    HttpRequest request, {
    String? merchantId,
    String? locationId,
  }) async {
    final deviceId = request.headers.value('x-umi-device-id');
    final publicId = request.headers.value('x-umi-device-public-id');
    final installationId = request.headers.value('x-umi-installation-id');
    final credential = request.headers.value('x-umi-device-credential');
    final headerMerchant = request.headers.value('x-umi-merchant-id');
    final headerLocation = request.headers.value('x-umi-location-id');
    final scopeMerchant = merchantId ?? headerMerchant;
    final scopeLocation = locationId ?? headerLocation;
    if (deviceId == null ||
        publicId == null ||
        installationId == null ||
        credential == null) {
      throw const _LanRefusal(
        'AUTHENTICATION_REQUIRED',
        HttpStatus.unauthorized,
      );
    }
    final hash = sha256.convert(utf8.encode(credential)).toString();
    final known = scopeMerchant == null || scopeLocation == null
        ? null
        : await _local.readNetworkDevice(
            scopeMerchant,
            scopeLocation,
            deviceId,
          );
    final headers = <String, String>{
      'accept': 'application/json',
      'x-umi-device-id': deviceId,
      'x-umi-device-public-id': publicId,
      'x-umi-installation-id': installationId,
      'x-umi-device-credential': credential,
      'x-umi-merchant-id': ?headerMerchant,
      'x-umi-location-id': ?headerLocation,
    };
    final key = [
      hash,
      deviceId,
      publicId,
      installationId,
      headerMerchant ?? '',
      headerLocation ?? '',
      scopeMerchant ?? '',
      scopeLocation ?? '',
    ].join('\u0000');
    final admission = _admit(
      key: key,
      headers: headers,
      credentialHash: hash,
      deviceId: deviceId,
      merchantId: scopeMerchant,
      locationId: scopeLocation,
      snapshotBytes: utf8.encode(key).length + utf8.encode(credential).length,
    );
    final trust = _freshTrust(
      deviceId: deviceId,
      credentialHash: hash,
      merchantId: scopeMerchant,
      locationId: scopeLocation,
    );
    final trustAgeOk =
        admission.lastStart != null &&
        _clock.monotonicNow() - admission.lastStart! < _probePeriod;
    if (trust != null &&
        trustAgeOk &&
        known != null &&
        known.credentialHash == hash &&
        known.status == 'active') {
      final seen = known.seen(
        address: request.connectionInfo?.remoteAddress.address,
        port: request.connectionInfo?.remotePort,
      );
      await _local.writeNetworkDevice(seen);
      return _LanPeer(seen);
    }
    admission.demand = true;
    await _tryProbeTurn(key);
    final validated =
        _freshTrust(
          deviceId: deviceId,
          credentialHash: hash,
          merchantId: scopeMerchant,
          locationId: scopeLocation,
        ) !=
        null;
    final leased =
        validated ||
        await _hasValidPersistedLease(
          deviceId: deviceId,
          credentialHash: hash,
          merchantId: scopeMerchant,
          locationId: scopeLocation,
        );
    final refreshed = scopeMerchant == null || scopeLocation == null
        ? null
        : await _local.readNetworkDevice(
            scopeMerchant,
            scopeLocation,
            deviceId,
          );
    if (leased &&
        refreshed != null &&
        refreshed.credentialHash == hash &&
        refreshed.status == 'active') {
      final seen = refreshed.seen(
        address: request.connectionInfo?.remoteAddress.address,
        port: request.connectionInfo?.remotePort,
      );
      await _local.writeNetworkDevice(seen);
      return _LanPeer(seen);
    }
    throw const _LanRefusal('DEVICE_REVOKED', HttpStatus.forbidden);
  }

  Future<void> _writePeerLease({
    required String merchantId,
    required String locationId,
    required String deviceId,
    required String credentialHash,
    required DateTime validatedAt,
  }) => _local.writeDocument(
    namespace: _leaseNamespace,
    scopeKey: '$merchantId:$locationId',
    id: deviceId,
    payload: {
      'merchantId': merchantId,
      'locationId': locationId,
      'deviceId': deviceId,
      'credentialHash': credentialHash,
      'validatedAt': validatedAt.toUtc().toIso8601String(),
      'expiresAt': validatedAt.toUtc().add(_trustPeriod).toIso8601String(),
    },
  );

  Future<void> _deletePeerLease(
    String? merchantId,
    String? locationId,
    String deviceId,
  ) async {
    if (merchantId == null || locationId == null) return;
    await _local.deleteDocument(
      _leaseNamespace,
      '$merchantId:$locationId',
      deviceId,
    );
  }

  Future<bool> _hasValidPersistedLease({
    required String deviceId,
    required String credentialHash,
    required String? merchantId,
    required String? locationId,
  }) async {
    if (merchantId == null || locationId == null) return false;
    final lease = await _local.readDocument(
      _leaseNamespace,
      '$merchantId:$locationId',
      deviceId,
    );
    if (lease == null) return false;
    if (lease['credentialHash'] != credentialHash ||
        lease['merchantId'] != merchantId ||
        lease['locationId'] != locationId) {
      return false;
    }
    final validatedAt = DateTime.tryParse(
      lease['validatedAt'] as String? ?? '',
    )?.toUtc();
    final expiresAt = DateTime.tryParse(
      lease['expiresAt'] as String? ?? '',
    )?.toUtc();
    if (validatedAt == null || expiresAt == null) return false;
    final wall = _clock.wallNow().toUtc();
    if (wall.isBefore(validatedAt) || !wall.isBefore(expiresAt)) {
      return false;
    }
    return true;
  }

  _LanTrust? _freshTrust({
    required String deviceId,
    required String credentialHash,
    required String? merchantId,
    required String? locationId,
  }) {
    final trust = _trusted[deviceId];
    if (trust == null || merchantId == null || locationId == null) {
      return null;
    }
    if (trust.credentialHash != credentialHash ||
        trust.merchantId != merchantId ||
        trust.locationId != locationId) {
      return null;
    }
    final wall = _clock.wallNow().toUtc();
    final monotonic = _clock.monotonicNow();
    if (wall.isBefore(trust.wallAt) || monotonic < trust.monotonicAt) {
      _trusted.remove(deviceId);
      return null;
    }
    if (monotonic - trust.monotonicAt >= _trustPeriod) {
      _trusted.remove(deviceId);
      return null;
    }
    return trust;
  }

  void _recordClock(HttpRequest request) {
    final raw = request.headers.value('x-umi-client-time');
    final client = raw == null ? null : DateTime.tryParse(raw);
    if (client == null) return;
    final key =
        request.headers.value('x-umi-device-id') ??
        request.headers.value('x-umi-installation-id') ??
        request.connectionInfo?.remoteAddress.address ??
        'unknown';
    unawaited(
      _store.recordClockOffset(
        key,
        DateTime.now().toUtc().difference(client.toUtc()).inMilliseconds,
      ),
    );
  }

  Future<Map<String, Object?>> _readObject(HttpRequest request) async {
    final bytes = await request.fold<List<int>>(<int>[], (buffer, chunk) {
      if (buffer.length + chunk.length > 1024 * 1024) {
        throw const _LanRefusal(
          'VALIDATION_FAILED',
          HttpStatus.requestEntityTooLarge,
        );
      }
      return buffer..addAll(chunk);
    });
    if (bytes.isEmpty) return const {};
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! Map<String, Object?>) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
    return decoded;
  }

  KitchenCommandRequest _parseCommand(Map<String, Object?> body) {
    try {
      final command = KitchenCommandRequest.fromJson(body);
      if (command.action != 'command') {
        throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
      }
      return KitchenCommandRequest(
        action: command.action,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        expectedVersion: command.expectedVersion,
        kitchenOrderId: command.kitchenOrderId,
        commandType: command.commandType,
        itemIds: command.itemIds ?? const [],
        reasonCode: command.reasonCode,
        reasonNote: command.reasonNote,
        priority: command.priority,
        courseNumber: command.courseNumber,
      );
    } on _LanRefusal {
      rethrow;
    } catch (_) {
      throw const _LanRefusal('VALIDATION_FAILED', HttpStatus.badRequest);
    }
  }

  Future<void> _json(
    HttpRequest request,
    int status,
    Map<String, Object?> body,
  ) async {
    request.response
      ..statusCode = status
      ..headers.contentType = ContentType.json
      ..headers.set('cache-control', 'no-store');
    request.response.write(jsonEncode(body));
    await request.response.close();
  }

  Future<void> _error(HttpRequest request, int status, String code) =>
      _json(request, status, {
        'error': {
          'code': code,
          'message': _message(code),
          'retryable': false,
          'correlationId': _uuid(),
        },
      });

  String _message(String code) => switch (code) {
    'DEVICE_REVOKED' => 'This device is not paired with the local station.',
    'AUTHENTICATION_REQUIRED' => 'Device credentials are required.',
    'VALIDATION_FAILED' => 'The local station refused the request body.',
    'OPTIMISTIC_VERSION_CONFLICT' => 'The kitchen ticket moved.',
    'RESOURCE_NOT_FOUND' => 'The local station does not have this resource.',
    _ => 'The local station could not complete the request.',
  };

  String _groupAccountKey(OfflineCommandGroupPayload group) {
    for (final key in group.aggregateKeys) {
      if (key.startsWith('account:')) return key;
    }
    final effect = group.effects.first;
    final provisional = effect['provisionalCartId'];
    return provisional is String
        ? 'account:$provisional'
        : 'group:${group.groupId}';
  }

  String _cartAccountKey(String commandId, Map<String, Object?> payload) {
    final cartId = payload['cartId'];
    return cartId is String ? 'account:$cartId' : 'command:$commandId';
  }

  String _tableAccountKey(String commandId, Map<String, Object?> request) {
    final tableId = request['tableId'];
    if (tableId is String) return 'table:$tableId';
    final tableIds = request['tableIds'];
    if (tableIds is List<Object?>) {
      final ids = tableIds.whereType<String>().toList()..sort();
      if (ids.isNotEmpty) return 'table:${ids.join(',')}';
    }
    return 'command:$commandId';
  }

  String _now() => DateTime.now().toUtc().toIso8601String();

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return _hexUuid(bytes);
  }

  String _uuidFrom(String seed) {
    final bytes = sha256.convert(utf8.encode(seed)).bytes.sublist(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return _hexUuid(bytes);
  }

  bool _isUuid(String value) => RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
    r'[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(value);

  String _hexUuid(List<int> bytes) {
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}

final class _LanPeer {
  const _LanPeer(this.value);
  final LocalNetworkDevice value;
  String get merchantId => value.merchantId;
  String get locationId => value.locationId;
  String get deviceId => value.deviceId;
}

final class _LanRefusal implements Exception {
  const _LanRefusal(this.code, this.status);
  final String code;
  final int status;
}
