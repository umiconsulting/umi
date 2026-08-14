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

abstract interface class ConnectivityAdapter {
  Future<CapabilityResult<bool>> isOnline();
}

abstract interface class DeviceIdentityAdapter {
  Future<CapabilityResult<String>> opaqueDeviceIdentifier();
}

abstract interface class AppLifecycleAdapter {
  CapabilityResult<void> observe();
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
    required this.connectivity,
    required this.deviceIdentity,
    required this.lifecycle,
  });

  const PlatformAdapters.unsupported()
    : connectivity = const UnsupportedConnectivity(),
      deviceIdentity = const UnsupportedDeviceIdentity(),
      lifecycle = const UnsupportedAppLifecycle();

  final ConnectivityAdapter connectivity;
  final DeviceIdentityAdapter deviceIdentity;
  final AppLifecycleAdapter lifecycle;
}
