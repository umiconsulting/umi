import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/device_key.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';

import 'support/fakes.dart';

const _claimResponse = {
  'pairingSessionId': '00000000-0000-4000-8000-000000000010',
  'pollingCredential': 'poll-secret',
  'state': 'awaiting_approval',
  'expiresAt': '2999-01-01T00:00:00.000Z',
  'pollAfterSeconds': 1,
};

BoundedApiClient _api(http.Client client, CredentialVault vault) {
  return BoundedApiClient(
    config: testConfig,
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    tokenProvider: vault,
    deviceCredentialProvider: vault,
    client: client,
  );
}

void main() {
  test('pairing registers the device public key', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    final deviceKey = SoftwareDeviceKey(storage);
    final expectedPublicKey = await deviceKey.ensurePublicKey();

    Map<String, Object?> sentBody = const {};
    final client = MockClient((request) async {
      sentBody = jsonDecode(request.body) as Map<String, Object?>;
      return http.Response(
        jsonEncode(_claimResponse),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final gateway = ApiEntryGateway(
      _api(client, vault),
      vault,
      deviceKey: deviceKey,
    );

    await gateway.claimPairing('ABCD-1234');

    expect(sentBody['ephemeralPublicKey'], expectedPublicKey);
    expect(sentBody['deviceType'], 'pos_terminal');
  });

  test('without a device key, pairing sends no public key', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);

    Map<String, Object?> sentBody = const {};
    final client = MockClient((request) async {
      sentBody = jsonDecode(request.body) as Map<String, Object?>;
      return http.Response(
        jsonEncode(_claimResponse),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final gateway = ApiEntryGateway(_api(client, vault), vault);

    await gateway.claimPairing('ABCD-1234');

    expect(sentBody['ephemeralPublicKey'], isNull);
  });
}
