library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'pos_icons.dart';
import 'pos_theme.dart';

export 'package:flutter/services.dart'
    show TextInputAction, TextInputType, LogicalKeyboardKey;
export 'package:flutter/widgets.dart';

export 'pos_icons.dart';
export 'pos_theme.dart';

part 'pos_collections.dart';
part 'pos_fields.dart';

enum PosTapTargetSize { padded, shrinkWrap }

enum PosMenuPosition { over, under }

enum PosNavigationLabelBehavior { alwaysShow, alwaysHide, onlyShowSelected }

class PosVisualDensity {
  const PosVisualDensity();
  static const standard = PosVisualDensity();
  static const compact = PosVisualDensity();
}

void showPosFeedback(BuildContext context, String message) {
  unawaited(
    showPosDialog<void>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        content: Semantics(liveRegion: true, child: Text(message)),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(
              Localizations.localeOf(context).languageCode == 'es'
                  ? 'Entendido'
                  : 'OK',
            ),
          ),
        ],
      ),
    ),
  );
}

final class PosApp extends StatelessWidget {
  const PosApp({
    this.title = 'UmiPOS',
    this.home,
    this.theme,
    this.darkTheme,
    this.midnightTheme,
    this.themeMode = PosThemeMode.system,
    this.localizationsDelegates,
    this.supportedLocales = const [Locale('en')],
    this.locale,
    this.localeResolutionCallback,
    this.builder,
    this.onUnknownRoute,
    this.navigatorKey,
    this.debugShowCheckedModeBanner = false,
    super.key,
  });
  final String title;
  final Widget? home;
  final PosThemeData? theme, darkTheme;

  /// The all-black dark, when the operator chose it. Null falls back to `darkTheme`,
  /// which is what a caller that only ever knew two themes wants.
  final PosThemeData? midnightTheme;
  final PosThemeMode themeMode;
  final Iterable<LocalizationsDelegate<dynamic>>? localizationsDelegates;
  final Iterable<Locale> supportedLocales;
  final Locale? locale;
  final LocaleResolutionCallback? localeResolutionCallback;
  final TransitionBuilder? builder;
  final RouteFactory? onUnknownRoute;
  final GlobalKey<NavigatorState>? navigatorKey;
  final bool debugShowCheckedModeBanner;
  @override
  Widget build(BuildContext context) => WidgetsApp(
    title: title,
    color: const Color(0xFF223979),
    home: home,
    debugShowCheckedModeBanner: debugShowCheckedModeBanner,
    localizationsDelegates: localizationsDelegates,
    supportedLocales: supportedLocales,
    locale: locale,
    localeResolutionCallback: localeResolutionCallback,
    onUnknownRoute: onUnknownRoute,
    navigatorKey: navigatorKey,
    pageRouteBuilder: <T>(settings, childBuilder) =>
        PosPageRoute<T>(builder: childBuilder, settings: settings),
    builder: (context, child) {
      // THREE ANSWERS, ONE OF THEM THE OPERATOR'S OWN. `midnight` is dark with the
      // dashboard's black ground; `system` follows the OS, which knows only two.
      final osDark =
          MediaQuery.platformBrightnessOf(context) == Brightness.dark;
      final data = switch (themeMode) {
        PosThemeMode.light => theme ?? PosThemeData(),
        PosThemeMode.dark =>
          darkTheme ?? PosThemeData(brightness: Brightness.dark),
        PosThemeMode.midnight =>
          midnightTheme ??
              darkTheme ??
              PosThemeData(brightness: Brightness.dark),
        PosThemeMode.system =>
          osDark
              ? darkTheme ?? PosThemeData(brightness: Brightness.dark)
              : theme ?? PosThemeData(),
      };
      return PosTheme(
        data: data,
        child: DefaultTextStyle(
          style: data.textTheme.bodyMedium!,
          child: IconTheme(
            data: IconThemeData(color: data.colorScheme.onSurface, size: 24),
            child:
                builder?.call(context, child) ??
                child ??
                const SizedBox.shrink(),
          ),
        ),
      );
    },
  );
}

class PosPageRoute<T> extends PageRouteBuilder<T> {
  PosPageRoute({
    required WidgetBuilder builder,
    super.settings,
    super.fullscreenDialog,
  }) : super(
         pageBuilder: (context, animation, secondary) => builder(context),
         transitionDuration: const Duration(milliseconds: 180),
         reverseTransitionDuration: const Duration(milliseconds: 120),
         transitionsBuilder: (context, animation, secondary, child) =>
             MediaQuery.disableAnimationsOf(context)
             ? child
             : FadeTransition(opacity: animation, child: child),
       );
}

