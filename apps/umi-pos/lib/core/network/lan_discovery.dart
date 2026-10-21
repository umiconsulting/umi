import 'dart:async';
import 'dart:io';

import 'package:multicast_dns/multicast_dns.dart';

import '../platform/multicast_lock.dart';

/// The main station's local node, found without a cloud lookup.
abstract interface class LanHubResolver {
  Future<Uri?> resolve();
}

final class FixedLanHubResolver implements LanHubResolver {
  const FixedLanHubResolver(this.uri);

  final Uri uri;

  @override
  Future<Uri?> resolve() async => uri;
}

/// One name for every café node on the service Wi-Fi.
const lanKdsServiceType = '_umi-pos._tcp.local';
const lanNodePort = 4244;

/// Finds the node by DNS-SD and falls back to the address in the build.
///
/// The fallback is essential: a router reboot can drop multicast while the
/// reserved address still works. Discovery is therefore an improvement to the
/// route, never a new prerequisite for starting a shift.
final class MdnsLanHubResolver implements LanHubResolver {
  MdnsLanHubResolver({
    this.fallback,
    this.timeout = const Duration(seconds: 2),
    this.cacheFor = const Duration(seconds: 20),
    MDnsClient Function()? clientFactory,
  }) : _clientFactory = clientFactory ?? _androidSafeClient;

  final Uri? fallback;
  final Duration timeout;
  final Duration cacheFor;
  final MDnsClient Function() _clientFactory;

  Uri? _cached;
  DateTime? _cachedAt;
  Future<Uri?>? _inFlight;

  @override
  Future<Uri?> resolve() {
    final cached = _cached;
    final at = _cachedAt;
    if (cached != null &&
        at != null &&
        DateTime.now().difference(at) < cacheFor) {
      return Future.value(cached);
    }
    return _inFlight ??= _discover().whenComplete(() => _inFlight = null);
  }

  Future<Uri?> _discover() async {
    MDnsClient? client;
    final lock = await acquireMulticastLock();
    try {
      client = _clientFactory();
      await client
          .start(onError: (_) {}, interfacesFactory: _lanInterfaces)
          .timeout(timeout);
      final pointer = await client
          .lookup<PtrResourceRecord>(
            ResourceRecordQuery.serverPointer(lanKdsServiceType),
          )
          .first
          .timeout(timeout);
      final service = await client
          .lookup<SrvResourceRecord>(
            ResourceRecordQuery.service(pointer.domainName),
          )
          .first
          .timeout(timeout);
      final address = await client
          .lookup<IPAddressResourceRecord>(
            ResourceRecordQuery.addressIPv4(service.target),
          )
          .first
          .timeout(timeout);
      final resolved = Uri(
        scheme: 'http',
        host: address.address.address,
        port: service.port,
      );
      _cached = resolved;
      _cachedAt = DateTime.now();
      return resolved;
    } catch (_) {
      return fallback;
    } finally {
      client?.stop();
      await releaseMulticastLock(lock);
    }
  }
}

MDnsClient _androidSafeClient() => MDnsClient(
  rawDatagramSocketFactory:
      (host, port, {reuseAddress = false, reusePort = false, ttl = 1}) =>
          RawDatagramSocket.bind(
            host,
            port,
            reuseAddress: reuseAddress,
            // Android rejects reusePort. The peer only needs one mDNS query
            // socket, so the port sharing this flag provides is not required.
            reusePort: false,
            ttl: ttl,
          ),
);

Future<Iterable<NetworkInterface>> _lanInterfaces(
  InternetAddressType type,
) async {
  final interfaces = await NetworkInterface.list(
    type: type,
    includeLoopback: false,
    includeLinkLocal: false,
  );
  for (final interface in interfaces) {
    if (interface.addresses.isNotEmpty) return [interface];
  }
  return interfaces;
}
