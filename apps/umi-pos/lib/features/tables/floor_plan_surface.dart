import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/umi_theme.dart';
import '../entry/entry_controller.dart';
import 'floor_plan_controller.dart';

Future<void> showFloorPlan(
  BuildContext context, {
  required FloorPlanController controller,
  required EntryController entry,
}) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => FloorPlanSurface(controller: controller, entry: entry),
  ),
);

class FloorPlanSurface extends StatefulWidget {
  const FloorPlanSurface({
    super.key,
    required this.controller,
    required this.entry,
  });
  final FloorPlanController controller;
  final EntryController entry;
  @override
  State<FloorPlanSurface> createState() => _FloorPlanSurfaceState();
}

class _FloorPlanSurfaceState extends State<FloorPlanSurface>
    with WidgetsBindingObserver {
  Timer? _timer;
  String? _areaId;
  String? _context;
  bool _list = false;
  bool _active = true;
  bool _returningToEntry = false;

  bool get _hasOperatorContext {
    final state = widget.entry.state;
    return state.phase == EntryPhase.ready &&
        state.selectedTenant != null &&
        state.selectedBranch != null &&
        state.operator != null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.addListener(_changed);
    widget.entry.addListener(_entryChanged);
    widget.controller.clear();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_active) _load();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) _load();
  }

  void _entryChanged() => _load();
  void _changed() {
    if (mounted) setState(() {});
  }

  void _load() {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator?.id;
    if (!_hasOperatorContext ||
        merchant == null ||
        location == null ||
        operator == null) {
      if (_context != null) {
        _context = null;
        widget.controller.clear();
      }
      if (!_returningToEntry) {
        _returningToEntry = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _returningToEntry = false;
          if (!_hasOperatorContext) {
            // Close the map and any table dialog above the guarded entry screen.
            Navigator.of(context).popUntil((route) => route.isFirst);
          }
        });
      }
      return;
    }
    final scope = '$merchant:$location:$operator';
    if (_context != scope) {
      _context = scope;
      _areaId = null;
    }
    unawaited(
      widget.controller.load(
        merchant,
        PosFloorPlanQuery(locationId: location, operatorSessionId: operator),
      ),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    widget.entry.removeListener(_entryChanged);
    widget.controller.removeListener(_changed);
    widget.controller.clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    if (!_hasOperatorContext) {
      return Scaffold(
        appBar: AppBar(title: Text(es ? 'Mesas' : 'Tables')),
        body: Center(
          child: Text(
            es
                ? 'Ingresa tu PIN de operador para ver las mesas.'
                : 'Enter your operator PIN to view tables.',
          ),
        ),
      );
    }
    final controller = widget.controller;
    final document = controller.plan?.published;
    final areas = document == null
        ? <FloorPlanArea>[]
        : FloorPlanDocument.fromJson(
            document,
          ).areas.map(FloorPlanArea.fromJson).toList();
    final area =
        areas.where((value) => value.id == _areaId).firstOrNull ??
        areas.firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: Text(es ? 'Mesas' : 'Tables'),
        actions: [
          IconButton(
            tooltip: es ? 'Actualizar' : 'Refresh',
            onPressed: controller.loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: _list
                ? (es ? 'Ver plano' : 'Show map')
                : (es ? 'Ver lista' : 'Show list'),
            onPressed: () => setState(() => _list = !_list),
            icon: Icon(_list ? Icons.map_outlined : Icons.list),
          ),
        ],
      ),
      body: Column(
        children: [
          if (controller.loading) const LinearProgressIndicator(),
          if (controller.failed)
            MaterialBanner(
              content: Text(
                es
                    ? 'No se pudo actualizar el plano. La información puede estar desactualizada.'
                    : 'Could not refresh the floor plan. The information may be out of date.',
              ),
              actions: [
                TextButton(
                  onPressed: _load,
                  child: Text(es ? 'Reintentar' : 'Retry'),
                ),
              ],
            ),
          if (controller.refreshedAt != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                '${es ? 'Plano actualizado' : 'Map refreshed'}: ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(controller.refreshedAt!))}',
              ),
            ),
          if (areas.isNotEmpty)
            FloorPlanAreaSelector(
              areas: areas,
              selectedAreaId: area?.id,
              onSelect: (value) => setState(() => _areaId = value),
            ),
          Expanded(
            child: area == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        controller.loading
                            ? (es ? 'Carga del plano…' : 'Loading floor plan…')
                            : controller.failed
                            ? (es
                                  ? 'Plano no disponible.'
                                  : 'Floor plan unavailable.')
                            : (es
                                  ? 'Publica un plano desde el dashboard para ver las mesas aquí.'
                                  : 'Publish a floor plan from the dashboard to see tables here.'),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : _list
                ? ListView(
                    children: area.elements
                        .map(FloorPlanElement.fromJson)
                        .where((element) => element.kind == 'table')
                        .map(
                          (element) => ListTile(
                            leading: const Icon(
                              Icons.table_restaurant_outlined,
                            ),
                            title: Text(element.label),
                            subtitle: Text(
                              '${element.capacity} ${es ? 'lugares' : 'seats'}',
                            ),
                            onTap: () => _details(element, es),
                          ),
                        )
                        .toList(),
                  )
                : FloorPlanMap(
                    key: ValueKey('$_context:${area.id}'),
                    area: area,
                    onTableTap: (element) => _details(element, es),
                  ),
          ),
        ],
      ),
    );
  }

  void _details(FloorPlanElement element, bool es) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(element.label),
        content: Text('${element.capacity} ${es ? 'lugares' : 'seats'}'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(es ? 'Cerrar' : 'Close'),
          ),
        ],
      ),
    );
  }
}