class PosPage extends StatelessWidget {
  const PosPage({
    this.appBar,
    this.body,
    this.bottomNavigationBar,
    this.floatingActionButton,
    this.backgroundColor,
    this.resizeToAvoidBottomInset = true,
    super.key,
  });
  final PreferredSizeWidget? appBar;
  final Widget? body, bottomNavigationBar, floatingActionButton;
  final Color? backgroundColor;
  final bool resizeToAvoidBottomInset;
  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final keyboard = resizeToAvoidBottomInset
        ? MediaQuery.viewInsetsOf(context).bottom
        : 0.0;
    return ScrollNotificationObserver(
      child: ColoredBox(
        color: backgroundColor ?? palette.background,
        child: Padding(
          padding: EdgeInsets.only(bottom: keyboard),
          child: MediaQuery.removeViewInsets(
            context: context,
            removeBottom: resizeToAvoidBottomInset,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final rail =
                    constraints.maxWidth >= 1100 &&
                    bottomNavigationBar is PosNavigation;
                final content = Expanded(
                  key: const ValueKey('pos-page-content'),
                  child: Column(
                    children: [
                      ?appBar,
                      Expanded(
                        child: Stack(
                          children: [
                            Positioned.fill(
                              child: MediaQuery.removePadding(
                                context: context,
                                removeTop: appBar != null,
                                removeBottom:
                                    !rail &&
                                    bottomNavigationBar != null &&
                                    keyboard == 0,
                                child: body ?? const SizedBox.shrink(),
                              ),
                            ),
                            if (floatingActionButton != null)
                              Positioned(
                                right: 16,
                                bottom: 16,
                                child: floatingActionButton!,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
                final navigation = bottomNavigationBar == null
                    ? null
                    : KeyedSubtree(
                        key: const ValueKey('pos-page-navigation'),
                        child: rail
                            ? (bottomNavigationBar! as PosNavigation).asRail()
                            : bottomNavigationBar!,
                      );
                return Flex(
                  direction: rail ? Axis.horizontal : Axis.vertical,
                  children: [
                    if (rail && navigation != null) navigation,
                    content,
                    if (!rail && keyboard == 0 && navigation != null)
                      navigation,
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class PosHeader extends StatelessWidget implements PreferredSizeWidget {
  const PosHeader({
    this.title,
    this.leading,
    this.actions,
    this.bottom,
    this.titleSpacing = 20,
    this.automaticallyImplyLeading = true,
    this.backgroundColor,
    this.centerTitle = false,
    this.actionsInline = false,
    this.toolbarHeight = 72,
    super.key,
  });
  final Widget? title, leading;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final double? titleSpacing;
  final bool automaticallyImplyLeading, centerTitle, actionsInline;
  final double toolbarHeight;
  final Color? backgroundColor;
  @override
  Size get preferredSize =>
      Size.fromHeight(toolbarHeight + (bottom?.preferredSize.height ?? 0));
  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final back =
        leading ??
        (automaticallyImplyLeading && (ModalRoute.of(context)?.canPop ?? false)
            ? PosIconButton(
                tooltip: PosLocalLabels.of(context).backButtonTooltip,
                icon: const PosIcon(PosGlyphs.arrowBack),
                onPressed: () => Navigator.of(context).maybePop(),
              )
            : null);
    return Container(
      decoration: BoxDecoration(
        color: backgroundColor ?? palette.surface,
        border: Border(bottom: BorderSide(color: palette.outlineVariant)),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(minHeight: toolbarHeight),
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: titleSpacing ?? 20),
                child: LayoutBuilder(
                  builder: (context, box) {
                    final iconActions =
                        (actions?.length ?? 0) <= 3 &&
                        (actions?.every((action) => action is PosIconButton) ??
                            false);
                    final separate =
                        box.maxWidth < (iconActions ? 360 : 600) &&
                        !actionsInline &&
                        (actions?.isNotEmpty ?? false);
                    final heading = Row(
                      children: [
                        ?back,
                        if (back != null) const SizedBox(width: 12),
                        Expanded(
                          child: DefaultTextStyle(
                            style: PosTheme.of(context).textTheme.titleLarge!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            child: title ?? const SizedBox.shrink(),
                          ),
                        ),
                        if (!separate) ...?actions,
                      ],
                    );
                    return separate
                        ? Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              ConstrainedBox(
                                constraints: const BoxConstraints(
                                  minHeight: 56,
                                ),
                                child: heading,
                              ),
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Wrap(
                                  alignment: WrapAlignment.end,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: actions!,
                                ),
                              ),
                            ],
                          )
                        : Center(child: heading);
                  },
                ),
              ),
            ),
            ?bottom,
          ],
        ),
      ),
    );
  }
}

class PosSurface extends StatelessWidget {
  const PosSurface({
    required this.child,
    this.color,
    this.borderRadius,
    this.shape,
    this.clipBehavior = Clip.none,
    this.elevation = 0,
    this.shadowColor,
    this.surfaceTintColor,
    super.key,
  });
  final Widget child;
  final Color? color;
  final BorderRadiusGeometry? borderRadius;
  final ShapeBorder? shape;
  final Clip clipBehavior;
  final double elevation;
  final Color? shadowColor, surfaceTintColor;
  @override
  Widget build(BuildContext context) => Container(
    clipBehavior: clipBehavior,
    decoration: ShapeDecoration(
      color: Color.alphaBlend(
        surfaceTintColor ?? PosColors.transparent,
        color ?? PosTheme.of(context).colorScheme.surface,
      ),
      shadows: elevation <= 0
          ? null
          : [
              BoxShadow(
                color:
                    shadowColor ??
                    PosTheme.of(
                      context,
                    ).colorScheme.onSurface.withValues(alpha: .12),
                blurRadius: elevation * 2,
                offset: Offset(0, elevation),
              ),
            ],
      shape:
          shape ??
          RoundedRectangleBorder(
            borderRadius:
                borderRadius ??
                BorderRadius.circular(PosGeometry.surfaceRadius),
          ),
    ),
    child: child,
  );
}

class PosCard extends StatelessWidget {
  const PosCard({
    required this.child,
    this.color,
    this.margin = const EdgeInsets.all(4),
    this.clipBehavior = Clip.none,
    this.shape,
    this.elevation = 0,
    this.shadowColor,
    this.surfaceTintColor,
    super.key,
  });
  final Widget child;
  final Color? color;
  final EdgeInsetsGeometry? margin;
  final Clip clipBehavior;
  final ShapeBorder? shape;
  final double? elevation;
  final Color? shadowColor, surfaceTintColor;
  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    child: Padding(
      padding: margin ?? EdgeInsets.zero,
      child: PosSurface(
        color: color,
        clipBehavior: clipBehavior,
        elevation: elevation ?? 0,
        shadowColor: shadowColor,
        surfaceTintColor: surfaceTintColor,
        shape:
            shape ??
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(PosGeometry.surfaceRadius),
              side: BorderSide(
                color: PosTheme.of(context).colorScheme.outlineVariant,
              ),
            ),
        child: child,
      ),
    ),
  );
}

class PosTapRegion extends StatefulWidget {
  const PosTapRegion({
    required this.child,
    this.onTap,
    this.onLongPress,
    this.borderRadius,
    this.hoverColor,
    this.focusColor,
    this.splashColor,
    this.highlightColor,
    this.autofocus = false,
    this.focusNode,
    this.excludeFromSemantics = false,
    this.onFocusChange,
    this.selected,
    this.semanticLabel,
    this.statesController,
    super.key,
  });
  final Widget child;
  final VoidCallback? onTap, onLongPress;
  final bool? selected;
  final String? semanticLabel;
  final WidgetStatesController? statesController;
  final BorderRadius? borderRadius;
  final Color? hoverColor, focusColor, splashColor, highlightColor;
  final bool autofocus, excludeFromSemantics;
  final FocusNode? focusNode;
  final ValueChanged<bool>? onFocusChange;
  @override
  State<PosTapRegion> createState() => _PosTapRegionState();
}

class _PosTapRegionState extends State<PosTapRegion> {
  bool hover = false, focus = false, pressed = false;
  bool _hasFocus = false;
  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final enabled = widget.onTap != null || widget.onLongPress != null;
    final child = FocusableActionDetector(
      enabled: enabled,
      focusNode: widget.focusNode,
      autofocus: widget.autofocus,
      onFocusChange: (value) {
        _hasFocus = value;
        widget.statesController?.update(WidgetState.focused, value);
        widget.onFocusChange?.call(value);
        if (value) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted &&
                _hasFocus &&
                (ModalRoute.of(context)?.isCurrent ?? true)) {
              Scrollable.ensureVisible(
                context,
                alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
              );
            }
          });
        }
      },
      onShowFocusHighlight: (value) {
        setState(() => focus = value);
      },
      mouseCursor: enabled
          ? SystemMouseCursors.click
          : SystemMouseCursors.basic,
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) {
            widget.onTap?.call();
            return null;
          },
        ),
      },
      child: MouseRegion(
        onEnter: (_) => _hover(true),
        onExit: (_) => _hover(false),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          excludeFromSemantics: true,
          onTap: widget.onTap,
          onLongPress: widget.onLongPress,
          onTapDown: enabled ? (_) => _press(true) : null,
          onTapCancel: () => _press(false),
          onTapUp: (_) => _press(false),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius:
                  widget.borderRadius ??
                  BorderRadius.circular(PosGeometry.surfaceRadius),
              color: enabled && pressed
                  ? widget.highlightColor ??
                        widget.splashColor ??
                        palette.primary.withValues(alpha: .12)
                  : enabled && hover
                  ? widget.hoverColor ?? palette.primary.withValues(alpha: .055)
                  : null,
              border: Border.all(
                color: focus
                    ? widget.focusColor ?? palette.primary
                    : PosColors.transparent,
                width: 2,
              ),
            ),
            child: widget.semanticLabel == null
                ? widget.child
                : Semantics(
                    label: widget.semanticLabel,
                    excludeSemantics: true,
                    child: widget.child,
                  ),
          ),
        ),
      ),
    );
    return widget.excludeFromSemantics
        ? child
        : Semantics(
            container: true,
            button: true,
            selected: widget.selected,
            enabled: enabled,
            onTap: widget.onTap,
            onLongPress: widget.onLongPress,
            child: child,
          );
  }

  void _press(bool value) {
    widget.statesController?.update(WidgetState.pressed, value);
    setState(() => pressed = value);
  }

  void _hover(bool value) {
    widget.statesController?.update(WidgetState.hovered, value);
    if (hover != value) setState(() => hover = value);
  }
}

