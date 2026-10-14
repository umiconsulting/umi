part of 'pos_ui.dart';

class PosTag extends StatelessWidget {
  const PosTag({
    required this.label,
    this.avatar,
    this.backgroundColor,
    this.labelStyle,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    this.side,
    this.visualDensity,
    super.key,
  });
  final Widget label;
  final Widget? avatar;
  final Color? backgroundColor;
  final TextStyle? labelStyle;
  final EdgeInsetsGeometry? padding;
  final BorderSide? side;
  final PosVisualDensity? visualDensity;
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color:
          backgroundColor ??
          PosTheme.of(context).colorScheme.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(PosGeometry.controlRadius),
      border: side == null ? null : Border.fromBorderSide(side!),
    ),
    child: DefaultTextStyle(
      style: labelStyle ?? PosTheme.of(context).textTheme.labelMedium!,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (avatar != null) ...[avatar!, const SizedBox(width: 8)],
          Flexible(child: label),
        ],
      ),
    ),
  );
}

class PosChoice extends StatelessWidget {
  const PosChoice({
    required this.label,
    required this.selected,
    this.onSelected,
    this.avatar,
    this.showCheckmark = false,
    this.backgroundColor,
    this.selectedColor,
    this.labelStyle,
    this.padding,
    super.key,
  });
  final Widget label;
  final Widget? avatar;
  final bool selected, showCheckmark;
  final ValueChanged<bool>? onSelected;
  final Color? backgroundColor, selectedColor;
  final TextStyle? labelStyle;
  final EdgeInsetsGeometry? padding;
  @override
  Widget build(BuildContext context) {
    final p = PosTheme.of(context).colorScheme;
    return PosButton._(
      selected: selected,
      kind: selected ? 3 : 1,
      onPressed: onSelected == null ? null : () => onSelected!(!selected),
      icon: avatar,
      style: _buttonStyle(
        minimumSize: const Size.square(48),
        backgroundColor: selected
            ? selectedColor ?? p.primaryContainer
            : backgroundColor ?? p.surface,
        foregroundColor: selected ? p.primary : p.onSurface,
        textStyle: labelStyle,
        padding: padding,
      ),
      child: label,
    );
  }
}

class PosActionTag extends StatelessWidget {
  const PosActionTag({
    required this.label,
    this.onPressed,
    this.avatar,
    super.key,
  });
  final Widget label;
  final VoidCallback? onPressed;
  final Widget? avatar;
  @override
  Widget build(BuildContext context) => PosOutlineButton.icon(
    onPressed: onPressed,
    label: label,
    icon: avatar ?? const SizedBox.shrink(),
  );
}

class PosAvatar extends StatelessWidget {
  const PosAvatar({
    this.child,
    this.radius = 20,
    this.backgroundColor,
    this.foregroundColor,
    super.key,
  });
  final Widget? child;
  final double? radius;
  final Color? backgroundColor, foregroundColor;
  @override
  Widget build(BuildContext context) => Container(
    width: (radius ?? 20) * 2,
    height: (radius ?? 20) * 2,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color:
          backgroundColor ?? PosTheme.of(context).colorScheme.primaryContainer,
    ),
    child: DefaultTextStyle(
      style: PosTheme.of(context).textTheme.labelLarge!.copyWith(
        color: foregroundColor ?? PosTheme.of(context).colorScheme.primary,
      ),
      child: child ?? const SizedBox.shrink(),
    ),
  );
}

class PosBadge extends StatelessWidget {
  const PosBadge({
    this.label,
    this.child,
    this.isLabelVisible = true,
    this.backgroundColor,
    super.key,
  });
  PosBadge.count({
    required int count,
    this.child,
    this.isLabelVisible = true,
    this.backgroundColor,
    super.key,
  }) : label = Text('$count');
  final Widget? label, child;
  final bool isLabelVisible;
  final Color? backgroundColor;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ?child,
      if (isLabelVisible)
        Container(
          margin: const EdgeInsets.only(left: 4),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color:
                backgroundColor ??
                PosTheme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(8),
          ),
          child: DefaultTextStyle(
            style: PosTheme.of(context).textTheme.labelSmall!.copyWith(
              color: PosTheme.of(context).colorScheme.primary,
            ),
            child: label ?? const SizedBox(width: 4, height: 4),
          ),
        ),
    ],
  );
}

class PosSegment<T> {
  const PosSegment({
    required this.value,
    this.label,
    this.icon,
    this.enabled = true,
  });
  final T value;
  final Widget? label, icon;
  final bool enabled;
}

class PosSegmented<T> extends StatelessWidget {
  const PosSegmented({
    required this.segments,
    required this.selected,
    this.onSelectionChanged,
    this.showSelectedIcon = true,
    this.multiSelectionEnabled = false,
    this.emptySelectionAllowed = false,
    this.style,
    super.key,
  });
  final List<PosSegment<T>> segments;
  final Set<T> selected;
  final ValueChanged<Set<T>>? onSelectionChanged;
  final bool showSelectedIcon, multiSelectionEnabled, emptySelectionAllowed;
  final PosButtonStyle? style;
  static const styleFrom = _buttonStyle;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: segments.map((segment) {
      final checked = selected.contains(segment.value);
      final p = PosTheme.of(context).colorScheme;
      return PosButton._(
        selected: checked,
        kind: checked ? 3 : 1,
        onPressed: !segment.enabled || onSelectionChanged == null
            ? null
            : () {
                final values = multiSelectionEnabled ? {...selected} : <T>{};
                if (multiSelectionEnabled && checked) {
                  values.remove(segment.value);
                } else {
                  values.add(segment.value);
                }
                if (values.isNotEmpty || emptySelectionAllowed) {
                  onSelectionChanged!(values);
                }
              },
        icon: segment.icon,
        style: _buttonStyle(
          minimumSize: const Size.square(48),
          backgroundColor: checked
              ? style?.selectedBackgroundColor ?? p.primaryContainer
              : p.surface,
          foregroundColor: checked
              ? style?.selectedForegroundColor ?? p.primary
              : p.onSurface,
          side:
              checked &&
                  p.midnight &&
                  segment.enabled &&
                  onSelectionChanged != null
              ? BorderSide(color: p.signal)
              : null,
        ),
        child: segment.label ?? const SizedBox.shrink(),
      );
    }).toList(),
  );
}

