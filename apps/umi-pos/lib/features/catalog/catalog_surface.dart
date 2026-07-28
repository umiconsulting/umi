import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../cart/cart_controller.dart';
import '../checkout/checkout_controller.dart';
import '../checkout/checkout_surface.dart';
import '../entry/entry_controller.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/recovery_center.dart';
import '../offline/replay_engine.dart';
import 'catalog_controller.dart';
import 'catalog_repository.dart';

final class CatalogSurface extends StatefulWidget {
  const CatalogSurface({
    required this.entry,
    required this.catalog,
    required this.cart,
    required this.checkout,
    required this.connectivity,
    this.offlineJournal,
    this.offlineRecovery,
    super.key,
  });
  final EntryController entry;
  final CatalogController catalog;
  final CartController cart;
  final CheckoutController checkout;
  final ConnectivityController connectivity;
  final EncryptedOfflineJournal? offlineJournal;
  final OfflineRecoveryController? offlineRecovery;
  @override
  State<CatalogSurface> createState() => _CatalogSurfaceState();
}

final class _CatalogSurfaceState extends State<CatalogSurface> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  bool _initialLoadStarted = false;

  @override
  void initState() {
    super.initState();
    widget.catalog.addListener(_changed);
    widget.cart.addListener(_changed);
    widget.connectivity.addListener(_changed);
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.extentAfter < 700) {
        widget.catalog.loadMore();
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialLoadStarted) return;
    final entry = widget.entry.state;
    if (entry.selectedTenant != null && entry.selectedBranch != null) {
      _initialLoadStarted = true;
      _loadInitial(Localizations.localeOf(context).languageCode);
    }
  }

  Future<void> _loadInitial(String locale) async {
    final entry = widget.entry.state;
    await _recover();
    try {
      await widget.catalog.open(
        CatalogPartition(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          locale,
        ),
      );
      widget.connectivity.apiReachable(authorityValid: true);
      if (entry.operator != null) {
        await widget.cart.open(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          entry.operator!.id,
        );
        widget.connectivity.apiReachable(authorityValid: true);
      }
      await _recover();
    } catch (_) {
      widget.connectivity.apiFailure();
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.catalog.removeListener(_changed);
    widget.cart.removeListener(_changed);
    widget.connectivity.removeListener(_changed);
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.catalog.state;
    return Scaffold(
      floatingActionButton: MediaQuery.sizeOf(context).width < 900
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => SafeArea(
                  child: SizedBox(
                    height: MediaQuery.sizeOf(context).height * .82,
                    child: _CartPanel(
                      controller: widget.cart,
                      checkout: widget.checkout,
                      entry: widget.entry,
                    ),
                  ),
                ),
              ),
              icon: const Icon(Icons.shopping_cart_outlined),
              label: Text(l.cartTitle),
            )
          : null,
      appBar: AppBar(
        title: Text(l.catalogTitle),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
            child: Semantics(
              liveRegion: true,
              label: _connectivityLabel(context, widget.connectivity.state),
              child: Chip(
                avatar: Icon(
                  widget.connectivity.state == PosConnectivity.online
                      ? Icons.cloud_done_outlined
                      : Icons.cloud_off_outlined,
                  size: 18,
                ),
                label: Text(
                  _connectivityLabel(context, widget.connectivity.state),
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: AppLocalizations.of(context).recoveryCenterTitle,
            onPressed: () {
              final scope = _scope();
              if (scope != null &&
                  widget.offlineJournal != null &&
                  widget.offlineRecovery != null) {
                showRecoveryCenter(
                  context,
                  journal: widget.offlineJournal!,
                  recovery: widget.offlineRecovery!,
                  scope: scope,
                );
              }
            },
            icon: const Icon(Icons.sync_problem_outlined),
          ),
          Center(child: Text(widget.entry.state.selectedBranch?.name ?? '—')),
          IconButton(
            tooltip: l.lockAction,
            onPressed: widget.entry.lock,
            icon: const Icon(Icons.lock_outline),
          ),
          IconButton(
            tooltip: l.logoutAction,
            onPressed: widget.entry.logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    TextField(
                      controller: _search,
                      onChanged: (value) {
                        widget.catalog.search(value);
                        setState(() {});
                      },
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search),
                        hintText: l.catalogSearchHint,
                        suffixIcon: _search.text.isEmpty
                            ? null
                            : IconButton(
                                onPressed: () {
                                  _search.clear();
                                  widget.catalog.search('');
                                  setState(() {});
                                },
                                icon: const Icon(Icons.clear),
                              ),
                      ),
                    ),
                    const SizedBox(height: UmiSpacing.md),
                    SizedBox(
                      height: 48,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          _Category(
                            label: l.allCategories,
                            selected: state.selectedCategoryId == null,
                            onTap: () => widget.catalog.selectCategory(null),
                          ),
                          ...state.categories.map(
                            (category) => _Category(
                              label: category.name,
                              selected: state.selectedCategoryId == category.id,
                              onTap: category.enabled
                                  ? () => widget.catalog.selectCategory(
                                      category.id,
                                    )
                                  : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: UmiSpacing.md),
                    Expanded(child: _content(context, state)),
                  ],
                ),
              ),
              if (MediaQuery.sizeOf(context).width >= 900) ...[
                const SizedBox(width: UmiSpacing.lg),
                SizedBox(
                  width: 380,
                  child: _CartPanel(
                    controller: widget.cart,
                    checkout: widget.checkout,
                    entry: widget.entry,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  ReplayScope? _scope() {
    final state = widget.entry.state;
    final tenant = state.selectedTenant;
    final branch = state.selectedBranch;
    final operator = state.operator;
    final device = state.device;
    if (tenant == null ||
        branch == null ||
        operator == null ||
        device == null) {
      return null;
    }
    return ReplayScope(
      tenantId: tenant.id,
      branchId: branch.id,
      operatorSessionId: operator.id,
      credentialVersion: device.credentialVersion,
    );
  }

  Future<void> _recover() async {
    final scope = _scope();
    if (scope != null) await widget.offlineRecovery?.recover(scope);
  }

  Widget _content(BuildContext context, CatalogState state) {
    final l = AppLocalizations.of(context);
    return switch (state.phase) {
      CatalogPhase.idle ||
      CatalogPhase.loading => _Skeleton(label: l.catalogLoading),
      CatalogPhase.empty => _Message(
        l.catalogEmpty,
        Icons.inventory_2_outlined,
        widget.catalog.refresh,
      ),
      CatalogPhase.noResults => _Message(
        l.catalogNoResults,
        Icons.search_off,
        null,
      ),
      CatalogPhase.permissionDenied => _Message(
        l.catalogPermissionDenied,
        Icons.lock_outline,
        null,
      ),
      CatalogPhase.networkFailure => _Message(
        l.catalogNetworkError,
        Icons.cloud_off,
        widget.catalog.refresh,
      ),
      CatalogPhase.failure => _Message(
        l.catalogUnexpectedError,
        Icons.error_outline,
        widget.catalog.refresh,
      ),
      CatalogPhase.ready => LayoutBuilder(
        builder: (context, size) {
          final columns = size.maxWidth >= 1400
              ? 6
              : size.maxWidth >= 1050
              ? 5
              : size.maxWidth >= 760
              ? 4
              : 2;
          return GridView.builder(
            key: const PageStorageKey('catalog-grid'),
            controller: _scroll,
            itemCount: state.products.length + (state.loadingMore ? 1 : 0),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              childAspectRatio: .72,
            ),
            itemBuilder: (context, index) => index == state.products.length
                ? const Center(child: CircularProgressIndicator())
                : _ProductCard(
                    product: state.products[index],
                    onTap: () => _showDetail(state.products[index].id),
                  ),
          );
        },
      ),
    };
  }

  Future<void> _showDetail(String id) async {
    try {
      final detail = await widget.catalog.detail(id);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _Detail(detail, cart: widget.cart),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).catalogUnexpectedError),
          ),
        );
      }
    }
  }
}

