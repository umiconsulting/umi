import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../entry/entry_controller.dart';
import 'catalog_controller.dart';
import 'catalog_repository.dart';

final class CatalogSurface extends StatefulWidget {
  const CatalogSurface({required this.entry, required this.catalog, super.key});
  final EntryController entry;
  final CatalogController catalog;
  @override
  State<CatalogSurface> createState() => _CatalogSurfaceState();
}

final class _CatalogSurfaceState extends State<CatalogSurface> {
  final _search = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    widget.catalog.addListener(_changed);
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.extentAfter < 700) {
        widget.catalog.loadMore();
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final entry = widget.entry.state;
    if (entry.selectedTenant != null && entry.selectedBranch != null) {
      widget.catalog.open(
        CatalogPartition(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          Localizations.localeOf(context).languageCode,
        ),
      );
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.catalog.removeListener(_changed);
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.catalog.state;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.catalogTitle),
        actions: [
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
                            ? () => widget.catalog.selectCategory(category.id)
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
      ),
    );
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
        builder: (_) => _Detail(detail),
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

final class _Detail extends StatelessWidget {
  const _Detail(this.detail);
  final CatalogProductDetail detail;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
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
                (item) => ListTile(title: Text(item['name']! as String)),
              ),
            ],
            if (detail.optionGroups.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                l.modifiersLabel,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...detail.optionGroups.map(
                (item) => ListTile(
                  title: Text(item['name']! as String),
                  subtitle: Text(
                    (item['modifiers']! as List<Object?>)
                        .map(
                          (modifier) =>
                              (modifier! as Map<String, Object?>)['name'],
                        )
                        .join(' · '),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l.closeAction),
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
