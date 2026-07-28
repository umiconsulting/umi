import 'package:umi_contract/umi_contract.dart';

import 'offline_journal.dart';

abstract interface class ReplayGateway {
  Future<ReplayBatchResult> submit(String tenantId, ReplayBatch batch);
  Future<ReplayResult?> resultFor(String tenantId, String commandId);
}

/// Replays one device sequence at a time. It intentionally has no parallel
/// submission path: a conflict that blocks following commands stops the run.
final class OrderedReplayEngine {
  OrderedReplayEngine(this._journal, this._gateway);
  final EncryptedOfflineJournal _journal;
  final ReplayGateway _gateway;
  bool _running = false;

  Future<int> replay({
    required String tenantId,
    required String replaySessionId,
    int batchSize = 20,
  }) async {
    if (_running) throw const OfflineJournalException('replay_already_running');
    _running = true;
    var accepted = 0;
    try {
      final snapshot = await _journal.load();
      final pending =
          snapshot.entries
              .where((e) => e.status == JournalStatus.pending)
              .toList()
            ..sort(
              (a, b) =>
                  a.command.deviceSequence.compareTo(b.command.deviceSequence),
            );
      for (var offset = 0; offset < pending.length; offset += batchSize) {
        final slice = pending
            .skip(offset)
            .take(batchSize)
            .toList(growable: false);
        final result = await _gateway.submit(
          tenantId,
          ReplayBatch(
            replaySessionId: replaySessionId,
            commands: slice.map((e) => e.command.toJson()).toList(),
          ),
        );
        for (final encoded in result.results) {
          final item = ReplayResult.fromJson(encoded);
          await _journal.apply(item);
          if (item.status == 'accepted' || item.status == 'duplicate') {
            accepted++;
          }
          if (item.failure?['blocksFollowing'] == true) return accepted;
        }
        if (result.stopped) return accepted;
      }
      return accepted;
    } finally {
      _running = false;
    }
  }
}
