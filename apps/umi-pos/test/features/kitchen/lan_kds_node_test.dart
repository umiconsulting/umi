import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/network/lan_node_identity.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/kitchen/lan_kds_node.dart';
import 'package:umi_pos/features/kitchen/lan_kds_store.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _host = '00000000-0000-4000-8000-000000000003';
const _peer = '00000000-0000-4000-8000-000000000004';
const _session = '00000000-0000-4000-8000-000000000005';
const _ticket = '00000000-0000-4000-8000-000000000006';
const _item = '00000000-0000-4000-8000-000000000007';
const _command = '00000000-0000-4000-8000-000000000008';
const _idempotency = '00000000-0000-4000-8000-000000000009';
const _correlation = '00000000-0000-4000-8000-000000000010';
const _credential = 'paired-device-credential-value';

void main() {
  test(
    'a paired KDS is served, a stranger is refused, and a bump is durable',
    () async {
      final local = _MemoryLocal();
      final store = LanKdsStore(local);
      await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
      await local.writeNetworkDevice(
        LocalNetworkDevice(
          merchantId: _merchant,
          locationId: _location,
          deviceId: _peer,
          role: 'kds',
          stationId: null,
          address: null,
          port: null,
          credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
          pairedAt: DateTime.now().toUtc().toIso8601String(),
          lastSeenAt: DateTime.now().toUtc().toIso8601String(),
          status: 'active',
        ),
      );
      final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
      final node = LanKdsNode(
        local: local,
        journal: journal,
        store: store,
        identity: () async => const LanNodeIdentity(
          merchantId: _merchant,
          locationId: _location,
          operatorSessionId: _session,
          deviceId: _host,
          credentialVersion: 1,
        ),
        cloudBase: Uri.parse('https://cloud.example.test'),
        port: 0,
        client: MockClient(
          (_) async => http.Response('{"error":"unavailable"}', 503),
        ),
      );
      final bound = await node.start();
      final base = Uri.parse('http://127.0.0.1:${bound.port}');
      addTearDown(node.stop);

      final board = await http.post(
        base.resolve('/api/kds/board'),
        headers: _headers(),
        body: jsonEncode({'action': 'snapshot'}),
      );
      expect(board.statusCode, 200);
      expect(
        (jsonDecode(board.body) as Map<String, Object?>)['data'],
        hasLength(1),
      );

      final stranger = await http.post(
        base.resolve('/api/kds/board'),
        headers: _headers(credential: 'wrong-credential'),
        body: jsonEncode({'action': 'snapshot'}),
      );
      expect(stranger.statusCode, 403);

      final command = KitchenCommandRequest(
        action: 'command',
        commandId: _command,
        idempotencyKey: _idempotency,
        correlationId: _correlation,
        expectedVersion: 1,
        kitchenOrderId: _ticket,
        commandType: 'mark_item_ready',
        itemIds: const [_item],
      );
      final bumped = await http.post(
        base.resolve('/api/kds/command'),
        headers: _headers(),
        body: jsonEncode(command.toJson()),
      );
      expect(bumped.statusCode, 200);
      expect(
        (jsonDecode(bumped.body) as Map<String, Object?>)['data'],
        containsPair('status', 'ready'),
      );
      expect((await journal.load()).entries, hasLength(1));
      expect(
        (await journal.load()).entries.single.command.commandType,
        'pos.kds.command',
      );

      final duplicate = await http.post(
        base.resolve('/api/kds/command'),
        headers: _headers(),
        body: jsonEncode(command.toJson()),
      );
      expect(duplicate.statusCode, 200);
      expect((await journal.load()).entries, hasLength(1));
      expect((await store.snapshot(_merchant, _location)).single['version'], 2);

      final health = await http.get(
        base.resolve('/health/live'),
        headers: {
          'x-umi-device-id': _peer,
          'x-umi-client-time': DateTime.now()
              .toUtc()
              .subtract(const Duration(seconds: 2))
              .toIso8601String(),
        },
      );
      expect(health.statusCode, 200);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(
        await local.readDocument('lan_clock', 'hub', _peer),
        containsPair('offsetMilliseconds', greaterThan(1000)),
      );
    },
  );

  test(
    'an unpaired valid device id is refused while the cloud is absent',
    () async {
      final local = _MemoryLocal();
      final store = LanKdsStore(local);
      await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
      final node = LanKdsNode(
        local: local,
        journal: EncryptedOfflineJournal(_MemoryCipherStore(), web: false),
        store: store,
        identity: () async => const LanNodeIdentity(
          merchantId: _merchant,
          locationId: _location,
          operatorSessionId: _session,
          deviceId: _host,
          credentialVersion: 1,
        ),
        cloudBase: Uri.parse('https://cloud.example.test'),
        port: 0,
        client: MockClient((_) async => http.Response('{}', 503)),
      );
      final bound = await node.start();
      addTearDown(node.stop);
      final response = await http.post(
        Uri.parse('http://127.0.0.1:${bound.port}/api/kds/board'),
        headers: _headers(),
        body: jsonEncode({'action': 'snapshot'}),
      );
      expect(response.statusCode, 403);
    },
  );

  test(
    'the first contact pairs a device through the cloud status route',
    () async {
      final local = _MemoryLocal();
      final store = LanKdsStore(local);
      await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
      final node = LanKdsNode(
        local: local,
        journal: EncryptedOfflineJournal(_MemoryCipherStore(), web: false),
        store: store,
        identity: () async => const LanNodeIdentity(
          merchantId: _merchant,
          locationId: _location,
          operatorSessionId: _session,
          deviceId: _host,
          credentialVersion: 1,
        ),
        cloudBase: Uri.parse('https://cloud.example.test'),
        port: 0,
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'id': _peer,
              'publicId': _peer,
              'merchantId': _merchant,
              'locationId': _location,
              'displayName': 'KDS Cocina',
              'type': 'kds',
              'platform': 'android',
              'mobility': 'static',
              'state': 'active',
              'credentialVersion': 1,
              'lastSeenAt': null,
              'rotationRequired': false,
              'revokedAt': null,
              'replacementDeviceId': null,
            }),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );
      final bound = await node.start();
      addTearDown(node.stop);
      final response = await http.post(
        Uri.parse('http://127.0.0.1:${bound.port}/api/kds/board'),
        headers: _headers(),
        body: jsonEncode({'action': 'snapshot'}),
      );
      expect(response.statusCode, 200);
      final paired = await local.readNetworkDevice(_merchant, _location, _peer);
      expect(paired?.role, 'kds');
      expect(
        paired?.credentialHash,
        sha256.convert(utf8.encode(_credential)).toString(),
      );
    },
  );

  test('a cart fired offline appears as a local kitchen ticket', () async {
    final local = _MemoryLocal();
    local.firedCarts = [
      Cart(
        id: '00000000-0000-4000-8000-000000000020',
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        status: 'draft',
        accountName: 'Mesa 3',
        version: 2,
        firedOrderId: null,
        fulfillmentType: 'dine_in',
        items: [
          {
            'id': '00000000-0000-4000-8000-000000000021',
            'productId': '00000000-0000-4000-8000-000000000022',
            'productName': 'Cappuccino',
            'saleAction': 'merchandise',
            'quantity': 1,
            'courseNumber': 1,
            'variant': null,
            'modifiers': <Object?>[],
            'note': null,
            'fired': true,
            'price': {
              'unitPrice': {'minorUnits': 6000, 'currency': 'MXN'},
              'lineSubtotal': {'minorUnits': 6000, 'currency': 'MXN'},
              'tax': {'minorUnits': 828, 'currency': 'MXN'},
              'lineTotal': {'minorUnits': 6000, 'currency': 'MXN'},
              'taxRateBasisPoints': 1600,
            },
          },
        ],
        totals: {
          'subtotal': {'minorUnits': 6000, 'currency': 'MXN'},
          'tax': {'minorUnits': 828, 'currency': 'MXN'},
          'discounts': {
            'total': {'minorUnits': 0, 'currency': 'MXN'},
            'entries': <Object?>[],
          },
          'grandTotal': {'minorUnits': 6000, 'currency': 'MXN'},
          'businessDate': '2026-10-17',
        },
        checkoutEnabled: false,
        checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
        updatedAt: '2026-10-17T19:00:00.000Z',
      ),
    ];
    final store = LanKdsStore(local);
    final tickets = await store.snapshot(_merchant, _location);
    expect(tickets, hasLength(1));
    expect(tickets.single['publicReference'], 'Mesa 3');
    expect(
      (tickets.single['items'] as List<Object?>).single,
      containsPair('productName', 'Cappuccino'),
    );
    expect(
      await store.itemOrderFor(
        _merchant,
        _location,
        '00000000-0000-4000-8000-000000000020',
        const ['00000000-0000-4000-8000-000000000021'],
      ),
      {'00000000-0000-4000-8000-000000000021': 0},
    );
    final started = await store.applyCommand(
      _merchant,
      _location,
      KitchenCommandRequest(
        action: 'command',
        commandId: '00000000-0000-4000-8000-000000000023',
        idempotencyKey: '00000000-0000-4000-8000-000000000024',
        correlationId: '00000000-0000-4000-8000-000000000025',
        expectedVersion: 1,
        kitchenOrderId: '00000000-0000-4000-8000-000000000020',
        commandType: 'start_preparation',
        itemIds: const ['00000000-0000-4000-8000-000000000021'],
      ),
    );
    expect(started['status'], 'in_preparation');
    final afterStart = await store.snapshot(_merchant, _location);
    expect(afterStart, hasLength(1));
    expect(afterStart.single['status'], 'in_preparation');
    expect(
      KitchenOrderProjection.fromJson(afterStart.single).status,
      'in_preparation',
    );
  });

  test(
    'a cloud refresh removes a ticket completed on another terminal',
    () async {
      final local = _MemoryLocal();
      final store = LanKdsStore(local);
      await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
      await store.applyCommand(
        _merchant,
        _location,
        KitchenCommandRequest(
          action: 'command',
          commandId: _command,
          idempotencyKey: _idempotency,
          correlationId: _correlation,
          expectedVersion: 1,
          kitchenOrderId: _ticket,
          commandType: 'mark_item_ready',
          itemIds: const [_item],
        ),
      );

      expect(await store.snapshot(_merchant, _location), hasLength(1));

      // The other terminal completed the order, so it is absent from the
      // authoritative board. The local READY overlay must not resurrect it.
      await store.saveCloudBoard(_merchant, _location, const []);

      expect(await store.snapshot(_merchant, _location), isEmpty);
    },
  );

  test('a locally fired ticket leads the cached server board', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
    local.firedCarts = [
      Cart(
        id: '00000000-0000-4000-8000-000000000030',
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        status: 'draft',
        version: 1,
        firedOrderId: null,
        fulfillmentType: 'takeout',
        items: [
          {
            'id': '00000000-0000-4000-8000-000000000031',
            'productId': '00000000-0000-4000-8000-000000000032',
            'productName': 'Americano',
            'saleAction': 'merchandise',
            'quantity': 1,
            'courseNumber': 1,
            'variant': null,
            'modifiers': <Object?>[],
            'note': null,
            'fired': true,
            'price': {
              'unitPrice': {'minorUnits': 5000, 'currency': 'MXN'},
              'lineSubtotal': {'minorUnits': 5000, 'currency': 'MXN'},
              'tax': {'minorUnits': 690, 'currency': 'MXN'},
              'lineTotal': {'minorUnits': 5000, 'currency': 'MXN'},
              'taxRateBasisPoints': 1600,
            },
          },
        ],
        totals: {
          'subtotal': {'minorUnits': 5000, 'currency': 'MXN'},
          'tax': {'minorUnits': 690, 'currency': 'MXN'},
          'discounts': {
            'total': {'minorUnits': 0, 'currency': 'MXN'},
            'entries': <Object?>[],
          },
          'grandTotal': {'minorUnits': 5000, 'currency': 'MXN'},
          'businessDate': '2026-10-18',
        },
        checkoutEnabled: false,
        checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
        updatedAt: '2026-10-18T00:20:00.000Z',
      ),
    ];

    final tickets = await store.snapshot(_merchant, _location);

    expect(tickets, hasLength(2));
    expect(tickets.first['sourceOrderId'], local.firedCarts.single.id);
    expect(tickets.first['source'], 'pos');
  });

  test('the hub advances its own replay cursor for a cook command', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await store.saveCloudBoard(_merchant, _location, [_ticketMap()]);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'kds',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const cookSession = '00000000-0000-4000-8000-000000000019';
    final request = PosKitchenCommandRequest(
      action: 'command',
      commandId: '00000000-0000-4000-8000-000000000018',
      idempotencyKey: '00000000-0000-4000-8000-000000000017',
      correlationId: '00000000-0000-4000-8000-000000000016',
      expectedVersion: 1,
      kitchenOrderId: _ticket,
      commandType: 'start_preparation',
      itemIds: const [_item],
      locationId: _location,
      operatorSessionId: cookSession,
    );
    final response = await http.post(
      Uri.parse(
        'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
        '$_merchant/kitchen/command',
      ),
      headers: _headers(),
      body: jsonEncode(request.toJson()),
    );
    expect(response.statusCode, 200);
    final command = (await journal.load()).entries.single.command;
    expect(command.operatorSessionId, _session);
    expect(command.payload['operatorSessionId'], cookSession);
    expect(command.payload['actorDeviceId'], _peer);
  });

  test('a peer account group enters the hub outbox once', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'pos_terminal',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const groupId = '00000000-0000-4000-8000-000000000031';
    const accountId = '00000000-0000-4000-8000-000000000032';
    const tableId = '00000000-0000-4000-8000-000000000033';
    const peerSession = '00000000-0000-4000-8000-000000000034';
    final body = {
      'groupId': groupId,
      'aggregateKeys': ['account:$accountId', 'table:$tableId'],
      'effects': [
        {
          'type': 'open_table_account',
          'provisionalCartId': accountId,
          'tableId': tableId,
          'partySize': 2,
        },
      ],
    };
    final headers = {..._headers(), 'x-umi-operator-session-id': peerSession};
    final uri = Uri.parse(
      'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
      '$_merchant/lan/command-group',
    );

    final first = await http.post(
      uri,
      headers: headers,
      body: jsonEncode(body),
    );
    expect(first.statusCode, 200);
    final firstData = (jsonDecode(first.body) as Map<String, Object?>)['data']!;
    expect(firstData, containsPair('queued', true));
    expect(firstData, containsPair('duplicate', false));
    expect(firstData, containsPair('deviceSequence', 1));

    final snapshot = await journal.load();
    expect(snapshot.entries, hasLength(1));
    final command = snapshot.entries.single.command;
    expect(command.commandType, 'pos.command.group');
    expect(command.deviceId, _host);
    expect(command.operatorSessionId, _session);
    expect(command.idempotencyKey, groupId);
    expect(command.payload['originDeviceId'], _peer);
    expect(command.payload['originOperatorSessionId'], peerSession);

    final duplicate = await http.post(
      uri,
      headers: headers,
      body: jsonEncode(body),
    );
    expect(duplicate.statusCode, 200);
    expect(
      (jsonDecode(duplicate.body) as Map<String, Object?>)['data'],
      containsPair('duplicate', true),
    );
    expect((await journal.load()).entries, hasLength(1));

    final status = await http.get(
      uri.resolve('${uri.path}/$groupId'),
      headers: headers,
    );
    expect(status.statusCode, 200);
    expect(
      (jsonDecode(status.body) as Map<String, Object?>)['data'],
      containsPair('status', 'pending'),
    );
  });

  test('a peer cart command becomes host-owned and keeps its origin', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'pos_terminal',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const clientCommand = '00000000-0000-4000-8000-000000000041';
    const clientKey = '00000000-0000-4000-8000-000000000042';
    const peerSession = '00000000-0000-4000-8000-000000000043';
    const cartId = '00000000-0000-4000-8000-000000000044';
    const lineId = '00000000-0000-4000-8000-000000000045';
    final response = await http.post(
      Uri.parse(
        'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
        '$_merchant/lan/cart-command',
      ),
      headers: {..._headers(), 'x-umi-operator-session-id': peerSession},
      body: jsonEncode({
        'commandId': clientCommand,
        'idempotencyKey': clientKey,
        'commandType': 'pos.cart.line.add',
        'payload': {
          'cartId': cartId,
          'locationId': _location,
          'operatorSessionId': peerSession,
          'productId': _item,
          'variantId': null,
          'modifierSelections': <Object?>[],
          'quantity': 1,
          'courseNumber': 1,
          'note': null,
          'clientLineId': lineId,
          'expectedVersion': 1,
          'idempotencyKey': clientKey,
        },
      }),
    );

    expect(response.statusCode, 200);
    final command = (await journal.load()).entries.single.command;
    expect(command.commandType, 'pos.cart.line.add');
    expect(command.deviceId, _host);
    expect(command.operatorSessionId, _session);
    expect(command.originDeviceId, _peer);
    expect(command.originOperatorSessionId, peerSession);
    expect(command.payload['operatorSessionId'], _session);
    expect(command.payload['cartId'], cartId);
    expect(command.payload['clientLineId'], lineId);

    final statusUri = Uri.parse(
      'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
      '$_merchant/lan/cart-command/$clientCommand',
    );
    final pending = await http.get(
      statusUri,
      headers: {..._headers(), 'x-umi-operator-session-id': peerSession},
    );
    expect(pending.statusCode, 200);
    expect(
      (jsonDecode(pending.body) as Map<String, Object?>)['data'],
      containsPair('status', 'pending'),
    );

    const officialCart = '00000000-0000-4000-8000-000000000046';
    await journal.apply(
      ReplayResult(
        commandId: command.commandId,
        deviceSequence: command.deviceSequence,
        status: 'accepted',
        officialId: officialCart,
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      ),
    );
    final accepted = await http.get(
      statusUri,
      headers: {..._headers(), 'x-umi-operator-session-id': peerSession},
    );
    expect(
      (jsonDecode(accepted.body) as Map<String, Object?>)['data'],
      allOf(
        containsPair('status', 'accepted'),
        containsPair('officialId', officialCart),
      ),
    );
  });

  test('a peer table move enters the hub outbox', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'pos_terminal',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const clientCommand = '00000000-0000-4000-8000-000000000047';
    const peerSession = '00000000-0000-4000-8000-000000000048';
    const cartId = '00000000-0000-4000-8000-000000000049';
    const tableId = '00000000-0000-4000-8000-000000000050';
    final response = await http.post(
      Uri.parse(
        'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
        '$_merchant/lan/cart-command',
      ),
      headers: {..._headers(), 'x-umi-operator-session-id': peerSession},
      body: jsonEncode({
        'commandId': clientCommand,
        'idempotencyKey': clientCommand,
        'commandType': 'pos.cart.table.set',
        'payload': {
          'cartId': cartId,
          'locationId': _location,
          'operatorSessionId': peerSession,
          'tableId': tableId,
          'partySize': 2,
          'expectedVersion': 1,
          'idempotencyKey': clientCommand,
        },
      }),
    );

    expect(response.statusCode, 200);
    final command = (await journal.load()).entries.single.command;
    expect(command.commandType, 'pos.cart.table.set');
    expect(command.payload['tableId'], tableId);
    expect(command.payload['operatorSessionId'], _session);
    expect(command.originOperatorSessionId, peerSession);
  });

  test('a peer table-state command enters the hub outbox', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'pos_terminal',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const clientCommand = '00000000-0000-4000-8000-000000000057';
    const peerSession = '00000000-0000-4000-8000-000000000058';
    const tableId = '00000000-0000-4000-8000-000000000059';
    final response = await http.post(
      Uri.parse(
        'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
        '$_merchant/lan/table-command',
      ),
      headers: {..._headers(), 'x-umi-operator-session-id': peerSession},
      body: jsonEncode({
        'commandId': clientCommand,
        'idempotencyKey': clientCommand,
        'action': 'ordered',
        'request': {
          'locationId': _location,
          'operatorSessionId': peerSession,
          'idempotencyKey': clientCommand,
          'tableId': tableId,
        },
      }),
    );

    expect(response.statusCode, 200);
    final command = (await journal.load()).entries.single.command;
    expect(command.commandType, 'pos.table.command');
    expect(command.payload['action'], 'ordered');
    expect(
      (command.payload['request'] as Map<String, Object?>)['tableId'],
      tableId,
    );
    expect(
      (command.payload['request'] as Map<String, Object?>)['operatorSessionId'],
      _session,
    );
  });

  test('a peer conflict resolves through the host and keeps history', () async {
    final local = _MemoryLocal();
    final store = LanKdsStore(local);
    await local.writeNetworkDevice(
      LocalNetworkDevice(
        merchantId: _merchant,
        locationId: _location,
        deviceId: _peer,
        role: 'pos_terminal',
        stationId: null,
        address: null,
        port: null,
        credentialHash: sha256.convert(utf8.encode(_credential)).toString(),
        pairedAt: DateTime.now().toUtc().toIso8601String(),
        lastSeenAt: DateTime.now().toUtc().toIso8601String(),
        status: 'active',
      ),
    );
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    String? resolvedId;
    final node = LanKdsNode(
      local: local,
      journal: journal,
      store: store,
      identity: () async => const LanNodeIdentity(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _session,
        deviceId: _host,
        credentialVersion: 1,
      ),
      cloudBase: Uri.parse('https://cloud.example.test'),
      resolveConflict: (commandId) async {
        resolvedId = commandId;
        return journal.resolveConflictAndRetryFollowing(commandId);
      },
      port: 0,
      client: MockClient((_) async => http.Response('{}', 503)),
    );
    final bound = await node.start();
    addTearDown(node.stop);
    const groupId = '00000000-0000-4000-8000-000000000051';
    const accountId = '00000000-0000-4000-8000-000000000052';
    const tableId = '00000000-0000-4000-8000-000000000053';
    const peerSession = '00000000-0000-4000-8000-000000000054';
    final base = Uri.parse(
      'http://127.0.0.1:${bound.port}/api/v1/pos/merchants/'
      '$_merchant/lan/command-group',
    );
    final headers = {..._headers(), 'x-umi-operator-session-id': peerSession};
    await http.post(
      base,
      headers: headers,
      body: jsonEncode({
        'groupId': groupId,
        'aggregateKeys': ['account:$accountId', 'table:$tableId'],
        'effects': [
          {
            'type': 'open_table_account',
            'provisionalCartId': accountId,
            'tableId': tableId,
            'partySize': 2,
          },
        ],
      }),
    );
    final command = (await journal.load()).entries.single.command;
    await journal.append(
      commandId: '00000000-0000-4000-8000-000000000055',
      deviceId: _host,
      credentialVersion: 1,
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _session,
      idempotencyKey: '00000000-0000-4000-8000-000000000056',
      commandType: 'pos.cart.line.add',
      payload: const {'cartId': accountId},
    );
    await journal.apply(
      ReplayResult(
        commandId: command.commandId,
        deviceSequence: command.deviceSequence,
        status: 'conflict',
        officialId: null,
        officialCommit: null,
        serverConflictReference: _command,
        failure: const {
          'classification': 'table_unavailable',
          'retryable': false,
          'blocksFollowing': false,
          'operatorActionRequired': true,
          'managerActionRequired': false,
          'guidanceCode': 'table_unavailable',
          'correlationId': _command,
        },
      ),
    );
    await journal.apply(
      ReplayResult(
        commandId: '00000000-0000-4000-8000-000000000055',
        deviceSequence: 2,
        status: 'conflict',
        officialId: null,
        officialCommit: null,
        serverConflictReference: _command,
        failure: const {
          'classification': 'stream_blocked',
          'retryable': true,
          'blocksFollowing': false,
          'operatorActionRequired': true,
          'managerActionRequired': false,
          'guidanceCode': 'stream_blocked',
          'correlationId': _command,
        },
      ),
    );

    final response = await http.post(
      base.resolve('${base.path}/$groupId/resolve'),
      headers: headers,
      body: jsonEncode({'resolution': 'discard_refused'}),
    );

    expect(response.statusCode, 200);
    expect(
      (jsonDecode(response.body) as Map<String, Object?>)['data'],
      allOf(containsPair('resolved', true), containsPair('status', 'resolved')),
    );
    expect(resolvedId, command.commandId);
    final retained = await journal.load();
    expect(retained.entries.first.status, JournalStatus.resolved);
    expect(
      retained.entries.first.failure?['classification'],
      'table_unavailable',
    );
    expect(retained.entries.last.status, JournalStatus.pending);
  });
}