class PosListRow extends StatelessWidget {
  const PosListRow({
    this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.onLongPress,
    this.selected = false,
    this.enabled = true,
    this.dense = false,
    this.isThreeLine = false,
    this.contentPadding = const EdgeInsets.symmetric(
      horizontal: 16,
      vertical: 12,
    ),
    this.tileColor,
    this.minTileHeight = 56,
    super.key,
  });
  final Widget? title, subtitle, leading, trailing;
  final VoidCallback? onTap, onLongPress;
  final bool selected, enabled, dense, isThreeLine;
  final EdgeInsetsGeometry? contentPadding;
  final Color? tileColor;
  final double minTileHeight;
  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final body = ConstrainedBox(
      constraints: BoxConstraints(minHeight: math.max(48, minTileHeight)),
      child: Container(
        color:
            tileColor ?? (selected ? theme.colorScheme.primaryContainer : null),
        padding: contentPadding,
        child: Row(
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 12)],
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null)
                    DefaultTextStyle(
                      style: theme.textTheme.titleMedium!,
                      child: title!,
                    ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 4),
                    DefaultTextStyle(
                      style: theme.textTheme.bodySmall!.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      child: subtitle!,
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 12), trailing!],
          ],
        ),
      ),
    );
    return onTap == null && onLongPress == null
        ? body
        : PosTapRegion(
            selected: selected,
            onTap: enabled ? onTap : null,
            onLongPress: enabled ? onLongPress : null,
            child: body,
          );
  }
}

class PosCheck extends StatelessWidget {
  const PosCheck({
    required this.value,
    required this.onChanged,
    this.tristate = false,
    this.activeColor,
    this.checkColor,
    super.key,
  });
  final bool? value;
  final ValueChanged<bool?>? onChanged;
  final bool tristate;
  final Color? activeColor, checkColor;
  @override
  Widget build(BuildContext context) => Semantics(
    checked: value == true,
    enabled: onChanged != null,
    child: PosIconButton(
      onPressed: onChanged == null
          ? null
          : () => onChanged!(
              tristate && value == false ? null : !(value ?? false),
            ),
      icon: PosIcon(
        value == true ? PosGlyphs.checkBox : PosGlyphs.checkBoxOutlineBlank,
        color: value == true
            ? activeColor ?? PosTheme.of(context).colorScheme.primary
            : PosTheme.of(context).colorScheme.outline,
      ),
    ),
  );
}

class PosRadioRow<T> extends StatelessWidget {
  const PosRadioRow({
    required this.value,
    required this.groupValue,
    required this.onChanged,
    this.title,
    this.subtitle,
    this.dense = false,
    this.contentPadding,
    super.key,
  });
  final T value;
  final T? groupValue;
  final ValueChanged<T?>? onChanged;
  final Widget? title, subtitle;
  final bool dense;
  final EdgeInsetsGeometry? contentPadding;
  @override
  Widget build(BuildContext context) => Semantics(
    checked: value == groupValue,
    inMutuallyExclusiveGroup: true,
    child: PosListRow(
      title: title,
      subtitle: subtitle,
      contentPadding:
          contentPadding ??
          const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      leading: PosIcon(
        value == groupValue
            ? PosGlyphs.radioButtonChecked
            : PosGlyphs.radioButtonUnchecked,
        color: PosTheme.of(context).colorScheme.primary,
      ),
      onTap: onChanged == null ? null : () => onChanged!(value),
    ),
  );
}

