// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appName => 'UmiPOS';

  @override
  String get bootstrapLoadingTitle => 'Preparando UmiPOS';

  @override
  String get bootstrapLoadingBody =>
      'Verificando la configuración y el almacenamiento seguro.';

  @override
  String get readyTitle => 'Listo para comenzar';

  @override
  String get readyBody =>
      'La base de UmiPOS está preparada. La autenticación se habilitará en el siguiente paso.';

  @override
  String get configurationInvalidTitle => 'Configuración incompleta';

  @override
  String get configurationInvalidBody =>
      'UmiPOS no puede iniciar de forma segura con esta configuración.';

  @override
  String get storageUnavailableTitle => 'Almacenamiento seguro no disponible';

  @override
  String get storageUnavailableBody =>
      'No se guardarán credenciales en almacenamiento sin cifrar.';

  @override
  String get sdkUnavailableTitle => 'Contrato no disponible';

  @override
  String get sdkUnavailableBody =>
      'La aplicación no pudo verificar el contrato de la plataforma.';

  @override
  String get recoverableFailureTitle => 'No pudimos terminar la preparación';

  @override
  String get unrecoverableFailureTitle => 'UmiPOS necesita atención';

  @override
  String get retryAction => 'Reintentar';

  @override
  String get diagnosticsAction => 'Ver diagnóstico';

  @override
  String get diagnosticsTitle => 'Diagnóstico de desarrollo';

  @override
  String get unknownRouteTitle => 'Ruta no disponible';

  @override
  String get unknownRouteBody => 'Esta sección todavía no está habilitada.';

  @override
  String get enrollmentTitle => 'Registrar este dispositivo';

  @override
  String get enrollmentBody =>
      'Ingresa el desafío de un solo uso aprobado por un administrador.';

  @override
  String get challengeIdLabel => 'ID del desafío';

  @override
  String get enrollmentCodeLabel => 'Código de registro';

  @override
  String get continueAction => 'Continuar';

  @override
  String get loginTitle => 'Iniciar sesión en UmiPOS';

  @override
  String get usernameLabel => 'Correo';

  @override
  String get passwordLabel => 'Contraseña';

  @override
  String get signInAction => 'Iniciar sesión';

  @override
  String get selectTenantTitle => 'Selecciona un negocio';

  @override
  String get noTenantTitle => 'Sin acceso a negocios';

  @override
  String get noTenantBody => 'Tu cuenta no tiene acceso activo a UmiPOS.';

  @override
  String get selectBranchTitle => 'Selecciona una sucursal';

  @override
  String get noBranchBody =>
      'No hay una sucursal activa permitida para tu usuario y dispositivo.';

  @override
  String get operatorTitle => 'Iniciar sesión de operador';

  @override
  String get operatorBody =>
      'Confirma esta sucursal para entrar al entorno protegido de POS.';

  @override
  String get startOperatorAction => 'Iniciar sesión';

  @override
  String get lockAction => 'Bloquear operador';

  @override
  String get logoutAction => 'Cerrar sesión';

  @override
  String get deviceActiveLabel => 'Dispositivo confiable';

  @override
  String get connectivityUnknownLabel => 'Conectividad desconocida';

  @override
  String get shellReadyTitle => 'Sesión de operador lista';

  @override
  String get catalogNotImplemented =>
      'El catálogo todavía no está implementado.';

  @override
  String get deviceRevokedTitle => 'Dispositivo revocado';

  @override
  String get deviceRevokedBody =>
      'Esta instalación ya no es confiable. Solicita su reemplazo a un administrador.';

  @override
  String get rotationRequiredTitle => 'Rotación de credencial requerida';

  @override
  String get rotationRequiredBody =>
      'Un administrador debe rotar la credencial antes de continuar.';

  @override
  String get recoverableNetworkBody =>
      'No fue posible contactar de forma segura el servicio de acceso.';

  @override
  String get catalogTitle => 'Catálogo';

  @override
  String get catalogSearchHint => 'Buscar nombre, SKU o código';

  @override
  String get allCategories => 'Todo';

  @override
  String get catalogLoading => 'Cargando catálogo autorizado';

  @override
  String get catalogEmpty => 'No hay productos disponibles para esta sucursal.';

  @override
  String get catalogNoResults => 'No hay productos para esta búsqueda.';

  @override
  String get catalogPermissionDenied =>
      'No tienes permiso para ver este catálogo.';

  @override
  String get catalogNetworkError =>
      'No se pudo conectar con el catálogo. Intenta de nuevo.';

  @override
  String get catalogUnexpectedError =>
      'El catálogo no está disponible temporalmente.';

  @override
  String get unavailableLabel => 'No disponible';

  @override
  String get variantsLabel => 'Variantes';

  @override
  String get modifiersLabel => 'Modificadores';

  @override
  String get taxIncludedLabel => 'Impuesto configurado';

  @override
  String get closeAction => 'Cerrar';
}
