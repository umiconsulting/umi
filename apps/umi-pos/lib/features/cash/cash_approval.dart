/// The manager's PIN, asked for over the money it authorizes.
///
/// The approval used to be a second form: a wide empty box restating the
/// operation, a PIN in a text field a thousand pixels wide, everything else
/// blacked out, and — when the PIN was refused — nothing left on screen at all.
///
/// This is built to four rules.
///
/// *Touchable.* Every target clears the 48 px floor by a wide margin: keys are
/// 72 tall, the two decisions are 56, and the close is a 48 px button. Nothing
/// on this dialog is a small target on a counter tablet.
///
/// *Symmetric.* Two columns of equal width with a hairline between them; a
/// hairline above a decision bar of two equal buttons. The eye reads left to
/// right — what is being authorized, then who authorizes it.
///
/// *Proportional.* One spacing scale, the same three text sizes as the rest of
/// the till, and an amount set at the largest step so the money is the thing
/// that looks important rather than the box around it.
///
/// *Inviting, and honest.* A PIN that cannot work is not invited: when the till
/// is locked the keypad greys out and the dialog says so, instead of inviting
/// keystrokes that are certain to be refused.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/pin_entry.dart';

/// What a manager is being asked to put their PIN against.
final class ManagerApprovalPrompt {
  const ManagerApprovalPrompt({
    required this.operation,
    required this.amount,
    required this.reason,
    required this.registerName,
    this.expectedInDrawer,
    this.expectedAfter,
  });

  final String operation;
  final String amount;
  final String reason;
  final String registerName;

  /// What the drawer is expected to hold now, and once this movement is booked.
  /// A manager authorizing money out of a drawer is entitled to see what the
  /// authorization does to it. Both are null when the drawer's expectation is
  /// not known yet, and the panel is then left out rather than guessed at.
  final String? expectedInDrawer;
  final String? expectedAfter;
}

/// A refused credential, said in the till's own words.
///
/// [retryable] is the difference between "try another manager" and "no
/// credential on this device will be accepted for a few minutes". The API tells
/// these apart; the dialog must not invite a keystroke it knows will fail.
final class ApprovalRefusal {
  const ApprovalRefusal(this.message, {required this.retryable});

  final String message;
  final bool retryable;
}

ApprovalRefusal approvalRefusal(AppLocalizations l, String code) =>
    switch (code) {
      'PIN_LOCKED' => ApprovalRefusal(
        l.managerApprovalPinLocked,
        retryable: false,
      ),
      'PERMISSION_DENIED' => ApprovalRefusal(
        l.managerApprovalPinRefused,
        retryable: true,
      ),
      _ => ApprovalRefusal(l.cashOperationFailedMessage, retryable: true),
    };

/// The manager's PIN, or `null` when the movement was abandoned.
Future<String?> showCashApprovalDialog(
  BuildContext context, {
  required ManagerApprovalPrompt request,
  String? failure,
  bool retryable = true,
}) => showDialog<String>(
  context: context,
  // One dim, not two. The cash screen already sits behind its own fullscreen
  // route's barrier, and a second barrier on top of that turned everything but
  // the app bar to black: the manager was authorizing money with no sight of
  // the drawer it was coming out of.
  barrierColor: Colors.transparent,
  builder: (_) =>
      CashApprovalDialog(request: request, failure: failure, retryable: retryable),
);

final class CashApprovalDialog extends StatefulWidget {
  const CashApprovalDialog({
    required this.request,
    this.failure,
    this.retryable = true,
    super.key,
  });

  final ManagerApprovalPrompt request;
  final String? failure;
  final bool retryable;

  @override
  State<CashApprovalDialog> createState() => _CashApprovalDialogState();
}