class PosSwitchRow extends StatelessWidget {
  const PosSwitchRow({
    required this.value,
    required this.onChanged,
    this.title,
    this.subtitle,
    this.dense = false,
    this.contentPadding,
    this.trailingWidth,
    super.key,
  });
  final bool value;
  final ValueChanged<bool>? onChanged;
  final Widget? title, subtitle;
  final bool dense;
  final EdgeInsetsGeometry? contentPadding;
  final double? trailingWidth;
  @override
  Widget build(BuildContext context) => Semantics(
    toggled: value,
    enabled: onChanged != null,
    child: PosListRow(
      title: title,
      subtitle: subtitle,
      contentPadding:
          contentPadding ??
          const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      onTap: onChanged == null ? null : () => onChanged!(!value),
      trailing: SizedBox(
        width: trailingWidth ?? 44,
        child: Center(
          child: Container(
            width: 44,
            height: 26,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: value
                  ? PosTheme.of(context).colorScheme.primary
                  : PosTheme.of(context).colorScheme.outline,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Align(
              alignment: value ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                width: 20,
                height: 20,
                decoration: const BoxDecoration(
                  color: PosColors.white,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class PosSelectItem<T> extends StatelessWidget {
  const PosSelectItem({
    required this.value,
    required this.child,
    this.enabled = true,
    super.key,
  });
  final T? value;
  final Widget child;
  final bool enabled;
  @override
  Widget build(BuildContext context) => child;
}

class PosSelect<T> extends StatelessWidget {
  const PosSelect({
    this.value,
    this.items,
    this.onChanged,
    this.hint,
    this.isExpanded = false,
    this.isDense = false,
    this.underline,
    this.icon,
    this.menuMaxHeight,
    super.key,
  });
  final T? value;
  final List<PosSelectItem<T>>? items;
  final ValueChanged<T?>? onChanged;
  final Widget? hint, underline, icon;
  final bool isExpanded, isDense;
  final double? menuMaxHeight;
  @override
  Widget build(BuildContext context) {
    final match = items?.where((item) => item.value == value).firstOrNull;
    return _PosMenuTrigger<T>(
      enabled: onChanged != null && (items?.isNotEmpty ?? false),
      onSelected: onChanged,
      currentValue: value,
      selection: true,
      maxHeight: menuMaxHeight,
      itemBuilder: (_) => [
        for (final item in items ?? <PosSelectItem<T>>[])
          PosMenuItem<T>(
            value: item.value,
            enabled: item.enabled,
            child: item.child,
          ),
      ],
      builder: (context, open, focus, expanded) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: isExpanded
            ? CrossAxisAlignment.stretch
            : CrossAxisAlignment.center,
        children: [
          Semantics(
            expanded: expanded,
            child: PosOutlineButton(
              focusNode: focus,
              onPressed: open,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: match?.child ?? hint ?? const Text('—')),
                  const SizedBox(width: 12),
                  icon ??
                      RotatedBox(
                        quarterTurns: expanded ? 2 : 0,
                        child: const PosIcon(PosGlyphs.expandMore, size: 18),
                      ),
                ],
              ),
            ),
          ),
          ?underline,
        ],
      ),
    );
  }
}

class PosSelectFormField<T> extends FormField<T> {
  PosSelectFormField({
    T? initialValue,
    T? value,
    List<PosSelectItem<T>>? items,
    ValueChanged<T?>? onChanged,
    PosFieldDecoration decoration = const PosFieldDecoration(),
    Widget? hint,
    bool isExpanded = false,
    super.validator,
    super.onSaved,
    super.autovalidateMode,
    super.key,
  }) : super(
         initialValue: initialValue ?? value,
         builder: (state) => Column(
           mainAxisSize: MainAxisSize.min,
           crossAxisAlignment: CrossAxisAlignment.stretch,
           children: [
             if (decoration.labelText != null)
               Padding(
                 padding: const EdgeInsets.only(bottom: 8),
                 child: Text(
                   decoration.labelText!,
                   style: PosTheme.of(state.context).textTheme.labelLarge,
                 ),
               ),
             PosSelect<T>(
               value: state.value,
               items: items,
               hint: hint,
               isExpanded: isExpanded,
               onChanged: onChanged == null
                   ? null
                   : (value) {
                       state.didChange(value);
                       onChanged(value);
                     },
             ),
             if (state.errorText != null || decoration.errorText != null)
               Text(
                 state.errorText ?? decoration.errorText!,
                 style: TextStyle(
                   color: PosTheme.of(state.context).colorScheme.error,
                 ),
               ),
           ],
         ),
       );
}

abstract class PosMenuEntry<T> extends StatelessWidget {
  const PosMenuEntry({super.key});
}

class PosMenuItem<T> extends PosMenuEntry<T> {
  const PosMenuItem({
    this.value,
    required this.child,
    this.enabled = true,
    this.height = 48,
    this.padding,
    super.key,
  });
  final T? value;
  final Widget child;
  final bool enabled;
  final double height;
  final EdgeInsets? padding;
  @override
  Widget build(BuildContext context) => child;
}

class PosMenuDivider<T> extends PosMenuEntry<T> {
  const PosMenuDivider({this.height = 16, super.key});
  final double height;
  @override
  Widget build(BuildContext context) => PosDivider(height: height);
}

class PosMenuButton<T> extends StatelessWidget {
  const PosMenuButton({
    required this.itemBuilder,
    this.onSelected,
    this.child,
    this.icon,
    this.tooltip,
    this.enabled = true,
    this.selected,
    this.position,
    this.padding,
    this.offset = Offset.zero,
    this.focusNode,
    this.onOpened,
    this.onClosed,
    this.onItemFocused,
    super.key,
  });
  final List<PosMenuEntry<T>> Function(BuildContext) itemBuilder;
  final ValueChanged<T>? onSelected;
  final Widget? child, icon;
  final String? tooltip;
  final bool enabled;
  final bool? selected;
  final Object? position;
  final EdgeInsets? padding;
  final Offset offset;
  final FocusNode? focusNode;
  final VoidCallback? onOpened, onClosed;
  final ValueChanged<T?>? onItemFocused;
  @override
  Widget build(BuildContext context) => _PosMenuTrigger<T>(
    enabled: enabled,
    offset: offset,
    itemBuilder: itemBuilder,
    focusNode: focusNode,
    onOpened: onOpened,
    onClosed: onClosed,
    onItemFocused: onItemFocused,
    onSelected: (value) {
      if (value != null) onSelected?.call(value);
    },
    builder: (context, open, focus, expanded) {
      final control = Semantics(
        expanded: expanded,
        child: child == null
            ? PosIconButton(
                focusNode: focus,
                onPressed: open,
                icon: icon ?? const PosIcon(PosGlyphs.moreVert),
                tooltip: tooltip,
              )
            : PosTapRegion(
                focusNode: focus,
                onTap: open,
                selected: selected,
                semanticLabel: tooltip,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: 48,
                    minWidth: 48,
                  ),
                  child: Padding(
                    padding: padding ?? EdgeInsets.zero,
                    child: child!,
                  ),
                ),
              ),
      );
      return child != null && tooltip != null
          ? PosTooltip(message: tooltip!, child: control)
          : control;
    },
  );
}

final class _PosMenuResult<T> {
  const _PosMenuResult(this.value);
  final T? value;
}

class _PosMenuTrigger<T> extends StatefulWidget {
  const _PosMenuTrigger({
    required this.builder,
    required this.itemBuilder,
    required this.enabled,
    this.onSelected,
    this.currentValue,
    this.selection = false,
    this.maxHeight,
    this.offset = Offset.zero,
    this.focusNode,
    this.onOpened,
    this.onClosed,
    this.onItemFocused,
  });
  final Widget Function(BuildContext, VoidCallback?, FocusNode, bool) builder;
  final List<PosMenuEntry<T>> Function(BuildContext) itemBuilder;
  final ValueChanged<T?>? onSelected;
  final T? currentValue;
  final bool enabled, selection;
  final double? maxHeight;
  final Offset offset;
  final FocusNode? focusNode;
  final VoidCallback? onOpened, onClosed;
  final ValueChanged<T?>? onItemFocused;
  @override
  State<_PosMenuTrigger<T>> createState() => _PosMenuTriggerState<T>();
}

class _PosMenuTriggerState<T> extends State<_PosMenuTrigger<T>> {
  FocusNode? _ownedFocus;
  FocusNode get _focus => widget.focusNode ?? (_ownedFocus ??= FocusNode());
  bool _open = false;
  _PosMenuRoute<T>? _route;
  List<(T?, bool)>? _openValues;

  List<(T?, bool)> _values(List<PosMenuEntry<T>> entries) => [
    for (final entry in entries)
      if (entry is PosMenuItem<T>) (entry.value, entry.enabled),
  ];

  void _closeRoute() {
    final route = _route;
    if (route == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (route.isActive) route.navigator?.removeRoute(route);
    });
  }

  @override
  void didUpdateWidget(_PosMenuTrigger<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_open &&
        (!widget.enabled ||
            !listEquals(_openValues, _values(widget.itemBuilder(context))))) {
      _closeRoute();
    }
  }

