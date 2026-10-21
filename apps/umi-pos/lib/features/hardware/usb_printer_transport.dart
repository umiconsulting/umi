import 'dart:async';

import 'package:flutter/services.dart';

import 'print_trace.dart';
import 'thermal_printer_adapter.dart';

/// The terminal's own USB host port, as a printer link.
///
/// Android gives a Dart isolate no way to touch a USB endpoint: the device nodes
/// are root-only and a `user` build has no `su`. An **app** can claim a
/// printer-class interface, so this is a platform channel — the same shape as
/// the keystore link (`MethodChannelKeystore` / `DeviceKeySigner`).
///
/// The device is discovered rather than configured: a till has one receipt
/// printer, and it is recognised by its printer-class interface (Epson's vendor
/// id first, then any printer-class device). Nothing in the connection
/// configuration decides it, so `usb_foundation` needs no new fields.
///
/// The channel is injected so a test can drive the transport without hardware.
abstract interface class UsbPrinterChannel {
  /// Printer-class devices the terminal can see, for diagnostics.
  Future<List<UsbPrinterInfo>> attached();

  /// Open the printer and claim its interface. Android asks for permission on
  /// the first open, which needs the app in the foreground.
  Future<void> open();

  /// Hand raw ESC/POS bytes to the printer. Throws when the link fails.
  Future<void> write(List<int> bytes);

  /// `DLE EOT 1`: the printer's own status byte.
  Future<int> status();

  Future<void> close();
}

final class UsbPrinterInfo {
  const UsbPrinterInfo({
    required this.deviceId,
    required this.vendorId,
    required this.productId,
    this.productName,
  });

  final String deviceId;
  final int vendorId;
  final int productId;
  final String? productName;

  static UsbPrinterInfo fromMap(Map<Object?, Object?> map) => UsbPrinterInfo(
    deviceId: '${map['deviceId']}',
    vendorId: (map['vendorId'] as num?)?.toInt() ?? 0,
    productId: (map['productId'] as num?)?.toInt() ?? 0,
    productName: map['productName'] as String?,
  );

  /// `0x04B8` is Seiko Epson.
  bool get isEpson => vendorId == 0x04B8;
}

/// The Kotlin side of the link (`UsbPrinterChannel.kt`).
final class MethodChannelUsbPrinter implements UsbPrinterChannel {
  MethodChannelUsbPrinter([MethodChannel? channel])
    : _channel =
          channel ??
          const MethodChannel('co.umiconsulting.umi_pos/usb_printer');

  final MethodChannel _channel;

  @override
  Future<List<UsbPrinterInfo>> attached() async {
    final raw = await _channel.invokeMethod<List<Object?>>('attached');
    return [
      for (final item in raw ?? const <Object?>[])
        if (item is Map) UsbPrinterInfo.fromMap(item.cast<Object?, Object?>()),
    ];
  }

  @override
  Future<void> open() => _channel.invokeMethod<void>('open');

  @override
  Future<void> write(List<int> bytes) => _channel.invokeMethod<void>('write', {
    'bytes': Uint8List.fromList(bytes),
  });

  @override
  Future<int> status() async =>
      await _channel.invokeMethod<int>('status') ?? -1;

  @override
  Future<void> close() => _channel.invokeMethod<void>('close');
}

