part of 'pos_ui.dart';

class PosFieldBorder {
  const PosFieldBorder({
    this.borderRadius = const BorderRadius.all(Radius.circular(14)),
    this.borderSide = const BorderSide(),
  });
  static const none = PosFieldBorder(borderSide: BorderSide.none);
  final BorderRadius borderRadius;
  final BorderSide borderSide;
}

class PosFieldDecoration {
  const PosFieldDecoration({
    this.labelText,
    this.hintText,
    this.errorText,
    this.helperText,
    this.prefixIcon,
    this.suffixIcon,
    this.prefixText,
    this.suffixText,
    this.contentPadding,
    this.border,
    this.enabledBorder,
    this.focusedBorder,
    this.filled = true,
    this.fillColor,
    this.isDense = false,
    this.counterText,
    this.hintStyle,
  });
  final String? labelText,
      hintText,
      errorText,
      helperText,
      prefixText,
      suffixText,
      counterText;
  final Widget? prefixIcon, suffixIcon;
  final EdgeInsetsGeometry? contentPadding;
  final PosFieldBorder? border, enabledBorder, focusedBorder;
  final bool filled, isDense;
  final TextStyle? hintStyle;
  final Color? fillColor;
  PosFieldDecoration copyWith({String? errorText}) => PosFieldDecoration(
    labelText: labelText,
    hintText: hintText,
    errorText: errorText ?? this.errorText,
    helperText: helperText,
    prefixIcon: prefixIcon,
    suffixIcon: suffixIcon,
    prefixText: prefixText,
    suffixText: suffixText,
    contentPadding: contentPadding,
    border: border,
    enabledBorder: enabledBorder,
    focusedBorder: focusedBorder,
    filled: filled,
    fillColor: fillColor,
    isDense: isDense,
    counterText: counterText,
    hintStyle: hintStyle,
  );
}

class PosField extends StatefulWidget {
  const PosField({
    this.controller,
    this.focusNode,
    this.decoration = const PosFieldDecoration(),
    this.onChanged,
    this.onSubmitted,
    this.onEditingComplete,
    this.onTap,
    this.keyboardType,
    this.textInputAction,
    this.inputFormatters,
    this.obscureText = false,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.autofocus = false,
    this.enabled = true,
    this.readOnly = false,
    this.maxLines = 1,
    this.minLines,
    this.maxLength,
    this.textCapitalization = TextCapitalization.none,
    this.textAlign = TextAlign.start,
    this.style,
    this.enableInteractiveSelection = true,
    this.showCursor,
    this.expands = false,
    this.scrollPadding = const EdgeInsets.all(20),
    this.autofillHints,
    this.semanticLabel,
    super.key,
  });
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final PosFieldDecoration? decoration;
  final ValueChanged<String>? onChanged, onSubmitted;
  final VoidCallback? onEditingComplete, onTap;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscureText,
      autocorrect,
      enableSuggestions,
      autofocus,
      readOnly,
      enableInteractiveSelection,
      expands;
  final bool? enabled, showCursor;
  final int? maxLines, minLines, maxLength;
  final TextCapitalization textCapitalization;
  final TextAlign textAlign;
  final TextStyle? style;
  final EdgeInsets scrollPadding;
  final Iterable<String>? autofillHints;
  final String? semanticLabel;
  @override
  State<PosField> createState() => _PosFieldState();
}