  @override
  void dispose() {
    _closeRoute();
    _ownedFocus?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      widget.builder(context, widget.enabled ? _show : null, _focus, _open);

  Future<void> _show() async {
    if (_open || !widget.enabled) return;
    final entries = widget.itemBuilder(context);
    if (entries.isEmpty) return;
    final navigator = Navigator.of(context, rootNavigator: true);
    final overlay = navigator.overlay!.context.findRenderObject()! as RenderBox;
    final origin =
        (_focus.context?.findRenderObject() ?? context.findRenderObject())!
            as RenderBox;
    final anchor =
        origin.localToGlobal(Offset.zero, ancestor: overlay) & origin.size;
    final palette = PosTheme.of(context);
    final reduced = MediaQuery.disableAnimationsOf(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    _focus.requestFocus();
    setState(() => _open = true);
    _openValues = _values(entries);
    final onClosed = widget.onClosed;
    widget.onOpened?.call();
    final route = _PosMenuRoute<T>(
      anchor: anchor,
      entries: entries,
      theme: palette,
      reduced: reduced,
      label: es ? 'Opciones' : 'Options',
      closeLabel: es ? 'Cerrar opciones' : 'Close options',
      currentValue: widget.currentValue,
      selection: widget.selection,
      maxHeight: widget.maxHeight,
      offset: widget.offset,
      onItemFocused: widget.onItemFocused,
    );
    _route = route;
    final result = await navigator.push<_PosMenuResult<T>>(route);
    _route = null;
    if (!mounted) {
      onClosed?.call();
      return;
    }
    setState(() => _open = false);
    if (_focus.canRequestFocus) _focus.requestFocus();
    if (result != null && widget.enabled) widget.onSelected?.call(result.value);
    onClosed?.call();
  }
}

class _PosMenuRoute<T> extends PopupRoute<_PosMenuResult<T>> {
  _PosMenuRoute({
    required this.anchor,
    required this.entries,
    required this.theme,
    required this.reduced,
    required this.label,
    required this.closeLabel,
    required this.currentValue,
    required this.selection,
    this.maxHeight,
    this.onItemFocused,
    required this.offset,
  }) : super(
         requestFocus: true,
         traversalEdgeBehavior: TraversalEdgeBehavior.closedLoop,
         directionalTraversalEdgeBehavior: TraversalEdgeBehavior.closedLoop,
       );
  final Rect anchor;
  final List<PosMenuEntry<T>> entries;
  final PosThemeData theme;
  final bool reduced, selection;
  final String label, closeLabel;
  final T? currentValue;
  final double? maxHeight;
  final Offset offset;
  final ValueChanged<T?>? onItemFocused;
  @override
  bool get barrierDismissible => true;
  @override
  Color? get barrierColor => null;
  @override
  String get barrierLabel => closeLabel;
  @override
  Duration get transitionDuration =>
      reduced ? Duration.zero : const Duration(milliseconds: 100);
  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) => reduced ? child : FadeTransition(opacity: animation, child: child);
  @override
  Widget buildPage(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
  ) {
    final media = MediaQuery.of(context);
    return PosTheme(
      data: theme,
      child: _PosMenuViewport(
        child: Semantics(
          scopesRoute: true,
          namesRoute: true,
          explicitChildNodes: true,
          label: label,
          child: CustomSingleChildLayout(
            delegate: _PosMenuLayout(
              anchor: anchor,
              maxHeight: maxHeight,
              offset: offset,
              direction: Directionality.of(context),
              insets: EdgeInsets.fromLTRB(
                media.padding.left + 8,
                media.padding.top + 8,
                media.padding.right + 8,
                math.max(media.padding.bottom, media.viewInsets.bottom) + 8,
              ),
            ),
            child: _PosMenuPanel<T>(
              entries: entries,
              currentValue: currentValue,
              selection: selection,
              reduced: reduced,
              onItemFocused: onItemFocused,
            ),
          ),
        ),
      ),
    );
  }
}

class _PosMenuViewport extends StatefulWidget {
  const _PosMenuViewport({required this.child});
  final Widget child;
  @override
  State<_PosMenuViewport> createState() => _PosMenuViewportState();
}

class _PosMenuViewportState extends State<_PosMenuViewport> {
  (Size, EdgeInsets, EdgeInsets, TextScaler)? _metrics;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final media = MediaQuery.of(context);
    final next = (
      media.size,
      media.padding,
      media.viewInsets,
      media.textScaler,
    );
    if (_metrics != null && _metrics != next) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && ModalRoute.of(context)?.isCurrent == true) {
          Navigator.pop(context);
        }
      });
    }
    _metrics = next;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _PosMenuLayout extends SingleChildLayoutDelegate {
  _PosMenuLayout({
    required this.anchor,
    required this.insets,
    required this.direction,
    required this.offset,
    this.maxHeight,
  });
  final Rect anchor;
  final EdgeInsets insets;
  final TextDirection direction;
  final Offset offset;
  final double? maxHeight;
  Rect bounds(Size size) => Rect.fromLTRB(
    insets.left,
    insets.top,
    math.max(insets.left, size.width - insets.right),
    math.max(insets.top, size.height - insets.bottom),
  );
  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final safe = bounds(constraints.biggest);
    final origin = anchor.shift(offset);
    final above = math.max(0.0, origin.top - safe.top - 6);
    final below = math.max(0.0, safe.bottom - origin.bottom - 6);
    final width = math.min(
      safe.width,
      math.max(240.0, math.min(360.0, origin.width)),
    );
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      maxHeight: math.min(maxHeight ?? double.infinity, math.max(above, below)),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final safe = bounds(size);
    final origin = anchor.shift(offset);
    final below = safe.bottom - origin.bottom - 6;
    final above = origin.top - safe.top - 6;
    final top = childSize.height <= below || below >= above
        ? origin.bottom + 6
        : origin.top - childSize.height - 6;
    final left = direction == TextDirection.rtl
        ? origin.right - childSize.width
        : origin.left;
    return Offset(
      left.clamp(safe.left, math.max(safe.left, safe.right - childSize.width)),
      top.clamp(safe.top, math.max(safe.top, safe.bottom - childSize.height)),
    );
  }

  @override
  bool shouldRelayout(_PosMenuLayout old) => true;
}

