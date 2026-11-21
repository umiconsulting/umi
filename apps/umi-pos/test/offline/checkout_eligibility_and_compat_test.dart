import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_checkout_service.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/offline_policy.dart';

import '../support/fakes.dart';

const _merchantId = '00000000-0000-4000-8000-000000000001';
const _locationId = '00000000-0000-4000-8000-000000000002';
const _operatorId = '00000000-0000-4000-8000-000000000003';
const _deviceId = '00000000-0000-4000-8000-000000000004';
const _cartId = '00000000-0000-4000-8000-000000000005';
const _otherCartId = '00000000-0000-4000-8000-000000000006';

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

void main() {
  group('hasPendingForCart excludes non-cart KDS and ack commands', () {
    test(
      'pending pos.kds.command and operational.ack do not block online manual_terminal or bank_transfer checkout',
      () async {
        final journal = EncryptedOfflineJournal(
          _MemoryCipherStore(),
          web: false,
        );
        await journal.append(
          commandId: _id(10),
          deviceId: _deviceId,
          credentialVersion: 1,
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          idempotencyKey: _id(11),
          commandType: 'pos.kds.command',
          payload: const {'commandType': 'start_preparation', 'ticketId': 't1'},
        );
        await journal.append(
          commandId: _id(12),
          deviceId: _deviceId,
          credentialVersion: 1,
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          idempotencyKey: _id(13),
          commandType: 'operational.ack',
          payload: const {'ackType': 'shift_notice'},
        );

        final snapshot = await journal.load();
        expect(snapshot.pendingCount, 2);
        expect(snapshot.hasPendingForCart(_cartId), isFalse);
        expect(journal.hasPendingForCart(_cartId), isFalse);

        // Verify CheckoutController stays online for manual_terminal and
        // bank_transfer rather than falling into cash-only offline checkout.
        final repo = _OnlineCheckoutRepo();
        final connectivity = ConnectivityController()
          ..apiReachable(authorityValid: true)
          ..apiReachable(authorityValid: true);
        final offlineService = OfflineCheckoutService(
          journal: journal,
          policyCache: OfflinePolicyCache(journal),
          eligibility: const OfflineCheckoutEligibilityEngine(),
        );
        final checkout = CheckoutController(
          repository: repo,
          telemetry: _noopTelemetry,
          connectivity: connectivity,
          offlineCheckout: offlineService,
          pendingLocalCommands: () => journal.hasPendingForCart(_cartId),
        );
        addTearDown(checkout.dispose);

        await checkout.loadPolicy(
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          currency: 'MXN',
        );
        await checkout.preview(
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          cartId: _cartId,
          cartVersion: 2,
          cart: _sampleCart(_cartId),
          partialLedgerFinalization: true,
          tenderDrafts: [
            TenderDraft(
              id: _id(20),
              type: 'manual_terminal',
              amount: const {'minorUnits': 11600, 'currency': 'MXN'},
              amountReceived: null,
              status: 'confirmed_success',
              correlationId: null,
            ).toJson(),
          ],
          paymentMethod: 'manual_terminal',
          cashShiftId: null,
        );

        expect(
          repo.checkoutCommands,
          hasLength(1),
          reason:
              'pending KDS/ack entries must NOT disable online terminal checkout',
        );
        expect(checkout.state.phase, CheckoutPhase.confirmationRequired);

        await checkout.preview(
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          cartId: _cartId,
          cartVersion: 2,
          cart: _sampleCart(_cartId),
          tenderDrafts: [
            TenderDraft(
              id: _id(21),
              type: 'bank_transfer',
              amount: const {'minorUnits': 11600, 'currency': 'MXN'},
              amountReceived: null,
              status: 'draft',
              correlationId: null,
            ).toJson(),
          ],
          paymentMethod: 'bank_transfer',
          cashShiftId: null,
        );

        expect(
          repo.checkoutCommands,
          hasLength(2),
          reason:
              'pending KDS/ack entries must NOT disable online bank_transfer checkout',
        );
        expect(checkout.state.phase, CheckoutPhase.confirmationRequired);
      },
    );

    test(
      'pending cart command still blocks only its own cart while leaving other carts unblocked',
      () async {
        final journal = EncryptedOfflineJournal(
          _MemoryCipherStore(),
          web: false,
        );
        await journal.append(
          commandId: _id(30),
          deviceId: _deviceId,
          credentialVersion: 1,
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorId,
          idempotencyKey: _id(31),
          commandType: 'pos.cart.line.add',
          payload: {'cartId': _cartId, 'productId': _id(40), 'quantity': 1},
        );
        expect(journal.hasPendingForCart(_cartId), isTrue);
        expect(journal.hasPendingForCart(_otherCartId), isFalse);
      },
    );
  });

  group('API 2.49.0 boot release compatibility shim', () {
    test('accepts deployed API 2.49.0 without apiMajorVersion', () async {
      final gateway = ApiReleaseCompatibilityGateway(
        api: _ReleaseApi(apiMajorVersion: null, contractVersion: '2.49.0'),
        config: pilotTestConfig,
      );
      expect(await gateway.check(), ReleaseCompatibility.compatible);
    });

    test('rejects incompatible explicit apiMajorVersion: 2', () async {
      final gateway = ApiReleaseCompatibilityGateway(
        api: _ReleaseApi(apiMajorVersion: 2, contractVersion: '2.58.0'),
        config: pilotTestConfig,
      );
      expect(await gateway.check(), ReleaseCompatibility.unsupported);
    });

    test(
      'rejects contractVersion 3.0.0 when apiMajorVersion is missing',
      () async {
        final gateway = ApiReleaseCompatibilityGateway(
          api: _ReleaseApi(apiMajorVersion: null, contractVersion: '3.0.0'),
          config: pilotTestConfig,
        );
        expect(await gateway.check(), ReleaseCompatibility.unsupported);
      },
    );

    test(
      'rejects unparseable contractVersion when apiMajorVersion is missing',
      () async {
        final gateway = ApiReleaseCompatibilityGateway(
          api: _ReleaseApi(apiMajorVersion: null, contractVersion: 'invalid'),
          config: pilotTestConfig,
        );
        expect(await gateway.check(), ReleaseCompatibility.unsupported);
      },
    );
  });
}

