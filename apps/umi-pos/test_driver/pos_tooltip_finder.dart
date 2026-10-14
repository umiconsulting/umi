import 'package:flutter_driver/flutter_driver.dart';

/// Selector del instrumento para los tooltips propios.
class PosTooltipFinder extends SerializableFinder {
  const PosTooltipFinder(this.message);
  final String message;
  @override
  String get finderType => 'PosTooltip';
  @override
  Map<String, String> serialize() => super.serialize()..['message'] = message;
}

class PosEditableFieldFinder extends SerializableFinder {
  const PosEditableFieldFinder(this.label);
  final String label;
  @override
  String get finderType => 'PosEditableField';
  @override
  Map<String, String> serialize() => super.serialize()..['label'] = label;
}
