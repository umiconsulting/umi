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
  String get updateAvailableTitle => 'Actualización disponible';

  @override
  String get updateRequiredBody =>
      'Esta versión de UmiPOS ya no es compatible. Actualiza para continuar.';

  @override
  String get updateAction => 'Actualizar ahora';

  @override
  String get updateInProgress => 'Descargando la actualización…';

  @override
  String get updateReadyTitle => 'Actualización lista';

  @override
  String get updateReadyBody => 'Reinicia UmiPOS para usar la versión nueva.';

  @override
  String get updateRestartAction => 'Reiniciar ahora';

  @override
  String get updateFailedBody =>
      'No se pudo actualizar. Revisa tu conexión e inténtalo de nuevo.';

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
      'Ingresa el código de configuración de ocho caracteres que muestra el administrador.';

  @override
  String get challengeIdLabel => 'ID del desafío';

  @override
  String get enrollmentCodeLabel => 'Código de registro';

  @override
  String get enrollmentCodeInvalid =>
      'Ingresa el código completo de ocho caracteres. Usa tu PIN de operador después de aprobar el dispositivo.';

  @override
  String get enrollmentCodeRejected =>
      'El código de registro no es válido o caducó. Solicita un código nuevo al administrador.';

  @override
  String get enrollmentCodeExpired =>
      'El código de registro caducó. Solicita un código nuevo al administrador.';

  @override
  String get enrollmentCodeAttemptsExceeded =>
      'Esta solicitud alcanzó el límite de intentos. Solicita un código nuevo al administrador.';

  @override
  String get enrollmentCodeRateLimited =>
      'Se hicieron demasiados intentos. Espera antes de volver a intentarlo.';

  @override
  String get enrollmentCodeUnavailable =>
      'UmiPOS no puede verificar este código ahora. Revisa la conexión e inténtalo de nuevo.';

  @override
  String get enrollmentPendingTitle =>
      'Se requiere la aprobación del administrador';

  @override
  String get enrollmentPendingBody =>
      'Este dispositivo solicitó acceso. Pide a un administrador que lo revise en el Dashboard de UMI.';

  @override
  String get enrollmentPendingSecure =>
      'La credencial de pareo está protegida en este dispositivo.';

  @override
  String get cancelEnrollmentAction => 'Cancelar solicitud';

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
  String get operatorPinTitle => 'Ingresa tu PIN de operador';

  @override
  String get operatorPinBody =>
      'Tu PIN te identifica y carga tus permisos actuales.';

  @override
  String get operatorPinLabel => 'PIN de operador';

  @override
  String get operatorPinHint => 'Usa de 4 a 8 dígitos.';

  @override
  String get operatorPinAction => 'Continuar';

  @override
  String get operatorPinInvalid => 'El PIN no es válido para esta sucursal.';

  @override
  String get operatorPinLocked =>
      'El ingreso de PIN está bloqueado temporalmente. Intenta más tarde.';

  @override
  String get operatorPinRateLimited =>
      'Hay demasiados intentos. Espera antes de intentar de nuevo.';

  @override
  String get operatorPinEntitlementDisabled =>
      'UmiPOS no está habilitado para este negocio.';

  @override
  String get operatorPinBranchInvalid =>
      'Este dispositivo no está asignado a una sucursal activa.';

  @override
  String get operatorPinLength => 'Ingresa al menos cuatro dígitos.';

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
  String get cartCourseLabel => 'Curso';

  @override
  String get cartCoursePrevious => 'Curso anterior';

  @override
  String get cartCourseNext => 'Curso siguiente';

  @override
  String cartCourseCurrent(int course) {
    return 'Curso $course';
  }

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
  String get discountLabel => 'Descuento';

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
  String get recoveryWebUnsupportedTitle =>
      'La recuperación sin conexión no está disponible en Web';

  @override
  String get recoveryWebUnsupportedBody =>
      'La versión Web funciona en línea. Usa una aplicación nativa compatible para almacenar y recuperar ventas sin conexión de forma segura.';

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
  String get tenderSelectionTitle => 'Selección de pago';

  @override
  String get cashTenderTitle => 'Efectivo aplicado';

  @override
  String get tenderAmountLabel => 'Importe aplicado';

  @override
  String get exactAmountAction => 'Importe exacto';

  @override
  String get manualTerminalLabel => 'Terminal manual';

  @override
  String get terminalProcessingAction => 'Procesando fuera del POS';

  @override
  String get terminalSuccessAction => 'Confirmar éxito';

  @override
  String get terminalFailureAction => 'Informar fallo';

  @override
  String get terminalUnknownAction => 'Resultado desconocido';

  @override
  String get tipLabel => 'Propina';

  @override
  String get noTipAction => 'Sin propina';

  @override
  String get customTipPercentLabel => 'Porcentaje de propina personalizado';

  @override
  String get customTipFixedLabel => 'Importe de propina personalizado';

  @override
  String get percentageDiscountAction => 'Porcentaje';

  @override
  String get fixedDiscountAction => 'Importe fijo';

  @override
  String get discountPercentLabel => 'Porcentaje de descuento';

  @override
  String get discountAmountLabel => 'Importe del descuento';

  @override
  String get discountReasonLabel => 'Motivo del descuento';

  @override
  String get receiptDestinationLabel => 'Destino del recibo';

  @override
  String get displayReceiptAction => 'Mostrar recibo';

  @override
  String get printLaterAction => 'Imprimir después';

  @override
  String get noReceiptAction => 'Sin recibo';

  @override
  String get managerApprovalAction => 'Solicitar aprobación';

  @override
  String get managerApprovalTitle => 'Se requiere aprobación del gerente';

  @override
  String get managerPinLabel => 'PIN del gerente';

  @override
  String get managerApprovalDeniedMessage =>
      'El PIN o el permiso del gerente no es válido para este cobro.';

  @override
  String get approveAction => 'Aprobar';

  @override
  String get insufficientCashMessage =>
      'El efectivo recibido no cubre el importe aplicado.';

  @override
  String get invalidTenderMessage =>
      'Revisa la forma de pago: esta combinación no se puede cobrar. Si la terminal ya confirmó un cobro, no se puede quitar de este pedido.';

  @override
  String get remainingBalanceMessage =>
      'Agrega un pago para cubrir el saldo pendiente.';

  @override
  String get approvalRequiredMessage => 'Un gerente debe aprobar este cobro.';

  @override
  String get terminalFailureMessage =>
      'El pago de la terminal falló. Revisa los pagos.';

  @override
  String get tipRejectedMessage =>
      'La política de propinas rechazó esta propina.';

  @override
  String get discountRejectedMessage =>
      'La política de descuentos rechazó este descuento.';

  @override
  String get changeDueLabel => 'Cambio';

  @override
  String get appliedAmountLabel => 'Importe aplicado';

  @override
  String get remainingBalanceLabel => 'Saldo pendiente';

  @override
  String get offlineAdvancedTenderBlockedMessage =>
      'Reconecta para usar la terminal manual, el pago mixto, las propinas o los descuentos. La venta se conserva.';

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

  @override
  String get saleActionsTitle => 'Acciones de venta';

  @override
  String get newSaleAction => 'Nueva venta';

  @override
  String get suspendSaleAction => 'Suspender venta';

  @override
  String get resumeSaleAction => 'Reanudar venta';

  @override
  String get renameSaleAction => 'Cambiar nombre de venta suspendida';

  @override
  String get cancelSaleAction => 'Cancelar venta';

  @override
  String get suspendedSaleLabel => 'Nombre de la venta suspendida';

  @override
  String get cancelSaleReasonLabel => 'Motivo de cancelación';

  @override
  String get confirmCancelSaleTitle => '¿Cancelar esta venta?';

  @override
  String get confirmCancelSaleBody =>
      'El carrito se cerrará sin pago ni recibo. La cancelación permanecerá en el historial de auditoría.';

  @override
  String get saleRestoredMessage => 'Tu venta activa se restauró.';

  @override
  String get readyForNextCustomerMessage => 'Listo para el siguiente cliente.';

  @override
  String get currentCustomerLabel => 'Cliente actual';

  @override
  String get anonymousCustomerLabel => 'Cliente anónimo';

  @override
  String get attachCustomerAction => 'Asignar cliente';

  @override
  String get detachCustomerAction => 'Usar cliente anónimo';

  @override
  String get searchCustomerHint => 'Buscar clientes';

  @override
  String get recentCustomersAction => 'Clientes recientes';

  @override
  String get saleHistoryTitle => 'Ventas';

  @override
  String get incomingOrdersTitle => 'Pedidos entrantes';

  @override
  String get incomingOrdersEmpty => 'No hay pedidos entrantes.';

  @override
  String get incomingOrdersError => 'No se pudieron cargar los pedidos.';

  @override
  String get incomingOrdersTake => 'Atender';

  @override
  String get currentSaleLabel => 'Venta actual';

  @override
  String get suspendedSalesLabel => 'Ventas suspendidas';

  @override
  String get committedSalesLabel => 'Ventas completadas recientes';

  @override
  String get cancelledSalesLabel => 'Ventas canceladas';

  @override
  String get saleHistoryEmpty => 'No hay ventas para esta vista.';

  @override
  String get sortNewestLabel => 'Más recientes primero';

  @override
  String get sortOldestLabel => 'Más antiguas primero';

  @override
  String get loadMoreSalesAction => 'Cargar más ventas';

  @override
  String get saleStateBuilding => 'En curso';

  @override
  String get saleStateSuspended => 'Suspendida';

  @override
  String get saleStateCommitted => 'Completada';

  @override
  String get saleStateCancelled => 'Cancelada';

  @override
  String get saleStateRecovered => 'Recuperada';

  @override
  String get openReceiptAction => 'Abrir recibo';

  @override
  String get reprintReceiptAction => 'Ver para reimpresión';

  @override
  String get receiptAvailableMessage => 'Recibo disponible';

  @override
  String get saleLifecycleError =>
      'No fue posible completar la acción de venta de forma segura.';

  @override
  String get saleSearchHint => 'Buscar por nombre, cliente o recibo';

  @override
  String get saleNameFallback => 'Venta';

  @override
  String get editCartLineAction => 'Editar producto';

  @override
  String get saveCartLineAction => 'Guardar cambios';

  @override
  String get clearCartAction => 'Vaciar carrito';

  @override
  String get confirmClearCartTitle => '¿Vaciar este carrito?';

  @override
  String get confirmClearCartBody =>
      'Se eliminarán todos los productos de la venta actual.';

  @override
  String get cashCenterTitle => 'Centro de caja';

  @override
  String get cashCenterAction => 'Abrir Centro de caja';

  @override
  String get registerAvailableLabel => 'Caja disponible';

  @override
  String get registerAssignedLabel => 'Caja asignada';

  @override
  String get shiftRequiredMessage =>
      'Abre un turno de caja antes de aceptar efectivo.';

  @override
  String get adoptShiftTitle => 'Tu turno sigue abierto en otra terminal';

  @override
  String get adoptShiftMessage =>
      'Esta terminal perdió su identidad guardada. El turno y el dinero siguen ahí; tráelos a esta pantalla para continuar.';

  @override
  String get adoptShiftAction => 'Traer el turno a esta terminal';

  @override
  String get reclaimRegisterTitle =>
      'Esta caja quedó retenida por una terminal que ya no existe';

  @override
  String get reclaimRegisterMessage =>
      'Ninguna terminal activa tiene este cajón. Libéralo para poder abrir un turno con él; el dinero no se cuenta porque sigue en el cajón.';

  @override
  String get reclaimRegisterAction => 'Liberar la caja';

  @override
  String get cashShiftRequiredMessage =>
      'El cobro no tiene un turno de caja al cual abonar el efectivo.';

  @override
  String get resumeShiftAndRetryAction => 'Reanudar turno y reintentar';

  @override
  String get reclaimRegisterAndRetryAction => 'Liberar caja y reintentar';

  @override
  String get cashHeldByActiveTillMessage =>
      'Otra terminal activa tiene esta caja. Pide a un gerente que cuente el cajón antes de continuar.';

  @override
  String get openShiftAction => 'Abrir turno de caja';

  @override
  String get invalidAmountMessage =>
      'Escribe un monto válido, por ejemplo 1,500.00.';

  @override
  String get openingFloatLabel => 'Fondo inicial';

  @override
  String get denominationCountLabel => 'Conteo por denominación';

  @override
  String get paidInAction => 'Entrada de efectivo';

  @override
  String get paidOutAction => 'Salida de efectivo';

  @override
  String get safeDropAction => 'Retiro a caja fuerte';

  @override
  String get drawerCorrectionAction => 'Corrección de caja';

  @override
  String get noSaleDrawerAction => 'Solicitar apertura de cajón';

  @override
  String get drawerRequestRecordedMessage =>
      'La solicitud se registró. No se verificó una operación de hardware.';

  @override
  String get suspendShiftAction => 'Suspender turno';

  @override
  String get resumeShiftAction => 'Reanudar turno';

  @override
  String get handoffShiftAction => 'Entregar turno';

  @override
  String get incomingOperatorPinLabel => 'PIN del operador entrante';

  @override
  String get blindCountAction => 'Iniciar conteo ciego';

  @override
  String get recountAction => 'Iniciar reconteo';

  @override
  String get expectedCashLabel => 'Efectivo esperado';

  @override
  String get countedCashLabel => 'Efectivo contado';

  @override
  String get cashVarianceLabel => 'Diferencia';

  @override
  String get cashOverageLabel => 'Sobrante';

  @override
  String get cashShortageLabel => 'Faltante';

  @override
  String get cashToleranceLabel => 'Tolerancia';

  @override
  String get varianceReasonLabel => 'Motivo de la diferencia';

  @override
  String get cashApprovalAction => 'Solicitar aprobación de diferencia';

  @override
  String get reconcileShiftAction => 'Conciliar turno';

  @override
  String get closeShiftAction => 'Cerrar turno';

  @override
  String get shiftClosedMessage => 'El turno de caja está cerrado.';

  @override
  String get blockedShiftMessage =>
      'Este turno está bloqueado. Sigue la guía de recuperación.';

  @override
  String get pendingCashPostingMessage =>
      'Un movimiento pendiente debe terminar antes del cierre.';

  @override
  String get ambiguousCashEffectMessage =>
      'Se desconoce un efecto de caja. Verifica la operación original.';

  @override
  String get cashRecoveryMessage =>
      'Se restauró el estado guardado de la operación de caja.';

  @override
  String get shiftSummaryTitle => 'Resumen del turno';

  @override
  String get cashMovementAmountLabel => 'Importe del movimiento';

  @override
  String get cashMovementReasonLabel => 'Motivo del movimiento';

  @override
  String get submitCashMovementAction => 'Confirmar movimiento de caja';

  @override
  String get submitBlindCountAction => 'Enviar conteo ciego';

  @override
  String get cashOperationFailedMessage =>
      'No fue posible completar la operación de caja de forma segura.';

  @override
  String get cashStatusOpen => 'Turno abierto';

  @override
  String get cashStatusSuspended => 'Turno suspendido';

  @override
  String get cashStatusCounting => 'Conteo de efectivo en curso';

  @override
  String get cashStatusReconciliation => 'Se requiere conciliación';

  @override
  String get cashStatusClosed => 'Turno cerrado';

  @override
  String get confirmCloseShiftTitle => '¿Cerrar este turno de caja?';

  @override
  String get confirmCloseShiftBody =>
      'El cierre es definitivo. Los nuevos movimientos requieren otro turno.';

  @override
  String get varianceReasonNone => 'Sin diferencia';

  @override
  String get varianceReasonCounting => 'Error de conteo';

  @override
  String get varianceReasonChange => 'Error de cambio';

  @override
  String get varianceReasonHandling => 'Error de manejo de efectivo';

  @override
  String get varianceReasonUnknown => 'Diferencia operativa';

  @override
  String get saleExceptionAction => 'Acciones posteriores a la venta';

  @override
  String get saleExceptionTitle => 'Reembolso o anulación';

  @override
  String get fullRefundAction => 'Reembolso total';

  @override
  String get partialRefundAction => 'Reembolso parcial';

  @override
  String get voidSaleAction => 'Anular venta';

  @override
  String get refundableAmountLabel => 'Importe restante reembolsable';

  @override
  String get remainingRefundableQuantityLabel => 'Cantidad restante';

  @override
  String get alreadyRefundedLabel => 'Ya reembolsado';

  @override
  String get refundReasonLabel => 'Motivo del reembolso';

  @override
  String get restockAction => 'Reponer';

  @override
  String get doNotRestockAction => 'No reponer';

  @override
  String get inspectionRequiredAction => 'Requiere inspección';

  @override
  String get taxRefundLabel => 'Reembolso de impuestos';

  @override
  String get discountAllocationLabel => 'Asignación del descuento';

  @override
  String get tipRefundLabel => 'Reembolso de propina';

  @override
  String get cashRefundLabel => 'Reembolso en efectivo';

  @override
  String get manualTerminalRefundLabel => 'Reembolso en terminal manual';

  @override
  String get manualTerminalRefundProviderNotice =>
      'Procesa el reembolso en la terminal externa. UmiPOS registra tu observación. No prueba el éxito del proveedor.';

  @override
  String get manualTerminalRefundOnCommitNotice =>
      'El cobro se devolverá en la terminal al confirmar el reembolso.';

  @override
  String get cardTerminalRefundLabel => 'Reembolso en terminal de tarjeta';

  @override
  String get approvalExpiredMessage =>
      'La aprobación venció. Solicita una aprobación nueva.';

  @override
  String get paymentOutcomeUnknownMessage =>
      'Se desconoce el resultado de la terminal. Verifica la operación original.';

  @override
  String get verifyTerminalAction => 'Verificar resultado de la terminal';

  @override
  String get terminalRefundSuccessAction => 'El reembolso externo tuvo éxito';

  @override
  String get terminalRefundFailureAction => 'El reembolso externo falló';

  @override
  String get terminalRefundUnknownAction => 'Se desconoce el resultado';

  @override
  String get refundBlockedMessage =>
      'El servidor bloqueó esta acción posterior a la venta.';

  @override
  String get refundPolicyExpiredMessage =>
      'El periodo permitido para el reembolso venció.';

  @override
  String get supportRequiredMessage => 'Se requiere una revisión de soporte.';

  @override
  String get compensatingReceiptTitle => 'Recibo de reembolso';

  @override
  String get fullyRefundedLabel => 'Reembolso total';

  @override
  String get partiallyRefundedLabel => 'Reembolso parcial';

  @override
  String get voidedSaleLabel => 'Venta anulada';

  @override
  String get recoveredRefundMessage =>
      'Se restauró el resultado guardado del reembolso.';

  @override
  String get refundCommittedMessage => 'El reembolso quedó confirmado.';

  @override
  String get refundPreviewAction => 'Revisar reembolso';

  @override
  String get commitRefundAction => 'Confirmar reembolso';

  @override
  String get refundConfirmationTitle => '¿Confirmar este reembolso?';

  @override
  String get refundConfirmationBody =>
      'Esta acción crea ajustes permanentes. La venta original no cambia.';

  @override
  String get originalSaleLabel => 'Venta original';

  @override
  String get exceptionHistoryLabel => 'Historial de ajustes';

  @override
  String get refundOperationFailedMessage =>
      'No fue posible completar la acción de forma segura.';

  @override
  String get selectRefundLinesMessage =>
      'Selecciona al menos una línea reembolsable.';

  @override
  String get refundReasonCustomerChangedMind => 'El cliente cambió de opinión';

  @override
  String get refundReasonProductDefect => 'Producto defectuoso';

  @override
  String get refundReasonIncorrectItem => 'Producto incorrecto';

  @override
  String get refundReasonIncorrectQuantity => 'Cantidad incorrecta';

  @override
  String get refundReasonDuplicateCharge => 'Cobro duplicado';

  @override
  String get refundReasonQualityIssue => 'Problema de calidad';

  @override
  String get refundReasonOrderPreparationError =>
      'Error de preparación del pedido';

  @override
  String get refundReasonPricingError => 'Error de precio';

  @override
  String get voidReasonOperatorError => 'Error del operador';

  @override
  String get voidReasonDuplicateSale => 'Venta duplicada';

  @override
  String get voidReasonIncorrectTender => 'Forma de pago incorrecta';

  @override
  String get voidReasonSaleEnteredByMistake => 'Venta registrada por error';

  @override
  String get otherApprovedReasonLabel => 'Otro motivo aprobado';

  @override
  String get decreaseRefundQuantityTooltip => 'Reducir cantidad del reembolso';

  @override
  String get increaseRefundQuantityTooltip => 'Aumentar cantidad del reembolso';

  @override
  String get restockIntentLabel => 'Decisión de reposición';

  @override
  String get restockNotApplicableLabel => 'No aplica la reposición';

  @override
  String get restockInventoryReviewLabel =>
      'Se requiere una revisión de inventario';

  @override
  String get sessionEndedReauth =>
      'Tu sesión terminó. Vuelve a ingresar tu PIN.';

  @override
  String operatorShift(String name) {
    return 'Turno de $name';
  }

  @override
  String get tableStateOpenLabel => 'Libre';

  @override
  String get tableStateSeatedLabel => 'Ocupada';

  @override
  String get tableStateOrderedLabel => 'Pedido tomado';

  @override
  String get tableStateServedLabel => 'Servido';

  @override
  String get tableStateAwaitingPaymentLabel => 'Por cobrar';

  @override
  String get tableStateDirtyLabel => 'Por limpiar';

  @override
  String tableStatePartySizeLabel(int count) {
    return '$count personas';
  }

  @override
  String tableStateElapsedLabel(String duration) {
    return '$duration en mesa';
  }

  @override
  String tableStateGroupLabel(int count) {
    return 'Grupo de $count mesas';
  }

  @override
  String get tableStateSeatAction => 'Sentar';

  @override
  String tableStateSeatTitle(String table) {
    return 'Sentar la mesa $table';
  }

  @override
  String get tableStatePartySizeField => 'Personas';

  @override
  String get tableStateMoveAction => 'Mover';

  @override
  String tableStateMoveArmed(String table) {
    return 'Moviendo $table. Toca una mesa libre.';
  }

  @override
  String get tableStateSplitAction => 'Dividir';

  @override
  String get tableStateClearAction => 'Liberar mesa';

  @override
  String get tableStateReadyAction => 'Mesa lista';

  @override
  String get tableStateOrderedAction => 'Pedido enviado';

  @override
  String get tableStateServedAction => 'Marcar servido';

  @override
  String get tableStateAwaitingPaymentAction => 'Pedir la cuenta';

  @override
  String get tableStateSelectAction => 'Seleccionar';

  @override
  String get tableStateMergeAction => 'Combinar';

  @override
  String get tableStateSelectHint => 'Selecciona dos o más mesas libres';

  @override
  String tableStateSelectedCount(int count) {
    return '$count seleccionadas';
  }

  @override
  String get tableStateMergeTitle => 'Combinar mesas';

  @override
  String tableStateMergeSummary(int tables, int seats) {
    return '$tables mesas · $seats lugares';
  }

  @override
  String get tableStateTargetOccupied => 'Esa mesa ya tiene un grupo.';

  @override
  String tableStateTargetTooSmall(int count) {
    return 'Esa mesa no tiene lugar para $count personas.';
  }

  @override
  String get tableStateFailureTitle => 'No se pudo completar';

  @override
  String get tableStateFailureRefresh => 'Actualizar plano';

  @override
  String get tableStateFailureAlreadyOccupiedMessage =>
      'Esa mesa ya tiene un grupo.';

  @override
  String get tableStateFailureAlreadyOccupiedRecovery =>
      'Elige otra mesa, o actualiza el plano antes de volver a intentarlo.';

  @override
  String get tableStateFailureCapacityExceededMessage =>
      'El grupo es más grande de lo que cabe en la mesa.';

  @override
  String get tableStateFailureCapacityExceededRecovery =>
      'Elige una mesa más grande, o combina dos mesas.';

  @override
  String get tableStateFailureNotOccupiedMessage =>
      'No hay ningún grupo en esa mesa.';

  @override
  String get tableStateFailureNotOccupiedRecovery =>
      'Actualiza el plano: alguien más pudo haber liberado la mesa.';

  @override
  String get tableStateFailureNotGroupedMessage =>
      'Esa mesa no está combinada con otra.';

  @override
  String get tableStateFailureNotGroupedRecovery =>
      'Solo se puede dividir una mesa que está dentro de un grupo.';

  @override
  String get tableStateFailureNotInPlanMessage =>
      'Esa mesa no existe en el plano publicado.';

  @override
  String get tableStateFailureNotInPlanRecovery =>
      'Publica el plano desde el dashboard y actualiza la vista.';

  @override
  String get tableStateFailureIdempotencyConflictMessage =>
      'Ese cambio ya se envió antes con otro contenido.';

  @override
  String get tableStateFailureIdempotencyConflictRecovery =>
      'Actualiza el plano y repite la acción desde el estado actual.';

  @override
  String get tableStateFailurePermissionDeniedMessage =>
      'Tu rol no permite cambiar las mesas.';

  @override
  String get tableStateFailurePermissionDeniedRecovery =>
      'Pide a un gerente que lo haga, o entra con otro operador.';

  @override
  String get tableStateFailurePlanNotPublishedMessage =>
      'Esta sucursal no tiene un plano publicado.';

  @override
  String get tableStateFailurePlanNotPublishedRecovery =>
      'Publica el plano desde el dashboard para poder operar sus mesas.';

  @override
  String get tableStateFailureGenericMessage =>
      'No se pudo completar la acción en la mesa.';

  @override
  String get tableStateFailureGenericRecovery =>
      'Actualiza el plano y vuelve a intentarlo.';

  @override
  String get tableStateCancelAction => 'Cancelar';

  @override
  String get kitchenBoardTitle => 'Cocina';

  @override
  String get kitchenBoardRefresh => 'Actualizar';

  @override
  String get kitchenBoardLoadFailed => 'No se pudo cargar la cocina.';

  @override
  String get kitchenBoardEmpty => 'Sin comandas en cocina.';

  @override
  String get kitchenBoardTabTickets => 'Comandas';

  @override
  String get kitchenPrepTab => 'Preparación';

  @override
  String get kitchenPrepRefresh => 'Recargar la preparación';

  @override
  String get kitchenPrepLoadFailed => 'No se pudo cargar la preparación.';

  @override
  String get kitchenPrepEmpty =>
      'Aún no hay artículos con par. Define el par en Inventario.';

  @override
  String kitchenPrepWindow(String from, String to) {
    return 'Uso previsto del $from al $to';
  }

  @override
  String get kitchenPrepItemColumn => 'Artículo';

  @override
  String get kitchenPrepUnitColumn => 'Unidad';

  @override
  String get kitchenPrepParColumn => 'Par';

  @override
  String get kitchenPrepOnHandColumn => 'Existencia';

  @override
  String get kitchenPrepForecastColumn => 'Uso previsto';

  @override
  String get kitchenPrepQuantityColumn => 'Cantidad a preparar';

  @override
  String get kitchenPrepNoPar => 'Sin par';

  @override
  String get kitchenStatusQueued => 'En cola';

  @override
  String get kitchenStatusInPreparation => 'En preparación';

  @override
  String get kitchenStatusPartiallyReady => 'Parcial';

  @override
  String get kitchenStatusReady => 'Listo';

  @override
  String get kitchenStatusException => 'Excepción';

  @override
  String get kitchenPriorityUrgent => 'Urgente';

  @override
  String get kitchenPriorityHigh => 'Alta';

  @override
  String get kitchenElapsedNow => 'ahora';

  @override
  String kitchenElapsedMinutes(int minutes) {
    return '$minutes min';
  }

  @override
  String kitchenElapsedHoursMinutes(int hours, int minutes) {
    return '$hours h $minutes min';
  }

  @override
  String kitchenElapsedDaysHours(int days, int hours) {
    return '$days d $hours h';
  }

  @override
  String kitchenItemMarkReady(String item) {
    return 'Marcar $item como listo';
  }

  @override
  String kitchenItemAlreadyReady(String item) {
    return '$item ya está listo';
  }

  @override
  String kitchenCourseGroup(int course) {
    return 'Curso $course';
  }

  @override
  String kitchenCourseHeld(int count) {
    return 'En espera · $count';
  }

  @override
  String get kitchenCourseHeldNote => 'No se prepara todavía';

  @override
  String kitchenCourseFire(int course) {
    return 'Empezar curso $course';
  }

  @override
  String kitchenItemHeld(String item) {
    return '$item aún no se prepara';
  }

  @override
  String get kitchenItemVoided => 'ANULADO';

  @override
  String get kitchenTicketStartAction => 'Empezar';

  @override
  String get kitchenTicketCompleteAction => 'Terminar';

  @override
  String get kitchenTicketRecallAction => 'Recuperar';

  @override
  String get kitchenTicketSending => 'Enviando…';

  @override
  String get kitchenRecallTitle => 'Recuperar comanda';

  @override
  String get kitchenRecallBody => '¿Por qué vuelve esta comanda a la cocina?';

  @override
  String get kitchenRecallReasonCustomerReturned => 'El cliente lo devolvió';

  @override
  String get kitchenRecallReasonWrongItem => 'Salió otro platillo';

  @override
  String get kitchenRecallReasonQuality => 'No quedó bien';

  @override
  String get kitchenRecallReasonOther => 'Otro motivo';

  @override
  String get kitchenRecallNoteLabel => 'Nota (opcional)';

  @override
  String get kitchenRecallCancel => 'Cancelar';

  @override
  String get kitchenFailureTitle => 'La cocina no cambió';

  @override
  String get kitchenFailureRefresh => 'Actualizar cocina';

  @override
  String kitchenFailureVersionConflictMessage(String reference) {
    return 'Alguien más ya movió la comanda $reference.';
  }

  @override
  String get kitchenFailureVersionConflictGenericMessage =>
      'Alguien más ya movió esa comanda.';

  @override
  String get kitchenFailureVersionConflictRecovery =>
      'El tablero ya se actualizó. Revisa la comanda y marca lo que falte.';

  @override
  String kitchenFailureFingerprintMessage(String reference) {
    return 'Ese cambio ya se envió antes con otro contenido, en la comanda $reference.';
  }

  @override
  String get kitchenFailureFingerprintRecovery =>
      'Actualiza el tablero y repite la acción desde el estado actual.';

  @override
  String get kitchenFailureInvalidTransitionMessage =>
      'La comanda no puede dar ese paso desde su estado actual.';

  @override
  String get kitchenFailureInvalidTransitionRecovery =>
      'Actualiza el tablero. Para regresar una comanda a la cocina, usa Recuperar en una comanda lista.';

  @override
  String get kitchenFailurePermissionDeniedMessage =>
      'Tu rol no permite mover la cocina.';

  @override
  String get kitchenFailurePermissionDeniedRecovery =>
      'Pide a un gerente que lo haga, o entra con otro operador.';

  @override
  String kitchenFailureTicketMissingMessage(String reference) {
    return 'La comanda $reference no llegó a la estación de este dispositivo.';
  }

  @override
  String get kitchenFailureTicketMissingGenericMessage =>
      'Esa comanda no llegó a la estación de este dispositivo.';

  @override
  String get kitchenFailureTicketMissingRecovery =>
      'La comanda sigue en cocina. Actualiza el tablero y, si vuelve a pasar, pide a un gerente que revise que este dispositivo esté asignado a su estación.';

  @override
  String get kitchenFailureDeviceMessage =>
      'Este dispositivo ya no está registrado para la cocina.';

  @override
  String get kitchenFailureDeviceRecovery =>
      'Vuelve a registrar el dispositivo desde el dashboard.';

  @override
  String get kitchenFailureGenericMessage =>
      'No se pudo completar la acción en cocina.';

  @override
  String get kitchenFailureGenericRecovery =>
      'Actualiza el tablero y vuelve a intentarlo.';

  @override
  String get terminalChargeTitle => 'Cobro en terminal';

  @override
  String terminalChargeInstruction(String amount) {
    return 'Cobra $amount en la terminal y confirma el resultado aquí.';
  }

  @override
  String get terminalOperatorDeclaration =>
      'La terminal es una declaración del operador: el POS no lee su resultado.';

  @override
  String get terminalStatusLabel => 'Estado';

  @override
  String get terminalStatusNotStarted => 'Sin iniciar';

  @override
  String get terminalStatusProcessing => 'Cobrando fuera del POS';

  @override
  String get terminalStatusConfirmed => 'Cobro confirmado';

  @override
  String get terminalStatusFailed => 'Fallo reportado';

  @override
  String get terminalStatusUnknown => 'Resultado desconocido';

  @override
  String get terminalStatusCancelled => 'Cancelado antes de cobrar';

  @override
  String get cardTerminalLabel => 'Terminal de tarjeta';

  @override
  String get terminalWaitingTitle => 'Esperando en la terminal…';

  @override
  String get terminalStopWaitingAction => 'Dejar de esperar';

  @override
  String get terminalApprovedMessage => 'La terminal aprobó el cobro.';

  @override
  String terminalDeclinedMessage(String code) {
    return 'La terminal rechazó el cobro ($code).';
  }

  @override
  String get terminalUnresolvedMessage =>
      'Hay un cobro con tarjeta que nadie ha confirmado. La venta no se puede cerrar hasta resolverlo.';

  @override
  String get terminalStoppedWaitingMessage =>
      'Dejaste de esperar: la terminal puede seguir con el pedido. El intento queda registrado y se puede consultar.';

  @override
  String get terminalLastAnswerLabel => 'La terminal responde';

  @override
  String get terminalApprovedCollectMessage =>
      'La terminal aprobó el cobro. Pulsa Cobrar para cerrar la venta.';

  @override
  String get terminalDeclinedNoChargeMessage =>
      'La terminal rechazó el cobro y no se cobró nada. Puedes cobrar en efectivo, o iniciar una venta nueva para reintentar con tarjeta.';

  @override
  String get terminalUnavailableMessage =>
      'La terminal de tarjeta no está disponible. Puedes cobrar en efectivo.';

  @override
  String get terminalBusyMessage =>
      'La terminal está ocupada con otro pedido. Vuelve a intentarlo.';

  @override
  String get newSaleConfirmTitle => '¿Empezar una venta nueva?';

  @override
  String newSaleConfirmBody(int count) {
    return 'Este carrito tiene $count línea(s) sin cobrar. Se abandona y empieza una venta vacía; no se cobra nada por él.';
  }

  @override
  String get keepCartAction => 'Seguir con este carrito';

  @override
  String get tenderConflictTitle => 'Este carrito no se puede cobrar así';

  @override
  String get tenderConflictBody =>
      'Guarda un cobro dividido entre efectivo y tarjeta, y esta sucursal cobra un solo método por venta. El registro del cobro queda guardado para revisión; para seguir, empieza una venta nueva.';

  @override
  String get splitTenderTitle => 'Cobro dividido';

  @override
  String get splitTenderAction => 'Dividir el pago';

  @override
  String get splitTenderCancelAction => 'Un solo método';

  @override
  String get splitTenderPickSecond => 'Elige el segundo método de pago.';

  @override
  String get singleMethodOnlyNote =>
      'Esta sucursal cobra con un solo método por venta.';

  @override
  String tenderShortBy(String amount) {
    return 'Falta $amount';
  }

  @override
  String tenderOverBy(String amount) {
    return 'Sobra $amount';
  }

  @override
  String kitchenAllDayTooltip(int ordered, int outstanding) {
    return 'Pedidos de hoy: $ordered. Pendientes de preparar: $outstanding.';
  }

  @override
  String get inventoryProductionAction => 'Producir';

  @override
  String get inventoryProductionTitle => 'Producir preparación';

  @override
  String get inventoryProductionOutputLabel => 'Artículo producido';

  @override
  String get inventoryProductionQuantityLabel => 'Cantidad que salió';

  @override
  String get inventoryProductionQuantityHelper =>
      'Usa la escala y la unidad base del artículo.';

  @override
  String get inventoryProductionLotLabel => 'Lote (opcional)';

  @override
  String get inventoryProductionExpiryLabel => 'Caducidad (opcional)';

  @override
  String get inventoryProductionExpiryHint => 'AAAA-MM-DD';

  @override
  String get inventoryProductionResultTitle => 'Lote producido';

  @override
  String get inventoryProductionLotReferenceLabel => 'Lote';

  @override
  String get inventoryProductionExpiryReferenceLabel => 'Caducidad';

  @override
  String get inventoryProductionProducedLabel => 'Producido';

  @override
  String get inventoryProductionDeclaredLabel => 'Rendimiento esperado';

  @override
  String get inventoryProductionYieldLossLabel => 'Merma de rendimiento';

  @override
  String get inventoryProductionUnitCostLabel => 'Costo unitario';

  @override
  String get inventoryProductionTotalCostLabel => 'Costo del lote';

  @override
  String get inventoryProductionConsumedTitle => 'Insumos consumidos';

  @override
  String get inventoryProductionIncompleteCostMessage =>
      'Algunos insumos no tienen costo registrado.';

  @override
  String get inventoryProductionNoCostLabel => 'Sin costo';

  @override
  String get inventoryProductionRecipeRequiredMessage =>
      'Este artículo no tiene receta de producción.';

  @override
  String get inventoryProductionQuantityNotExactMessage =>
      'La cantidad no se reparte de forma exacta entre los insumos de la receta.';

  @override
  String get inventoryProductionInsufficientStockMessage =>
      'No hay existencia suficiente de un insumo para producir este lote.';

  @override
  String get inventoryUnitEach => 'pza';

  @override
  String get inventoryUnitGram => 'g';

  @override
  String get inventoryUnitKilogram => 'kg';

  @override
  String get inventoryUnitMilliliter => 'ml';

  @override
  String get inventoryUnitLiter => 'L';

  @override
  String get inventoryUnitPortion => 'porción';

  @override
  String get inventoryUnitPackage => 'paquete';

  @override
  String get inventoryUnitBox => 'caja';
}