class _PosMenuPanel<T> extends StatefulWidget {
  const _PosMenuPanel({
    required this.entries,
    required this.currentValue,
    required this.selection,
    required this.reduced,
    this.onItemFocused,
  });
  final List<PosMenuEntry<T>> entries;
  final T? currentValue;
  final bool selection, reduced;
  final ValueChanged<T?>? onItemFocused;
  @override
  State<_PosMenuPanel<T>> createState() => _PosMenuPanelState<T>();
}

class _PosMenuPanelState<T> extends State<_PosMenuPanel<T>> {
  late final List<FocusNode?> _nodes = [
    for (final entry in widget.entries)
      entry is PosMenuItem<T> && entry.enabled ? FocusNode() : null,
  ];
  @override
  void dispose() {
    for (final node in _nodes) {
      node?.dispose();
    }
    super.dispose();
  }

  void _reveal(int index) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final context = _nodes[index]?.context;
      if (!mounted || context == null || !context.mounted) return;
      unawaited(
        Scrollable.ensureVisible(
          context,
          alignment: .5,
          duration: widget.reduced
              ? Duration.zero
              : const Duration(milliseconds: 100),
        ),
      );
    });
  }

  KeyEventResult _key(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final enabled = [
      for (var i = 0; i < _nodes.length; i++)
        if (_nodes[i] != null) i,
    ];
    if (enabled.isEmpty) return KeyEventResult.ignored;
    final current = enabled.indexWhere((i) => _nodes[i]!.hasFocus);
    final key = event.logicalKey;
    final int target;
    if (key == LogicalKeyboardKey.home) {
      target = enabled.first;
    } else if (key == LogicalKeyboardKey.end) {
      target = enabled.last;
    } else if (key == LogicalKeyboardKey.arrowDown) {
      target = enabled[(current + 1) % enabled.length];
    } else if (key == LogicalKeyboardKey.arrowUp) {
      target = enabled[(current - 1) % enabled.length];
    } else {
      return KeyEventResult.ignored;
    }
    _nodes[target]!.requestFocus();
    _reveal(target);
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    var initial = widget.selection
        ? widget.entries.indexWhere(
            (entry) =>
                entry is PosMenuItem<T> &&
                entry.enabled &&
                entry.value == widget.currentValue,
          )
        : -1;
    if (initial < 0) initial = _nodes.indexWhere((node) => node != null);
    return Container(
      key: const ValueKey('pos-anchored-menu'),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: theme.colorScheme.primary.withValues(alpha: .12),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Focus(
        onKeyEvent: _key,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < widget.entries.length; i++)
                if (widget.entries[i] case final PosMenuItem<T> entry)
                  PosTapRegion(
                    focusNode: _nodes[i],
                    autofocus: i == initial,
                    onFocusChange: (focused) {
                      if (focused) {
                        _reveal(i);
                        widget.onItemFocused?.call(entry.value);
                      }
                    },
                    selected: widget.selection
                        ? entry.value == widget.currentValue
                        : null,
                    borderRadius: BorderRadius.circular(4),
                    onTap: entry.enabled
                        ? () => Navigator.pop(
                            context,
                            _PosMenuResult<T>(entry.value),
                          )
                        : null,
                    child: Container(
                      constraints: BoxConstraints(
                        minHeight: math.max(48, entry.height),
                      ),
                      color:
                          widget.selection && entry.value == widget.currentValue
                          ? theme.colorScheme.primaryContainer
                          : null,
                      padding:
                          entry.padding ??
                          const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 12,
                          ),
                      child: Row(
                        children: [
                          Expanded(
                            child: DefaultTextStyle(
                              style: theme.textTheme.labelLarge!.copyWith(
                                color: entry.enabled
                                    ? theme.colorScheme.onSurface
                                    : theme.colorScheme.onSurfaceVariant,
                              ),
                              child: entry.child,
                            ),
                          ),
                          if (widget.selection &&
                              entry.value == widget.currentValue) ...[
                            const SizedBox(width: 12),
                            PosIcon(
                              PosGlyphs.check,
                              size: 18,
                              color: theme.colorScheme.primary,
                            ),
                          ],
                        ],
                      ),
                    ),
                  )
                else
                  widget.entries[i],
            ],
          ),
        ),
      ),
    );
  }
}

class PosNoticeBanner extends StatelessWidget {
  const PosNoticeBanner({
    required this.content,
    required this.actions,
    this.leading,
    this.backgroundColor,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });
  final Widget content;
  final List<Widget> actions;
  final Widget? leading;
  final Color? backgroundColor;
  final EdgeInsetsGeometry? padding;
  @override
  Widget build(BuildContext context) => Container(
    color: backgroundColor ?? PosTheme.of(context).colorScheme.primaryContainer,
    padding: padding,
    child: LayoutBuilder(
      builder: (context, box) {
        final text = Row(
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 12)],
            Expanded(child: Semantics(liveRegion: true, child: content)),
          ],
        );
        return box.maxWidth < 680 &&
                !(actions.length == 1 &&
                    box.maxWidth >= 300 &&
                    MediaQuery.textScalerOf(context).scale(16) < 24)
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  text,
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: actions),
                ],
              )
            : Row(
                children: [
                  Expanded(child: text),
                  const SizedBox(width: 12),
                  ...actions,
                ],
              );
      },
    ),
  );
}