class PosButtonStyle {
  const PosButtonStyle({
    this.minimumSize,
    this.backgroundColor,
    this.foregroundColor,
    this.iconColor,
    this.textStyle,
    this.padding,
    this.alignment,
    this.shape,
    this.side,
    this.tapTargetSize,
    this.visualDensity,
    this.selectedBackgroundColor,
    this.selectedForegroundColor,
  });
  final WidgetStateProperty<Size?>? minimumSize;
  final WidgetStateProperty<Color?>? backgroundColor,
      foregroundColor,
      iconColor;
  final WidgetStateProperty<TextStyle?>? textStyle;
  final WidgetStateProperty<EdgeInsetsGeometry?>? padding;
  final AlignmentGeometry? alignment;
  final WidgetStateProperty<OutlinedBorder?>? shape;
  final WidgetStateProperty<BorderSide?>? side;
  final Object? tapTargetSize, visualDensity;
  final Color? selectedBackgroundColor, selectedForegroundColor;
  PosButtonStyle copyWith({WidgetStateProperty<BorderSide?>? side}) =>
      PosButtonStyle(
        minimumSize: minimumSize,
        backgroundColor: backgroundColor,
        foregroundColor: foregroundColor,
        iconColor: iconColor,
        textStyle: textStyle,
        padding: padding,
        alignment: alignment,
        shape: shape,
        side: side ?? this.side,
        selectedBackgroundColor: selectedBackgroundColor,
        selectedForegroundColor: selectedForegroundColor,
      );
}

