package co.umiconsulting.umi_pos

import android.app.NotificationChannel
import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "orders_ready_v2",
        "Pedidos listos",
        NotificationManager.IMPORTANCE_HIGH,
      )
      channel.description = "Avisos de productos listos para entregar"
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      channel.setShowBadge(true)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  // Registers the hardware device-key channel (Android Keystore). Holds a
  // reference so the handler is not collected while the engine lives.
  private var deviceKeySigner: DeviceKeySigner? = null

  // The USB host port for the receipt printer. Held for the same reason: the
  // handler owns the claimed interface, and it must outlive the registration.
  private var usbPrinter: UsbPrinterChannel? = null

  // The terminal's own cash-drawer port (the iMin RJ11 socket). Held for the same
  // reason again: every drawer device on this till rides this one board line.
  private var cashDrawer: CashDrawerChannel? = null

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    val messenger = flutterEngine.dartExecutor.binaryMessenger
    deviceKeySigner = DeviceKeySigner(
      MethodChannel(messenger, DeviceKeySigner.CHANNEL),
    )
    usbPrinter = UsbPrinterChannel(
      this,
      MethodChannel(messenger, UsbPrinterChannel.CHANNEL),
    )
    cashDrawer = CashDrawerChannel(
      this,
      MethodChannel(messenger, CashDrawerChannel.CHANNEL),
    )
  }
}
