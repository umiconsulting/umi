import 'package:flutter/services.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/observability/telemetry.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/money.dart';
import '../../shared/widgets/inline_notice.dart';
import '../entry/entry_controller.dart';
import 'offline_journal.dart';
import 'recovery_actions.dart';
import 'replay_engine.dart';

Future<void> showRecoveryCenter(
  BuildContext context, {
  required EncryptedOfflineJournal journal,
  required OfflineRecoveryController recovery,
  required ReplayScope scope,
  required EntryController entry,
  required Telemetry telemetry,
  required Future<void> Function() refreshSnapshots,
  required Future<void> Function() queryAmbiguousPayment,
  Future<bool> Function()? beforeContextExit,
}) => showPosSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => RecoveryCenter(
    journal: journal,
    recovery: recovery,
    scope: scope,
    executor: AppRecoveryActionExecutor(
      recovery: recovery,
      scope: scope,
      entry: entry,
      telemetry: telemetry,
      journal: journal,
      refreshSnapshots: refreshSnapshots,
      queryAmbiguousPayment: queryAmbiguousPayment,
      beforeContextExit: beforeContextExit,
    ),
  ),
);

final class RecoveryCenter extends StatefulWidget {
  const RecoveryCenter({
    required this.journal,
    required this.recovery,
    required this.scope,
    required this.executor,
    super.key,
  });
  final EncryptedOfflineJournal journal;
  final OfflineRecoveryController recovery;
  final ReplayScope scope;
  final RecoveryActionExecutor executor;

  @override
  State<RecoveryCenter> createState() => _RecoveryCenterState();
}

final class _RecoveryCenterState extends State<RecoveryCenter> {
  OfflineJournalSnapshot? snapshot;
  SafeReplayDiagnostic? _diagnostic;
  final Set<String> _conflictRetries = {};
  final Set<String> _conflictResolutions = {};

  /// Why the last hardware retry did not finish, shown above the list it is
  /// about. It used to be a bar at the bottom of the screen, far from the entry
  /// that failed and over the controls underneath it.
  String? _notice;

  @override
  void initState() {
    super.initState();
    widget.recovery.addListener(_changed);
    if (widget.journal.supportsSecureOffline) _load();
  }

  @override
  void dispose() {
    widget.recovery.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    // A recovery status change is local. Reading the journal again is cheap;
    // asking the server for diagnostics on every status change is not — the
    // replay publishes one status per command, which used to turn a 12-command
    // replay into a burst of diagnostic reads against the same bucket.
    if (mounted && widget.journal.supportsSecureOffline) {
      final phase = widget.recovery.status.phase;
      final freshPhase = phase != _lastPhase;
      _lastPhase = phase;
      _load(withDiagnostics: freshPhase);
    }
  }

  RecoveryPhase? _lastPhase;

