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

  @override
  String get cartTitle => 'Carrito actual';

  @override
  String get cartEmpty => 'Abre un producto para iniciar este carrito.';

  @override
  String get cartUnavailable => 'El carrito no está disponible temporalmente.';

  @override
  String get cartNoteLabel => 'Nota del operador';

  @override
  String get addToCartAction => 'Agregar al carrito';

  @override
  String get removeFromCartAction => 'Eliminar línea';

  @override
  String get increaseQuantity => 'Aumentar cantidad';

  @override
  String get decreaseQuantity => 'Disminuir cantidad';

  @override
  String get subtotalLabel => 'Subtotal';

  @override
  String get taxLabel => 'Impuestos';

  @override
  String get discountLabel => 'Vista previa de descuentos';

  @override
  String get totalLabel => 'Total';

  @override
  String get businessDateLabel => 'Fecha operativa';

  @override
  String get checkoutNextGate => 'Checkout disponible en el siguiente Gate';

  @override
  String get checkoutAction => 'Cobrar';

  @override
  String get checkoutTitle => 'Cobro autorizado';

  @override
  String get operatorLabel => 'Operador';

  @override
  String get paymentMethodLabel => 'Método de pago';

  @override
  String get cashPayment => 'Efectivo';

  @override
  String get externalTerminalPayment => 'Terminal externa';

  @override
  String get reviewTotalsAction => 'Revisar totales autorizados';

  @override
  String get confirmAndPayAction => 'Confirmar y cobrar';

  @override
  String get confirmAction => 'Confirmar';

  @override
  String get confirmSaleTitle => '¿Confirmar esta venta?';

  @override
  String get confirmSaleBody =>
      'UMI recalculó los totales mostrados. Esta confirmación inicia el pago.';

  @override
  String get totalsConfirmedBody =>
      'UMI recalculó el carrito. Revisa cada total antes de confirmar el pago.';

  @override
  String get paymentProcessing => 'Procesando pago';

  @override
  String get paymentUnknownTitle => 'Estado de pago desconocido';

  @override
  String get paymentUnknownBody =>
      'No inicies otro pago. Consulta el estado de este pago o solicita ayuda a un gerente.';

  @override
  String get queryPaymentAction => 'Consultar estado del pago';

  @override
  String get correlationLabel => 'Correlación';

  @override
  String get saleCompletedTitle => 'Venta completada';

  @override
  String get finishSaleAction => 'Finalizar e iniciar otro carrito';

  @override
  String get checkoutFailed =>
      'No fue posible completar el cobro de forma segura.';

  @override
  String get provisionalSalePendingTitle => 'Venta pendiente de sincronización';

  @override
  String get provisionalSalePendingBody =>
      'La venta se guardó de forma segura en este dispositivo y está pendiente de sincronización. Los datos oficiales del recibo se asignarán cuando el servidor la acepte.';

  @override
  String get returnToCatalogAction => 'Volver al catálogo';

  @override
  String get recoveryCenterTitle => 'Centro de recuperación';

  @override
  String get synchronizingPendingSales => 'Sincronizando ventas pendientes…';

  @override
  String get pendingSalesSecure =>
      'Tus ventas pendientes permanecen almacenadas de forma segura en este dispositivo.';

  @override
  String get synchronizeNowAction => 'Sincronizar ahora';

  @override
  String get conflictNeedsAttention => 'Una venta requiere tu atención.';

  @override
  String get officialReceiptAvailable => 'Recibo oficial disponible';

  @override
  String get cashReceivedLabel => 'Efectivo recibido';

  @override
  String get changeDueLabel => 'Cambio';

  @override
  String get recoveryQueryTitle => 'Consultar resultado guardado';

  @override
  String get recoveryQueryDescription =>
      'Pregunta a UMI si esta misma operación ya fue aceptada.';

  @override
  String get recoveryPolicyTitle => 'Actualizar política sin conexión';

  @override
  String get recoveryPolicyDescription =>
      'Reconecta para cargar el permiso vigente del servidor para ventas sin conexión.';

  @override
  String get recoveryAuthenticationTitle => 'Iniciar sesión de nuevo';

  @override
  String get recoveryAuthenticationDescription =>
      'Restablece tu sesión autorizada antes de continuar la sincronización.';

  @override
  String get recoveryBranchTitle => 'Seleccionar la sucursal autorizada';

  @override
  String get recoveryBranchDescription =>
      'Vuelve a seleccionar sucursal sin mover las ventas pendientes.';

  @override
  String get recoveryManagerTitle => 'Solicitar revisión de gerente';

  @override
  String get recoveryManagerDescription =>
      'Verifica un gerente autorizado únicamente para esta acción de recuperación.';

  @override
  String get recoveryManagerCredentialLabel => 'PIN de gerente';

  @override
  String get recoveryAcknowledgeTitle => 'Confirmar conciliación';

  @override
  String get recoveryAcknowledgeDescription =>
      'Confirma la conciliación del servidor solo después de guardar la recuperación local.';

  @override
  String get recoveryReceiptTitle => 'Ver estado del recibo';

  @override
  String get recoveryReceiptDescription =>
      'Abre el estado conservado del recibo provisional u oficial.';

  @override
  String get recoveryPaymentTitle => 'Consultar pago original';

  @override
  String get recoveryPaymentDescription =>
      'Consulta únicamente el pago original. No se iniciará otro cargo.';

  @override
  String get recoveryDeviceTitle => 'Verificar este dispositivo';

  @override
  String get recoveryDeviceDescription =>
      'Este dispositivo está bloqueado. Restablece la autorización antes de reproducir.';

  @override
  String get recoveryCredentialTitle => 'Recuperar credenciales rotadas';

  @override
  String get recoveryCredentialDescription =>
      'Los comandos históricos permanecen ligados a su versión de credencial original.';

  @override
  String get recoveryStorageTitle =>
      'Conservar almacenamiento para recuperación';

  @override
  String get recoveryStorageDescription =>
      'Conserva intactos los datos cifrados y sigue la recuperación autorizada.';

  @override
  String get recoverySnapshotTitle => 'Actualizar datos autorizados';

  @override
  String get recoverySnapshotDescription =>
      'Reconecta para actualizar catálogo, precios e impuestos vencidos.';

  @override
  String get recoverySupportTitle => 'Copiar referencia de soporte';

  @override
  String get recoverySupportDescription =>
      'Copia la referencia de diagnóstico segura sin exponer el contenido de la venta.';
}