class _PosFieldState extends State<PosField>
    implements TextSelectionGestureDetectorBuilderDelegate {
  late TextEditingController controller;
  late FocusNode focus;
  @override
  final GlobalKey<EditableTextState> editableTextKey =
      GlobalKey<EditableTextState>();
  late TextSelectionGestureDetectorBuilder gestures;
  @override
  bool get forcePressEnabled => false;
  @override
  bool get selectionEnabled => widget.enableInteractiveSelection;
  @override
  void initState() {
    super.initState();
    controller = widget.controller ?? TextEditingController();
    focus = widget.focusNode ?? FocusNode();
    focus.addListener(changed);
    controller.addListener(changed);
    gestures = TextSelectionGestureDetectorBuilder(delegate: this);
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(PosField old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      controller.removeListener(changed);
      if (old.controller == null) controller.dispose();
      controller = widget.controller ?? TextEditingController();
      controller.addListener(changed);
    }
    if (old.focusNode != widget.focusNode) {
      focus.removeListener(changed);
      if (old.focusNode == null) focus.dispose();
      focus = widget.focusNode ?? FocusNode();
      focus.addListener(changed);
    }
  }

  @override
  void dispose() {
    controller.removeListener(changed);
    focus.removeListener(changed);
    if (widget.controller == null) controller.dispose();
    if (widget.focusNode == null) focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final d = widget.decoration ?? const PosFieldDecoration();
    final enabled = widget.enabled ?? true;
    final configuredBorder =
        (focus.hasFocus ? d.focusedBorder : d.enabledBorder) ?? d.border;
    final noBorder = configuredBorder?.borderSide == BorderSide.none;
    final borderColor = d.errorText != null
        ? palette.error
        : focus.hasFocus
        ? palette.primary
        : palette.outlineVariant;
    final textStyle = widget.style ?? theme.textTheme.bodyLarge!;
    final formatters = [
      ...?widget.inputFormatters,
      if (widget.maxLength != null)
        LengthLimitingTextInputFormatter(widget.maxLength),
    ];
    final editable = EditableText(
      key: editableTextKey,
      controller: controller,
      focusNode: focus,
      style: textStyle,
      cursorColor: palette.primary,
      backgroundCursorColor: palette.outline,
      selectionColor: palette.primary.withValues(alpha: .22),
      keyboardType: widget.keyboardType,
      textInputAction: widget.textInputAction,
      textCapitalization: widget.textCapitalization,
      inputFormatters: formatters,
      maxLines: widget.obscureText ? 1 : widget.maxLines,
      minLines: widget.minLines,
      expands: widget.expands,
      readOnly: widget.readOnly || !enabled,
      obscureText: widget.obscureText,
      autocorrect: widget.autocorrect,
      enableSuggestions: widget.enableSuggestions,
      autofocus: widget.autofocus,
      textAlign: widget.textAlign,
      showCursor: widget.showCursor,
      scrollPadding: widget.scrollPadding,
      autofillHints: widget.autofillHints,
      rendererIgnoresPointer: true,
      enableInteractiveSelection: widget.enableInteractiveSelection,
      selectionControls: _PosSelectionControls(),
      contextMenuBuilder: (context, state) => _PosEditingMenu(
        anchors: state.contextMenuAnchors,
        items: state.contextMenuButtonItems,
      ),
      onChanged: widget.onChanged,
      onSubmitted: widget.onSubmitted,
      onEditingComplete: widget.onEditingComplete,
    );
    return Semantics(
      enabled: enabled,
      child: Column(
        mainAxisSize: widget.expands ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (d.labelText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ExcludeSemantics(
                child: Text(d.labelText!, style: theme.textTheme.labelLarge),
              ),
            ),
          Flexible(
            fit: widget.expands ? FlexFit.tight : FlexFit.loose,
            child: IgnorePointer(
              ignoring: !enabled,
              // THE WHOLE FIELD IS A TAP TARGET, AND IT HAD NO NAME. Pressing anywhere in the box
              // opens the keyboard, and the engine published that region with a tap action and no
              // label — the POS surface inventory reported the search areas of Comanda and Ventas
              // as "pressable and unnamed". The name and the action now live on the SAME node:
              // the gesture detector below is excluded from semantics, so a screen reader
              // announces the field's own words instead of an anonymous button.
              child: Semantics(
                label: widget.semanticLabel ?? d.hintText ?? d.labelText,
                onTap: () {
                  editableTextKey.currentState?.requestKeyboard();
                  widget.onTap?.call();
                },
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  excludeFromSemantics: true,
                  onTap: () {
                    editableTextKey.currentState?.requestKeyboard();
                    widget.onTap?.call();
                  },
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 48),
                    decoration: BoxDecoration(
                      color: d.filled
                          ? d.fillColor ?? palette.surface
                          : PosColors.transparent,
                      borderRadius:
                          configuredBorder?.borderRadius ??
                          BorderRadius.circular(12),
                      border: noBorder
                          ? null
                          : Border.all(
                              color: d.errorText != null
                                  ? palette.error
                                  : configuredBorder?.borderSide.color ??
                                        borderColor,
                              width:
                                  configuredBorder?.borderSide.width ??
                                  (focus.hasFocus ? 2 : 1),
                            ),
                    ),
                    padding:
                        d.contentPadding ??
                        EdgeInsets.symmetric(
                          horizontal: noBorder ? 0 : 14,
                          vertical: d.isDense ? 10 : 12,
                        ),
                    child: IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          if (d.prefixIcon != null)
                            Padding(
                              padding: const EdgeInsets.only(right: 10),
                              child: IconTheme(
                                data: IconThemeData(
                                  color: palette.onSurfaceVariant,
                                  size: 20,
                                ),
                                child: d.prefixIcon!,
                              ),
                            ),
                          if (d.prefixText != null)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: Text(d.prefixText!),
                            ),
                          Expanded(
                            child: gestures.buildGestureDetector(
                              behavior: HitTestBehavior.translucent,
                              child: GestureDetector(
                                onTap: widget.onTap,
                                behavior: HitTestBehavior.translucent,
                                child: Stack(
                                  alignment: switch (widget.textAlign) {
                                    TextAlign.center => Alignment.center,
                                    TextAlign.left => Alignment.centerLeft,
                                    TextAlign.right => Alignment.centerRight,
                                    TextAlign.end =>
                                      AlignmentDirectional.centerEnd,
                                    _ => AlignmentDirectional.centerStart,
                                  },
                                  children: [
                                    if (controller.text.isEmpty &&
                                        d.hintText != null)
                                      ExcludeSemantics(
                                        child: IgnorePointer(
                                          child: Text(
                                            d.hintText!,
                                            style:
                                                d.hintStyle ??
                                                textStyle.copyWith(
                                                  color:
                                                      palette.onSurfaceVariant,
                                                ),
                                          ),
                                        ),
                                      ),
                                    Semantics(
                                      label:
                                          widget.semanticLabel ?? d.labelText,
                                      child: editable,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          if (d.suffixText != null)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Text(d.suffixText!),
                            ),
                          if (d.suffixIcon != null)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: d.suffixIcon!,
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (d.errorText != null || d.helperText != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Semantics(
                liveRegion: d.errorText != null,
                child: Text(
                  d.errorText ?? d.helperText!,
                  style: theme.textTheme.bodySmall!.copyWith(
                    color: d.errorText != null
                        ? palette.error
                        : palette.onSurfaceVariant,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class PosFormField extends FormField<String> {
  PosFormField({
    this.controller,
    String? initialValue,
    PosFieldDecoration decoration = const PosFieldDecoration(),
    this.onChanged,
    ValueChanged<String>? onFieldSubmitted,
    TextInputType? keyboardType,
    TextInputAction? textInputAction,
    List<TextInputFormatter>? inputFormatters,
    bool obscureText = false,
    bool autofocus = false,
    int? maxLines = 1,
    super.validator,
    super.onSaved,
    super.autovalidateMode,
    super.key,
  }) : assert(controller == null || initialValue == null),
       super(
         initialValue: controller?.text ?? initialValue,
         builder: (state) => PosField(
           controller: (state as _PosFormFieldState).effectiveController,
           decoration: decoration.copyWith(errorText: state.errorText),
           keyboardType: keyboardType,
           textInputAction: textInputAction,
           inputFormatters: inputFormatters,
           obscureText: obscureText,
           autofocus: autofocus,
           maxLines: maxLines,
           onChanged: (value) {
             state.didChange(value);
             onChanged?.call(value);
           },
           onSubmitted: onFieldSubmitted,
         ),
       );

  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  @override
  FormFieldState<String> createState() => _PosFormFieldState();
}

class _PosFormFieldState extends FormFieldState<String> {
  TextEditingController? _ownedController;
  late String _resetValue;
  PosFormField get field => widget as PosFormField;
  TextEditingController get effectiveController =>
      field.controller ?? _ownedController!;

  @override
  void initState() {
    super.initState();
    _resetValue = widget.initialValue ?? '';
    if (field.controller == null) {
      _ownedController = TextEditingController(text: _resetValue);
    }
    effectiveController.addListener(_controllerChanged);
  }

  @override
  void didUpdateWidget(PosFormField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller == field.controller) return;
    final previous = oldWidget.controller ?? _ownedController!;
    final previousValue = previous.value;
    previous.removeListener(_controllerChanged);
    if (field.controller == null) {
      _ownedController = TextEditingController.fromValue(previousValue);
    } else {
      _ownedController?.dispose();
      _ownedController = null;
    }
    _resetValue = effectiveController.text;
    setValue(effectiveController.text);
    effectiveController.addListener(_controllerChanged);
  }

  void _controllerChanged() {
    if (effectiveController.text != value) didChange(effectiveController.text);
  }

  @override
  void didChange(String? value) {
    super.didChange(value);
    if (effectiveController.text != value) {
      effectiveController.value = TextEditingValue(text: value ?? '');
    }
  }

  @override
  void reset() {
    effectiveController.value = TextEditingValue(text: _resetValue);
    super.reset();
    setValue(_resetValue);
    field.onChanged?.call(_resetValue);
  }

  @override
  void dispose() {
    effectiveController.removeListener(_controllerChanged);
    _ownedController?.dispose();
    super.dispose();
  }
}

class _PosSelectionControls extends TextSelectionControls
    with TextSelectionHandleControls {
  @override
  Size getHandleSize(double textLineHeight) => const Size(16, 20);
  @override
  Offset getHandleAnchor(TextSelectionHandleType type, double textLineHeight) =>
      const Offset(8, 0);
  @override
  Widget buildHandle(
    BuildContext context,
    TextSelectionHandleType type,
    double textLineHeight, [
    VoidCallback? onTap,
  ]) => GestureDetector(
    onTap: onTap,
    child: SizedBox(
      width: 16,
      height: 20,
      child: CustomPaint(
        painter: _HandlePainter(PosTheme.of(context).colorScheme.primary),
      ),
    ),
  );
  @override
  Widget buildToolbar(
    BuildContext context,
    Rect region,
    double height,
    Offset midpoint,
    List<TextSelectionPoint> endpoints,
    TextSelectionDelegate delegate,
    ValueListenable<ClipboardStatus>? clipboardStatus,
    Offset? lastSecondaryTapDownPosition,
  ) => const SizedBox.shrink();
}

class _HandlePainter extends CustomPainter {
  _HandlePainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    canvas.drawRect(const Rect.fromLTWH(7, 0, 2, 8), paint);
    canvas.drawCircle(const Offset(8, 12), 6, paint);
  }

  @override
  bool shouldRepaint(_HandlePainter old) => old.color != color;
}

class _PosEditingMenu extends StatelessWidget {
  const _PosEditingMenu({required this.anchors, required this.items});
  final TextSelectionToolbarAnchors anchors;
  final List<ContextMenuButtonItem> items;
  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    String name(ContextMenuButtonItem item) =>
        item.label ??
        switch (item.type) {
          ContextMenuButtonType.cut => es ? 'Cortar' : 'Cut',
          ContextMenuButtonType.copy => es ? 'Copiar' : 'Copy',
          ContextMenuButtonType.paste => es ? 'Pegar' : 'Paste',
          ContextMenuButtonType.selectAll =>
            es ? 'Seleccionar todo' : 'Select all',
          _ => es ? 'Acción' : 'Action',
        };
    final media = MediaQuery.of(context);
    final inset = EdgeInsets.fromLTRB(
      media.padding.left + 8,
      media.padding.top + 8,
      media.padding.right + 8,
      media.viewInsets.bottom + 8,
    );
    final origin = Offset(inset.left, inset.top);
    return Padding(
      padding: inset,
      child: CustomSingleChildLayout(
        delegate: TextSelectionToolbarLayoutDelegate(
          anchorAbove: anchors.primaryAnchor - origin - const Offset(0, 8),
          anchorBelow:
              (anchors.secondaryAnchor ?? anchors.primaryAnchor) -
              origin +
              const Offset(0, 8),
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: math.min(
              480,
              math.max(0, media.size.width - inset.horizontal),
            ),
          ),
          child: PosSurface(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(
                color: PosTheme.of(context).colorScheme.outlineVariant,
              ),
            ),
            child: Wrap(
              children: items
                  .map(
                    (item) => PosTextButton(
                      onPressed: item.onPressed,
                      child: Text(name(item)),
                    ),
                  )
                  .toList(),
            ),
          ),
        ),
      ),
    );
  }
}

class PosSelectionArea extends StatefulWidget {
  const PosSelectionArea({required this.child, super.key});
  final Widget child;
  @override
  State<PosSelectionArea> createState() => _PosSelectionAreaState();
}

class _PosSelectionAreaState extends State<PosSelectionArea> {
  final focus = FocusNode();

  @override
  void initState() {
    super.initState();
    focus.addListener(_changed);
    FocusManager.instance.addHighlightModeListener(_highlightChanged);
  }

  void _highlightChanged(FocusHighlightMode mode) {
    if (mounted) setState(() {});
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    if (focus.hasFocus) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && focus.hasFocus) {
          Scrollable.ensureVisible(
            context,
            alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtStart,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    FocusManager.instance.removeHighlightModeListener(_highlightChanged);
    focus.removeListener(_changed);
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    focusable: true,
    focused: focus.hasFocus,
    child: DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          width: 2,
          color:
              focus.hasFocus &&
                  FocusManager.instance.highlightMode ==
                      FocusHighlightMode.traditional
              ? PosTheme.of(context).colorScheme.primary
              : PosColors.transparent,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: SelectableRegion(
          focusNode: focus,
          selectionControls: _PosSelectionControls(),
          contextMenuBuilder: (context, state) => _PosEditingMenu(
            anchors: state.contextMenuAnchors,
            items: state.contextMenuButtonItems,
          ),
          child: widget.child,
        ),
      ),
    ),
  );
}

class PosSelectableText extends StatelessWidget {
  const PosSelectableText(
    this.data, {
    this.style,
    this.textAlign,
    this.maxLines,
    super.key,
  });
  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  @override
  Widget build(BuildContext context) => PosSelectionArea(
    child: Text(data, style: style, textAlign: textAlign, maxLines: maxLines),
  );
}