class PosDisclosure extends StatefulWidget {
  const PosDisclosure({
    required this.title,
    this.children = const [],
    this.subtitle,
    this.leading,
    this.trailing,
    this.initiallyExpanded = false,
    this.onExpansionChanged,
    this.childrenPadding,
    this.tilePadding,
    super.key,
  });
  final Widget title;
  final Widget? subtitle, leading, trailing;
  final List<Widget> children;
  final bool initiallyExpanded;
  final ValueChanged<bool>? onExpansionChanged;
  final EdgeInsetsGeometry? childrenPadding, tilePadding;
  @override
  State<PosDisclosure> createState() => _PosDisclosureState();
}

class _PosDisclosureState extends State<PosDisclosure> {
  late bool open = widget.initiallyExpanded;
  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      PosListRow(
        title: widget.title,
        subtitle: widget.subtitle,
        leading: widget.leading,
        trailing:
            widget.trailing ?? PosIcon(open ? PosGlyphs.remove : PosGlyphs.add),
        contentPadding: widget.tilePadding,
        onTap: () {
          setState(() => open = !open);
          widget.onExpansionChanged?.call(open);
        },
      ),
      if (open)
        Padding(
          padding: widget.childrenPadding ?? EdgeInsets.zero,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: widget.children,
          ),
        ),
    ],
  );
}

class PosDestination extends StatelessWidget {
  const PosDestination({
    required this.icon,
    required this.label,
    this.selectedIcon,
    this.tooltip,
    super.key,
  });
  final Widget icon;
  final Widget? selectedIcon;
  final String label;
  final String? tooltip;
  @override
  Widget build(BuildContext context) => icon;
}

class PosNavigation extends StatefulWidget {
  const PosNavigation({
    required this.destinations,
    this.selectedIndex = 0,
    this.onDestinationSelected,
    this.height = 72,
    this.labelBehavior,
    super.key,
  }) : rail = false;
  const PosNavigation._({
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.height,
    this.labelBehavior,
    super.key,
  }) : rail = true;
  final List<Widget> destinations;
  final int selectedIndex;
  final ValueChanged<int>? onDestinationSelected;
  final double? height;
  final Object? labelBehavior;
  final bool rail;
  Widget asRail() => PosNavigation._(
    destinations: destinations,
    selectedIndex: selectedIndex,
    onDestinationSelected: onDestinationSelected,
    height: height,
    labelBehavior: labelBehavior,
    key: key,
  );
  @override
  State<PosNavigation> createState() => _PosNavigationState();
}

class _PosNavigationState extends State<PosNavigation> {
  final _nodes = <Object, FocusNode>{};
  final _moreFocus = FocusNode(debugLabel: 'UMI more sections');
  Set<Object> _visible = {};
  Object? _moreMeaning, _menuFocus, _collapsedFocus;
  bool _menuOpen = false;
  (bool, bool, int)? _layout;
  List<Object>? _identities;

  @override
  void initState() {
    super.initState();
    _moreFocus.addListener(() {
      if (!_moreFocus.hasFocus) _collapsedFocus = null;
    });
  }

  Object _identity(PosDestination destination) =>
      destination.key ?? destination.label;

  FocusNode _node(Object identity) => _nodes.putIfAbsent(
    identity,
    () => FocusNode(debugLabel: 'UMI destination $identity'),
  );

