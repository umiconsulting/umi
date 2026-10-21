import 'dart:async';
import 'dart:io';

import '../../core/network/lan_discovery.dart';
import '../../core/platform/multicast_lock.dart';

/// Announces the main station as `_umi-pos._tcp.local`.
///
/// `multicast_dns` provides the discovery side only, so this small responder
/// sends the three records a peer needs: PTR, SRV and A. The configured hub URL
/// remains the fallback if multicast is blocked.
final class LanMdnsAdvertiser {
  LanMdnsAdvertiser({
    this.instance = 'umi-main',
    this.port = lanNodePort,
    this.interval = const Duration(seconds: 10),
  });

  final String instance;
  final int port;
  final Duration interval;

  RawDatagramSocket? _socket;
  Timer? _timer;
  InternetAddress? _address;
  bool _unavailable = false;
  bool _multicastLock = false;

  Future<void> start() async {
    if (_socket != null || _unavailable) return;
    try {
      _multicastLock = await acquireMulticastLock();
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLoopback: false,
        includeLinkLocal: false,
      );
      NetworkInterface? selected;
      for (final interface in interfaces) {
        if (interface.addresses.any(
          (address) => !address.isLoopback && !address.isLinkLocal,
        )) {
          selected = interface;
          break;
        }
      }
      if (selected == null) {
        _unavailable = true;
        await stop();
        return;
      }
      _address = selected.addresses.firstWhere(
        (address) => !address.isLoopback && !address.isLinkLocal,
      );
      final socket = await RawDatagramSocket.bind(
        _address!,
        5353,
        reuseAddress: true,
        reusePort: false,
        ttl: 255,
      );
      _socket = socket;
      try {
        socket.joinMulticast(InternetAddress('224.0.0.251'), selected);
      } catch (_) {
        // The lock and bound Wi-Fi address still let unsolicited announcements
        // leave the station.
      }
      socket.listen((event) {
        if (event != RawSocketEvent.read) return;
        final datagram = socket.receive();
        if (datagram == null) return;
        final queryId = _relevantQueryId(datagram.data);
        if (queryId == null) return;
        _announce(
          id: queryId,
          target: datagram.address,
          targetPort: datagram.port,
        );
      });
      if (_address == null) {
        await stop();
        _unavailable = true;
        return;
      }
      _announce();
      _timer = Timer.periodic(interval, (_) => _announce());
    } catch (_) {
      _unavailable = true;
      await stop();
    }
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    _socket?.close();
    _socket = null;
    final lock = _multicastLock;
    _multicastLock = false;
    await releaseMulticastLock(lock);
  }

  void _announce({int id = 0, InternetAddress? target, int targetPort = 5353}) {
    final socket = _socket;
    final address = _address;
    if (socket == null || address == null) return;
    final service = lanKdsServiceType;
    final fullName = '$instance.$service';
    final host = '$instance.local';
    final packet = _packet(id, [
      _record(service, 12, _name(fullName)),
      _srvRecord(fullName, host),
      _record(fullName, 16, const [0]),
      _addressRecord(host, address),
    ]);
    socket.send(packet, target ?? InternetAddress('224.0.0.251'), targetPort);
  }

  int? _relevantQueryId(List<int> packet) {
    if (packet.length < 12 || (packet[2] & 0x80) != 0) return null;
    final id = (packet[0] << 8) | packet[1];
    final questions = (packet[4] << 8) | packet[5];
    var offset = 12;
    for (var question = 0; question < questions; question++) {
      final labels = <String>[];
      while (offset < packet.length) {
        final length = packet[offset++];
        if (length == 0) break;
        if (length > packet.length - offset) return null;
        labels.add(
          String.fromCharCodes(packet.sublist(offset, offset + length)),
        );
        offset += length;
      }
      if (offset + 4 > packet.length) return null;
      final name = labels.join('.').toLowerCase();
      offset += 4;
      if (name == lanKdsServiceType ||
          name == '$instance.$lanKdsServiceType'.toLowerCase() ||
          name == '$instance.local') {
        return id;
      }
    }
    return null;
  }

  List<int> _srvRecord(String name, String target) {
    final data = <int>[
      0,
      0,
      0,
      0,
      (port >> 8) & 0xff,
      port & 0xff,
      ..._name(target),
    ];
    return _record(name, 33, data);
  }

  List<int> _addressRecord(String name, InternetAddress address) =>
      _record(name, 1, address.rawAddress);

  List<int> _record(String name, int type, List<int> data) => [
    ..._name(name),
    (type >> 8) & 0xff,
    type & 0xff,
    0,
    1,
    0,
    0,
    0,
    120,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
    ...data,
  ];

  List<int> _name(String value) => [
    for (final label in value.split('.'))
      if (label.isNotEmpty) ...[label.length, ...label.codeUnits],
    0,
  ];

  List<int> _packet(int id, List<List<int>> records) => [
    (id >> 8) & 0xff,
    id & 0xff,
    0x84,
    0,
    0,
    0,
    0,
    records.length,
    0,
    0,
    0,
    0,
    for (final record in records) ...record,
  ];
}
