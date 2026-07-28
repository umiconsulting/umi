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

  /// No description provided for @catalogTitle.
  ///
  /// In es, this message translates to:
  /// **'Catálogo'**
  String get catalogTitle;

  /// No description provided for @catalogSearchHint.
  ///
  /// In es, this message translates to:
  /// **'Buscar nombre, SKU o código'**
  String get catalogSearchHint;

  /// No description provided for @allCategories.
  ///
  /// In es, this message translates to:
  /// **'Todo'**
  String get allCategories;

  /// No description provided for @catalogLoading.
  ///
  /// In es, this message translates to:
  /// **'Cargando catálogo autorizado'**
  String get catalogLoading;

  /// No description provided for @catalogEmpty.
  ///
  /// In es, this message translates to:
  /// **'No hay productos disponibles para esta sucursal.'**
  String get catalogEmpty;

  /// No description provided for @catalogNoResults.
  ///
  /// In es, this message translates to:
  /// **'No hay productos para esta búsqueda.'**
  String get catalogNoResults;

  /// No description provided for @catalogPermissionDenied.
  ///
  /// In es, this message translates to:
  /// **'No tienes permiso para ver este catálogo.'**
  String get catalogPermissionDenied;

  /// No description provided for @catalogNetworkError.
  ///
  /// In es, this message translates to:
  /// **'No se pudo conectar con el catálogo. Intenta de nuevo.'**
  String get catalogNetworkError;

  /// No description provided for @catalogUnexpectedError.
  ///
  /// In es, this message translates to:
  /// **'El catálogo no está disponible temporalmente.'**
  String get catalogUnexpectedError;

  /// No description provided for @unavailableLabel.
  ///
  /// In es, this message translates to:
  /// **'No disponible'**
  String get unavailableLabel;

  /// No description provided for @variantsLabel.
  ///
  /// In es, this message translates to:
  /// **'Variantes'**
  String get variantsLabel;

  /// No description provided for @modifiersLabel.
  ///
  /// In es, this message translates to:
  /// **'Modificadores'**
  String get modifiersLabel;

  /// No description provided for @taxIncludedLabel.
  ///
  /// In es, this message translates to:
  /// **'Impuesto configurado'**
  String get taxIncludedLabel;

  /// No description provided for @closeAction.
  ///
  /// In es, this message translates to:
  /// **'Cerrar'**
  String get closeAction;

  /// No description provided for @cartTitle.
  ///
  /// In es, this message translates to:
  /// **'Carrito actual'**
  String get cartTitle;

  /// No description provided for @cartEmpty.
  ///
  /// In es, this message translates to:
  /// **'Abre un producto para iniciar este carrito.'**
  String get cartEmpty;

  /// No description provided for @cartUnavailable.
  ///
  /// In es, this message translates to:
  /// **'El carrito no está disponible temporalmente.'**
  String get cartUnavailable;

  /// No description provided for @cartNoteLabel.
  ///
  /// In es, this message translates to:
  /// **'Nota del operador'**
  String get cartNoteLabel;

  /// No description provided for @addToCartAction.
  ///
  /// In es, this message translates to:
  /// **'Agregar al carrito'**
  String get addToCartAction;

  /// No description provided for @removeFromCartAction.
  ///
  /// In es, this message translates to:
  /// **'Eliminar línea'**
  String get removeFromCartAction;

  /// No description provided for @increaseQuantity.
  ///
  /// In es, this message translates to:
  /// **'Aumentar cantidad'**
  String get increaseQuantity;

  /// No description provided for @decreaseQuantity.
  ///
  /// In es, this message translates to:
  /// **'Disminuir cantidad'**
  String get decreaseQuantity;

  /// No description provided for @subtotalLabel.
  ///
  /// In es, this message translates to:
  /// **'Subtotal'**
  String get subtotalLabel;

  /// No description provided for @taxLabel.
  ///
  /// In es, this message translates to:
  /// **'Impuestos'**
  String get taxLabel;

  /// No description provided for @discountLabel.
  ///
  /// In es, this message translates to:
  /// **'Vista previa de descuentos'**
  String get discountLabel;

  /// No description provided for @totalLabel.
  ///
  /// In es, this message translates to:
  /// **'Total'**
  String get totalLabel;

  /// No description provided for @businessDateLabel.
  ///
  /// In es, this message translates to:
  /// **'Fecha operativa'**
  String get businessDateLabel;

  /// No description provided for @checkoutNextGate.
  ///
  /// In es, this message translates to:
  /// **'Checkout disponible en el siguiente Gate'**
  String get checkoutNextGate;

  /// No description provided for @checkoutAction.
  ///
  /// In es, this message translates to:
  /// **'Cobrar'**
  String get checkoutAction;

  /// No description provided for @checkoutTitle.
  ///
  /// In es, this message translates to:
  /// **'Cobro autorizado'**
  String get checkoutTitle;

  /// No description provided for @operatorLabel.
  ///
  /// In es, this message translates to:
  /// **'Operador'**
  String get operatorLabel;

  /// No description provided for @paymentMethodLabel.
  ///
  /// In es, this message translates to:
  /// **'Método de pago'**
  String get paymentMethodLabel;

  /// No description provided for @cashPayment.
  ///
  /// In es, this message translates to:
  /// **'Efectivo'**
  String get cashPayment;

  /// No description provided for @externalTerminalPayment.
  ///
  /// In es, this message translates to:
  /// **'Terminal externa'**
  String get externalTerminalPayment;

  /// No description provided for @reviewTotalsAction.
  ///
  /// In es, this message translates to:
  /// **'Revisar totales autorizados'**
  String get reviewTotalsAction;

  /// No description provided for @confirmAndPayAction.
  ///
  /// In es, this message translates to:
  /// **'Confirmar y cobrar'**
  String get confirmAndPayAction;

  /// No description provided for @confirmAction.
  ///
  /// In es, this message translates to:
  /// **'Confirmar'**
  String get confirmAction;

  /// No description provided for @confirmSaleTitle.
  ///
  /// In es, this message translates to:
  /// **'¿Confirmar esta venta?'**
  String get confirmSaleTitle;

  /// No description provided for @confirmSaleBody.
  ///
  /// In es, this message translates to:
  /// **'UMI recalculó los totales mostrados. Esta confirmación inicia el pago.'**
  String get confirmSaleBody;

  /// No description provided for @totalsConfirmedBody.
  ///
  /// In es, this message translates to:
  /// **'UMI recalculó el carrito. Revisa cada total antes de confirmar el pago.'**
  String get totalsConfirmedBody;

  /// No description provided for @paymentProcessing.
  ///
  /// In es, this message translates to:
  /// **'Procesando pago'**
  String get paymentProcessing;

  /// No description provided for @paymentUnknownTitle.
  ///
  /// In es, this message translates to:
  /// **'Estado de pago desconocido'**
  String get paymentUnknownTitle;

  /// No description provided for @paymentUnknownBody.
  ///
  /// In es, this message translates to:
  /// **'No inicies otro pago. Consulta el estado de este pago o solicita ayuda a un gerente.'**
  String get paymentUnknownBody;

  /// No description provided for @queryPaymentAction.
  ///
  /// In es, this message translates to:
  /// **'Consultar estado del pago'**
  String get queryPaymentAction;

  /// No description provided for @correlationLabel.
  ///
  /// In es, this message translates to:
  /// **'Correlación'**
  String get correlationLabel;

  /// No description provided for @saleCompletedTitle.
  ///
  /// In es, this message translates to:
  /// **'Venta completada'**
  String get saleCompletedTitle;

  /// No description provided for @finishSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Finalizar e iniciar otro carrito'**
  String get finishSaleAction;

  /// No description provided for @checkoutFailed.
  ///
  /// In es, this message translates to:
  /// **'No fue posible completar el cobro de forma segura.'**
  String get checkoutFailed;

  /// No description provided for @provisionalSalePendingTitle.
  ///
  /// In es, this message translates to:
  /// **'Venta pendiente de sincronización'**
  String get provisionalSalePendingTitle;

  /// No description provided for @provisionalSalePendingBody.
  ///
  /// In es, this message translates to:
  /// **'La venta se guardó de forma segura en este dispositivo y está pendiente de sincronización. Los datos oficiales del recibo se asignarán cuando el servidor la acepte.'**
  String get provisionalSalePendingBody;

  /// No description provided for @returnToCatalogAction.
  ///
  /// In es, this message translates to:
  /// **'Volver al catálogo'**
  String get returnToCatalogAction;

  /// No description provided for @recoveryCenterTitle.
  ///
  /// In es, this message translates to:
  /// **'Centro de recuperación'**
  String get recoveryCenterTitle;

  /// No description provided for @synchronizingPendingSales.
  ///
  /// In es, this message translates to:
  /// **'Sincronizando ventas pendientes…'**
  String get synchronizingPendingSales;

  /// No description provided for @pendingSalesSecure.
  ///
  /// In es, this message translates to:
  /// **'Tus ventas pendientes permanecen almacenadas de forma segura en este dispositivo.'**
  String get pendingSalesSecure;

  /// No description provided for @synchronizeNowAction.
  ///
  /// In es, this message translates to:
  /// **'Sincronizar ahora'**
  String get synchronizeNowAction;

  /// No description provided for @conflictNeedsAttention.
  ///
  /// In es, this message translates to:
  /// **'Una venta requiere tu atención.'**
  String get conflictNeedsAttention;

  /// No description provided for @officialReceiptAvailable.
  ///
  /// In es, this message translates to:
  /// **'Recibo oficial disponible'**
  String get officialReceiptAvailable;

  /// No description provided for @cashReceivedLabel.
  ///
  /// In es, this message translates to:
  /// **'Efectivo recibido'**
  String get cashReceivedLabel;

  /// No description provided for @changeDueLabel.
  ///
  /// In es, this message translates to:
  /// **'Cambio'**
  String get changeDueLabel;
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