  void _restore(Object? identity) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _menuOpen || ModalRoute.of(context)?.isCurrent == false) {
        return;
      }
      final current = widget.destinations.cast<PosDestination>().toList();
      if (current.isEmpty || widget.onDestinationSelected == null) return;
      final allowed = current.map(_identity).toSet();
      final target = allowed.contains(identity)
          ? identity!
          : _identity(
              current[widget.selectedIndex.clamp(0, current.length - 1)],
            );
      final node = _visible.contains(target) ? _node(target) : _moreFocus;
      if (node.context?.mounted == true && node.canRequestFocus) {
        _collapsedFocus = _visible.contains(target) ? null : target;
        node.requestFocus();
      }
    });
  }

  @override
  void dispose() {
    _moreFocus.dispose();
    for (final node in _nodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => _build(context, constraints),
  );

  Widget _build(BuildContext context, BoxConstraints constraints) {
    final destinations = widget.destinations;
    // CLAMPED, because the rail is a public widget and a stale index is not a
    // programming error to crash on: a screen that loses a destination (the owner
    // just took "Pedidos" off the rail) hands over one index too large, and the
    // clamp is what keeps the rail drawing the last destination instead of dying.
    final selectedIndex = destinations.isEmpty
        ? 0
        : widget.selectedIndex.clamp(0, destinations.length - 1);
    final onDestinationSelected = widget.onDestinationSelected;
    final rail = widget.rail;
    if (destinations.isEmpty) return const SizedBox.shrink();
    final identities = destinations
        .cast<PosDestination>()
        .map(_identity)
        .toList();
    assert(identities.toSet().length == identities.length);
    Object? previousFocus;
    for (final entry in _nodes.entries) {
      if (entry.value.hasPrimaryFocus) previousFocus = entry.key;
    }
    if (_moreFocus.hasPrimaryFocus) {
      previousFocus = _collapsedFocus ?? _moreMeaning;
    }
    final p = PosTheme.of(context).colorScheme;
    final theme = PosTheme.of(context);
    final style = theme.textTheme.labelMedium!.copyWith(
      fontWeight: FontWeight.w700,
    );
    double labelWidth(String label, TextStyle textStyle) {
      final painter = TextPainter(
        text: TextSpan(text: label, style: textStyle),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
        locale: Localizations.localeOf(context),
      )..layout();
      final width = painter.width.ceilToDouble();
      painter.dispose();
      return width;
    }

    final width = constraints.hasBoundedWidth
        ? constraints.maxWidth
        : MediaQuery.sizeOf(context).width;
    final available = math.max(
      0.0,
      width - 16 - MediaQuery.paddingOf(context).horizontal,
    );
    final fullWidth = destinations.cast<PosDestination>().fold<double>(
      48,
      (needed, destination) =>
          math.max(needed, labelWidth(destination.label, style) + 16),
    );
    final compact =
        !rail &&
        destinations.length > 4 &&
        fullWidth * destinations.length > available;
    final controls = List.generate(destinations.length, (index) {
      final d = destinations[index] as PosDestination;
      final chosen = selectedIndex == index;
      final foreground = rail
          ? p.onRail
          : (chosen ? p.primary : p.onSurfaceVariant);
      final label = Text(
        d.label,
        textAlign: rail ? TextAlign.start : TextAlign.center,
        maxLines: 1,
        softWrap: false,
        style: PosTheme.of(context).textTheme.labelMedium!.copyWith(
          color: foreground,
          fontWeight: chosen ? FontWeight.w700 : FontWeight.w500,
        ),
      );
      final icon = IconTheme(
        data: IconThemeData(color: foreground, size: 22),
        child: chosen ? d.selectedIcon ?? d.icon : d.icon,
      );
      final item = PosTapRegion(
        key: ValueKey(identities[index]),
        focusNode: _node(identities[index]),
        selected: chosen,
        semanticLabel: d.label,
        focusColor: rail ? p.signal : p.primary,
        hoverColor: rail ? p.onRail.withValues(alpha: .08) : null,
        borderRadius: BorderRadius.circular(4),
        onTap: onDestinationSelected == null
            ? null
            : () {
                onDestinationSelected(index);
                _restore(identities[index]);
              },
        child: Container(
          constraints: BoxConstraints(minHeight: rail ? 56 : 64, minWidth: 48),
          padding: EdgeInsets.symmetric(
            horizontal: rail ? 16 : 8,
            vertical: 10,
          ),
          decoration: BoxDecoration(
            color: chosen
                ? (rail ? p.signal.withValues(alpha: .16) : p.primaryContainer)
                : null,
            border: rail
                ? Border(
                    left: BorderSide(
                      color: chosen ? p.signal : const Color(0x00000000),
                      width: 3,
                    ),
                  )
                : Border(
                    top: BorderSide(
                      color: chosen ? p.primary : const Color(0x00000000),
                      width: 3,
                    ),
                  ),
          ),
          child: rail
              ? Row(
                  children: [
                    icon,
                    const SizedBox(width: 14),
                    Expanded(child: label),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [icon, const SizedBox(height: 5), label],
                ),
        ),
      );
      return rail
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: item,
            )
          : item;
    });
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final more = PosMenuButton<Object>(
      focusNode: _moreFocus,
      enabled: onDestinationSelected != null,
      onOpened: () {
        _menuOpen = true;
        _collapsedFocus = null;
        _menuFocus = _moreMeaning;
      },
      onItemFocused: (identity) => _menuFocus = identity,
      onClosed: () {
        if (!mounted) return;
        _menuOpen = false;
        _restore(_menuFocus);
      },
      tooltip: selectedIndex >= 3
          ? '${(destinations[selectedIndex] as PosDestination).label}, ${spanish ? 'más secciones' : 'more sections'}'
          : (spanish ? 'Más secciones' : 'More sections'),
      selected: selectedIndex >= 3,
      onSelected: (identity) {
        final current = widget.destinations.cast<PosDestination>().toList();
        final index = current.indexWhere((d) => _identity(d) == identity);
        if (index >= 0) widget.onDestinationSelected?.call(index);
      },
      itemBuilder: (_) => [
        for (var index = 3; index < destinations.length; index++)
          PosMenuItem<Object>(
            value: identities[index],
            child: Row(
              children: [
                (destinations[index] as PosDestination).icon,
                const SizedBox(width: 12),
                Expanded(
                  child: Text((destinations[index] as PosDestination).label),
                ),
              ],
            ),
          ),
      ],
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            selectedIndex >= 3
                ? (destinations[selectedIndex] as PosDestination).icon
                : const PosIcon(PosGlyphs.moreVert, size: 22),
            const SizedBox(height: 5),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    selectedIndex >= 3
                        ? (destinations[selectedIndex] as PosDestination).label
                        : (spanish ? 'Más' : 'More'),
                    maxLines: 1,
                    softWrap: false,
                    style: theme.textTheme.labelSmall,
                  ),
                ),
                const SizedBox(width: 4),
                const PosIcon(PosGlyphs.expandMore, size: 14),
              ],
            ),
          ],
        ),
      ),
    );
    final items = compact ? [...controls.take(3), more] : controls;
    var itemWidth = fullWidth;
    if (compact) {
      itemWidth = destinations
          .take(3)
          .cast<PosDestination>()
          .fold<double>(
            48,
            (needed, destination) =>
                math.max(needed, labelWidth(destination.label, style) + 16),
          );
      // Reserve the widest secondary label so selection keeps the same rows.
      final moreStyle = theme.textTheme.labelSmall!.copyWith(
        fontWeight: FontWeight.w700,
      );
      for (final label in [
        spanish ? 'Más' : 'More',
        ...destinations.skip(3).cast<PosDestination>().map((d) => d.label),
      ]) {
        itemWidth = math.max(itemWidth, labelWidth(label, moreStyle) + 34);
      }
    }
    final columns = rail
        ? items.length
        : (available / itemWidth).floor().clamp(1, items.length);
    final nextLayout = (rail, compact, columns);
    final changed =
        _layout != nextLayout || !listEquals(_identities, identities);
    _layout = nextLayout;
    _identities = identities;
    _visible = (compact ? identities.take(3) : identities).toSet();
    _moreMeaning = selectedIndex >= 3
        ? identities[selectedIndex]
        : identities[math.min(3, identities.length - 1)];
    if (changed && previousFocus != null && !_menuOpen) {
      _restore(previousFocus);
    }
    var railWidth = 184.0;
    if (rail) {
      for (final destination in destinations.cast<PosDestination>()) {
        final painter = TextPainter(
          text: TextSpan(
            text: destination.label,
            style: PosTheme.of(
              context,
            ).textTheme.labelMedium!.copyWith(fontWeight: FontWeight.w700),
          ),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout();
        final needed = painter.width.ceilToDouble() + 71;
        if (needed > railWidth) railWidth = needed;
        painter.dispose();
      }
    }
    return Container(
      width: rail ? railWidth : null,
      decoration: BoxDecoration(
        color: rail ? p.rail : p.surface,
        border: rail ? null : Border(top: BorderSide(color: p.outlineVariant)),
      ),
      padding: EdgeInsets.symmetric(horizontal: rail ? 0 : 8, vertical: 8),
      child: SafeArea(
        top: rail,
        child: rail
            ? Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
                    child: Column(
                      children: [
                        Text(
                          'umi',
                          style: PosTheme.of(context).textTheme.headlineSmall!
                              .copyWith(color: p.onRail, fontSize: 30),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          spanish ? 'ESTACIÓN' : 'STATION',
                          style: PosTheme.of(context).textTheme.labelSmall!
                              .copyWith(
                                color: p.onRail.withValues(alpha: .7),
                                fontSize: 9,
                                letterSpacing: 1.3,
                              ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(child: ListView(children: controls)),
                ],
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (var start = 0; start < items.length; start += columns)
                    Row(
                      children: [
                        for (final item in items.skip(start).take(columns))
                          Expanded(child: item),
                      ],
                    ),
                ],
              ),
      ),
    );
  }
}

