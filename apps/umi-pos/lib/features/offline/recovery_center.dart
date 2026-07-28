import 'package:flutter/material.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'offline_journal.dart';
import 'replay_engine.dart';

Future<void> showRecoveryCenter(
  BuildContext context, {
  required EncryptedOfflineJournal journal,
  required OfflineRecoveryController recovery,
  required ReplayScope scope,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) =>
      _RecoveryCenter(journal: journal, recovery: recovery, scope: scope),
);

final class _RecoveryCenter extends StatefulWidget {
  const _RecoveryCenter({
    required this.journal,
    required this.recovery,
    required this.scope,
  });
  final EncryptedOfflineJournal journal;
  final OfflineRecoveryController recovery;
  final ReplayScope scope;

  @override
  State<_RecoveryCenter> createState() => _RecoveryCenterState();
}

final class _RecoveryCenterState extends State<_RecoveryCenter> {
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
              FilledButton.icon(
                onPressed: status.phase == RecoveryPhase.replaying
                    ? null
                    : () => widget.recovery.recover(widget.scope),
                icon: const Icon(Icons.sync),
                label: Text(l.synchronizeNowAction),
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
