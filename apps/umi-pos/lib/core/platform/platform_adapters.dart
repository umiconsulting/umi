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
  /// One-shot read of the interface state, for boot and for any caller that
  /// cannot hold a stream open.
  Future<CapabilityResult<bool>> isOnline();

  /// Interface presence as the platform reports it, or `null` when this
  /// platform has no watcher to offer.
  ///
  /// `true` means an interface is up, `false` means every interface is gone.
  /// `null` is the honest answer for a platform without an interface watcher:
  /// the till then learns about the wire the way it always has, from its own
  /// requests. An adapter is never made to fake events it cannot observe.
  Stream<bool>? watch();
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
  @override
  Stream<bool>? watch() => null;
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
