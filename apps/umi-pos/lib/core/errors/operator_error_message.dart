import 'package:flutter/widgets.dart';

String operatorErrorMessage(BuildContext context, String code) {
  final spanish = Localizations.localeOf(context).languageCode == 'es';
  return switch (code) {
    'PERMISSION_DENIED' =>
      spanish
          ? 'No tienes permiso para esta acción.'
          : 'You do not have permission for this action.',
    'APPROVAL_REQUIRED' =>
      spanish
          ? 'Solicita la aprobación de un gerente.'
          : 'Ask a manager for approval.',
    'APPROVAL_EXPIRED' =>
      spanish
          ? 'La aprobación venció. Solicita una nueva.'
          : 'The approval expired. Ask for a new one.',
    // The API answers this one for two different facts — a credential that was
    // entered wrong often enough to be locked, and a manager credential that is
    // not enrolled for this till at all — so the sentence has to be true of
    // both. It used to fall through to the generic refusal, which told the
    // operator nothing to do and left a movement that could not be booked
    // looking like a button that does not work.
    'PIN_LOCKED' =>
      spanish
          ? 'No se autorizó: el PIN del encargado está bloqueado o no está dado de alta en esta caja. Verifica el PIN, espera unos minutos o pide a otro encargado.'
          : 'Not approved: the manager PIN is locked, or no manager PIN is enrolled for this till. Check the PIN, wait a few minutes, or ask another manager.',
    'SHIFT_NOT_OPEN' =>
      spanish
          ? 'El turno ya no acepta movimientos. Actualiza la pantalla para ver en qué estado quedó.'
          : 'The shift no longer accepts movements. Refresh the screen to see where it stands.',
    'INSUFFICIENT_EXPECTED_CASH' =>
      spanish
          ? 'El cajón no tiene ese efectivo. El importe es mayor que el efectivo esperado.'
          : 'The drawer does not hold that much. The amount is larger than the expected cash.',
    'CASH_POLICY_DENIED' =>
      spanish
          ? 'La política de caja de este local no permite este tipo de movimiento.'
          : 'This location\u2019s cash policy does not allow this kind of movement.',
    'RATE_LIMITED' =>
      spanish
          ? 'Espera un momento antes de intentar de nuevo.'
          : 'Wait before you try again.',
    'REQUEST_TIMEOUT' || 'TRANSPORT_FAILURE' || 'NETWORK_UNAVAILABLE' =>
      spanish
          ? 'No se confirmó la operación. Consulta su estado antes de repetirla.'
          : 'The operation was not confirmed. Check its status before you repeat it.',
    'IDEMPOTENCY_CONFLICT' || 'OPTIMISTIC_VERSION_CONFLICT' || 'CONFLICT' =>
      spanish
          ? 'La información cambió. Revisa los datos e intenta de nuevo.'
          : 'The information changed. Review it and try again.',
    'INSUFFICIENT_BALANCE' =>
      spanish
          ? 'El saldo no cubre este importe.'
          : 'The balance does not cover this amount.',
    'GIFT_CARD_NOT_FOUND' =>
      spanish
          ? 'No se encontró una gift card válida.'
          : 'No valid gift card was found.',
    _ =>
      spanish
          ? 'No se completó la operación. Intenta de nuevo o solicita ayuda.'
          : 'The operation did not finish. Try again or ask for help.',
  };
}
