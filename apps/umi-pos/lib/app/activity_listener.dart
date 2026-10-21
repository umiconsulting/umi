import 'package:flutter/widgets.dart';

/// Reports coarse operator activity, a pointer press anywhere in the app, so an
/// idle auto-lock can push its timer back. It is translucent and never absorbs
/// the gesture, so the press still reaches the control beneath it.
final class ActivityListener extends StatelessWidget {
  const ActivityListener({
    required this.onActivity,
    required this.child,
    this.onPress,
    super.key,
  });

  final VoidCallback onActivity;

  /// The same press, offered to a build that is measuring how long taps take to
  /// paint. It rides on this listener rather than getting one of its own: two
  /// listeners over the whole navigator are two chances to disagree about what
  /// counts as a press, and one of them would eventually be forgotten.
  final VoidCallback? onPress;

  final Widget child;

  @override
  Widget build(BuildContext context) => Listener(
    behavior: HitTestBehavior.translucent,
    onPointerDown: (_) {
      onActivity();
      onPress?.call();
    },
    child: child,
  );
}
