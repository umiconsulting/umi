import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/recovery_actions.dart';
import 'package:umi_pos/features/offline/recovery_center.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';

void main() {
  testWidgets('Recovery Center exposes localized accessible typed actions', (
    tester,
  ) async {
    final journal = EncryptedOfflineJournal(_Store(), web: false);
    final recovery = OfflineRecoveryController(
      journal: journal,
      gateway: _Gateway(),
      connectivity: ConnectivityController(),
    );
    final executor = _Executor();
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: RecoveryCenter(
            journal: journal,
            recovery: recovery,
            scope: ReplayScope(
              tenantId: _id(1),
              branchId: _id(2),
              operatorSessionId: _id(3),
              credentialVersion: 1,
            ),
            executor: executor,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Centro de recuperación'), findsOneWidget);
    expect(find.text('Sincronizar ahora'), findsOneWidget);
    final semantics = tester.getSemantics(find.text('Sincronizar ahora'));
    expect(semantics.flagsCollection.isButton, isTrue);
    await tester.tap(find.text('Sincronizar ahora'));
    await tester.pump();
    expect(executor.executed, [RecoveryActionKind.synchronize]);
  });

  testWidgets(
    'Recovery Center supports English, text scaling, and keyboard focus',
    (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final journal = EncryptedOfflineJournal(_Store(), web: false);
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: _Gateway(),
        connectivity: ConnectivityController(),
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: RecoveryCenter(
              journal: journal,
              recovery: recovery,
              scope: ReplayScope(
                tenantId: _id(1),
                branchId: _id(2),
                operatorSessionId: _id(3),
                credentialVersion: 1,
              ),
              executor: _Executor(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Recovery Center'), findsOneWidget);
      expect(find.text('Synchronize now'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus, isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Web Recovery Center fails closed without opening the encrypted journal',
    (tester) async {
      final journal = EncryptedOfflineJournal(_Store(), web: true);
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: _Gateway(),
        connectivity: ConnectivityController(),
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: RecoveryCenter(
              journal: journal,
              recovery: recovery,
              scope: ReplayScope(
                tenantId: _id(1),
                branchId: _id(2),
                operatorSessionId: _id(3),
                credentialVersion: 1,
              ),
              executor: _Executor(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(tester.takeException(), isNull);
      expect(
        find.text('La recuperación sin conexión no está disponible en Web'),
        findsOneWidget,
      );
      expect(find.text('Sincronizar ahora'), findsNothing);
    },
  );
}

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _Executor implements RecoveryActionExecutor {
  final executed = <RecoveryActionKind>[];
  @override
  bool canExecute(RecoveryActionKind action) => true;
  @override
  Future<RecoveryActionOutcome> execute(
    RecoveryActionKind action, {
    String? authorizationInput,
  }) async {
    executed.add(action);
    return RecoveryActionOutcome.completed;
  }
}

final class _Store implements JournalCipherStore {
  String? ciphertext;
  String? key;
  @override
  Future<String?> readCiphertext() async => ciphertext;
  @override
  Future<String?> readKey() async => key;
  @override
  Future<void> writeCiphertext(String value) async => ciphertext = value;
  @override
  Future<void> writeKey(String value) async => key = value;
}

final class _Gateway implements ReplayGateway {
  Never _unused() => throw UnimplementedError();
  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async =>
      _unused();
  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) async => _unused();
  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) async => _unused();
  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async => _unused();
  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) async =>
      _unused();
  @override
  Future<OfflinePolicy> policy(ReplayScope scope) async => _unused();
  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) async => _unused();
  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async =>
      _unused();
  @override
  Future<ReplayBatchResult> submit(
    ReplayScope scope,
    ReplayBatch batch,
  ) async => _unused();
}
