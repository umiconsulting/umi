import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/thermal_logo.dart';
import 'package:umi_pos/features/hardware/thermal_printer_adapter.dart';

/// An RGBA bitmap painted from a callback, so a case states its picture instead of
/// loading one.
Uint8List bitmap(
  int width,
  int height,
  List<int> Function(int x, int y) pixel,
) {
  final bytes = Uint8List(width * height * 4);
  for (var y = 0; y < height; y += 1) {
    for (var x = 0; x < width; x += 1) {
      final value = pixel(x, y);
      final index = (y * width + x) * 4;
      bytes[index] = value[0];
      bytes[index + 1] = value[1];
      bytes[index + 2] = value[2];
      bytes[index + 3] = value[3];
    }
  }
  return bytes;
}

const black = [0, 0, 0, 255];
const white = [255, 255, 255, 255];
const clear = [0, 0, 0, 0];

final class _FakeTransport implements HardwareByteTransport {
  List<int> sent = const [];
  @override
  Future<HardwareByteTransportHealth> health() async =>
      const HardwareByteTransportHealth.connected(latencyMs: 1);
  @override
  Future<HardwareByteTransportResult> send(List<int> bytes) async {
    sent = bytes;
    return const HardwareByteTransportResult.sent();
  }

  @override
  Future<void> close() async {}
}

final class _FakeLogoSource implements ThermalLogoSource {
  _FakeLogoSource(this.raster_);
  final ThermalRaster? raster_;
  int calls = 0;
  String? lastUrl;
  @override
  Future<ThermalRaster?> raster(
    String url, {
    int widthDots = kThermalLogoWidthDots,
    int maxHeightDots = kThermalLogoMaxHeightDots,
  }) async {
    calls += 1;
    lastUrl = url;
    return raster_;
  }
}

final class _MemoryLocal implements LocalWorkingCopy {
  final Map<String, Map<String, Object?>> documents = {};

  String _key(String namespace, String scopeKey, String id) =>
      '$namespace|$scopeKey|$id';

  Map<String, Object?>? document(
    String namespace,
    String scopeKey,
    String id,
  ) => documents[_key(namespace, scopeKey, id)];

  void put(
    String namespace,
    String scopeKey,
    String id,
    Map<String, Object?> payload,
  ) {
    documents[_key(namespace, scopeKey, id)] = payload;
  }

  @override
  Future<Map<String, Object?>?> readDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    final payload = documents[_key(namespace, scopeKey, id)];
    return payload == null
        ? null
        : jsonDecode(jsonEncode(payload)) as Map<String, Object?>;
  }

  @override
  Future<void> writeDocument({
    required String namespace,
    required String scopeKey,
    required String id,
    required Map<String, Object?> payload,
    String syncState = 'synced',
  }) async {
    documents[_key(namespace, scopeKey, id)] =
        jsonDecode(jsonEncode(payload)) as Map<String, Object?>;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(invocation.memberName.toString());
}

RuntimeCommand receiptCommand({String? logoUrl}) => RuntimeCommand(
  id: 'command',
  hardwareId: 'printer',
  type: 'print_receipt',
  requiredCapability: 'printer.receipt',
  payloadFingerprint: 'fingerprint',
  safePayload: {
    'receiptId': 'receipt',
    'merchantName': 'ONCA',
    'locationName': 'ONCA',
    'receiptNumber': 'POS-1',
    'businessDate': '2026-10-11',
    'currency': 'MXN',
    'items': const [],
    'subtotalMinorUnits': 4500,
    'discountMinorUnits': 0,
    'taxMinorUnits': 621,
    'tipMinorUnits': 0,
    'totalMinorUnits': 4500,
    'tenders': const [],
    'changeMinorUnits': 0,
    if (logoUrl case final String url) 'logoUrl': url,
  },
);

