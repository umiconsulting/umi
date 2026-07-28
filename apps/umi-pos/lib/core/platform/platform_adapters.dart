enum CapabilityStatus { unsupported, unavailable, ready }

final class CapabilityResult<T> {
  const CapabilityResult._(this.status, this.value);
  const CapabilityResult.unsupported()
    : this._(CapabilityStatus.unsupported, null);
  const CapabilityResult.unavailable()
    : this._(CapabilityStatus.unavailable, null);
  const CapabilityResult.ready(T value) : this._(CapabilityStatus.ready, value);

  final CapabilityStatus status;
  final T? value;
}

abstract interface class ReceiptPrinter {
  Future<CapabilityResult<void>> printReceipt();
}

abstract interface class BarcodeScanner {
  Future<CapabilityResult<String>> scan();
}

abstract interface class CashDrawer {
  Future<CapabilityResult<void>> open();
}

abstract interface class ConnectivityAdapter {
  Future<CapabilityResult<bool>> isOnline();
}

abstract interface class DeviceIdentityAdapter {
  Future<CapabilityResult<String>> opaqueDeviceIdentifier();
}

abstract interface class AppLifecycleAdapter {
  CapabilityResult<void> observe();
}

final class UnsupportedReceiptPrinter implements ReceiptPrinter {
  const UnsupportedReceiptPrinter();
  @override
  Future<CapabilityResult<void>> printReceipt() async =>
      const CapabilityResult.unsupported();
}

final class UnsupportedBarcodeScanner implements BarcodeScanner {
  const UnsupportedBarcodeScanner();
  @override
  Future<CapabilityResult<String>> scan() async =>
      const CapabilityResult.unsupported();
}

final class UnsupportedCashDrawer implements CashDrawer {
  const UnsupportedCashDrawer();
  @override
  Future<CapabilityResult<void>> open() async =>
      const CapabilityResult.unsupported();
}

final class UnsupportedConnectivity implements ConnectivityAdapter {
  const UnsupportedConnectivity();
  @override
  Future<CapabilityResult<bool>> isOnline() async =>
      const CapabilityResult.unavailable();
}

final class UnsupportedDeviceIdentity implements DeviceIdentityAdapter {
  const UnsupportedDeviceIdentity();
  @override
  Future<CapabilityResult<String>> opaqueDeviceIdentifier() async =>
      const CapabilityResult.unsupported();
}

final class UnsupportedAppLifecycle implements AppLifecycleAdapter {
  const UnsupportedAppLifecycle();
  @override
  CapabilityResult<void> observe() => const CapabilityResult.unsupported();
}

final class PlatformAdapters {
  const PlatformAdapters({
    required this.printer,
    required this.scanner,
    required this.drawer,
    required this.connectivity,
    required this.deviceIdentity,
    required this.lifecycle,
  });

  const PlatformAdapters.unsupported()
    : printer = const UnsupportedReceiptPrinter(),
      scanner = const UnsupportedBarcodeScanner(),
      drawer = const UnsupportedCashDrawer(),
      connectivity = const UnsupportedConnectivity(),
      deviceIdentity = const UnsupportedDeviceIdentity(),
      lifecycle = const UnsupportedAppLifecycle();

  final ReceiptPrinter printer;
  final BarcodeScanner scanner;
  final CashDrawer drawer;
  final ConnectivityAdapter connectivity;
  final DeviceIdentityAdapter deviceIdentity;
  final AppLifecycleAdapter lifecycle;
}
