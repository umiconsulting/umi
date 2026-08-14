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