Map<String, String> _headers({String credential = _credential}) => {
  'content-type': 'application/json',
  'x-umi-device-id': _peer,
  'x-umi-device-public-id': _peer,
  'x-umi-installation-id': '00000000-0000-4000-8000-000000000011',
  'x-umi-device-credential': credential,
  'x-umi-merchant-id': _merchant,
  'x-umi-location-id': _location,
  'x-umi-client-time': DateTime.now().toUtc().toIso8601String(),
};

Map<String, Object?> _ticketMap() => {
  'id': _ticket,
  'sourceOrderId': '00000000-0000-4000-8000-000000000012',
  'publicReference': 'Mesa 2',
  'merchantId': _merchant,
  'locationId': _location,
  'stationId': '00000000-0000-4000-8000-000000000013',
  'source': 'pos',
  'status': 'queued',
  'priority': 'normal',
  'businessDate': '2026-10-17',
  'queuedAt': '2026-10-17T18:00:00.000Z',
  'preparationStartedAt': null,
  'updatedAt': '2026-10-17T18:00:00.000Z',
  'version': 1,
  'lastEventSequence': 0,
  'firedThroughCourse': 1,
  'items': [
    {
      'id': _item,
      'status': 'queued',
      'productName': 'Cappuccino',
      'variantName': null,
      'allergens': <Object?>[],
      'modifiers': <Object?>[],
      'quantity': 1,
      'preparationNote': null,
      'displayOrder': 0,
      'targetSeconds': null,
      'courseNumber': 1,
      'fired': true,
      'version': 1,
    },
  ],
};

