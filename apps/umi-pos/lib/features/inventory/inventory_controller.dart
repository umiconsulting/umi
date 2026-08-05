import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'inventory_repository.dart';

final class InventoryScope {
  const InventoryScope({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
  });
  final String merchantId;
  final String locationId;
  final String operatorSessionId;
}

typedef InventoryCommandSeed = ({
  String locationId,
  String inventoryLocationId,
  String operatorSessionId,
  String commandId,
  String idempotencyKey,
  int expectedVersion,
  String policyFingerprint,
  String? approvalId,
  String? approvalFingerprint,
  String businessDate,
});

final class InventoryUiState {
  const InventoryUiState({
    this.busy = false,
    this.overview,
    this.history,
    this.count,
    this.pendingReconciliation,
    this.pendingOperation,
    this.approvalPermission,
    this.approvalFingerprint,
    this.errorCode,
  });
  final bool busy;
  final InventoryOverview? overview;
  final InventoryHistoryResult? history;
  final InventoryCountResult? count;
  final InventoryReconciliation? pendingReconciliation;
  final Object? pendingOperation;
  final String? approvalPermission;
  final String? approvalFingerprint;
  final String? errorCode;
}

final class InventoryController extends ChangeNotifier {
  InventoryController(this._repository);
  final InventoryRepository _repository;
  InventoryUiState _state = const InventoryUiState();
  InventoryUiState get state => _state;

