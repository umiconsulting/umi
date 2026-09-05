import FlutterMacOS
import Foundation
import Security

/// macOS Secure Enclave backing for the POS device key, on Macs that have a
/// Secure Enclave (T2 or Apple Silicon). Same contract and code shape as the
/// iOS signer; it answers the `co.umiconsulting.umi_pos/device_key`
/// MethodChannel that `MethodChannelKeystore` (Dart) calls, so the verified
/// Dart seam is reused unchanged.
///
/// Needs the keychain / Secure Enclave entitlements on the signed app.
///
/// REVIEW STATUS: written to the documented Secure Enclave contract but NOT
/// compiled or run in the build environment (no macOS/Xcode there). It must be
/// built and exercised on a Mac before it is trusted.
final class DeviceKeySigner {
  static let channelName = "co.umiconsulting.umi_pos/device_key"
  private let keyTag = "co.umiconsulting.umi_pos.device_key".data(using: .utf8)!

  // 26-byte ASN.1 SPKI header for an EC P-256 public key; the enclave returns
  // only the raw X9.63 point, and the server reads SPKI.
  private let spkiHeader: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00,
  ]

  static func register(with messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: channelName, binaryMessenger: messenger)
    let signer = DeviceKeySigner()
    channel.setMethodCallHandler { call, result in
      do {
        switch call.method {
        case "ensurePublicKey":
          result(FlutterStandardTypedData(bytes: try signer.ensurePublicKey()))
        case "sign":
          guard
            let args = call.arguments as? [String: Any],
            let message = (args["message"] as? FlutterStandardTypedData)?.data
          else { throw SignerError.badArguments }
          result(FlutterStandardTypedData(bytes: try signer.sign(message)))
        default:
          result(FlutterMethodNotImplemented)
        }
      } catch {
        result(FlutterError(code: "device_key_error",
                            message: "\(error)", details: nil))
      }
    }
  }

  private func loadPrivateKey() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else {
      return nil
    }
    return (item as! SecKey)
  }

  private func ensurePrivateKey() throws -> SecKey {
    if let existing = loadPrivateKey() { return existing }

    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      .privateKeyUsage, nil,
    ) else { throw SignerError.accessControl }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrAccessControl as String: access,
      ],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw SignerError.keyCreation(error?.takeRetainedValue())
    }
    return key
  }

  private func ensurePublicKey() throws -> Data {
    let privateKey = try ensurePrivateKey()
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw SignerError.noPublicKey
    }
    var error: Unmanaged<CFError>?
    guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw SignerError.export(error?.takeRetainedValue())
    }
    return Data(spkiHeader) + point
  }

  private func sign(_ message: Data) throws -> Data {
    let privateKey = try ensurePrivateKey()
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureMessageX962SHA256,
      message as CFData, &error,
    ) as Data? else {
      throw SignerError.signing(error?.takeRetainedValue())
    }
    return signature
  }

  enum SignerError: Error {
    case badArguments
    case accessControl
    case keyCreation(CFError?)
    case noPublicKey
    case export(CFError?)
    case signing(CFError?)
  }
}
