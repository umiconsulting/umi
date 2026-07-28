import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'localization/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
  ];

  /// No description provided for @appName.
  ///
  /// In es, this message translates to:
  /// **'UmiPOS'**
  String get appName;

  /// No description provided for @bootstrapLoadingTitle.
  ///
  /// In es, this message translates to:
  /// **'Preparando UmiPOS'**
  String get bootstrapLoadingTitle;

  /// No description provided for @bootstrapLoadingBody.
  ///
  /// In es, this message translates to:
  /// **'Verificando la configuración y el almacenamiento seguro.'**
  String get bootstrapLoadingBody;

  /// No description provided for @readyTitle.
  ///
  /// In es, this message translates to:
  /// **'Listo para comenzar'**
  String get readyTitle;

  /// No description provided for @readyBody.
  ///
  /// In es, this message translates to:
  /// **'La base de UmiPOS está preparada. La autenticación se habilitará en el siguiente paso.'**
  String get readyBody;

  /// No description provided for @configurationInvalidTitle.
  ///
  /// In es, this message translates to:
  /// **'Configuración incompleta'**
  String get configurationInvalidTitle;

  /// No description provided for @configurationInvalidBody.
  ///
  /// In es, this message translates to:
  /// **'UmiPOS no puede iniciar de forma segura con esta configuración.'**
  String get configurationInvalidBody;

  /// No description provided for @storageUnavailableTitle.
  ///
  /// In es, this message translates to:
  /// **'Almacenamiento seguro no disponible'**
  String get storageUnavailableTitle;

  /// No description provided for @storageUnavailableBody.
  ///
  /// In es, this message translates to:
  /// **'No se guardarán credenciales en almacenamiento sin cifrar.'**
  String get storageUnavailableBody;

  /// No description provided for @sdkUnavailableTitle.
  ///
  /// In es, this message translates to:
  /// **'Contrato no disponible'**
  String get sdkUnavailableTitle;

  /// No description provided for @sdkUnavailableBody.
  ///
  /// In es, this message translates to:
  /// **'La aplicación no pudo verificar el contrato de la plataforma.'**
  String get sdkUnavailableBody;

  /// No description provided for @recoverableFailureTitle.
  ///
  /// In es, this message translates to:
  /// **'No pudimos terminar la preparación'**
  String get recoverableFailureTitle;

  /// No description provided for @unrecoverableFailureTitle.
  ///
  /// In es, this message translates to:
  /// **'UmiPOS necesita atención'**
  String get unrecoverableFailureTitle;

  /// No description provided for @retryAction.
  ///
  /// In es, this message translates to:
  /// **'Reintentar'**
  String get retryAction;

  /// No description provided for @diagnosticsAction.
  ///
  /// In es, this message translates to:
  /// **'Ver diagnóstico'**
  String get diagnosticsAction;

  /// No description provided for @diagnosticsTitle.
  ///
  /// In es, this message translates to:
  /// **'Diagnóstico de desarrollo'**
  String get diagnosticsTitle;

  /// No description provided for @unknownRouteTitle.
  ///
  /// In es, this message translates to:
  /// **'Ruta no disponible'**
  String get unknownRouteTitle;

  /// No description provided for @unknownRouteBody.
  ///
  /// In es, this message translates to:
  /// **'Esta sección todavía no está habilitada.'**
  String get unknownRouteBody;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
