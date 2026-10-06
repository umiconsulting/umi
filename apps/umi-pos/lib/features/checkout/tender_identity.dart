import 'dart:convert';

import 'package:crypto/crypto.dart';

/// The id a tender carries into the checkout command.
///
/// It has to be two things at once, and the old version only managed one. It
/// must be **stable**, so that retrying the same checkout — the network dropped,
/// the cashier pressed the button twice — presents the same tender rather than a
/// second one. And it must be **unique**, because `pos_tender_fact.id` is a
/// primary key across the whole platform.
///
/// The old `_stableId` returned a constant per kind: every cash tender ever sent
/// claimed `…301`. The first cash sale took that row and every cash sale after it
/// died on the key with "Tender identity conflicts with another checkout" — a 500
/// that told the cashier only that the charge could not be completed safely.
///
/// Deriving it from the cart gives both properties. One cart is one sale, so the
/// id is fixed for as long as that sale is being paid and never seen again after.
String tenderId(String cartId, String kind) {
  final digest = sha256.convert(utf8.encode('umi-pos-tender:$cartId:$kind'));
  final bytes = List<int>.of(digest.bytes.take(16));
  // Shape the digest as a v4 UUID so it satisfies every uuid column on the way.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = [
    for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0'),
  ].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}'
      '-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
}
