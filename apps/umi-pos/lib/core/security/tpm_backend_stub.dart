import 'tpm_device_key.dart';

/// A TPM device key needs a local `tpm2-tools` process, which the web build has
/// no way to run. Selecting it there is a configuration error, so fail loudly
/// rather than silently fall back.
TpmBackend createTpmBackend() =>
    throw TpmException('a TPM device key is not available on this platform');
