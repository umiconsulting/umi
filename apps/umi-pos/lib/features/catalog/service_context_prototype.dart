import '../../core/theme/pos_ui.dart';
import '../../core/theme/umi_theme.dart';

/// An isolated prototype for the account location flow.
///
/// This widget does not read or write the cart. The render harness and the
/// standalone preview entrypoint use it to judge the interaction before a
/// production integration exists.
enum ServiceDestination { table, inHouseNoTable, takeout }

class ServiceContextPrototype extends StatefulWidget {
  const ServiceContextPrototype({
    this.startWithLegacyAccount = false,
    this.failFirstSend = false,
    super.key,
  });

  /// Starts on account 010: it has products but no location.
  final bool startWithLegacyAccount;

  /// Makes the first send fail, so the retry state is visible.
  final bool failFirstSend;

  @override
  State<ServiceContextPrototype> createState() =>
      _ServiceContextPrototypeState();
}

class _ServiceContextPrototypeState extends State<ServiceContextPrototype> {
  late bool _hasAccount;
  ServiceDestination? _destination;
  String? _table;
  bool _choosingTable = false;
  bool _sent = false;
  bool _sendFailed = false;
  int _sendAttempts = 0;

  @override
  void initState() {
    super.initState();
    _hasAccount = widget.startWithLegacyAccount;
    if (widget.startWithLegacyAccount) {
      _destination = null;
    }
  }

  void _selectDestination(ServiceDestination destination) {
    if (destination == ServiceDestination.table) {
      setState(() => _choosingTable = true);
      return;
    }
    setState(() {
      _hasAccount = true;
      _destination = destination;
      _table = null;
      _choosingTable = false;
      _sent = false;
      _sendFailed = false;
      _sendAttempts = 0;
    });
  }

  void _selectTable(String table) {
    setState(() {
      _hasAccount = true;
      _destination = ServiceDestination.table;
      _table = table;
      _choosingTable = false;
      _sent = false;
      _sendFailed = false;
      _sendAttempts = 0;
    });
  }

  void _changeLocation() {
    setState(() {
      _destination = null;
      _table = null;
      _choosingTable = false;
      _sendFailed = false;
      _sendAttempts = 0;
    });
  }