  Future<void> load(InventoryScope scope) async {
    _set(
      InventoryUiState(
        busy: true,
        overview: _state.overview,
        history: _state.history,
        count: _state.count,
        pendingReconciliation: _state.pendingReconciliation,
        approvalPermission: _state.approvalPermission,
        approvalFingerprint: _state.approvalFingerprint,
      ),
    );
    try {
      final query = InventoryQuery(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        limit: 100,
      );
      final results = await Future.wait([
        _loadCompleteOverview(scope, query),
        _repository.history(scope.merchantId, query),
      ]);
      final overview = results[0] as InventoryOverview;
      _set(
        InventoryUiState(
          overview: overview,
          history: results[1] as InventoryHistoryResult,
          count:
              _state.count ??
              (overview.activeCount == null
                  ? null
                  : InventoryCountResult.fromJson(overview.activeCount!)),
          pendingReconciliation: _state.pendingReconciliation,
          approvalPermission: _state.approvalPermission,
          approvalFingerprint: _state.approvalFingerprint,
        ),
      );
    } on AppException catch (error) {
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: _state.history,
          count: _state.count,
          pendingReconciliation: _state.pendingReconciliation,
          approvalPermission: _state.approvalPermission,
          approvalFingerprint: _state.approvalFingerprint,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<InventoryOverview> _loadCompleteOverview(
    InventoryScope scope,
    InventoryQuery firstQuery,
  ) async {
    var page = await _repository.overview(scope.merchantId, firstQuery);
    final items = [...page.items];
    final balances = [...page.balances];
    while (page.page['hasMore'] == true) {
      final cursor = page.page['nextCursor'] as String?;
      if (cursor == null) break;
      page = await _repository.overview(
        scope.merchantId,
        InventoryQuery(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          cursor: cursor,
          limit: 100,
        ),
      );
      items.addAll(page.items);
      balances.addAll(page.balances);
    }
    return InventoryOverview(
      policy: page.policy,
      locations: page.locations,
      items: items,
      balances: balances,
      restockReviews: page.restockReviews,
      activeCount: page.activeCount,
      page: page.page,
    );
  }

  Future<void> loadMoreHistory(InventoryScope scope) async {
    final current = _state.history;
    final cursor = current?.page['nextCursor'] as String?;
    if (current == null || cursor == null || _state.busy) return;
    _set(
      InventoryUiState(
        busy: true,
        overview: _state.overview,
        history: current,
        count: _state.count,
      ),
    );
    try {
      final page = await _repository.history(
        scope.merchantId,
        InventoryQuery(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          cursor: cursor,
          limit: 100,
        ),
      );
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: InventoryHistoryResult(
            entries: [...current.entries, ...page.entries],
            page: page.page,
          ),
          count: _state.count,
        ),
      );
    } on AppException catch (error) {
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: current,
          count: _state.count,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> adjust(
    InventoryScope scope, {
    required Map<String, Object?> item,
    required String direction,
    required int quantity,
    String? approvalId,
    String? approvalFingerprint,
  }) {
    final seed = _command(scope, item, approvalId, approvalFingerprint);
    return _mutate(
      scope,
      InventoryAdjustment(
        locationId: seed.locationId,
        inventoryLocationId: seed.inventoryLocationId,
        operatorSessionId: seed.operatorSessionId,
        commandId: seed.commandId,
        idempotencyKey: seed.idempotencyKey,
        expectedVersion: seed.expectedVersion,
        policyFingerprint: seed.policyFingerprint,
        approvalId: seed.approvalId,
        approvalFingerprint: seed.approvalFingerprint,
        businessDate: seed.businessDate,
        inventoryItemId: item['id']! as String,
        direction: direction,
        quantity: _quantity(item, quantity),
        reason: 'operational_correction',
      ),
      (command) => _repository.adjust(scope.merchantId, command),
    );
  }

  Future<void> recordWaste(
    InventoryScope scope, {
    required Map<String, Object?> item,
    required int quantity,
  }) {
    final seed = _command(scope, item, null, null);
    return _mutate(
      scope,
      WasteRecord(
        locationId: seed.locationId,
        inventoryLocationId: seed.inventoryLocationId,
        operatorSessionId: seed.operatorSessionId,
        commandId: seed.commandId,
        idempotencyKey: seed.idempotencyKey,
        expectedVersion: seed.expectedVersion,
        policyFingerprint: seed.policyFingerprint,
        businessDate: seed.businessDate,
        inventoryItemId: item['id']! as String,
        quantity: _quantity(item, quantity),
        reason: 'operational_loss',
      ),
      (command) => _repository.waste(scope.merchantId, command),
    );
  }

  Future<void> recordDamage(
    InventoryScope scope, {
    required Map<String, Object?> item,
    required int quantity,
  }) {
    final seed = _command(scope, item, null, null);
    return _mutate(
      scope,
      DamageRecord(
        locationId: seed.locationId,
        inventoryLocationId: seed.inventoryLocationId,
        operatorSessionId: seed.operatorSessionId,
        commandId: seed.commandId,
        idempotencyKey: seed.idempotencyKey,
        expectedVersion: seed.expectedVersion,
        policyFingerprint: seed.policyFingerprint,
        businessDate: seed.businessDate,
        inventoryItemId: item['id']! as String,
        quantity: _quantity(item, quantity),
        reason: 'damaged',
        disposition: 'quarantine',
      ),
      (command) => _repository.damage(scope.merchantId, command),
    );
  }

  Future<void> returnFromQuarantine(
    InventoryScope scope, {
    required Map<String, Object?> item,
    required int quantity,
  }) {
    final seed = _command(scope, item, null, null);
    return _mutate(
      scope,
      QuarantineRecord(
        locationId: seed.locationId,
        inventoryLocationId: seed.inventoryLocationId,
        operatorSessionId: seed.operatorSessionId,
        commandId: seed.commandId,
        idempotencyKey: seed.idempotencyKey,
        expectedVersion: seed.expectedVersion,
        policyFingerprint: seed.policyFingerprint,
        businessDate: seed.businessDate,
        inventoryItemId: item['id']! as String,
        quantity: _quantity(item, quantity),
        action: 'return_to_available',
        reason: 'inspection_passed',
      ),
      (command) => _repository.quarantine(scope.merchantId, command),
    );
  }

  Future<void> startCount(InventoryScope scope) async {
    final overview = _state.overview;
    if (overview == null || overview.locations.isEmpty) return;
    final location = overview.locations.first;
    final id = _uuid();
    final command = CreateInventoryCountRequest(
      locationId: scope.locationId,
      inventoryLocationId: location['id']! as String,
      operatorSessionId: scope.operatorSessionId,
      commandId: id,
      idempotencyKey: _uuid(),
      expectedVersion: (location['version']! as num).toInt(),
      policyFingerprint: overview.policy['fingerprint']! as String,
      businessDate: _businessDate(),
      scope: 'full_location',
    );
    _set(
      InventoryUiState(busy: true, overview: overview, history: _state.history),
    );
    try {
      final result = await _repository.createCount(scope.merchantId, command);
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: result,
        ),
      );
    } on AppException catch (error) {
      final recovered = error.recoverable
          ? await _recoverCount(scope, command.commandId)
          : null;
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: recovered ?? _state.count,
          errorCode: recovered == null ? error.code : null,
        ),
      );
    }
  }

  Future<void> submitCount(
    InventoryScope scope,
    Map<String, int> quantities,
  ) async {
    final overview = _state.overview;
    final current = _state.count;
    if (overview == null || current == null) return;
    final count = current.count;
    final command = SubmitInventoryCountRequest(
      locationId: scope.locationId,
      inventoryLocationId: count['inventoryLocationId']! as String,
      operatorSessionId: scope.operatorSessionId,
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      expectedVersion: (count['attempt']! as num).toInt(),
      policyFingerprint: overview.policy['fingerprint']! as String,
      businessDate: _businessDate(),
      countId: count['id']! as String,
      attempt: (count['attempt']! as num).toInt(),
      snapshotLedgerSequence: (count['snapshotLedgerSequence']! as num).toInt(),
      lines: overview.items
          .where((item) => quantities.containsKey(item['id']))
          .map(
            (item) => {
              'inventoryItemId': item['id'],
              'counted': _quantity(item, quantities[item['id']]!),
              'note': null,
            },
          )
          .toList(),
    );
    _set(
      InventoryUiState(
        busy: true,
        overview: overview,
        history: _state.history,
        count: current,
      ),
    );
    try {
      final result = await _repository.submitCount(scope.merchantId, command);
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: result,
        ),
      );
    } on AppException catch (error) {
      final recovered = error.recoverable
          ? await _recoverCount(scope, command.commandId)
          : null;
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: recovered ?? current,
          errorCode: recovered == null ? error.code : null,
        ),
      );
    }
  }

  Future<void> reconcileCount(
    InventoryScope scope,
    Map<String, String> reasons,
  ) async {
    final overview = _state.overview;
    final current = _state.count;
    if (overview == null || current == null) return;
    final count = current.count;
    final command = InventoryReconciliation(
      locationId: scope.locationId,
      inventoryLocationId: count['inventoryLocationId']! as String,
      operatorSessionId: scope.operatorSessionId,
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      expectedVersion: (count['attempt']! as num).toInt(),
      policyFingerprint: overview.policy['fingerprint']! as String,
      businessDate: _businessDate(),
      countId: count['id']! as String,
      countAttempt: (count['attempt']! as num).toInt(),
      snapshotLedgerSequence: (count['snapshotLedgerSequence']! as num).toInt(),
      reasons: reasons,
    );
    _set(
      InventoryUiState(
        busy: true,
        overview: overview,
        history: _state.history,
        count: current,
      ),
    );
    try {
      final result = await _repository.reconcileCount(
        scope.merchantId,
        command,
      );
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: result,
        ),
      );
      await load(scope);
    } on AppException catch (error) {
      final recovered = error.recoverable
          ? await _recoverCount(scope, command.commandId)
          : null;
      if (recovered != null) {
        _set(
          InventoryUiState(
            overview: overview,
            history: _state.history,
            count: recovered,
          ),
        );
        await load(scope);
        return;
      }
      final fields = error.fieldErrors;
      final fingerprint =
          (fields?['approvalFingerprint'] as List<Object?>?)?.firstOrNull
              as String?;
      final permission =
          (fields?['approvalPermission'] as List<Object?>?)?.firstOrNull
              as String?;
      _set(
        InventoryUiState(
          overview: overview,
          history: _state.history,
          count: current,
          errorCode: error.code,
          pendingReconciliation: error.code == 'APPROVAL_REQUIRED'
              ? command
              : null,
          approvalPermission: permission,
          approvalFingerprint: fingerprint,
        ),
      );
    }
  }

  Future<void> approveReconciliation(
    InventoryScope scope,
    String approvalId,
  ) async {
    final pending = _state.pendingReconciliation;
    final fingerprint = _state.approvalFingerprint;
    if (pending == null || fingerprint == null) return;
    _set(
      InventoryUiState(
        busy: true,
        overview: _state.overview,
        history: _state.history,
        count: _state.count,
      ),
    );
    try {
      final result = await _repository.reconcileCount(
        scope.merchantId,
        InventoryReconciliation(
          locationId: pending.locationId,
          inventoryLocationId: pending.inventoryLocationId,
          operatorSessionId: pending.operatorSessionId,
          commandId: pending.commandId,
          idempotencyKey: pending.idempotencyKey,
          expectedVersion: pending.expectedVersion,
          policyFingerprint: pending.policyFingerprint,
          approvalId: approvalId,
          approvalFingerprint: fingerprint,
          businessDate: pending.businessDate,
          countId: pending.countId,
          countAttempt: pending.countAttempt,
          snapshotLedgerSequence: pending.snapshotLedgerSequence,
          reasons: pending.reasons,
        ),
      );
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: _state.history,
          count: result,
        ),
      );
      await load(scope);
    } on AppException catch (error) {
      final recovered = error.recoverable
          ? await _recoverCount(scope, pending.commandId)
          : null;
      if (recovered != null) {
        _set(
          InventoryUiState(
            overview: _state.overview,
            history: _state.history,
            count: recovered,
          ),
        );
        await load(scope);
        return;
      }
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: _state.history,
          count: _state.count,
          pendingReconciliation: pending,
          approvalPermission: _state.approvalPermission,
          approvalFingerprint: fingerprint,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> resolveRestock(
    InventoryScope scope,
    Map<String, Object?> review,
    Map<String, String> outcomes, {
    String? approvalId,
    String? approvalFingerprint,
  }) {
    final overview = _state.overview!;
    final command = RestockCommand(
      locationId: scope.locationId,
      inventoryLocationId: overview.locations.first['id']! as String,
      operatorSessionId: scope.operatorSessionId,
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      expectedVersion: (review['version']! as num).toInt(),
      policyFingerprint: overview.policy['fingerprint']! as String,
      approvalId: approvalId,
      approvalFingerprint: approvalFingerprint,
      businessDate: _businessDate(),
      restockIntentId: review['restockIntentId']! as String,
      componentDecisions: (review['components']! as List<Object?>)
          .cast<Map<String, Object?>>()
          .map((component) {
            final itemId = component['inventoryItemId']! as String;
            final outcome = outcomes[itemId] ?? 'not_restocked';
            return {
              'inventoryItemId': itemId,
              'outcome': outcome,
              'quantity': outcome == 'not_restocked'
                  ? null
                  : component['maximum'],
            };
          })
          .toList(),
    );
    return _mutate(
      scope,
      command,
      (value) => _repository.restock(scope.merchantId, value),
    );
  }

  Future<void> approvePendingOperation(
    InventoryScope scope,
    String approvalId,
  ) async {
    final pending = _state.pendingOperation;
    final fingerprint = _state.approvalFingerprint;
    if (pending == null || fingerprint == null) return;
    switch (pending) {
      case final InventoryAdjustment command:
        await _mutate(
          scope,
          InventoryAdjustment(
            locationId: command.locationId,
            inventoryLocationId: command.inventoryLocationId,
            operatorSessionId: command.operatorSessionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            expectedVersion: command.expectedVersion,
            policyFingerprint: command.policyFingerprint,
            approvalId: approvalId,
            approvalFingerprint: fingerprint,
            businessDate: command.businessDate,
            inventoryItemId: command.inventoryItemId,
            direction: command.direction,
            quantity: command.quantity,
            reason: command.reason,
            note: command.note,
          ),
          (value) => _repository.adjust(scope.merchantId, value),
        );
      case final WasteRecord command:
        await _mutate(
          scope,
          WasteRecord(
            locationId: command.locationId,
            inventoryLocationId: command.inventoryLocationId,
            operatorSessionId: command.operatorSessionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            expectedVersion: command.expectedVersion,
            policyFingerprint: command.policyFingerprint,
            approvalId: approvalId,
            approvalFingerprint: fingerprint,
            businessDate: command.businessDate,
            inventoryItemId: command.inventoryItemId,
            quantity: command.quantity,
            reason: command.reason,
            note: command.note,
          ),
          (value) => _repository.waste(scope.merchantId, value),
        );
      case final DamageRecord command:
        await _mutate(
          scope,
          DamageRecord(
            locationId: command.locationId,
            inventoryLocationId: command.inventoryLocationId,
            operatorSessionId: command.operatorSessionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            expectedVersion: command.expectedVersion,
            policyFingerprint: command.policyFingerprint,
            approvalId: approvalId,
            approvalFingerprint: fingerprint,
            businessDate: command.businessDate,
            inventoryItemId: command.inventoryItemId,
            quantity: command.quantity,
            reason: command.reason,
            disposition: command.disposition,
            note: command.note,
          ),
          (value) => _repository.damage(scope.merchantId, value),
        );
      case final QuarantineRecord command:
        await _mutate(
          scope,
          QuarantineRecord(
            locationId: command.locationId,
            inventoryLocationId: command.inventoryLocationId,
            operatorSessionId: command.operatorSessionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            expectedVersion: command.expectedVersion,
            policyFingerprint: command.policyFingerprint,
            approvalId: approvalId,
            approvalFingerprint: fingerprint,
            businessDate: command.businessDate,
            inventoryItemId: command.inventoryItemId,
            quantity: command.quantity,
            action: command.action,
            reason: command.reason,
          ),
          (value) => _repository.quarantine(scope.merchantId, value),
        );
      case final RestockCommand command:
        await _mutate(
          scope,
          RestockCommand(
            locationId: command.locationId,
            inventoryLocationId: command.inventoryLocationId,
            operatorSessionId: command.operatorSessionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            expectedVersion: command.expectedVersion,
            policyFingerprint: command.policyFingerprint,
            approvalId: approvalId,
            approvalFingerprint: fingerprint,
            businessDate: command.businessDate,
            restockIntentId: command.restockIntentId,
            componentDecisions: command.componentDecisions,
          ),
          (value) => _repository.restock(scope.merchantId, value),
        );
    }
  }

  InventoryCommandSeed _command(
    InventoryScope scope,
    Map<String, Object?> item,
    String? approvalId,
    String? approvalFingerprint,
  ) {
    final overview = _state.overview!;
    final itemId = item['id']! as String;
    final balance = overview.balances.firstWhere(
      (candidate) => candidate['inventoryItemId'] == itemId,
    );
    return (
      locationId: scope.locationId,
      inventoryLocationId: overview.locations.first['id']! as String,
      operatorSessionId: scope.operatorSessionId,
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      expectedVersion: (balance['version']! as num).toInt(),
      policyFingerprint: overview.policy['fingerprint']! as String,
      approvalId: approvalId,
      approvalFingerprint: approvalFingerprint,
      businessDate: _businessDate(),
    );
  }

  Map<String, Object?> _quantity(Map<String, Object?> item, int value) => {
    'value': value,
    'scale': item['scale']! as int,
    'unit': item['baseUnit']! as String,
  };

  Future<void> _mutate<T>(
    InventoryScope scope,
    T command,
    Future<InventoryMutationResult> Function(T command) operation,
  ) async {
    _set(
      InventoryUiState(
        busy: true,
        overview: _state.overview,
        history: _state.history,
        count: _state.count,
      ),
    );
    try {
      await operation(command);
      await load(scope);
    } on AppException catch (error) {
      if (error.recoverable) {
        final commandId = _inventoryCommandId(command);
        if (commandId != null) {
          try {
            final recovered = await _repository.recover(
              scope.merchantId,
              commandId,
              InventoryRecoveryQuery(
                locationId: scope.locationId,
                operatorSessionId: scope.operatorSessionId,
              ),
            );
            if (recovered.state == 'recovered' && recovered.result != null) {
              await load(scope);
              return;
            }
          } on AppException {
            // Keep the original safe error when the query cannot prove a terminal result.
          }
        }
      }
      final fields = error.fieldErrors;
      final fingerprint =
          (fields?['approvalFingerprint'] as List<Object?>?)?.firstOrNull
              as String?;
      final permission =
          (fields?['approvalPermission'] as List<Object?>?)?.firstOrNull
              as String?;
      _set(
        InventoryUiState(
          overview: _state.overview,
          history: _state.history,
          count: _state.count,
          pendingOperation: error.code == 'APPROVAL_REQUIRED' ? command : null,
          approvalPermission: permission,
          approvalFingerprint: fingerprint,
          errorCode: error.code,
        ),
      );
    }
  }

  String? _inventoryCommandId(Object? command) => switch (command) {
    final InventoryAdjustment value => value.commandId,
    final WasteRecord value => value.commandId,
    final DamageRecord value => value.commandId,
    final QuarantineRecord value => value.commandId,
    final RestockCommand value => value.commandId,
    _ => null,
  };

  Future<InventoryCountResult?> _recoverCount(
    InventoryScope scope,
    String commandId,
  ) async {
    try {
      final recovered = await _repository.recover(
        scope.merchantId,
        commandId,
        InventoryRecoveryQuery(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
        ),
      );
      final result = recovered.result;
      if (recovered.state != 'recovered' || result is! Map) return null;
      return InventoryCountResult.fromJson(Map<String, Object?>.from(result));
    } on AppException {
      return null;
    }
  }

  String _businessDate() => DateTime.now().toIso8601String().substring(0, 10);

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  void _set(InventoryUiState value) {
    _state = value;
    notifyListeners();
  }
}