/// Counts placed tables in an area. Derived from published geometry only.
int floorPlanTableCount(FloorPlanArea area) => area.elements
    .map(FloorPlanElement.fromJson)
    .where((element) => element.kind == 'table')
    .length;

/// Table count for one area, phrased for the active locale.
String floorPlanTableCountLabel(int count, {required bool spanish}) => spanish
    ? (count == 1 ? '1 mesa' : '$count mesas')
    : (count == 1 ? '1 table' : '$count tables');

/// Horizontal area selector. Each tab shows the area name and its table count.
class FloorPlanAreaSelector extends StatelessWidget {
  const FloorPlanAreaSelector({
    super.key,
    required this.areas,
    required this.selectedAreaId,
    required this.onSelect,
  });

  final List<FloorPlanArea> areas;
  final String? selectedAreaId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          bottom: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: SizedBox(
        height: 68,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
          itemCount: areas.length,
          itemBuilder: (context, index) =>
              _tab(context, theme, areas[index], spanish),
        ),
      ),
    );
  }

  Widget _tab(
    BuildContext context,
    ThemeData theme,
    FloorPlanArea area,
    bool spanish,
  ) {
    final scheme = theme.colorScheme;
    final selected = area.id == selectedAreaId;
    final color = selected ? scheme.primary : scheme.onSurfaceVariant;
    final countLabel = floorPlanTableCountLabel(
      floorPlanTableCount(area),
      spanish: spanish,
    );
    return Semantics(
      button: true,
      selected: selected,
      label: '${area.name}, $countLabel',
      child: InkWell(
        onTap: () => onSelect(area.id),
        child: Container(
          constraints: const BoxConstraints(minWidth: 96),
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? scheme.primary : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                area.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleMedium?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                countLabel,
                maxLines: 1,
                style: theme.textTheme.bodySmall?.copyWith(color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FloorPlanMap extends StatelessWidget {
  const FloorPlanMap({super.key, required this.area, required this.onTableTap});
  final FloorPlanArea area;
  final ValueChanged<FloorPlanElement> onTableTap;

  @override
  Widget build(BuildContext context) {
    final palette = _FloorPlanPalette.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = math.min(
          constraints.maxWidth / area.width,
          constraints.maxHeight / area.height,
        );
        return Center(
          child: InteractiveViewer(
            minScale: 1,
            maxScale: 4,
            child: SizedBox(
              width: area.width * scale,
              height: area.height * scale,
              child: DecoratedBox(
                decoration: BoxDecoration(color: palette.canvas),
                child: Stack(
                  children: [
                    for (final element in area.elements.map(
                      FloorPlanElement.fromJson,
                    ))
                      Positioned(
                        left: (element.x - element.width / 2) * scale,
                        top: (element.y - element.height / 2) * scale,
                        width: element.width * scale,
                        height: element.height * scale,
                        child: Transform.rotate(
                          angle: element.rotation * math.pi / 180,
                          child: _FloorPlanElement(
                            element: element,
                            palette: palette,
                            onTap: element.kind == 'table'
                                ? () => onTableTap(element)
                                : null,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// One published element: a white shape with a bold label above a divider and
/// the seat count below it, for tables.
class _FloorPlanElement extends StatelessWidget {
  const _FloorPlanElement({
    required this.element,
    required this.palette,
    this.onTap,
  });

  final FloorPlanElement element;
  final _FloorPlanPalette palette;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final isTable = element.kind == 'table';
    final border = BorderSide(color: palette.borderFor(element.kind));
    return Semantics(
      label: isTable ? '${element.label}, ${element.capacity}' : element.label,
      button: isTable,
      child: Material(
        key: ValueKey('floor-plan-element-${element.id}'),
        color: palette.fillFor(element.kind),
        shape: element.shape == 'round'
            ? CircleBorder(side: border)
            : RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(isTable ? 8 : 2),
                side: border,
              ),
        clipBehavior: Clip.antiAlias,
        elevation: isTable ? palette.tableElevation : 0,
        shadowColor: palette.shadow,
        surfaceTintColor: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: LayoutBuilder(
            builder: (context, constraints) =>
                _content(constraints.maxWidth, constraints.maxHeight),
          ),
        ),
      ),
    );
  }

  Widget _content(double width, double height) {
    final isTable = element.kind == 'table';
    if (math.min(width, height) < 12) return const SizedBox.expand();
    // Small elements keep only the label; the divider and seats need room.
    final detailed = isTable && width >= 28 && height >= 32;
    final band = detailed ? height / 2 : height;
    final style = TextStyle(
      color: palette.labelFor(element.kind),
      fontWeight: FontWeight.w700,
      fontSize: math.min(band * 0.55, width * 0.4).clamp(7.0, 26.0),
      height: 1.1,
    );
    final label = Padding(
      padding: EdgeInsets.symmetric(horizontal: width * 0.06),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          element.label,
          maxLines: 1,
          textAlign: TextAlign.center,
          style: style,
        ),
      ),
    );
    if (!detailed) return Center(child: label);
    return Column(
      children: [
        Expanded(child: Center(child: label)),
        Container(
          key: ValueKey('floor-plan-divider-${element.id}'),
          height: 1,
          color: palette.divider,
        ),
        Expanded(
          child: element.capacity > 0
              ? FloorPlanSeatDots(
                  key: ValueKey('floor-plan-seats-${element.id}'),
                  count: element.capacity,
                  color: palette.seat,
                )
              : const SizedBox.expand(),
        ),
      ],
    );
  }
}

/// Compact seat dots that represent a table's capacity in the lower band.
class FloorPlanSeatDots extends StatelessWidget {
  const FloorPlanSeatDots({
    super.key,
    required this.count,
    required this.color,
  });

  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.infinite,
    painter: _FloorPlanSeatDotPainter(count: count, color: color),
  );
}

class _FloorPlanSeatDotPainter extends CustomPainter {
  const _FloorPlanSeatDotPainter({required this.count, required this.color});

  final int count;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (count <= 0 || size.width <= 0 || size.height <= 0) return;
    final rows = count <= 4 ? 1 : (count <= 8 ? 2 : 3);
    final perRow = (count / rows).ceil();
    final diameter = math.min(
      math.min(size.height / (rows * 1.7), size.width / (perRow * 2.2)),
      12.0,
    );
    if (diameter < 1.5) return;
    final gap = diameter * 0.8;
    final pitch = diameter + gap;
    final paint = Paint()..color = color;
    var top = (size.height - (rows * diameter + (rows - 1) * gap)) / 2;
    var remaining = count;
    for (var row = 0; row < rows; row++) {
      final inRow = math.min(perRow, remaining);
      remaining -= inRow;
      var left = (size.width - (inRow * diameter + (inRow - 1) * gap)) / 2;
      for (var dot = 0; dot < inRow; dot++) {
        canvas.drawCircle(
          Offset(left + diameter / 2, top + diameter / 2),
          diameter / 2,
          paint,
        );
        left += pitch;
      }
      top += pitch;
    }
  }

  @override
  bool shouldRepaint(_FloorPlanSeatDotPainter oldDelegate) =>
      oldDelegate.count != count || oldDelegate.color != color;
}

/// Floor surface colors resolved from the active theme.
class _FloorPlanPalette {
  const _FloorPlanPalette({
    required this.dark,
    required this.scheme,
    required this.canvas,
    required this.tableFill,
    required this.tableBorder,
    required this.divider,
    required this.seat,
    required this.label,
    required this.tableElevation,
    required this.shadow,
  });

  factory _FloorPlanPalette.of(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return _FloorPlanPalette(
      dark: dark,
      scheme: theme.colorScheme,
      canvas: dark ? const Color(0xff15161a) : const Color(0xffededf2),
      tableFill: dark ? const Color(0xff25272e) : Colors.white,
      tableBorder: dark ? const Color(0xff3b3e47) : const Color(0xffdfdfe7),
      divider: dark ? const Color(0xff3b3e47) : const Color(0xffe6e6ec),
      seat: dark ? const Color(0xffa7adb8) : const Color(0xff9ba1ab),
      label: theme.colorScheme.onSurface,
      tableElevation: dark ? 0 : 1.5,
      shadow: const Color(0x1a101828),
    );
  }

  final bool dark;
  final ColorScheme scheme;
  final Color canvas;
  final Color tableFill;
  final Color tableBorder;
  final Color divider;
  final Color seat;
  final Color label;
  final double tableElevation;
  final Color shadow;

  Color fillFor(String kind) => switch (kind) {
    'table' => tableFill,
    'wall' => dark ? const Color(0xff5a6577) : const Color(0xff64748b),
    'counter' => dark ? const Color(0xff4a4231) : const Color(0xffe8ddc9),
    'door' => dark ? const Color(0xff2e4557) : const Color(0xffbfd7e5),
    'label' => Colors.transparent,
    _ => scheme.surfaceContainerHighest,
  };

  Color borderFor(String kind) => switch (kind) {
    'table' => tableBorder,
    'wall' => dark ? const Color(0xff76829a) : const Color(0xff526075),
    'counter' => dark ? const Color(0xff5e5440) : const Color(0xffcbbda2),
    'door' => dark ? const Color(0xff3d5a70) : const Color(0xff9dbece),
    'label' => Colors.transparent,
    _ => scheme.outlineVariant,
  };

  Color labelFor(String kind) => switch (kind) {
    'wall' => Colors.white,
    'label' => scheme.onSurfaceVariant,
    _ => label,
  };
}