  void _sendToKitchen() {
    if (_destination == null || _sent) return;
    _sendAttempts++;
    if (widget.failFirstSend && _sendAttempts == 1) {
      setState(() => _sendFailed = true);
      return;
    }
    setState(() {
      _sent = true;
      _sendFailed = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return ColoredBox(
      color: palette.background,
      child: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final narrow = constraints.maxWidth < 520;
            return SingleChildScrollView(
              padding: EdgeInsets.all(narrow ? UmiSpacing.md : UmiSpacing.xl),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 680),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _PrototypeMasthead(narrow: narrow),
                      SizedBox(height: narrow ? UmiSpacing.md : UmiSpacing.lg),
                      PosSurface(
                        key: const ValueKey('service-context-surface'),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(
                            UmiRadius.surface,
                          ),
                          side: BorderSide(color: palette.outlineVariant),
                        ),
                        child: Padding(
                          padding: EdgeInsets.all(
                            narrow ? UmiSpacing.md : UmiSpacing.lg,
                          ),
                          child: _choosingTable
                              ? _buildTablePicker(context)
                              : _hasAccount
                              ? _buildAccount(context)
                              : _buildNewAccount(context),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildNewAccount(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Nueva cuenta', style: theme.textTheme.headlineSmall),
        const SizedBox(height: UmiSpacing.xs),
        Text(
          'Elige dónde se sirve. La ubicación queda guardada con la cuenta.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: palette.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: UmiSpacing.lg),
        _DestinationChooser(onSelected: _selectDestination),
        const SizedBox(height: UmiSpacing.md),
        _Hint(
          icon: PosGlyphs.infoOutline,
          text:
              'Si tocas un producto primero, la cuenta espera esta decisión y '
              'el producto entra una sola vez.',
        ),
      ],
    );
  }

  Widget _buildTablePicker(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            PosIconButton(
              key: const ValueKey('service-table-back'),
              tooltip: 'Volver',
              onPressed: () => setState(() => _choosingTable = false),
              icon: const PosIcon(PosGlyphs.arrowBack),
            ),
            const SizedBox(width: UmiSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Elige una mesa', style: theme.textTheme.headlineSmall),
                  const SizedBox(height: UmiSpacing.xs),
                  Text(
                    'Toca una mesa libre para abrir la cuenta.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: palette.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: UmiSpacing.lg),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth < 500 ? 1 : 2;
            final width =
                (constraints.maxWidth - (UmiSpacing.sm * (columns - 1))) /
                columns;
            return Wrap(
              spacing: UmiSpacing.sm,
              runSpacing: UmiSpacing.sm,
              children: [
                _TableChoice(
                  width: width,
                  number: 'Mesa 1',
                  detail: 'Libre',
                  onPressed: () => _selectTable('Mesa 1'),
                  key: const ValueKey('table-mesa-1'),
                ),
                _TableChoice(
                  width: width,
                  number: 'Mesa 2',
                  detail: 'Libre',
                  onPressed: () => _selectTable('Mesa 2'),
                  key: const ValueKey('table-mesa-2'),
                ),
                _TableChoice(
                  width: width,
                  number: 'Mesa 3',
                  detail: 'Ocupada · MXN 180',
                  onPressed: null,
                  key: const ValueKey('table-mesa-3'),
                ),
                _TableChoice(
                  width: width,
                  number: 'Mesa 4',
                  detail: 'Libre',
                  onPressed: () => _selectTable('Mesa 4'),
                  key: const ValueKey('table-mesa-4'),
                ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _buildAccount(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final location = _destination == null ? null : _locationLabel();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Cuenta 010', style: theme.textTheme.headlineSmall),
                  const SizedBox(height: UmiSpacing.xs),
                  if (location == null)
                    Text(
                      'Falta indicar dónde se sirve',
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: palette.error,
                      ),
                    )
                  else
                    _LocationLine(
                      destination: _destination!,
                      label: location,
                      onChange: _sent ? null : _changeLocation,
                    ),
                ],
              ),
            ),
            PosIconButton(
              tooltip: 'Opciones de cuenta',
              onPressed: () {},
              icon: const PosIcon(PosGlyphs.moreVert),
            ),
          ],
        ),
        if (_destination == null) ...[
          const SizedBox(height: UmiSpacing.md),
          _LocationRepair(onSelected: _selectDestination),
          const SizedBox(height: UmiSpacing.md),
          _Hint(
            icon: PosGlyphs.warningAmberOutlined,
            tone: _HintTone.warning,
            text:
                'Esta cuenta tiene artículos sin enviar. Elige la ubicación '
                'antes de enviarla a cocina.',
          ),
        ],
        const SizedBox(height: UmiSpacing.lg),
        const _Rule(),
        const SizedBox(height: UmiSpacing.md),
        _AccountLine(sent: _sent),
        const SizedBox(height: UmiSpacing.lg),
        const _Rule(),
        const SizedBox(height: UmiSpacing.md),
        const _MoneyRow(label: 'Subtotal', value: 'MXN 120.00'),
        const SizedBox(height: UmiSpacing.xs),
        const _MoneyRow(label: 'IVA incluido', value: 'MXN 16.55'),
        const SizedBox(height: UmiSpacing.md),
        const _MoneyRow(label: 'Total', value: 'MXN 120.00', emphasized: true),
        if (_sendFailed) ...[
          const SizedBox(height: UmiSpacing.md),
          const _SendFailure(),
        ],
        if (_sent) ...[
          const SizedBox(height: UmiSpacing.md),
          const _Hint(
            icon: PosGlyphs.checkCircle,
            text: 'Enviado a cocina · 19:27 · Cuenta abierta',
          ),
        ],
        const SizedBox(height: UmiSpacing.lg),
        if (_destination == null)
          PosButton(
            onPressed: null,
            child: const Text('Elige la ubicación para enviar'),
          )
        else if (!_sent)
          LayoutBuilder(
            builder: (context, constraints) {
              final narrow = constraints.maxWidth < 470;
              final send = PosButton.tonalIcon(
                key: const ValueKey('send-to-kitchen'),
                onPressed: _sendToKitchen,
                icon: PosIcon(
                  _sendFailed ? PosGlyphs.refresh : PosGlyphs.arrowUpward,
                ),
                label: Text(
                  _sendFailed ? 'Reintentar envío' : 'Enviar 2 a cocina',
                ),
              );
              final charge = PosOutlineButton.icon(
                onPressed: () {},
                icon: const PosIcon(PosGlyphs.paymentsOutlined),
                label: const Text('Cobrar'),
              );
              if (narrow) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    send,
                    const SizedBox(height: UmiSpacing.sm),
                    charge,
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(flex: 2, child: send),
                  const SizedBox(width: UmiSpacing.sm),
                  Expanded(child: charge),
                ],
              );
            },
          )
        else
          PosOutlineButton.icon(
            onPressed: () {},
            icon: const PosIcon(PosGlyphs.paymentsOutlined),
            label: const Text('Cobrar'),
          ),
      ],
    );
  }

