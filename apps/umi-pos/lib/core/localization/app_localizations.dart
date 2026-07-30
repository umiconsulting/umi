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
  /// **'Ingresa el código de configuración de ocho caracteres que muestra el administrador.'**
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

  /// No description provided for @enrollmentCodeInvalid.
  ///
  /// In es, this message translates to:
  /// **'Ingresa el código completo de ocho caracteres. Usa tu PIN de operador después de aprobar el dispositivo.'**
  String get enrollmentCodeInvalid;

  /// No description provided for @enrollmentCodeRejected.
  ///
  /// In es, this message translates to:
  /// **'El código de registro no es válido o caducó. Solicita un código nuevo al administrador.'**
  String get enrollmentCodeRejected;

  /// No description provided for @enrollmentCodeExpired.
  ///
  /// In es, this message translates to:
  /// **'El código de registro caducó. Solicita un código nuevo al administrador.'**
  String get enrollmentCodeExpired;

  /// No description provided for @enrollmentCodeAttemptsExceeded.
  ///
  /// In es, this message translates to:
  /// **'Esta solicitud alcanzó el límite de intentos. Solicita un código nuevo al administrador.'**
  String get enrollmentCodeAttemptsExceeded;

  /// No description provided for @enrollmentCodeRateLimited.
  ///
  /// In es, this message translates to:
  /// **'Se hicieron demasiados intentos. Espera antes de volver a intentarlo.'**
  String get enrollmentCodeRateLimited;

  /// No description provided for @enrollmentCodeUnavailable.
  ///
  /// In es, this message translates to:
  /// **'UmiPOS no puede verificar este código ahora. Revisa la conexión e inténtalo de nuevo.'**
  String get enrollmentCodeUnavailable;

  /// No description provided for @enrollmentPendingTitle.
  ///
  /// In es, this message translates to:
  /// **'Se requiere la aprobación del administrador'**
  String get enrollmentPendingTitle;

  /// No description provided for @enrollmentPendingBody.
  ///
  /// In es, this message translates to:
  /// **'Este dispositivo solicitó acceso. Pide a un administrador que lo revise en el Dashboard de UMI.'**
  String get enrollmentPendingBody;

  /// No description provided for @enrollmentPendingSecure.
  ///
  /// In es, this message translates to:
  /// **'La credencial de pareo está protegida en este dispositivo.'**
  String get enrollmentPendingSecure;

  /// No description provided for @cancelEnrollmentAction.
  ///
  /// In es, this message translates to:
  /// **'Cancelar solicitud'**
  String get cancelEnrollmentAction;

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

  /// No description provided for @operatorPinTitle.
  ///
  /// In es, this message translates to:
  /// **'Ingresa tu PIN de operador'**
  String get operatorPinTitle;

  /// No description provided for @operatorPinBody.
  ///
  /// In es, this message translates to:
  /// **'Tu PIN te identifica y carga tus permisos actuales.'**
  String get operatorPinBody;

  /// No description provided for @operatorPinLabel.
  ///
  /// In es, this message translates to:
  /// **'PIN de operador'**
  String get operatorPinLabel;

  /// No description provided for @operatorPinHint.
  ///
  /// In es, this message translates to:
  /// **'Usa de 4 a 8 dígitos.'**
  String get operatorPinHint;

  /// No description provided for @operatorPinAction.
  ///
  /// In es, this message translates to:
  /// **'Continuar'**
  String get operatorPinAction;

  /// No description provided for @operatorPinInvalid.
  ///
  /// In es, this message translates to:
  /// **'El PIN no es válido para esta sucursal.'**
  String get operatorPinInvalid;

  /// No description provided for @operatorPinLocked.
  ///
  /// In es, this message translates to:
  /// **'El ingreso de PIN está bloqueado temporalmente. Intenta más tarde.'**
  String get operatorPinLocked;

  /// No description provided for @operatorPinRateLimited.
  ///
  /// In es, this message translates to:
  /// **'Hay demasiados intentos. Espera antes de intentar de nuevo.'**
  String get operatorPinRateLimited;

  /// No description provided for @operatorPinEntitlementDisabled.
  ///
  /// In es, this message translates to:
  /// **'UmiPOS no está habilitado para este negocio.'**
  String get operatorPinEntitlementDisabled;

  /// No description provided for @operatorPinBranchInvalid.
  ///
  /// In es, this message translates to:
  /// **'Este dispositivo no está asignado a una sucursal activa.'**
  String get operatorPinBranchInvalid;

  /// No description provided for @operatorPinLength.
  ///
  /// In es, this message translates to:
  /// **'Ingresa al menos cuatro dígitos.'**
  String get operatorPinLength;

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
  /// **'Descuento'**
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

  /// No description provided for @recoveryWebUnsupportedTitle.
  ///
  /// In es, this message translates to:
  /// **'La recuperación sin conexión no está disponible en Web'**
  String get recoveryWebUnsupportedTitle;

  /// No description provided for @recoveryWebUnsupportedBody.
  ///
  /// In es, this message translates to:
  /// **'La versión Web funciona en línea. Usa una aplicación nativa compatible para almacenar y recuperar ventas sin conexión de forma segura.'**
  String get recoveryWebUnsupportedBody;

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

  /// No description provided for @tenderSelectionTitle.
  ///
  /// In es, this message translates to:
  /// **'Selección de pago'**
  String get tenderSelectionTitle;

  /// No description provided for @cashTenderTitle.
  ///
  /// In es, this message translates to:
  /// **'Efectivo'**
  String get cashTenderTitle;

  /// No description provided for @tenderAmountLabel.
  ///
  /// In es, this message translates to:
  /// **'Importe aplicado'**
  String get tenderAmountLabel;

  /// No description provided for @exactAmountAction.
  ///
  /// In es, this message translates to:
  /// **'Importe exacto'**
  String get exactAmountAction;

  /// No description provided for @manualTerminalLabel.
  ///
  /// In es, this message translates to:
  /// **'Terminal manual'**
  String get manualTerminalLabel;

  /// No description provided for @terminalProcessingAction.
  ///
  /// In es, this message translates to:
  /// **'Procesando fuera del POS'**
  String get terminalProcessingAction;

  /// No description provided for @terminalSuccessAction.
  ///
  /// In es, this message translates to:
  /// **'Confirmar éxito'**
  String get terminalSuccessAction;

  /// No description provided for @terminalFailureAction.
  ///
  /// In es, this message translates to:
  /// **'Informar fallo'**
  String get terminalFailureAction;

  /// No description provided for @terminalUnknownAction.
  ///
  /// In es, this message translates to:
  /// **'Resultado desconocido'**
  String get terminalUnknownAction;

  /// No description provided for @tipLabel.
  ///
  /// In es, this message translates to:
  /// **'Propina'**
  String get tipLabel;

  /// No description provided for @noTipAction.
  ///
  /// In es, this message translates to:
  /// **'Sin propina'**
  String get noTipAction;

  /// No description provided for @customTipPercentLabel.
  ///
  /// In es, this message translates to:
  /// **'Porcentaje de propina personalizado'**
  String get customTipPercentLabel;

  /// No description provided for @customTipFixedLabel.
  ///
  /// In es, this message translates to:
  /// **'Importe de propina personalizado'**
  String get customTipFixedLabel;

  /// No description provided for @percentageDiscountAction.
  ///
  /// In es, this message translates to:
  /// **'Porcentaje'**
  String get percentageDiscountAction;

  /// No description provided for @fixedDiscountAction.
  ///
  /// In es, this message translates to:
  /// **'Importe fijo'**
  String get fixedDiscountAction;

  /// No description provided for @discountPercentLabel.
  ///
  /// In es, this message translates to:
  /// **'Porcentaje de descuento'**
  String get discountPercentLabel;

  /// No description provided for @discountAmountLabel.
  ///
  /// In es, this message translates to:
  /// **'Importe del descuento'**
  String get discountAmountLabel;

  /// No description provided for @discountReasonLabel.
  ///
  /// In es, this message translates to:
  /// **'Motivo del descuento'**
  String get discountReasonLabel;

  /// No description provided for @receiptDestinationLabel.
  ///
  /// In es, this message translates to:
  /// **'Destino del recibo'**
  String get receiptDestinationLabel;

  /// No description provided for @displayReceiptAction.
  ///
  /// In es, this message translates to:
  /// **'Mostrar recibo'**
  String get displayReceiptAction;

  /// No description provided for @printLaterAction.
  ///
  /// In es, this message translates to:
  /// **'Imprimir después'**
  String get printLaterAction;

  /// No description provided for @noReceiptAction.
  ///
  /// In es, this message translates to:
  /// **'Sin recibo'**
  String get noReceiptAction;

  /// No description provided for @managerApprovalAction.
  ///
  /// In es, this message translates to:
  /// **'Solicitar aprobación'**
  String get managerApprovalAction;

  /// No description provided for @managerApprovalTitle.
  ///
  /// In es, this message translates to:
  /// **'Se requiere aprobación del gerente'**
  String get managerApprovalTitle;

  /// No description provided for @managerPinLabel.
  ///
  /// In es, this message translates to:
  /// **'PIN del gerente'**
  String get managerPinLabel;

  /// No description provided for @managerApprovalDeniedMessage.
  ///
  /// In es, this message translates to:
  /// **'El PIN o el permiso del gerente no es válido para este cobro.'**
  String get managerApprovalDeniedMessage;

  /// No description provided for @approveAction.
  ///
  /// In es, this message translates to:
  /// **'Aprobar'**
  String get approveAction;

  /// No description provided for @insufficientCashMessage.
  ///
  /// In es, this message translates to:
  /// **'El efectivo recibido no cubre el importe aplicado.'**
  String get insufficientCashMessage;

  /// No description provided for @remainingBalanceMessage.
  ///
  /// In es, this message translates to:
  /// **'Agrega un pago para cubrir el saldo pendiente.'**
  String get remainingBalanceMessage;

  /// No description provided for @approvalRequiredMessage.
  ///
  /// In es, this message translates to:
  /// **'Un gerente debe aprobar este cobro.'**
  String get approvalRequiredMessage;

  /// No description provided for @terminalFailureMessage.
  ///
  /// In es, this message translates to:
  /// **'El pago de la terminal falló. Revisa los pagos.'**
  String get terminalFailureMessage;

  /// No description provided for @tipRejectedMessage.
  ///
  /// In es, this message translates to:
  /// **'La política de propinas rechazó esta propina.'**
  String get tipRejectedMessage;

  /// No description provided for @discountRejectedMessage.
  ///
  /// In es, this message translates to:
  /// **'La política de descuentos rechazó este descuento.'**
  String get discountRejectedMessage;

  /// No description provided for @changeDueLabel.
  ///
  /// In es, this message translates to:
  /// **'Cambio'**
  String get changeDueLabel;

  /// No description provided for @appliedAmountLabel.
  ///
  /// In es, this message translates to:
  /// **'Importe aplicado'**
  String get appliedAmountLabel;

  /// No description provided for @remainingBalanceLabel.
  ///
  /// In es, this message translates to:
  /// **'Saldo pendiente'**
  String get remainingBalanceLabel;

  /// No description provided for @offlineAdvancedTenderBlockedMessage.
  ///
  /// In es, this message translates to:
  /// **'Reconecta para usar la terminal manual, el pago mixto, las propinas o los descuentos. La venta se conserva.'**
  String get offlineAdvancedTenderBlockedMessage;

  /// No description provided for @recoveryQueryTitle.
  ///
  /// In es, this message translates to:
  /// **'Consultar resultado guardado'**
  String get recoveryQueryTitle;

  /// No description provided for @recoveryQueryDescription.
  ///
  /// In es, this message translates to:
  /// **'Pregunta a UMI si esta misma operación ya fue aceptada.'**
  String get recoveryQueryDescription;

  /// No description provided for @recoveryPolicyTitle.
  ///
  /// In es, this message translates to:
  /// **'Actualizar política sin conexión'**
  String get recoveryPolicyTitle;

  /// No description provided for @recoveryPolicyDescription.
  ///
  /// In es, this message translates to:
  /// **'Reconecta para cargar el permiso vigente del servidor para ventas sin conexión.'**
  String get recoveryPolicyDescription;

  /// No description provided for @recoveryAuthenticationTitle.
  ///
  /// In es, this message translates to:
  /// **'Iniciar sesión de nuevo'**
  String get recoveryAuthenticationTitle;

  /// No description provided for @recoveryAuthenticationDescription.
  ///
  /// In es, this message translates to:
  /// **'Restablece tu sesión autorizada antes de continuar la sincronización.'**
  String get recoveryAuthenticationDescription;

  /// No description provided for @recoveryBranchTitle.
  ///
  /// In es, this message translates to:
  /// **'Seleccionar la sucursal autorizada'**
  String get recoveryBranchTitle;

  /// No description provided for @recoveryBranchDescription.
  ///
  /// In es, this message translates to:
  /// **'Vuelve a seleccionar sucursal sin mover las ventas pendientes.'**
  String get recoveryBranchDescription;

  /// No description provided for @recoveryManagerTitle.
  ///
  /// In es, this message translates to:
  /// **'Solicitar revisión de gerente'**
  String get recoveryManagerTitle;

  /// No description provided for @recoveryManagerDescription.
  ///
  /// In es, this message translates to:
  /// **'Verifica un gerente autorizado únicamente para esta acción de recuperación.'**
  String get recoveryManagerDescription;

  /// No description provided for @recoveryManagerCredentialLabel.
  ///
  /// In es, this message translates to:
  /// **'PIN de gerente'**
  String get recoveryManagerCredentialLabel;

  /// No description provided for @recoveryAcknowledgeTitle.
  ///
  /// In es, this message translates to:
  /// **'Confirmar conciliación'**
  String get recoveryAcknowledgeTitle;

  /// No description provided for @recoveryAcknowledgeDescription.
  ///
  /// In es, this message translates to:
  /// **'Confirma la conciliación del servidor solo después de guardar la recuperación local.'**
  String get recoveryAcknowledgeDescription;

  /// No description provided for @recoveryReceiptTitle.
  ///
  /// In es, this message translates to:
  /// **'Ver estado del recibo'**
  String get recoveryReceiptTitle;

  /// No description provided for @recoveryReceiptDescription.
  ///
  /// In es, this message translates to:
  /// **'Abre el estado conservado del recibo provisional u oficial.'**
  String get recoveryReceiptDescription;

  /// No description provided for @recoveryPaymentTitle.
  ///
  /// In es, this message translates to:
  /// **'Consultar pago original'**
  String get recoveryPaymentTitle;

  /// No description provided for @recoveryPaymentDescription.
  ///
  /// In es, this message translates to:
  /// **'Consulta únicamente el pago original. No se iniciará otro cargo.'**
  String get recoveryPaymentDescription;

  /// No description provided for @recoveryDeviceTitle.
  ///
  /// In es, this message translates to:
  /// **'Verificar este dispositivo'**
  String get recoveryDeviceTitle;

  /// No description provided for @recoveryDeviceDescription.
  ///
  /// In es, this message translates to:
  /// **'Este dispositivo está bloqueado. Restablece la autorización antes de reproducir.'**
  String get recoveryDeviceDescription;

  /// No description provided for @recoveryCredentialTitle.
  ///
  /// In es, this message translates to:
  /// **'Recuperar credenciales rotadas'**
  String get recoveryCredentialTitle;

  /// No description provided for @recoveryCredentialDescription.
  ///
  /// In es, this message translates to:
  /// **'Los comandos históricos permanecen ligados a su versión de credencial original.'**
  String get recoveryCredentialDescription;

  /// No description provided for @recoveryStorageTitle.
  ///
  /// In es, this message translates to:
  /// **'Conservar almacenamiento para recuperación'**
  String get recoveryStorageTitle;

  /// No description provided for @recoveryStorageDescription.
  ///
  /// In es, this message translates to:
  /// **'Conserva intactos los datos cifrados y sigue la recuperación autorizada.'**
  String get recoveryStorageDescription;

  /// No description provided for @recoverySnapshotTitle.
  ///
  /// In es, this message translates to:
  /// **'Actualizar datos autorizados'**
  String get recoverySnapshotTitle;

  /// No description provided for @recoverySnapshotDescription.
  ///
  /// In es, this message translates to:
  /// **'Reconecta para actualizar catálogo, precios e impuestos vencidos.'**
  String get recoverySnapshotDescription;

  /// No description provided for @recoverySupportTitle.
  ///
  /// In es, this message translates to:
  /// **'Copiar referencia de soporte'**
  String get recoverySupportTitle;

  /// No description provided for @recoverySupportDescription.
  ///
  /// In es, this message translates to:
  /// **'Copia la referencia de diagnóstico segura sin exponer el contenido de la venta.'**
  String get recoverySupportDescription;

  /// No description provided for @saleActionsTitle.
  ///
  /// In es, this message translates to:
  /// **'Acciones de venta'**
  String get saleActionsTitle;

  /// No description provided for @newSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Nueva venta'**
  String get newSaleAction;

  /// No description provided for @suspendSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Suspender venta'**
  String get suspendSaleAction;

  /// No description provided for @resumeSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Reanudar venta'**
  String get resumeSaleAction;

  /// No description provided for @renameSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Cambiar nombre de venta suspendida'**
  String get renameSaleAction;

  /// No description provided for @cancelSaleAction.
  ///
  /// In es, this message translates to:
  /// **'Cancelar venta'**
  String get cancelSaleAction;

  /// No description provided for @suspendedSaleLabel.
  ///
  /// In es, this message translates to:
  /// **'Nombre de la venta suspendida'**
  String get suspendedSaleLabel;

  /// No description provided for @cancelSaleReasonLabel.
  ///
  /// In es, this message translates to:
  /// **'Motivo de cancelación'**
  String get cancelSaleReasonLabel;

  /// No description provided for @confirmCancelSaleTitle.
  ///
  /// In es, this message translates to:
  /// **'¿Cancelar esta venta?'**
  String get confirmCancelSaleTitle;

  /// No description provided for @confirmCancelSaleBody.
  ///
  /// In es, this message translates to:
  /// **'El carrito se cerrará sin pago ni recibo. La cancelación permanecerá en el historial de auditoría.'**
  String get confirmCancelSaleBody;

  /// No description provided for @saleRestoredMessage.
  ///
  /// In es, this message translates to:
  /// **'Tu venta activa se restauró.'**
  String get saleRestoredMessage;

  /// No description provided for @readyForNextCustomerMessage.
  ///
  /// In es, this message translates to:
  /// **'Listo para el siguiente cliente.'**
  String get readyForNextCustomerMessage;

  /// No description provided for @currentCustomerLabel.
  ///
  /// In es, this message translates to:
  /// **'Cliente actual'**
  String get currentCustomerLabel;

  /// No description provided for @anonymousCustomerLabel.
  ///
  /// In es, this message translates to:
  /// **'Cliente anónimo'**
  String get anonymousCustomerLabel;

  /// No description provided for @attachCustomerAction.
  ///
  /// In es, this message translates to:
  /// **'Asignar cliente'**
  String get attachCustomerAction;

  /// No description provided for @detachCustomerAction.
  ///
  /// In es, this message translates to:
  /// **'Usar cliente anónimo'**
  String get detachCustomerAction;

  /// No description provided for @searchCustomerHint.
  ///
  /// In es, this message translates to:
  /// **'Buscar clientes'**
  String get searchCustomerHint;

  /// No description provided for @recentCustomersAction.
  ///
  /// In es, this message translates to:
  /// **'Clientes recientes'**
  String get recentCustomersAction;

  /// No description provided for @saleHistoryTitle.
  ///
  /// In es, this message translates to:
  /// **'Ventas'**
  String get saleHistoryTitle;

  /// No description provided for @currentSaleLabel.
  ///
  /// In es, this message translates to:
  /// **'Venta actual'**
  String get currentSaleLabel;

  /// No description provided for @suspendedSalesLabel.
  ///
  /// In es, this message translates to:
  /// **'Ventas suspendidas'**
  String get suspendedSalesLabel;

  /// No description provided for @committedSalesLabel.
  ///
  /// In es, this message translates to:
  /// **'Ventas completadas recientes'**
  String get committedSalesLabel;

  /// No description provided for @cancelledSalesLabel.
  ///
  /// In es, this message translates to:
  /// **'Ventas canceladas'**
  String get cancelledSalesLabel;

  /// No description provided for @saleHistoryEmpty.
  ///
  /// In es, this message translates to:
  /// **'No hay ventas para esta vista.'**
  String get saleHistoryEmpty;

  /// No description provided for @sortNewestLabel.
  ///
  /// In es, this message translates to:
  /// **'Más recientes primero'**
  String get sortNewestLabel;

  /// No description provided for @sortOldestLabel.
  ///
  /// In es, this message translates to:
  /// **'Más antiguas primero'**
  String get sortOldestLabel;

  /// No description provided for @loadMoreSalesAction.
  ///
  /// In es, this message translates to:
  /// **'Cargar más ventas'**
  String get loadMoreSalesAction;

  /// No description provided for @saleStateBuilding.
  ///
  /// In es, this message translates to:
  /// **'En curso'**
  String get saleStateBuilding;

  /// No description provided for @saleStateSuspended.
  ///
  /// In es, this message translates to:
  /// **'Suspendida'**
  String get saleStateSuspended;

  /// No description provided for @saleStateCommitted.
  ///
  /// In es, this message translates to:
  /// **'Completada'**
  String get saleStateCommitted;

  /// No description provided for @saleStateCancelled.
  ///
  /// In es, this message translates to:
  /// **'Cancelada'**
  String get saleStateCancelled;

  /// No description provided for @saleStateRecovered.
  ///
  /// In es, this message translates to:
  /// **'Recuperada'**
  String get saleStateRecovered;

  /// No description provided for @openReceiptAction.
  ///
  /// In es, this message translates to:
  /// **'Abrir recibo'**
  String get openReceiptAction;

  /// No description provided for @reprintReceiptAction.
  ///
  /// In es, this message translates to:
  /// **'Ver para reimpresión'**
  String get reprintReceiptAction;

  /// No description provided for @receiptAvailableMessage.
  ///
  /// In es, this message translates to:
  /// **'Recibo disponible'**
  String get receiptAvailableMessage;

  /// No description provided for @saleLifecycleError.
  ///
  /// In es, this message translates to:
  /// **'No fue posible completar la acción de venta de forma segura.'**
  String get saleLifecycleError;

  /// No description provided for @saleSearchHint.
  ///
  /// In es, this message translates to:
  /// **'Buscar por nombre, cliente o recibo'**
  String get saleSearchHint;

  /// No description provided for @saleNameFallback.
  ///
  /// In es, this message translates to:
  /// **'Venta'**
  String get saleNameFallback;

  /// No description provided for @editCartLineAction.
  ///
  /// In es, this message translates to:
  /// **'Editar producto'**
  String get editCartLineAction;

  /// No description provided for @saveCartLineAction.
  ///
  /// In es, this message translates to:
  /// **'Guardar cambios'**
  String get saveCartLineAction;

  /// No description provided for @clearCartAction.
  ///
  /// In es, this message translates to:
  /// **'Vaciar carrito'**
  String get clearCartAction;

  /// No description provided for @confirmClearCartTitle.
  ///
  /// In es, this message translates to:
  /// **'¿Vaciar este carrito?'**
  String get confirmClearCartTitle;

  /// No description provided for @confirmClearCartBody.
  ///
  /// In es, this message translates to:
  /// **'Se eliminarán todos los productos de la venta actual.'**
  String get confirmClearCartBody;
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
