import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';

Future<void> seedSettledJournalHistory(
  EncryptedOfflineJournal journal, {
  required String deviceId,
  required String merchantId,
  required String locationId,
  required String operatorSessionId,
}) async {
  for (var sequence = 1; sequence <= 250; sequence++) {
    final id =
        '10000000-0000-4000-8000-${sequence.toString().padLeft(12, '0')}';
    final command = await journal.append(
      commandId: id,
      deviceId: deviceId,
      credentialVersion: 1,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      idempotencyKey: id,
      payload: {'history': sequence},
    );
    await journal.apply(
      ReplayResult(
        commandId: id,
        deviceSequence: command.deviceSequence,
        status: sequence.isEven ? 'accepted' : 'duplicate',
        officialId: null,
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      ),
    );
  }
}
