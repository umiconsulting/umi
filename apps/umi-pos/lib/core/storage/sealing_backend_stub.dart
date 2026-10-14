import 'tpm_sealed_storage.dart';

/// A TPM sealed vault needs a local `systemd-creds` process, which the web
/// build has no way to run. Selecting it there is a configuration error, so
/// fail loudly rather than silently fall back.
SealingBackend createSealingBackend() => throw SealingException(
  'a TPM sealed vault is not available on this platform',
);
