import 'dart:convert';

/// Shared, pure ES256 (ECDSA P-256) wire encoding for hardware device keys. A
/// TPM, an Android Keystore, and an iOS Secure Enclave all speak ES256 but hand
/// back their public key and signature in slightly different shapes; these two
/// functions turn either shape into exactly what the server's `es256` verifier
/// reads. No `dart:io`, so every target (web included) can import this.

/// A key as base64url SPKI DER, from a public key given either as a PEM
/// `PUBLIC KEY` block or as raw SPKI DER bytes. A P-256 SPKI is 91 bytes.
String spkiPublicKeyToB64Url(Object publicKey) {
  final List<int> der;
  if (publicKey is String) {
    final body = publicKey
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty && !line.startsWith('-----'))
        .join();
    if (body.isEmpty) {
      throw const FormatException('empty PEM public key');
    }
    der = base64.decode(body);
  } else if (publicKey is List<int>) {
    der = publicKey;
  } else {
    throw ArgumentError('public key must be a PEM string or SPKI DER bytes');
  }
  return base64Url.encode(der);
}

/// A signature as base64url of the 64-byte raw r‖s the server verifies
/// (`dsaEncoding: 'ieee-p1363'`). Accepts the two shapes keystores emit: ASN.1
/// DER `SEQUENCE { INTEGER r, INTEGER s }`, or already-raw r‖s.
String ecdsaSignatureToRawB64Url(List<int> signature) =>
    base64Url.encode(ecdsaSignatureToRaw(signature));

/// The 64-byte raw r‖s form of an ECDSA P-256 signature.
List<int> ecdsaSignatureToRaw(List<int> signature) {
  if (signature.isNotEmpty && signature[0] == 0x30) {
    return _derToRaw(signature);
  }
  if (signature.length == 64) return signature;
  throw FormatException(
    'unrecognized ECDSA signature (${signature.length} bytes)',
  );
}

List<int> _derToRaw(List<int> der) {
  var i = 0;
  if (der[i++] != 0x30) throw const FormatException('not a DER sequence');
  // SEQUENCE length: skip short or long form.
  if ((der[i] & 0x80) != 0) {
    i += 1 + (der[i] & 0x7f);
  } else {
    i += 1;
  }

  List<int> readInteger() {
    if (der[i++] != 0x02) throw const FormatException('expected a DER INTEGER');
    final length = der[i++];
    var value = der.sublist(i, i + length);
    i += length;
    // Drop the sign-padding zero(s) DER adds for a high top bit.
    while (value.length > 32 && value.first == 0) {
      value = value.sublist(1);
    }
    if (value.length > 32) {
      throw const FormatException('ECDSA integer wider than the P-256 field');
    }
    // Left-pad to the fixed 32-byte field width.
    return [...List.filled(32 - value.length, 0), ...value];
  }

  final r = readInteger();
  final s = readInteger();
  return [...r, ...s];
}
