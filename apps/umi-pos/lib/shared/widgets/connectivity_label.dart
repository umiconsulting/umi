import 'package:flutter/material.dart';

import '../../features/offline/connectivity_controller.dart';

/// What the till says about its connection, in one place.
///
/// It lived in `catalog_surface.dart` as a private function, which was fine while
/// the catalog was the only screen that showed it. The kitchen board needs the
/// same words — a board whose poll and wake-up are both failing is a board showing
/// a kitchen that stopped existing, and a cook has to be able to tell that apart
/// from a quiet service — so the mapping is here, once, rather than copied.
String connectivityLabel(BuildContext context, PosConnectivity state) {
  final spanish = Localizations.localeOf(context).languageCode == 'es';
  return switch (state) {
    PosConnectivity.unknown =>
      spanish ? 'Conexión desconocida' : 'Connection unknown',
    PosConnectivity.online => spanish ? 'En línea' : 'Online',
    PosConnectivity.degraded => spanish ? 'Conexión inestable' : 'Degraded',
    PosConnectivity.offline => spanish ? 'Sin conexión' : 'Offline',
    PosConnectivity.recovering =>
      spanish ? 'Recuperando conexión' : 'Recovering',
    PosConnectivity.replaying => spanish ? 'Sincronizando' : 'Synchronizing',
    PosConnectivity.reconciliationRequired =>
      spanish ? 'Revisión necesaria' : 'Review required',
    PosConnectivity.blocked => spanish ? 'Operación bloqueada' : 'Blocked',
  };
}

/// Whether this state is worth showing on a screen that is otherwise about work.
///
/// `online` is the absence of a warning rather than a badge: a chip that always
/// says "En línea" is noise on a rail a cook reads twenty times a minute, and the
/// design law asks for the OFFLINE state to be visible, not for the online one to
/// be announced.
bool showsConnectivityWarning(PosConnectivity state) =>
    state != PosConnectivity.online;
