import 'package:flutter/material.dart';

import '../../core/theme/umi_theme.dart';

final class StatusCard extends StatelessWidget {
  const StatusCard({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 520),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 48, semanticLabel: title),
              const SizedBox(height: UmiSpacing.lg),
              Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
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
  );
}
