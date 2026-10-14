import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/theme/umi_theme.dart';

final class StatusCard extends StatelessWidget {
  const StatusCard({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
    super.key,
  });

  final PosGlyph icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compactLargeText =
          constraints.maxWidth < 400 &&
          MediaQuery.textScalerOf(context).scale(16) >= 24;
      return Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(compactLargeText ? 0 : UmiSpacing.md),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: PosCard(
              child: Padding(
                padding: EdgeInsets.all(
                  compactLargeText ? UmiSpacing.md : UmiSpacing.xl,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ExcludeSemantics(child: PosIcon(icon, size: 40)),
                    const SizedBox(height: UmiSpacing.lg),
                    Semantics(
                      header: true,
                      child: Text(
                        title,
                        style: PosTheme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: UmiSpacing.sm),
                    Text(message, textAlign: TextAlign.center),
                    if (action != null) ...[
                      const SizedBox(height: UmiSpacing.lg),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
