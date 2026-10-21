import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/pilot_hardware_adapters.dart';
import 'package:umi_pos/features/hardware/thermal_printer_adapter.dart';
import 'package:umi_pos/features/hardware/usb_printer_transport.dart';

/// The platform channel, faked. A till's USB host port is not something a unit
/// test can hold, so the link's behaviour is pinned here instead.
final class _FakeUsbPrinter implements UsbPrinterChannel {
  int opens = 0;
  int closes = 0;
  int statusReads = 0;
  final List<int> written = [];
  Object? openFailure;
  Object? writeFailure;
  int statusByte = 0x16; // online, no error
  Object? statusFailure;
  Duration? writeDelay;
  Duration? statusDelay;
  final List<String> operations = [];
  int activeOperations = 0;
  int maximumConcurrentOperations = 0;

  Future<void> _operation(String name, Future<void> Function() body) async {
    operations.add(name);
    activeOperations += 1;
    if (activeOperations > maximumConcurrentOperations) {
      maximumConcurrentOperations = activeOperations;
    }
    try {
      await body();
    } finally {
      activeOperations -= 1;
    }
  }

  @override
  Future<List<UsbPrinterInfo>> attached() async => const [
    UsbPrinterInfo(
      deviceId: '/dev/bus/usb/003/002',
      vendorId: 0x04B8,
      productId: 0x0E27,
      productName: 'TM-T20IIIL',
    ),
  ];

  @override
  Future<void> open() async {
    final failure = openFailure;
    if (failure != null) throw failure;
    opens += 1;
  }

  @override
  Future<void> write(List<int> bytes) async {
    await _operation('write', () async {
      final failure = writeFailure;
      if (failure != null) throw failure;
      final delay = writeDelay;
      if (delay != null) await Future<void>.delayed(delay);
      written.addAll(bytes);
    });
  }

  @override
  Future<int> status() async {
    var result = statusByte;
    await _operation('status', () async {
      final failure = statusFailure;
      if (failure != null) throw failure;
      final delay = statusDelay;
      if (delay != null) await Future<void>.delayed(delay);
      statusReads += 1;
      result = statusByte;
    });
    return result;
  }

  @override
  Future<void> close() async {
    closes += 1;
  }
}