const _noopTelemetry = SafeTelemetry(
  enabled: false,
  context: TelemetryContext(
    appVersion: 'test',
    environment: 'test',
    platform: 'test',
  ),
  exporter: NoopTelemetryExporter(),
);

Cart _sampleCart(String cartId) => Cart(
  id: cartId,
  merchantId: _merchantId,
  locationId: _locationId,
  operatorSessionId: _operatorId,
  accountFolio: 'Cuenta 101',
  status: 'prepared',
  version: 2,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: const [],
  totals: const {
    'subtotal': {'minorUnits': 11600, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Object?>[],
    },
    'grandTotal': {'minorUnits': 11600, 'currency': 'MXN'},
    'businessDate': '2026-11-20',
  },
  checkoutEnabled: true,
  checkoutMessageCode: 'OK',
  updatedAt: '2026-11-20T12:00:00.000Z',
);

final class _MemoryCipherStore implements JournalCipherStore {
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

final class _OnlineCheckoutRepo implements CheckoutRepository {
  final checkoutCommands = <CheckoutCommand>[];

  @override
  Future<CheckoutPolicy> policy(
    String merchantId,
    PosCheckoutPolicyQuery query,
  ) async => CheckoutPolicy.fromJson({
    'version': 'test',
    'manualTerminalEnabled': true,
    'bankTransferEnabled': true,
    'bankTransferDetails': {
      'holderName': 'ONCA',
      'bankName': 'Banco',
      'clabe': '012345678901234567',
      'accountNumber': null,
    },
    'merchantLogoUrl': null,
    'mixedTenderEnabled': true,
    'maximumTenderLines': 4,
    'manualTerminalApprovalThreshold': {'minorUnits': 50000, 'currency': 'MXN'},
    'manualTerminalApprovalPermission': 'checkout.terminal.approve',
    'tip': {
      'enabled': false,
      'presetBasisPoints': <int>[],
      'customPercentageEnabled': false,
      'customFixedEnabled': false,
      'maximumTip': {'minorUnits': 0, 'currency': 'MXN'},
      'requiredPermission': null,
      'version': 'test',
    },
    'discount': {
      'enabled': false,
      'maximumBasisPoints': 0,
      'maximumAmount': {'minorUnits': 0, 'currency': 'MXN'},
      'cashierThreshold': {'minorUnits': 0, 'currency': 'MXN'},
      'customRequiresApproval': false,
      'requiredPermission': 'checkout.discount.apply',
      'approvalPermission': 'checkout.discount.approve',
      'version': 'test',
    },
  });

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
    CheckoutCommand command,
  ) async {
    checkoutCommands.add(command);
    return CheckoutResult(
      status: 'confirmation_required',
      confirmation: {
        'fingerprint': List.filled(64, 'a').join(),
        'totals': _sampleCart(_cartId).totals,
      },
      payment: null,
      reservation: null,
      sale: null,
      receipt: null,
      failure: null,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _ReleaseApi implements ApiClient {
  _ReleaseApi({this.apiMajorVersion, required this.contractVersion});

  final int? apiMajorVersion;
  final String contractVersion;

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
  }) async => {
    'environment': 'pilot',
    if (apiMajorVersion != null) 'apiMajorVersion': apiMajorVersion,
    'contractVersion': contractVersion,
    'minimumPosVersion': '0.1.0',
  };

  @override
  void dispose() {}
}
