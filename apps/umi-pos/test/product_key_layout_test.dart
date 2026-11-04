import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/catalog/product_key_layout.dart';

void main() {
  SliverGridLayout layout({
    int columns = 4,
    Set<int> frequent = const {0, 1},
  }) =>
      ProductKeyGridDelegate(
        columns: columns,
        count: 8,
        frequent: frequent,
        rowExtent: 112,
      ).getLayout(
        const SliverConstraints(
          axisDirection: AxisDirection.down,
          growthDirection: GrowthDirection.forward,
          userScrollDirection: ScrollDirection.idle,
          scrollOffset: 0,
          precedingScrollExtent: 0,
          overlap: 0,
          remainingPaintExtent: 600,
          crossAxisExtent: 800,
          crossAxisDirection: AxisDirection.right,
          viewportMainAxisExtent: 600,
          remainingCacheExtent: 600,
          cacheOrigin: 0,
        ),
      );

  test('frequent keys span two rows and later keys fill the free cells', () {
    final grid = layout();
    expect(grid.getGeometryForChildIndex(0).mainAxisExtent, 232);
    expect(grid.getGeometryForChildIndex(1).mainAxisExtent, 232);
    expect(grid.getGeometryForChildIndex(2).mainAxisExtent, 112);
    expect(grid.getGeometryForChildIndex(4).scrollOffset, 120);
    expect(grid.getGeometryForChildIndex(4).crossAxisOffset, 404);
    expect(grid.computeMaxScrollOffset(8), 352);
    for (var index = 0; index < 8; index++) {
      final key = grid.getGeometryForChildIndex(index);
      expect(
        grid.getMinChildIndexForScrollOffset(key.scrollOffset),
        lessThanOrEqualTo(index),
      );
      expect(
        grid.getMaxChildIndexForScrollOffset(key.scrollOffset),
        greaterThanOrEqualTo(index),
      );
    }
  });

  test('keys stay regular when the device has no frequency signal', () {
    final grid = layout(frequent: {});
    expect(grid.getGeometryForChildIndex(0).mainAxisExtent, 112);
    expect(grid.getGeometryForChildIndex(4).scrollOffset, 120);
    expect(grid.computeMaxScrollOffset(8), 232);
  });

  test('phone keys retain row-major order with two frequent keys', () {
    final grid = layout(columns: 2);
    expect(grid.getGeometryForChildIndex(1).scrollOffset, 0);
    expect(grid.getGeometryForChildIndex(2).scrollOffset, 240);
    expect(grid.getGeometryForChildIndex(2).crossAxisOffset, 0);
  });
}
