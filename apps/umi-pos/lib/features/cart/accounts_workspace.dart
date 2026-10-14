import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/pos_ui.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/station_document.dart';
import 'open_accounts_surface.dart';

/// The account entry point shares one location for tables and named accounts.
class AccountsWorkspace extends StatelessWidget {
  const AccountsWorkspace({
    required this.withoutTable,
    required this.onViewChanged,
    required this.load,
    required this.onSelected,
    required this.onNewAccount,
    this.tables,
    this.busy = false,
    this.chooseOrderType = false,
    this.currentBusinessDate,
    this.notice,
    this.watchedAccount,
    this.readAccount,
    this.onAccountReleased,
    this.onCancelCarriedOver,
    super.key,
  });

  final bool withoutTable;
  final ValueChanged<bool> onViewChanged;
  final Future<List<Cart>> Function() load;
  final ValueChanged<Cart> onSelected;
  final VoidCallback? onNewAccount;
  final Widget? tables;
  final bool busy;
  final bool chooseOrderType;
  final String? notice;
  final Cart? watchedAccount;
  final Future<Cart> Function(Cart)? readAccount;
  final VoidCallback? onAccountReleased;
  final Future<void> Function(List<Cart>)? onCancelCarriedOver;

  /// The date the server is trading under right now, taken from the cart the till is
  /// working on. The account list uses it to tell today's accounts from the ones left
  /// over from a previous day; see [OpenAccountsList].
  final String? currentBusinessDate;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final list = withoutTable || tables == null;
    return PosPage(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 16,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StationHeading(title: es ? 'Cuentas' : 'Accounts'),
                    if (tables != null)
                      PosSegmented<bool>(
                        showSelectedIcon: false,
                        segments: [
                          PosSegment(
                            value: true,
                            label: Text(es ? 'Lista' : 'List'),
                          ),
                          PosSegment(
                            value: false,
                            label: Text(es ? 'Mapa' : 'Map'),
                          ),
                        ],
                        selected: {list},
                        onSelectionChanged: (value) =>
                            onViewChanged(value.first),
                      ),
                    if (onNewAccount != null)
                      PosButton(
                        onPressed: busy ? null : onNewAccount,
                        child: Text(
                          chooseOrderType
                              ? (es ? 'Nuevo pedido' : 'New order')
                              : es
                              ? 'Nueva cuenta sin mesa'
                              : 'New account without table',
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (notice != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: InlineNotice(message: notice!),
              ),
            Expanded(
              child: list
                  ? OpenAccountsList(
                      watchedAccount: watchedAccount,
                      readAccount: readAccount,
                      onAccountReleased: onAccountReleased,
                      load: load,
                      showFulfillmentFilter: true,
                      showDateFilter: true,
                      onCancelCarriedOver: onCancelCarriedOver,
                      currentBusinessDate: currentBusinessDate,
                      onSelected: onSelected,
                    )
                  : tables!,
            ),
          ],
        ),
      ),
    );
  }
}