PosButtonStyle _buttonStyle({
  Size? minimumSize,
  Color? backgroundColor,
  Color? foregroundColor,
  Color? iconColor,
  TextStyle? textStyle,
  EdgeInsetsGeometry? padding,
  AlignmentGeometry? alignment,
  OutlinedBorder? shape,
  BorderSide? side,
  Color? disabledBackgroundColor,
  Color? disabledForegroundColor,
  Color? selectedBackgroundColor,
  Color? selectedForegroundColor,
}) => PosButtonStyle(
  minimumSize: WidgetStatePropertyAll(minimumSize),
  backgroundColor: WidgetStateProperty.resolveWith(
    (s) => s.contains(WidgetState.disabled)
        ? disabledBackgroundColor
        : s.contains(WidgetState.selected) && selectedBackgroundColor != null
        ? selectedBackgroundColor
        : backgroundColor,
  ),
  foregroundColor: WidgetStateProperty.resolveWith(
    (s) => s.contains(WidgetState.disabled)
        ? disabledForegroundColor
        : s.contains(WidgetState.selected) && selectedForegroundColor != null
        ? selectedForegroundColor
        : foregroundColor,
  ),
  iconColor: WidgetStatePropertyAll(iconColor),
  textStyle: WidgetStatePropertyAll(textStyle),
  padding: WidgetStatePropertyAll(padding),
  alignment: alignment,
  shape: WidgetStatePropertyAll(shape),
  side: WidgetStatePropertyAll(side),
  selectedBackgroundColor: selectedBackgroundColor,
  selectedForegroundColor: selectedForegroundColor,
);

class PosButton extends StatefulWidget {
  const PosButton({
    required this.onPressed,
    required this.child,
    this.style,
    this.autofocus = false,
    this.focusNode,
    this.onLongPress,
    this.selected,
    super.key,
  }) : icon = null,
       kind = 0;
  const PosButton.icon({
    required this.onPressed,
    required Widget label,
    required this.icon,
    this.style,
    this.autofocus = false,
    this.focusNode,
    this.onLongPress,
    this.selected,
    super.key,
  }) : child = label,
       kind = 0;
  const PosButton.tonal({
    required this.onPressed,
    required this.child,
    this.style,
    this.autofocus = false,
    this.focusNode,
    this.onLongPress,
    this.selected,
    super.key,
  }) : icon = null,
       kind = 3;
  const PosButton.tonalIcon({
    required this.onPressed,
    required Widget label,
    required this.icon,
    this.style,
    this.autofocus = false,
    this.focusNode,
    this.onLongPress,
    this.selected,
    super.key,
  }) : child = label,
       kind = 3;
  const PosButton._({
    required this.onPressed,
    required this.child,
    this.icon,
    this.style,
    this.autofocus = false,
    this.focusNode,
    this.onLongPress,
    this.selected,
    required this.kind,
    super.key,
  });
  final VoidCallback? onPressed, onLongPress;
  final Widget child;
  final Widget? icon;
  final PosButtonStyle? style;
  final bool autofocus;
  final bool? selected;
  final FocusNode? focusNode;
  final int kind;
  bool get enabled => onPressed != null || onLongPress != null;
  static const styleFrom = _buttonStyle;
  @override
  State<PosButton> createState() => _PosButtonState();

