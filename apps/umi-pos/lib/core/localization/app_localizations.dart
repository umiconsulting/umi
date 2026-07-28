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

  /// No description provided for @enrollmentTitle.
  ///
  /// In es, this message translates to:
  /// **'Registrar este dispositivo'**
  String get enrollmentTitle;

  /// No description provided for @enrollmentBody.
  ///
  /// In es, this message translates to:
  /// **'Ingresa el desafío de un solo uso aprobado por un administrador.'**
  String get enrollmentBody;

  /// No description provided for @challengeIdLabel.
  ///
  /// In es, this message translates to:
  /// **'ID del desafío'**
  String get challengeIdLabel;

  /// No description provided for @enrollmentCodeLabel.
  ///
  /// In es, this message translates to:
  /// **'Código de registro'**
  String get enrollmentCodeLabel;

  /// No description provided for @continueAction.
  ///
  /// In es, this message translates to:
  /// **'Continuar'**
  String get continueAction;

  /// No description provided for @loginTitle.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión en UmiPOS'**
  String get loginTitle;

  /// No description provided for @usernameLabel.
  ///
  /// In es, this message translates to:
  /// **'Correo'**
  String get usernameLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In es, this message translates to:
  /// **'Contraseña'**
  String get passwordLabel;

  /// No description provided for @signInAction.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión'**
  String get signInAction;

  /// No description provided for @selectTenantTitle.
  ///
  /// In es, this message translates to:
  /// **'Selecciona un negocio'**
  String get selectTenantTitle;

  /// No description provided for @noTenantTitle.
  ///
  /// In es, this message translates to:
  /// **'Sin acceso a negocios'**
  String get noTenantTitle;

  /// No description provided for @noTenantBody.
  ///
  /// In es, this message translates to:
  /// **'Tu cuenta no tiene acceso activo a UmiPOS.'**
  String get noTenantBody;

  /// No description provided for @selectBranchTitle.
  ///
  /// In es, this message translates to:
  /// **'Selecciona una sucursal'**
  String get selectBranchTitle;

  /// No description provided for @noBranchBody.
  ///
  /// In es, this message translates to:
  /// **'No hay una sucursal activa permitida para tu usuario y dispositivo.'**
  String get noBranchBody;

  /// No description provided for @operatorTitle.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión de operador'**
  String get operatorTitle;

  /// No description provided for @operatorBody.
  ///
  /// In es, this message translates to:
  /// **'Confirma esta sucursal para entrar al entorno protegido de POS.'**
  String get operatorBody;

  /// No description provided for @startOperatorAction.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión'**
  String get startOperatorAction;

  /// No description provided for @lockAction.
  ///
  /// In es, this message translates to:
  /// **'Bloquear operador'**
  String get lockAction;

  /// No description provided for @logoutAction.
  ///
  /// In es, this message translates to:
  /// **'Cerrar sesión'**
  String get logoutAction;

  /// No description provided for @deviceActiveLabel.
  ///
  /// In es, this message translates to:
  /// **'Dispositivo confiable'**
  String get deviceActiveLabel;

  /// No description provided for @connectivityUnknownLabel.
  ///
  /// In es, this message translates to:
  /// **'Conectividad desconocida'**
  String get connectivityUnknownLabel;

  /// No description provided for @shellReadyTitle.
  ///
  /// In es, this message translates to:
  /// **'Sesión de operador lista'**
  String get shellReadyTitle;

  /// No description provided for @catalogNotImplemented.
  ///
  /// In es, this message translates to:
  /// **'El catálogo todavía no está implementado.'**
  String get catalogNotImplemented;

  /// No description provided for @deviceRevokedTitle.
  ///
  /// In es, this message translates to:
  /// **'Dispositivo revocado'**
  String get deviceRevokedTitle;

  /// No description provided for @deviceRevokedBody.
  ///
  /// In es, this message translates to:
  /// **'Esta instalación ya no es confiable. Solicita su reemplazo a un administrador.'**
  String get deviceRevokedBody;

  /// No description provided for @rotationRequiredTitle.
  ///
  /// In es, this message translates to:
  /// **'Rotación de credencial requerida'**
  String get rotationRequiredTitle;

  /// No description provided for @rotationRequiredBody.
  ///
  /// In es, this message translates to:
  /// **'Un administrador debe rotar la credencial antes de continuar.'**
  String get rotationRequiredBody;

  /// No description provided for @recoverableNetworkBody.
  ///
  /// In es, this message translates to:
  /// **'No fue posible contactar de forma segura el servicio de acceso.'**
  String get recoverableNetworkBody;
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
