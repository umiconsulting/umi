import 'package:umi_contract/umi_contract.dart';

enum RecoveryActionKind {
  synchronize,
  queryResult,
  refreshPolicy,
  reauthenticate,
  reselectBranch,
  managerReview,
  acknowledgeReconciliation,
  viewReceipt,
  queryAmbiguousPayment,
  deviceRecovery,
  credentialRecovery,
  storageRecovery,
  refreshSnapshots,
  contactSupport,
}

abstract interface class RecoveryActionExecutor {
  bool canExecute(RecoveryActionKind action);
  Future<RecoveryActionOutcome> execute(
    RecoveryActionKind action, {
    String? authorizationInput,
  });
}

enum RecoveryActionOutcome {
  completed,
  denied,
  authorityRequired,
  failedSafely,
}

abstract final class RecoveryActionCatalog {
  static const all = <RecoveryAction>[
    RecoveryAction(
      id: 'synchronize',
      titleCode: 'recoverySynchronizeTitle',
      descriptionCode: 'recoverySynchronizeDescription',
      requiredPermission: 'offline.replay',
      allowedActor: 'operator',
      severity: 'information',
      retryPolicy: 'transport_safe',
      diagnosticCode: 'synchronize',
      auditEvent: 'offline.recovery.synchronize_requested',
    ),
    RecoveryAction(
      id: 'query_result',
      titleCode: 'recoveryQueryTitle',
      descriptionCode: 'recoveryQueryDescription',
      requiredPermission: 'offline.replay',
      allowedActor: 'operator',
      severity: 'warning',
      retryPolicy: 'query_only',
      diagnosticCode: 'query_result',
      auditEvent: 'offline.recovery.result_query_requested',
    ),
    RecoveryAction(
      id: 'refresh_policy',
      titleCode: 'recoveryPolicyTitle',
      descriptionCode: 'recoveryPolicyDescription',
      requiredPermission: 'offline.cash.checkout',
      allowedActor: 'operator',
      severity: 'blocking',
      retryPolicy: 'after_authority',
      diagnosticCode: 'refresh_policy',
      auditEvent: 'offline.recovery.policy_refresh_requested',
    ),
    RecoveryAction(
      id: 'reauthenticate',
      titleCode: 'recoveryAuthenticationTitle',
      descriptionCode: 'recoveryAuthenticationDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'blocking',
      retryPolicy: 'after_authority',
      diagnosticCode: 'reauthenticate',
      auditEvent: 'offline.recovery.reauthentication_requested',
    ),
    RecoveryAction(
      id: 'reselect_branch',
      titleCode: 'recoveryBranchTitle',
      descriptionCode: 'recoveryBranchDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'blocking',
      retryPolicy: 'after_authority',
      diagnosticCode: 'reselect_branch',
      auditEvent: 'offline.recovery.branch_reselection_requested',
    ),
    RecoveryAction(
      id: 'manager_review',
      titleCode: 'recoveryManagerTitle',
      descriptionCode: 'recoveryManagerDescription',
      requiredPermission: 'offline.recovery.review',
      allowedActor: 'manager',
      severity: 'blocking',
      retryPolicy: 'after_authority',
      diagnosticCode: 'manager_review',
      auditEvent: 'offline.recovery.manager_review_requested',
    ),
    RecoveryAction(
      id: 'acknowledge',
      titleCode: 'recoveryAcknowledgeTitle',
      descriptionCode: 'recoveryAcknowledgeDescription',
      requiredPermission: 'offline.replay',
      allowedActor: 'operator',
      severity: 'information',
      retryPolicy: 'never',
      diagnosticCode: 'acknowledge_reconciliation',
      auditEvent: 'offline.recovery.reconciliation_acknowledged',
    ),
    RecoveryAction(
      id: 'view_receipt',
      titleCode: 'recoveryReceiptTitle',
      descriptionCode: 'recoveryReceiptDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'information',
      retryPolicy: 'never',
      diagnosticCode: 'view_receipt',
      auditEvent: 'offline.recovery.receipt_viewed',
    ),
    RecoveryAction(
      id: 'query_ambiguous_payment',
      titleCode: 'recoveryPaymentTitle',
      descriptionCode: 'recoveryPaymentDescription',
      requiredPermission: 'pos.checkout',
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'query_only',
      diagnosticCode: 'query_ambiguous_payment',
      auditEvent: 'offline.recovery.payment_query_requested',
    ),
    RecoveryAction(
      id: 'device_recovery',
      titleCode: 'recoveryDeviceTitle',
      descriptionCode: 'recoveryDeviceDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'never',
      diagnosticCode: 'device_blocked',
      auditEvent: 'offline.recovery.device_recovery_requested',
    ),
    RecoveryAction(
      id: 'credential_recovery',
      titleCode: 'recoveryCredentialTitle',
      descriptionCode: 'recoveryCredentialDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'never',
      diagnosticCode: 'credential_rotated',
      auditEvent: 'offline.recovery.credential_recovery_requested',
    ),
    RecoveryAction(
      id: 'storage_recovery',
      titleCode: 'recoveryStorageTitle',
      descriptionCode: 'recoveryStorageDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'never',
      diagnosticCode: 'storage_recovery',
      auditEvent: 'offline.recovery.storage_recovery_requested',
    ),
    RecoveryAction(
      id: 'refresh_snapshots',
      titleCode: 'recoverySnapshotTitle',
      descriptionCode: 'recoverySnapshotDescription',
      requiredPermission: 'pos.catalog.read',
      allowedActor: 'operator',
      severity: 'blocking',
      retryPolicy: 'after_authority',
      diagnosticCode: 'refresh_snapshots',
      auditEvent: 'offline.recovery.snapshot_refresh_requested',
    ),
    RecoveryAction(
      id: 'contact_support',
      titleCode: 'recoverySupportTitle',
      descriptionCode: 'recoverySupportDescription',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'never',
      diagnosticCode: 'support_required',
      auditEvent: 'offline.recovery.support_requested',
    ),
  ];