  Widget _build(
    BuildContext context,
    Set<WidgetState> states,
    WidgetStatesController controller,
  ) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final minimum = style?.minimumSize?.resolve(states);
    final foreground =
        style?.foregroundColor?.resolve(states) ??
        (enabled && selected == true ? style?.selectedForegroundColor : null) ??
        (!enabled
            ? palette.onSurfaceVariant
            : kind == 0
            ? (palette.midnight
                  ? palette.onPrimaryContainer
                  : palette.onPrimary)
            : kind == 2
            ? palette.primary
            : palette.onSurface);
    final background =
        style?.backgroundColor?.resolve(states) ??
        (enabled && selected == true ? style?.selectedBackgroundColor : null) ??
        (!enabled
            ? palette.surfaceContainerHighest
            : kind == 0
            ? (palette.midnight ? palette.primaryContainer : palette.primary)
            : kind == 3
            ? palette.primaryContainer
            : kind == 1
            ? palette.surface
            : PosColors.transparent);
    final ink = foreground;
    final fill = background;
    final baseShape =
        style?.shape?.resolve(states) ??
        RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PosGeometry.controlRadius),
          side: kind == 1
              ? BorderSide(color: palette.outlineVariant)
              : kind == 0 && palette.midnight && enabled
              ? BorderSide(color: palette.signal)
              : BorderSide.none,
        );
    final shape = baseShape.copyWith(side: style?.side?.resolve(states));
    return ConstrainedBox(
      constraints: BoxConstraints(
        minWidth: math.max(
          48,
          minimum?.width.isFinite == true ? minimum!.width : 0,
        ),
        minHeight: math.max(kind == 0 ? 56 : 48, minimum?.height ?? 0),
      ),
      child: DecoratedBox(
        decoration: ShapeDecoration(color: fill, shape: shape),
        child: PosTapRegion(
          onTap: onPressed,
          onLongPress: onLongPress,
          selected: selected,
          statesController: controller,
          borderRadius: shape is RoundedRectangleBorder
              ? shape.borderRadius.resolve(Directionality.of(context))
              : BorderRadius.circular(PosGeometry.controlRadius),
          focusNode: focusNode,
          focusColor: kind == 0 ? palette.onSurface : palette.primary,
          autofocus: autofocus,
          child: Padding(
            padding:
                style?.padding?.resolve(states) ??
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Align(
              widthFactor: 1,
              heightFactor: 1,
              alignment: style?.alignment ?? Alignment.center,
              child: DefaultTextStyle(
                style:
                    (style?.textStyle?.resolve(states) ??
                            theme.textTheme.labelLarge!)
                        .copyWith(color: ink),
                child: IconTheme(
                  data: IconThemeData(
                    color: style?.iconColor?.resolve(states) ?? ink,
                    size: 20,
                  ),
                  child: icon == null
                      ? child
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            icon!,
                            const SizedBox(width: 8),
                            Flexible(child: child),
                          ],
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PosButtonState extends State<PosButton> {
  final _states = WidgetStatesController();

  @override
  void dispose() {
    _states.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _states,
    builder: (context, _) => widget._build(context, {
      ..._states.value,
      if (!widget.enabled) WidgetState.disabled,
      if (widget.selected == true) WidgetState.selected,
    }, _states),
  );
}

class PosOutlineButton extends PosButton {
  static const styleFrom = _buttonStyle;
  const PosOutlineButton({
    required super.onPressed,
    required super.child,
    super.style,
    super.autofocus,
    super.focusNode,
    super.onLongPress,
    super.key,
  }) : super._(kind: 1);
  const PosOutlineButton.icon({
    required super.onPressed,
    required Widget label,
    required Widget icon,
    super.style,
    super.autofocus,
    super.focusNode,
    super.key,
  }) : super._(kind: 1, child: label, icon: icon);
}

class PosTextButton extends PosButton {
  static const styleFrom = _buttonStyle;
  const PosTextButton({
    required super.onPressed,
    required super.child,
    super.style,
    super.autofocus,
    super.focusNode,
    super.onLongPress,
    super.key,
  }) : super._(kind: 2);
  const PosTextButton.icon({
    required super.onPressed,
    required Widget label,
    required Widget icon,
    super.style,
    super.autofocus,
    super.focusNode,
    super.key,
  }) : super._(kind: 2, child: label, icon: icon);
}

class PosIconButton extends StatefulWidget {
  const PosIconButton({
    required this.onPressed,
    required this.icon,
    this.tooltip,
    this.style,
    this.iconSize = 24,
    this.color,
    this.padding = const EdgeInsets.all(12),
    this.constraints,
    this.autofocus = false,
    this.focusNode,
    super.key,
  });
  final VoidCallback? onPressed;
  final Widget icon;
  final String? tooltip;
  final PosButtonStyle? style;
  final double? iconSize;
  final Color? color;
  final EdgeInsetsGeometry padding;
  final BoxConstraints? constraints;
  final bool autofocus;
  final FocusNode? focusNode;
  static const styleFrom = _buttonStyle;
  @override
  State<PosIconButton> createState() => _PosIconButtonState();

  Widget _build(
    BuildContext context,
    Set<WidgetState> states,
    WidgetStatesController controller,
  ) {
    final palette = PosTheme.of(context).colorScheme;
    final minimum = style?.minimumSize?.resolve(states);
    final shape =
        (style?.shape?.resolve(states) ??
                RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    PosGeometry.controlRadius,
                  ),
                ))
            .copyWith(side: style?.side?.resolve(states));
    final ink =
        style?.iconColor?.resolve(states) ??
        style?.foregroundColor?.resolve(states) ??
        (onPressed == null
            ? palette.onSurfaceVariant
            : color ?? palette.onSurface);
    final button = ConstrainedBox(
      constraints: BoxConstraints(
        minWidth: math.max(
          48,
          math.max(
            constraints?.minWidth ?? 0,
            minimum?.width.isFinite == true ? minimum!.width : 0,
          ),
        ),
        minHeight: math.max(
          48,
          math.max(constraints?.minHeight ?? 0, minimum?.height ?? 0),
        ),
        maxWidth: math.max(48, constraints?.maxWidth ?? double.infinity),
        maxHeight: math.max(48, constraints?.maxHeight ?? double.infinity),
      ),
      child: DecoratedBox(
        decoration: ShapeDecoration(
          color:
              style?.backgroundColor?.resolve(states) ?? PosColors.transparent,
          shape: shape,
        ),
        child: PosTapRegion(
          onTap: onPressed,
          autofocus: autofocus,
          focusNode: focusNode,
          statesController: controller,
          semanticLabel: tooltip,
          borderRadius: shape is RoundedRectangleBorder
              ? shape.borderRadius.resolve(Directionality.of(context))
              : BorderRadius.circular(PosGeometry.controlRadius),
          child: Padding(
            padding: style?.padding?.resolve(states) ?? padding,
            child: Align(
              alignment: style?.alignment ?? Alignment.center,
              widthFactor: 1,
              heightFactor: 1,
              child: IconTheme(
                data: IconThemeData(size: iconSize, color: ink),
                child: icon,
              ),
            ),
          ),
        ),
      ),
    );
    return tooltip == null
        ? button
        : PosTooltip(message: tooltip!, child: button);
  }
}

class _PosIconButtonState extends State<PosIconButton> {
  final _states = WidgetStatesController();

  @override
  void dispose() {
    _states.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _states,
    builder: (context, _) => widget._build(context, {
      ..._states.value,
      if (widget.onPressed == null) WidgetState.disabled,
    }, _states),
  );
}

class PosOrderButton extends StatelessWidget {
  const PosOrderButton.extended({
    required this.onPressed,
    required this.label,
    required this.icon,
    super.key,
  });
  final VoidCallback? onPressed;
  final Widget label, icon;
  @override
  Widget build(BuildContext context) =>
      PosButton.icon(onPressed: onPressed, label: label, icon: icon);
}

class PosTooltip extends StatelessWidget {
  const PosTooltip({required this.message, required this.child, super.key});
  final String message;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    return RawTooltip(
      semanticsTooltip: message,
      hoverDelay: const Duration(milliseconds: 500),
      enableFeedback: false,
      ignorePointer: true,
      animationStyle: MediaQuery.disableAnimationsOf(context)
          ? AnimationStyle.noAnimation
          : const AnimationStyle(duration: Duration(milliseconds: 120)),
      tooltipBuilder: (context, animation) => FadeTransition(
        opacity: animation,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 230),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: palette.onSurface,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            message,
            style: TextStyle(fontSize: 13, color: palette.surface),
          ),
        ),
      ),
      child: child,
    );
  }
}

class PosDivider extends StatelessWidget {
  const PosDivider({
    this.height = 24,
    this.thickness = 1,
    this.color,
    this.indent = 0,
    this.endIndent = 0,
    super.key,
  });
  final double? height, thickness, indent, endIndent;
  final Color? color;
  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: Center(
      child: Container(
        margin: EdgeInsets.only(left: indent ?? 0, right: endIndent ?? 0),
        height: thickness,
        color: color ?? PosTheme.of(context).colorScheme.outlineVariant,
      ),
    ),
  );
}

