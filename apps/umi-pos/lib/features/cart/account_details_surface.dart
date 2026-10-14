import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/pos_ui.dart';

String accountDisplayTitle(Cart cart, {required bool spanish}) =>
    cart.accountFolio ?? (spanish ? 'Cuenta' : 'Account');

String accountReference(Cart cart) => cart.accountFolio ?? cart.id;

/// Whether the account on screen holds nothing a person would recognize.
///
/// A bare account has no lines, no table, no name and no fired order. It is the
/// draft every operator session opens with, and it is not an account at all:
/// nobody ordered anything, nobody sat anywhere, and the open-accounts list cannot
/// find it — the API asks the same three questions
/// (`openAccountIds`, apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts).
///
/// The till reads this to stop `Nueva cuenta` from doing two useless things at
/// once: saving a record with nothing in it, and burning the next account number
/// for a customer who does not exist. The rule is the one the till already writes
/// down for an operator who leaves with an empty order — that order is closed, never
/// saved (`SaleLifecycleController.prepareForOperatorExit`).
bool accountIsBare(Cart cart) =>
    cart.items.isEmpty &&
    cart.tableId == null &&
    cart.accountName == null &&
    cart.firedOrderId == null;

String accountOpenedAt(BuildContext context, Cart cart) {
  final time = DateTime.tryParse(cart.createdAt ?? '');
  if (time == null) return '—';
  final local = time.toLocal();
  final date =
      '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}';
  final clock =
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  return '$date $clock';
}

Future<String?> showAccountNameDialog(
  BuildContext context, {
  String? initialName,
  bool saveAndLeave = false,
}) async {
  final es = Localizations.localeOf(context).languageCode == 'es';
  final name = TextEditingController(text: initialName);
  final result = await showPosDialog<String>(
    context: context,
    builder: (dialogContext) => PosAlertDialog(
      title: Text(
        saveAndLeave
            ? (es ? 'Guardar cuenta' : 'Save account')
            : (es ? 'Nombre de cuenta' : 'Account name'),
      ),
      content: SingleChildScrollView(
        child: PosField(
          controller: name,
          autofocus: true,
          maxLength: 120,
          decoration: PosFieldDecoration(
            labelText: es ? 'Nombre (opcional)' : 'Name (optional)',
            hintText: es ? 'Ej. Ana · para llevar' : 'E.g. Ana · takeout',
            helperText: es
                ? 'Puedes identificar la cuenta por su folio aunque no tenga nombre.'
                : 'The reference identifies the account even without a name.',
          ),
          onSubmitted: (_) => Navigator.pop(dialogContext, name.text.trim()),
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: Text(es ? 'Cancelar' : 'Cancel'),
        ),
        PosButton(
          onPressed: () => Navigator.pop(dialogContext, name.text.trim()),
          child: Text(
            saveAndLeave
                ? (es ? 'Guardar y salir' : 'Save and leave')
                : (es ? 'Guardar nombre' : 'Save name'),
          ),
        ),
      ],
    ),
  );
  name.dispose();
  return result;
}

class AccountTablePicker extends StatelessWidget {
  const AccountTablePicker({required this.areas, super.key});
  final List<FloorPlanArea> areas;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return PosAlertDialog(
      title: Text(es ? 'Asignar mesa' : 'Assign table'),
      content: SizedBox(
        width: 440,
        height: 360,
        child: ListView(
          children: [
            for (final area in areas)
              for (final table
                  in area.elements
                      .map(FloorPlanElement.fromJson)
                      .where((element) => element.kind == 'table'))
                PosListRow(
                  title: Text(table.label),
                  leading: const PosIcon(PosGlyphs.tableRestaurantOutlined),
                  onTap: () => Navigator.pop(context, table),
                ),
          ],
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(es ? 'Cancelar' : 'Cancel'),
        ),
      ],
    );
  }
}
