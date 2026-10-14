import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';

/// Which course a cart line belongs to (§8H step 4).
///
/// The kitchen stages a ticket by course, so the operator has to be able to say
/// "the flan is not part of the starters" while the line is being written — not
/// afterwards, and not by typing a number into a box that the server would then
/// refuse. A stepper, because the range is 1..20 and the real move is one step
/// from wherever the operator already is; a text field would invite a typo
/// where a tap does the job, and a row of twenty chips would be a wall on the
/// smallest certified till.
///
/// Course 1 is the ordinary sale, so this never shouts: it states the course in
/// the operator's own words and the buttons only brighten when there is
/// somewhere to go. `enabled: false` renders it inert, which is what a
/// read-only role sees.
final class CourseControl extends StatelessWidget {
  const CourseControl({
    required this.course,
    required this.onChanged,
    this.enabled = true,
    this.hint,
    super.key,
  });

  /// The contract's bound (`courseNumber` is 1..20), named once here so the
  /// control cannot step outside what the server accepts.
  static const int minCourse = 1;
  static const int maxCourse = 20;

  /// Key names the widget test reads the control by.
  static const Key valueKey = Key('course-control-value');
  static const Key decreaseKey = Key('course-control-decrease');
  static const Key increaseKey = Key('course-control-increase');

  final int course;
  final ValueChanged<int> onChanged;
  final bool enabled;

  /// One line under the label saying what the number MEANS. The label alone
  /// ("Tiempo de servicio") reads like a duration to anyone who is not a waiter, and
  /// the control shows a number, so the screen looked like a clock that never
  /// arrives. The owner asked exactly that on 2026-10-12. Optional, so a surface with
  /// no room for it keeps the plain label.
  final String? hint;

  bool get _canDecrease => enabled && course > minCourse;
  bool get _canIncrease => enabled && course < maxCourse;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = PosTheme.of(context).colorScheme;
    final textTheme = PosTheme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.cartCourseLabel, style: textTheme.titleSmall),
              if (hint case final String line)
                Text(
                  line,
                  style: textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: UmiSpacing.sm),
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(UmiRadius.control),
            border: Border.all(
              color: enabled
                  ? scheme.outlineVariant
                  : scheme.outlineVariant.withValues(alpha: .5),
            ),
          ),
          child: Row(
            children: [
              PosIconButton(
                key: decreaseKey,
                tooltip: l10n.cartCoursePrevious,
                onPressed: _canDecrease ? () => onChanged(course - 1) : null,
                constraints: const BoxConstraints(
                  minWidth: UmiTouchTarget.minimum,
                  minHeight: UmiTouchTarget.minimum,
                ),
                icon: const PosIcon(PosGlyphs.remove, size: 20),
              ),
              // The number is a statement, not a field: the screen reader gets
              // the whole sentence rather than a bare digit.
              Semantics(
                container: true,
                label: l10n.cartCourseCurrent(course),
                child: ExcludeSemantics(
                  child: SizedBox(
                    width: 32,
                    child: Text(
                      '$course',
                      key: valueKey,
                      textAlign: TextAlign.center,
                      style: textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: enabled ? null : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ),
              PosIconButton(
                key: increaseKey,
                tooltip: l10n.cartCourseNext,
                onPressed: _canIncrease ? () => onChanged(course + 1) : null,
                constraints: const BoxConstraints(
                  minWidth: UmiTouchTarget.minimum,
                  minHeight: UmiTouchTarget.minimum,
                ),
                icon: const PosIcon(PosGlyphs.add, size: 20),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