final class _MemoryCipherStore implements JournalCipherStore {
  String? ciphertext;
  String? key;

  @override
  Future<String?> readCiphertext() async => ciphertext;

  @override
  Future<String?> readKey() async => key;

  @override
  Future<void> writeCiphertext(String value) async => ciphertext = value;

  @override
  Future<void> writeKey(String value) async => key = value;
}

final class _MemoryLocal implements LocalWorkingCopy {
  final _documents = <String, Map<String, Object?>>{};
  final _devices = <String, LocalNetworkDevice>{};
  List<Cart> firedCarts = const [];

  String _key(String namespace, String scope, String id) =>
      '$namespace|$scope|$id';

  @override
  Future<Map<String, Object?>?> readDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async => _documents[_key(namespace, scopeKey, id)];

  @override
  Future<void> writeDocument({
    required String namespace,
    required String scopeKey,
    required String id,
    required Map<String, Object?> payload,
    String syncState = 'synced',
  }) async {
    _documents[_key(namespace, scopeKey, id)] = payload;
  }

  @override
  Future<List<LocalDocument>> readDocuments(
    String namespace,
    String scopeKey,
  ) async => [
    for (final entry in _documents.entries)
      if (entry.key.startsWith('$namespace|$scopeKey|'))
        LocalDocument(
          id: entry.key.split('|').last,
          payload: entry.value,
          updatedAt: DateTime.now().toUtc().toIso8601String(),
          syncState: 'synced',
        ),
  ];

  @override
  Future<void> deleteDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    _documents.remove(_key(namespace, scopeKey, id));
  }

  @override
  Future<LocalNetworkDevice?> readNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  ) async => _devices['$merchantId|$locationId|$deviceId'];

  @override
  Future<List<LocalNetworkDevice>> readNetworkDevices(
    String merchantId,
    String locationId,
  ) async => _devices.values
      .where(
        (device) =>
            device.merchantId == merchantId && device.locationId == locationId,
      )
      .toList();

  @override
  Future<void> writeNetworkDevice(LocalNetworkDevice device) async {
    _devices['${device.merchantId}|${device.locationId}|${device.deviceId}'] =
        device;
  }

  @override
  Future<void> deleteNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  ) async {
    _devices.remove('$merchantId|$locationId|$deviceId');
  }

  @override
  Future<List<Cart>> readFiredCarts(
    String merchantId,
    String locationId,
  ) async => firedCarts;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