void main() {
  test('a send opens once and hands the bytes to the printer', () async {
    final printer = _FakeUsbPrinter();
    final transport = UsbPrinterByteTransport(channel: printer);

    expect(
      (await transport.send([0x1b, 0x40])).outcome,
      HardwareByteTransportOutcome.sent,
    );
    expect(
      (await transport.send([0x0a])).outcome,
      HardwareByteTransportOutcome.sent,
    );

    expect(printer.opens, 1, reason: 'the link stays open between commands');
    expect(printer.written, [0x1b, 0x40, 0x0a]);
  });

  test('a refused open is notSent, so the command is safe to repeat', () async {
    final printer = _FakeUsbPrinter()
      ..openFailure = StateError('usb permission denied');
    final transport = UsbPrinterByteTransport(channel: printer);

    final result = await transport.send([0x1b, 0x40]);

    expect(result.outcome, HardwareByteTransportOutcome.notSent);
    expect(result.failureCode, 'transport_unavailable');
  });

  test(
    'a write that never lands is unknown, so a retry could double',
    () async {
      final printer = _FakeUsbPrinter()
        ..writeDelay = const Duration(seconds: 30);
      final transport = UsbPrinterByteTransport(
        channel: printer,
        timeout: const Duration(milliseconds: 40),
      );

      final result = await transport.send([0x1b, 0x40]);

      expect(result.outcome, HardwareByteTransportOutcome.unknown);
      expect(result.failureCode, 'transport_timeout');
    },
  );

  test('health reads the printer status and reports it ready', () async {
    final printer = _FakeUsbPrinter();
    final transport = UsbPrinterByteTransport(channel: printer);

    final health = await transport.health();

    expect(health.state, 'connected');
    expect(printer.statusReads, 1);
  });

  test('health reports a printer that answers but is not ready', () async {
    // Bit 5 of DLE EOT 1: an error occurred.
    final printer = _FakeUsbPrinter()..statusByte = 0x36;
    final transport = UsbPrinterByteTransport(channel: printer);

    final health = await transport.health();

    expect(health.state, 'disconnected');
    expect(health.failureCode, 'printer_not_ready');
  });

  test('health with no printer is disconnected, not a crash', () async {
    final printer = _FakeUsbPrinter()
      ..openFailure = StateError('no printer-class USB device attached');
    final transport = UsbPrinterByteTransport(channel: printer);

    final health = await transport.health();

    expect(health.state, 'disconnected');
    expect(health.failureCode, 'transport_unavailable');
  });

  test('a failed send reopens on the next one', () async {
    final printer = _FakeUsbPrinter()
      ..writeFailure = StateError('the printer went away');
    final transport = UsbPrinterByteTransport(channel: printer);
    await transport.send([0x1b, 0x40]);

    printer.writeFailure = null;
    expect(
      (await transport.send([0x1b, 0x40])).outcome,
      HardwareByteTransportOutcome.sent,
    );
    expect(printer.opens, 2);
  });

  test('a receipt write and a status probe never overlap', () async {
    final printer = _FakeUsbPrinter()
      ..writeDelay = const Duration(milliseconds: 30)
      ..statusDelay = const Duration(milliseconds: 30);
    final transport = UsbPrinterByteTransport(channel: printer);

    final printed = transport.send([0x1b, 0x40]);
    final health = transport.health();
    await Future.wait([printed, health]);

    expect(printer.operations, ['write', 'status']);
    expect(printer.maximumConcurrentOperations, 1);
  });

  test(
    'a routine health refresh does not put a query behind a receipt',
    () async {
      final printer = _FakeUsbPrinter();
      final transport = UsbPrinterByteTransport(channel: printer);
      await transport.send([0x1b, 0x40]);

      final background = await transport.backgroundHealth();

      expect(background.state, 'connected');
      expect(
        printer.statusReads,
        0,
        reason: 'the successful write is evidence',
      );

      final explicit = await transport.health();
      expect(explicit.state, 'connected');
      expect(
        printer.statusReads,
        1,
        reason: 'an operator request still probes',
      );
    },
  );

  test('the lab resolves a usb printer and its drawer onto one link', () async {
    final printer = _FakeUsbPrinter();
    final lab = PilotHardwareLab(usbPrinterFactory: () => printer);

    final printerAdapter = lab.resolve(
      const RuntimeDevice(
        id: 'printer-1',
        type: 'printer',
        transport: 'usb_foundation',
        capabilities: {'printer.receipt', 'printer.test_page', 'printer.cut'},
        enabled: true,
      ),
    );
    final drawerAdapter = lab.resolve(
      const RuntimeDevice(
        id: 'drawer-1',
        type: 'cash_drawer',
        transport: 'usb_foundation',
        capabilities: {'drawer.open', 'drawer.status'},
        enabled: true,
      ),
    );

    expect(printerAdapter, isA<GenericThermalPrinterAdapter>());
    expect(drawerAdapter, isA<PrinterAttachedDrawerAdapter>());

    final printed = await printerAdapter!.execute(
      const RuntimeCommand(
        id: 'command-1',
        hardwareId: 'printer-1',
        type: 'print_test_page',
        requiredCapability: 'printer.test_page',
        payloadFingerprint: 'fingerprint',
      ),
    );
    expect(printed.status, RuntimeCommandStatus.succeeded);
    expect(printer.written, isNotEmpty);

    final pulsed = await drawerAdapter!.execute(
      const RuntimeCommand(
        id: 'command-2',
        hardwareId: 'drawer-1',
        type: 'open_drawer',
        requiredCapability: 'drawer.open',
        payloadFingerprint: 'fingerprint',
      ),
    );
    expect(pulsed.status, RuntimeCommandStatus.succeeded);

    // One open for both: the drawer pulses through the printer's own link.
    expect(printer.opens, 1);
    await lab.dispose();
  });

  test(
    'the health poll asks the USB printer, so it stops reading as gone',
    () async {
      final printer = _FakeUsbPrinter();
      final lab = PilotHardwareLab(usbPrinterFactory: () => printer);

      lab.resolve(
        const RuntimeDevice(
          id: 'printer-1',
          type: 'printer',
          transport: 'usb_foundation',
          capabilities: {'printer.receipt'},
          enabled: true,
        ),
      );

      // The first answer is the pessimistic one the card starts from.
      expect(lab.connectionStateFor('printer-1'), 'disconnected');

      await lab.refreshHealth();

      expect(lab.connectionStateFor('printer-1'), 'connected');
      expect(printer.statusReads, 1, reason: 'the link was actually asked');
      await lab.dispose();
    },
  );

  test(
    'a shared USB link is asked once for the printer and the drawer',
    () async {
      final printer = _FakeUsbPrinter();
      final lab = PilotHardwareLab(usbPrinterFactory: () => printer);

      lab.resolve(
        const RuntimeDevice(
          id: 'printer-1',
          type: 'printer',
          transport: 'usb_foundation',
          capabilities: {'printer.receipt'},
          enabled: true,
        ),
      );
      lab.resolve(
        const RuntimeDevice(
          id: 'drawer-1',
          type: 'cash_drawer',
          transport: 'usb_foundation',
          capabilities: {'drawer.open'},
          enabled: true,
        ),
      );

      await lab.refreshHealth();

      // Two opens of one interface would fight over the claim.
      expect(printer.opens, 1);
      expect(printer.statusReads, 1);
      expect(lab.connectionStateFor('printer-1'), 'connected');
      expect(lab.connectionStateFor('drawer-1'), 'connected');
      await lab.dispose();
    },
  );

  test('a printer that answers offline is reported as disconnected', () async {
    final printer = _FakeUsbPrinter()..statusByte = 0x1e; // 0x08 = offline
    final lab = PilotHardwareLab(usbPrinterFactory: () => printer);

    lab.resolve(
      const RuntimeDevice(
        id: 'printer-1',
        type: 'printer',
        transport: 'usb_foundation',
        capabilities: {'printer.receipt'},
        enabled: true,
      ),
    );

    await lab.refreshHealth();

    expect(lab.connectionStateFor('printer-1'), 'disconnected');
    await lab.dispose();
  });
}
