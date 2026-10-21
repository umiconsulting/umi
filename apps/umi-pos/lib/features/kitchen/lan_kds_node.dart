import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:umi_contract/umi_contract.dart';

import '../../core/network/lan_discovery.dart';
import '../../core/network/lan_node_identity.dart';
import '../../core/storage/local_working_copy.dart';
import '../offline/offline_journal.dart';
import 'hub_command_forwarder.dart';
import 'lan_kds_store.dart';

/// The local API of the main station.
///
/// It serves the kitchen surface only. A peer is trusted by the hash of the
/// device credential it presents. Cloud validation pairs a new peer. After that,
/// the stored hash is enough while the cloud is unreachable.
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
  }) : _local = local,
       _journal = journal,
       _store = store,
       _identity = identity,
       _cloudBase = cloudBase,
       _resolveConflict = resolveConflict,
       _client = client ?? http.Client();

  final LocalWorkingCopy _local;
  final EncryptedOfflineJournal _journal;
  final LanKdsStore _store;
  final Future<LanNodeIdentity?> Function() _identity;
  final Uri _cloudBase;
  final Future<int> Function(String commandId)? _resolveConflict;
  final http.Client _client;
  final int port;

  HttpServer? _server;
  StreamSubscription<HttpRequest>? _requests;
  final StreamController<void> _changed = StreamController<void>.broadcast();
  final Map<String, DateTime> _validatedAt = {};
  final HubAccountSequencer _accountSequencer = HubAccountSequencer();
  DateTime? _cloudProbeAfter;
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
        'hub-command-key:${peer.deviceId}:$clientIdempotencyKey',
      ),
      commandType: commandType,
      originDeviceId: peer.deviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: _now(),
      payload: {
        ...rawPayload,
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
      final current = await _store.commandResult(
        peer.merchantId,
        peer.locationId,
        command.kitchenOrderId,
      );
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
    final result = await _store.applyCommand(
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
    final lastValidated = _validatedAt[deviceId];
    final validateNow =
        lastValidated == null ||
        DateTime.now().difference(lastValidated) > const Duration(seconds: 30);
    final cloudProbeAfter = _cloudProbeAfter;
    if (validateNow &&
        (cloudProbeAfter == null || DateTime.now().isAfter(cloudProbeAfter))) {
      try {
        final response = await _client
            .get(
              _cloudBase.resolve('/api/v1/devices/status'),
              headers: {
                'accept': 'application/json',
                'x-umi-device-id': deviceId,
                'x-umi-device-public-id': publicId,
                'x-umi-installation-id': installationId,
                'x-umi-device-credential': credential,
                'x-umi-merchant-id': ?headerMerchant,
                'x-umi-location-id': ?headerLocation,
              },
            )
            .timeout(const Duration(seconds: 2));
        if (response.statusCode >= 200 && response.statusCode < 300) {
          final device = DeviceSummary.fromJson(
            jsonDecode(response.body) as Map<String, Object?>,
          );
          if (device.state != 'active' ||
              device.locationId == null ||
              (merchantId != null && merchantId != device.merchantId) ||
              (locationId != null && locationId != device.locationId) ||
              (headerMerchant != null && headerMerchant != device.merchantId) ||
              (headerLocation != null && headerLocation != device.locationId)) {
            debugPrint(
              '[umipos] lan_peer_validation_mismatch '
              'state=${device.state} '
              'hasLocation=${device.locationId != null} '
              'merchantMismatch=${merchantId != null && merchantId != device.merchantId} '
              'locationMismatch=${locationId != null && locationId != device.locationId}',
            );
            if (known != null) {
              await _local.deleteNetworkDevice(
                known.merchantId,
                known.locationId,
                known.deviceId,
              );
            }
            throw const _LanRefusal('DEVICE_REVOKED', HttpStatus.forbidden);
          }
          final now = _now();
          final peer = LocalNetworkDevice(
            merchantId: device.merchantId,
            locationId: device.locationId!,
            deviceId: device.id,
            role: device.type,
            stationId: null,
            address: request.connectionInfo?.remoteAddress.address,
            port: request.connectionInfo?.remotePort,
            credentialHash: hash,
            pairedAt: known?.pairedAt ?? now,
            lastSeenAt: now,
            status: 'active',
          );
          await _local.writeNetworkDevice(peer);
          _validatedAt[deviceId] = DateTime.now();
          _cloudProbeAfter = null;
          return _LanPeer(peer);
        }
        if (response.statusCode < 500) {
          debugPrint(
            '[umipos] lan_peer_validation_refused '
            'status=${response.statusCode}',
          );
          if (known != null) {
            await _local.deleteNetworkDevice(
              known.merchantId,
              known.locationId,
              known.deviceId,
            );
          }
          throw const _LanRefusal('DEVICE_REVOKED', HttpStatus.forbidden);
        }
      } on _LanRefusal {
        rethrow;
      } catch (error) {
        debugPrint(
          '[umipos] lan_peer_validation_unavailable '
          'type=${error.runtimeType}',
        );
        // No cloud answer. A stored credential hash is the only offline trust.
        _cloudProbeAfter = DateTime.now().add(const Duration(seconds: 30));
      }
    }
    if (known == null ||
        known.credentialHash != hash ||
        known.status != 'active') {
      debugPrint(
        '[umipos] lan_peer_trust_missing '
        'known=${known != null} '
        'hashMatch=${known?.credentialHash == hash} '
        'status=${known?.status}',
      );
      throw const _LanRefusal('DEVICE_REVOKED', HttpStatus.forbidden);
    }
    final seen = known.seen(
      address: request.connectionInfo?.remoteAddress.address,
      port: request.connectionInfo?.remotePort,
    );
    await _local.writeNetworkDevice(seen);
    return _LanPeer(seen);
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
