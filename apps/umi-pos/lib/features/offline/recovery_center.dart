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

final class OfflineHardwareRecoveryItem {
  const OfflineHardwareRecoveryItem({
    required this.commandId,
    required this.commandType,
    required this.status,
    this.verifyPrint,
    this.controlledReprint,
    this.repeatDrawerOpen,
  });

  final String commandId;
  final String commandType;
  final String status;
  final Future<void> Function()? verifyPrint;
  final Future<void> Function()? controlledReprint;
  final Future<void> Function()? repeatDrawerOpen;
}

final class OfflineHardwareRecoveryResult {
  const OfflineHardwareRecoveryResult(this.items);
  final List<OfflineHardwareRecoveryItem> items;
}

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
  Future<OfflineHardwareRecoveryResult> Function(JournalEntry entry)?
  retryOfflineHardware,
}) => showPosSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => RecoveryCenter(
    journal: journal,
    recovery: recovery,
    scope: scope,
    retryOfflineHardware: retryOfflineHardware,
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
    this.retryOfflineHardware,
    super.key,
  });
  final EncryptedOfflineJournal journal;
  final OfflineRecoveryController recovery;
  final ReplayScope scope;
  final RecoveryActionExecutor executor;
  final Future<OfflineHardwareRecoveryResult> Function(JournalEntry entry)?
  retryOfflineHardware;

  @override
  State<RecoveryCenter> createState() => _RecoveryCenterState();
}