final class _CashApprovalDialogState extends State<CashApprovalDialog> {
  final _pin = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _pin.dispose();
    _focus.dispose();
    super.dispose();
  }

  bool get _ready => widget.retryable && _pin.text.length >= 4;

  /// Applies one keypad action to the PIN: a digit appends up to the eight-digit
  /// ceiling, `back` drops the last, `clear` empties it.
  void _press(String key) {
    setState(() {
      if (key == 'back') {
        if (_pin.text.isNotEmpty) {
          _pin.text = _pin.text.substring(0, _pin.text.length - 1);
        }
      } else if (key == 'clear') {
        _pin.clear();
      } else if (_pin.text.length < 8) {
        _pin.text = _pin.text + key;
      }
    });
  }

  /// A physical keyboard keeps working: the terminal has one during setup, and
  /// a screen reader user should not have to hunt for a keypad.
  void _onKey(KeyEvent event) {
    if (!widget.retryable) return;
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return;
    final character = event.character;
    if (character != null &&
        character.length == 1 &&
        '0123456789'.contains(character)) {
      _press(character);
      return;
    }
    if (event.logicalKey == LogicalKeyboardKey.backspace ||
        event.logicalKey == LogicalKeyboardKey.delete) {
      _press('back');
      return;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter ||
        event.logicalKey == LogicalKeyboardKey.numpadEnter) {
      _submit();
    }
  }

  void _submit() {
    if (!_ready) return;
    Navigator.pop(context, _pin.text);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final es = Localizations.localeOf(context).languageCode == 'es';
    final failure = widget.failure;

    return KeyboardListener(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Dialog(
        insetPadding: const EdgeInsets.all(UmiSpacing.lg),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UmiRadius.surface),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 960),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(
                title: l.managerApprovalTitle,
                onClose: () => Navigator.pop(context),
              ),
              if (failure != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    UmiSpacing.lg,
                    0,
                    UmiSpacing.lg,
                    UmiSpacing.lg,
                  ),
                  child: InlineNotice(
                    message: failure,
                    tone: InlineNoticeTone.error,
                  ),
                ),
              // Equal heights for the two columns, so the hairline between them
              // runs the full depth and neither side floats in its own space.
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: _ScopePane(request: widget.request)),
                    VerticalDivider(
                      width: 1,
                      thickness: 1,
                      color: scheme.outlineVariant,
                    ),
                    Expanded(
                      child: _PinPane(
                        length: _pin.text.length,
                        hint: l.managerApprovalPinHint,
                        label: l.managerPinLabel,
                        es: es,
                        enabled: widget.retryable,
                        onDigit: _press,
                        onBackspace: () => _press('back'),
                        onClear: () => _press('clear'),
                      ),
                    ),
                  ],
                ),
              ),
              Divider(height: 1, thickness: 1, color: scheme.outlineVariant),
              _DecisionBar(
                cancelLabel: l.managerApprovalCancelAction,
                confirmLabel: l.managerApprovalAction,
                onCancel: () => Navigator.pop(context),
                onConfirm: _ready ? _submit : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _Header extends StatelessWidget {
  const _Header({required this.title, required this.onClose});

  final String title;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UmiSpacing.lg,
        UmiSpacing.md,
        UmiSpacing.sm,
        UmiSpacing.md,
      ),
      child: Row(
        children: [
          Expanded(child: Text(title, style: theme.textTheme.titleLarge)),
          IconButton(
            tooltip: AppLocalizations.of(context).closeAction,
            onPressed: onClose,
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }
}

/// The money, the operation, and what this does to the drawer.
final class _ScopePane extends StatelessWidget {
  const _ScopePane({required this.request});

  final ManagerApprovalPrompt request;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final now = request.expectedInDrawer;
    final after = request.expectedAfter;

    return Padding(
      padding: const EdgeInsets.all(UmiSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Eyebrow(text: l.managerApprovalEyebrow),
          const SizedBox(height: UmiSpacing.md),
          Text(
            request.operation,
            style: theme.textTheme.titleMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UmiSpacing.xs),
          // The amount is the decision, so it is the largest thing here.
          Text(
            request.amount,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
          Divider(height: 1, color: scheme.outlineVariant),
          const SizedBox(height: UmiSpacing.lg),
          _Fact(label: l.cashMovementReasonLabel, value: request.reason),
          const SizedBox(height: UmiSpacing.md),
          _Fact(label: l.registerAssignedLabel, value: request.registerName),
          if (now != null && after != null) ...[
            const SizedBox(height: UmiSpacing.lg),
            _DrawerEffect(
              title: l.managerApprovalDrawerEffectTitle,
              nowLabel: l.managerApprovalDrawerNow,
              now: now,
              afterLabel: l.managerApprovalDrawerAfter,
              after: after,
            ),
          ],
        ],
      ),
    );
  }
}

final class _PinPane extends StatelessWidget {
  const _PinPane({
    required this.length,
    required this.label,
    required this.hint,
    required this.es,
    required this.enabled,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
  });

  final int length;
  final String label;
  final String hint;
  final bool es;
  final bool enabled;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(UmiSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(child: _Eyebrow(text: label)),
          const SizedBox(height: UmiSpacing.md),
          PinDots(length: length, minLength: 4),
          const SizedBox(height: UmiSpacing.sm),
          Text(
            hint,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UmiSpacing.lg),
          PinPad(
            onDigit: onDigit,
            onBackspace: onBackspace,
            onClear: onClear,
            canEdit: length > 0,
            es: es,
            enabled: enabled,
            keyHeight: 72,
          ),
        ],
      ),
    );
  }
}

