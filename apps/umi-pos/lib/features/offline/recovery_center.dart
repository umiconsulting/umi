import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/observability/telemetry.dart';
import '../../core/theme/umi_theme.dart';
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
}) => showModalBottomSheet<void>(
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

  @override
  void initState() {
    super.initState();
    widget.recovery.addListener(_changed);
    _load();
  }

  @override
  void dispose() {
    widget.recovery.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) _load();
  }

  Future<void> _load() async {
    final value = await widget.journal.load();
    if (mounted) setState(() => snapshot = value);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
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
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Semantics(liveRegion: true, child: Text(_statusText(l, status))),
              LinearProgressIndicator(
                value: status.total == 0
                    ? null
                    : status.processed / status.total,
              ),
              const SizedBox(height: UmiSpacing.md),
              Expanded(
                child: entries.isEmpty
                    ? Center(child: Text(l.pendingSalesSecure))
                    : ListView.builder(
                        itemCount: entries.length,
                        itemBuilder: (context, index) {
                          final entry = entries[index];
                          final conflict = entry.failure;
                          return ListTile(
                            leading: Icon(
                              conflict == null
                                  ? Icons.lock_clock_outlined
                                  : Icons.warning_amber_outlined,
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
                            trailing: Text('#${entry.command.deviceSequence}'),
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
                      child: FilledButton.tonalIcon(
                        onPressed:
                            status.phase == RecoveryPhase.replaying ||
                                !widget.executor.canExecute(
                                  RecoveryActionCatalog.kind(action),
                                )
                            ? null
                            : () => _execute(action),
                        icon: Icon(
                          _actionIcon(RecoveryActionCatalog.kind(action)),
                        ),
                        label: Text(
                          _actionTitle(l, RecoveryActionCatalog.kind(action)),
                        ),
                      ),
                    ),
                ],
              ),
              TextButton(
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
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppLocalizations.of(context).recoveryReceiptTitle),
        content: Text(
          entry.officialCommit == null
              ? AppLocalizations.of(context).pendingSalesSecure
              : AppLocalizations.of(context).officialReceiptAvailable,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppLocalizations.of(context).closeAction),
          ),
        ],
      ),
    );
  }

  Future<String?> _managerCredential() async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppLocalizations.of(context).recoveryManagerTitle),
        content: TextField(
          controller: controller,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 12,
          autofocus: true,
          decoration: InputDecoration(
            labelText: AppLocalizations.of(
              context,
            ).recoveryManagerCredentialLabel,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppLocalizations.of(context).closeAction),
          ),
          FilledButton(
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

  IconData _actionIcon(RecoveryActionKind id) => switch (id) {
    RecoveryActionKind.synchronize ||
    RecoveryActionKind.queryResult ||
    RecoveryActionKind.refreshPolicy ||
    RecoveryActionKind.refreshSnapshots => Icons.sync,
    RecoveryActionKind.reauthenticate => Icons.login,
    RecoveryActionKind.reselectBranch => Icons.store_outlined,
    RecoveryActionKind.managerReview => Icons.supervisor_account_outlined,
    RecoveryActionKind.acknowledgeReconciliation => Icons.verified_outlined,
    RecoveryActionKind.viewReceipt => Icons.receipt_long_outlined,
    RecoveryActionKind.queryAmbiguousPayment => Icons.manage_search,
    RecoveryActionKind.deviceRecovery ||
    RecoveryActionKind.credentialRecovery => Icons.phonelink_lock_outlined,
    RecoveryActionKind.storageRecovery => Icons.storage_outlined,
    RecoveryActionKind.contactSupport => Icons.support_agent_outlined,
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

final class AppRecoveryActionExecutor implements RecoveryActionExecutor {
  AppRecoveryActionExecutor({
    required OfflineRecoveryController recovery,
    required ReplayScope scope,
    required EntryController entry,
    required Telemetry telemetry,
    required EncryptedOfflineJournal journal,
    required Future<void> Function() refreshSnapshots,
    required Future<void> Function() queryAmbiguousPayment,
  }) : _recovery = recovery,
       _scope = scope,
       _entry = entry,
       _telemetry = telemetry,
       _journal = journal,
       _refreshSnapshots = refreshSnapshots,
       _queryAmbiguousPayment = queryAmbiguousPayment;

  final OfflineRecoveryController _recovery;
  final ReplayScope _scope;
  final EntryController _entry;
  final Telemetry _telemetry;
  final EncryptedOfflineJournal _journal;
  final Future<void> Function() _refreshSnapshots;
  final Future<void> Function() _queryAmbiguousPayment;

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
          await _entry.logout();
        case RecoveryActionKind.reselectBranch:
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