class PosVerticalDivider extends StatelessWidget {
  const PosVerticalDivider({
    this.width = 24,
    this.thickness = 1,
    this.color,
    super.key,
  });
  final double? width, thickness;
  final Color? color;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    child: Center(
      child: Container(
        width: thickness,
        color: color ?? PosTheme.of(context).colorScheme.outlineVariant,
      ),
    ),
  );
}

Future<T?> showPosDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool barrierDismissible = true,
  bool useRootNavigator = true,
  Color? barrierColor,
  RouteSettings? routeSettings,
}) {
  final data = PosTheme.of(context);
  return Navigator.of(context, rootNavigator: useRootNavigator).push<T>(
    RawDialogRoute<T>(
      traversalEdgeBehavior: TraversalEdgeBehavior.closedLoop,
      directionalTraversalEdgeBehavior: TraversalEdgeBehavior.closedLoop,
      settings: routeSettings,
      barrierDismissible: barrierDismissible,
      barrierColor: barrierColor ?? const Color(0x66131D2B),
      barrierLabel: Localizations.localeOf(context).languageCode == 'es'
          ? 'Cerrar'
          : 'Close',
      transitionDuration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 160),
      pageBuilder: (context, animation, secondary) => PosTheme(
        data: data,
        child: SafeArea(child: Builder(builder: builder)),
      ),
    ),
  );
}

Future<T?> showPosSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool isDismissible = true,
  bool enableDrag = true,
  bool useSafeArea = false,
  Color? backgroundColor,
  BoxConstraints? constraints,
  bool useRootNavigator = false,
  bool? showDragHandle,
}) => showPosDialog<T>(
  context: context,
  useRootNavigator: useRootNavigator,
  barrierDismissible: isDismissible,
  builder: (context) => Align(
    alignment: Alignment.bottomCenter,
    child: PosSheet(
      enableDrag: enableDrag && isDismissible,
      showDragHandle: showDragHandle ?? false,
      useRootNavigator: useRootNavigator,
      backgroundColor: backgroundColor,
      constraints:
          constraints ??
          BoxConstraints(
            maxWidth: 760,
            maxHeight:
                MediaQuery.sizeOf(context).height *
                (isScrollControlled ? .96 : .72),
          ),
      child: builder(context),
    ),
  ),
);

/// The frame a sheet is drawn in.
///
/// The frame keeps the sheet in the operator's hand: a downward drag moves it,
/// and a drag past the floor distance, or a flick, closes it.
///
/// The frame reads the raw pointer, not the gesture arena, and the reason is
/// stated here because a reader will ask. A list inside the sheet claims a
/// vertical drag before the frame can see the arena decision, so an arena-based
/// frame can never pull a sheet whose content is a list — and every sheet in the
/// till has a list in it. The frame follows the content's scroll position
/// instead, and takes the drag only when that list already sits at its top. A
/// drag on the handle answers to the finger at all times.
class PosSheet extends StatefulWidget {
  const PosSheet({
    required this.child,
    this.enableDrag = true,
    this.showDragHandle = false,
    this.useRootNavigator = false,
    this.backgroundColor,
    this.constraints,
    super.key,
  });

  final Widget child;
  final bool enableDrag;
  final bool showDragHandle;
  final bool useRootNavigator;
  final Color? backgroundColor;
  final BoxConstraints? constraints;

  @override
  State<PosSheet> createState() => _PosSheetState();
}

final class _PosSheetState extends State<PosSheet> {
  /// The top of the sheet that always answers to the finger.
  static const _handleBand = 22.0;

  /// The share of the sheet's height that a slow drag must cross to close it.
  static const _closeFraction = .3;

  /// The downward speed, in pixels per second, that closes it on release.
  static const _closeSpeed = 700.0;

  /// How far the sheet has travelled down, in logical pixels.
  double _offset = 0;
  double _startOffset = 0;
  double _height = 0;
  double _speed = 0;
  Offset? _origin;
  Offset _last = Offset.zero;
  Duration _lastStamp = Duration.zero;
  bool _dragging = false;
  bool _onHandle = false;
  bool _closing = false;
  bool _settling = false;

  /// The content's own list is at its top, so a downward drag can pull the
  /// sheet instead of the list. Updated without a rebuild: it changes a gesture
  /// decision, not a pixel.
  bool _contentAtTop = true;

  bool _contentScrolled(ScrollNotification notification) {
    if (notification.depth == 0 && notification.metrics.axis == Axis.vertical) {
      _contentAtTop = notification.metrics.extentBefore <= .5;
    }
    return false;
  }

  void _pointerDown(PointerDownEvent event) {
    // A release animation owns the sheet until it reports back, and one finger
    // owns the drag while it lasts.
    if (_closing || _settling || _origin != null) return;
    _origin = event.position;
    _last = event.position;
    _lastStamp = event.timeStamp;
    _startOffset = _offset;
    _speed = 0;
    _dragging = false;
    _onHandle = event.localPosition.dy <= _handleBand;
    _height = context.size?.height ?? MediaQuery.sizeOf(context).height;
  }

  void _pointerMove(PointerMoveEvent event) {
    final origin = _origin;
    if (origin == null) return;
    final travel = event.position - origin;
    if (!_dragging) {
      final downwards = travel.dy.abs() > travel.dx.abs();
      if (!downwards || travel.dy.abs() < kTouchSlop) return;
      if (travel.dy <= 0) {
        // An upward drag belongs to the content, and it stays there.
        _origin = null;
        return;
      }
      if (!_onHandle && !_contentAtTop) {
        _origin = null;
        return;
      }
      _dragging = true;
    }
    final elapsed = event.timeStamp - _lastStamp;
    if (elapsed.inMicroseconds > 0) {
      _speed =
          (event.position.dy - _last.dy) /
          (elapsed.inMicroseconds / Duration.microsecondsPerSecond);
    }
    _last = event.position;
    _lastStamp = event.timeStamp;
    setState(() {
      _offset = (travel.dy + _startOffset).clamp(0.0, _height);
    });
  }

