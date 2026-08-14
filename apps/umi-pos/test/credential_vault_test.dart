import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';

import 'support/fakes.dart';

void main() {
  test(
    'installation identity is stable but is not proof of enrollment',
    () async {
      final storage = MemorySecureStorage();
      final vault = CredentialVault(storage);
      final first = await vault.deviceIdentity();
      final second = await vault.deviceIdentity();
      expect(first.installationId, second.installationId);
      expect(first.isEnrolled, isFalse);
    },
  );

  test('tenant change clears branch and operator partitions', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    await vault.selectTenant('tenant-a');
    await vault.selectBranch('branch-a');
    await vault.saveOperatorSession('operator-a');
    await vault.selectTenant('tenant-b');
    expect(storage.values['context.tenant_id'], 'tenant-b');
    expect(storage.values, isNot(contains('context.branch_id')));
    expect(storage.values, isNot(contains('operator.session_id')));
  });

  test(
    'revocation cleanup preserves installation identity but removes trust and session',
    () async {
      final storage = MemorySecureStorage();
      final vault = CredentialVault(storage);
      final installation = (await vault.deviceIdentity()).installationId;
      await vault.saveDevice(
        id: 'device',
        publicId: 'public',
        credential: 'credential',
        credentialVersion: 1,
        state: 'active',
      );
      await vault.saveTokens('access', 'refresh');
      await vault.clearDeviceTrust();
      final after = await vault.deviceIdentity();
      expect(after.installationId, installation);
      expect(after.isEnrolled, isFalse);
      expect(await vault.accessToken(), isNull);
      expect(await vault.refreshToken(), isNull);
    },
  );
}