  String _locationLabel() => switch (_destination!) {
    ServiceDestination.table => '${_table ?? 'Mesa'} · Comer aquí',
    ServiceDestination.inHouseNoTable => 'Sin mesa · Barra o mostrador',
    ServiceDestination.takeout => 'Para llevar',
  };
}

class _PrototypeMasthead extends StatelessWidget {
  const _PrototypeMasthead({required this.narrow});

  final bool narrow;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final badge = PosTag(
      backgroundColor: palette.primaryContainer,
      labelStyle: theme.textTheme.labelSmall?.copyWith(color: palette.primary),
      label: const Text('PROTOTIPO AISLADO'),
    );
    final description = Text(
      'Ubicación primero · una sola cuenta',
      textAlign: narrow ? TextAlign.start : TextAlign.end,
      style: theme.textTheme.bodySmall?.copyWith(
        color: palette.onSurfaceVariant,
      ),
    );
    if (narrow) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          badge,
          const SizedBox(height: UmiSpacing.sm),
          description,
        ],
      );
    }
    return Row(
      children: [
        badge,
        const SizedBox(width: UmiSpacing.md),
        Expanded(child: description),
      ],
    );
  }
}

class _DestinationChooser extends StatelessWidget {
  const _DestinationChooser({required this.onSelected});

  final ValueChanged<ServiceDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final vertical = constraints.maxWidth < 540;
        final options = [
          _DestinationOption(
            destination: ServiceDestination.table,
            icon: PosGlyphs.tableRestaurantOutlined,
            title: 'Mesa',
            detail: 'Elegir mesa',
            onSelected: onSelected,
          ),
          _DestinationOption(
            destination: ServiceDestination.inHouseNoTable,
            icon: PosGlyphs.restaurantOutlined,
            title: 'Sin mesa',
            detail: 'Barra o mostrador',
            onSelected: onSelected,
          ),
          _DestinationOption(
            destination: ServiceDestination.takeout,
            icon: PosGlyphs.takeoutDiningOutlined,
            title: 'Para llevar',
            detail: 'Sin mesa física',
            onSelected: onSelected,
          ),
        ];
        if (vertical) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (index, option) in options.indexed) ...[
                option,
                if (index != options.length - 1)
                  const SizedBox(height: UmiSpacing.sm),
              ],
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (index, option) in options.indexed) ...[
              Expanded(child: option),
              if (index != options.length - 1)
                const SizedBox(width: UmiSpacing.sm),
            ],
          ],
        );
      },
    );
  }
}

class _DestinationOption extends StatelessWidget {
  const _DestinationOption({
    required this.destination,
    required this.icon,
    required this.title,
    required this.detail,
    required this.onSelected,
  });

  final ServiceDestination destination;
  final PosGlyph icon;
  final String title;
  final String detail;
  final ValueChanged<ServiceDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return PosButton(
      key: ValueKey('service-${destination.name}'),
      onPressed: () => onSelected(destination),
      style: PosButton.styleFrom(
        minimumSize: const Size(0, 96),
        padding: const EdgeInsets.all(14),
        alignment: Alignment.centerLeft,
        backgroundColor: palette.surface,
        foregroundColor: palette.onSurface,
        side: BorderSide(color: palette.outlineVariant),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.primaryContainer,
              borderRadius: BorderRadius.circular(UmiRadius.control),
            ),
            child: PosIcon(icon, size: 22, color: palette.primary),
          ),
          const SizedBox(width: UmiSpacing.sm),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  detail,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: palette.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          PosIcon(
            PosGlyphs.chevronRight,
            size: 18,
            color: palette.onSurfaceVariant,
          ),
        ],
      ),
    );
  }
}

class _TableChoice extends StatelessWidget {
  const _TableChoice({
    required this.width,
    required this.number,
    required this.detail,
    required this.onPressed,
    super.key,
  });

  final double width;
  final String number;
  final String detail;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final available = onPressed != null;
    return SizedBox(
      width: width,
      child: PosButton(
        onPressed: onPressed,
        style: PosButton.styleFrom(
          minimumSize: const Size(0, 88),
          padding: const EdgeInsets.all(16),
          alignment: Alignment.centerLeft,
          backgroundColor: palette.surface,
          foregroundColor: palette.onSurface,
          side: BorderSide(
            color: available ? palette.outline : palette.outlineVariant,
          ),
        ),
        child: Row(
          children: [
            PosIcon(
              PosGlyphs.tableRestaurantOutlined,
              color: available ? palette.primary : palette.onSurfaceVariant,
            ),
            const SizedBox(width: UmiSpacing.sm),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(number, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 2),
                  Text(
                    detail,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: available
                          ? palette.onSurfaceVariant
                          : palette.error,
                    ),
                  ),
                ],
              ),
            ),
            if (available)
              PosIcon(PosGlyphs.arrowForward, size: 18, color: palette.primary),
          ],
        ),
      ),
    );
  }
}

