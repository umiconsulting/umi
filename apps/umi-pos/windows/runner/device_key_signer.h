#ifndef RUNNER_DEVICE_KEY_SIGNER_H_
#define RUNNER_DEVICE_KEY_SIGNER_H_

#include <flutter/binary_messenger.h>

// Registers the hardware device-key MethodChannel
// ("co.umiconsulting.umi_pos/device_key") backed by the Windows Platform
// Crypto Provider (TPM). Reuses the verified `KeystoreDeviceKey` Dart seam.
//
// REVIEW STATUS: written to the documented CNG/NCrypt contract but NOT compiled
// in the build environment (no Windows toolchain there). Must be built and run
// on a Windows machine with a TPM before it is trusted.
namespace umi {
void RegisterDeviceKeySigner(flutter::BinaryMessenger* messenger);
}  // namespace umi

#endif  // RUNNER_DEVICE_KEY_SIGNER_H_
