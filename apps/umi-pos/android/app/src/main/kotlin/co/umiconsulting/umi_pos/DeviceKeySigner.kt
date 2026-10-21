package co.umiconsulting.umi_pos

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.flutter.plugin.common.MethodChannel
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Android Keystore backing for the POS device key. The private key is generated
 * inside the Keystore (hardware-backed TEE, or StrongBox when the device has
 * one) and never leaves it; signing happens in the secure element. It answers
 * the `co.umiconsulting.umi_pos/device_key` MethodChannel that
 * `MethodChannelKeystore` (Dart) calls.
 *
 * Contract, matching the Dart side:
 *  - `ensurePublicKey` -> the public key as X.509 SubjectPublicKeyInfo (SPKI)
 *    DER bytes. `PublicKey.getEncoded()` returns exactly that.
 *  - `sign(message)` -> a SHA256withECDSA signature (ASN.1 DER). The Dart side
 *    normalizes DER to the 64-byte raw r‖s the server verifies.
 *
 * REVIEW STATUS: written to the documented AndroidKeyStore contract but NOT
 * compiled or run in the build environment (no Android SDK/device there). It
 * must be built and exercised on a device before it is trusted.
 */
class DeviceKeySigner(channel: MethodChannel) {
  init {
    channel.setMethodCallHandler { call, result ->
      try {
        when (call.method) {
          "ensurePublicKey" -> result.success(ensurePublicKey())
          "sign" -> {
            val message = call.argument<ByteArray>("message")
              ?: throw IllegalArgumentException("missing 'message'")
            result.success(sign(message))
          }
          else -> result.notImplemented()
        }
      } catch (e: Exception) {
        result.error("device_key_error", e.message, null)
      }
    }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun ensureKey(): PrivateKey {
    readKey()?.let { return it }
    return try {
      generate(strongBox = true)
    } catch (_: Exception) {
      // A failed StrongBox request can leave a half-created alias behind. The
      // TEE-backed retry must start from a clean alias, or the keystore
      // refuses it with KEY_ALREADY_EXISTS and the device loses its identity.
      keyStore().deleteEntry(KEY_ALIAS)
      generate(strongBox = false)
    }
  }

  private fun readKey(): PrivateKey? {
    val store = keyStore()
    val entry =
      store.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        ?: return null
    if (entry.certificate == null) {
      // A key without a certificate cannot produce a public key. Remove it
      // instead of reporting a proof that no server can verify.
      store.deleteEntry(KEY_ALIAS)
      return null
    }
    return entry.privateKey
  }

  private fun generate(strongBox: Boolean): PrivateKey {
    val builder =
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true)
    }
    val generator =
      KeyPairGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_EC,
        ANDROID_KEYSTORE,
      )
    generator.initialize(builder.build())
    return generator.generateKeyPair().private
  }

  private fun ensurePublicKey(): ByteArray {
    ensureKey()
    val cert = keyStore().getCertificate(KEY_ALIAS)
      ?: throw IllegalStateException("no certificate for device key")
    // X.509 SubjectPublicKeyInfo (SPKI) DER — what the Dart/server side expects.
    return cert.publicKey.encoded
  }

  private fun sign(message: ByteArray): ByteArray {
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(ensureKey())
    signature.update(message)
    return signature.sign() // ASN.1 DER
  }

  companion object {
    const val CHANNEL = "co.umiconsulting.umi_pos/device_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "umi_pos_device_key"
  }
}
