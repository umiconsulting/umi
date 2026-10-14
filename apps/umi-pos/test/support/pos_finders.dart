import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_icons.dart';

extension PosFinders on CommonFinders {
  Finder byPosGlyph(PosGlyph glyph, {bool skipOffstage = true}) => byWidgetPredicate(
    (widget) => widget is PosIcon && widget.icon?.name == glyph.name,
    skipOffstage: skipOffstage,
  );
}
