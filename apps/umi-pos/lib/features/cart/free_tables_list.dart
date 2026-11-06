import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/pos_ui.dart';

/// Physical free tables remain separate from the commercial account rows.
class FreeTablesList extends StatefulWidget {
  const FreeTablesList({
    required this.load,
    required this.onSelected,
    super.key,
  });
  final Future<List<FloorPlanElement>> Function() load;
  final ValueChanged<FloorPlanElement> onSelected;
  @override
  State<FreeTablesList> createState() => _FreeTablesListState();
}

class _FreeTablesListState extends State<FreeTablesList> {
  late Future<List<FloorPlanElement>> _tables;
  @override
  void initState() {
    super.initState();
    _tables = widget.load();
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const PosDivider(),
        Row(
          children: [
            Expanded(
              child: Text(
                es ? 'Mesas libres' : 'Free tables',
                style: PosTheme.of(context).textTheme.titleMedium,
              ),
            ),
            PosIconButton(
              tooltip: es ? 'Actualizar mesas' : 'Refresh tables',
              onPressed: () => setState(() => _tables = widget.load()),
              icon: const PosIcon(PosGlyphs.refresh),
            ),
          ],
        ),
        FutureBuilder<List<FloorPlanElement>>(
          future: _tables,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return Text(es ? 'Consultando mesas…' : 'Loading tables…');
            }
            if (snapshot.hasError) {
              return Text(
                es
                    ? 'Estado de mesas no disponible. Actualiza para reintentar.'
                    : 'Table state unavailable. Refresh to retry.',
              );
            }
            final tables = snapshot.data ?? [];
            if (tables.isEmpty) {
              return Text(es ? 'No hay mesas libres.' : 'No free tables.');
            }
            return Column(
              children: [
                for (final table in tables)
                  PosListRow(
                    key: ValueKey('free-table-${table.id}'),
                    title: Text(table.label),
                    subtitle: Text(
                      '${table.capacity} ${es ? 'lugares · Libre' : 'seats · Free'}',
                    ),
                    leading: const PosIcon(PosGlyphs.tableRestaurantOutlined),
                    trailing: const PosIcon(PosGlyphs.chevronRight),
                    onTap: () => widget.onSelected(table),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}
