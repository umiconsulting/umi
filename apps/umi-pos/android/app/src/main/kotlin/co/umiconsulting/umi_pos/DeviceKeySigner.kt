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
    val store = keyStore()
    (store.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry)?.let {
      return it.privateKey
    }
    val builder = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Prefer a discrete StrongBox secure element; fall back if absent.
      try {
        builder.setIsStrongBoxBacked(true)
      } catch (_: Exception) {
        builder.setIsStrongBoxBacked(false)
      }
    }
    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE,
    )
    return try {
      generator.initialize(builder.build())
      generator.generateKeyPair().private
    } catch (_: Exception) {
      // A device without StrongBox rejects the flag; retry TEE-backed.
      generator.initialize(
        KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .build(),
      )
      generator.generateKeyPair().private
    }
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
