import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/offline/recovery_actions.dart';

void main() {
  test('every Gate 2F recovery action has complete typed safe metadata', () {
    final actions = RecoveryActionCatalog.all;
    expect(
      actions.map(RecoveryActionCatalog.kind).toSet(),
      containsAll(RecoveryActionKind.values),
    );
    for (final action in actions) {
      expect(action.titleCode, isNotEmpty);
      expect(action.descriptionCode, isNotEmpty);
      expect(action.diagnosticCode, isNotEmpty);
      expect(action.auditEvent, startsWith('offline.recovery.'));
      expect(action.allowedActor, isNotNull);
      expect(action.severity, isNotNull);
      expect(action.retryPolicy, isNotNull);
    }
  });

  test(
    'raw recovery failures resolve to explicit actions without generic retry',
    () {
      expect(
        RecoveryActionCatalog.kind(
          RecoveryActionCatalog.forFailure('DEVICE_REVOKED').single,
        ),
        RecoveryActionKind.deviceRecovery,
      );
      expect(
        RecoveryActionCatalog.kind(
          RecoveryActionCatalog.forFailure('DEVICE_CREDENTIAL_ROTATED').single,
        ),
        RecoveryActionKind.credentialRecovery,
      );
      expect(
        RecoveryActionCatalog.kind(
          RecoveryActionCatalog.forFailure('ambiguous_payment').single,
        ),
        RecoveryActionKind.queryAmbiguousPayment,
      );
      expect(
        RecoveryActionCatalog.kind(
          RecoveryActionCatalog.forFailure('policy_expired').single,
        ),
        RecoveryActionKind.refreshPolicy,
      );
      expect(
        RecoveryActionCatalog.kind(
          RecoveryActionCatalog.forFailure('pricing_stale').single,
        ),
        RecoveryActionKind.refreshSnapshots,
      );
    },
  );

  test('operator actions fail closed without the required permission', () {
    final synchronize = RecoveryActionCatalog.all.singleWhere(
      (action) =>
          RecoveryActionCatalog.kind(action) == RecoveryActionKind.synchronize,
    );
    expect(
      RecoveryActionCatalog.isAllowed(
        synchronize,
        permissions: const {},
        hasOperator: true,
      ),
      isFalse,
    );
    expect(
      RecoveryActionCatalog.isAllowed(
        synchronize,
        permissions: const {'offline.replay'},
        hasOperator: true,
      ),
      isTrue,
    );
    expect(
      RecoveryActionCatalog.isAllowed(
        synchronize,
        permissions: const {'*'},
        hasOperator: true,
      ),
      isTrue,
    );
  });
}
