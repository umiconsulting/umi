// Read-only measurements of the navigation that the native renderer paints.
import 'dart:convert';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart' as test;
import 'package:umi_pos/core/theme/pos_ui.dart';

String navigationMeasurements() {
  final navigation = test.find.byType(PosNavigation);
  final element = navigation.evaluate().single;
  final widget = element.widget as PosNavigation;
  final names = {
    ...widget.destinations.cast<PosDestination>().map((d) => d.label),
    'Más',
    'More',
  };
  final results = <Map<String, Object?>>[];
  for (final e
      in test.find
          .descendant(of: navigation, matching: test.find.byType(Text))
          .evaluate()) {
    final text = (e.widget as Text).data;
    if (!names.contains(text)) continue;
    final render = e.findRenderObject()! as RenderParagraph;
    final origin = render.localToGlobal(Offset.zero);
    final boxes = render.getBoxesForSelection(
      TextSelection(baseOffset: 0, extentOffset: text!.length),
    );
    results.add({
      'text': text,
      'left': origin.dx,
      'top': origin.dy,
      'width': render.size.width,
      'height': render.size.height,
      'didExceedMaxLines': render.didExceedMaxLines,
      'boxes': [
        for (final box in boxes)
          {
            'left': box.left,
            'right': box.right,
            'top': box.top,
            'bottom': box.bottom,
          },
      ],
    });
  }
  return jsonEncode({
    'method':
        'Read-only RenderParagraph selection boxes and geometry from visible PosNavigation labels',
    'locale': Localizations.localeOf(element).languageCode,
    'scaled13': MediaQuery.textScalerOf(element).scale(13),
    'selectedIndex': widget.selectedIndex,
    'destinations': widget.destinations
        .cast<PosDestination>()
        .map((d) => d.label)
        .toList(),
    'labels': results,
  });
}
