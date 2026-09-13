import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

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
    if (merchant == null || location == null || operator == null) {
      if (_context != null) {
        _context = null;
        widget.controller.clear();
      }
      return;
    }
    final context = '$merchant:$location:$operator';
    if (_context != context) {
      _context = context;
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
          if (area != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: DropdownButton<String>(
                value: area.id,
                isExpanded: true,
                items: areas
                    .map(
                      (value) => DropdownMenuItem(
                        value: value.id,
                        child: Text(value.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _areaId = value),
              ),
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

class FloorPlanMap extends StatelessWidget {
  const FloorPlanMap({super.key, required this.area, required this.onTableTap});
  final FloorPlanArea area;
  final ValueChanged<FloorPlanElement> onTableTap;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
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
              decoration: const BoxDecoration(color: Color(0xfff9fbf9)),
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
                        child: Semantics(
                          label: element.kind == 'table'
                              ? '${element.label}, ${element.capacity}'
                              : element.label,
                          button: element.kind == 'table',
                          child: Material(
                            color: _color(element.kind),
                            shape: element.shape == 'round'
                                ? const CircleBorder(
                                    side: BorderSide(color: Color(0xff879b92)),
                                  )
                                : RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                      element.kind == 'table' ? 8 : 2,
                                    ),
                                    side: const BorderSide(
                                      color: Color(0xff879b92),
                                    ),
                                  ),
                            child: InkWell(
                              onTap: element.kind == 'table'
                                  ? () => onTableTap(element)
                                  : null,
                              child: Center(
                                child: Text(
                                  element.label,
                                  textAlign: TextAlign.center,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: const Color(0xff172b22),
                                    fontSize: math.max(10, 14 * scale),
                                  ),
                                ),
                              ),
                            ),
                          ),
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

  Color _color(String kind) => switch (kind) {
    'table' => const Color(0xffdcebe4),
    'wall' => const Color(0xff64748b),
    'counter' => const Color(0xffe8ddc9),
    'door' => const Color(0xffbfd7e5),
    _ => const Color(0xfff1f5f9),
  };
}
