#include "device_key_signer.h"

#include <windows.h>
// clang-format off
#include <bcrypt.h>
#include <ncrypt.h>
// clang-format on

#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>

#include <memory>
#include <string>
#include <vector>

#pragma comment(lib, "ncrypt.lib")
#pragma comment(lib, "bcrypt.lib")

// Windows Platform Crypto Provider (TPM) backing for the POS device key. The
// private key lives in the TPM and never leaves it; signing happens in the TPM.
// Contract, matching the Dart side:
//   ensurePublicKey -> the public key as X.509 SubjectPublicKeyInfo (SPKI) DER.
//   sign(message)   -> an ECDSA P-256 / SHA-256 signature. NCryptSignHash emits
//                      raw r||s (64 bytes), which the Dart side accepts as-is.
//
// REVIEW STATUS: written to the documented CNG contract but NOT compiled here.
namespace umi {
namespace {

constexpr wchar_t kKeyName[] = L"umi_pos_device_key";

// 26-byte ASN.1 SPKI header for an EC P-256 public key, followed by 0x04||X||Y.
constexpr unsigned char kSpkiHeader[] = {
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00};

// Opens the persisted device key, creating it in the TPM provider on first use.
bool OpenOrCreateKey(NCRYPT_PROV_HANDLE provider, NCRYPT_KEY_HANDLE* key) {
  SECURITY_STATUS status = NCryptOpenKey(provider, key, kKeyName, 0, 0);
  if (status == ERROR_SUCCESS) return true;
  status = NCryptCreatePersistedKey(provider, key, NCRYPT_ECDSA_P256_ALGORITHM,
                                    kKeyName, 0, 0);
  if (status != ERROR_SUCCESS) return false;
  return NCryptFinalizeKey(*key, 0) == ERROR_SUCCESS;
}

// Returns the SPKI DER public key, or empty on failure.
std::vector<uint8_t> EnsurePublicKey() {
  NCRYPT_PROV_HANDLE provider = 0;
  if (NCryptOpenStorageProvider(&provider, MS_PLATFORM_CRYPTO_PROVIDER, 0) !=
      ERROR_SUCCESS) {
    return {};
  }
  NCRYPT_KEY_HANDLE key = 0;
  std::vector<uint8_t> spki;
  if (OpenOrCreateKey(provider, &key)) {
    DWORD size = 0;
    if (NCryptExportKey(key, 0, BCRYPT_ECCPUBLIC_BLOB, nullptr, nullptr, 0,
                        &size, 0) == ERROR_SUCCESS) {
      std::vector<uint8_t> blob(size);
      if (NCryptExportKey(key, 0, BCRYPT_ECCPUBLIC_BLOB, nullptr, blob.data(),
                          size, &size, 0) == ERROR_SUCCESS) {
        // BCRYPT_ECCKEY_BLOB: { ULONG Magic; ULONG cbKey; } then X, then Y.
        const size_t kHeader = sizeof(BCRYPT_ECCKEY_BLOB);
        const auto* header = reinterpret_cast<BCRYPT_ECCKEY_BLOB*>(blob.data());
        const size_t cb = header->cbKey;  // 32 for P-256
        if (blob.size() >= kHeader + 2 * cb) {
          spki.insert(spki.end(), std::begin(kSpkiHeader), std::end(kSpkiHeader));
          spki.push_back(0x04);  // uncompressed point marker
          spki.insert(spki.end(), blob.begin() + kHeader,
                      blob.begin() + kHeader + 2 * cb);
        }
      }
    }
    NCryptFreeObject(key);
  }
  NCryptFreeObject(provider);
  return spki;
}

// SHA-256 of the message, using BCrypt.
std::vector<uint8_t> Sha256(const std::vector<uint8_t>& message) {
  std::vector<uint8_t> digest(32);
  BCRYPT_ALG_HANDLE alg = nullptr;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) !=
      0) {
    return {};
  }
  const NTSTATUS ok =
      BCryptHash(alg, nullptr, 0, const_cast<PUCHAR>(message.data()),
                 static_cast<ULONG>(message.size()), digest.data(),
                 static_cast<ULONG>(digest.size()));
  BCryptCloseAlgorithmProvider(alg, 0);
  return ok == 0 ? digest : std::vector<uint8_t>{};
}

// Signs the message with the TPM key. Returns raw r||s (64 bytes) or empty.
std::vector<uint8_t> Sign(const std::vector<uint8_t>& message) {
  const std::vector<uint8_t> hash = Sha256(message);
  if (hash.empty()) return {};

  NCRYPT_PROV_HANDLE provider = 0;
  if (NCryptOpenStorageProvider(&provider, MS_PLATFORM_CRYPTO_PROVIDER, 0) !=
      ERROR_SUCCESS) {
    return {};
  }
  NCRYPT_KEY_HANDLE key = 0;
  std::vector<uint8_t> signature;
  if (OpenOrCreateKey(provider, &key)) {
    DWORD size = 0;
    if (NCryptSignHash(key, nullptr, const_cast<PBYTE>(hash.data()),
                       static_cast<DWORD>(hash.size()), nullptr, 0, &size, 0) ==
        ERROR_SUCCESS) {
      signature.resize(size);
      if (NCryptSignHash(key, nullptr, const_cast<PBYTE>(hash.data()),
                         static_cast<DWORD>(hash.size()), signature.data(), size,
                         &size, 0) != ERROR_SUCCESS) {
        signature.clear();
      }
    }
    NCryptFreeObject(key);
  }
  NCryptFreeObject(provider);
  return signature;  // raw r||s for ECDSA
}

}  // namespace

void RegisterDeviceKeySigner(flutter::BinaryMessenger* messenger) {
  auto channel =
      std::make_shared<flutter::MethodChannel<flutter::EncodableValue>>(
          messenger, "co.umiconsulting.umi_pos/device_key",
          &flutter::StandardMethodCodec::GetInstance());

  channel->SetMethodCallHandler(
      [](const flutter::MethodCall<flutter::EncodableValue>& call,
         std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>>
             result) {
        if (call.method_name() == "ensurePublicKey") {
          const std::vector<uint8_t> key = EnsurePublicKey();
          if (key.empty()) {
            result->Error("device_key_error", "could not read the public key");
          } else {
            result->Success(flutter::EncodableValue(key));
          }
        } else if (call.method_name() == "sign") {
          const auto* args =
              std::get_if<flutter::EncodableMap>(call.arguments());
          std::vector<uint8_t> message;
          if (args) {
            const auto it = args->find(flutter::EncodableValue("message"));
            if (it != args->end()) {
              if (const auto* bytes =
                      std::get_if<std::vector<uint8_t>>(&it->second)) {
                message = *bytes;
              }
            }
          }
          const std::vector<uint8_t> signature = Sign(message);
          if (signature.empty()) {
            result->Error("device_key_error", "could not sign");
          } else {
            result->Success(flutter::EncodableValue(signature));
          }
        } else {
          result->NotImplemented();
        }
      });

  // Keep the channel alive for the process lifetime.
  static std::shared_ptr<flutter::MethodChannel<flutter::EncodableValue>>
      retained;
  retained = channel;
}

}  // namespace umi