/// A [HardwareByteTransport] over the terminal's USB host port.
///
/// The printer attaches to the till itself, so the money path — the receipt and
/// the drawer pulse that leaves through the printer's DK port — does not depend
/// on the LAN at all. That is the whole argument for this transport over the
/// network one.
final class UsbPrinterByteTransport
    implements HardwareByteTransport, BackgroundHardwareHealth {
  UsbPrinterByteTransport({
    UsbPrinterChannel? channel,
    this.timeout = const Duration(seconds: 10),
  }) : _channel = channel ?? MethodChannelUsbPrinter();

  final UsbPrinterChannel _channel;

  /// Android asks for USB permission on the first open, so the first call is
  /// allowed to take as long as an operator takes to tap the prompt.
  final Duration timeout;

  bool _isOpen = false;
  HardwareByteTransportHealth? _lastHealth;
  // Android's method channel already runs USB work on one worker, but the
  // operations reach it in whatever order concurrently-started Dart futures
  // invoke the channel. Printing and the drawer share this link, so queue them
  // here as well: a status probe can no longer overtake a pulse or a receipt,
  // and the open flag has one owner.
  Future<void> _tail = Future<void>.value();

  @override
  Future<HardwareByteTransportResult> send(List<int> bytes) =>
      _serialized(() async {
        printTrace('usb.send_start', {'bytes': bytes.length});
        try {
          await _ensureOpen();
          final started = DateTime.now();
          await _channel.write(bytes).timeout(timeout);
          _lastHealth = HardwareByteTransportHealth.connected(
            latencyMs: DateTime.now().difference(started).inMilliseconds,
          );
          printTrace('usb.send_sent', {'bytes': bytes.length});
          return const HardwareByteTransportResult.sent();
        } on TimeoutException {
          _lastHealth = const HardwareByteTransportHealth.disconnected(
            failureCode: 'transport_timeout',
          );
          printTrace('usb.send_timeout', {'bytes': bytes.length});
          return const HardwareByteTransportResult.unknown(
            failureCode: 'transport_timeout',
          );
        } catch (_) {
          _lastHealth = const HardwareByteTransportHealth.disconnected(
            failureCode: 'transport_unavailable',
          );
          printTrace('usb.send_failed', {'bytes': bytes.length});
          // No permission, unplugged printer, a claim that failed: nothing
          // reached the printer, so the command is safe to send again.
          _isOpen = false;
          return const HardwareByteTransportResult.notSent(
            failureCode: 'transport_unavailable',
          );
        }
      }, stage: 'send');

  @override
  Future<HardwareByteTransportHealth> health() => _serialized(() async {
    final started = DateTime.now();
    printTrace('usb.health_start');
    try {
      await _ensureOpen();
      final status = await _channel.status().timeout(timeout);
      final latencyMs = DateTime.now().difference(started).inMilliseconds;
      printTrace('usb.health_done', {'latencyMs': latencyMs, 'status': status});
      // DLE EOT 1: bit 3 is "offline", bit 5 is "an error occurred". Every
      // other bit is fixed by the printer. A printer that answers at all is
      // on the wire; these two bits say whether it is ready to print.
      final ready = (status & 0x08) == 0 && (status & 0x20) == 0;
      final health = ready
          ? HardwareByteTransportHealth.connected(latencyMs: latencyMs)
          : const HardwareByteTransportHealth.disconnected(
              failureCode: 'printer_not_ready',
            );
      _lastHealth = health;
      return health;
    } on TimeoutException {
      _isOpen = false;
      _lastHealth = const HardwareByteTransportHealth.disconnected(
        failureCode: 'transport_timeout',
      );
      printTrace('usb.health_timeout');
      return const HardwareByteTransportHealth.disconnected(
        failureCode: 'transport_timeout',
      );
    } catch (_) {
      _isOpen = false;
      _lastHealth = const HardwareByteTransportHealth.disconnected(
        failureCode: 'transport_unavailable',
      );
      printTrace('usb.health_failed');
      return const HardwareByteTransportHealth.disconnected(
        failureCode: 'transport_unavailable',
      );
    }
  }, stage: 'health');

  @override
  Future<HardwareByteTransportHealth> backgroundHealth() async =>
      _lastHealth ??
      const HardwareByteTransportHealth.disconnected(
        failureCode: 'not_measured_since_start',
      );

  @override
  Future<void> close() => _serialized(() async {
    _isOpen = false;
    try {
      await _channel.close();
    } catch (_) {
      // Closing a link that is already gone is not a failure to report.
    }
  }, stage: 'close');

  Future<T> _serialized<T>(
    Future<T> Function() operation, {
    required String stage,
  }) {
    printTrace('usb.queue', {'stage': stage});
    final result = _tail.then((_) => operation());
    _tail = result.then<void>(
      (_) => printTrace('usb.complete', {'stage': stage}),
      onError: (Object _) => printTrace('usb.complete_error', {'stage': stage}),
    );
    return result;
  }

  Future<void> _ensureOpen() async {
    if (_isOpen) return;
    printTrace('usb.open_start');
    await _channel.open().timeout(timeout);
    _isOpen = true;
    printTrace('usb.open_done');
  }
}