class PosTabController extends ChangeNotifier {
  PosTabController({
    required this.length,
    required TickerProvider vsync,
    int initialIndex = 0,
  }) : _index = initialIndex;
  final int length;
  int _index;
  int get index => _index;
  set index(int value) {
    if (value != _index) {
      _index = value;
      notifyListeners();
    }
  }

  bool get indexIsChanging => false;
  void animateTo(int value) => index = value;
}

class PosTab extends StatelessWidget {
  const PosTab({this.text, this.icon, this.child, super.key});
  final String? text;
  final Widget? icon, child;
  @override
  Widget build(BuildContext context) =>
      child ??
      Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[icon!, const SizedBox(width: 8)],
          if (text != null) Text(text!),
        ],
      );
}

class PosTabs extends StatelessWidget implements PreferredSizeWidget {
  const PosTabs({
    required this.tabs,
    required this.controller,
    this.isScrollable = false,
    this.onTap,
    super.key,
  });
  final List<Widget> tabs;
  final PosTabController controller;
  final bool isScrollable;
  final ValueChanged<int>? onTap;
  @override
  Size get preferredSize => const Size.fromHeight(60);
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: List.generate(
          tabs.length,
          (index) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: PosChoice(
              label: tabs[index],
              selected: controller.index == index,
              onSelected: (_) {
                controller.index = index;
                onTap?.call(index);
              },
            ),
          ),
        ),
      ),
    ),
  );
}

class PosTabView extends StatelessWidget {
  const PosTabView({
    required this.controller,
    required this.children,
    super.key,
  });
  final PosTabController controller;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (_, _) =>
        IndexedStack(index: controller.index, children: children),
  );
}

class PosDataColumn {
  const PosDataColumn({
    required this.label,
    this.numeric = false,
    this.tooltip,
    this.onSort,
  });
  final Widget label;
  final bool numeric;
  final String? tooltip;
  final void Function(int, bool)? onSort;
}

class PosDataCell {
  const PosDataCell(
    this.child, {
    this.onTap,
    this.placeholder = false,
    this.showEditIcon = false,
  });
  final Widget child;
  final VoidCallback? onTap;
  final bool placeholder, showEditIcon;
}

class PosDataRow {
  const PosDataRow({
    required this.cells,
    this.selected = false,
    this.onSelectChanged,
    this.color,
    this.key,
  });
  final List<PosDataCell> cells;
  final bool selected;
  final ValueChanged<bool?>? onSelectChanged;
  final WidgetStateProperty<Color?>? color;
  final LocalKey? key;
}

class PosDataGrid extends StatelessWidget {
  const PosDataGrid({
    required this.columns,
    required this.rows,
    this.columnSpacing = 32,
    this.horizontalMargin = 16,
    this.dataRowMinHeight = 56,
    this.dataRowMaxHeight = 80,
    this.headingRowHeight = 56,
    this.showCheckboxColumn = true,
    super.key,
  });
  final List<PosDataColumn> columns;
  final List<PosDataRow> rows;
  final double? columnSpacing,
      horizontalMargin,
      dataRowMinHeight,
      dataRowMaxHeight,
      headingRowHeight;
  final bool showCheckboxColumn;
  @override
  Widget build(BuildContext context) => Table(
    defaultColumnWidth: const IntrinsicColumnWidth(),
    border: TableBorder(
      horizontalInside: BorderSide(
        color: PosTheme.of(context).colorScheme.outlineVariant,
      ),
    ),
    children: [
      TableRow(
        decoration: BoxDecoration(
          color: PosTheme.of(context).colorScheme.surfaceContainerHigh,
        ),
        children: columns
            .map(
              (column) => Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: (columnSpacing ?? 32) / 2,
                  vertical: 16,
                ),
                child: column.label,
              ),
            )
            .toList(),
      ),
      ...rows.map(
        (row) => TableRow(
          key: row.key,
          decoration: BoxDecoration(
            color:
                row.color?.resolve(
                  row.selected ? {WidgetState.selected} : {},
                ) ??
                (row.selected
                    ? PosTheme.of(context).colorScheme.primaryContainer
                    : null),
          ),
          children: row.cells
              .map(
                (cell) => ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: dataRowMinHeight ?? 56,
                  ),
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: (columnSpacing ?? 32) / 2,
                      vertical: 12,
                    ),
                    child: cell.onTap == null
                        ? cell.child
                        : PosTapRegion(onTap: cell.onTap, child: cell.child),
                  ),
                ),
              )
              .toList(),
        ),
      ),
    ],
  );
}
