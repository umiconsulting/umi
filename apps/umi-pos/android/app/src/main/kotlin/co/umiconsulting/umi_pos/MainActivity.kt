package co.umiconsulting.umi_pos

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
  // Registers the hardware device-key channel (Android Keystore). Holds a
  // reference so the handler is not collected while the engine lives.
  private var deviceKeySigner: DeviceKeySigner? = null

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    val channel = MethodChannel(
      flutterEngine.dartExecutor.binaryMessenger,
      DeviceKeySigner.CHANNEL,
    )
    deviceKeySigner = DeviceKeySigner(channel)
  }
}
