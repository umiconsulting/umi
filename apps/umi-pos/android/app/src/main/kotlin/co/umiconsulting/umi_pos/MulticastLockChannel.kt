package co.umiconsulting.umi_pos

import android.content.Context
import android.net.wifi.WifiManager
import io.flutter.plugin.common.MethodChannel

/** Holds the Wi-Fi multicast filter open while the LAN node or discovery runs. */
class MulticastLockChannel(
  context: Context,
  private val channel: MethodChannel,
) : MethodChannel.MethodCallHandler {
  private val wifi =
    context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  private var lock: WifiManager.MulticastLock? = null
  private var references = 0

  init {
    channel.setMethodCallHandler(this)
  }

  override fun onMethodCall(call: io.flutter.plugin.common.MethodCall, result: MethodChannel.Result) {
    when (call.method) {
      "acquire" -> {
        if (references == 0) {
          lock = wifi.createMulticastLock("umi-pos-lan").also {
            it.setReferenceCounted(false)
            it.acquire()
          }
        }
        references += 1
        result.success(true)
      }
      "release" -> {
        if (references > 0) references -= 1
        if (references == 0) {
          lock?.release()
          lock = null
        }
        result.success(true)
      }
      else -> result.notImplemented()
    }
  }
}