  static List<RecoveryAction> forFailure(String? code) {
    final ids = switch (code) {
      'DEVICE_REVOKED' => const [RecoveryActionKind.deviceRecovery],
      'DEVICE_CREDENTIAL_ROTATED' => const [
        RecoveryActionKind.credentialRecovery,
      ],
      'ambiguous_payment' || 'ambiguous_payment_requires_query' => const [
        RecoveryActionKind.queryAmbiguousPayment,
      ],
      'policy_expired' ||
      'policy_invalid' ||
      'policy_missing' => const [RecoveryActionKind.refreshPolicy],
      'catalog_stale' ||
      'pricing_stale' ||
      'tax_stale' => const [RecoveryActionKind.refreshSnapshots],
      'branch_mismatch' => const [RecoveryActionKind.reselectBranch],
      'tenant_mismatch' => const [RecoveryActionKind.reauthenticate],
      'operator_invalid' ||
      'permission_revoked' => const [RecoveryActionKind.reauthenticate],
      'entitlement_disabled' => const [RecoveryActionKind.contactSupport],
      'manager_approval_required' => const [RecoveryActionKind.managerReview],
      'journal_integrity_failed' || 'encryption_key_unavailable' => const [
        RecoveryActionKind.storageRecovery,
      ],
      'fingerprint_mismatch' ||
      'terminal_failure' => const [RecoveryActionKind.contactSupport],
      'price_changed' ||
      'tax_changed' ||
      'availability_changed' ||
      'inventory_unavailable' ||
      'catalog_version_expired' => const [RecoveryActionKind.refreshSnapshots],
      'policy_changed' ||
      'command_expired' => const [RecoveryActionKind.refreshPolicy],
      'reconciliation_required' ||
      'sequence_gap' ||
      'sequence_behind' => const [RecoveryActionKind.synchronize],
      _ => const [RecoveryActionKind.synchronize],
    };
    return [
      for (final id in ids)
        all.singleWhere((action) => action.id == _wireId(id)),
    ];
  }

  static RecoveryActionKind kind(RecoveryAction action) => RecoveryActionKind
      .values
      .singleWhere((candidate) => _wireId(candidate) == action.id);

  static bool isAllowed(
    RecoveryAction action, {
    required Set<String> permissions,
    required bool hasOperator,
  }) {
    if (action.allowedActor == 'manager') return true;
    if (!hasOperator && action.allowedActor == 'operator') return false;
    final required = action.requiredPermission;
    return required == null ||
        permissions.contains('*') ||
        permissions.contains(required);
  }

  static String _wireId(RecoveryActionKind kind) => switch (kind) {
    RecoveryActionKind.queryResult => 'query_result',
    RecoveryActionKind.refreshPolicy => 'refresh_policy',
    RecoveryActionKind.reselectBranch => 'reselect_branch',
    RecoveryActionKind.managerReview => 'manager_review',
    RecoveryActionKind.acknowledgeReconciliation => 'acknowledge',
    RecoveryActionKind.viewReceipt => 'view_receipt',
    RecoveryActionKind.queryAmbiguousPayment => 'query_ambiguous_payment',
    RecoveryActionKind.deviceRecovery => 'device_recovery',
    RecoveryActionKind.credentialRecovery => 'credential_recovery',
    RecoveryActionKind.storageRecovery => 'storage_recovery',
    RecoveryActionKind.refreshSnapshots => 'refresh_snapshots',
    RecoveryActionKind.contactSupport => 'contact_support',
    _ => kind.name,
  };
}
