import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/local_working_copy.dart';

/// Where the data behind a cart line actually came from.
///
/// A local confirmation is arithmetic over cached data. It must not be able to
/// make that data look younger than it is: the policy gate reads these times,
/// and a fresh hash is not a fresh catalogue, price or tax observation.
final class CartSourceProvenance {
  const CartSourceProvenance({
    required this.catalogAt,
    required this.pricingAt,
    required this.taxAt,
    this.catalogVersion,
    this.pricingVersion,
    this.taxVersion,
    this.cartUpdatedAt,
    this.contentHash,
  });

  factory CartSourceProvenance.fromJson(Map<String, Object?> json) {
    DateTime? read(String key) =>
        DateTime.tryParse(json[key] as String? ?? '')?.toUtc();
    final catalog = read('catalogAt');
    final pricing = read('pricingAt');
    final tax = read('taxAt');
    if (catalog == null || pricing == null || tax == null) {
      throw const FormatException('cart_provenance_incomplete');
    }
    return CartSourceProvenance(
      catalogAt: catalog,
      pricingAt: pricing,
      taxAt: tax,
      catalogVersion: json['catalogVersion'] as String?,
      pricingVersion: json['pricingVersion'] as String?,
      taxVersion: json['taxVersion'] as String?,
      cartUpdatedAt: read('cartUpdatedAt'),
      contentHash: json['contentHash'] as String?,
    );
  }

  final DateTime catalogAt;
  final DateTime pricingAt;
  final DateTime taxAt;
  final String? catalogVersion;
  final String? pricingVersion;
  final String? taxVersion;
  final DateTime? cartUpdatedAt;
  final String? contentHash;

  Map<String, Object?> toJson() => {
    'catalogAt': catalogAt.toUtc().toIso8601String(),
    'pricingAt': pricingAt.toUtc().toIso8601String(),
    'taxAt': taxAt.toUtc().toIso8601String(),
    'catalogVersion': catalogVersion,
    'pricingVersion': pricingVersion,
    'taxVersion': taxVersion,
    'cartUpdatedAt': cartUpdatedAt?.toUtc().toIso8601String(),
    'contentHash': contentHash,
  };
}

/// Persists the source ages of catalogue, price and tax data.
///
/// The store is deliberately separate from the cart and from the journal. A
/// confirmation can read it but never refresh it; only a successful catalogue
/// or product-detail read writes a new observation.
final class CartProvenanceStore {
  const CartProvenanceStore(this._local);

  static const namespace = 'cart_provenance';

  final LocalWorkingCopy _local;

  String _scope(String merchantId, String locationId) =>
      '$merchantId:$locationId';

  Future<void> recordSources(
    String merchantId,
    String locationId, {
    required DateTime catalogAt,
    DateTime? pricingAt,
    DateTime? taxAt,
    String? catalogVersion,
    String? pricingVersion,
    String? taxVersion,
  }) => _local.writeDocument(
    namespace: namespace,
    scopeKey: _scope(merchantId, locationId),
    id: 'sources',
    payload: CartSourceProvenance(
      catalogAt: catalogAt.toUtc(),
      pricingAt: (pricingAt ?? catalogAt).toUtc(),
      taxAt: (taxAt ?? catalogAt).toUtc(),
      catalogVersion: catalogVersion,
      pricingVersion: pricingVersion,
      taxVersion: taxVersion,
    ).toJson(),
  );

  Future<CartSourceProvenance?> sources(
    String merchantId,
    String locationId,
  ) async {
    final payload = await _local.readDocument(
      namespace,
      _scope(merchantId, locationId),
      'sources',
    );
    if (payload == null) return null;
    try {
      return CartSourceProvenance.fromJson(payload);
    } on FormatException {
      return null;
    }
  }

  /// Records the source ages of one cart's contents.
  ///
  /// The write is skipped when the lines, quantities and totals are unchanged,
  /// so a later catalogue refresh cannot silently make an old cart look new.
  Future<void> recordCart(Cart cart) async {
    final current = await sources(cart.merchantId, cart.locationId);
    final fallback =
        DateTime.tryParse(cart.updatedAt)?.toUtc() ?? DateTime.now().toUtc();
    final provenance =
        current ??
        CartSourceProvenance(
          catalogAt: fallback,
          pricingAt: fallback,
          taxAt: fallback,
        );
    final hash = _contentHash(cart);
    final existing = await this.cart(cart.merchantId, cart.locationId, cart.id);
    if (existing?.contentHash == hash) return;
    await _local.writeDocument(
      namespace: namespace,
      scopeKey: _scope(cart.merchantId, cart.locationId),
      id: 'cart:${cart.id}',
      payload: CartSourceProvenance(
        catalogAt: provenance.catalogAt,
        pricingAt: provenance.pricingAt,
        taxAt: provenance.taxAt,
        catalogVersion: provenance.catalogVersion,
        pricingVersion: provenance.pricingVersion,
        taxVersion: provenance.taxVersion,
        cartUpdatedAt: fallback,
        contentHash: hash,
      ).toJson(),
    );
  }

  Future<CartSourceProvenance?> cart(
    String merchantId,
    String locationId,
    String cartId,
  ) async {
    final payload = await _local.readDocument(
      namespace,
      _scope(merchantId, locationId),
      'cart:$cartId',
    );
    if (payload == null) return null;
    try {
      return CartSourceProvenance.fromJson(payload);
    } on FormatException {
      return null;
    }
  }

  String _contentHash(Cart cart) => sha256
      .convert(
        utf8.encode(
          jsonEncode({
            'cartId': cart.id,
            'items': cart.items,
            'totals': cart.totals,
          }),
        ),
      )
      .toString();
}