String _connectivityLabel(BuildContext context, PosConnectivity state) {
  final spanish = Localizations.localeOf(context).languageCode == 'es';
  return switch (state) {
    PosConnectivity.unknown =>
      spanish ? 'Conexión desconocida' : 'Connection unknown',
    PosConnectivity.online => spanish ? 'En línea' : 'Online',
    PosConnectivity.degraded => spanish ? 'Conexión inestable' : 'Degraded',
    PosConnectivity.offline => spanish ? 'Sin conexión' : 'Offline',
    PosConnectivity.recovering =>
      spanish ? 'Recuperando conexión' : 'Recovering',
    PosConnectivity.replaying => spanish ? 'Sincronizando' : 'Synchronizing',
    PosConnectivity.reconciliationRequired =>
      spanish ? 'Revisión necesaria' : 'Review required',
    PosConnectivity.blocked => spanish ? 'Operación bloqueada' : 'Blocked',
  };
}

final class _Category extends StatelessWidget {
  const _Category({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: onTap == null ? null : (_) => onTap!(),
    ),
  );
}

final class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap});
  final CatalogProductSummary product;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final money = CatalogMoney.fromJson(product.price);
    final category = product.category == null
        ? null
        : CatalogCategory.fromJson(product.category!);
    final url = product.primaryMedia?['url'] as String?;
    return Semantics(
      button: true,
      label: product.name,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: url == null
                    ? const ColoredBox(
                        color: Color(0x221D9BF0),
                        child: Center(
                          child: Icon(Icons.local_cafe_outlined, size: 44),
                        ),
                      )
                    : Image.network(
                        url,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => const Center(
                          child: Icon(Icons.broken_image_outlined),
                        ),
                      ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (category != null) Text(category.name, maxLines: 1),
                    const SizedBox(height: 8),
                    Text(
                      '${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}',
                    ),
                    Wrap(
                      spacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (product.sku != null) Text(product.sku!),
                        if (product.hasBarcode)
                          const Icon(Icons.qr_code_2, size: 20),
                        if (product.availability != 'enabled')
                          Text(l.unavailableLabel),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _Detail extends StatefulWidget {
  const _Detail(this.detail, {required this.cart});
  final CatalogProductDetail detail;
  final CartController cart;
  @override
  State<_Detail> createState() => _DetailState();
}

final class _DetailState extends State<_Detail> {
  String? variantId;
  final selectedModifiers = <String, int>{};
  final note = TextEditingController();
  int quantity = 1;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final detail = widget.detail;
    final money = CatalogMoney.fromJson(detail.price);
    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .82,
        minChildSize: .45,
        maxChildSize: .95,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              detail.name,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            Text(
              '${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}',
            ),
            if (detail.description != null) Text(detail.description!),
            if (detail.sku != null) Text('SKU: ${detail.sku}'),
            if (detail.barcode != null) Text('Barcode: ${detail.barcode}'),
            if (detail.taxRateBasisPoints > 0) Text(l.taxIncludedLabel),
            if (detail.variants.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                l.variantsLabel,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...detail.variants.map(
                (item) => ListTile(
                  title: ChoiceChip(
                    label: Text(item['name']! as String),
                    selected: variantId == item['id'],
                    onSelected: (_) =>
                        setState(() => variantId = item['id']! as String),
                  ),
                ),
              ),
            ],
            if (detail.optionGroups.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                l.modifiersLabel,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...detail.optionGroups.expand((group) sync* {
                yield Text(
                  group['name']! as String,
                  style: Theme.of(context).textTheme.titleMedium,
                );
                for (final raw in group['modifiers']! as List<Object?>) {
                  final modifier = raw! as Map<String, Object?>;
                  final id = modifier['id']! as String;
                  yield CheckboxListTile(
                    value: selectedModifiers.containsKey(id),
                    title: Text(modifier['name']! as String),
                    onChanged: (selected) => setState(() {
                      if (selected ?? false) {
                        selectedModifiers[id] = 1;
                      } else {
                        selectedModifiers.remove(id);
                      }
                    }),
                  );
                }
              }),
            ],
            TextField(
              controller: note,
              maxLength: 500,
              decoration: InputDecoration(labelText: l.cartNoteLabel),
            ),
            Row(
              children: [
                IconButton(
                  tooltip: l.decreaseQuantity,
                  onPressed: quantity > 1
                      ? () => setState(() => quantity--)
                      : null,
                  icon: const Icon(Icons.remove),
                ),
                Text('$quantity'),
                IconButton(
                  tooltip: l.increaseQuantity,
                  onPressed: quantity < 999
                      ? () => setState(() => quantity++)
                      : null,
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: detail.variants.isNotEmpty && variantId == null
                  ? null
                  : () async {
                      await widget.cart.add(
                        productId: detail.id,
                        variantId: variantId,
                        modifiers: selectedModifiers.entries
                            .map(
                              (e) => {'modifierId': e.key, 'quantity': e.value},
                            )
                            .toList(),
                        quantity: quantity,
                        note: note.text,
                      );
                      if (context.mounted) Navigator.pop(context);
                    },
              child: Text(l.addToCartAction),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Skeleton extends StatelessWidget {
  const _Skeleton({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: label,
    child: GridView.builder(
      itemCount: 12,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        childAspectRatio: .75,
      ),
      itemBuilder: (_, _) =>
          const Card(child: Center(child: CircularProgressIndicator())),
    ),
  );
}

final class _Message extends StatelessWidget {
  const _Message(this.message, this.icon, this.retry);
  final String message;
  final IconData icon;
  final VoidCallback? retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      liveRegion: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 52),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center),
          if (retry != null) ...[
            const SizedBox(height: 16),
            FilledButton(
              onPressed: retry,
              child: Text(AppLocalizations.of(context).retryAction),
            ),
          ],
        ],
      ),
    ),
  );
}

final class _CartPanel extends StatelessWidget {
  const _CartPanel({
    required this.controller,
    required this.checkout,
    required this.entry,
  });
  final CartController controller;
  final CheckoutController checkout;
  final EntryController entry;

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return '$currency ${(minor / 100).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final cart = controller.state.cart;
    if (cart == null) {
      return Card(
        child: Center(
          child: controller.state.phase == CartPhase.failure
              ? Text(l.cartUnavailable)
              : const CircularProgressIndicator(),
        ),
      );
    }
    final items = cart.items.map(CartItem.fromJson).toList(growable: false);
    final totals = TotalsPreview.fromJson(cart.totals);
    final discounts = DiscountPreview.fromJson(totals.discounts);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.cartTitle, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: UmiSpacing.sm),
            Expanded(
              child: items.isEmpty
                  ? Center(child: Text(l.cartEmpty))
                  : ListView.builder(
                      itemCount: items.length,
                      itemBuilder: (context, index) {
                        final item = items[index];
                        final price = PriceSnapshot.fromJson(item.price);
                        return Semantics(
                          label: '${item.productName}, ${item.quantity}',
                          child: Column(
                            children: [
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(item.productName),
                                subtitle: Text(
                                  [
                                    if (item.variant != null)
                                      item.variant!['name'] as String,
                                    ...item.modifiers.map(
                                      (m) => m['name'] as String,
                                    ),
                                    if (item.note != null) item.note!,
                                  ].join(' · '),
                                ),
                                trailing: Text(_money(price.lineTotal)),
                              ),
                              Row(
                                children: [
                                  IconButton(
                                    tooltip: l.decreaseQuantity,
                                    onPressed: () => controller.quantity(
                                      item,
                                      item.quantity - 1,
                                    ),
                                    icon: const Icon(Icons.remove),
                                  ),
                                  Text('${item.quantity}'),
                                  IconButton(
                                    tooltip: l.increaseQuantity,
                                    onPressed: item.quantity < 999
                                        ? () => controller.quantity(
                                            item,
                                            item.quantity + 1,
                                          )
                                        : null,
                                    icon: const Icon(Icons.add),
                                  ),
                                  const Spacer(),
                                  IconButton(
                                    tooltip: l.removeFromCartAction,
                                    onPressed: () => controller.remove(item),
                                    icon: const Icon(Icons.delete_outline),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
            const Divider(),
            _Total(label: l.subtotalLabel, value: _money(totals.subtotal)),
            _Total(label: l.taxLabel, value: _money(totals.tax)),
            _Total(label: l.discountLabel, value: _money(discounts.total)),
            _Total(
              label: l.totalLabel,
              value: _money(totals.grandTotal),
              emphasized: true,
            ),
            Text('${l.businessDateLabel}: ${totals.businessDate}'),
            const SizedBox(height: UmiSpacing.md),
            FilledButton(
              onPressed: items.isEmpty
                  ? null
                  : () => showCheckoutSheet(
                      context,
                      checkout: checkout,
                      cart: controller,
                      entry: entry,
                    ),
              child: Text(l.checkoutAction),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Total extends StatelessWidget {
  const _Total({
    required this.label,
    required this.value,
    this.emphasized = false,
  });
  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label),
        Text(
          value,
          style: emphasized ? Theme.of(context).textTheme.titleLarge : null,
        ),
      ],
    ),
  );
}