  Future<void> _load({bool withDiagnostics = true}) async {
    if (!widget.journal.supportsSecureOffline) return;
    final value = await widget.journal.load();
    final diagnostic = withDiagnostics
        ? await widget.recovery.diagnostics(widget.scope)
        : _diagnostic;
    if (mounted) {
      setState(() {
        snapshot = value;
        _diagnostic = diagnostic;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    if (!widget.journal.supportsSecureOffline) {
      return _WebRecoveryUnavailable(localizations: l);
    }
    final status = widget.recovery.status;
    final entries = snapshot?.entries ?? const <JournalEntry>[];
    final actions = _availableActions(status, entries);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .88,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.recoveryCenterTitle,
                style: PosTheme.of(context).textTheme.headlineMedium,
              ),
              Semantics(liveRegion: true, child: Text(_statusText(l, status))),
              PosProgress(
                value: status.total == 0
                    ? null
                    : status.processed / status.total,
              ),
              if (_notice != null) ...[
                const SizedBox(height: UmiSpacing.sm),
                InlineNotice(message: _notice!),
              ],
              if (_diagnostic case final diagnostic?) ...[
                const SizedBox(height: UmiSpacing.sm),
                // What the server believes about this till's queue. Counts and a
                // safe error category, never a token or a payload: enough for
                // support to tell "the till thinks it is behind" from "the
                // server thinks it is ahead".
                Text(
                  Localizations.localeOf(context).languageCode == 'es'
                      ? 'Servidor: ${diagnostic.serverLastAcceptedSequence} · '
                            'aceptadas: ${diagnostic.acceptedCount} · '
                            'conflictos: ${diagnostic.conflictCount} · '
                            'cola: ${diagnostic.queueDepth}'
                      : 'Server: ${diagnostic.serverLastAcceptedSequence} · '
                            'accepted: ${diagnostic.acceptedCount} · '
                            'conflicts: ${diagnostic.conflictCount} · '
                            'queue: ${diagnostic.queueDepth}',
                  style: PosTheme.of(context).textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: UmiSpacing.md),
              Expanded(
                child: entries.isEmpty
                    ? Center(child: Text(l.pendingSalesSecure))
                    : ListView.builder(
                        itemCount: entries.length,
                        itemBuilder: (context, index) {
                          final entry = entries[index];
                          final conflict = entry.failure;
                          final canRetryConflict =
                              entry.status == JournalStatus.conflict &&
                              conflict != null &&
                              conflict['classification'] != 'stream_blocked';
                          final canResolveConflict =
                              entry.status == JournalStatus.conflict &&
                              const {
                                'pos.table.command',
                                'pos.cart.table.set',
                                'pos.command.group',
                                'pos.cart.line.add',
                                'pos.cart.line.update',
                                'pos.cart.line.remove',
                                'pos.cart.fulfillment.set',
                              }.contains(entry.command.commandType);
                          final conflictId = entry.command.commandId;
                          return PosListRow(
                            leading: PosIcon(
                              conflict == null
                                  ? PosGlyphs.lockClockOutlined
                                  : PosGlyphs.warningAmberOutlined,
                            ),
                            // A UUID is not a thing a cashier can recognise, and
                            // "stored securely on this device" repeated on every
                            // row says nothing about which row needs them. The
                            // title names the sale and its amount; the subtitle
                            // says where it stands.
                            title: Text(_entryTitle(entry, l)),
                            subtitle: Text(_entrySubtitle(entry, l)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (canResolveConflict)
                                  Semantics(
                                    button: true,
                                    label:
                                        Localizations.localeOf(
                                              context,
                                            ).languageCode ==
                                            'es'
                                        ? 'Resolver paso rechazado'
                                        : 'Resolve refused step',
                                    child: PosIconButton(
                                      tooltip:
                                          Localizations.localeOf(
                                                context,
                                              ).languageCode ==
                                              'es'
                                          ? 'Resolver paso rechazado'
                                          : 'Resolve refused step',
                                      onPressed:
                                          _conflictResolutions.contains(
                                            conflictId,
                                          )
                                          ? null
                                          : () => _resolveConflict(entry),
                                      icon:
                                          _conflictResolutions.contains(
                                            conflictId,
                                          )
                                          ? const SizedBox.square(
                                              dimension: 20,
                                              child: PosSpinner(strokeWidth: 2),
                                            )
                                          : const PosIcon(
                                              PosGlyphs.verifiedOutlined,
                                            ),
                                    ),
                                  ),
                                if (canRetryConflict)
                                  Semantics(
                                    button: true,
                                    label:
                                        Localizations.localeOf(
                                              context,
                                            ).languageCode ==
                                            'es'
                                        ? 'Reintentar envío'
                                        : 'Retry send',
                                    child: PosIconButton(
                                      tooltip:
                                          Localizations.localeOf(
                                                context,
                                              ).languageCode ==
                                              'es'
                                          ? 'Reintentar envío'
                                          : 'Retry send',
                                      onPressed:
                                          _conflictRetries.contains(conflictId)
                                          ? null
                                          : () => _retryConflict(entry),
                                      icon:
                                          _conflictRetries.contains(conflictId)
                                          ? const SizedBox.square(
                                              dimension: 20,
                                              child: PosSpinner(strokeWidth: 2),
                                            )
                                          : const PosIcon(PosGlyphs.sync),
                                    ),
                                  )
                                else
                                  Text('#${entry.command.deviceSequence}'),
                              ],
                            ),
                          );
                        },
                      ),
              ),
              Wrap(
                spacing: UmiSpacing.sm,
                runSpacing: UmiSpacing.sm,
                children: [
                  for (final action in actions)
                    Semantics(
                      button: true,
                      label: _actionDescription(
                        l,
                        RecoveryActionCatalog.kind(action),
                      ),
                      child: PosButton.tonalIcon(
                        onPressed:
                            status.phase == RecoveryPhase.replaying ||
                                !widget.executor.canExecute(
                                  RecoveryActionCatalog.kind(action),
                                )
                            ? null
                            : () => _execute(action),
                        icon: PosIcon(
                          _actionIcon(RecoveryActionCatalog.kind(action)),
                        ),
                        label: Text(
                          _actionTitle(l, RecoveryActionCatalog.kind(action)),
                        ),
                      ),
                    ),
                ],
              ),
              PosTextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(l.closeAction),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// What the operator is looking at, in the words they use at the counter.
  ///
  /// The journal is ordered by device sequence, so the newest sale is at the
  /// bottom — but the row used to be titled with the provisional UUID, which is
  /// unreadable, and subtitled with the same reassurance on every line. A list
  /// that cannot distinguish "8 cappuccinos, 715 pesos, waiting" from "one item
  /// added" gives the operator no way to decide which row needs them.
  String _entryTitle(JournalEntry entry, AppLocalizations l) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final command = entry.command;
    switch (command.commandType) {
      case 'pos.checkout.cash':
        final label = spanish ? 'Venta en efectivo' : 'Cash sale';
        final amount = _checkoutAmount(command);
        return amount == null ? label : '$label · $amount';
      case 'pos.cart.line.add':
        return spanish ? 'Producto agregado' : 'Item added';
      case 'pos.cart.line.update':
        return spanish ? 'Cantidad actualizada' : 'Quantity updated';
      case 'pos.cart.line.remove':
        return spanish ? 'Producto quitado' : 'Item removed';
      case 'pos.cart.open':
        return spanish ? 'Cuenta abierta' : 'Account opened';
      case 'pos.cart.clear':
        return spanish ? 'Cuenta vaciada' : 'Account cleared';
      case 'pos.cart.prepare':
      case 'pos.cart.fire':
        return spanish ? 'Enviado a cocina' : 'Sent to kitchen';
      case 'pos.cart.fulfillment.set':
        return spanish ? 'Tipo de servicio' : 'Service type';
      default:
        return '#${command.deviceSequence}';
    }
  }

  String? _checkoutAmount(OfflineCommand command) {
    final snapshot = command.payload['snapshot'];
    if (snapshot is! Map<String, Object?>) return null;
    final minor = snapshot['amountDueMinorUnits'];
    if (minor is! num) return null;
    final currency = snapshot['currency'] as String? ?? '';
    return formatMinorUnits(minor.toInt(), currency);
  }

  String _entrySubtitle(JournalEntry entry, AppLocalizations l) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    if (entry.status == JournalStatus.resolved) {
      return spanish
          ? 'Resuelta · historial conservado'
          : 'Resolved · history preserved';
    }
    if (entry.hubDeliveryState == 'queued' &&
        entry.status == JournalStatus.pending) {
      return spanish
          ? 'Guardada en la estación local'
          : 'Saved on the local hub';
    }
    if (entry.hubDeliveryState == 'conflict') {
      return spanish
          ? 'La estación local necesita tu revisión'
          : 'The local hub needs your review';
    }
    // A refused sale has a reason, and the reason is the only thing that tells
    // the operator what to do next. "Requiere tu revisión" over a code the
    // operator never sees is not an answer; these are the answers.
    final reason = _conflictReason(entry.failure, spanish);
    if (reason != null) return reason;
    final status = switch (entry.status) {
      JournalStatus.pending =>
        spanish ? 'Pendiente de envío' : 'Waiting to send',
      JournalStatus.unknown =>
        spanish ? 'Confirmando con el servidor' : 'Confirming with the server',
      JournalStatus.accepted ||
      JournalStatus.duplicate => spanish ? 'Enviada' : 'Sent',
      JournalStatus.conflict =>
        spanish ? 'Requiere tu revisión' : 'Needs your review',
      JournalStatus.resolved => spanish ? 'Resuelta' : 'Resolved',
      _ => spanish ? 'Guardada en este dispositivo' : 'Saved on this device',
    };
    if (entry.officialCommit != null) {
      return '$status · ${l.officialReceiptAvailable}';
    }
    return status;
  }

  String? _conflictReason(Map<String, Object?>? failure, bool spanish) {
    final code = failure?['classification'];
    if (code is! String) return null;
    return switch (code) {
      'table_unavailable' =>
        spanish
            ? 'La mesa ya está ocupada. Elige otra mesa y vuelve a cobrar.'
            : 'That table is taken. Choose another one and ring it again.',
      'cart_mismatch' =>
        spanish
            ? 'La cuenta cambió en otra terminal. Revísala antes de cobrar.'
            : 'The account changed on another terminal. Check it before charging.',
      'stream_blocked' =>
        spanish
            ? 'Un paso anterior de esta cuenta necesita atención. Resuélvelo y vuelve a sincronizar.'
            : 'An earlier step on this account needs attention. Resolve it and synchronize again.',
      'price_changed' =>
        spanish
            ? 'El total cambió. Vuelve a revisar la cuenta y cóbrala de nuevo.'
            : 'The total changed. Re-check the account and charge it again.',
      'offline_limit_exceeded' =>
        spanish
            ? 'Supera el límite de ventas sin conexión. Pide autorización.'
            : 'Over the offline sale limit. Ask for approval.',
      'policy_expired' || 'policy_changed' =>
        spanish
            ? 'La política de ventas sin conexión cambió. Actualízala y reintenta.'
            : 'The offline sales policy changed. Refresh it and retry.',
      'open_cash_shift_required' =>
        spanish
            ? 'Abre la caja antes de cobrar esta venta.'
            : 'Open the drawer before charging this sale.',
      'fingerprint_mismatch' =>
        spanish
            ? 'Esta venta no se puede verificar. Llama a soporte con el código.'
            : 'This sale cannot be verified. Call support with the reference.',
      _ => null,
    };
  }

  Future<void> _execute(RecoveryAction action) async {
    final kind = RecoveryActionCatalog.kind(action);
    String? authorizationInput;
    if (kind == RecoveryActionKind.managerReview) {
      authorizationInput = await _managerCredential();
      if (authorizationInput == null) return;
    }
    await widget.executor.execute(kind, authorizationInput: authorizationInput);
    await _load();
  }

  Future<void> _retryConflict(JournalEntry entry) async {
    final id = entry.command.commandId;
    if (_conflictRetries.contains(id)) return;
    setState(() => _conflictRetries.add(id));
    try {
      await widget.journal.retryConflict(id);
      await widget.recovery.recover(widget.scope);
      if (mounted) await _load();
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _notice = Localizations.localeOf(context).languageCode == 'es'
            ? 'El envío no se pudo reintentar. Intenta de nuevo.'
            : 'The send could not be retried. Try again.',
      );
    } finally {
      if (mounted) setState(() => _conflictRetries.remove(id));
    }
  }