void main() {
  // The mark's own test decodes a PNG, which needs the engine's binding.
  TestWidgetsFlutterBinding.ensureInitialized();
  group('the head’s raster', () {
    test(
      'turns a half-black bitmap into bits on the left and paper on the right',
      () {
        // 16 wide, 2 tall, left half black. One byte per row at 16 dots.
        final rgba = bitmap(16, 2, (x, y) => x < 8 ? black : white);
        final raster = rasteriseThermalLogo(rgba, width: 16, height: 2);

        expect(raster.widthDots, 16);
        expect(raster.heightDots, 2);
        expect(raster.bytesPerRow, 2);
        expect(raster.rows, [0xff, 0x00, 0xff, 0x00]);
      },
    );

    test('flattens transparency over the paper instead of over black', () {
      // A mark stored on a transparent ground must not print as a black square:
      // fully clear pixels are paper, and a faint ink over white stays paper.
      final rgba = bitmap(8, 1, (x, y) => x < 4 ? clear : [0, 0, 0, 100]);
      final raster = rasteriseThermalLogo(rgba, width: 8, height: 1);

      expect(raster.rows, [0x00]);
    });

    test('scales a big mark to the head, keeping its proportions', () {
      final rgba = bitmap(1000, 1000, (x, y) => black);
      final raster = rasteriseThermalLogo(rgba, width: 1000, height: 1000);

      // Height is the binding constraint, and the width follows it: the mark is
      // never stretched to fill the head.
      expect(raster.heightDots, kThermalLogoMaxHeightDots);
      expect(raster.widthDots, kThermalLogoMaxHeightDots);
      expect(raster.rows.length, raster.bytesPerRow * raster.heightDots);
    });

    test(
      'a wide mark uses the head’s width without growing taller than the cap',
      () {
        final rgba = bitmap(1200, 420, (x, y) => black);
        final raster = rasteriseThermalLogo(rgba, width: 1200, height: 420);

        expect(raster.widthDots, kThermalLogoWidthDots);
        expect(raster.heightDots, 134);
      },
    );

    test('a small mark is never stretched to fill the head', () {
      final rgba = bitmap(24, 12, (x, y) => black);
      final raster = rasteriseThermalLogo(rgba, width: 24, height: 12);

      expect([raster.widthDots, raster.heightDots], [24, 12]);
    });
  });

  group('the encoder', () {
    test('writes `GS v 0` with the block’s own geometry', () {
      final rgba = bitmap(8, 2, (x, y) => y == 0 ? black : white);
      final raster = rasteriseThermalLogo(rgba, width: 8, height: 2);
      final bytes = const ThermalEscPosEncoder().encode(
        ThermalDocument([ThermalImageCommand(raster)]),
      );

      expect(bytes, [
        0x1d, 0x76, 0x30, 0x00, // GS v 0, normal density
        0x01, 0x00, // one byte per row
        0x02, 0x00, // two rows
        0xff, // the black row
        0x00, // the paper row
      ]);
    });
  });

  group('the receipt renderer', () {
    final raster = rasteriseThermalLogo(
      bitmap(8, 8, (x, y) => black),
      width: 8,
      height: 8,
    );

    test('draws the mark above the café’s name when the head can', () {
      final document = ThermalReceiptRenderer().render(
        receiptCommand().safePayload,
        capabilities: const {'printer.receipt', 'printer.image'},
        logoRaster: raster,
      );
      final types = document.commands.map((c) => c.runtimeType).toList();

      expect(types[1], ThermalImageCommand);
      expect(
        document.plainText.indexOf('ONCA'),
        greaterThan(-1),
        reason: 'the receipt still carries its text',
      );
    });

    test(
      'a head that cannot draw images gets the receipt without the picture',
      () {
        final document = ThermalReceiptRenderer().render(
          receiptCommand().safePayload,
          capabilities: const {'printer.receipt'},
          logoRaster: raster,
        );

        expect(document.commands.whereType<ThermalImageCommand>(), isEmpty);
      },
    );
  });

  group('the printer adapter', () {
    test('fetches the café’s mark and prints it', () async {
      final transport = _FakeTransport();
      final raster = rasteriseThermalLogo(
        bitmap(8, 2, (x, y) => black),
        width: 8,
        height: 2,
      );
      final source = _FakeLogoSource(raster);
      final adapter = GenericThermalPrinterAdapter(
        byteTransport: transport,
        capabilities: const {'printer.receipt', 'printer.image'},
        logoSource: source,
      );

      final result = await adapter.execute(
        receiptCommand(logoUrl: 'https://api.test/logos/onca-abc.png'),
      );

      expect(result.status, RuntimeCommandStatus.succeeded);
      expect(
        result.safeMetadata.keys,
        everyElement(isIn({'acknowledged', 'latencyMs'})),
      );
      expect(source.calls, 1);
      expect(source.lastUrl, 'https://api.test/logos/onca-abc.png');
      final index = () {
        for (var i = 0; i < transport.sent.length - 3; i += 1) {
          if (transport.sent[i] == 0x1d && transport.sent[i + 1] == 0x76) {
            return i;
          }
        }
        return -1;
      }();
      expect(
        index,
        greaterThan(-1),
        reason: 'the raster command is in the stream',
      );
    });

    test('prints the receipt anyway when the mark cannot be fetched', () async {
      final transport = _FakeTransport();
      final source = _FakeLogoSource(null);
      final adapter = GenericThermalPrinterAdapter(
        byteTransport: transport,
        capabilities: const {'printer.receipt', 'printer.image'},
        logoSource: source,
      );

      final result = await adapter.execute(
        receiptCommand(logoUrl: 'https://api.test/logos/onca-abc.png'),
      );

      expect(result.status, RuntimeCommandStatus.succeeded);
      // The receipt's own bytes reached the head: initialized, then the café's name
      // as text. Nothing about the missing picture changes that.
      expect(transport.sent.take(2), [0x1b, 0x40]);
      expect(String.fromCharCodes(transport.sent), contains('ONCA'));
      expect(transport.sent.take(3), isNot([0x1d, 0x76, 0x30]));
    });

    test(
      'never reaches for a mark when the head has no image capability',
      () async {
        final transport = _FakeTransport();
        final source = _FakeLogoSource(null);
        final adapter = GenericThermalPrinterAdapter(
          byteTransport: transport,
          capabilities: const {'printer.receipt'},
          logoSource: source,
        );

        await adapter.execute(
          receiptCommand(logoUrl: 'https://api.test/logos/onca-abc.png'),
        );

        expect(source.calls, 0);
      },
    );
  });

  group('durable receipt mark', () {
    final raster = ThermalRaster(
      widthDots: 8,
      heightDots: 2,
      rows: const [0xff, 0x00],
    );

    test(
      'a new process reads the persisted one-bit image, not the PNG',
      () async {
        final local = _MemoryLocal();
        final network = _FakeLogoSource(raster);
        const url = 'https://api.test/logos/onca-abc.png';

        final firstProcess = CachedThermalLogoSource(network, local);
        final first = await firstProcess.raster(url);
        final secondProcess = CachedThermalLogoSource(network, local);
        final second = await secondProcess.raster(url);

        expect(first?.rows, raster.rows);
        expect(second?.rows, raster.rows);
        expect(
          network.calls,
          1,
          reason: 'the durable copy survived the process',
        );
      },
    );

    test(
      'a truncated durable image is a miss, never malformed paper',
      () async {
        final local = _MemoryLocal();
        final network = _FakeLogoSource(raster);
        const url = 'https://api.test/logos/onca-abc.png';
        final source = CachedThermalLogoSource(network, local);
        await source.raster(url);
        final id = sha256.convert(utf8.encode(url)).toString();
        local.put(CachedThermalLogoSource.namespace, '384:192', id, {
          'url': url,
          'widthDots': 8,
          'heightDots': 2,
          'rows': base64Encode(const [0xff]),
        });

        final restarted = CachedThermalLogoSource(network, local);
        final printed = await restarted.raster(url);

        expect(printed?.rows, raster.rows);
        expect(network.calls, 2);
      },
    );

    test('a failed fetch is not repeated for every tap that prints', () async {
      final local = _MemoryLocal();
      final network = _FakeLogoSource(null);
      var now = DateTime.utc(2026, 10, 18, 12);
      const url = 'https://api.test/logos/onca-abc.png';
      final source = CachedThermalLogoSource(
        network,
        local,
        negativeCacheDuration: const Duration(seconds: 30),
        now: () => now,
      );

      expect(await source.raster(url), isNull);
      expect(await source.raster(url), isNull);
      expect(network.calls, 1);

      now = now.add(const Duration(seconds: 31));
      expect(await source.raster(url), isNull);
      expect(network.calls, 2);
    });

    test('concurrent copies of one receipt share one fetch', () async {
      final local = _MemoryLocal();
      final network = _FakeLogoSource(raster);
      const url = 'https://api.test/logos/onca-abc.png';
      final source = CachedThermalLogoSource(network, local);

      await Future.wait([source.raster(url), source.raster(url)]);

      expect(network.calls, 1);
    });
  });

  // The picture that is actually stored for the café, through the whole path: the
  // PNG the API serves, decoded, reduced to the head's raster. A synthetic bitmap
  // proves the arithmetic; this proves the arithmetic meets the mark.
  group('the paper names the order, the ticket and the copy', () {
    Map<String, Object?> receiptPayload({
      String? orderNumber,
      String? receiptNumber,
      Object? copyIndex,
      String? impressionId,
    }) => {
      ...receiptCommand().safePayload,
      'receiptNumber': ?receiptNumber,
      'orderNumber': ?orderNumber,
      'copyIndex': ?copyIndex,
      'impressionId': ?impressionId,
    };

    List<String> linesFor(Map<String, Object?> payload) =>
        ThermalReceiptRenderer()
            .render(payload, capabilities: const {'printer.receipt'})
            .plainText
            .split('\n');

    test('prints the order above the folio', () {
      final lines = linesFor(
        receiptPayload(orderNumber: '131', receiptNumber: '0042'),
      );
      final order = lines.indexWhere((line) => line.contains('Orden 131'));
      final folio = lines.indexWhere((line) => line.contains('Ticket 0042'));
      expect(order, greaterThan(-1));
      expect(folio, greaterThan(order));
    });

    test('a refund names its own ticket and the original sale', () {
      final lines = linesFor({
        ...receiptPayload(orderNumber: '193', receiptNumber: 'EX-0002'),
        'exceptionMarker': 'refund',
        'originalReceiptNumber': '0001',
      });
      final refund = lines.indexOf('REEMBOLSO');
      final order = lines.indexOf('Orden 193');
      final ticket = lines.indexOf('Ticket EX-0002');
      final original = lines.indexOf('Ticket original 0001');
      expect(refund, greaterThan(-1));
      expect(order, greaterThan(refund));
      expect(ticket, greaterThan(order));
      expect(original, greaterThan(ticket));
      expect(lines, isNot(contains('refund')));
    });

    test('a receipt whose number is a key prints no ticket line', () {
      // `POS-<uuid>` is the payment attempt's key, frozen before the counter existed.
      // It belongs in the barcode; on the paper it is unreadable and unusable.
      final lines = linesFor(
        receiptPayload(
          orderNumber: '131',
          receiptNumber: 'POS-fcd359d7-61e7-4209-8c41-3a13aaec45a4',
        ),
      );
      expect(lines.any((line) => line.contains('POS-')), isFalse);
      expect(lines.any((line) => line.contains('Orden 131')), isTrue);
    });

    test('the original says nothing, and each copy says which one it is', () {
      expect(
        linesFor(receiptPayload(copyIndex: 0)).any((l) => l.contains('COPIA')),
        isFalse,
      );
      expect(linesFor(receiptPayload(copyIndex: 1)), contains('COPIA'));
      expect(linesFor(receiptPayload(copyIndex: 2)), contains('COPIA 2'));
      // A till that only knows the old boolean still prints the word.
      expect(
        ThermalReceiptRenderer()
            .render(
              receiptCommand().safePayload,
              capabilities: const {'printer.receipt'},
              copy: true,
            )
            .plainText,
        contains('COPIA'),
      );
    });

    test(
      'leaves the print job out of the paper and closes with the thank-you',
      () {
        expect(
          linesFor(
            receiptPayload(
              impressionId: '3cb4c161-5253-5fe8-8b72-0f4a0d8df5b1',
            ),
          ),
          isNot(contains('Impresión 3cb4c161')),
          reason:
              'the impression is a name for the print job, and it belongs in the record (owner, 2026-10-13)',
        );
        expect(
          linesFor(receiptPayload()).map((line) => line.trim()),
          contains('Gracias por su visita'),
        );
      },
    );

    test('prints the café once when the branch carries the same name', () {
      // The fixture is the real morning: `merchantName` and `locationName` are both ONCA,
      // which put the same line twice at the head of every receipt (iMin D3-504, 2026-10-13).
      final lines = linesFor(
        receiptPayload(),
      ).map((line) => line.trim()).where((line) => line == 'ONCA');
      expect(lines, hasLength(1));
    });

    test('names the branch when it says something the café name did not', () {
      final lines = linesFor({
        ...receiptPayload(),
        'locationName': 'ONCA Sucursal 2',
      }).map((line) => line.trim());
      expect(lines, contains('ONCA'));
      expect(lines, contains('ONCA Sucursal 2'));
    });

    test('prints the canonical tax and always keeps the tip row', () {
      // El impuesto incluido se muestra sin sumarlo otra vez al total.
      final lines = linesFor(
        receiptPayload(),
      ).map((line) => line.trim()).toList();
      expect(
        lines.firstWhere((line) => line.contains('Impuestos')),
        endsWith('MXN 6.21'),
      );
      expect(
        lines.firstWhere((line) => line.contains('Propina')),
        endsWith('MXN 0.00'),
      );
    });

    test('prints the tip the guest left', () {
      final lines = linesFor({
        ...receiptPayload(),
        'tipMinorUnits': 675,
      }).map((line) => line.trim()).toList();
      expect(
        lines.firstWhere((line) => line.contains('Propina')),
        endsWith('MXN 6.75'),
      );
    });
  });

  group('the mark is fetched from the API this till is pointed at', () {
    Future<List<Uri>> fetch(String url, {Uri? apiBaseUri}) async {
      final asked = <Uri>[];
      final bytes = await File('test/support/onca-logo-512.png').readAsBytes();
      final source = HttpThermalLogoSource(
        apiBaseUri: apiBaseUri,
        client: MockClient((request) async {
          asked.add(request.url);
          return http.Response.bytes(bytes, 200);
        }),
      );
      await source.raster(url);
      return asked;
    }

    test(
      'repairs the loopback address a receipt froze when it committed',
      () async {
        // The day the till stopped going through the `adb reverse` tunnel, every
        // ticket came out without the café's mark: the snapshot says 127.0.0.1 and the
        // till asked itself.
        final asked = await fetch(
          'http://127.0.0.1:4001/logos/e6b14af1-8897324fdb0ca066.png',
          apiBaseUri: Uri.parse('http://192.168.1.9:4001'),
        );
        expect(
          asked.single.toString(),
          'http://192.168.1.9:4001/logos/e6b14af1-8897324fdb0ca066.png',
        );
      },
    );

    test('leaves any other host exactly as it was written', () async {
      final asked = await fetch(
        'https://cdn.example.com/logos/onca.png',
        apiBaseUri: Uri.parse('http://192.168.1.9:4001'),
      );
      expect(asked.single.toString(), 'https://cdn.example.com/logos/onca.png');
    });

    test(
      'uses the URL as written when the till has no API configured',
      () async {
        final asked = await fetch('http://127.0.0.1:4001/logos/onca.png');
        expect(asked.single.toString(), 'http://127.0.0.1:4001/logos/onca.png');
      },
    );
  });

  test('ONCA’s own mark survives the path to the head', () async {
    // Read from disk, not the bundle: the fixture is the PNG the API stores, and a
    // test asset that had to be declared in the pubspec is a different file.
    final bytes = await File('test/support/onca-logo-512.png').readAsBytes();
    // A plain `test`, not `testWidgets`: the decode is real asynchronous work on the
    // engine's own thread, and the widget tester's fake clock would wait for ever.
    final codec = await ui.instantiateImageCodec(bytes);
    final image = (await codec.getNextFrame()).image;
    final rgba = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    final raster = rasteriseThermalLogo(
      rgba!.buffer.asUint8List(),
      width: image.width,
      height: image.height,
    );
    image.dispose();

    expect(raster.widthDots, lessThanOrEqualTo(kThermalLogoWidthDots));
    expect(raster.heightDots, lessThanOrEqualTo(kThermalLogoMaxHeightDots));
    final ink = raster.rows.fold<int>(
      0,
      (total, row) => total + row.toRadixString(2).replaceAll('0', '').length,
    );
    final dots = raster.widthDots * raster.heightDots;
    // A line drawing with a face on it: enough ink to be a mark, far from a solid
    // block. Both bounds matter — a transparency bug prints the block.
    expect(ink / dots, greaterThan(0.05));
    expect(ink / dots, lessThan(0.60));
  });

  test('a mark narrower than the paper lands in the middle of it', () {
    // `GS v 0` draws from the left margin and the head ignores justification for a
    // raster, so a 384-dot mark on an 80 mm (576-dot) head came out jammed against
    // the paper's left edge while every line under it was centred — the till's own
    // report, Epson TM-T20IIIL, 2026-10-11.
    final mark = ThermalRaster(
      widthDots: 16,
      heightDots: 2,
      // Two rows of two bytes, with ink in the FIRST byte of each row: if the
      // padding is added on the left, the ink moves with it.
      rows: [0xFF, 0x00, 0xFF, 0x00],
    );
    final centred = mark.centredOn(64);
    // 64 dots is eight bytes: two of ink and six of white, split three and three.
    expect(centred.bytesPerRow, 8);
    expect(centred.heightDots, 2);
    expect(centred.rows, [
      0x00,
      0x00,
      0x00,
      0xFF,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0xFF,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    // A mark that already fills the paper is left exactly as it is: centring must
    // never crop or rescale the café's picture.
    expect(identical(mark.centredOn(16), mark), isTrue);
    expect(identical(mark.centredOn(8), mark), isTrue);
  });
}
