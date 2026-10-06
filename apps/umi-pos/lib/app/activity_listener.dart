import 'package:flutter/widgets.dart';

/// Reports coarse operator activity, a pointer press anywhere in the app, so an
/// idle auto-lock can push its timer back. It is translucent and never absorbs
/// the gesture, so the press still reaches the control beneath it.
final class ActivityListener extends StatelessWidget {
  const ActivityListener({
    required this.onActivity,
    required this.child,
    super.key,
  });

  final VoidCallback onActivity;
  final Widget child;

  @override
  Widget build(BuildContext context) => Listener(
    behavior: HitTestBehavior.translucent,
    onPointerDown: (_) => onActivity(),
    child: child,
  );
}
