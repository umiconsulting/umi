// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'UmiPOS';

  @override
  String get bootstrapLoadingTitle => 'Preparing UmiPOS';

  @override
  String get bootstrapLoadingBody =>
      'Checking configuration and secure storage.';

  @override
  String get readyTitle => 'Ready to begin';

  @override
  String get readyBody =>
      'The UmiPOS foundation is ready. Authentication will be enabled in the next step.';

  @override
  String get configurationInvalidTitle => 'Configuration incomplete';

  @override
  String get configurationInvalidBody =>
      'UmiPOS cannot start safely with this configuration.';

  @override
  String get storageUnavailableTitle => 'Secure storage unavailable';

  @override
  String get storageUnavailableBody =>
      'Credentials will not be stored in unencrypted storage.';

  @override
  String get sdkUnavailableTitle => 'Contract unavailable';

  @override
  String get sdkUnavailableBody =>
      'The app could not verify the platform contract.';

  @override
  String get recoverableFailureTitle => 'Preparation could not finish';

  @override
  String get unrecoverableFailureTitle => 'UmiPOS needs attention';

  @override
  String get retryAction => 'Retry';

  @override
  String get diagnosticsAction => 'View diagnostics';

  @override
  String get diagnosticsTitle => 'Development diagnostics';

  @override
  String get unknownRouteTitle => 'Route unavailable';

  @override
  String get unknownRouteBody => 'This area is not enabled yet.';
}