final class _RecoveryCenterState extends State<RecoveryCenter> {
  OfflineJournalSnapshot? snapshot;
  final Set<String> _hardwareRetries = {};

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
    if (mounted && widget.journal.supportsSecureOffline) _load();
  }

  Future<void> _load() async {
    if (!widget.journal.supportsSecureOffline) return;
    final value = await widget.journal.load();
    if (mounted) setState(() => snapshot = value);
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
              const SizedBox(height: UmiSpacing.md),
              Expanded(
                child: entries.isEmpty
                    ? Center(child: Text(l.pendingSalesSecure))
                    : ListView.builder(
                        itemCount: entries.length,
                        itemBuilder: (context, index) {
                          final entry = entries[index];
                          final conflict = entry.failure;
                          final provisionalId = entry.command.provisionalId;
                          final canRetryHardware =
                              widget.retryOfflineHardware != null &&
                              provisionalId != null &&
                              entry.command.commandType == 'pos.checkout.cash';
                          return PosListRow(
                            leading: PosIcon(
                              conflict == null
                                  ? PosGlyphs.lockClockOutlined
                                  : PosGlyphs.warningAmberOutlined,
                            ),
                            title: Text(
                              entry.command.provisionalId ??
                                  '#${entry.command.deviceSequence}',
                            ),
                            subtitle: Text(
                              entry.officialCommit != null
                                  ? l.officialReceiptAvailable
                                  : conflict != null
                                  ? l.conflictNeedsAttention
                                  : l.pendingSalesSecure,
                            ),
                            trailing: canRetryHardware
                                ? Semantics(
                                    button: true,
                                    label:
                                        Localizations.localeOf(
                                              context,
                                            ).languageCode ==
                                            'es'
                                        ? 'Reintentar el hardware de forma segura'
                                        : 'Retry hardware safely',
                                    child: PosIconButton(
                                      tooltip:
                                          Localizations.localeOf(
                                                context,
                                              ).languageCode ==
                                              'es'
                                          ? 'Reintentar el hardware'
                                          : 'Retry hardware',
                                      onPressed:
                                          _hardwareRetries.contains(
                                            provisionalId,
                                          )
                                          ? null
                                          : () => _retryHardware(entry),
                                      icon:
                                          _hardwareRetries.contains(
                                            provisionalId,
                                          )
                                          ? const SizedBox.square(
                                              dimension: 20,
                                              child: PosSpinner(strokeWidth: 2),
                                            )
                                          : const PosIcon(
                                              PosGlyphs.printOutlined,
                                            ),
                                    ),
                                  )
                                : Text('#${entry.command.deviceSequence}'),
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

  Future<void> _execute(RecoveryAction action) async {
    final kind = RecoveryActionCatalog.kind(action);
    String? authorizationInput;
    if (kind == RecoveryActionKind.managerReview) {
      authorizationInput = await _managerCredential();
      if (authorizationInput == null) return;
    }
    final outcome = await widget.executor.execute(
      kind,
      authorizationInput: authorizationInput,
    );
    if (kind == RecoveryActionKind.viewReceipt &&
        outcome == RecoveryActionOutcome.completed) {
      await _showReceiptStatus();
    }
    await _load();
  }

  Future<void> _retryHardware(JournalEntry entry) async {
    final id = entry.command.provisionalId;
    final retry = widget.retryOfflineHardware;
    if (id == null || retry == null || _hardwareRetries.contains(id)) return;
    setState(() => _hardwareRetries.add(id));
    try {
      final result = await retry(entry);
      if (!mounted) return;
      final unknown = result.items
          .where((item) => item.status == 'unknown')
          .toList();
      if (unknown.isNotEmpty) {
        await _showUnknownHardware(unknown);
        return;
      }
      if (result.items.any((item) => item.status != 'succeeded')) {
        final spanish = Localizations.localeOf(context).languageCode == 'es';
        setState(
          () => _notice = spanish
              ? 'El hardware requiere atención.'
              : 'The hardware needs attention.',
        );
        return;
      }
      // No completion bar: the entry leaves the recovery list, which is the
      // list the operator is reading.
    } catch (_) {
      if (!mounted) return;
      final spanish = Localizations.localeOf(context).languageCode == 'es';
      setState(
        () => _notice = spanish
            ? 'El hardware requiere atención.'
            : 'The hardware needs attention.',
      );
    } finally {
      if (mounted) setState(() => _hardwareRetries.remove(id));
    }
  }

  Future<void> _showUnknownHardware(
    List<OfflineHardwareRecoveryItem> items,
  ) async {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    await showPosDialog<void>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(
          spanish ? 'Resultado físico desconocido' : 'Unknown physical result',
        ),
        content: Text(
          spanish
              ? 'Verifica el dispositivo antes de iniciar otra acción.'
              : 'Verify the device before you start another action.',
        ),
        actions: [
          for (final item in items) ...[
            if (item.verifyPrint != null)
              PosTextButton(
                onPressed: () =>
                    _runHardwareAction(dialogContext, item.verifyPrint!),
                child: Text(spanish ? 'Confirmar impresión' : 'Verify print'),
              ),
            if (item.controlledReprint != null)
              PosButton.tonal(
                onPressed: () =>
                    _runHardwareAction(dialogContext, item.controlledReprint!),
                child: Text(spanish ? 'Imprimir una COPIA' : 'Print a COPY'),
              ),
            if (item.repeatDrawerOpen != null)
              PosButton.tonal(
                onPressed: () =>
                    _runHardwareAction(dialogContext, item.repeatDrawerOpen!),
                child: Text(spanish ? 'Abrir otra vez' : 'Open again'),
              ),
          ],
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(spanish ? 'Cerrar' : 'Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _runHardwareAction(
    BuildContext dialogContext,
    Future<void> Function() action,
  ) async {
    Navigator.pop(dialogContext);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    try {
      await action();
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _notice = spanish
            ? 'El resultado físico sigue desconocido.'
            : 'The physical result is still unknown.',
      );
      return;
    }
    if (!mounted) return;
    // No completion bar, same reason as `_retryHardware`: the list is the
    // feedback.
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
      if (entries.any(
        (entry) =>
            entry.officialCommit != null ||
            (entry.command.provisionalId != null &&
                entry.command.commandType == 'pos.checkout.cash'),
      ))
        RecoveryActionKind.viewReceipt,
    };
    return [
      for (final action in RecoveryActionCatalog.all)
        if (kinds.contains(RecoveryActionCatalog.kind(action))) action,
    ];
  }

  Future<void> _showReceiptStatus() async {
    final entries = snapshot?.entries.where(
      (entry) =>
          entry.command.commandType == 'pos.checkout.cash' &&
          entry.command.provisionalId != null,
    );
    if (entries == null || entries.isEmpty) return;
    final entry = entries.last;
    final rawSnapshot = entry.command.payload['snapshot'];
    if (rawSnapshot is! Map<String, Object?>) return;
    final checkoutSnapshot = OfflineCheckoutSnapshot.fromJson(rawSnapshot);
    final cart = Cart.fromJson(checkoutSnapshot.cartSnapshot);
    final totals = TotalsConfirmation.fromJson(checkoutSnapshot.totals);
    final total = totals.totals['grandTotal']! as Map<String, Object?>;
    final official = entry.officialCommit == null
        ? null
        : OfficialCommitResult.fromJson(entry.officialCommit!);
    await showPosDialog<void>(
      context: context,
      builder: (context) => PosAlertDialog(
        title: Text(AppLocalizations.of(context).recoveryReceiptTitle),
        content: SizedBox(
          width: 520,
          child: ListView(
            shrinkWrap: true,
            children: [
              Text(
                official == null
                    ? AppLocalizations.of(context).pendingSalesSecure
                    : AppLocalizations.of(context).officialReceiptAvailable,
              ),
              PosSelectableText(
                official?.officialReceiptNumber ??
                    entry.command.provisionalId ??
                    '#${entry.command.deviceSequence}',
              ),
              const PosDivider(),
              for (final rawLine in cart.items)
                Builder(
                  builder: (_) {
                    final line = CartItem.fromJson(rawLine);
                    return PosListRow(
                      title: Text(line.productName),
                      subtitle: line.variant == null
                          ? null
                          : Text(line.variant!['name'] as String),
                      trailing: Text('${line.quantity}'),
                    );
                  },
                ),
              const PosDivider(),
              Text(
                _receiptMoney(total),
                style: PosTheme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.end,
              ),
            ],
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppLocalizations.of(context).closeAction),
          ),
        ],
      ),
    );
  }

  String _receiptMoney(Map<String, Object?> money) {
    final currency = money['currency'] as String? ?? '';
    final minorUnits = (money['minorUnits'] as num?)?.toInt() ?? 0;
    return formatMinorUnits(minorUnits, currency);
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
                      const PosIcon(
                        PosGlyphs.desktopWindowsOutlined,
                        size: 48,
                      ),
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
