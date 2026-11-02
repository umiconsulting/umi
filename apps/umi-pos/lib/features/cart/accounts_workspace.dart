import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/pos_ui.dart';
import '../../shared/widgets/inline_notice.dart';
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
    this.currentBusinessDate,
    this.notice,
    this.watchedAccount,
    this.readAccount,
    this.onAccountReleased,
    this.onCancelCarriedOver,
    this.onDismissNotice,
    super.key,
  });

  final bool withoutTable;
  final ValueChanged<bool> onViewChanged;
  final Future<List<Cart>> Function() load;
  final ValueChanged<Cart> onSelected;
  final VoidCallback? onNewAccount;
  final Widget? tables;
  final bool busy;
  final String? notice;
  final Cart? watchedAccount;
  final Future<Cart> Function(Cart)? readAccount;
  final VoidCallback? onAccountReleased;
  final Future<void> Function(List<Cart>)? onCancelCarriedOver;
  final VoidCallback? onDismissNotice;

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
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          es ? 'Servicio en salón' : 'Dining service',
                          style: PosTheme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: PosTheme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          es ? 'Cuentas y mesas' : 'Accounts and tables',
                          style: PosTheme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  if (onNewAccount != null)
                    PosIconButton(
                      onPressed: busy ? null : onNewAccount,
                      tooltip: es ? 'Iniciar pedido' : 'Start order',
                      icon: const PosIcon(PosGlyphs.add, size: 20),
                    ),
                  if (tables != null) ...[
                    PosIconButton(
                      tooltip: es ? 'Mapa' : 'Map',
                      onPressed: () => onViewChanged(false),
                      icon: PosIcon(
                        PosGlyphs.mapOutlined,
                        size: 20,
                        color: !list
                            ? PosTheme.of(context).colorScheme.primary
                            : PosTheme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    PosIconButton(
                      tooltip: es ? 'Lista' : 'List',
                      onPressed: () => onViewChanged(true),
                      icon: PosIcon(
                        PosGlyphs.list,
                        size: 20,
                        color: list
                            ? PosTheme.of(context).colorScheme.primary
                            : PosTheme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
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
                      onDismissNotice: onDismissNotice,
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
