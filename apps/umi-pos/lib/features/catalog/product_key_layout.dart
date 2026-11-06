import 'dart:math' as math;

import 'package:flutter/rendering.dart';

/// Places keys in catalog order. Only an existing local frequency signal spans rows.
final class ProductKeyGridDelegate extends SliverGridDelegate {
  const ProductKeyGridDelegate({
    required this.columns,
    required this.count,
    required this.frequent,
    required this.rowExtent,
  });

  final int columns, count;
  final Set<int> frequent;
  final double rowExtent;

  @override
  SliverGridLayout getLayout(SliverConstraints constraints) {
    const gap = 8.0;
    final width = math.max(
      0.0,
      (constraints.crossAxisExtent - gap * (columns - 1)) / columns,
    );
    final occupied = <int>{};
    final geometry = <SliverGridGeometry>[];
    var cell = 0;
    for (var index = 0; index < count; index++) {
      while (occupied.contains(cell)) {
        cell++;
      }
      final row = cell ~/ columns;
      final column = cell % columns;
      final span = frequent.contains(index) ? 2 : 1;
      for (var offset = 0; offset < span; offset++) {
        occupied.add(cell + offset * columns);
      }
      final cross = column * (width + gap);
      geometry.add(
        SliverGridGeometry(
          scrollOffset: row * (rowExtent + gap),
          crossAxisOffset:
              axisDirectionIsReversed(constraints.crossAxisDirection)
              ? constraints.crossAxisExtent - cross - width
              : cross,
          mainAxisExtent: rowExtent * span + gap * (span - 1),
          crossAxisExtent: width,
        ),
      );
      cell++;
    }
    return _ProductKeyGridLayout(geometry);
  }

  @override
  bool shouldRelayout(ProductKeyGridDelegate oldDelegate) =>
      columns != oldDelegate.columns ||
      count != oldDelegate.count ||
      rowExtent != oldDelegate.rowExtent ||
      frequent.length != oldDelegate.frequent.length ||
      !frequent.containsAll(oldDelegate.frequent);
}

final class _ProductKeyGridLayout extends SliverGridLayout {
  const _ProductKeyGridLayout(this.geometry);
  final List<SliverGridGeometry> geometry;

  @override
  SliverGridGeometry getGeometryForChildIndex(int index) => geometry.isEmpty
      ? const SliverGridGeometry(
          scrollOffset: 0,
          crossAxisOffset: 0,
          mainAxisExtent: 0,
          crossAxisExtent: 0,
        )
      : geometry[index];

  @override
  int getMinChildIndexForScrollOffset(double scrollOffset) {
    for (var index = 0; index < geometry.length; index++) {
      if (geometry[index].trailingScrollOffset >= scrollOffset) return index;
    }
    return math.max(0, geometry.length - 1);
  }

  @override
  int getMaxChildIndexForScrollOffset(double scrollOffset) {
    for (var index = geometry.length - 1; index >= 0; index--) {
      if (geometry[index].scrollOffset <= scrollOffset) return index;
    }
    return 0;
  }

  @override
  double computeMaxScrollOffset(int childCount) => geometry
      .take(childCount)
      .fold(0.0, (extent, key) => math.max(extent, key.trailingScrollOffset));
}
