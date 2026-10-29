import 'core/localization/app_localizations.dart';
import 'core/theme/pos_ui.dart';
import 'core/theme/umi_theme.dart';
import 'features/catalog/service_context_prototype.dart';

void main() {
  runApp(
    PosApp(
      title: 'UmiPOS · contexto de cuenta',
      locale: const Locale('es'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: UmiTheme.light(),
      home: const ServiceContextPrototype(),
    ),
  );
}
