import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Register the hardware device-key channel (Secure Enclave). If a Flutter
    // version exposes the messenger differently, register instead with the root
    // FlutterViewController's binaryMessenger.
    if let messenger = engineBridge.pluginRegistry
      .registrar(forPlugin: "DeviceKeySigner")?.messenger() {
      DeviceKeySigner.register(with: messenger)
    }
  }
}