  void _pointerUp(PointerUpEvent event) {
    if (!_dragging) {
      _origin = null;
      return;
    }
    _origin = null;
    _dragging = false;
    if (_offset > _height * _closeFraction || _speed > _closeSpeed) {
      _close();
    } else {
      _settleBack();
    }
  }

  void _pointerCancel(PointerCancelEvent event) {
    _origin = null;
    _dragging = false;
    _settleBack();
  }

  /// Sends the sheet the rest of the way down, then closes the route.
  void _close() {
    if (_closing) return;
    setState(() {
      _closing = true;
      _settling = true;
      _offset = _height > 0 ? _height : _offset;
    });
  }

  /// Returns the sheet to its floor, for a drag that did not mean "close".
  void _settleBack() {
    if (_closing) return;
    setState(() {
      // A drag that ended where it started has nothing to animate, and a flag
      // left standing would refuse the next drag.
      _settling = _offset != 0;
      _offset = 0;
    });
  }

  void _slideFinished() {
    if (!_settling) return;
    final closed = _closing;
    setState(() => _settling = false);
    if (closed && mounted) {
      Navigator.of(context, rootNavigator: widget.useRootNavigator).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final handle = widget.showDragHandle
        ? PosSheetDragHandle(onClose: _close)
        : null;
    final panel = Container(
      constraints: widget.constraints,
      decoration: BoxDecoration(
        color: widget.backgroundColor ?? palette.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      clipBehavior: Clip.antiAlias,
      child: NotificationListener<ScrollNotification>(
        onNotification: _contentScrolled,
        child: handle == null
            ? widget.child
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  handle,
                  Flexible(child: widget.child),
                ],
              ),
      ),
    );
    if (!widget.enableDrag) return panel;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: _offset),
      // 120 ms is `UmiMotion.fast`, written as a literal because this library
      // sits below the app's theme and does not import it.
      duration: _settling ? const Duration(milliseconds: 120) : Duration.zero,
      curve: Curves.easeOut,
      onEnd: _slideFinished,
      builder: (context, offset, child) =>
          Transform.translate(offset: Offset(0, offset), child: child),
      // The listener sits below the translation, so its box travels with the
      // panel and the whole panel answers the finger, handle included.
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: _pointerDown,
        onPointerMove: _pointerMove,
        onPointerUp: _pointerUp,
        onPointerCancel: _pointerCancel,
        child: panel,
      ),
    );
  }
}

/// The pill an operator pulls to close a sheet.
///
/// The handle also carries the close action for assistive technology. A screen
/// reader cannot pull a gesture, so the same grip answers a tap from the
/// accessibility tree; the pill itself does not answer a pointer tap.
class PosSheetDragHandle extends StatelessWidget {
  const PosSheetDragHandle({this.onClose, super.key});
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final es = Localizations.localeOf(context).languageCode == 'es';
    return Semantics(
      button: onClose != null,
      label: es ? 'Cerrar' : 'Close',
      onTap: onClose,
      child: ExcludeSemantics(
        child: SizedBox(
          height: 22,
          child: Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: palette.onSurfaceVariant.withValues(alpha: .45),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PosDialog extends StatelessWidget {
  const PosDialog({
    this.child,
    this.insetPadding = const EdgeInsets.all(24),
    this.backgroundColor,
    this.shape,
    this.constraints,
    this.clipBehavior = Clip.antiAlias,
    super.key,
  }) : fullscreen = false;
  const PosDialog.fullscreen({required this.child, super.key})
    : fullscreen = true,
      insetPadding = EdgeInsets.zero,
      backgroundColor = null,
      shape = null,
      constraints = null,
      clipBehavior = Clip.none;
  final bool fullscreen;
  final Clip clipBehavior;
  final Widget? child;
  final EdgeInsets? insetPadding;
  final Color? backgroundColor;
  final ShapeBorder? shape;
  final BoxConstraints? constraints;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding:
          (insetPadding ?? EdgeInsets.zero) +
          EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: MediaQuery.removeViewInsets(
        context: context,
        removeBottom: true,
        child: ConstrainedBox(
          constraints: fullscreen
              ? BoxConstraints.tight(MediaQuery.sizeOf(context))
              : constraints ?? const BoxConstraints(maxWidth: 760),
          child: PosSurface(
            color: backgroundColor,
            shape:
                shape ??
                RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                  side: BorderSide(
                    color: PosTheme.of(context).colorScheme.outlineVariant,
                  ),
                ),
            clipBehavior: clipBehavior,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
      ),
    ),
  );
}

class PosAlertDialog extends StatelessWidget {
  const PosAlertDialog({
    this.title,
    this.content,
    this.actions,
    this.scrollable = false,
    this.insetPadding = const EdgeInsets.all(24),
    this.contentPadding = const EdgeInsets.fromLTRB(24, 16, 24, 24),
    this.titlePadding = const EdgeInsets.fromLTRB(24, 24, 24, 0),
    this.actionsPadding = const EdgeInsets.fromLTRB(24, 0, 24, 24),
    this.constraints,
    this.icon,
    super.key,
  });
  final Widget? title, content, icon;
  final List<Widget>? actions;
  final bool scrollable;
  final EdgeInsets? insetPadding;
  final EdgeInsetsGeometry? contentPadding, titlePadding, actionsPadding;
  final BoxConstraints? constraints;
  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return PosDialog(
      insetPadding: insetPadding,
      constraints: constraints ?? const BoxConstraints(maxWidth: 620),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (icon != null)
            Padding(padding: const EdgeInsets.only(top: 24), child: icon!),
          if (title != null)
            Padding(
              padding: titlePadding ?? EdgeInsets.zero,
              child: DefaultTextStyle(
                style: theme.textTheme.headlineSmall!,
                child: title!,
              ),
            ),
          if (content != null)
            Flexible(
              child: SingleChildScrollView(
                padding: contentPadding,
                child: content!,
              ),
            ),
          if (actions != null)
            Padding(
              padding: actionsPadding ?? EdgeInsets.zero,
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 8,
                children: actions!,
              ),
            ),
        ],
      ),
    );
  }
}

