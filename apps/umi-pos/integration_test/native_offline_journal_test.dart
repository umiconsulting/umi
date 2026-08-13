import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:umi_pos/core/storage/storage.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('persists an encrypted native cash command', (_) async {
    const commandId = '92000000-0000-4000-8000-000000000101';
    final store = PlatformJournalCipherStore(
      const SharedPreferencesStore(),
      const FlutterSecureKeyValueStorage(),
    );
    final journal = EncryptedOfflineJournal(store, web: false);

    await journal.append(
      commandId: commandId,
      deviceId: '67000000-0000-4000-8000-000000000101',
      credentialVersion: 1,
      merchantId: '10000000-0000-4000-8000-000000000101',
      locationId: '20000000-0000-4000-8000-000000000101',
      operatorSessionId: '30000000-0000-4000-8000-000000000101',
      idempotencyKey: commandId,
      commandType: 'pos.checkout.cash',
      provisionalId: '93000000-0000-4000-8000-000000000101',
      deduplicationKey: 'gate-7a-native-offline',
      maxPendingCashCount: 10,
      maxPendingCashMinorUnits: 100000,
      cashAmountMinorUnits: 4500,
      payload: const {
        'checkoutIdentity': 'gate-7a-native-offline',
        'amountDueMinorUnits': 4500,
      },
    );

    final restored = EncryptedOfflineJournal(store, web: false);
    final snapshot = await restored.load();
    expect(
      snapshot.entries.where((entry) => entry.command.commandId == commandId),
      hasLength(1),
    );
    expect(await store.readCiphertext(), isNot(contains(commandId)));
  });
}