  Future<void> _resolveConflict(JournalEntry entry) async {
    final id = entry.command.commandId;
    if (_conflictResolutions.contains(id)) return;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(
          spanish ? 'Resolver paso rechazado' : 'Resolve refused step',
        ),
        content: Text(
          spanish
              ? 'El paso rechazado quedará en el historial. Los envíos '
                    'bloqueados detrás de él volverán a la cola.'
              : 'The refused step stays in history. Blocked sends behind it '
                    'return to the queue.',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(spanish ? 'Cancelar' : 'Cancel'),
          ),
          PosTextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(spanish ? 'Resolver' : 'Resolve'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _conflictResolutions.add(id));
    try {
      final retried = await widget.recovery.resolveConflict(widget.scope, id);
      if (!mounted) return;
      setState(
        () => _notice = retried > 0
            ? spanish
                  ? 'Paso resuelto. $retried envíos volvieron a la cola.'
                  : 'Step resolved. $retried sends returned to the queue.'
            : null,
      );
      await widget.recovery.recover(widget.scope);
      if (mounted) await _load();
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _notice = spanish
            ? 'El paso no se pudo resolver.'
            : 'The step could not be resolved.',
      );
    } finally {
      if (mounted) setState(() => _conflictResolutions.remove(id));
    }
  }

  List<RecoveryAction> _availableActions(
    RecoveryStatus status,
    List<JournalEntry> entries,
  ) {
    final persistedFailures = entries
        .where((entry) => entry.status == JournalStatus.conflict)
        .map((entry) => entry.lastSafeErrorCategory)
        .whereType<String>();
    final persistedFailure = persistedFailures.isEmpty
        ? null
        : persistedFailures.first;
    final kinds = <RecoveryActionKind>{
      for (final action in RecoveryActionCatalog.forFailure(
        status.errorCode ?? persistedFailure,
      ))
        RecoveryActionCatalog.kind(action),
      if (entries.any((entry) => entry.status == JournalStatus.unknown))
        RecoveryActionKind.queryResult,
      if (widget.recovery.reconciliationId != null)
        RecoveryActionKind.acknowledgeReconciliation,
    };
    return [
      for (final action in RecoveryActionCatalog.all)
        if (kinds.contains(RecoveryActionCatalog.kind(action))) action,
    ];
  }

  Future<String?> _managerCredential() async {
    final controller = TextEditingController();
    final value = await showPosDialog<String>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(AppLocalizations.of(context).recoveryManagerTitle),
        content: PosField(
          controller: controller,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 12,
          autofocus: true,
          decoration: PosFieldDecoration(
            labelText: AppLocalizations.of(
              context,
            ).recoveryManagerCredentialLabel,
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppLocalizations.of(context).closeAction),
          ),
          PosButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: Text(AppLocalizations.of(context).confirmAction),
          ),
        ],
      ),
    );
    controller.dispose();
    return value == null || value.isEmpty ? null : value;
  }

  String _actionTitle(AppLocalizations l, RecoveryActionKind id) =>
      switch (id) {
        RecoveryActionKind.synchronize => l.synchronizeNowAction,
        RecoveryActionKind.queryResult => l.recoveryQueryTitle,
        RecoveryActionKind.refreshPolicy => l.recoveryPolicyTitle,
        RecoveryActionKind.reauthenticate => l.recoveryAuthenticationTitle,
        RecoveryActionKind.reselectBranch => l.recoveryBranchTitle,
        RecoveryActionKind.managerReview => l.recoveryManagerTitle,
        RecoveryActionKind.acknowledgeReconciliation =>
          l.recoveryAcknowledgeTitle,
        RecoveryActionKind.viewReceipt => l.recoveryReceiptTitle,
        RecoveryActionKind.queryAmbiguousPayment => l.recoveryPaymentTitle,
        RecoveryActionKind.deviceRecovery => l.recoveryDeviceTitle,
        RecoveryActionKind.credentialRecovery => l.recoveryCredentialTitle,
        RecoveryActionKind.storageRecovery => l.recoveryStorageTitle,
        RecoveryActionKind.refreshSnapshots => l.recoverySnapshotTitle,
        RecoveryActionKind.contactSupport => l.recoverySupportTitle,
      };

  String _actionDescription(
    AppLocalizations l,
    RecoveryActionKind id,
  ) => switch (id) {
    RecoveryActionKind.synchronize => l.synchronizingPendingSales,
    RecoveryActionKind.queryResult => l.recoveryQueryDescription,
    RecoveryActionKind.refreshPolicy => l.recoveryPolicyDescription,
    RecoveryActionKind.reauthenticate => l.recoveryAuthenticationDescription,
    RecoveryActionKind.reselectBranch => l.recoveryBranchDescription,
    RecoveryActionKind.managerReview => l.recoveryManagerDescription,
    RecoveryActionKind.acknowledgeReconciliation =>
      l.recoveryAcknowledgeDescription,
    RecoveryActionKind.viewReceipt => l.recoveryReceiptDescription,
    RecoveryActionKind.queryAmbiguousPayment => l.recoveryPaymentDescription,
    RecoveryActionKind.deviceRecovery => l.recoveryDeviceDescription,
    RecoveryActionKind.credentialRecovery => l.recoveryCredentialDescription,
    RecoveryActionKind.storageRecovery => l.recoveryStorageDescription,
    RecoveryActionKind.refreshSnapshots => l.recoverySnapshotDescription,
    RecoveryActionKind.contactSupport => l.recoverySupportDescription,
  };

  PosGlyph _actionIcon(RecoveryActionKind id) => switch (id) {
    RecoveryActionKind.synchronize ||
    RecoveryActionKind.queryResult ||
    RecoveryActionKind.refreshPolicy ||
    RecoveryActionKind.refreshSnapshots => PosGlyphs.sync,
    RecoveryActionKind.reauthenticate => PosGlyphs.login,
    RecoveryActionKind.reselectBranch => PosGlyphs.storeOutlined,
    RecoveryActionKind.managerReview => PosGlyphs.supervisorAccountOutlined,
    RecoveryActionKind.acknowledgeReconciliation => PosGlyphs.verifiedOutlined,
    RecoveryActionKind.viewReceipt => PosGlyphs.receiptLongOutlined,
    RecoveryActionKind.queryAmbiguousPayment => PosGlyphs.manageSearch,
    RecoveryActionKind.deviceRecovery ||
    RecoveryActionKind.credentialRecovery => PosGlyphs.phonelinkLockOutlined,
    RecoveryActionKind.storageRecovery => PosGlyphs.storageOutlined,
    RecoveryActionKind.contactSupport => PosGlyphs.supportAgentOutlined,
  };

  String _statusText(AppLocalizations l, RecoveryStatus status) {
    if (status.conflicts > 0 ||
        status.phase == RecoveryPhase.blockedByConflict) {
      return l.conflictNeedsAttention;
    }
    if (status.phase == RecoveryPhase.replaying) {
      return '${l.synchronizingPendingSales} '
          '${status.processed} / ${status.total}';
    }
    return l.pendingSalesSecure;
  }
}

