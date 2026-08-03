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
  String get cashTenderTitle => 'Efectivo';

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
  String get openShiftAction => 'Abrir turno de caja';

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
}