/// The two decisions, the same width and the same height.
final class _DecisionBar extends StatelessWidget {
  const _DecisionBar({
    required this.cancelLabel,
    required this.confirmLabel,
    required this.onCancel,
    required this.onConfirm,
  });

  final String cancelLabel;
  final String confirmLabel;
  final VoidCallback onCancel;
  final VoidCallback? onConfirm;

  @override
  Widget build(BuildContext context) {
    final style = ButtonStyle(
      minimumSize: WidgetStateProperty.all(
        const Size.fromHeight(UmiTouchTarget.primary + 4),
      ),
    );
    return Padding(
      padding: const EdgeInsets.all(UmiSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: TextButton(
              onPressed: onCancel,
              style: style,
              child: Text(cancelLabel),
            ),
          ),
          const SizedBox(width: UmiSpacing.md),
          Expanded(
            child: FilledButton(
              onPressed: onConfirm,
              style: style,
              child: Text(confirmLabel),
            ),
          ),
        ],
      ),
    );
  }
}

final class _DrawerEffect extends StatelessWidget {
  const _DrawerEffect({
    required this.title,
    required this.nowLabel,
    required this.now,
    required this.afterLabel,
    required this.after,
  });

  final String title;
  final String nowLabel;
  final String now;
  final String afterLabel;
  final String after;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Eyebrow(text: title),
            const SizedBox(height: UmiSpacing.md),
            _EffectRow(label: nowLabel, value: now),
            const SizedBox(height: UmiSpacing.sm),
            _EffectRow(label: afterLabel, value: after, emphasized: true),
          ],
        ),
      ),
    );
  }
}

final class _EffectRow extends StatelessWidget {
  const _EffectRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Expanded(
          child: Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(width: UmiSpacing.sm),
        Text(
          value,
          style: (emphasized
                  ? theme.textTheme.titleMedium
                  : theme.textTheme.bodyLarge)
              ?.copyWith(
                fontWeight: emphasized ? FontWeight.w600 : FontWeight.w400,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
        ),
      ],
    );
  }
}

final class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 2),
        Text(value, style: theme.textTheme.bodyLarge),
      ],
    );
  }
}

final class _Eyebrow extends StatelessWidget {
  const _Eyebrow({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      text.toUpperCase(),
      style: theme.textTheme.labelMedium?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
        letterSpacing: 1.2,
      ),
    );
  }
}