final class _WebRecoveryUnavailable extends StatelessWidget {
  const _WebRecoveryUnavailable({required this.localizations});

  final AppLocalizations localizations;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SizedBox(
      height: MediaQuery.sizeOf(context).height * .88,
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              localizations.recoveryCenterTitle,
              style: PosTheme.of(context).textTheme.headlineMedium,
            ),
            Expanded(
              child: Center(
                child: Semantics(
                  liveRegion: true,
                  label: localizations.recoveryWebUnsupportedTitle,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const PosIcon(PosGlyphs.desktopWindowsOutlined, size: 48),
                      const SizedBox(height: UmiSpacing.md),
                      Text(
                        localizations.recoveryWebUnsupportedTitle,
                        style: PosTheme.of(context).textTheme.titleLarge,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: UmiSpacing.sm),
                      Text(
                        localizations.recoveryWebUnsupportedBody,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            PosTextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(localizations.closeAction),
            ),
          ],
        ),
      ),
    ),
  );
}

final class AppRecoveryActionExecutor implements RecoveryActionExecutor {
  AppRecoveryActionExecutor({
    required OfflineRecoveryController recovery,
    required ReplayScope scope,
    required EntryController entry,
    required Telemetry telemetry,
    required EncryptedOfflineJournal journal,
    required Future<void> Function() refreshSnapshots,
    required Future<void> Function() queryAmbiguousPayment,
    Future<bool> Function()? beforeContextExit,
  }) : _recovery = recovery,
       _scope = scope,
       _entry = entry,
       _telemetry = telemetry,
       _journal = journal,
       _refreshSnapshots = refreshSnapshots,
       _queryAmbiguousPayment = queryAmbiguousPayment,
       _beforeContextExit = beforeContextExit;

