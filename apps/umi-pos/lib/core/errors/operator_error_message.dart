import 'package:flutter/widgets.dart';

String operatorErrorMessage(
  BuildContext context,
  String code, {
  Map<String, Object?>? details,
}) {
  final spanish = Localizations.localeOf(context).languageCode == 'es';
  if (code == 'CART_ACCOUNT_BUSY' && details?['operatorName'] is String) {
    final owner = details!['operatorName'];
    final device = details['deviceName'];
    return spanish
        ? '$owner tiene esta cuenta abierta${device is String ? ' en $device' : ''}. Pídele guardar la cuenta desde Cuentas antes de recuperarla aquí.'
        : '$owner has this account open${device is String ? ' on $device' : ''}. Ask them to save it from Accounts before recovering it here.';
  }
  return switch (code) {
    'OPERATOR_SESSION_BUSY' =>
      spanish
          ? 'Este usuario ya tiene una sesión abierta en otro POS. Cierra la sesión allí o entra con otro usuario.'
          : 'This user already has an open session on another POS. Sign out there or sign in with another user.',
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
    // The shift cannot make the move the till asked for, and the three ways that
    // happens read the same to the person in front of it: the drawer moved to
    // another terminal, the version the till held is no longer the shift's, or
    // the status does not admit the move (a drawer under count cannot be resumed
    // as open). Before this sentence the API answered a bare 500 INTERNAL_ERROR
    // for all three — measured on the iMin D3-504, 2026-10-11, on a drawer the
    // cash screen was offering to resume. The recovery is the same for all three
    // and it is the Cash screen's, not a retry of the same button.
    'INVALID_SHIFT_TRANSITION' =>
      spanish
          ? 'El turno no se puede mover así en este momento. Actualiza la pantalla de Caja para ver en qué estado quedó.'
          : 'The shift cannot be moved that way right now. Refresh the Cash screen to see where it stands.',
    // THE PRINTER THIS TILL CANNOT SEE.
    //
    // The reprint refused because no printer was assigned to this terminal or to
    // its register. It used to refuse as a bare `StateError`, which is not a code
    // any screen renders, so the operator pressed "Imprimir recibo" and NOTHING
    // happened — no paper, no sentence, no cause (iMin D3-504, 2026-10-11). The
    // sentence has to name the two facts the operator cannot see from the till:
    // there is no printer here, and the place to fix that is the hardware centre.
    'HARDWARE_RECEIPT_PRINTER_UNAVAILABLE' =>
      spanish
          ? 'Esta caja no tiene impresora asignada, así que no hay dónde imprimir. Revísala en Centro de hardware.'
          : 'This till has no printer assigned, so there is nowhere to print. Check it in the hardware centre.',
    'HARDWARE_RECEIPT_PAYLOAD_UNAVAILABLE' =>
      spanish
          ? 'El recibo no se pudo preparar para imprimir. Vuelve a abrirlo desde Ventas.'
          : 'The receipt could not be prepared for printing. Open it again from Sales.',
    // The API's own refusals for the same dead end: the device is not there to
    // print, or it is there and unreachable.
    'HARDWARE_NOT_FOUND' =>
      spanish
          ? 'No se encontró la impresora asignada a esta caja. Revísala en Centro de hardware.'
          : 'The printer assigned to this till was not found. Check it in the hardware centre.',
    'HARDWARE_DISCONNECTED' =>
      spanish
          ? 'La impresora está desconectada. Revisa el cable y vuelve a intentar.'
          : 'The printer is disconnected. Check the cable and try again.',
    'HARDWARE_DISABLED' =>
      spanish
          ? 'La impresora está desactivada. Actívala en Centro de hardware.'
          : 'The printer is disabled. Enable it in the hardware centre.',
    'INSUFFICIENT_EXPECTED_CASH' =>
      spanish
          ? 'El cajón no tiene ese efectivo. El importe es mayor que el efectivo esperado.'
          : 'The drawer does not hold that much. The amount is larger than the expected cash.',
    'CASH_POLICY_DENIED' =>
      spanish
          ? 'La política de caja de este local no permite este tipo de movimiento.'
          : 'This location\u2019s cash policy does not allow this kind of movement.',
    // The local journal of this till still holds a cash movement whose outcome
    // the server has NOT settled — a re-count, a movement, an open. The till
    // refuses to start a different one on top of it, which is correct (money may
    // be half-counted) and used to be silent: the refusal travelled as a code
    // nobody rendered, and the operator pressed the same button again. Measured
    // on the iMin D3-504, 2026-10-11.
    'CASH_RECOVERY_ACTION_REQUIRED' =>
      spanish
          ? 'Esta caja tiene un movimiento de efectivo sin resolver (por ejemplo un conteo a medias). Termínalo en la pantalla de Caja antes de hacer otra operación.'
          : 'This till has an unresolved cash movement (a half-finished count, for instance). Finish it on the Cash screen before anything else.',
    // The till asked the server what became of a movement it had journaled and
    // the server is still working on it. Nothing to do but wait — and say so.
    'CASH_COMMAND_PENDING' =>
      spanish
          ? 'La operación anterior sigue en proceso en el servidor. Espera unos segundos y vuelve a mirar el estado de la caja.'
          : 'The previous operation is still running on the server. Wait a few seconds and look at the cash state again.',
    // The movement had already landed when the till started up, so the journal
    // was closed by reconciliation rather than by repeating it.
    'CASH_COMMAND_RECOVERED' =>
      spanish
          ? 'Se recuperó un movimiento de efectivo que había quedado sin confirmar. Revisa la caja antes de continuar.'
          : 'A cash movement that had gone unconfirmed was recovered. Check the cash state before you continue.',
    'CASH_COMMAND_RETRY_REQUIRED' =>
      spanish
          ? 'Quedó un movimiento de efectivo sin resolver. Ciérralo desde la pantalla de Caja.'
          : 'A cash movement is still unresolved. Settle it from the Cash screen.',
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
    // The server refused the shape of the request, not the operator's data:
    // the command never reached the domain. Measured three times on the iMin
    // D3-504 (2026-10-11) — the inventory blind count, a restock and an
    // exception commit — each time reaching the operator as a sentence with no
    // cause in it and nothing to do next.
    'VALIDATION_FAILED' =>
      spanish
          ? 'El servidor no aceptó el formato de esta operación. Actualiza la pantalla y vuelve a intentarlo; si sigue igual, avisa a soporte.'
          : 'The server did not accept the shape of this operation. Refresh the screen and try again; if it keeps happening, tell support.',
    // One active count per warehouse, whoever opened it. The till that restarted
    // cannot see the count its previous session started, so this is the sentence
    // it gets instead of a 500 (iMin D3-504, 2026-10-11).
    'INVENTORY_COUNT_ALREADY_ACTIVE' =>
      spanish
          ? 'Ya hay un conteo abierto en este almacén. No se puede iniciar otro hasta que se cierre.'
          : 'A count is already open in this warehouse. Another cannot start until it closes.',
    // The rest of the inventory refusals the API has always thrown and the
    // contract did not publish: until they were published the filter re-labelled
    // every one of them `CONFLICT`, so the till answered `La información cambió`
    // to an operator who had done nothing wrong.
    'INVENTORY_VERSION_CHANGED' =>
      spanish
          ? 'La información cambió. Revisa los datos e intenta de nuevo.'
          : 'The information changed. Review it and try again.',
    'INVENTORY_VARIANCE_REASON_REQUIRED' =>
      spanish
          ? 'Cada diferencia necesita un motivo antes de conciliar el conteo.'
          : 'Every variance needs a reason before the count can be reconciled.',
    'INVENTORY_CURSOR_INVALID' =>
      spanish
          ? 'La lista cambió mientras la leías. Vuelve a abrirla.'
          : 'The list changed while you were reading it. Open it again.',
    'DUPLICATE_RESTOCK_COMPONENT' =>
      spanish
          ? 'La reposición llevaba un componente repetido. Vuelve a intentarlo.'
          : 'The restock carried a repeated component. Try again.',
    'PERMISSION_REVOKED' =>
      spanish
          ? 'Tu perfil ya no permite esta operación.'
          : 'Your profile no longer permits this operation.',
    'INSUFFICIENT_BALANCE' =>
      spanish
          ? 'El saldo no cubre este importe.'
          : 'The balance does not cover this amount.',
    'GIFT_CARD_NOT_FOUND' =>
      spanish
          ? 'No se encontró una gift card válida.'
          : 'No valid gift card was found.',
    // One code, three facts: the product is not orderable at this branch, the chosen
    // size or modifiers do not satisfy its menu, or the order moved under the write.
    // The sentence has to be true of all three, and the operator's next move is the
    // same in all three — look at the product again and retry. Measured on the iMin
    // D3-504, 2026-10-11: 28 adds were refused for one product whose availability
    // date had passed, and the till said nothing at all.
    'CART_VALIDATION_FAILED' =>
      spanish
          ? 'No se agregó: el producto no está disponible en esta sucursal o la cuenta cambió. Revisa la pantalla e inténtalo de nuevo.'
          : 'It was not added: the product is unavailable at this branch, or the order changed. Check the screen and try again.',
    // The account the till was holding is no longer the till's to write: it was
    // suspended, committed or cancelled somewhere else — the sales screen, another
    // terminal, the dashboard. `CART_VALIDATION_FAILED` covers this and the product
    // refusal above, and their next moves are opposite, so the till verifies against
    // the server's own read before it decides which one it is holding.
    'CART_ACCOUNT_CLOSED' =>
      spanish
          ? 'Esta cuenta ya se guardó o se cerró desde otra pantalla. La comanda quedó libre: ábrela de nuevo desde Cuentas si quieres seguir con ella.'
          : 'This account was already saved or closed from another screen. The till is free again: reopen it from Accounts to carry on with it.',
    'CART_ACCOUNT_BUSY' =>
      spanish
          ? 'Esta cuenta sigue abierta en otra pantalla. Guárdala allí antes de recuperarla.'
          : 'This account is still open on another screen. Save it there before recovering it.',
    'CART_ACTOR_BUSY' =>
      spanish
          ? 'Ya tienes otra cuenta abierta. Vuelve a Cuentas para retomarla o guardarla.'
          : 'You already have another account open. Return to Accounts to resume or save it.',
    'CART_VERSION_CONFLICT' =>
      spanish
          ? 'La cuenta cambió. Actualízala antes de continuar.'
          : 'The account changed. Refresh it before you continue.',
    'CART_PAYMENT_UNRESOLVED' =>
      spanish
          ? 'Esta cuenta tiene un cobro sin confirmar. Consulta el estado del cobro antes de guardar o recuperar la cuenta.'
          : 'This account has an unconfirmed payment. Check the payment status before saving or recovering the account.',
    'TABLE_HAS_OPEN_ACCOUNT' =>
      spanish
          ? 'Esta mesa tiene una cuenta abierta. Cierra la cuenta antes de liberar, mover o separar la mesa.'
          : 'This table has an open account. Close the account before clearing, moving or splitting the table.',
    'CART_TABLE_ACCOUNT_EXISTS' =>
      spanish
          ? 'Esta mesa ya tiene otra cuenta abierta. Elige otra mesa; tu cuenta conserva sus productos.'
          : 'This table already has another open account. Choose another table; your account keeps its products.',
    'TABLE_NOT_IN_PLAN' =>
      spanish
          ? 'La mesa ya no está en el plano publicado. Actualiza el plano.'
          : 'The table is no longer in the published floor plan. Refresh the map.',
    'KITCHEN_PREPARATION_STARTED' =>
      spanish
          ? 'Cocina ya comenzó la preparación. Solicita ayuda para cancelar este producto.'
          : 'The kitchen started preparation. Ask for help to cancel this product.',
    // A cancel is a same-day act: past the 04:00 cut, the day this account belongs to has
    // been counted, and the answer is not "find a manager" — an elevation does not open a
    // closed day. The operator's two ways out are named, because a bare refusal here gets
    // re-tapped until someone calls support.
    'CART_LINE_DAY_CLOSED' =>
      spanish
          ? 'Esa cuenta es de otro día operativo: sus platillos ya no se cancelan. Cóbrala o resuélvela con el cierre del día.'
          : 'That account belongs to another business day: its items can no longer be cancelled. Charge it, or resolve it with the day close.',
    _ =>
      spanish
          ? 'No se completó la operación. Intenta de nuevo o solicita ayuda.'
          : 'The operation did not finish. Try again or ask for help.',
  };
}