class PosSpinner extends StatefulWidget {
  const PosSpinner({
    this.value,
    this.strokeWidth = 2.5,
    this.color,
    this.valueColor,
    this.semanticsLabel,
    super.key,
  });
  final double? value;
  final double strokeWidth;
  final Color? color;
  final Animation<Color?>? valueColor;
  final String? semanticsLabel;
  @override
  State<PosSpinner> createState() => _PosSpinnerState();
}

class _PosSpinnerState extends State<PosSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController rotation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  );
  void _updateMotion() {
    final animate =
        widget.value == null && !MediaQuery.disableAnimationsOf(context);
    if (animate && !rotation.isAnimating) rotation.repeat();
    if (!animate && rotation.isAnimating) rotation.stop();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _updateMotion();
  }

  @override
  void didUpdateWidget(PosSpinner oldWidget) {
    super.didUpdateWidget(oldWidget);
    _updateMotion();
  }

  @override
  void dispose() {
    rotation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final child = SizedBox.square(
      dimension: 28,
      child: CustomPaint(
        painter: _ProgressPainter(
          widget.value ?? .72,
          widget.color ??
              widget.valueColor?.value ??
              IconTheme.of(context).color ??
              PosTheme.of(context).colorScheme.primary,
          widget.strokeWidth,
        ),
      ),
    );
    return Semantics(
      label: widget.semanticsLabel ?? PosLocalLabels.of(context).loading,
      liveRegion: true,
      child: widget.value != null || MediaQuery.disableAnimationsOf(context)
          ? child
          : RotationTransition(turns: rotation, child: child),
    );
  }
}

class _ProgressPainter extends CustomPainter {
  _ProgressPainter(this.value, this.color, this.stroke);
  final double value, stroke;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) => canvas.drawArc(
    Offset.zero & size,
    -math.pi / 2,
    math.pi * 2 * value,
    false,
    Paint()
      ..color = color
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke,
  );
  @override
  bool shouldRepaint(_ProgressPainter old) =>
      value != old.value || color != old.color || stroke != old.stroke;
}

class PosProgress extends StatefulWidget {
  const PosProgress({
    this.value,
    this.color,
    this.backgroundColor,
    this.minHeight = 3,
    super.key,
  });
  final double? value, minHeight;
  final Color? color, backgroundColor;
  @override
  State<PosProgress> createState() => _PosProgressState();
}

class _PosProgressState extends State<PosProgress>
    with SingleTickerProviderStateMixin {
  late final _travel = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  void _updateMotion() {
    final animate =
        widget.value == null && !MediaQuery.disableAnimationsOf(context);
    if (animate && !_travel.isAnimating) _travel.repeat();
    if (!animate && _travel.isAnimating) _travel.stop();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _updateMotion();
  }

  @override
  void didUpdateWidget(PosProgress oldWidget) {
    super.didUpdateWidget(oldWidget);
    _updateMotion();
  }

  @override
  void dispose() {
    _travel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosTheme.of(context).colorScheme;
    final value = widget.value?.clamp(0.0, 1.0);
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Semantics(
      label: PosLocalLabels.of(context).loading,
      value: value == null ? null : '${(value * 100).round()}%',
      child: SizedBox(
        height: widget.minHeight ?? 3,
        width: double.infinity,
        child: RepaintBoundary(
          child: CustomPaint(
            painter: _LineProgressPainter(
              value: value,
              reduced: reduced,
              travel: _travel,
              color: widget.color ?? palette.primary,
              background: widget.backgroundColor ?? palette.outlineVariant,
            ),
          ),
        ),
      ),
    );
  }
}

class _LineProgressPainter extends CustomPainter {
  _LineProgressPainter({
    required this.value,
    required this.reduced,
    required this.travel,
    required this.color,
    required this.background,
  }) : super(repaint: travel);
  final double? value;
  final bool reduced;
  final Animation<double> travel;
  final Color color, background;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.clipRRect(
      RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(2)),
    );
    canvas.drawRect(Offset.zero & size, Paint()..color = background);
    final ink = Paint()..color = color;
    if (value != null) {
      canvas.drawRect(
        Rect.fromLTWH(0, 0, size.width * value!, size.height),
        ink,
      );
    } else if (reduced) {
      // Separate marks express an unknown amount without a stationary fraction.
      for (var x = 0.0; x < size.width; x += 16) {
        canvas.drawRect(Rect.fromLTWH(x, 0, 6, size.height), ink);
      }
    } else {
      final segment = size.width * .28;
      final left = (size.width + segment) * travel.value - segment;
      canvas.drawRect(Rect.fromLTWH(left, 0, segment, size.height), ink);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_LineProgressPainter old) =>
      value != old.value ||
      reduced != old.reduced ||
      color != old.color ||
      background != old.background ||
      travel != old.travel;
}

class PosTime {
  const PosTime({required this.hour, required this.minute});
  PosTime.fromDateTime(DateTime date) : hour = date.hour, minute = date.minute;
  final int hour, minute;
}

class PosLocalLabels {
  const PosLocalLabels(this.spanish);
  final bool spanish;
  static PosLocalLabels of(BuildContext context) =>
      PosLocalLabels(Localizations.localeOf(context).languageCode == 'es');
  String get backButtonTooltip => spanish ? 'Volver' : 'Back';
  String get loading => spanish ? 'En proceso' : 'In progress';
  String formatTimeOfDay(PosTime time) =>
      '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
}
