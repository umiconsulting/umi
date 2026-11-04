import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/pos_ui.dart';
import '../../shared/money.dart';
import 'account_details_surface.dart';

/// A read-only preview. Reads never resume an account or claim its lease.
class AccountPreview extends StatefulWidget {
  const AccountPreview({
    required this.load,
    this.balance,
    this.refreshGeneration = 0,
    super.key,
  });
  final Future<Cart?> Function() load;
  final int refreshGeneration;
  final Future<Map<String, Object?>?> Function(Cart)? balance;
  @override
  State<AccountPreview> createState() => _AccountPreviewState();
}

class _AccountPreviewState extends State<AccountPreview> {
  int _request = 0;
  Cart? _cart;
  Map<String, Object?>? _balance;
  bool _loading = true;
  bool _failed = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AccountPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshGeneration != widget.refreshGeneration) _load();
  }

  Future<void> _load() async {
    final request = ++_request;
    final read = widget.load;
    final readBalance = widget.balance;
    setState(() {
      _loading = true;
      _failed = false;
      _balance = null;
    });
    try {
      final cart = await read();
      if (!mounted || request != _request) return;
      setState(() {
        _cart = cart;
        _loading = false;
      });
      if (cart != null && readBalance != null) {
        try {
          final balance = await readBalance(cart);
          if (mounted && request == _request)
            setState(() => _balance = balance);
        } catch (_) {
          /* Unknown balance remains explicitly unknown. */
        }
      }
    } catch (_) {
      if (mounted && request == _request) {
        setState(() {
          _cart = null;
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  String _money(Map<String, Object?> raw) => formatMinorUnits(
    (raw['minorUnits']! as num).toInt(),
    raw['currency']! as String,
  );

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final cart = _cart;
    if (_loading) return Text(es ? 'Consultando cuenta…' : 'Loading account…');
    if (_failed) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            es
                ? 'No se pudo consultar la cuenta.'
                : 'Could not load the account.',
          ),
          PosTextButton(
            onPressed: _load,
            child: Text(es ? 'Reintentar' : 'Retry'),
          ),
        ],
      );
    }
    if (cart == null) {
      return Text(
        es
            ? 'No hay una cuenta disponible para consultar.'
            : 'No account is available to preview.',
      );
    }
    final total = Map<String, Object?>.from(cart.totals['grandTotal']! as Map);
    final remaining = _balance?['remainingBalance'];
    final paid = _balance?['appliedAmount'];
    return Column(
      key: const ValueKey('account-preview'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          accountReference(cart),
          style: PosTheme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        for (final raw in cart.items) ...[
          Text('${raw['quantity']} × ${raw['productName']}'),
          if (raw['note'] != null)
            Text(
              raw['note']! as String,
              style: PosTheme.of(context).textTheme.bodySmall,
            ),
          const SizedBox(height: 8),
        ],
        if (cart.items.isEmpty) Text(es ? 'Sin productos' : 'No items'),
        const PosDivider(),
        Text('Total · ${_money(total)}'),
        if (paid is Map)
          Text(
            '${es ? 'Pagado' : 'Paid'} · ${_money(Map<String, Object?>.from(paid))}',
          ),
        Text(
          remaining is Map
              ? '${es ? 'Por cobrar' : 'Remaining'} · ${_money(Map<String, Object?>.from(remaining))}'
              : (es
                    ? 'Saldo por consultar en cobro'
                    : 'Review balance at checkout'),
        ),
        if (_balance?['blockedByUnknown'] == true)
          Text(
            es ? 'Hay un pago por confirmar' : 'A payment needs confirmation',
          ),
      ],
    );
  }
}