  final OfflineRecoveryController _recovery;
  final ReplayScope _scope;
  final EntryController _entry;
  final Telemetry _telemetry;
  final EncryptedOfflineJournal _journal;
  final Future<void> Function() _refreshSnapshots;
  final Future<void> Function() _queryAmbiguousPayment;
  final Future<bool> Function()? _beforeContextExit;

  @override
  bool canExecute(RecoveryActionKind action) {
    final descriptor = RecoveryActionCatalog.all.singleWhere(
      (candidate) => RecoveryActionCatalog.kind(candidate) == action,
    );
    final operator = _entry.state.operator;
    return RecoveryActionCatalog.isAllowed(
      descriptor,
      permissions: operator?.permissions.toSet() ?? const {},
      hasOperator: operator != null,
    );
  }

  @override
  Future<RecoveryActionOutcome> execute(
    RecoveryActionKind action, {
    String? authorizationInput,
  }) async {
    final descriptor = RecoveryActionCatalog.all.singleWhere(
      (candidate) => RecoveryActionCatalog.kind(candidate) == action,
    );
    if (!canExecute(action)) {
      await _journal.recordRecoveryAction(descriptor, 'denied');
      return RecoveryActionOutcome.denied;
    }
    _telemetry.event(
      ClientEvent(
        name: descriptor.auditEvent,
        values: {'diagnosticCode': descriptor.diagnosticCode},
      ),
    );
    try {
      switch (action) {
        case RecoveryActionKind.reauthenticate:
          if (_beforeContextExit != null && !await _beforeContextExit()) {
            await _journal.recordRecoveryAction(
              descriptor,
              'sale_transition_failed',
            );
            return RecoveryActionOutcome.failedSafely;
          }
          await _entry.logout();
        case RecoveryActionKind.reselectBranch:
          if (_beforeContextExit != null && !await _beforeContextExit()) {
            await _journal.recordRecoveryAction(
              descriptor,
              'sale_transition_failed',
            );
            return RecoveryActionOutcome.failedSafely;
          }
          await _entry.reselectBranch();
        case RecoveryActionKind.managerReview:
          if (authorizationInput == null ||
              !await _entry.requestRecoveryManagerReview(authorizationInput)) {
            await _journal.recordRecoveryAction(
              descriptor,
              'authority_required',
            );
            return RecoveryActionOutcome.authorityRequired;
          }
          await _recovery.recover(_scope);
        case RecoveryActionKind.acknowledgeReconciliation:
          await _recovery.acknowledgeReconciliation(_scope);
        case RecoveryActionKind.deviceRecovery:
        case RecoveryActionKind.credentialRecovery:
          await _entry.initialize();
        case RecoveryActionKind.storageRecovery:
        case RecoveryActionKind.contactSupport:
          await Clipboard.setData(
            ClipboardData(text: _recovery.status.errorCode ?? 'offline'),
          );
        case RecoveryActionKind.viewReceipt:
          break;
        case RecoveryActionKind.synchronize:
          await _recovery.recover(_scope);
        case RecoveryActionKind.queryResult:
          await _recovery.queryUnknownResults(_scope);
        case RecoveryActionKind.refreshPolicy:
          await _recovery.refreshPolicy(_scope);
        case RecoveryActionKind.queryAmbiguousPayment:
          await _queryAmbiguousPayment();
        case RecoveryActionKind.refreshSnapshots:
          await _refreshSnapshots();
      }
    } on Object {
      await _journal.recordRecoveryAction(descriptor, 'failed_safely');
      return RecoveryActionOutcome.failedSafely;
    }
    await _journal.recordRecoveryAction(descriptor, 'completed');
    return RecoveryActionOutcome.completed;
  }
}
