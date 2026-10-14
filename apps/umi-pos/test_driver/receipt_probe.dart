// Controlled document measurement. This target never creates a sale or payment.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart' as test;
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/shared/widgets/receipt_document.dart';

final _frames = <FrameTiming>[];
bool _recording = false;
int _requestedLines = 0;
void _collect(List<FrameTiming> frames) => _frames.addAll(frames);
Map<String, Object?> _money(int minor) => {
  'currency': 'MXN',
  'minorUnits': minor,
};

Future<String> receiptProbe(String message) async {
  final operation = message.substring('receipt-probe:'.length);
  if (operation.startsWith('open:')) {
    final count = int.parse(operation.substring('open:'.length));
    if (count < 1 || count > 500) throw ArgumentError.value(count);
    if (test.find.byType(ReceiptDocument).evaluate().isNotEmpty) {
      throw StateError('Close the previous document before this measurement.');
    }
    if (_recording) SchedulerBinding.instance.removeTimingsCallback(_collect);
    _frames.clear();
    _requestedLines = count;
    _recording = true;
    SchedulerBinding.instance.addTimingsCallback(_collect);
    final receipt = ReceiptSnapshot(
      receiptRef: 'CONTROLLED-N21-$count-NOT-A-SALE',
      merchantId: '10000000-0000-4000-8000-000000000101',
      locationId: '20000000-0000-4000-8000-000000000101',
      issuedAt: '2026-10-08T12:00:00Z',
      businessDate: '2026-10-08',
      merchantName: 'Documento de prueba / Test document',
      locationName: 'Sin venta ni pago / No sale or payment',
      lines: [
        for (var i = 1; i <= count; i++)
          ReceiptLineSnapshot(
            lineRef: 'controlled-line-$i',
            description: 'Cappuccino con leche de avena · $i / $count',
            quantity: 1,
            unitPrice: _money(6200),
            lineTotal: _money(6100),
            variantName: 'Chico',
            modifiers: ['Leche de avena'],
            note: 'Café de piñón · sin azúcar',
          ).toJson(),
      ],
      subtotal: _money(count * 6200),
      discountTotal: _money(count * 100),
      taxTotal: _money(count * 841),
      grandTotal: _money(count * 6100),
      currency: 'MXN',
      version: 1,
    );
    final context = test.find.byType(Text).evaluate().first;
    unawaited(showReceiptDocument(context, receipt));
    await WidgetsBinding.instance.endOfFrame;
    return jsonEncode({'controlled': true, 'requestedLines': count});
  }
  if (operation == 'read' || operation == 'stop') {
    // The engine batches timing callbacks in profile mode.
    await Future<void>.delayed(const Duration(milliseconds: 1100));
    final documents = test.find.byType(ReceiptDocument);
    final scrolls = documents.evaluate().isEmpty
        ? <ScrollableState>[]
        : test.find
              .ancestor(of: documents, matching: test.find.byType(Scrollable))
              .evaluate()
              .map((e) => (e as StatefulElement).state as ScrollableState)
              .toList();
    final nested = documents.evaluate().isEmpty
        ? <ScrollableState>[]
        : test.find
              .descendant(of: documents, matching: test.find.byType(Scrollable))
              .evaluate()
              .map((e) => (e as StatefulElement).state as ScrollableState)
              .toList();
    final result = {
      'controlled': true,
      'scope': 'Native profile; synthetic document only; no API writes',
      'requestedLines': _requestedLines,
      'mountedLineWidgets': test.find
          .byWidgetPredicate(
            (w) => w.runtimeType.toString() == '_ReceiptLine',
            skipOffstage: false,
          )
          .evaluate()
          .length,
      'scrollPositions': [
        for (final s in [...scrolls, ...nested])
          {
            'pixels': s.position.pixels,
            'maxScrollExtent': s.position.maxScrollExtent,
            'viewportDimension': s.position.viewportDimension,
          },
      ],
      'frames': [
        for (final f in _frames)
          {
            'buildUs': f.buildDuration.inMicroseconds,
            'rasterUs': f.rasterDuration.inMicroseconds,
            'totalUs': f.totalSpan.inMicroseconds,
          },
      ],
    };
    if (operation == 'stop' && _recording) {
      SchedulerBinding.instance.removeTimingsCallback(_collect);
      _recording = false;
    }
    return jsonEncode(result);
  }
  throw ArgumentError.value(operation);
}
