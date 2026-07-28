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
}