class _LocationLine extends StatelessWidget {
  const _LocationLine({
    required this.destination,
    required this.label,
    required this.onChange,
  });

  final ServiceDestination destination;
  final String label;
  final VoidCallback? onChange;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final icon = switch (destination) {
      ServiceDestination.table => PosGlyphs.tableRestaurantOutlined,
      ServiceDestination.inHouseNoTable => PosGlyphs.restaurantOutlined,
      ServiceDestination.takeout => PosGlyphs.takeoutDiningOutlined,
    };
    return Row(
      children: [
        PosIcon(icon, size: 18, color: palette.primary),
        const SizedBox(width: UmiSpacing.sm),
        Expanded(
          child: Text(
            label,
            style: theme.textTheme.titleSmall?.copyWith(color: palette.primary),
          ),
        ),
        if (onChange != null)
          PosTextButton(
            onPressed: onChange,
            style: PosButton.styleFrom(
              minimumSize: const Size(48, 40),
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
            child: const Text('Cambiar'),
          ),
      ],
    );
  }
}

class _LocationRepair extends StatelessWidget {
  const _LocationRepair({required this.onSelected});

  final ValueChanged<ServiceDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return PosSurface(
      color: palette.tertiaryContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '¿Dónde está el cliente?',
              style: theme.textTheme.titleSmall?.copyWith(
                color: palette.onTertiaryContainer,
              ),
            ),
            const SizedBox(height: UmiSpacing.sm),
            Wrap(
              spacing: UmiSpacing.sm,
              runSpacing: UmiSpacing.sm,
              children: [
                PosOutlineButton(
                  key: const ValueKey('repair-table'),
                  onPressed: () => onSelected(ServiceDestination.table),
                  child: const Text('Mesa'),
                ),
                PosOutlineButton(
                  key: const ValueKey('repair-no-table'),
                  onPressed: () =>
                      onSelected(ServiceDestination.inHouseNoTable),
                  child: const Text('Sin mesa'),
                ),
                PosOutlineButton(
                  key: const ValueKey('repair-takeout'),
                  onPressed: () => onSelected(ServiceDestination.takeout),
                  child: const Text('Para llevar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AccountLine extends StatelessWidget {
  const _AccountLine({required this.sent});

  final bool sent;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 34,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: palette.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text('2', style: theme.textTheme.labelLarge),
        ),
        const SizedBox(width: UmiSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Capuccino', style: theme.textTheme.titleSmall),
              const SizedBox(height: UmiSpacing.xs),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  PosIcon(
                    sent ? PosGlyphs.checkCircle : PosGlyphs.schedule,
                    size: 16,
                    color: sent ? palette.primary : palette.tertiary,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    sent ? 'Enviada · 19:27' : 'Por enviar',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: sent ? palette.primary : palette.tertiary,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        Text('MXN 120.00', style: theme.textTheme.titleSmall),
      ],
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final style = emphasized
        ? theme.textTheme.headlineSmall
        : theme.textTheme.bodyMedium?.copyWith(color: palette.onSurfaceVariant);
    return Row(
      children: [
        Expanded(child: Text(label, style: style)),
        Text(value, style: style),
      ],
    );
  }
}

enum _HintTone { neutral, warning }

class _Hint extends StatelessWidget {
  const _Hint({
    required this.icon,
    required this.text,
    this.tone = _HintTone.neutral,
  });

  final PosGlyph icon;
  final String text;
  final _HintTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final warning = tone == _HintTone.warning;
    final ink = warning ? palette.error : palette.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.all(UmiSpacing.md),
      decoration: BoxDecoration(
        color: warning
            ? palette.tertiaryContainer
            : palette.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PosIcon(icon, size: 20, color: ink),
          const SizedBox(width: UmiSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(color: ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _SendFailure extends StatelessWidget {
  const _SendFailure();

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.all(UmiSpacing.md),
      decoration: BoxDecoration(
        color: palette.errorContainer,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PosIcon(
            PosGlyphs.warningAmberOutlined,
            size: 20,
            color: palette.error,
          ),
          const SizedBox(width: UmiSpacing.sm),
          Expanded(
            child: Text(
              'No se pudo enviar. Los 2 artículos siguen pendientes.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: palette.onErrorContainer,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Rule extends StatelessWidget {
  const _Rule();

  @override
  Widget build(BuildContext context) => Container(
    height: 1,
    color: PosTheme.of(context).colorScheme.outlineVariant,
  );
}
